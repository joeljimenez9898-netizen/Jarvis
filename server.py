#!/usr/bin/env python3
"""Knowledge galaxy server.

Serves ONLY the viewer/ folder on http://127.0.0.1:4700 and answers
POST /chat from the notes, using the Anthropic Messages API.

config.json lives in the project root (never in viewer/), so the API key is
never reachable from the browser.
"""
import json
import pathlib
import re
import threading
from collections import deque
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import anthropic

ROOT = pathlib.Path(__file__).resolve().parent
VIEWER = ROOT / "viewer"
CONFIG = ROOT / "config.json"
GRAPH_FILE = VIEWER / "graph-data.js"
HOST, PORT = "127.0.0.1", 4700
PLACEHOLDER_KEY = "PUT-YOUR-KEY-HERE"

TOP_K = 6
HISTORY_TURNS = 6           # question/answer pairs kept for follow-ups
MAX_BODY = 16_000
CHAT_EFFORT = "low"         # short grounded answers; Opus 5.5 defaults to medium
CHAT_MAX_TOKENS = 2000      # covers thinking + answer
RETRY_MAX_TOKENS = 8000

SYSTEM_PROMPT = """You answer questions about the user's personal notes.

Each user turn contains a <notes> block with the most relevant notes, numbered by
their index, followed by the question. Answer ONLY from those notes and from
earlier answers in this conversation. Never use outside knowledge.

Answer in two or three plain sentences, no markdown. If the notes do not cover
the question, say so plainly in one sentence instead of guessing.

After the answer, on its own final line, write USED: followed by the comma-separated
index numbers of the notes you actually relied on, or USED: none."""

STOPWORDS = set("""a an and are as at be but by can could did do does for from had has have
how i if in into is it its me my of on or our so that the their them then there these they
this to was we were what when where which who whom why will with would you your about any
tell much many also than just more most should been being over under up out""".split())

_lock = threading.Lock()
_history = deque(maxlen=HISTORY_TURNS * 2)
_last_nodes = []
_graph_cache = {"mtime": None, "notes": []}


# ── notes ─────────────────────────────────────────────────────────

def tokens(text):
    return [t for t in re.findall(r"[a-z0-9]+", text.lower())
            if len(t) > 1 and t not in STOPWORDS]


def load_notes():
    """Nodes from graph-data.js (so indexes match the viewer) + full note text."""
    mtime = GRAPH_FILE.stat().st_mtime
    if _graph_cache["mtime"] != mtime:
        raw = GRAPH_FILE.read_text(encoding="utf-8")
        graph = json.loads(raw.split("=", 1)[1].strip().rstrip(";"))
        notes = []
        for node in graph["nodes"]:
            path = pathlib.Path(node["path"])
            path = path if path.is_absolute() else ROOT / path
            try:
                body = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                body = node["excerpt"]
            notes.append({"id": node["id"], "label": node["label"], "body": body,
                          "title_tokens": set(tokens(node["label"])),
                          "body_tokens": tokens(body)})
        _graph_cache.update(mtime=mtime, notes=notes)
    return _graph_cache["notes"]


def rank(question, notes):
    terms = set(tokens(question))
    scored = []
    for note in notes:
        score = 0.0
        for term in terms:
            if term in note["title_tokens"]:
                score += 5
            hits = note["body_tokens"].count(term)
            if hits:
                score += 1 + min(hits, 4) * 0.5
        if score:
            scored.append((score, note["id"]))
    scored.sort(key=lambda s: (-s[0], s[1]))
    return [i for _, i in scored[:TOP_K]]


# ── model ─────────────────────────────────────────────────────────

