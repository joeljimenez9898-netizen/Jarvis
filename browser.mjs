// The browser Jarvis owns for teardowns. Node standard library only.
// REA never opens a browser itself; it attaches to this one.
//
//   const b = new OwnedBrowser("https://example.com", { headless: true });
//   await b.open();  console.log(await b.title(), b.loadSeconds);
//   await b.scroll(800);  await b.close();
//
// CLEAN EVERY TIME  Each teardown gets a brand-new profile in ~/.jarvis-tools/rea/profiles/<job id>:
//                   never the user's everyday Chrome, cookies or logins, and no cache to make a
//                   heavy site look tiny.
// ALWAYS CLOSE      close() ends Chrome's process group, kills anything still using the profile
//                   path, deletes the folder, and verifies both. A crashed server's leftovers are
//                   swept at the next start (sweepOrphans).
// TWO JOBS ONLY     DevTools is used for Runtime.evaluate (read-only page facts) and
//                   Input.dispatchMouseEvent of type mouseWheel (wheel, not scrollTo, because
//                   smooth-scroll libraries listen to the wheel). DevTools refuses everything else.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { findChrome } from "./teardown.mjs";

export const CDP_PORT = 9333;                 // loopback only
export const WINDOW = [1280, 820];
const STARTUP_TIMEOUT_S = 25;                 // for /json/version to answer
const LOAD_TIMEOUT_S = 45;                    // for the page target and readyState "complete"
const INTRO_SETTLE_S = 2.5;                   // intro animations, after "complete"
const TOOLS = (process.env.JARVIS_TOOLS || "~/.jarvis-tools").replace(/^~(?=$|\/|\\)/, os.homedir());
export const PROFILES = path.join(TOOLS, "rea", "profiles");
const OWNER_FILE = "jarvis-owner.pid";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class BrowserError extends Error {}

// ── DevTools: read and scroll, nothing else ───────────────────────

