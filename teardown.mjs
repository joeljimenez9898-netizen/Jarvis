// The teardown bay: lets Jarvis take a website apart with REA, by observation only.
//
// REA (Reverse Engineer Anything, github.com/morluto/rea, MIT, npm rea-agents) is
// installed OUTSIDE this project, pinned to one exact version:
//
//     mkdir -p ~/.jarvis-tools/rea && cd ~/.jarvis-tools/rea
//     npm install rea-agents@6.5.0 --save-exact --ignore-scripts
//
// Node standard library only. server.mjs imports this softly, so Jarvis boots without it.
//
// THE LAW
//   REA observes. It never clicks, types, logs in, or changes anything, and Jarvis never
//   points it at anything but websites the user may look at. Enforced here, not by convention:
//     * ALLOWED_COMMANDS: only REA's passive website commands can run. Debuggers, device
//       tools and scripted browser scenarios (which perform actions) are refused.
//     * checkUrl(): http(s) only; no credentials in the URL; no private-network, link-local
//       or cloud-metadata addresses. Loopback is allowed for the user's own projects.
//     * browser.mjs OwnedBrowser: Chrome with a fresh throwaway profile per job (no cookies,
//       no logins, no extensions), loopback DevTools only, always closed and deleted.
//       The only input ever sent is mouse-wheel scrolling; no clicks, no typing.
import { spawn, spawnSync } from "node:child_process";
import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const PINNED_REA = "6.5.0";
const TOOLS = (process.env.JARVIS_TOOLS || "~/.jarvis-tools").replace(/^~(?=$|\/|\\)/, os.homedir());
export const REA_HOME = path.join(TOOLS, "rea");
export const REA_SCRIPT = path.join(REA_HOME, "node_modules", "rea-agents", "scripts", "rea.mjs");
export const EVIDENCE_DIR = path.join(REA_HOME, "evidence");     // screenshots and evidence.json, per job
export const INSTALL_CMD = `mkdir -p ~/.jarvis-tools/rea && cd ~/.jarvis-tools/rea && ` +
  `npm install rea-agents@${PINNED_REA} --save-exact --ignore-scripts`;

// rea-agents engines: ^22.19.0 || ^24.11.0 || >=26.0.0
export const NODE_RULE = "Node.js 22.19+ (22.x), 24.11+ (24.x) or 26+";

// The only REA commands Jarvis may run. All are passive website observation.
export const ALLOWED_COMMANDS = new Set([
  "list-browser-targets",     // which tabs exist
  "inspect-web-page",         // DOM, scripts, resources, requests: observed, not touched
  "analyze-web-bundle",       // static analysis of the scripts the page already loaded
  "capture-web-screenshot",   // one viewport image
  "discover-webmcp-tools",    // tools the page itself declares
]);
const REA_TIMEOUT_S = 120;

export class LawError extends Error {}        // refused: outside what REA may do or look at
export class Cancelled extends Error {}       // the user cancelled the teardown
export class NotReady extends Error {         // the bay is missing something; .fix says what
  constructor(fix) { super(fix); this.fix = fix; }
}

// ── finding things ────────────────────────────────────────────────

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

export function nodeOk(version) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(version || "");
  if (!m) return false;
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return (major === 22 && minor >= 19) || (major === 24 && minor >= 11) || major >= 26;
}

/** Expand one * in a path pattern (enough for the install folders below). */
function glob1(pattern) {
  const star = pattern.indexOf("*");
  if (star < 0) return [pattern];
  const dir = path.dirname(pattern.slice(0, star + 1));
  const before = path.basename(pattern.slice(0, star)), rest = pattern.slice(star + 1);
  const after = rest.split(path.sep)[0], tail = rest.slice(after.length);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => n.startsWith(before) && n.endsWith(after)).sort().reverse()
    .flatMap((n) => glob1(path.join(dir, n) + tail));
}

export function which(name) {
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd"] : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      if (dir && isFile(p)) return p;
    }
  }
  return null;
}

