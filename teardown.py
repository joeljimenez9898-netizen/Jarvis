"""The teardown bay: lets Jarvis take a website apart with REA, by observation only.

REA (Reverse Engineer Anything, github.com/morluto/rea, MIT, npm rea-agents) is
installed OUTSIDE this project, pinned to one exact version:

    mkdir -p ~/.jarvis-tools/rea && cd ~/.jarvis-tools/rea
    npm install rea-agents@6.5.0 --save-exact --ignore-scripts

Standard library only. server.py imports this softly, so Jarvis boots without it.

THE LAW
  REA observes. It never clicks, types, logs in, or changes anything, and Jarvis
  never points it at anything but websites the user may look at.
  Enforced here, not by convention:
    * ALLOWED_COMMANDS: only REA's passive website commands can run. Debuggers,
      device tools and scripted browser scenarios (which perform actions) are refused.
    * check_url(): http(s) only; no credentials in the URL; no private-network,
      link-local or cloud-metadata addresses. Loopback is allowed for the user's
      own projects running locally.
    * browser.OwnedBrowser: Chrome with a fresh throwaway profile per job (no cookies,
      no logins, no extensions), loopback DevTools only, always closed and deleted.
      The only input ever sent is mouse-wheel scrolling; no clicks, no typing.
"""
import glob
import ipaddress
import json
import os
import pathlib
import platform
import re
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request

PINNED_REA = "6.5.0"
REA_HOME = pathlib.Path(os.environ.get("JARVIS_TOOLS", "~/.jarvis-tools")).expanduser() / "rea"
REA_SCRIPT = REA_HOME / "node_modules" / "rea-agents" / "scripts" / "rea.mjs"
EVIDENCE_DIR = REA_HOME / "evidence"        # screenshots and evidence.json, one folder per job
INSTALL_CMD = (f"mkdir -p ~/.jarvis-tools/rea && cd ~/.jarvis-tools/rea && "
               f"npm install rea-agents@{PINNED_REA} --save-exact --ignore-scripts")

# rea-agents engines: ^22.19.0 || ^24.11.0 || >=26.0.0
NODE_RULE = "Node.js 22.19+ (22.x), 24.11+ (24.x) or 26+"

# The only REA commands Jarvis may run. All are passive website observation.
ALLOWED_COMMANDS = {
    "list-browser-targets",     # which tabs exist
    "inspect-web-page",         # DOM, scripts, resources, requests: observed, not touched
    "analyze-web-bundle",       # static analysis of the scripts the page already loaded
    "capture-web-screenshot",   # one viewport image
    "discover-webmcp-tools",    # tools the page itself declares
}

OBSERVE_MS = 1500           # how long REA watches
REA_TIMEOUT_S = 120


class LawError(Exception):
    """Refused: outside what REA is allowed to do or look at."""


class NotReady(Exception):
    """The bay is missing something. .fix is one short instruction."""
    def __init__(self, fix):
        super().__init__(fix)
        self.fix = fix


# ── finding things ────────────────────────────────────────────────

def _version_tuple(text):
    m = re.search(r"(\d+)\.(\d+)\.(\d+)", text or "")
    return tuple(int(x) for x in m.groups()) if m else None


def node_ok(version):
    v = _version_tuple(version)
    if not v:
        return False
    major, minor = v[0], v[1]
    return (major == 22 and minor >= 19) or (major == 24 and minor >= 11) or major >= 26


def _node_candidates():
    home = pathlib.Path.home()
    found = []
    if os.environ.get("JARVIS_NODE"):
        found.append(os.environ["JARVIS_NODE"])
    on_path = shutil.which("node")
    if on_path:
        found.append(on_path)
    # Common install folders, for when the server starts without the user's shell PATH.
    patterns = [
        "/opt/homebrew/bin/node", "/opt/homebrew/opt/node@*/bin/node", "/usr/local/bin/node",
        "/usr/local/opt/node@*/bin/node", "/usr/bin/node", "/opt/node*/bin/node",
        str(home / ".nvm/versions/node/*/bin/node"), str(home / ".volta/bin/node"),
        str(home / ".local/share/fnm/node-versions/*/installation/bin/node"),
        str(home / ".asdf/installs/nodejs/*/bin/node"), str(home / ".local/bin/node"),
    ]
    if platform.system() == "Windows":
        for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)"),
                     os.environ.get("LOCALAPPDATA") and os.path.join(os.environ["LOCALAPPDATA"], "Programs")):
            if base:
                patterns.append(os.path.join(base, "nodejs", "node.exe"))
        for var in ("NVM_SYMLINK", "NVM_HOME"):
            if os.environ.get(var):
                patterns += [os.path.join(os.environ[var], "node.exe"),
                             os.path.join(os.environ[var], "*", "node.exe")]
    for pattern in patterns:
        found.extend(sorted(glob.glob(pattern), reverse=True))
    seen, unique = set(), []
    for p in found:
        real = os.path.realpath(p)
        if real not in seen and os.path.isfile(real):
            seen.add(real)
            unique.append(p)
    return unique


