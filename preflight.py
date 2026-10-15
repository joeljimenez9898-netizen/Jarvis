#!/usr/bin/env python3
"""Preflight: run every LIVE chain end to end against the running galaxy.

    python3 server.py        # in one terminal
    python3 preflight.py     # in another

No mocks. Every check makes real calls against the running server, the real files
on disk, the real Anthropic API and a real browser. A pass means the chain works
right now, not that its parts work in isolation.

Exit code is non-zero if anything fails. "Done" means this prints 0 fail.

Adding a check: write a function, decorate it with @check("what it proves"), and
raise Fail(...) or Warn(...) or return a short detail string for a pass. Checks run
in the order they appear in this file. Share state through CTX.
"""
import hashlib
import json
import os
import pathlib
import re
import secrets
import sys
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
BASE = os.environ.get("PREFLIGHT_BASE", "http://127.0.0.1:4700")
CONFIG = ROOT / "config.json"
VIEWER = ROOT / "viewer"
PLACEHOLDER_KEY = "PUT-YOUR-KEY-HERE"

CTX = {}          # state shared between checks (graph, key status, ...)
CHECKS = []


class Fail(Exception):
    pass


class Warn(Exception):
    pass


def check(name):
    def register(fn):
        CHECKS.append((name, fn))
        return fn
    return register


# ── helpers ─────────────────────────────────────────────────────────

def http(method, path, body=None, headers=None, timeout=20, raw_path=False):
    """Real HTTP against the running server. Returns (status, headers, bytes)."""
    url = BASE + path
    data = None
    hdrs = {"Origin": BASE} if method == "POST" else {}
    if body is not None:
        data = json.dumps(body).encode()
        hdrs["Content-Type"] = "application/json"
    hdrs.update(headers or {})
    req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers, r.read()         # headers: case-insensitive .get()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()
    except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
        raise Fail(f"server not reachable at {BASE} ({getattr(e, 'reason', e)}). Is server.py running?")


def raw_get(path, host=None):
    """GET with the path sent byte-for-byte (no client-side normalising of ../)."""
    import http.client
    conn = http.client.HTTPConnection(BASE.split("//", 1)[1], timeout=10)
    try:
        conn.putrequest("GET", path, skip_host=True, skip_accept_encoding=True)
        conn.putheader("Host", host or BASE.split("//", 1)[1])
        conn.endheaders()
        r = conn.getresponse()
        return r.status, r.read()
    except http.client.RemoteDisconnected:
        return 0, b""                                    # dropped: not served, but noted below
    except OSError as e:
        raise Fail(f"server not reachable at {BASE} ({e})")
    finally:
        conn.close()


def post_json(path, body, timeout=20):
    status, _, raw = http("POST", path, body, timeout=timeout)
    try:
        return status, json.loads(raw or b"{}")
    except json.JSONDecodeError:
        raise Fail(f"{path} returned non-JSON (HTTP {status}): {raw[:120]!r}")


