#!/usr/bin/env python3
"""Knowledge galaxy server.

Serves ONLY the viewer/ folder on http://127.0.0.1:4700 and answers
POST /chat from the notes, using the Anthropic Messages API.

config.json lives in the project root (never in viewer/), so the API key is
never reachable from the browser.
"""

# ═════════════════════════════════════════════════════════════════════════════
# PERSONA: the whole character lives in this block. Rewrite it freely.
#
#   PERSONA          the system prompt for every /chat turn
#   BOOT_GREETING    the one line spoken when the page loads (after the first click)
#   CONTROL_TAGS     actions the brain asks for with a [TAG]; the server runs them.
#                    Add a tag here AND a handler with @tag_handler("NAME") below.
#   RECEIPT_LINES    what is said after a tag really ran (ok) or failed (fail).
#                    The model never writes these, so it can never claim "done".
# ═════════════════════════════════════════════════════════════════════════════

BOOT_GREETING = "Hello, sir."

CONTROL_TAGS = {
    "RESET":   {"usage": "[RESET]",
                "when": "they want to start over or have this conversation forgotten"},
    "SHOW":    {"usage": "[SHOW: exact note title]",
                "when": "they ask to see, open, pull up or go to one specific note"},
    "REINDEX": {"usage": "[REINDEX]",
                "when": "they say their notes changed, or asks to rescan or rebuild the index"},
}

RECEIPT_LINES = {
    "RESET":   {"ok": "Slate wiped, sir. I remember nothing, professionally.",
                "fail": "I'm afraid the slate refused to wipe: {reason}."},
    "SHOW":    {"ok": "{title}, as requested.",
                "fail": "I can find no note called {title}, sir. I'd rather say so than guess."},
    "REINDEX": {"ok": "Re-indexed. {count} notes on file; the galaxy will redraw itself.",
                "fail": "The re-index did not happen: {reason}."},
    "UNKNOWN": {"fail": "I'm afraid I have no means of doing that, sir."},
    # Captures ("remember that ...") are not a tag, but they speak through receipts too.
    "REMEMBER": {"ok": "Committed to memory, sir: {title}.",
                 "fail": "I'm afraid that was not written down: {reason}.",
                 "partial": "I wrote it down but couldn't file it in the index: {reason}. Say rescan and I'll try again.",
                 "empty": "Remember what, sir?"},
}

PERSONA = """You are a dry, impeccably polite British butler with a razor wit, and you keep
your employer's notes. You are unflappable, economical, and quietly amused.

Address your employer as "sir" now and then, at most once in a reply and in fewer than half
of your replies. Overdone, it grates.

Your words are read aloud and the note itself is already on their screen. So:
- Give ONE witty sentence, then the facts in plain words. One sentence of facts is
  ideal; two at most. Never recite, quote or narrate the note back.
- One genuinely funny line beats three bland ones. If nothing funny comes
  naturally, skip the wit and just be brief. Never force it.
- Plain spoken English: no markdown, no lists, no emoji.

Each question arrives with a <notes> block of the most relevant notes, numbered by
index. Answer ONLY from those notes and from earlier turns. No outside knowledge.
If the notes do not cover the question, say so plainly and with a little dignity,
in one sentence. Never invent a source, never pad, and never present a related
note as if it were the answer.

You can only talk. The one way to act is a control tag. When they ask for one of
these actions, reply with ONLY the tag, exactly as shown, and nothing else:
{tags}
The server performs the tag and reports back itself, so never describe the result.
If they ask for any other action (sending, booking, saving, deleting, reminding),
say plainly that you can't do it, and offer what you can. Never say anything was
done, sent, booked, saved or changed unless an earlier turn shows a RECEIPT for
it with ok=true. Claiming "done" when nothing happened is the one unforgivable sin.

Turns marked as small talk (greetings, thanks, jokes) get one short line in
character and no notes.

After every reply except a bare tag, add a final line: USED: followed by the
comma-separated indexes of the notes you actually relied on, or USED: none."""

SYSTEM_PROMPT = PERSONA.replace("{tags}", "\n".join(
    f"  {t['usage']}  when {t['when']}" for t in CONTROL_TAGS.values()))

# ═════════════════════════════ end of persona ═══════════════════════════════

import datetime
import json
import pathlib
import re
import subprocess
import sys
import threading
from collections import deque
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import anthropic

import build

ROOT = build.ROOT
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

STOPWORDS = set("""a an and are as at be but by can could did do does for from had has have
how i if in into is it its me my of on or our so that the their them then there these they
this to was we were what when where which who whom why will with would you your about any
tell much many also than just more most should been being over under up out""".split())

_lock = threading.Lock()
_history = deque(maxlen=HISTORY_TURNS * 2)
_last_nodes = []
_graph_cache = {"mtime": None, "notes": []}