class ChatError(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


def read_config():
    try:
        cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ChatError("config.json is missing from the project root.", 503)
    except json.JSONDecodeError as e:
        raise ChatError(f"config.json is not valid JSON ({e.msg}).", 503)
    key = str(cfg.get("anthropic_api_key", "")).strip()
    if not key or key == PLACEHOLDER_KEY:
        raise ChatError("No Anthropic API key yet: replace PUT-YOUR-KEY-HERE in "
                        "config.json with your key, then ask again.", 503)
    return key, str(cfg.get("model") or "claude-opus-5-5")


def call_model(key, model, messages):
    # base_url is explicit so an ANTHROPIC_BASE_URL in the environment can't
    # redirect the key somewhere else.
    client = anthropic.Anthropic(api_key=key, base_url="https://api.anthropic.com",
                                 max_retries=1, timeout=90)
    for budget in (CHAT_MAX_TOKENS, RETRY_MAX_TOKENS):
        try:
            # Thinking is always on for Opus 5.5: no `thinking` param, no forced
            # tool_choice. Effort is set per route. fallbacks="default" re-runs a
            # safety-classifier refusal on Anthropic's recommended fallback model.
            response = client.beta.messages.create(
                model=model,
                max_tokens=budget,
                system=SYSTEM_PROMPT,
                messages=messages,
                output_config={"effort": CHAT_EFFORT},
                fallbacks="default",
                betas=["server-side-fallback-2026-07-01"],
            )
        except anthropic.AuthenticationError:
            raise ChatError("Anthropic rejected the API key in config.json "
                            "(401). Check it and try again.", 401)
        except anthropic.PermissionDeniedError as e:
            raise ChatError(f"This API key can't use {model} (403): {e.message}", 403)
        except anthropic.NotFoundError:
            raise ChatError(f"Model '{model}' was not found. Check config.json.", 404)
        except anthropic.RateLimitError:
            raise ChatError("Rate limited by Anthropic. Wait a moment and retry.", 429)
        except anthropic.BadRequestError as e:
            raise ChatError(f"Anthropic rejected the request (400): {e.message}", 502)
        except anthropic.APIStatusError as e:
            raise ChatError(f"Anthropic API error {e.status_code}: {e.message}", 502)
        except anthropic.APIConnectionError:
            raise ChatError("Couldn't reach api.anthropic.com. Check your connection.", 502)

        if response.stop_reason == "refusal":
            raise ChatError("The model declined to answer that question.", 200)
        text = "".join(b.text for b in response.content if b.type == "text").strip()
        if text:
            return text
    raise ChatError("The model returned no text, even with a larger budget.", 502)


def parse_answer(text, allowed):
    used = None
    match = re.search(r"\n?\s*USED:\s*(.*)\s*$", text, re.I)
    if match:
        text = text[:match.start()].strip()
        used = [int(n) for n in re.findall(r"\d+", match.group(1)) if int(n) in allowed]
    return text, used


def chat(question, reset=False):
    global _last_nodes
    with _lock:
        if reset:
            _history.clear()
            _last_nodes = []
        notes = load_notes()
        picked = rank(question, notes)
        # Follow-ups ("and who owns it?") have few keywords: top up from last turn.
        for i in _last_nodes:
            if len(picked) >= TOP_K:
                break
            if i not in picked:
                picked.append(i)

        context = "\n\n".join(
            f'<note index="{i}" title="{notes[i]["label"]}">\n{notes[i]["body"].strip()}\n</note>'
            for i in picked) or "(no notes matched this question)"
        turn = f"<notes>\n{context}\n</notes>\n\nQuestion: {question}"

        key, model = read_config()
        # History is kept as plain text (no thinking blocks) and only appended to.
        messages = list(_history) + [{"role": "user", "content": turn}]
        raw = call_model(key, model, messages)
        answer, used = parse_answer(raw, set(picked))
        used = picked if used is None else used

        _history.append({"role": "user", "content": f"Question: {question}"})
        _history.append({"role": "assistant", "content": answer})
        _last_nodes = used or _last_nodes
        return {"answer": answer, "nodes": used}


# ── http ──────────────────────────────────────────────────────────

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(VIEWER), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _host_ok(self):
        return self.headers.get("Host", "") in {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}

    def _json(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self._host_ok():
            return self.send_error(403, "invalid host")
        return super().do_GET()

    def do_HEAD(self):
        if not self._host_ok():
            return self.send_error(403, "invalid host")
        return super().do_HEAD()

    def list_directory(self, path):
        return self.send_error(404, "not found")

    def do_POST(self):
        if self.path != "/chat":
            return self._json({"error": "not found"}, 404)
        origin = self.headers.get("Origin")
        if not self._host_ok() or (origin and origin not in
                                   {f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"}):
            return self._json({"error": "origin rejected"}, 403)
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            return self._json({"error": "send application/json"}, 415)
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if not 0 < length <= MAX_BODY:
            return self._json({"error": "bad request size"}, 413)
        try:
            data = json.loads(self.rfile.read(length))
            question = str(data.get("question", "")).strip()[:2000]
        except (json.JSONDecodeError, AttributeError):
            return self._json({"error": "invalid JSON"}, 400)
        if not question:
            return self._json({"error": "empty question"}, 400)

        try:
            return self._json(chat(question, reset=bool(data.get("reset"))))
        except ChatError as e:
            return self._json({"error": str(e), "answer": "", "nodes": []}, e.status)
        except Exception as e:  # noqa: BLE001 — never crash the request thread
            self.log_error("chat failed: %r", e)
            return self._json({"error": "Internal error while answering. "
                                        "See the server log.", "answer": "", "nodes": []}, 500)


def main():
    if not GRAPH_FILE.exists():
        raise SystemExit("viewer/graph-data.js missing: run python3 build.py first")
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Knowledge galaxy on http://{HOST}:{PORT}  (Ctrl+C to stop)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