function nodeCandidates() {
  const home = os.homedir(), found = [];
  if (process.env.JARVIS_NODE) found.push(process.env.JARVIS_NODE);
  found.push(process.execPath);                         // the node running Jarvis right now
  const onPath = which("node");
  if (onPath) found.push(onPath);
  // Common install folders, for when the server starts without the user's shell PATH.
  const patterns = ["/opt/homebrew/bin/node", "/opt/homebrew/opt/node@*/bin/node", "/usr/local/bin/node",
    "/usr/local/opt/node@*/bin/node", "/usr/bin/node", "/opt/node*/bin/node",
    path.join(home, ".nvm/versions/node/*/bin/node"), path.join(home, ".volta/bin/node"),
    path.join(home, ".local/share/fnm/node-versions/*/installation/bin/node"),
    path.join(home, ".asdf/installs/nodejs/*/bin/node"), path.join(home, ".local/bin/node")];
  if (process.platform === "win32") {
    for (const base of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"],
                        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs")]) {
      if (base) patterns.push(path.join(base, "nodejs", "node.exe"));
    }
    for (const v of ["NVM_SYMLINK", "NVM_HOME"]) {
      if (process.env[v]) patterns.push(path.join(process.env[v], "node.exe"), path.join(process.env[v], "*", "node.exe"));
    }
  }
  for (const p of patterns) found.push(...glob1(p));
  const seen = new Set();
  return found.filter((p) => {
    let real;
    try { real = fs.realpathSync(p); } catch { return false; }
    if (seen.has(real) || !isFile(real)) return false;
    seen.add(real);
    return true;
  });
}

export function nodeVersion(p) {
  const out = spawnSync(p, ["--version"], { encoding: "utf8", timeout: 10000 });
  return out.status === 0 ? out.stdout.trim() : null;
}

/** {path, version, ok}: the first compatible node; else the first one found. */
export function findNode() {
  let first = null;
  for (const p of nodeCandidates()) {
    const version = nodeVersion(p);
    if (!version) continue;
    if (nodeOk(version)) return { path: p, version, ok: true };
    first = first || { path: p, version, ok: false };
  }
  return first || { path: null, version: null, ok: false };
}