def load_config():
    if "config" not in CTX:
        try:
            CTX["config"] = json.loads(CONFIG.read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise Fail("config.json is missing from the project root")
        except json.JSONDecodeError as e:
            raise Fail(f"config.json is not valid JSON: {e.msg} (line {e.lineno})")
    return CTX["config"]


def anthropic_client():
    try:
        import anthropic
    except ImportError:
        raise Fail("the anthropic package isn't installed: pip install -r requirements.txt")
    key = str(load_config().get("anthropic_api_key", "")).strip()
    # Explicit base_url: an ANTHROPIC_BASE_URL in the environment must not redirect the key.
    return anthropic, anthropic.Anthropic(api_key=key, base_url="https://api.anthropic.com",
                                          max_retries=0, timeout=30)


def parse_graph(raw):
    text = raw.decode("utf-8")
    if "const GRAPH" not in text:
        raise Fail("graph-data.js has no `const GRAPH` (run python3 build.py)")
    return json.loads(text.split("=", 1)[1].strip().rstrip(";"))


def code_sha():
    # Same recipe as server.CODE_SHA.
    return hashlib.sha256(b"".join((ROOT / f).read_bytes()
                                   for f in ("server.py", "build.py"))).hexdigest()[:16]


# ── the checks, in order ────────────────────────────────────────────

@check("Server is up and serving the viewer")
def server_up():
    status, headers, body = http("GET", "/")
    if status != 200:
        raise Fail(f"GET / returned HTTP {status}")
    if "text/html" not in headers.get("Content-Type", ""):
        raise Fail(f"GET / is {headers.get('Content-Type')!r}, not HTML")
    if b"<title>Knowledge Galaxy</title>" not in body:
        raise Fail("GET / is not the galaxy viewer (title missing)")
    status, _, boot = http("GET", "/api/boot")
    if status != 200:
        raise Fail(f"/api/boot returned HTTP {status}")
    CTX["boot"] = json.loads(boot)
    return f"{BASE} serves the viewer ({len(body):,} bytes)"


@check("Graph data loads and has notes")
def graph_loads():
    status, _, raw = http("GET", "/graph-data.js")
    if status != 200:
        raise Fail(f"/graph-data.js returned HTTP {status} (run python3 build.py)")
    graph = parse_graph(raw)
    nodes, links = graph.get("nodes", []), graph.get("links", [])
    if not nodes:
        raise Fail("graph has 0 nodes")
    bad_ids = [i for i, n in enumerate(nodes) if n.get("id") != i]
    if bad_ids:
        raise Fail(f"node id != array index at {bad_ids[:5]} (later lookups by index will be wrong)")
    bad_links = [l for l in links if not (0 <= l["source"] < len(nodes) and 0 <= l["target"] < len(nodes))]
    if bad_links:
        raise Fail(f"{len(bad_links)} links point outside the nodes array, e.g. {bad_links[0]}")
    CTX["graph"] = graph
    missing = [n["path"] for n in nodes if not (ROOT / n["path"]).exists() and not pathlib.Path(n["path"]).exists()]
    if missing:
        raise Warn(f"{len(nodes)} nodes, but {len(missing)} note files are gone from disk, "
                   f"e.g. {missing[0]} (re-run python3 build.py)")
    return f"{len(nodes)} notes, {len(links)} links"


@check("/chat answers a real question with a nodes array")
def chat_answers():
    nodes = CTX.get("graph", {}).get("nodes") or []
    if not nodes:
        raise Fail("no graph to ask about")
    note = max((n for n in nodes if n["group"] != "captures"), key=lambda n: n.get("degree", 0), default=nodes[0])
    question = f"What do my notes say about {note['label']}?"
    status, data = post_json("/chat", {"question": question}, timeout=150)
    if status != 200 or data.get("error"):
        raise Fail(f"HTTP {status}: {data.get('error') or data}")
    answer, cited = data.get("answer"), data.get("nodes")
    if not isinstance(answer, str) or not answer.strip():
        raise Fail(f"answer is empty or not a string: {answer!r}")
    if not isinstance(cited, list) or not all(isinstance(i, int) and 0 <= i < len(nodes) for i in cited):
        raise Fail(f"nodes is not a list of valid indexes: {cited!r}")
    if not isinstance(data.get("about_notes"), bool):
        raise Fail(f"about_notes missing or not a bool: {data.get('about_notes')!r}")
    if not cited:
        raise Warn(f'answered "{answer[:60]}…" but cited no notes for a question about {note["label"]!r}')
    labels = ", ".join(nodes[i]["label"] for i in cited[:3])
    return f'"{answer[:70]}{"…" if len(answer) > 70 else ""}" cited: {labels}'


@check("API key in config.json is valid (one real call)")
def key_valid():
    cfg = load_config()
    key = str(cfg.get("anthropic_api_key", "")).strip()
    CTX["key_ok"] = False
    if not key or key == PLACEHOLDER_KEY:
        raise Fail("config.json still has the placeholder key PUT-YOUR-KEY-HERE")
    anthropic, client = anthropic_client()
    try:
        client.models.list(limit=1)          # authenticates; costs no tokens
    except anthropic.AuthenticationError:
        raise Fail("Anthropic rejected the key in config.json (401)")
    except anthropic.PermissionDeniedError as e:
        raise Fail(f"the key isn't allowed to call the API (403): {e.message}")
    except anthropic.APIConnectionError:
        raise Fail("couldn't reach api.anthropic.com")
    except anthropic.APIStatusError as e:
        raise Fail(f"API error {e.status_code}: {e.message}")
    CTX["key_ok"] = True
    return f"key ending …{key[-4:]} accepted"


@check("Model in config.json is reachable with this key")
def model_reachable():
    model = str(load_config().get("model") or "").strip()
    if not model:
        raise Fail('config.json has no "model"')
    if not CTX.get("key_ok"):
        raise Fail(f"can't check model '{model}': there is no valid key to ask with")
    anthropic, client = anthropic_client()
    try:
        info = client.models.retrieve(model)
    except anthropic.NotFoundError:
        raise Fail(f"model '{model}' is not available to this key (404). Check the id in config.json.")
    except anthropic.APIStatusError as e:
        raise Fail(f"model '{model}': API error {e.status_code}: {e.message}")
    except anthropic.APIConnectionError:
        raise Fail(f"model '{model}': couldn't reach api.anthropic.com")
    return f"'{model}' ({getattr(info, 'display_name', model)})"


@check("/remember writes a real file that /chat can retrieve at once")
def remember_chain():
    token = "zq" + secrets.token_hex(3)                 # a word no real note contains
    text = f"remember that preflight probe {token} verifies the capture chain"
    captures = pathlib.Path(load_config().get("notes_dir") or ROOT / "notes").expanduser() / "captures"
    captures_existed = captures.exists()
    status, data = post_json("/remember", {"text": text}, timeout=30)
    if status != 200 or not data.get("ok"):
        raise Fail(f"/remember failed (HTTP {status}): {data.get('answer') or data.get('error') or data}")
    index, label = data["index"], data["node"]["label"]
    path = pathlib.Path(data["path"])
    path = path if path.is_absolute() else ROOT / path
    steps, problems = [], []
    try:
        # 1. a real file, with the words and today's date in it
        if not path.is_file():
            raise Fail(f"/remember said ok but {path} doesn't exist")
        content = path.read_text(encoding="utf-8")
        today = time.strftime("%Y-%m-%d")
        if token not in content or today not in content:
            raise Fail(f"{path.name} is missing the captured words or today's date ({today})")
        steps.append("file written")

        # 2. in the live index: exactly what /chat would send for the next question
        status, recall = post_json("/api/recall", {"question": f"what is the {token} probe"})
        sent = [n["index"] for n in recall.get("notes", [])]
        if status != 200:
            raise Fail(f"written, but /api/recall returned HTTP {status}: {recall.get('error', '')} "
                       f"(old server? restart python3 server.py)")
        if not sent or sent[0] != index:
            raise Fail(f"written but not retrievable: /chat would send {sent[:3]} instead of {index}")
        steps.append("ranked first for the next question")

        # 3. the real /chat cites it
        if not CTX.get("key_ok"):
            problems.append("/chat leg not run: no valid API key")
        else:
            status, chat = post_json("/chat", {"question": f"What does my {token} probe note say?"}, timeout=150)
            if status != 200 or chat.get("error"):
                problems.append(f"/chat failed: {chat.get('error') or status}")
            elif index not in chat.get("nodes", []):
                problems.append(f"/chat answered but didn't cite the new note ({chat.get('nodes')})")
            else:
                steps.append("/chat cited it")
    finally:
        cleanup = remove_test_note(index, label, path, captures, captures_existed)
    if cleanup:
        raise Fail(f"TEST NOTE LEFT BEHIND: {cleanup}")
    if problems:
        raise Fail("; ".join(steps + problems))
    return "; ".join(steps) + "; test note removed"


def remove_test_note(index, label, path, captures, captures_existed):
    """Take the probe back out: graph entry, links, degrees, file. Returns a problem or ''."""
    sys.path.insert(0, str(ROOT))
    import build
    try:
        graph = build.read_graph()
        nodes = graph["nodes"]
        if index != len(nodes) - 1 or nodes[index]["label"] != label:
            return (f"note {index} '{label}' is no longer the last node (something was added after "
                    f"it); remove {path} and re-run python3 build.py")
        for link in graph["links"]:
            if index in (link["source"], link["target"]):
                other = link["target"] if link["source"] == index else link["source"]
                nodes[other]["degree"] = max(0, nodes[other]["degree"] - 1)
        graph["links"] = [l for l in graph["links"] if index not in (l["source"], l["target"])]
        nodes.pop()
        build.write_graph(nodes, graph["links"])
        path.unlink(missing_ok=True)
        if not captures_existed and captures.is_dir() and not any(captures.iterdir()):
            captures.rmdir()
    except Exception as e:  # noqa: BLE001
        return f"cleanup failed ({e}); remove {path} and re-run python3 build.py"
    status, recall = post_json("/api/recall", {"question": f"what is the {label} probe"})
    if any(n["label"] == label for n in recall.get("notes", [])):
        return f"'{label}' is still in the server's search index after removal"
    return ""


@check("Files the browser is served match the files on disk")
def served_matches_disk():
    stale, compared = [], 0
    for f in sorted(VIEWER.rglob("*")):
        if not f.is_file() or f.suffix == ".tmp":
            continue
        rel = f.relative_to(VIEWER).as_posix()
        status, headers, body = http("GET", "/" + urllib.request.quote(rel))
        compared += 1
        if status != 200:
            stale.append(f"{rel} (HTTP {status})")
        elif hashlib.sha256(body).digest() != hashlib.sha256(f.read_bytes()).digest():
            stale.append(f"{rel} (served {len(body):,} bytes, disk has {f.stat().st_size:,})")
        if "no-store" not in headers.get("Cache-Control", ""):
            CTX.setdefault("cache_warn", []).append(rel)
    if stale:
        raise Fail("served file differs from disk: " + "; ".join(stale))
    running, on_disk = CTX.get("boot", {}).get("code"), code_sha()
    if running != on_disk:
        raise Fail(f"the server process is running old code (fingerprint {running or 'missing'}, "
                   f"disk has {on_disk}). Restart python3 server.py.")
    if CTX.get("cache_warn"):
        raise Warn(f"{compared} files match, but these lack Cache-Control: no-store, so a browser "
                   f"may keep a stale copy: {', '.join(CTX['cache_warn'])}")
    return f"{compared} viewer files byte-identical; server code is current ({running})"


@check("config.json is NOT reachable from the browser")
def config_unreachable():
    cfg = load_config()
    key = str(cfg.get("anthropic_api_key", "")).strip()
    secrets_in = [s for s in (key, "anthropic_api_key") if s]
    probes = ["/config.json", "/../config.json", "/%2e%2e/config.json", "/%2E%2E%2Fconfig.json",
              "/..%2fconfig.json", "//config.json", "/./config.json", "/viewer/../config.json",
              "/config.json%00.js", "/CONFIG.JSON", "/config.example.json/../config.json",
              "/server.py", "/../server.py", "/.git/config", "/../.git/config"]
    leaks, dropped = [], []
    for path in probes:
        status, body = raw_get(path)
        if status == 0:
            dropped.append(path)
        if status == 200 and any(s.encode() in body for s in secrets_in):
            leaks.append(f"{path} -> HTTP 200 WITH THE KEY")
        elif status == 200 and path.endswith((".py", "config")):
            leaks.append(f"{path} -> HTTP 200 (server source or git config exposed)")
        elif status == 200 and "config" in path:
            leaks.append(f"{path} -> HTTP 200")
    if (VIEWER / "config.json").exists():
        leaks.append("viewer/config.json EXISTS: everything in viewer/ is public")
    # DNS-rebinding guard: a foreign Host header must be refused.
    status, _ = raw_get("/", host="evil.example")
    if status == 200:
        leaks.append("a request with Host: evil.example was served (DNS rebinding guard is off)")
    if leaks:
        banner = "\n      " + "!" * 66 + "\n      !!  YOUR API KEY OR SERVER FILES ARE EXPOSED TO THE BROWSER  !!\n      " + "!" * 66
        raise Fail(banner + "\n      " + "\n      ".join(leaks))
    if dropped:
        raise Warn(f"nothing leaked, but the server dropped the connection on {', '.join(dropped)} "
                   f"instead of answering (a request handler crashed)")
    return f"{len(probes)} traversal probes refused; foreign Host refused"


@check("?mute=1 tab is silent: the one speak gate refuses")
def mute_is_silent():
    # 1. Static: exactly one call into the speech engine, behind the mute check.
    js = (VIEWER / "voice.js").read_text(encoding="utf-8")
    html = (VIEWER / "index.html").read_text(encoding="utf-8")
    calls = len(re.findall(r"\.speak\(\s*u\s*\)|speechSynthesis\.speak\(|synth\.speak\(", js + html))
    gate = re.search(r"function utter\(u\) \{\s*if \(MUTED\) return false;", js)
    flag = re.search(r'URLSearchParams\(location\.search\)\.get\("mute"\) === "1"', js)
    if calls != 1 or not gate or not flag:
        raise Fail(f"speech is not behind one gate: {calls} engine calls, mute check first in "
                   f"utter(): {bool(gate)}, ?mute=1 read from the URL: {bool(flag)}")

    # 2. Live: a real browser, the real page, the real speech engine spied on (not replaced).
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise Warn("one gate verified in source; live browser check skipped "
                   "(pip install playwright && playwright install chromium)")
    spy = """(() => { window.__engineCalls = 0;
      const real = speechSynthesis.speak.bind(speechSynthesis);
      speechSynthesis.speak = u => { window.__engineCalls++; return real(u); }; })()"""
    with sync_playwright() as pw:
        try:
            browser = pw.chromium.launch()
        except Exception as e:  # noqa: BLE001
            raise Warn(f"one gate verified in source; couldn't start a browser ({str(e).splitlines()[0]})")
        try:
            muted = browser.new_page()
            muted.add_init_script(spy)
            muted.goto(BASE + "/?mute=1", wait_until="domcontentloaded")
            muted.wait_for_function("window.Voice && Voice.MUTED === true", timeout=10000)
            muted.mouse.click(5, 5)                       # the gesture that unlocks audio
            refused = muted.evaluate("""() => {
              const u = new SpeechSynthesisUtterance('preflight'); u.volume = 0;
              return Voice.utter(u); }""")
            muted.evaluate("() => Voice.speak('preflight mute test')")
            muted.wait_for_timeout(800)
            muted_calls = muted.evaluate("window.__engineCalls")

            # Control: the same spy in an unmuted tab must see the call, or the test proves nothing.
            control = browser.new_page()
            control.add_init_script(spy)
            control.goto(BASE + "/", wait_until="domcontentloaded")
            control.wait_for_function("window.Voice && Voice.MUTED === false", timeout=10000)
            control.evaluate("""() => { const u = new SpeechSynthesisUtterance(' '); u.volume = 0;
                                        Voice.utter(u); speechSynthesis.cancel(); }""")
            control_calls = control.evaluate("window.__engineCalls")
        finally:
            browser.close()
    if muted_calls or refused is not False:
        raise Fail(f"?mute=1 tab reached the speech engine {muted_calls} time(s)")
    if control_calls < 1:
        raise Fail("the spy saw nothing in an unmuted tab either, so the mute result proves nothing")
    return "muted tab: 0 engine calls after a click, speak() and utter(); unmuted control: reached the engine"


@check("Teardown bay: REA ready and pinned")
def teardown_ready():
    status, _, raw = http("GET", "/teardown/diag")
    if status != 200:
        raise Fail(f"/teardown/diag returned HTTP {status}")
    d = json.loads(raw)
    CTX["bay"] = d
    rea = d.get("rea") or {}
    if rea.get("installed") and rea.get("installed") != rea.get("pinned"):
        raise Fail(f"REA {rea['installed']} is installed but Jarvis is pinned to {rea['pinned']}: {d.get('fix')}")
    if not d.get("ready"):
        raise Warn("bay not ready (Jarvis still works without it): " + " ".join(d.get("problems", [])))
    node, chrome = d.get("node") or {}, d.get("chrome") or {}
    return f"REA {rea['installed']} (pinned {rea['pinned']}), Node {node.get('version')}, Chrome: {chrome.get('path')}"


@check("Teardown law: off-limits targets are refused")
def teardown_law():
    off_limits = ["file:///etc/passwd", "javascript:alert(1)", "http://192.168.1.1/",
                  "http://169.254.169.254/latest/meta-data", "https://user:pw@example.com",
                  "ftp://example.com", "http://0.0.0.0:8080"]
    let_through = []
    for url in off_limits:
        status, data = post_json("/teardown", {"url": url}, timeout=30)
        if data.get("ok") or (data.get("action") or {}).get("line") != "refused":
            let_through.append(f"{url} -> {data.get('answer') or data}")
    if let_through:
        raise Fail("NOT refused: " + "; ".join(let_through))
    sys.path.insert(0, str(ROOT))
    try:
        import teardown
    except ImportError:
        return f"{len(off_limits)} off-limits targets refused (teardown.py not importable here)"
    acting = {"capture-browser-scenario", "capture-electron-scenario", "capture-native-ui-scenario",
              "debug-with-gdb", "debug-with-rizin", "cutter-command", "execute-rizin-command",
              "observe-web-session", "observe-web-execution", "capture-process"}
    if teardown.ALLOWED_COMMANDS & acting:
        raise Fail(f"teardown.py allows REA commands that act: {sorted(teardown.ALLOWED_COMMANDS & acting)}")
    return f"{len(off_limits)} off-limits targets refused; REA limited to {len(teardown.ALLOWED_COMMANDS)} observation commands"


@check("Teardown runs live: Chrome + REA observe a real page")
def teardown_live():
    if not (CTX.get("bay") or {}).get("ready"):
        raise Warn("skipped: the bay isn't ready (see above)")
    # Our own project is a page we may always look at, and it needs no internet.
    status, data = post_json("/teardown", {"url": BASE + "/", "headless": True}, timeout=180)
    a = data.get("action") or {}
    if status != 200 or not data.get("ok"):
        raise Fail(f"{data.get('answer') or data}")
    if a.get("title") != "Knowledge Galaxy" or not a.get("evidence_dir"):
        raise Fail(f"observed the wrong page or no evidence: title={a.get('title')!r}, dir={a.get('evidence_dir')}")
    folder = pathlib.Path(a["evidence_dir"])
    try:
        ev = json.loads((folder / "evidence.json").read_text())
        problems = evidence_problems(ev, folder)
    finally:
        import shutil
        shutil.rmtree(folder, ignore_errors=True)       # preflight's own test evidence
    if problems:
        raise Fail("evidence incomplete or unattributed: " + "; ".join(problems))
    return (f"{a['title']}: loaded in {a['load_seconds']}s; 5 steps captured, every line attributed "
            f"({len(ev['scripts'])} scripts, {ev['assets']['files']} files, screenshot "
            f"{ev['screenshot']['width']}x{ev['screenshot']['height']})")


def evidence_problems(ev, folder):
    """The five steps are all there, and every line says who captured it."""
    who = {"REA", "Jarvis browser", "Jarvis scan of REA-captured code"}
    problems = []
    if (ev.get("target") or {}).get("by") != "REA":
        problems.append("1: no REA target")
    if not ev.get("scripts") or any(x.get("by") != "REA" for x in ev["scripts"]):
        problems.append("1: scripts missing or not attributed to REA")
    if not isinstance(ev.get("routes"), list) or any(x.get("by") != "REA" for x in ev.get("loads", [])):
        problems.append("2: routes/loads missing or misattributed")
    if (ev.get("gpu") or {}).get("by") != "Jarvis scan of REA-captured code":
        problems.append("2: GPU strings missing or misattributed")
    shot = ev.get("screenshot") or {}
    png = folder / "screenshot.png"
    if shot.get("by") != "REA" or not png.is_file() or not png.read_bytes().startswith(b"\x89PNG"):
        problems.append("3: no decoded PNG screenshot from REA")
    assets = ev.get("assets") or {}
    if assets.get("by") != "Jarvis browser" or not assets.get("files") or \
            any(f.get("by") != "Jarvis browser" for f in assets.get("all", [])):
        problems.append("4: asset log missing or misattributed")
    if any(r.get("by") not in who for r in ev.get("stack", []) + ev.get("other_banners", [])):
        problems.append("5: fingerprint rows without attribution")
    return problems


@check("Owned browser: a public page opens, loads, scrolls and closes clean")
def owned_browser_public():
    if not (CTX.get("bay") or {}).get("ready"):
        raise Warn("skipped: the bay isn't ready")
    sys.path.insert(0, str(ROOT))
    import browser
    url = os.environ.get("PREFLIGHT_PUBLIC_URL", "https://nodejs.org/en")
    b = browser.OwnedBrowser(url, headless=True)
    try:
        with b:
            title, seconds = b.title, b.load_seconds
            y0 = b.evaluate("window.scrollY")
            b.scroll(400, steps=3)
            time.sleep(0.5)
            moved = b.evaluate("window.scrollY") - y0
    except browser.BrowserError as e:
        if "didn't load" in str(e) or "didn't finish" in str(e):
            raise Warn(f"couldn't reach {url} (no internet? set PREFLIGHT_PUBLIC_URL): {e}")
        raise Fail(str(e))
    r = b.cleanup_report or {}
    if r.get("leftover") or not r.get("folder_removed"):
        raise Fail(f"browser NOT cleaned up: {r}")
    if moved <= 0:
        raise Warn(f"{title!r} loaded in {seconds}s but wheel scrolling didn't move it")
    return f"{title!r} loaded in {seconds}s, wheel-scrolled {moved}px, closed; profile deleted"


@check("No Chrome left behind: no process holds a Jarvis profile, no profile folders remain")
def no_chrome_left():
    sys.path.insert(0, str(ROOT))
    import browser
    holders = browser.processes_using(browser.PROFILES)
    leftovers = [p.name for p in browser.PROFILES.iterdir()] if browser.PROFILES.exists() else []
    if holders or leftovers:
        raise Fail(f"Chrome processes still using {browser.PROFILES}: {holders or 'none'}; "
                   f"leftover profile folders: {leftovers or 'none'}")
    return f"0 processes, 0 folders in {browser.PROFILES}"


# ── runner ──────────────────────────────────────────────────────────

def main():
    tty = sys.stdout.isatty()
    paint = (lambda c, s: f"\033[{c}m{s}\033[0m") if tty else (lambda c, s: s)
    marks = {"pass": paint("32", "✓"), "fail": paint("31;1", "✗"), "warn": paint("33", "!")}
    counts = {"pass": 0, "fail": 0, "warn": 0}
    print(f"Preflight against {BASE}\n")
    for name, fn in CHECKS:
        started = time.monotonic()
        try:
            detail, outcome = fn() or "", "pass"
        except Fail as e:
            detail, outcome = str(e), "fail"
        except Warn as e:
            detail, outcome = str(e), "warn"
        except Exception as e:  # noqa: BLE001 — a crashing check is a failing check
            detail, outcome = f"check crashed: {e.__class__.__name__}: {e}", "fail"
        counts[outcome] += 1
        took = f"{time.monotonic() - started:.1f}s"
        print(f"  {marks[outcome]} {name}  {paint('2', took)}")
        if detail:
            print(f"      {paint('31' if outcome == 'fail' else '2', detail)}")
    summary = f"{counts['pass']} pass, {counts['fail']} fail, {counts['warn']} warn"
    print("\n" + (paint("31;1", summary) if counts["fail"] else paint("32;1", summary)))
    return 1 if counts["fail"] else 0


if __name__ == "__main__":
    sys.exit(main())
