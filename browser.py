"""The browser Jarvis owns for teardowns. Standard library only.

REA never opens a browser itself; it attaches to this one.

    with OwnedBrowser("https://example.com", headless=True) as b:
        print(b.title, b.load_seconds)
        b.scroll(800)
        facts = b.evaluate("document.documentElement.scrollHeight")

CLEAN EVERY TIME
  Each teardown gets a brand-new profile in ~/.jarvis-tools/rea/profiles/<job id>:
  never the user's everyday Chrome, never their cookies or logins, and no cache
  to make a heavy site look tiny.

ALWAYS CLOSE
  On exit: terminate Chrome, kill anything still using the profile path, delete
  the folder, and verify both. A teardown never leaves a Chrome running.

TWO JOBS ONLY
  DevTools is used for exactly two things: Runtime.evaluate for read-only page
  facts, and Input.dispatchMouseEvent with type mouseWheel to scroll (wheel, not
  scrollTo, because smooth-scroll libraries listen to the wheel). No clicks, no
  typing, no navigation. DevToolsSocket refuses every other method.
"""
import base64
import hashlib
import json
import os
import pathlib
import platform
import re
import shutil
import signal
import socket
import struct
import subprocess
import threading
import time
import urllib.parse
import urllib.request
import uuid

CDP_PORT = 9333                    # loopback only
WINDOW = (1280, 820)
STARTUP_TIMEOUT_S = 25             # for /json/version to answer
LOAD_TIMEOUT_S = 45                # for the page target and document.readyState == "complete"
INTRO_SETTLE_S = 2.5               # intro animations, after "complete"
PROFILES = pathlib.Path(os.environ.get("JARVIS_TOOLS", "~/.jarvis-tools")).expanduser() / "rea" / "profiles"

_ONE_AT_A_TIME = threading.Lock()  # the port is fixed, so teardowns take turns


class BrowserError(RuntimeError):
    pass


# ── a minimal WebSocket client for the DevTools protocol ──────────

