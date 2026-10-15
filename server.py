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
    "TEARDOWN": {"usage": "[TEARDOWN:SITE|QUESTION]",
                 "when": "they ask to tear down, reverse engineer or look under the hood of a website. "
                         "SITE is its address (stripe.com), or the word this for the tab they're looking "
                         "at; QUESTION is what they want to know"},
}

RECEIPT_LINES = {
    "RESET":   {"ok": "Slate wiped, sir. I remember nothing, professionally.",
                "fail": "I'm afraid the slate refused to wipe: {reason}."},
    "SHOW":    {"ok": "{title}, as requested.",
                "fail": "I can find no note called {title}, sir. I'd rather say so than guess."},
    "REINDEX": {"ok": "Re-indexed. {count} notes on file; the galaxy will redraw itself.",
                "fail": "The re-index did not happen: {reason}."},
    "TEARDOWN": {"ok": "{spoken}",
                 "evidence_only": "I've taken it apart and filed the evidence, sir, but I couldn't think "
                                  "it through: {reason}.",
                 "busy": "I'm already taking one apart, sir.",
                 "started": "Right away, sir. Taking {host} apart; the panel will show you how it goes.",
                 "which": "Which site, sir? Say its name, as in stripe dot com.",
                 "cancelled": "Stopped, sir. Nothing was filed.",
                 "missing": "The workshop isn't fitted out yet, sir: {fix}.",
                 "refused": "I won't point the kit at that, sir: {reason}.",
                 "fail": "The teardown fell over, I'm afraid: {reason}."},
    "TEARDOWN_CANCEL": {"ok": "Stopping it now, sir.", "fail": "Nothing's being taken apart, sir."},
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

# The teardown bay's analyst: one call per teardown, given the evidence digest.
TEARDOWN_BRAIN = """You are the analyst in Jarvis's teardown bay. You receive a DIGEST of evidence
about one website and the user's QUESTION. The evidence was captured three ways, and every
digest line says which:
  [REA]            observed or analysed by REA (Reverse Engineer Anything)
  [Jarvis browser] read by Jarvis's own browser
  [Jarvis scan]    found by Jarvis scanning the code REA captured

Rules:
- Every claim must trace to a line in the digest. If you can't point to the line, leave it out.
- Inference is allowed only when labelled: say "likely" (for example, how an effect probably
  works given the libraries and shader names present).
- Never invent a library, version, file, route, number or technique that isn't in the digest.
- Keep attribution straight: never credit REA with what Jarvis read, or the reverse.
- Quote sizes, counts and versions exactly as given.

Output EXACTLY this, with nothing before or after:
LABEL: Teardown · <host>
SPOKEN: <two or three sentences for a dry British butler to say aloud. The headline answer to
the question first, then the most surprising detail. No web addresses, no file names, no
markdown; numbers as words.>
SUMMARY: <one short paragraph>
---NOTE---
<a markdown note with exactly these parts, in this order:
**Verdict:** <one line>
## The answer
## The stack            (each item with its evidence and who captured it)
## How the effect works (numbered; "likely" for inference)
## What it loads
## Rebuild it           (5 to 7 numbered steps a developer could hand to Claude Code)
## What the evidence can't show
Do not add a title, a snapshot or an Evidence section: Jarvis adds those.>"""

# Written once, the first time anything is taken apart.
REA_CONCEPT_NOTE = (
    "REA (Reverse Engineer Anything, github.com/morluto/rea) is the kit [[Jarvis]] uses to take "
    "websites apart. It observes a page running in a clean, throwaway browser: it reads the "
    "scripts, the routes and the files the page loads, and takes a snapshot. It never clicks, "
    "types, logs in or changes anything. Every teardown note links here.")

# ═════════════════════════════ end of persona ═══════════════════════════════

import datetime
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import threading
import uuid
import time
import platform
import urllib.parse
from collections import deque
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import anthropic

import build

# The teardown bay is optional: Jarvis boots and answers without it.
try:
    import teardown as bay
    import evidence
    BAY_ERROR = None
except Exception as _e:  # noqa: BLE001 — any import problem just disables the bay
    bay, evidence, BAY_ERROR = None, None, f"{_e.__class__.__name__}: {_e}"

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

# Fingerprint of the code this process loaded. preflight.py compares it with the files
# on disk to catch a server that was never restarted after an edit.
CODE_MODULES = ("server.py", "build.py", "teardown.py", "browser.py", "evidence.py")
CODE_SHA = hashlib.sha256(b"".join(
    (ROOT / f).read_bytes() for f in CODE_MODULES if (ROOT / f).exists())).hexdigest()[:16]

_lock = threading.RLock()       # re-entrant: tag handlers and add_note take it themselves
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


LABEL_SLOT = "@@LABEL@@"           # replaced with the note's final label
LABEL_URL_SLOT = "@@LABEL_URL@@"   # the same, URL-encoded, for links: "a (2).png" -> "a%20%282%29.png"


def add_note(text, folder="captures", title=None, kind="capture", markdown=None, attachments=None,
             meta=None):
    """THE door for new notes. Write, link, append, index. Returns {index, node, links, anchor, path}.
      text:        the sentence to capture, or for a markdown note the text to place it by
      markdown:    a full note body instead of the one-sentence form (LABEL_SLOT is filled in)
      attachments: {path relative to the note's folder: bytes}, written before the note
      meta:        extra frontmatter fields
    Raises CaptureError; .written says whether the file exists despite the failure."""
    with _lock:
        return _add_note_locked(text, folder, title, kind, markdown, attachments, meta)


def _add_note_locked(text, folder, title, kind, markdown, attachments, meta):
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
        front = {"type": kind, "date": today.isoformat(), **(meta or {})}
        head = "---\n" + "".join(f"{k}: {json.dumps(v, ensure_ascii=False) if isinstance(v, str) and ':' in v else v}\n"
                                 for k, v in front.items()) + "---\n\n"
        if markdown is not None:
            body = markdown.replace(LABEL_URL_SLOT, urllib.parse.quote(label)).replace(LABEL_SLOT, label)
            content = f"{head}# {label}\n\n{body.strip()}\n"
        else:
            content = f"{head}# {label}\n\n{sentence}\n\nCaptured {today.day} {today:%B %Y}.\n"
        for rel, data in (attachments or {}).items():
            target = folder_path / rel.replace(LABEL_SLOT, label)
            target.parent.mkdir(parents=True, exist_ok=True)
            with open(target, "xb") as fh:
                fh.write(data)
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


def remember(text):  # noqa: E302
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


def call_model(key, model, messages, system=None, max_tokens=CHAT_MAX_TOKENS,
               retry_tokens=RETRY_MAX_TOKENS, effort=CHAT_EFFORT, timeout=90):
    # base_url is explicit so an ANTHROPIC_BASE_URL in the environment can't
    # redirect the key somewhere else.
    client = anthropic.Anthropic(api_key=key, base_url="https://api.anthropic.com",
                                 max_retries=1, timeout=timeout)
    for budget in (max_tokens, retry_tokens):
        try:
            # Thinking is always on for Opus 5.5: no `thinking` param, no forced
            # tool_choice. Effort is set per route. fallbacks="default" re-runs a
            # safety-classifier refusal on Anthropic's recommended fallback model.
            response = client.beta.messages.create(
                model=model,
                max_tokens=budget,
                system=system or SYSTEM_PROMPT,
                messages=messages,
                output_config={"effort": effort},
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


def run_tag(tag, arg="", **opts):
    """Execute a tag. Returns (spoken line, receipt). Caller holds _lock."""
    handler = _tag_handlers.get(tag)
    if tag not in CONTROL_TAGS or handler is None:
        receipt = {"tag": tag, "ok": False, "reason": "no such action"}
        return RECEIPT_LINES["UNKNOWN"]["fail"], receipt
    try:
        receipt = handler(arg, **opts)
    except Exception as e:  # noqa: BLE001 — a failed action is reported, not raised
        receipt = {"ok": False, "reason": str(e) or e.__class__.__name__}
    receipt = {"tag": tag, "arg": arg, **receipt}
    return receipt_line(tag, receipt, arg), receipt


def receipt_line(tag, receipt, arg=""):
    lines = RECEIPT_LINES.get(tag, {})
    template = lines.get(receipt.get("line") or ("ok" if receipt["ok"] else "fail")) or (
        "Done." if receipt["ok"] else "That did not happen: {reason}.")
    try:
        return template.format(**{"title": arg, "reason": "unknown error", **receipt})
    except (KeyError, IndexError):
        return template


def _reset_history():
    global _last_nodes
    _history.clear()
    _last_nodes = []


@tag_handler("RESET")
def _tag_reset(arg):
    with _lock:
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
    with _lock:
        count = len(load_notes())
        _reset_history()        # indexes may have shifted; old citations are stale
    return {"ok": True, "count": count, "reload": True}


def bay_diag():
    if bay is None:
        return {"ready": False, "problems": [f"teardown.py could not be loaded ({BAY_ERROR})."],
                "fix": "restore teardown.py next to server.py"}
    return bay.diag()


TEARDOWN_HEADLESS = os.environ.get("JARVIS_TEARDOWN_HEADLESS") == "1"


TEARDOWN_TOKENS, TEARDOWN_RETRY_TOKENS = 8000, 16000   # thinking and answer share this budget
TEARDOWN_EFFORT = "medium"


def parse_teardown(text):
    """LABEL / SPOKEN / SUMMARY / ---NOTE--- -> dict, or raises ValueError."""
    m = re.search(r"^\s*LABEL:\s*(.+?)\s*$\s*^SPOKEN:\s*(.+?)\s*^SUMMARY:\s*(.+?)\s*^---NOTE---\s*$(.*)\Z",
                  text.strip(), re.S | re.M)
    if not m:
        raise ValueError("the analysis didn't come back in the LABEL / SPOKEN / SUMMARY / NOTE shape")
    label, spoken, summary, note = (g.strip() for g in m.groups())
    if not label.startswith("Teardown · ") or not spoken or not note:
        raise ValueError("the analysis came back with an empty or mislabelled part")
    missing = [h for h in ("**Verdict:**", "## The answer", "## The stack", "## How the effect works",
                           "## What it loads", "## Rebuild it", "## What the evidence can't show")
               if h not in note]
    return {"label": label, "spoken": spoken, "summary": summary, "note": note, "missing_sections": missing}


# Names a note might drop in. Any of these mentioned but absent from the digest is flagged.
KNOWN_TECH = ["Three.js", "Babylon.js", "PlayCanvas", "PixiJS", "OGL", "React Three Fiber", "R3F", "drei",
              "React", "Vue", "Svelte", "Angular", "Next.js", "Nuxt", "Astro", "Remix", "Gatsby", "GSAP",
              "ScrollTrigger", "Lenis", "Locomotive Scroll", "Theatre.js", "Framer Motion", "Motion One",
              "anime.js", "Lottie", "Rive", "Spline", "postprocessing", "Draco", "Basis", "KTX2",
              "meshoptimizer", "Vite", "webpack", "esbuild", "Rollup", "Parcel", "WebGPU", "Barba",
              "Swup", "Howler", "Tone.js", "Matter.js", "Cannon", "Rapier", "Ammo", "Tailwind", "jQuery"]


def check_against_digest(note, digest):
    """Claims in the note that the digest doesn't contain: libraries, versions, files, sizes."""
    # "Rebuild it" recommends tools for *your* rebuild; it makes no claims about the site.
    note = re.sub(r"## Rebuild it.*?(?=\n## |\Z)", "", note, flags=re.S)
    low = digest.lower()
    flags = []
    for tech in KNOWN_TECH:
        word = r"(?<![\w.-])" + re.escape(tech) + r"(?![\w-])"      # whole words: "react" ≠ "mouse-reactive"
        if re.search(word, note, re.I) and not re.search(word, digest, re.I):
            flags.append(f"library not in the evidence: {tech}")
    for v in sorted(set(re.findall(r"\b(?:r\d{3}|\d+\.\d+\.\d+)\b", note))):
        if v not in digest:
            flags.append(f"version not in the evidence: {v}")
    libraries = {t.lower() for t in KNOWN_TECH}
    for f in sorted(set(re.findall(r"\b[\w-]+\.(?:js|mjs|glb|gltf|wasm|ktx2|hdr|exr|png|jpe?g|webp|mp4|webm|woff2?)\b",
                                   note, re.I))):
        if f.lower() not in low and f.lower() not in libraries:
            flags.append(f"file not in the evidence: {f}")
    for size in sorted(set(re.findall(r"\b\d+(?:\.\d+)?\s?(?:KB|MB|GB)\b", note))):
        if size.replace(" ", "") not in digest.replace(" ", ""):
            flags.append(f"size not in the evidence: {size}")
    return flags


def speakable(text):
    """The butler says no web addresses or file names, whatever the brain wrote."""
    text = re.sub(r"https?://\S+", "the site", text)
    libraries = {t.lower() for t in KNOWN_TECH}          # "Three.js" is a library, not a file
    text = re.sub(r"\b[\w-]+\.(?:js|mjs|glb|gltf|wasm|ktx2|hdr|exr|png|jpe?g|webp|avif|mp4|webm|json|css|html)\b",
                  lambda m: m.group(0) if m.group(0).lower() in libraries else "a file", text, flags=re.I)
    text = re.sub(r"\b(?:[a-z0-9-]+\.)+(?:com|co|io|net|org|dev|app|design|studio|xyz|ai|uk|tech)\b",
                  "the site", text, flags=re.I)
    return re.sub(r"[*_`#]", "", text).strip()


def _evidence_section(ev, digest_chars, flags=None):
    a = ev["assets"]
    rows = ["| Layer | Library | Version | Captured by | Evidence |", "|---|---|---|---|---|"]
    for r in ev["stack"]:
        how = (f"banner/marker in `{r['file'].rsplit('/', 1)[-1]}`" if r.get("file") else r.get("note", "runtime global"))
        rt = f"; runtime: {r['runtime']['version']} ({r['runtime']['by']})" if r.get("runtime") else ""
        rows.append(f"| {r['layer']} | {r['name']} | {r['version'] or '—'} | {r['by']} | {how}{rt} |")
    if not ev["stack"]:
        rows.append("| — | nothing recognised | — | Jarvis scan of REA-captured code | no banners or markers |")
    kinds = ", ".join(f"{k} {t['files']} ({evidence._size(t['bytes'])})"
                      for k, t in sorted(a["by_kind"].items(), key=lambda kv: -kv[1]["bytes"]))
    ids = "\n".join(f"- `{op}`: `{eid}`" for op, eid in ev.get("rea_evidence_ids", {}).items() if eid)
    return (f"## Evidence\n\n### Stack\n\n" + "\n".join(rows) +
            f"\n\n### Totals (Jarvis browser)\n\n{a['files']} files, {evidence._size(a['bytes'])} sized, "
            f"from {len(a['by_origin'])} origin{'' if len(a['by_origin']) == 1 else 's'}: {kinds}.\n"
            + "".join(f"\n> {n}" for n in a["notes"]) +
            f"\n\n### REA evidence ids\n\n{ids}\n\n"
            f"Captured {ev['captured_at']} · job `{ev['job_id']}` · loaded in {ev['load_seconds']}s · "
            f"{len(ev['scripts'])} scripts (REA) · digest {digest_chars:,} characters.\n"
            + ("" if flags is None else
               "\n### Automatic check against the evidence\n\n" +
               ("Every library, version, file and size named above appears in the evidence.\n" if not flags else
                "These claims were **not found** in the evidence:\n\n" + "\n".join(f"- {f}" for f in flags) + "\n")))


def _evidence_only_note(ev, reason):
    a = ev["assets"]
    stack = "\n".join(f"- **{r['name']}**{' ' + r['version'] if r['version'] else ''} ({r['layer']}): {r['by']}"
                      for r in ev["stack"]) \
        or "- Nothing recognised."
    largest = "\n".join(f"- {evidence._size(f['bytes'])}: {f['kind']}" for f in a["largest"][:8])
    limits = "\n".join(f"- {l}" for l in evidence.LIMITS)
    return (f"**Verdict:** Evidence only. The analysis didn't run ({reason}), so nothing here is "
            f"interpreted.\n\n## The stack\n\n{stack}\n\n## What it loads\n\n{a['files']} files, "
            f"{evidence._size(a['bytes'])} sized (Jarvis browser).\n\n{largest}\n\n"
            f"## What the evidence can't show\n\n{limits}\n\n"
            f"*The answer, how the effect works and how to rebuild it need the brain. Re-run the "
            f"teardown once it's available.*")


def ensure_rea_note():
    """The [[REA]] concept note, born the first time anything is taken apart. Returns a birth or None."""
    if any(n["label"].lower() == "rea" for n in load_notes()):
        return None
    return add_note(REA_CONCEPT_NOTE, folder="concepts", title="REA", kind="concept",
                    markdown=REA_CONCEPT_NOTE)


TEARDOWN_STEPS = ["Opening the site in a clean browser", "Waiting for it to load",
                  "REA is watching while I scroll", "REA is reading the code", "Taking a snapshot",
                  "Listing everything it loaded", "Identifying the stack", "Writing the teardown"]
_STEP = {"open": 0, "load": 1, "watch": 2, "read": 3, "snapshot": 4, "assets": 5, "stack": 6, "write": 7}
THIS_WORDS = {"this", "this site", "this page", "this tab", "the current tab", "current tab"}


class TeardownJob:
    def __init__(self, url, question, headless):
        self.id = uuid.uuid4().hex[:12]
        self.url, self.question, self.headless = url, question, headless
        self.host = urllib.parse.urlsplit(url if "://" in url else "https://" + url).hostname or url
        self.started = time.monotonic()
        self.step, self.state, self.result = -1, "running", None
        self.cancel = threading.Event()
        self.thread = threading.Thread(target=self._run, name=f"teardown-{self.id}", daemon=True)

    def elapsed(self):
        return round(time.monotonic() - self.started)

    def at(self, name):
        if self.cancel.is_set():
            raise bay.Cancelled()
        self.step = _STEP[name]

    def _run(self):
        try:
            self.result = _teardown_work(self)
        except bay.Cancelled:
            self.result = {"ok": False, "line": "cancelled"}
        except Exception as e:  # noqa: BLE001 — a job reports, it never crashes the server
            self.result = {"ok": False, "reason": str(e)[:200] or e.__class__.__name__}
        self.finished = self.elapsed()
        self.state = ("cancelled" if self.result.get("line") == "cancelled"
                      else "done" if self.result.get("ok") else "failed")
        receipt = {"tag": "TEARDOWN", "arg": self.url, **self.result}
        self.answer = receipt_line("TEARDOWN", receipt, self.url)
        with _lock:
            _history.append({"role": "user", "content": f"Tear down {self.url}: {self.question}"})
            _history.append({"role": "assistant", "content":
                             f"[TEARDOWN: {self.url}] RECEIPT ok={str(self.state == 'done').lower()} "
                             f"state={self.state}" + (f" note={self.result.get('note')}" if self.result.get("note") else "")})

    def to_json(self):
        out = {"id": self.id, "host": self.host, "state": self.state, "step": self.step,
               "steps": TEARDOWN_STEPS, "elapsed": self.elapsed()}
        if self.state != "running":
            out.update(answer=self.answer, finished_in=self.finished, births=self.result.get("births", []))
            if self.result.get("births"):
                out["card"] = teardown_card(self.result["births"][-1]["index"])
        return out


_jobs, _current_job, _jobs_lock = {}, None, threading.Lock()


def resolve_this():
    """The address of the user's front Chrome tab (macOS only), never Jarvis's own tab."""
    if platform.system() != "Darwin":
        return None
    script = ('tell application "Google Chrome"\n set out to ""\n'
              ' repeat with w in windows\n set out to out & (URL of active tab of w) & linefeed\n end repeat\n'
              ' repeat with t in tabs of front window\n set out to out & (URL of t) & linefeed\n end repeat\n'
              ' return out\nend tell')
    try:
        done = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return None
    for line in done.stdout.splitlines():
        parts = urllib.parse.urlsplit(line.strip())
        if parts.scheme in ("http", "https") and parts.netloc not in (f"127.0.0.1:{PORT}", f"localhost:{PORT}"):
            return line.strip()
    return None


def start_teardown(url, question="", headless=None):
    """Start a teardown in the background. Returns a receipt with the job id, at once."""
    global _current_job
    with _jobs_lock:
        if _current_job and _current_job.state == "running":
            return {"ok": False, "line": "busy"}
        if bay is None:
            return {"ok": False, "line": "missing", "fix": "the teardown bay (teardown.py) isn't loaded"}
        url = (url or "").strip().strip(".,!?")
        if url.lower() in THIS_WORDS or not url:
            url = resolve_this()
            if not url:
                return {"ok": False, "line": "which"}
        try:
            bay.parse_url(url)                      # refuse the obviously off-limits at once
        except bay.LawError as e:
            return {"ok": False, "line": "refused", "reason": str(e)}
        info = bay.diag()
        if not info["ready"]:
            return {"ok": False, "line": "missing", "fix": info["fix"]}
        job = TeardownJob(url, question, TEARDOWN_HEADLESS if headless is None else headless)
        _jobs[job.id] = _current_job = job
        job.thread.start()
    return {"ok": True, "line": "started", "host": job.host, "job": job.id}


def cancel_teardown():
    job = _current_job
    if job and job.state == "running":
        job.cancel.set()
        return {"ok": True, "job": job.id}
    return {"ok": False}


def run_teardown(url, question="", headless=None):
    """Synchronous: start, wait, return the finished receipt (used by POST /teardown and preflight)."""
    started = start_teardown(url, question, headless)
    if not started.get("ok"):
        return started
    job = _jobs[started["job"]]
    job.thread.join()
    return {**job.result, "job": job.id}


def _teardown_work(job):
    """Evidence -> digest -> one brain call -> note(s). Returns a receipt."""
    question = job.question
    try:
        result = bay.teardown(job.url, headless=job.headless, step=job.at, cancel=job.cancel)
    except bay.LawError as e:
        return {"ok": False, "line": "refused", "reason": str(e)}
    except bay.NotReady as e:
        return {"ok": False, "line": "missing", "fix": e.fix}

    ev, summary = result["evidence"], result["summary"]
    host = urllib.parse.urlsplit(ev["url"]).hostname or "site"
    digest = evidence.brain_digest(ev, question)

    job.at("write")
    # one call to the current brain
    brain, brain_error = None, None
    try:
        key, model = read_config()
        raw = call_model(key, model, [{"role": "user", "content": f"DIGEST\n\n{digest}"}],
                         system=TEARDOWN_BRAIN, max_tokens=TEARDOWN_TOKENS,
                         retry_tokens=TEARDOWN_RETRY_TOKENS, effort=TEARDOWN_EFFORT, timeout=300)
        brain = parse_teardown(raw)
    except ChatError as e:
        brain_error = ("I've no API key yet" if "PUT-YOUR-KEY-HERE" in str(e)
                       else str(e).rstrip("."))
    except ValueError as e:
        brain_error = str(e)

    label = brain["label"] if brain else f"Teardown · {host}"
    flags = check_against_digest(brain["note"] + "\n" + brain["spoken"] + "\n" + brain["summary"], digest) \
        if brain else None
    body = brain["note"] if brain else _evidence_only_note(ev, brain_error)
    shot = pathlib.Path(ev["screenshot"]["path"]).read_bytes()
    markdown = (f"**{label}** · [[REA]] · {ev['url']}\n\n"
                f"![Snapshot of {host}](assets/{LABEL_URL_SLOT}.png)\n\n{body.strip()}\n\n"
                f"{_evidence_section(ev, len(digest), flags)}")
    if job.cancel.is_set():
        raise bay.Cancelled()
    births = []
    try:
        rea = ensure_rea_note()
        if rea:
            births.append(rea)
        births.append(add_note(brain["summary"] if brain else f"Teardown of {host}: {summary['stack']}",
                               folder="captures/teardowns", title=f"{host}-{datetime.date.today().isoformat()}",
                               kind="teardown", markdown=markdown, attachments={f"assets/{LABEL_SLOT}.png": shot},
                               meta={"label": label, "url": ev["url"], "job": ev["job_id"],
                                     "analysed": bool(brain), "took_s": job.elapsed()}))
    except CaptureError as e:
        return {"ok": False, "reason": f"the evidence was captured but the note wasn't written: {e.reason}",
                "births": births}
    note = births[-1]
    out = {"ok": True, "births": births, "note": note["path"], "label": label, "title": summary["title"],
           "analysed": bool(brain), "digest_chars": len(digest), "evidence_dir": summary["evidence_dir"],
           "stack": summary["stack"]}
    if brain:
        out.update(spoken=speakable(brain["spoken"]), summary=brain["summary"],
                   missing_sections=brain["missing_sections"], unsupported=flags)
    else:
        out.update(line="evidence_only", reason=brain_error)
    return out


def _teardown_note_path(index):
    nodes = build.read_graph()["nodes"]
    if not 0 <= index < len(nodes) or nodes[index]["group"] != "teardowns":
        return None
    p = pathlib.Path(nodes[index]["path"])
    return p if p.is_absolute() else ROOT / p


def teardown_card(index):
    """What the panel shows, read from the note on disk (so it survives a restart)."""
    path = _teardown_note_path(index)
    if not path or not path.exists():
        return None
    text = path.read_text(encoding="utf-8")
    front = dict(re.findall(r"^(\w+): (.*)$", text.split("\n---", 1)[0], re.M))
    clean = lambda v: json.loads(v) if v.startswith('"') else v
    url = clean(front.get("url", ""))
    chips = []
    table = re.search(r"### Stack\n\n(.*?)\n\n", text, re.S)
    for row in (table.group(1).splitlines()[2:] if table else []):
        cells = [c.strip() for c in row.strip("|").split("|")]
        if len(cells) >= 3 and cells[1] != "nothing recognised":
            chips.append(cells[1] + ("" if cells[2] in ("—", "") else f" {cells[2]}"))
    totals = re.search(r"### Totals \(Jarvis browser\)\n\n([^:\n]+)", text)
    rel = path.relative_to(notes_dir()).with_suffix("") if path.is_relative_to(notes_dir()) else path.stem
    vault = notes_dir().name
    return {"index": index, "host": urllib.parse.urlsplit(url).hostname or path.stem, "label": clean(front.get("label", "")),
            "took_s": int(front["took_s"]) if front.get("took_s", "").isdigit() else None,
            "analysed": front.get("analysed") == "True", "chips": chips[:10],
            "totals": re.sub(r"\b1 origins\b", "1 origin", totals.group(1).replace(" origin(s)", " origins")).strip()
                      if totals else "",
            "snapshot": bool(re.search(r"!\[[^\]]*\]\(assets/[^)]+\)", text)),
            "obsidian": "obsidian://open?vault=" + urllib.parse.quote(vault) + "&file=" + urllib.parse.quote(str(rel))}


def latest_teardown_index():
    folder = notes_dir() / "captures" / "teardowns"
    notes = sorted(folder.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True) if folder.is_dir() else []
    graph = build.read_graph()["nodes"]
    for p in notes:
        for n in graph:
            np_ = pathlib.Path(n["path"])
            if (np_ if np_.is_absolute() else ROOT / np_).resolve() == p.resolve():
                return n["id"]
    return None


def teardown_markdown(index):
    """The full note for the reader: frontmatter dropped, the snapshot pointed at the API."""
    path = _teardown_note_path(index)
    text = path.read_text(encoding="utf-8")
    text = re.sub(r"\A---\n.*?\n---\n+", "", text, flags=re.S)
    return re.sub(r"\]\(assets/[^)]+\.png\)", f"](/api/teardowns/snapshot?index={index})", text)


def teardown_snapshot(index):
    path = _teardown_note_path(index)
    m = re.search(r"\]\((assets/[^)]+\.png)\)", path.read_text(encoding="utf-8")) if path else None
    if not m:
        return None
    img = (path.parent / urllib.parse.unquote(m.group(1))).resolve()
    return img.read_bytes() if img.is_relative_to(path.parent.resolve()) and img.exists() else None


@tag_handler("TEARDOWN")
def _tag_teardown(arg, headless=None, question=None, wait=False):
    url, _, asked = arg.partition("|")
    q = question if question is not None else asked.strip()
    return (run_teardown if wait else start_teardown)(url.strip(), q, headless)


assert set(CONTROL_TAGS) <= set(_tag_handlers), "every CONTROL_TAG needs a @tag_handler"


def action_response(tag, arg="", **opts):
    line, receipt = run_tag(tag, arg, **opts)
    nodes = receipt.get("nodes", []) if receipt["ok"] else []
    return {"answer": line, "nodes": nodes, "about_notes": bool(nodes),
            "births": receipt.get("births", []),
            "action": {k: v for k, v in receipt.items() if k in (
                "tag", "arg", "ok", "reason", "reload", "count", "line", "fix", "title", "url", "origin",
                "scripts", "resources", "dom_nodes", "requests_seen", "frames", "evidence_id",
                "load_seconds", "page_height", "images", "job_id", "stack", "assets", "asset_bytes",
                "routes", "evidence_dir", "screenshot", "note", "label", "analysed", "summary",
                "digest_chars", "missing_sections", "unsupported", "job", "host")}}


def select_notes(question):
    """Exactly the notes /chat would send for this question: (about_notes, [indexes])."""
    about_notes, query = classify(question)
    if not about_notes:
        return False, []
    notes = load_notes()
    picked = rank(query, notes)
    # Follow-ups ("and who owns it?") have few keywords: top up from last turn.
    # Indexes can go stale if a note was removed since, so check they still exist.
    for i in _last_nodes:
        if len(picked) >= TOP_K:
            break
        if i < len(notes) and i not in picked:
            picked.append(i)
    return True, picked


def chat(question):
    global _last_nodes
    with _lock:
        key, model = read_config()

        about_notes, picked = select_notes(question)
        if about_notes:
            notes = load_notes()
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
        if not tag:
            _history.append({"role": "user", "content": f"Question: {question}"})
            _history.append({"role": "assistant", "content": answer})
            if used:
                _last_nodes = used
            # about_notes is the camera's permission: only true when notes were really used.
            return {"answer": answer, "nodes": used, "about_notes": bool(about_notes and used)}

    # Tags run OUTSIDE the conversation lock: a teardown takes minutes and chat mustn't freeze.
    if tag == "TEARDOWN" and "|" not in arg:
        arg = f"{arg} | {question}"                  # the user's own words are the question
    result = action_response(tag, arg)
    with _lock:
        if tag != "RESET":
            a = result["action"]
            _history.append({"role": "user", "content": f"Question: {question}"})
            _history.append({"role": "assistant", "content":
                             f"[{tag}{': ' + arg if arg else ''}] RECEIPT ok={str(a['ok']).lower()}"
                             f"{' reason=' + a['reason'] if a.get('reason') else ''}"
                             + (f" note={a['note']}" if a.get("note") else "")})
        if result["nodes"]:
            _last_nodes = result["nodes"]
        elif result.get("births"):
            _last_nodes = [result["births"][-1]["index"]]
    return result


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

    def _path_ok(self):
        # A NUL byte (e.g. /config.json%00.js) makes open() raise mid-request, which used
        # to drop the connection. Refuse it cleanly instead.
        return "\x00" not in urllib.parse.unquote(self.path)

    def do_GET(self):
        if not self._host_ok():
            return self.send_error(403, "invalid host")
        if not self._path_ok():
            return self.send_error(400, "bad path")
        url = urllib.parse.urlsplit(self.path)
        query = urllib.parse.parse_qs(url.query)
        if url.path == "/api/boot":
            return self._json({"greeting": BOOT_GREETING, "code": CODE_SHA})
        if url.path == "/teardown/diag":
            return self._json(bay_diag())
        if url.path == "/teardown/job":
            asked = query.get("id", [None])[0]
            job = _jobs.get(asked) if asked is not None else _current_job   # an unknown id is a 404
            return self._json(job.to_json() if job else {"error": "no teardown yet"}, 200 if job else 404)
        if url.path.startswith("/api/teardowns/"):
            return self._teardown_api(url.path, query)
        return super().do_GET()

    def _teardown_api(self, path, query):
        if path == "/api/teardowns/latest":
            index = latest_teardown_index()
            card = teardown_card(index) if index is not None else None
            return self._json({"card": card} if card else {"error": "no teardowns yet"}, 200 if card else 404)
        try:
            index = int(query.get("index", [""])[0])
        except ValueError:
            return self._json({"error": "index required"}, 400)
        if _teardown_note_path(index) is None:             # only teardown notes, by graph index
            return self._json({"error": "not a teardown"}, 404)
        if path == "/api/teardowns/note":
            return self._json({"card": teardown_card(index), "markdown": teardown_markdown(index)})
        if path == "/api/teardowns/snapshot":
            png = teardown_snapshot(index)
            if not png:
                return self._json({"error": "no snapshot"}, 404)
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(png)))
            self.end_headers()
            return self.wfile.write(png)
        return self._json({"error": "not found"}, 404)

    def do_HEAD(self):
        if not self._host_ok():
            return self.send_error(403, "invalid host")
        if not self._path_ok():
            return self.send_error(400, "bad path")
        return super().do_HEAD()

    def list_directory(self, path):
        return self.send_error(404, "not found")

    def do_POST(self):
        if self.path not in ("/chat", "/action", "/remember", "/api/recall", "/teardown",
                             "/teardown/start", "/teardown/cancel"):
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

        if self.path == "/teardown":
            # Same handler the brain's [TEARDOWN: ...] tag uses; no lock (it doesn't touch history).
            result = action_response("TEARDOWN", str(data.get("url", ""))[:500],
                                     headless=bool(data["headless"]) if "headless" in data else None,
                                     question=str(data.get("question", ""))[:1000], wait=True)
            return self._json({"ok": result["action"]["ok"], **result})

        if self.path == "/teardown/start":
            result = action_response("TEARDOWN", str(data.get("url", ""))[:500],
                                     headless=bool(data["headless"]) if "headless" in data else None,
                                     question=str(data.get("question", ""))[:1000])
            return self._json({"ok": result["action"]["ok"], **result})
        if self.path == "/teardown/cancel":
            receipt = cancel_teardown()
            return self._json({"ok": receipt["ok"], "answer": receipt_line("TEARDOWN_CANCEL", receipt)})

        if self.path == "/api/recall":
            with _lock:
                about, picked = select_notes(question)
                notes = load_notes()
                return self._json({"about_notes": about,
                                   "notes": [{"index": i, "label": notes[i]["label"]} for i in picked]})

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
            return self._json(action_response(tag, str(data.get("arg", ""))[:500]))

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
    try:                                    # a crash mid-teardown can leave Chrome running
        import browser
        swept = browser.sweep_orphans()
        if swept["killed"] or swept["removed"]:
            print(f"Cleaned up after a crashed teardown: {len(swept['killed'])} Chrome processes, "
                  f"{len(swept['removed'])} profile folders")
    except Exception as e:  # noqa: BLE001 — the galaxy runs without the bay
        print(f"(teardown cleanup skipped: {e})")
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Knowledge galaxy on http://{HOST}:{PORT}  (Ctrl+C to stop)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