def node_version(path):
    try:
        out = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=10)
        return out.stdout.strip() if out.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def find_node():
    """(path, version, ok): the first compatible node; else the first one found."""
    first = None
    for path in _node_candidates():
        version = node_version(path)
        if not version:
            continue
        if node_ok(version):
            return path, version, True
        first = first or (path, version, False)
    return first or (None, None, False)


def find_chrome():
    """Path to Google Chrome (or Chromium), or None. CHROME_PATH overrides."""
    if os.environ.get("CHROME_PATH") and os.path.isfile(os.environ["CHROME_PATH"]):
        return os.environ["CHROME_PATH"]
    system, home = platform.system(), pathlib.Path.home()
    candidates = []
    if system == "Darwin":
        for root in ("/Applications", str(home / "Applications")):
            candidates += [f"{root}/Google Chrome.app/Contents/MacOS/Google Chrome",
                           f"{root}/Chromium.app/Contents/MacOS/Chromium"]
    elif system == "Windows":
        for var in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
            if os.environ.get(var):
                candidates.append(os.path.join(os.environ[var], "Google", "Chrome", "Application", "chrome.exe"))
    else:
        candidates += [shutil.which(n) for n in ("google-chrome", "google-chrome-stable",
                                                 "chromium", "chromium-browser")]
        browsers = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", str(home / ".cache/ms-playwright"))
        candidates += sorted(glob.glob(os.path.join(browsers, "chromium-*/chrome-linux/chrome")), reverse=True)
    return next((c for c in candidates if c and os.path.isfile(c)), None)


def installed_rea():
    try:
        pkg = json.loads((REA_HOME / "node_modules" / "rea-agents" / "package.json").read_text())
        return pkg.get("version")
    except (OSError, json.JSONDecodeError):
        return None


# ── readiness ─────────────────────────────────────────────────────

def diag():
    node_path, node_ver, node_good = find_node()
    rea_ver = installed_rea()
    chrome = find_chrome()
    problems, fixes = [], []
    if not node_path:
        problems.append(f"Node.js was not found on the PATH or in the usual install folders. REA needs {NODE_RULE}.")
        fixes.append("install Node.js 24 LTS from nodejs.org")
    elif not node_good:
        problems.append(f"Node.js {node_ver} at {node_path} is too old or unsupported. REA needs {NODE_RULE}.")
        fixes.append(f"upgrade Node.js (found {node_ver}; need {NODE_RULE})")
    if not rea_ver:
        problems.append(f"REA is not installed in {REA_HOME}.")
        fixes.append(f"install REA: {INSTALL_CMD}")
    elif rea_ver != PINNED_REA:
        problems.append(f"REA {rea_ver} is installed but Jarvis is pinned to {PINNED_REA}.")
        fixes.append(f"reinstall the pinned REA: {INSTALL_CMD}")
    elif not REA_SCRIPT.is_file():
        problems.append(f"REA {rea_ver} is installed but {REA_SCRIPT} is missing.")
        fixes.append(f"reinstall REA: {INSTALL_CMD}")
    if not chrome:
        problems.append("Google Chrome was not found. Website teardowns run in a headless Chrome.")
        fixes.append("install Google Chrome from google.com/chrome (or set CHROME_PATH)")
    return {
        "ready": not problems,
        "rea": {"installed": rea_ver, "pinned": PINNED_REA, "home": str(REA_HOME)},
        "node": {"version": node_ver, "path": node_path, "supported": node_good, "required": NODE_RULE},
        "chrome": {"found": bool(chrome), "path": chrome},
        "problems": problems,
        "fix": fixes[0] if fixes else None,
        "law": "Observe only: no clicks, typing, logins or changes. Websites you may look at only.",
    }


# ── the law ───────────────────────────────────────────────────────

def parse_url(url):
    """The law's syntax half, no network: http(s) only, no credentials. Returns the URL."""
    url = (url or "").strip()
    # "javascript:", "data:", "mailto:"... have a scheme but no "//"; "localhost:3000" doesn't.
    if url and "://" not in url and not re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:(?!\d)", url):
        local = re.match(r"^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:|/|$)", url)
        url = ("http://" if local else "https://") + url     # local dev servers are plain http
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise LawError(f"only http and https websites, not {parts.scheme or 'that'}")
    try:
        parts.port
    except ValueError:
        raise LawError("that isn't a valid website address")
    if parts.username or parts.password:
        raise LawError("no logins: the address has credentials in it")
    if not parts.hostname:
        raise LawError("that isn't a website address")
    return urllib.parse.urlunsplit(parts)