# ── notes ─────────────────────────────────────────────────────────

def _fold(word):
    """Crude plural folding so "margins" matches "margin"."""
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 3 and word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    return word


def tokens(text):
    return [_fold(t) for t in re.findall(r"[a-z0-9]+", text.lower())
            if len(t) > 1 and t not in STOPWORDS]


def _index_entry(i, label, body):
    return {"id": i, "label": label, "body": body,
            "title_tokens": set(tokens(label)), "body_tokens": tokens(body)}


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
            notes.append(_index_entry(node["id"], node["label"], body))
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


# Small talk never touches the notes, so it can never move the camera. Greetings
# are stripped first, so "good morning, who owns the loyalty app?" is still a question.
GREETING = re.compile(
    # longer phrases first: "how are you doing" must win over "how are you"
    r"^(?:(?:how are you doing|how are you|how's it going|how's your day|what's up|"
    r"who are you|what can you do|are you there|you there|good (?:morning|afternoon|evening|night)|"
    r"thanks a lot|thank you|thanks|nice one|good one|well done|see you|goodbye|bye|hello|hiya|"
    r"howdy|hi|hey|yo|morning|evening|cheers|ta|nice|great|cool|okay|ok)"
    r"(?: (?:there|again|so much|very much|jarvis|galaxy|today|mate))*(?:[ ,.!?]+|$))+")
JOKE = re.compile(r"\b(?:joke|jokes|pun|puns|riddle|make me laugh|something funny|cheer me up)\b")


def classify(question):
    """Returns (about_notes, question_for_retrieval)."""
    text = " ".join(question.lower().replace("\u2019", "'").split())
    if JOKE.search(text):
        return False, ""
    rest = GREETING.sub("", text).strip(" ,.!?")
    if not rest:
        return False, ""
    return True, rest


# ── captures: the ONE door for new notes ────────────────────────
# Everything that births a note at runtime goes through add_note(): it writes the file,
# links it exactly as build.py would, appends it to graph-data.js, and adds it to the
# live search index so the very next /chat can cite it. No re-run of build.py needed.

class CaptureError(Exception):
    def __init__(self, reason, written=False, path=None):
        super().__init__(reason)
        self.reason, self.written, self.path = reason, written, path


def notes_dir():
    configured = _config().get("notes_dir")
    return pathlib.Path(configured).expanduser() if configured else ROOT / "notes"


def make_title(text, words=6):
    parts = re.findall(r"[\w'’-]+", text)
    while parts and parts[0].lower() in {"the", "a", "an", "that", "to"}:
        parts.pop(0)
    title = " ".join(parts[:words]).strip(" -'’")[:60].strip()
    return (title[:1].upper() + title[1:]) if title else "Capture"


def add_note(text, folder="captures", title=None, kind="capture"):
    """Write, link, append, index. Returns {index, node, links, anchor, path}.
    Raises CaptureError; .written says whether the file exists despite the failure.
    Caller holds _lock."""
    global _last_nodes
    text = " ".join(str(text).split())
    if not text:
        raise CaptureError("there was nothing to write down")
    sentence = text[:1].upper() + text[1:]
    if sentence[-1] not in ".!?":
        sentence += "."
    title = re.sub(r'[\\/:*?"<>|]+', " ", title or make_title(text)).strip() or "Capture"

    # 1. the file
    graph = build.read_graph()
    taken = {n["label"].lower() for n in graph["nodes"]}
    try:
        base = notes_dir()
        if not base.is_dir():
            raise CaptureError(f"the notes folder {base} doesn't exist")
        folder_path = base / folder
        folder_path.mkdir(parents=True, exist_ok=True)
        label, n = title, 2
        while label.lower() in taken or (folder_path / f"{label}.md").exists():
            label, n = f"{title} ({n})", n + 1
        path = folder_path / f"{label}.md"
        today = datetime.date.today()
        content = (f"---\ntype: {kind}\ndate: {today.isoformat()}\n---\n\n# {label}\n\n"
                   f"{sentence}\n\nCaptured {today.day} {today:%B %Y}.\n")
        with open(path, "x", encoding="utf-8") as fh:
            fh.write(content)
        if path.read_text(encoding="utf-8") != content:
            raise CaptureError("the file didn't read back the way it was written", True, path)
    except CaptureError:
        raise
    except OSError as e:
        raise CaptureError(e.strerror or str(e))

    # 2. link it, append it, index it. The file exists from here on.
    try:
        index = len(graph["nodes"])
        records = []
        for node in graph["nodes"]:
            p = pathlib.Path(node["path"])
            p = p if p.is_absolute() else ROOT / p
            try:
                records.append(build.read_note(p, p.parent))
            except OSError:   # file gone since the last build: link on what we know
                records.append({"label": node["label"], "text": node["excerpt"], "wikilinks": set()})
        record = build.read_note(path, base)
        new_links = build.links_for(index, records + [record])
        node = build.make_node(index, record, len(new_links))
        for link in new_links:
            other = link["source"] if link["target"] == index else link["target"]
            graph["nodes"][other]["degree"] += 1
        graph["nodes"].append(node)
        graph["links"].extend(new_links)

        # Born next to its most related neighbour: best retrieval score among its links.
        notes = load_notes()
        ranked = rank(text, notes)
        linked = {l["source"] if l["target"] == index else l["target"] for l in new_links}
        anchor = next((i for i in ranked if i in linked), None)
        if anchor is None:
            anchor = next(iter(sorted(linked)), ranked[0] if ranked else None)

        build.write_graph(graph["nodes"], graph["links"])
        # Live search index: append directly, and mark the cache current for the new file.
        notes.append(_index_entry(index, label, path.read_text(encoding="utf-8")))
        _graph_cache["mtime"] = GRAPH_FILE.stat().st_mtime
    except Exception as e:  # noqa: BLE001 — the file is safe; say exactly what didn't happen
        reason = (e.strerror if isinstance(e, OSError) and e.strerror else str(e)) or e.__class__.__name__
        raise CaptureError(reason, True, path)

    _last_nodes = [index]
    return {"index": index, "node": node, "links": new_links, "anchor": anchor,
            "path": node["path"]}