class DevToolsSocket:
    """RFC 6455 client: handshake, masked client frames, fragmented and large replies,
    ping/pong. Speaks only the two DevTools methods Jarvis is allowed to use."""

    ALLOWED = {"Runtime.evaluate", "Input.dispatchMouseEvent"}
    _GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
    # Read-only means read-only: refuse expressions that obviously act on the page.
    _ACTING = re.compile(r"\.click\s*\(|\.submit\s*\(|\.focus\s*\(|dispatchEvent|\bfetch\s*\(|XMLHttpRequest|"
                         r"sendBeacon|\bopen\s*\(|location\s*(\.\w+\s*)?=(?!=)|\.(assign|replace|reload)\s*\(|"
                         r"cookie\s*=(?!=)|setItem|removeItem|\.clear\s*\(|innerHTML\s*=(?!=)|\.value\s*=(?!=)|"
                         r"\.remove\s*\(|append(Child)?\s*\(|scrollTo|scrollBy|history\.")

    def __init__(self, ws_url, timeout=30):
        parts = urllib.parse.urlsplit(ws_url)
        if parts.scheme != "ws" or parts.hostname not in ("127.0.0.1", "localhost"):
            raise BrowserError(f"refusing a non-loopback DevTools socket: {ws_url}")
        self.sock = socket.create_connection((parts.hostname, parts.port or 80), timeout=timeout)
        self._next_id = 0
        key = base64.b64encode(os.urandom(16))
        path = parts.path + (f"?{parts.query}" if parts.query else "")
        self.sock.sendall(
            f"GET {path} HTTP/1.1\r\nHost: {parts.hostname}:{parts.port}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key.decode()}\r\n"
            f"Sec-WebSocket-Version: 13\r\n\r\n".encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise BrowserError("DevTools closed the connection during the handshake")
            head += chunk
        head, self._buffer = head.split(b"\r\n\r\n", 1)
        lines = head.decode("latin-1").split("\r\n")
        if " 101 " not in lines[0] + " ":
            raise BrowserError(f"WebSocket handshake refused: {lines[0]}")
        headers = {k.strip().lower(): v.strip() for k, v in (l.split(":", 1) for l in lines[1:] if ":" in l)}
        expected = base64.b64encode(hashlib.sha1(key + self._GUID).digest()).decode()
        if headers.get("sec-websocket-accept") != expected:
            raise BrowserError("WebSocket handshake failed: bad Sec-WebSocket-Accept")

    # frames
    def _send_frame(self, opcode, payload=b""):
        header = bytes([0x80 | opcode])                     # FIN + opcode
        n = len(payload)
        if n < 126:
            header += bytes([0x80 | n])                     # MASK bit: clients must mask
        elif n < 1 << 16:
            header += bytes([0x80 | 126]) + struct.pack("!H", n)
        else:
            header += bytes([0x80 | 127]) + struct.pack("!Q", n)
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(header + mask + masked)

    def _recv_exact(self, n):
        while len(self._buffer) < n:
            chunk = self.sock.recv(max(65536, n - len(self._buffer)))
            if not chunk:
                raise BrowserError("DevTools connection closed")
            self._buffer += chunk
        data, self._buffer = self._buffer[:n], self._buffer[n:]
        return data

    def _recv_frame(self):
        b1, b2 = self._recv_exact(2)
        fin, opcode, masked, n = b1 & 0x80, b1 & 0x0F, b2 & 0x80, b2 & 0x7F
        if n == 126:
            n = struct.unpack("!H", self._recv_exact(2))[0]
        elif n == 127:
            n = struct.unpack("!Q", self._recv_exact(8))[0]
        mask = self._recv_exact(4) if masked else None
        payload = self._recv_exact(n)
        if mask:
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        return bool(fin), opcode, payload

    def recv_message(self):
        """One complete text/binary message, reassembled from fragments; answers pings."""
        parts = []
        while True:
            fin, opcode, payload = self._recv_frame()
            if opcode == 0x9:                               # ping -> pong with the same payload
                self._send_frame(0xA, payload)
                continue
            if opcode == 0xA:                               # unsolicited pong
                continue
            if opcode == 0x8:                               # close
                try:
                    self._send_frame(0x8, payload[:2])
                except OSError:
                    pass
                raise BrowserError("DevTools closed the connection")
            if opcode in (0x1, 0x2, 0x0):                   # text, binary, continuation
                parts.append(payload)
                if fin:
                    return b"".join(parts).decode("utf-8")
            else:
                raise BrowserError(f"unexpected WebSocket opcode {opcode}")

    # DevTools
    def call(self, method, params=None, timeout=30):
        if method not in self.ALLOWED:
            raise BrowserError(f"DevTools method {method!r} is not allowed (read and scroll only)")
        if method == "Input.dispatchMouseEvent" and (params or {}).get("type") != "mouseWheel":
            raise BrowserError("only mouseWheel events: Jarvis never clicks or moves the mouse")
        self._next_id += 1
        msg_id = self._next_id
        self._send_frame(0x1, json.dumps({"id": msg_id, "method": method, "params": params or {}}).encode())
        self.sock.settimeout(timeout)
        while True:
            msg = json.loads(self.recv_message())
            if msg.get("id") == msg_id:                     # events and other replies are skipped
                if "error" in msg:
                    raise BrowserError(f"{method}: {msg['error'].get('message')}")
                return msg.get("result", {})

    def evaluate(self, expression, timeout=30):
        """Read-only page facts. Returns the value, by value."""
        if self._ACTING.search(expression):
            raise BrowserError("that expression would act on the page; evaluate is read-only")
        result = self.call("Runtime.evaluate", {"expression": expression, "returnByValue": True,
                                                "awaitPromise": False, "userGesture": False,
                                                "silent": True}, timeout=timeout)
        if result.get("exceptionDetails"):
            raise BrowserError(f"page fact failed: {result['exceptionDetails'].get('text')}")
        return (result.get("result") or {}).get("value")

    def wheel(self, delta_y, x, y):
        self.call("Input.dispatchMouseEvent", {"type": "mouseWheel", "x": x, "y": y,
                                               "deltaX": 0, "deltaY": delta_y})

    def close(self):
        try:
            self._send_frame(0x8, struct.pack("!H", 1000))
        except OSError:
            pass
        try:
            self.sock.close()
        except OSError:
            pass


# ── finding and killing what uses a profile ───────────────────────

def processes_using(path):
    """PIDs whose command line mentions `path`."""
    path, me = str(path), os.getpid()
    pids = []
    system = platform.system()
    if system == "Linux":
        for entry in os.listdir("/proc"):
            if entry.isdigit() and int(entry) != me:
                try:
                    cmd = open(f"/proc/{entry}/cmdline", "rb").read().replace(b"\0", b" ").decode(errors="replace")
                except OSError:
                    continue
                if path in cmd:
                    pids.append(int(entry))
    elif system == "Darwin":
        out = subprocess.run(["ps", "-axww", "-o", "pid=,command="], capture_output=True, text=True).stdout
        pids = [int(l.split(None, 1)[0]) for l in out.splitlines()
                if path in l and int(l.split(None, 1)[0]) != me]
    elif system == "Windows":
        ps = ("Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*" + path.replace("'", "''")
              + "*' } | ForEach-Object { $_.ProcessId }")
        out = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True).stdout
        pids = [int(x) for x in out.split() if x.isdigit() and int(x) != me]
    return pids