def _is_ip(host):
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


def check_url(url):
    """The whole law: syntax, then where the host actually resolves. Returns the URL."""
    url = parse_url(url)
    parts = urllib.parse.urlsplit(url)
    host = parts.hostname
    try:
        infos = socket.getaddrinfo(host, parts.port or (443 if parts.scheme == "https" else 80))
    except socket.gaierror:
        # Behind an HTTPS proxy that resolves names itself (common in sandboxes), local DNS
        # can fail for real public sites. The proxy can't reach this machine's private
        # network, and the landed URL is checked again after loading.
        if _is_ip(host) or not (os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")):
            raise LawError(f"{host} doesn't resolve to anything")
        return url
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_loopback:
            continue                         # the user's own projects on this machine
        if ip.is_private or ip.is_link_local or ip.is_multicast or ip.is_unspecified or ip.is_reserved:
            raise LawError(f"{host} is a private-network address ({ip}), not a public website")
    return url


def run_rea(command, *args, timeout=REA_TIMEOUT_S):
    """Run one REA command and return its parsed JSON. Only ALLOWED_COMMANDS."""
    if command not in ALLOWED_COMMANDS:
        raise LawError(f"REA command {command!r} is not an observation command")
    info = diag()
    if not info["ready"]:
        raise NotReady(info["fix"])
    node = info["node"]["path"]
    env = {"PATH": os.pathsep.join([os.path.dirname(node), os.environ.get("PATH", "")]),
           "HOME": str(pathlib.Path.home())}
    for keep in ("SYSTEMROOT", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA", "USERPROFILE"):
        if os.environ.get(keep):
            env[keep] = os.environ[keep]
    with tempfile.TemporaryDirectory(prefix="jarvis-rea-") as cwd:
        done = subprocess.run([node, str(REA_SCRIPT), command, *args, "--json"], cwd=cwd, env=env,
                              capture_output=True, text=True, timeout=timeout)
    try:
        data = json.loads(done.stdout)
    except json.JSONDecodeError:
        raise RuntimeError(f"REA {command} gave no JSON (exit {done.returncode}): "
                           f"{(done.stderr or done.stdout).strip()[-200:]}")
    if isinstance(data, dict) and (data.get("error") or data.get("code") == "VALIDATION_ERROR"):
        raise RuntimeError(f"REA {command}: {data.get('message') or data.get('error')}")
    return data


# ── one teardown ──────────────────────────────────────────────────

def teardown(url, headless=False):
    """Observe one website. Returns {"url", "title", "origin", "summary", "evidence"}.
    headless=True runs the same browser with no window (tests).
    Raises LawError (refused), NotReady (missing tooling) or RuntimeError (it broke)."""
    url = parse_url(url)                     # refuse the obviously off-limits first
    info = diag()
    if not info["ready"]:
        raise NotReady(info["fix"])          # then say what to install
    url = check_url(url)                     # then where it really resolves
    from browser import OwnedBrowser
    import evidence
    with OwnedBrowser(url, headless=headless, chrome=info["chrome"]["path"]) as page:
        check_url(page.target.get("url", url))   # a redirect must not land somewhere off-limits
        ev = evidence.capture(page, run_rea, EVIDENCE_DIR / page.job_id)
    stack = ", ".join(f"{r['name']} {r['version']}" if r.get("version") else r["name"]
                      for r in ev["stack"] if r["layer"] in ("3D engine", "animation", "smooth scroll",
                                                             "visual effects")) or "nothing I recognise"
    summary = {
        "title": "", "url": ev["url"], "origin": "{0.scheme}://{0.netloc}".format(urllib.parse.urlsplit(ev["url"])),
        "scripts": len(ev["scripts"]), "resources": len(ev["rea_resources"]), "dom_nodes": ev["rea_dom_nodes"],
        "assets": ev["assets"]["files"], "asset_bytes": ev["assets"]["bytes"], "stack": stack,
        "routes": len(ev["routes"]), "load_seconds": ev["load_seconds"], "job_id": ev["job_id"],
        "evidence_dir": str(EVIDENCE_DIR / ev["job_id"]), "screenshot": ev["screenshot"]["path"],
    }
    summary["title"] = ev.get("title") or summary["origin"]
    return {"url": summary["url"], "title": summary["title"], "origin": summary["origin"],
            "summary": summary, "evidence_id": ev["job_id"], "evidence": ev, "digest": evidence.digest(ev)}