const ALLOWED = new Set(["Runtime.evaluate", "Input.dispatchMouseEvent"]);
// Read-only means read-only: refuse expressions that obviously act on the page.
const ACTING = /\.click\s*\(|\.submit\s*\(|\.focus\s*\(|dispatchEvent|\bfetch\s*\(|XMLHttpRequest|sendBeacon|\bopen\s*\(|location\s*(\.\w+\s*)?=(?!=)|\.(assign|replace|reload)\s*\(|cookie\s*=(?!=)|setItem|removeItem|\.clear\s*\(|innerHTML\s*=(?!=)|\.value\s*=(?!=)|\.remove\s*\(|append(Child)?\s*\(|scrollTo|scrollBy|history\./;

export class DevTools {
  /** Connect to a page's webSocketDebuggerUrl (loopback only). */
  static async connect(wsUrl, timeoutMs = 10000) {
    const u = new URL(wsUrl);
    if (u.protocol !== "ws:" || !["127.0.0.1", "localhost"].includes(u.hostname)) {
      throw new BrowserError(`refusing a non-loopback DevTools socket: ${wsUrl}`);
    }
    const dt = new DevTools();
    dt.ws = new WebSocket(wsUrl);                 // Node's built-in client: masking, fragments, ping/pong
    dt.nextId = 0;
    dt.pending = new Map();
    dt.ws.onmessage = (m) => {
      let msg;
      try { msg = JSON.parse(typeof m.data === "string" ? m.data : Buffer.from(m.data).toString("utf8")); } catch { return; }
      const p = msg.id != null && dt.pending.get(msg.id);
      if (!p) return;                               // events and stray replies are skipped
      dt.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new BrowserError(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result || {});
    };
    dt.ws.onclose = () => {
      for (const p of dt.pending.values()) { clearTimeout(p.timer); p.reject(new BrowserError("DevTools connection closed")); }
      dt.pending.clear();
    };
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new BrowserError("DevTools didn't accept the connection")), timeoutMs);
      dt.ws.onopen = () => { clearTimeout(t); resolve(); };
      dt.ws.onerror = (e) => { clearTimeout(t); reject(new BrowserError(`DevTools connection failed: ${e.message || "error"}`)); };
    });
    return dt;
  }

  call(method, params = {}, timeoutMs = 30000) {
    if (!ALLOWED.has(method)) throw new BrowserError(`DevTools method '${method}' is not allowed (read and scroll only)`);
    if (method === "Input.dispatchMouseEvent" && params.type !== "mouseWheel") {
      throw new BrowserError("only mouseWheel events: Jarvis never clicks or moves the mouse");
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new BrowserError(`${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Read-only page facts, returned by value. */
  async evaluate(expression) {
    if (ACTING.test(expression)) throw new BrowserError("that expression would act on the page; evaluate is read-only");
    const r = await this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: false,
                                                    userGesture: false, silent: true });
    if (r.exceptionDetails) throw new BrowserError(`page fact failed: ${r.exceptionDetails.text}`);
    return r.result ? r.result.value : undefined;
  }

  wheel(deltaY, x, y) {
    return this.call("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY });
  }

  close() { try { this.ws.close(1000); } catch { /* already closed */ } }
}

// ── finding and killing what uses a profile ───────────────────────

/** PIDs whose command line mentions `p`. */
export function processesUsing(p) {
  p = String(p);
  const me = process.pid, pids = [];
  if (process.platform === "linux") {
    for (const entry of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(entry) || Number(entry) === me) continue;
      let cmd;
      try { cmd = fs.readFileSync(`/proc/${entry}/cmdline`).toString("utf8").replace(/\0/g, " "); } catch { continue; }
      if (cmd.includes(p)) pids.push(Number(entry));
    }
  } else if (process.platform === "darwin") {
    const out = spawnSync("ps", ["-axww", "-o", "pid=,command="], { encoding: "utf8" }).stdout || "";
    for (const line of out.split("\n")) {
      const m = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (m && Number(m[1]) !== me && m[2].includes(p)) pids.push(Number(m[1]));
    }
  } else if (process.platform === "win32") {
    const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${p.replace(/'/g, "''")}*' } | ForEach-Object { $_.ProcessId }`;
    const out = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" }).stdout || "";
    for (const x of out.split(/\s+/)) if (/^\d+$/.test(x) && Number(x) !== me) pids.push(Number(x));
  }
  return pids;
}

function kill(pid) {
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)]);
    else process.kill(pid, "SIGKILL");
  } catch { /* already gone */ }
}

/** True if the process that created this profile is still running (so it isn't an orphan). */
function ownerAlive(folder) {
  let pid;
  try { pid = Number(fs.readFileSync(path.join(folder, OWNER_FILE), "utf8").trim()); } catch { return false; }
  if (!pid) return false;
  if (pid === process.pid) return true;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

/** After a crash: kill anything still holding an investigation profile whose owner is dead,
 *  and delete those folders. Never touches the user's own Chrome. */
export async function sweepOrphans() {
  const report = { killed: [], removed: [] };
  if (!fs.existsSync(PROFILES)) return report;
  for (const name of fs.readdirSync(PROFILES)) {
    const folder = path.join(PROFILES, name);
    if (!fs.statSync(folder).isDirectory() || ownerAlive(folder)) continue;
    for (let i = 0; i < 3; i++) {
      const pids = processesUsing(folder);
      if (!pids.length) break;
      pids.forEach(kill);
      report.killed.push(...pids);
      await sleep(500);
    }
    fs.rmSync(folder, { recursive: true, force: true });
    if (!fs.existsSync(folder)) report.removed.push(name);
  }
  return report;
}

const getJson = async (p, timeoutMs = 2000) => {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}${p}`, { signal: AbortSignal.timeout(timeoutMs) });
  return res.json();
};
const strip = (h) => (h || "").toLowerCase().replace(/^www\./, "");
const sameSite = (host, want) => strip(host) === strip(want) || (host || "").toLowerCase().endsWith("." + strip(want));
const portInUse = () => new Promise((resolve) => {
  const s = net.connect({ host: "127.0.0.1", port: CDP_PORT });
  s.setTimeout(1000);
  s.on("connect", () => { s.destroy(); resolve(true); });
  s.on("error", () => resolve(false));
  s.on("timeout", () => { s.destroy(); resolve(false); });
});

// ── the owned browser ─────────────────────────────────────────────

let busy = false;                                 // the port is fixed, so teardowns take turns

export class OwnedBrowser {
  constructor(url, { headless = false, chrome, settleS = INTRO_SETTLE_S, onStep, signal } = {}) {
    this.url = url; this.headless = headless; this.settleS = settleS;
    this.chrome = chrome || findChrome();
    this.onStep = onStep || (() => {});
    this.signal = signal;
    const d = new Date(), pad = (n) => String(n).padStart(2, "0");
    this.jobId = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${crypto.randomBytes(3).toString("hex")}`;
    this.profile = path.join(PROFILES, this.jobId);
    this.proc = null; this.dt = null; this.target = null;
    this.loadSeconds = null; this.cleanupReport = null; this.locked = false;
  }

  get endpoint() { return `http://127.0.0.1:${CDP_PORT}`; }
  get targetId() { return this.target.id; }
  title() { return this.evaluate("document.title"); }

  async open() {
    if (!this.chrome) throw new BrowserError("Google Chrome was not found");
    if (busy) throw new BrowserError("another teardown is still using the browser");
    busy = this.locked = true;
    try {
      await this.launch();
    } catch (e) {
      try { await this.close(); } catch { /* the launch error matters more */ }
      throw e;
    }
    return this;
  }

  async launch() {
    await sweepOrphans();                         // crash leftovers only: owners that are dead
    if (await portInUse()) {
      throw new BrowserError(`something is already listening on port ${CDP_PORT} (another Chrome with remote debugging?). Close it and retry.`);
    }
    this.onStep("open");
    fs.mkdirSync(this.profile, { recursive: true });
    fs.writeFileSync(path.join(this.profile, OWNER_FILE), String(process.pid));
    const [w, h] = WINDOW;
    const args = [`--user-data-dir=${this.profile}`, `--remote-debugging-port=${CDP_PORT}`,
      "--remote-debugging-address=127.0.0.1", "--no-first-run", "--no-default-browser-check",
      "--disable-extensions", `--window-size=${w},${h}`, "--mute-audio",
      // an observation browser shouldn't phone home: no updates, sync or prefetch
      "--disable-background-networking", "--disable-component-update", "--disable-sync"];
    if (this.headless) {
      // Headless has no GPU; without software GL a 3D site would show its no-WebGL fallback
      // and the teardown would be of the wrong page. Windowed runs use the real GPU.
      args.push("--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader");
    }
    if (process.platform === "linux" && process.getuid && process.getuid() === 0) {
      args.push("--no-sandbox");                  // Chrome refuses to run as root otherwise
    }
    args.push(this.url);
    const started = Date.now();
    // detached: its own process group, so close() can end all of it
    this.proc = spawn(this.chrome, args, { stdio: "ignore", detached: process.platform !== "win32" });
    this.exited = null;
    this.proc.on("exit", (code) => { this.exited = code ?? -1; });
    this.proc.on("error", () => { this.exited = -1; });

    // 1. DevTools answers
    for (;;) {
      if (this.exited !== null) throw new BrowserError(`Chrome exited at startup (code ${this.exited})`);
      try { await getJson("/json/version"); break; } catch {
        if (Date.now() - started > STARTUP_TIMEOUT_S * 1000) throw new BrowserError(`Chrome's DevTools didn't answer within ${STARTUP_TIMEOUT_S}s`);
        await sleep(200);
      }
    }

    // 2. the page target for this site (www and redirects allowed)
    this.onStep("load");
    const want = new URL(this.url).hostname;
    const deadline = started + LOAD_TIMEOUT_S * 1000;
    for (;;) {
      const pages = (await getJson("/json/list")).filter((t) => t.type === "page");
      const real = pages.filter((t) => /^https?:\/\//.test(t.url || ""));
      const match = real.filter((t) => sameSite(new URL(t.url).hostname, want));
      if (match.length || real.length === 1) { this.target = (match.length ? match : real)[0]; break; }
      if (Date.now() > deadline) throw new BrowserError(`no page for ${want} appeared within ${LOAD_TIMEOUT_S}s (saw: ${pages.map((t) => t.url).join(", ")})`);
      await sleep(250);
    }

    // 3. a real http(s) document, complete, then the intro animation. A new tab starts as an
    //    empty about:blank that is already "complete"; Chrome's own error page is chrome-error://.
    this.dt = await DevTools.connect(this.target.webSocketDebuggerUrl);
    for (;;) {
      let href = "", ready = "";
      try { [href, ready] = (await this.dt.evaluate("[location.href, document.readyState]")) || ["", ""]; }
      catch (e) { if (/closed/.test(e.message)) throw e; }     // mid-navigation: context replaced
      if (href.startsWith("chrome-error:")) throw new BrowserError(`${this.url} didn't load (network error, blocked or refused)`);
      if (/^https?:\/\//.test(href) && ready === "complete") break;
      if (Date.now() > deadline) throw new BrowserError(`${this.url} didn't finish loading within ${LOAD_TIMEOUT_S}s (last seen: ${href || "nothing"}, ${ready || "no document"})`);
      await sleep(250);
    }
    this.loadSeconds = Math.round((Date.now() - started) / 10) / 100;
    await sleep(this.settleS * 1000);
    const fresh = (await getJson("/json/list")).find((t) => t.id === this.target.id);
    if (fresh) this.target = { ...this.target, ...fresh };
  }

  // the two jobs
  evaluate(expression) { return this.dt.evaluate(expression); }

  /** Wheel-scroll at the centre of the window, in `steps` events. */
  async scroll(deltaY, steps = 1, pauseS = 0.15) {
    const [w, h] = WINDOW;
    // Chrome acknowledges a wheel only after the renderer draws a frame, which on a heavy
    // WebGL page in software rendering can take seconds. Pace by the clock, not the ack:
    // send each wheel and move on (a late ack is simply dropped).
    for (let i = 0; i < steps; i++) {
      this.dt.wheel(deltaY, Math.floor(w / 2), Math.floor(h / 2)).catch(() => {});
      await sleep(pauseS * 1000);
    }
  }

  // always close
  async close() {
    const report = { chrome_exit: null, killed: [], leftover: [], folder_removed: false };
    try {
      if (this.dt) this.dt.close();
      if (this.proc && this.exited === null) {
        try {
          if (process.platform === "win32") this.proc.kill();
          else process.kill(-this.proc.pid, "SIGTERM");      // the whole group
        } catch { /* already gone */ }
        for (let i = 0; i < 80 && this.exited === null; i++) await sleep(100);
        if (this.exited === null) { kill(this.proc.pid); for (let i = 0; i < 50 && this.exited === null; i++) await sleep(100); }
      }
      if (this.proc) report.chrome_exit = this.exited;
      // anything else still holding the profile (renderers, crashpad, a stray Chrome)
      for (let i = 0; i < 3; i++) {
        const pids = processesUsing(this.profile);
        if (!pids.length) break;
        report.killed.push(...pids);
        pids.forEach(kill);
        await sleep(500);
      }
      report.leftover = processesUsing(this.profile);
      for (let i = 0; i < 5; i++) {                           // Windows may hold files briefly
        fs.rmSync(this.profile, { recursive: true, force: true });
        if (!fs.existsSync(this.profile)) break;
        await sleep(500);
      }
      report.folder_removed = !fs.existsSync(this.profile);
    } finally {
      this.cleanupReport = report;
      if (this.locked) { this.locked = false; busy = false; }
    }
    if (report.leftover.length || !report.folder_removed) {
      throw new BrowserError(`cleanup incomplete for ${this.profile}: processes ${report.leftover}, folder removed: ${report.folder_removed}`);
    }
    return report;
  }
}

// ── self-test: node browser.mjs https://example.com [--headless] ──
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const target = process.argv.slice(2).find((a) => !a.startsWith("--")) || "https://example.com";
  const b = new OwnedBrowser(target, { headless: process.argv.includes("--headless") });
  try {
    await b.open();
    console.log(`job        ${b.jobId}  (${b.headless ? "headless" : "windowed"}, ${WINDOW[0]}x${WINDOW[1]})`);
    console.log(`profile    ${b.profile}  exists=${fs.existsSync(b.profile)}`);
    console.log(`chrome     pid ${b.proc.pid}, processes using the profile: ${processesUsing(b.profile).length}`);
    console.log(`title      ${JSON.stringify(await b.title())}`);
    console.log(`loaded in  ${b.loadSeconds}s (launch to readyState complete), then ${b.settleS}s settle`);
    const before = await b.evaluate("window.scrollY");
    await b.scroll(400, 3);
    await sleep(600);
    const after = await b.evaluate("window.scrollY");
    console.log(`scrolled   wheel x3: scrollY ${before} -> ${after} (page height ${await b.evaluate("document.documentElement.scrollHeight")})`);
  } finally {
    await b.close();
  }
  const r = b.cleanupReport;
  console.log(`closed     chrome exit code ${r.chrome_exit}; stragglers killed: ${r.killed.length ? r.killed : "none"}`);
  console.log(`proof      processes still using ${b.jobId}: ${processesUsing(b.profile).length || "none"}; folder exists: ${fs.existsSync(b.profile)}`);
}