def _kill(pid):
    try:
        if platform.system() == "Windows":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True)
        else:
            os.kill(pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        pass


def _json(path, timeout=2):
    with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}{path}", timeout=timeout) as r:
        return json.loads(r.read())


def _same_site(host, want):
    strip = lambda h: (h or "").lower().removeprefix("www.")
    return strip(host) == strip(want) or (host or "").lower().endswith("." + strip(want))


# ── the owned browser ─────────────────────────────────────────────

class OwnedBrowser:
    """Chrome on 127.0.0.1:9333 with a fresh profile, opened at `url`, loaded and settled."""

    def __init__(self, url, headless=False, chrome=None, settle_s=INTRO_SETTLE_S):
        self.url, self.headless, self.settle_s = url, headless, settle_s
        self.chrome = chrome or _default_chrome()
        self.job_id = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
        self.profile = PROFILES / self.job_id
        self.proc = self.ws = self.target = None
        self.load_seconds = None
        self.cleanup_report = None
        self._locked = False

    @property
    def endpoint(self):
        return f"http://127.0.0.1:{CDP_PORT}"

    @property
    def target_id(self):
        return self.target["id"]

    @property
    def title(self):
        return self.evaluate("document.title")

    def __enter__(self):
        if not self.chrome:
            raise BrowserError("Google Chrome was not found")
        if not _ONE_AT_A_TIME.acquire(timeout=120):
            raise BrowserError("another teardown is still using the browser")
        self._locked = True
        try:
            self._launch()
            return self
        except BaseException:
            self.close()
            raise

    def __exit__(self, exc_type, exc, tb):
        try:
            self.close()
        except BrowserError:
            if exc_type is None:     # don't let a cleanup error hide the original one
                raise

    def _launch(self):
        with socket.socket() as probe:                      # anything at all on the port?
            probe.settimeout(1)
            if probe.connect_ex(("127.0.0.1", CDP_PORT)) == 0:
                raise BrowserError(f"something is already listening on port {CDP_PORT} "
                                   f"(another Chrome with remote debugging?). Close it and retry.")
        self.profile.mkdir(parents=True, exist_ok=False)
        w, h = WINDOW
        args = [self.chrome, f"--user-data-dir={self.profile}",
                f"--remote-debugging-port={CDP_PORT}", "--remote-debugging-address=127.0.0.1",
                "--no-first-run", "--no-default-browser-check", "--disable-extensions",
                f"--window-size={w},{h}", "--mute-audio",
                # an observation browser shouldn't phone home: no updates, sync or prefetch
                "--disable-background-networking", "--disable-component-update", "--disable-sync"]
        if self.headless:
            # Headless has no GPU; without software GL a 3D site would show its no-WebGL
            # fallback and the teardown would be of the wrong page. Windowed runs use the GPU.
            args += ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
        if platform.system() == "Linux" and hasattr(os, "geteuid") and os.geteuid() == 0:
            args.append("--no-sandbox")                     # Chrome refuses to run as root otherwise
        args.append(self.url)
        popen = dict(stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if platform.system() == "Windows":
            popen["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            popen["start_new_session"] = True               # its own group, so we can end all of it
        started = time.monotonic()
        self.proc = subprocess.Popen(args, **popen)

        # 1. DevTools answers
        while True:
            if self.proc.poll() is not None:
                raise BrowserError(f"Chrome exited at startup (code {self.proc.returncode})")
            try:
                _json("/json/version")
                break
            except OSError:
                if time.monotonic() - started > STARTUP_TIMEOUT_S:
                    raise BrowserError(f"Chrome's DevTools didn't answer within {STARTUP_TIMEOUT_S}s")
                time.sleep(0.2)

        # 2. the page target for this site (www and redirects allowed)
        want = urllib.parse.urlsplit(self.url).hostname
        deadline = started + LOAD_TIMEOUT_S
        while True:
            pages = [t for t in _json("/json/list") if t.get("type") == "page"]
            real = [t for t in pages if t.get("url", "").startswith(("http://", "https://"))]
            match = [t for t in real if _same_site(urllib.parse.urlsplit(t["url"]).hostname, want)]
            if match or len(real) == 1:                     # one real page: a redirect elsewhere
                self.target = (match or real)[0]
                break
            if time.monotonic() > deadline:
                raise BrowserError(f"no page for {want} appeared within {LOAD_TIMEOUT_S}s "
                                   f"(saw: {[t.get('url') for t in pages]})")
            time.sleep(0.25)

        # 3. document.readyState == "complete", then the intro animation
        self.ws = DevToolsSocket(self.target["webSocketDebuggerUrl"])
        # A new tab starts as an empty about:blank document that is already "complete",
        # so wait for a real http(s) document to be complete. Chrome's own error page is
        # chrome-error://, which means the site didn't load at all.
        while True:
            try:
                state = self.ws.evaluate("[location.href, document.readyState]") or ["", ""]
            except BrowserError as e:                       # mid-navigation: context replaced
                if "closed" in str(e):
                    raise
                state = ["", ""]
            href, ready = state
            if href.startswith("chrome-error:"):
                raise BrowserError(f"{self.url} didn't load (network error, blocked or refused)")
            if href.startswith(("http://", "https://")) and ready == "complete":
                break
            if time.monotonic() > deadline:
                raise BrowserError(f"{self.url} didn't finish loading within {LOAD_TIMEOUT_S}s "
                                   f"(last seen: {href or 'nothing'}, {ready or 'no document'})")
            time.sleep(0.25)
        self.load_seconds = round(time.monotonic() - started, 2)
        time.sleep(self.settle_s)
        self.target = next((t for t in _json("/json/list") if t.get("id") == self.target["id"]), self.target)

    # the two jobs
    def evaluate(self, expression):
        return self.ws.evaluate(expression)

    def scroll(self, delta_y, steps=1, pause_s=0.15):
        """Wheel-scroll at the centre of the window, in `steps` events."""
        w, h = WINDOW
        for _ in range(steps):
            self.ws.wheel(delta_y, w // 2, h // 2)
            time.sleep(pause_s)

    # always close
    def close(self):
        report = {"chrome_exit": None, "killed": [], "leftover": [], "folder_removed": False}
        try:
            if self.ws:
                self.ws.close()
            if self.proc and self.proc.poll() is None:
                try:
                    if platform.system() == "Windows":
                        self.proc.terminate()
                    else:
                        os.killpg(self.proc.pid, signal.SIGTERM)
                    self.proc.wait(timeout=8)
                except (subprocess.TimeoutExpired, ProcessLookupError, PermissionError):
                    _kill(self.proc.pid)
                    try:
                        self.proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        pass
            if self.proc:
                report["chrome_exit"] = self.proc.poll()
            # anything else still holding the profile (renderers, crashpad, a stray Chrome)
            for _ in range(3):
                pids = processes_using(self.profile)
                if not pids:
                    break
                report["killed"] += pids
                for pid in pids:
                    _kill(pid)
                time.sleep(0.5)
            report["leftover"] = processes_using(self.profile)
            for _ in range(5):                              # Windows may hold files briefly
                shutil.rmtree(self.profile, ignore_errors=True)
                if not self.profile.exists():
                    break
                time.sleep(0.5)
            report["folder_removed"] = not self.profile.exists()
        finally:
            self.cleanup_report = report
            if self._locked:
                self._locked = False
                _ONE_AT_A_TIME.release()
        if report["leftover"] or not report["folder_removed"]:
            raise BrowserError(f"cleanup incomplete for {self.profile}: processes {report['leftover']}, "
                               f"folder removed: {report['folder_removed']}")
        return report


def _default_chrome():
    try:
        from teardown import find_chrome
        return find_chrome()
    except ImportError:
        return None


# ── self-test: python3 browser.py https://example.com [--headless] ──

if __name__ == "__main__":
    import sys
    target = next((a for a in sys.argv[1:] if not a.startswith("--")), "https://example.com")
    headless = "--headless" in sys.argv
    b = OwnedBrowser(target, headless=headless)
    with b:
        print(f"job        {b.job_id}  ({'headless' if headless else 'windowed'}, {WINDOW[0]}x{WINDOW[1]})")
        print(f"profile    {b.profile}  exists={b.profile.exists()}")
        print(f"chrome     pid {b.proc.pid}, processes using the profile: {len(processes_using(b.profile))}")
        print(f"title      {b.title!r}")
        print(f"loaded in  {b.load_seconds}s (launch to readyState complete), then {b.settle_s}s settle")
        before = b.evaluate("window.scrollY")
        b.scroll(400, steps=3)
        time.sleep(0.6)
        after = b.evaluate("window.scrollY")
        print(f"scrolled   wheel x3: scrollY {before} -> {after} "
              f"(page height {b.evaluate('document.documentElement.scrollHeight')})")
    r = b.cleanup_report
    print(f"closed     chrome exit code {r['chrome_exit']}; stragglers killed: {r['killed'] or 'none'}")
    print(f"proof      processes still using {b.profile.name}: {processes_using(b.profile) or 'none'}; "
          f"folder exists: {b.profile.exists()}")