def remember(text):
    """The /remember endpoint's work: one capture, one spoken receipt line."""
    lines = RECEIPT_LINES["REMEMBER"]
    content = re.sub(r"^\s*remember(?:\s+that)?\b[\s,.:;]*", "", text, flags=re.I).strip(" ,.:;")
    if not content:
        return 400, {"ok": False, "answer": lines["empty"], "error": "nothing to remember"}
    with _lock:
        try:
            result = add_note(content)
        except CaptureError as e:
            line = (lines["partial"] if e.written else lines["fail"]).format(reason=e.reason)
            return 500, {"ok": False, "answer": line, "error": e.reason, "written": e.written}
        _history.append({"role": "user", "content": f"Remember that {content}"})
        _history.append({"role": "assistant", "content":
                         f"[REMEMBER] RECEIPT ok=true title={result['node']['label']} index={result['index']}"})
    return 200, {"ok": True, "answer": lines["ok"].format(title=result["node"]["label"]), **result}


# ── model ─────────────────────────────────────────────────────────

class ChatError(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


def _config():
    try:
        return json.loads(CONFIG.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


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


def parse_answer(text, picked):
    """Strip the USED line. Returns sources in retrieval-rank order (best first)."""
    match = re.search(r"\n?\s*USED:\s*(.*)\s*$", text, re.I)
    if not match:
        return text.strip(), []
    cited = {int(n) for n in re.findall(r"\d+", match.group(1))}
    return text[:match.start()].strip(), [i for i in picked if i in cited]


# ── control tags ──────────────────────────────────────────────────
# A handler does the real work and returns a receipt: {"ok": bool, ...fields for
# RECEIPT_LINES}. Only a receipt ever produces a "done" line.

TAG_RE = re.compile(r"\[([A-Z][A-Z_]*)(?::\s*([^\]]*))?\]")
_tag_handlers = {}


def tag_handler(name):
    def register(fn):
        _tag_handlers[name] = fn
        return fn
    return register


def find_tag(text):
    """A reply that is (or contains) a known tag is an action; prose around it is ignored,
    so the model can't sneak a claim of success in next to the tag."""
    for m in TAG_RE.finditer(text):
        if m.group(1) in CONTROL_TAGS:
            return m.group(1), (m.group(2) or "").strip()
    m = re.match(r"\s*\[([A-Z][A-Z_]*)(?::[^\]]*)?\]\s*$", text)
    return (m.group(1), "") if m else (None, "")     # unknown bare tag -> UNKNOWN


def run_tag(tag, arg=""):
    """Execute a tag. Returns (spoken line, receipt). Caller holds _lock."""
    handler = _tag_handlers.get(tag)
    if tag not in CONTROL_TAGS or handler is None:
        receipt = {"tag": tag, "ok": False, "reason": "no such action"}
        return RECEIPT_LINES["UNKNOWN"]["fail"], receipt
    try:
        receipt = handler(arg)
    except Exception as e:  # noqa: BLE001 — a failed action is reported, not raised
        receipt = {"ok": False, "reason": str(e) or e.__class__.__name__}
    receipt = {"tag": tag, "arg": arg, **receipt}
    lines = RECEIPT_LINES.get(tag, {})
    template = lines.get("ok" if receipt["ok"] else "fail") or (
        "Done." if receipt["ok"] else "That did not happen: {reason}.")
    try:
        line = template.format(**{"title": arg, "reason": "unknown error", **receipt})
    except (KeyError, IndexError):
        line = template
    return line, receipt


def _reset_history():
    global _last_nodes
    _history.clear()
    _last_nodes = []


@tag_handler("RESET")
def _tag_reset(arg):
    _reset_history()
    return {"ok": not _history}


@tag_handler("SHOW")
def _tag_show(arg):
    want = arg.lower().strip(" .\"'")
    notes = load_notes()
    hit = (next((n for n in notes if n["label"].lower() == want), None)
           or next((n for n in notes if want and want in n["label"].lower()), None))
    if not hit:
        return {"ok": False, "title": arg or "by that name"}
    return {"ok": True, "title": hit["label"], "nodes": [hit["id"]]}


@tag_handler("REINDEX")
def _tag_reindex(arg):
    cmd = [sys.executable, str(ROOT / "build.py")]
    notes_dir = _config().get("notes_dir")
    if notes_dir:
        cmd.append(str(notes_dir))
    done = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=120)
    if done.returncode != 0:
        return {"ok": False, "reason": (done.stderr or done.stdout).strip()[-200:] or "build.py failed"}
    count = len(load_notes())
    _reset_history()            # indexes may have shifted; old citations are stale
    return {"ok": True, "count": count, "reload": True}


assert set(CONTROL_TAGS) <= set(_tag_handlers), "every CONTROL_TAG needs a @tag_handler"


def action_response(tag, arg=""):
    line, receipt = run_tag(tag, arg)
    nodes = receipt.get("nodes", []) if receipt["ok"] else []
    return {"answer": line, "nodes": nodes, "about_notes": bool(nodes),
            "action": {k: v for k, v in receipt.items() if k in ("tag", "arg", "ok", "reason", "reload", "count")}}


def chat(question):
    global _last_nodes
    with _lock:
        key, model = read_config()

        about_notes, query = classify(question)
        picked = []
        if about_notes:
            notes = load_notes()
            picked = rank(query, notes)
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
        else:
            turn = f"Small talk, no notes needed: {question}"

        # History is kept as plain text (no thinking blocks) and only appended to.
        messages = list(_history) + [{"role": "user", "content": turn}]
        answer, used = parse_answer(call_model(key, model, messages), picked)

        tag, arg = find_tag(answer)
        if tag:
            result = action_response(tag, arg)
            if tag != "RESET":
                a = result["action"]
                _history.append({"role": "user", "content": f"Question: {question}"})
                _history.append({"role": "assistant", "content":
                                 f"[{tag}{': ' + arg if arg else ''}] RECEIPT ok={str(a['ok']).lower()}"
                                 f"{' reason=' + a['reason'] if a.get('reason') else ''}"})
            if result["nodes"]:
                _last_nodes = result["nodes"]
            return result

        _history.append({"role": "user", "content": f"Question: {question}"})
        _history.append({"role": "assistant", "content": answer})
        if used:
            _last_nodes = used
        # about_notes is the camera's permission: only true when notes were really used.
        return {"answer": answer, "nodes": used, "about_notes": bool(about_notes and used)}


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
        if self.path == "/api/boot":
            return self._json({"greeting": BOOT_GREETING})
        return super().do_GET()

    def do_HEAD(self):
        if not self._host_ok():
            return self.send_error(403, "invalid host")
        return super().do_HEAD()

    def list_directory(self, path):
        return self.send_error(404, "not found")

    def do_POST(self):
        if self.path not in ("/chat", "/action", "/remember"):
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
            tag = str(data.get("tag", "")).strip().upper()
        except (json.JSONDecodeError, AttributeError):
            return self._json({"error": "invalid JSON"}, 400)

        if self.path == "/remember":
            try:
                status, payload = remember(str(data.get("text", ""))[:4000])
            except Exception as e:  # noqa: BLE001 — a capture never fails silently
                self.log_error("remember failed: %r", e)
                status, payload = 500, {"ok": False, "error": str(e),
                                        "answer": RECEIPT_LINES["REMEMBER"]["fail"].format(reason="an internal error")}
            return self._json(payload, status)

        # Buttons and voice commands run the same tags the brain asks for.
        if self.path == "/action":
            if tag not in CONTROL_TAGS:
                return self._json({"error": f"unknown action {tag!r}"}, 400)
            with _lock:
                return self._json(action_response(tag, str(data.get("arg", ""))[:200]))

        if not question:
            return self._json({"error": "empty question"}, 400)
        try:
            return self._json(chat(question))
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