/** Path to Google Chrome (or Chromium), or null. CHROME_PATH overrides. */
export function findChrome() {
  if (process.env.CHROME_PATH && isFile(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const home = os.homedir(), c = [];
  if (process.platform === "darwin") {
    for (const root of ["/Applications", path.join(home, "Applications")]) {
      c.push(`${root}/Google Chrome.app/Contents/MacOS/Google Chrome`, `${root}/Chromium.app/Contents/MacOS/Chromium`);
    }
  } else if (process.platform === "win32") {
    for (const v of ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]) {
      if (process.env[v]) c.push(path.join(process.env[v], "Google", "Chrome", "Application", "chrome.exe"));
    }
  } else {
    c.push(...["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].map(which));
    const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(home, ".cache/ms-playwright");
    c.push(...glob1(path.join(browsers, "chromium-*/chrome-linux/chrome")));
  }
  return c.find((p) => p && isFile(p)) || null;
}

export function installedRea() {
  try {
    return JSON.parse(fs.readFileSync(path.join(REA_HOME, "node_modules", "rea-agents", "package.json"), "utf8")).version;
  } catch { return null; }
}

// ── readiness ─────────────────────────────────────────────────────

export function diag() {
  const node = findNode(), rea = installedRea(), chrome = findChrome();
  const problems = [], fixes = [];
  if (!node.path) {
    problems.push(`Node.js was not found on the PATH or in the usual install folders. REA needs ${NODE_RULE}.`);
    fixes.push("install Node.js 24 LTS from nodejs.org");
  } else if (!node.ok) {
    problems.push(`Node.js ${node.version} at ${node.path} is too old or unsupported. REA needs ${NODE_RULE}.`);
    fixes.push(`upgrade Node.js (found ${node.version}; need ${NODE_RULE})`);
  }
  if (!rea) {
    problems.push(`REA is not installed in ${REA_HOME}.`);
    fixes.push(`install REA: ${INSTALL_CMD}`);
  } else if (rea !== PINNED_REA) {
    problems.push(`REA ${rea} is installed but Jarvis is pinned to ${PINNED_REA}.`);
    fixes.push(`reinstall the pinned REA: ${INSTALL_CMD}`);
  } else if (!isFile(REA_SCRIPT)) {
    problems.push(`REA ${rea} is installed but ${REA_SCRIPT} is missing.`);
    fixes.push(`reinstall REA: ${INSTALL_CMD}`);
  }
  if (!chrome) {
    problems.push("Google Chrome was not found. Website teardowns run in a clean Chrome.");
    fixes.push("install Google Chrome from google.com/chrome (or set CHROME_PATH)");
  }
  return {
    ready: problems.length === 0,
    rea: { installed: rea, pinned: PINNED_REA, home: REA_HOME },
    node: { version: node.version, path: node.path, supported: node.ok, required: NODE_RULE },
    chrome: { found: Boolean(chrome), path: chrome },
    problems, fix: fixes[0] || null,
    law: "Observe only: no clicks, typing, logins or changes. Websites you may look at only.",
  };
}

// ── the law ───────────────────────────────────────────────────────

/** The law's syntax half, no network: http(s) only, no credentials. Returns the URL. */
export function parseUrl(url) {
  url = String(url || "").trim();
  // "javascript:", "data:", "mailto:"... have a scheme but no "//"; "localhost:3000" doesn't.
  if (url && !url.includes("://") && !/^[A-Za-z][A-Za-z0-9+.-]*:(?!\d)/.test(url)) {
    const local = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:|\/|$)/.test(url);
    url = (local ? "http://" : "https://") + url;           // local dev servers are plain http
  }
  const scheme = (/^([A-Za-z][A-Za-z0-9+.-]*):/.exec(url) || [])[1];
  if (!scheme || !["http", "https"].includes(scheme.toLowerCase())) {
    throw new LawError(`only http and https websites, not ${scheme ? scheme.toLowerCase() : "that"}`);
  }
  let u;
  try { u = new URL(url); } catch { throw new LawError("that isn't a valid website address"); }
  if (u.username || u.password) throw new LawError("no logins: the address has credentials in it");
  if (!u.hostname) throw new LawError("that isn't a website address");
  return u.href;
}

const v4num = (ip) => ip.split(".").reduce((n, x) => n * 256 + Number(x), 0);
const inV4 = (ip, base, bits) => (v4num(ip) >>> 0) >>> (32 - bits) === (v4num(base) >>> 0) >>> (32 - bits);

/** {loopback, offLimits} for one IP address. */
export function classifyIp(ip) {
  ip = ip.replace(/^\[|\]$/g, "").toLowerCase();
  // IPv4 hiding inside IPv6, dotted (::ffff:10.0.0.1) or as URL() writes it (::ffff:a00:1)
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (mapped) ip = mapped[1];
  else if (hex) {
    const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
    ip = [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
  }
  if (net.isIPv4(ip)) {
    if (inV4(ip, "127.0.0.0", 8)) return { loopback: true, offLimits: false };
    const bad = [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["169.254.0.0", 16], ["172.16.0.0", 12],
                 ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4]];
    return { loopback: false, offLimits: bad.some(([b, n]) => inV4(ip, b, n)) };
  }
  if (net.isIPv6(ip)) {
    if (ip === "::1") return { loopback: true, offLimits: false };
    const first = parseInt(ip.split(":")[0] || "0", 16);
    const off = ip === "::" || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
    return { loopback: false, offLimits: off };
  }
  return { loopback: false, offLimits: true };
}

/** The whole law: syntax, then where the host actually resolves. Returns the URL. */
export async function checkUrl(url) {
  url = parseUrl(url);
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  let addrs;
  if (net.isIP(host)) addrs = [{ address: host }];
  else {
    try { addrs = await dns.lookup(host, { all: true }); }
    catch {
      // Behind an HTTPS proxy that resolves names itself (common in sandboxes), local DNS can
      // fail for real public sites. The proxy can't reach this machine's private network, and
      // the landed URL is checked again after loading.
      if (!(process.env.HTTPS_PROXY || process.env.https_proxy)) throw new LawError(`${host} doesn't resolve to anything`);
      return url;
    }
  }
  for (const { address } of addrs) {
    const c = classifyIp(address);
    if (c.loopback) continue;                                // the user's own projects on this machine
    if (c.offLimits) throw new LawError(`${host} is a private-network address (${address}), not a public website`);
  }
  return url;
}

/** Run one REA command and return its parsed JSON. Only ALLOWED_COMMANDS.
 *  `signal` (an AbortSignal) kills REA mid-run. */
export async function runRea(command, args = [], { timeout = REA_TIMEOUT_S, signal } = {}) {
  if (!ALLOWED_COMMANDS.has(command)) throw new LawError(`REA command '${command}' is not an observation command`);
  const info = diag();
  if (!info.ready) throw new NotReady(info.fix);
  if (signal?.aborted) throw new Cancelled();
  const node = info.node.path;
  const env = { PATH: [path.dirname(node), process.env.PATH || ""].join(path.delimiter), HOME: os.homedir() };
  for (const k of ["SYSTEMROOT", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA", "USERPROFILE"]) {
    if (process.env[k]) env[k] = process.env[k];
  }
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-rea-"));
  try {
    const { code, out, err, aborted, timedOut } = await new Promise((resolve) => {
      const child = spawn(node, [REA_SCRIPT, command, ...args, "--json"], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "", aborted = false, timedOut = false;
      child.stdout.on("data", (d) => { out += d; });
      child.stderr.on("data", (d) => { err += d; });
      const kill = () => { try { child.kill("SIGKILL"); } catch { /* gone */ } };
      const onAbort = () => { aborted = true; kill(); };
      signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => { timedOut = true; kill(); }, timeout * 1000);
      child.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve({ code, out, err, aborted, timedOut });
      });
      child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, out, err: String(e), aborted, timedOut }); });
    });
    if (aborted) throw new Cancelled();
    if (timedOut) throw new Error(`REA ${command} took longer than ${timeout}s`);
    let data;
    try { data = JSON.parse(out); }
    catch { throw new Error(`REA ${command} gave no JSON (exit ${code}): ${(err || out).trim().slice(-200)}`); }
    if (data && typeof data === "object" && (data.error || data.code === "VALIDATION_ERROR")) {
      throw new Error(`REA ${command}: ${data.message || data.error}`);
    }
    return data;
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

// ── one teardown ──────────────────────────────────────────────────

/** Observe one website. Returns {url, title, origin, summary, evidence, digest}.
 *  headless runs the same browser with no window (tests). step(name) reports progress:
 *  open, load, watch, read, snapshot, assets, stack. signal (AbortSignal) cancels.
 *  Throws LawError (refused), NotReady (missing tooling), Cancelled or Error (it broke). */
export async function teardown(url, { headless = false, step, signal } = {}) {
  url = parseUrl(url);                         // refuse the obviously off-limits first
  const info = diag();
  if (!info.ready) throw new NotReady(info.fix);   // then say what to install
  url = await checkUrl(url);                   // then where it really resolves
  const { OwnedBrowser } = await import("./browser.mjs");
  const evidence = await import("./evidence.mjs");

  const at = (name) => {
    if (signal?.aborted) throw new Cancelled();
    if (step) step(name);
  };
  const rea = (command, args, opts = {}) => runRea(command, args, { ...opts, signal });

  const page = new OwnedBrowser(url, { headless, chrome: info.chrome.path, onStep: at, signal });
  let ev;
  try {
    await page.open();
    await checkUrl(page.target.url || url);    // a redirect must not land somewhere off-limits
    ev = await evidence.capture(page, rea, path.join(EVIDENCE_DIR, page.jobId), at);
  } finally {
    await page.close();
  }
  const stack = ev.stack.filter((r) => ["3D engine", "animation", "smooth scroll", "visual effects"].includes(r.layer))
    .map((r) => (r.version ? `${r.name} ${r.version}` : r.name)).join(", ") || "nothing I recognise";
  const origin = new URL(ev.url).origin;
  const summary = {
    title: ev.title || origin, url: ev.url, origin,
    scripts: ev.scripts.length, resources: ev.rea_resources.length, dom_nodes: ev.rea_dom_nodes,
    assets: ev.assets.files, asset_bytes: ev.assets.bytes, stack, routes: ev.routes.length,
    load_seconds: ev.load_seconds, job_id: ev.job_id,
    evidence_dir: path.join(EVIDENCE_DIR, ev.job_id), screenshot: ev.screenshot.path,
  };
  return { url: summary.url, title: summary.title, origin, summary, evidence_id: ev.job_id, evidence: ev,
           digest: evidence.digest(ev) };
}
