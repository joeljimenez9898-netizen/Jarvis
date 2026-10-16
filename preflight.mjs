#!/usr/bin/env node
// Preflight: run every LIVE chain end to end against the running galaxy.
//
//     node server.mjs        # in one terminal
//     node preflight.mjs     # in another
//
// No mocks. Every check makes real calls against the running server, the real files on
// disk, the real brain (Claude Code on your subscription) and a real browser. A pass means
// the chain works right now, not that its parts work in isolation.
//
// Exit code is non-zero if anything fails. "Done" means this prints 0 fail.
//
// Adding a check: add check("what it proves", async () => ...) and throw Fail(...) or
// Warn(...), or return a short detail string for a pass. Checks run in the order they
// appear in this file. Share state through CTX.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as build from "./build.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.PREFLIGHT_BASE || "http://127.0.0.1:4700";
const BASE_HOST = BASE.split("//")[1];
const CONFIG = path.join(ROOT, "config.json");
const VIEWER = path.join(ROOT, "viewer");

const CTX = {};          // state shared between checks
const CHECKS = [];
class Fail extends Error {}
class Warn extends Error {}
const check = (name, fn) => CHECKS.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── helpers ─────────────────────────────────────────────────────────

/** Real HTTP against the running server, the path sent byte for byte. Returns {status, headers, body}. */
function request(method, p, { body = null, headers = {}, timeoutS = 20 } = {}) {
  const [hostname, port] = BASE_HOST.split(":");
  const data = body === null ? null : Buffer.from(JSON.stringify(body));
  const hdrs = { Host: BASE_HOST, ...(method === "POST" ? { Origin: BASE } : {}),
                 ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}), ...headers };
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname, port: Number(port || 80), method, path: p, headers: hdrs, timeout: timeoutS * 1000,
                               insecureHTTPParser: true }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", (e) => {
      if (e.code === "ECONNREFUSED") reject(new Fail(`server not reachable at ${BASE} (${e.code}). Is node server.mjs running?`));
      else if (e.code === "ECONNRESET" || e.message === "socket hang up") resolve({ status: 0, headers: {}, body: Buffer.alloc(0) });
      else reject(new Fail(`server not reachable at ${BASE} (${e.message})`));
    });
    if (data) req.write(data);
    req.end();
  });
}
const get = (p, opts) => request("GET", p, opts);

async function postJson(p, body, timeoutS = 20) {
  const r = await request("POST", p, { body, timeoutS });
  try { return [r.status, JSON.parse(r.body.toString("utf8") || "{}")]; }
  catch { throw new Fail(`${p} returned non-JSON (HTTP ${r.status}): ${r.body.toString("utf8").slice(0, 120)}`); }
}

function loadConfig() {
  if (!("config" in CTX)) {
    if (!fs.existsSync(CONFIG)) CTX.config = {};      // optional now: there is no key to keep
    else {
      try { CTX.config = JSON.parse(fs.readFileSync(CONFIG, "utf8")); }
      catch (e) { throw new Fail(`config.json is not valid JSON: ${e.message}`); }
    }
  }
  return CTX.config;
}

function parseGraph(raw) {
  const text = raw.toString("utf8");
  if (!text.includes("const GRAPH")) throw new Fail("graph-data.js has no `const GRAPH` (run node build.mjs)");
  return JSON.parse(text.slice(text.indexOf("=") + 1).trim().replace(/;$/, ""));
}

function codeSha() {             // same recipe as server.mjs CODE_SHA
  const files = ["server.mjs", "build.mjs", "teardown.mjs", "browser.mjs", "evidence.mjs"];
  return crypto.createHash("sha256").update(Buffer.concat(files.map((f) => path.join(ROOT, f))
    .filter((p) => fs.existsSync(p)).map((p) => fs.readFileSync(p)))).digest("hex").slice(0, 16);
}

const notePath = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

// ── the checks, in order ────────────────────────────────────────────

check("Server is up and serving the viewer", async () => {
  const r = await get("/");
  if (r.status !== 200) throw new Fail(`GET / returned HTTP ${r.status}`);
  if (!String(r.headers["content-type"] || "").includes("text/html")) throw new Fail(`GET / is ${r.headers["content-type"]}, not HTML`);
  if (!r.body.includes("<title>Knowledge Galaxy</title>")) throw new Fail("GET / is not the galaxy viewer (title missing)");
  const boot = await get("/api/boot");
  if (boot.status !== 200) throw new Fail(`/api/boot returned HTTP ${boot.status}`);
  CTX.boot = JSON.parse(boot.body);
  return `${BASE} serves the viewer (${r.body.length.toLocaleString("en-US")} bytes)`;
});

check("Graph data loads and has notes", async () => {
  const r = await get("/graph-data.js");
  if (r.status !== 200) throw new Fail(`/graph-data.js returned HTTP ${r.status} (run node build.mjs)`);
  const graph = parseGraph(r.body);
  const nodes = graph.nodes || [], links = graph.links || [];
  if (!nodes.length) throw new Fail("graph has 0 nodes");
  const badIds = nodes.map((n, i) => (n.id !== i ? i : null)).filter((i) => i !== null);
  if (badIds.length) throw new Fail(`node id != array index at ${badIds.slice(0, 5)} (later lookups by index will be wrong)`);
  const badLinks = links.filter((l) => !(l.source >= 0 && l.source < nodes.length && l.target >= 0 && l.target < nodes.length));
  if (badLinks.length) throw new Fail(`${badLinks.length} links point outside the nodes array, e.g. ${JSON.stringify(badLinks[0])}`);
  CTX.graph = graph;
  const missing = nodes.filter((n) => !fs.existsSync(notePath(n.path))).map((n) => n.path);
  if (missing.length) throw new Warn(`${nodes.length} nodes, but ${missing.length} note files are gone from disk, e.g. ${missing[0]} (re-run node build.mjs)`);
  return `${nodes.length} notes, ${links.length} links`;
});

check("Brain: Claude Code is installed and signed in to your subscription (one real call)", async () => {
  CTX.brainOk = false;
  const server = await import("./server.mjs");
  const cmd = server.findClaude();
  if (!cmd) throw new Fail("Claude Code isn't installed: npm install -g @anthropic-ai/claude-code, then run claude and /login");
  const args = server.brainArgs("low", null);
  if (args.includes("--bare")) throw new Fail("the brain is started with --bare, which needs an API key");
  if ("ANTHROPIC_API_KEY" in server.brainEnv()) throw new Fail("ANTHROPIC_API_KEY would reach the brain; it must use the subscription");
  let reply;
  try {
    reply = await server.callModel("Reply with exactly the word: ready", { system: "You follow instructions exactly.", timeoutS: 120 });
  } catch (e) {
    throw new Fail(e.message);
  }
  if (!/ready/i.test(reply)) throw new Fail(`Claude Code answered, but not as asked: ${JSON.stringify(reply.slice(0, 80))}`);
  CTX.brainOk = true;
  if (loadConfig().anthropic_api_key) throw new Warn("the brain answers, but config.json still holds an anthropic_api_key; nothing uses it now, delete it");
  return `${cmd} answered on the subscription (no API key in its environment, no --bare)`;
});

check("Model choice is reachable", async () => {
  const model = String(loadConfig().model || "").trim();
  if (!model) return "no \"model\" in config.json: Claude Code's own default is used";
  if (!CTX.brainOk) throw new Fail(`can't check model '${model}': the brain isn't answering`);
  const server = await import("./server.mjs");
  try {
    await server.callModel("Reply with exactly the word: ready", { system: "You follow instructions exactly.", timeoutS: 120 });
  } catch (e) {
    throw new Fail(`model '${model}': ${e.message}`);
  }
  return `'${model}' answers`;
});

check("/chat answers a real question with a nodes array", async () => {
  const nodes = CTX.graph?.nodes || [];
  if (!nodes.length) throw new Fail("no graph to ask about");
  const candidates = nodes.filter((n) => n.group !== "captures");
  const note = (candidates.length ? candidates : nodes).reduce((a, b) => ((b.degree || 0) > (a.degree || 0) ? b : a));
  const [status, data] = await postJson("/chat", { question: `What do my notes say about ${note.label}?` }, 200);
  if (status !== 200 || data.error) throw new Fail(`HTTP ${status}: ${data.error || JSON.stringify(data)}`);
  const answer = data.answer, cited = data.nodes;
  if (typeof answer !== "string" || !answer.trim()) throw new Fail(`answer is empty or not a string: ${JSON.stringify(answer)}`);
  if (!Array.isArray(cited) || !cited.every((i) => Number.isInteger(i) && i >= 0 && i < nodes.length)) {
    throw new Fail(`nodes is not a list of valid indexes: ${JSON.stringify(cited)}`);
  }
  if (typeof data.about_notes !== "boolean") throw new Fail(`about_notes missing or not a bool: ${JSON.stringify(data.about_notes)}`);
  if (!cited.length) throw new Warn(`answered "${answer.slice(0, 60)}…" but cited no notes for a question about '${note.label}'`);
  return `"${answer.slice(0, 70)}${answer.length > 70 ? "…" : ""}" cited: ${cited.slice(0, 3).map((i) => nodes[i].label).join(", ")}`;
});

/** Take a probe note back out: graph entry, links, degrees, file. Returns a problem or "". */
async function removeTestNote(index, label, file, captures, capturesExisted) {
  try {
    const graph = build.readGraph();
    const nodes = graph.nodes;
    if (index !== nodes.length - 1 || nodes[index].label !== label) {
      return `note ${index} '${label}' is no longer the last node (something was added after it); remove ${file} and re-run node build.mjs`;
    }
    for (const link of graph.links) {
      if (link.source === index || link.target === index) {
        const other = link.source === index ? link.target : link.source;
        nodes[other].degree = Math.max(0, nodes[other].degree - 1);
      }
    }
    graph.links = graph.links.filter((l) => l.source !== index && l.target !== index);
    nodes.pop();
    build.writeGraph(nodes, graph.links);
    fs.rmSync(file, { force: true });
    if (!capturesExisted && fs.existsSync(captures) && !fs.readdirSync(captures).length) fs.rmdirSync(captures);
  } catch (e) {
    return `cleanup failed (${e.message}); remove ${file} and re-run node build.mjs`;
  }
  const [, recall] = await postJson("/api/recall", { question: `what is the ${label} probe` });
  if ((recall.notes || []).some((n) => n.label === label)) return `'${label}' is still in the server's search index after removal`;
  return "";
}

check("/remember writes a real file that /chat can retrieve at once", async () => {
  const token = "zq" + crypto.randomBytes(3).toString("hex");      // a word no real note contains
  const text = `remember that preflight probe ${token} verifies the capture chain`;
  const nd = loadConfig().notes_dir ? path.resolve(String(loadConfig().notes_dir)) : path.join(ROOT, "notes");
  const captures = path.join(nd, "captures");
  const capturesExisted = fs.existsSync(captures);
  const [status, data] = await postJson("/remember", { text }, 30);
  if (status !== 200 || !data.ok) throw new Fail(`/remember failed (HTTP ${status}): ${data.answer || data.error || JSON.stringify(data)}`);
  const index = data.index, label = data.node.label, file = notePath(data.path);
  const steps = [], problems = [];
  try {
    // 1. a real file, with the words and today's date in it
    if (!fs.existsSync(file)) throw new Fail(`/remember said ok but ${file} doesn't exist`);
    const content = fs.readFileSync(file, "utf8");
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!content.includes(token) || !content.includes(today)) throw new Fail(`${path.basename(file)} is missing the captured words or today's date (${today})`);
    steps.push("file written");

    // 2. in the live index: exactly what /chat would send for the next question
    const [rs, recall] = await postJson("/api/recall", { question: `what is the ${token} probe` });
    const sent = (recall.notes || []).map((n) => n.index);
    if (rs !== 200) throw new Fail(`written, but /api/recall returned HTTP ${rs}: ${recall.error || ""} (old server? restart node server.mjs)`);
    if (!sent.length || sent[0] !== index) throw new Fail(`written but not retrievable: /chat would send ${JSON.stringify(sent.slice(0, 3))} instead of ${index}`);
    steps.push("ranked first for the next question");

    // 3. the real /chat cites it
    if (!CTX.brainOk) problems.push("/chat leg not run: the brain isn't answering");
    else {
      const [cs, chat] = await postJson("/chat", { question: `What does my ${token} probe note say?` }, 200);
      if (cs !== 200 || chat.error) problems.push(`/chat failed: ${chat.error || cs}`);
      else if (!(chat.nodes || []).includes(index)) problems.push(`/chat answered but didn't cite the new note (${JSON.stringify(chat.nodes)})`);
      else steps.push("/chat cited it");
    }
  } finally {
    const cleanup = await removeTestNote(index, label, file, captures, capturesExisted);
    if (cleanup) throw new Fail(`TEST NOTE LEFT BEHIND: ${cleanup}`);
  }
  if (problems.length) throw new Fail([...steps, ...problems].join("; "));
  return steps.join("; ") + "; test note removed";
});

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.isFile()) out.push(full);
  }
  return out.sort();
}

check("Files the browser is served match the files on disk", async () => {
  const stale = [], noStore = [];
  let compared = 0;
  for (const f of walk(VIEWER)) {
    if (f.endsWith(".tmp")) continue;
    const rel = path.relative(VIEWER, f).split(path.sep).join("/");
    const r = await get("/" + rel.split("/").map(encodeURIComponent).join("/"));
    compared++;
    if (r.status !== 200) stale.push(`${rel} (HTTP ${r.status})`);
    else if (!r.body.equals(fs.readFileSync(f))) stale.push(`${rel} (served ${r.body.length} bytes, disk has ${fs.statSync(f).size})`);
    if (!String(r.headers["cache-control"] || "").includes("no-store")) noStore.push(rel);
  }
  if (stale.length) throw new Fail("served file differs from disk: " + stale.join("; "));
  const running = CTX.boot?.code, onDisk = codeSha();
  if (running !== onDisk) throw new Fail(`the server process is running old code (fingerprint ${running || "missing"}, disk has ${onDisk}). Restart node server.mjs.`);
  if (noStore.length) throw new Warn(`${compared} files match, but these lack Cache-Control: no-store: ${noStore.join(", ")}`);
  return `${compared} viewer files byte-identical; server code is current (${running})`;
});

check("config.json is NOT reachable from the browser", async () => {
  const cfg = loadConfig();
  const secrets = [...Object.values(cfg).filter((v) => typeof v === "string" && v.length >= 8), "claude_cmd", "notes_dir"]
    .map((s) => Buffer.from(s));
  const probes = ["/config.json", "/../config.json", "/%2e%2e/config.json", "/%2E%2E%2Fconfig.json",
                  "/..%2fconfig.json", "//config.json", "/./config.json", "/viewer/../config.json",
                  "/config.json%00.js", "/CONFIG.JSON", "/config.example.json/../config.json",
                  "/server.mjs", "/../server.mjs", "/.git/config", "/../.git/config"];
  const leaks = [], dropped = [];
  for (const p of probes) {
    const r = await get(p);
    if (r.status === 0) dropped.push(p);
    if (r.status === 200 && secrets.some((s) => r.body.includes(s))) leaks.push(`${p} -> HTTP 200 WITH CONFIG CONTENTS`);
    else if (r.status === 200 && /(\.mjs|\.py|config)$/.test(p)) leaks.push(`${p} -> HTTP 200 (server source or git config exposed)`);
    else if (r.status === 200 && p.includes("config")) leaks.push(`${p} -> HTTP 200`);
  }
  if (fs.existsSync(path.join(VIEWER, "config.json"))) leaks.push("viewer/config.json EXISTS: everything in viewer/ is public");
  // DNS-rebinding guard: a foreign Host header must be refused.
  if ((await get("/", { headers: { Host: "evil.example" } })).status === 200) {
    leaks.push("a request with Host: evil.example was served (DNS rebinding guard is off)");
  }
  if (leaks.length) {
    const bar = "!".repeat(66);
    throw new Fail(`\n      ${bar}\n      !!  YOUR CONFIG OR SERVER FILES ARE EXPOSED TO THE BROWSER        !!\n      ${bar}\n      ` + leaks.join("\n      "));
  }
  if (dropped.length) throw new Warn(`nothing leaked, but the server dropped the connection on ${dropped.join(", ")} instead of answering`);
  return `${probes.length} traversal probes refused; foreign Host refused`;
});

/** Playwright, if it is installed anywhere this machine's npm can see. Optional. */
function findPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require("playwright"); } catch { /* try the global root */ }
  try {
    const root = execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], { encoding: "utf8", timeout: 15000, shell: process.platform === "win32" }).trim();
    return createRequire(path.join(root, "noop.js"))("playwright");
  } catch { return null; }
}

check("?mute=1 tab is silent: the one speak gate refuses", async () => {
  // 1. Static: exactly one call into the speech engine, behind the mute check.
  const js = fs.readFileSync(path.join(VIEWER, "voice.js"), "utf8");
  const html = fs.readFileSync(path.join(VIEWER, "index.html"), "utf8");
  const calls = ((js + html).match(/\.speak\(\s*u\s*\)|speechSynthesis\.speak\(|synth\.speak\(/g) || []).length;
  const gate = /function utter\(u\) \{\s*if \(MUTED\) return false;/.test(js);
  const flag = /URLSearchParams\(location\.search\)\.get\("mute"\) === "1"/.test(js);
  if (calls !== 1 || !gate || !flag) {
    throw new Fail(`speech is not behind one gate: ${calls} engine calls, mute check first in utter(): ${gate}, ?mute=1 read from the URL: ${flag}`);
  }
  // 2. Live: a real browser, the real page, the real speech engine spied on (not replaced).
  const pw = findPlaywright();
  if (!pw) throw new Warn("one gate verified in source; live browser check skipped (npm install -g playwright)");
  const spy = `(() => { window.__engineCalls = 0;
    const real = speechSynthesis.speak.bind(speechSynthesis);
    speechSynthesis.speak = u => { window.__engineCalls++; return real(u); }; })()`;
  let browser;
  try {
    const exe = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
    browser = await pw.chromium.launch(exe && fs.statSync(exe).isFile() ? { executablePath: exe } : {});
  } catch (e) {
    throw new Warn(`one gate verified in source; couldn't start a browser (${String(e.message).split("\n")[0]})`);
  }
  let mutedCalls, refused, controlCalls;
  try {
    const muted = await browser.newPage();
    await muted.addInitScript(spy);
    await muted.goto(BASE + "/?mute=1", { waitUntil: "domcontentloaded" });
    await muted.waitForFunction("window.Voice && Voice.MUTED === true", null, { timeout: 10000 });
    await muted.mouse.click(5, 5);                   // the gesture that unlocks audio
    refused = await muted.evaluate(() => { const u = new SpeechSynthesisUtterance("preflight"); u.volume = 0; return Voice.utter(u); });
    await muted.evaluate(() => Voice.speak("preflight mute test"));
    await muted.waitForTimeout(800);
    mutedCalls = await muted.evaluate("window.__engineCalls");
    // Control: the same spy in an unmuted tab must see the call, or the test proves nothing.
    const control = await browser.newPage();
    await control.addInitScript(spy);
    await control.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await control.waitForFunction("window.Voice && Voice.MUTED === false", null, { timeout: 10000 });
    await control.evaluate(() => { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; Voice.utter(u); speechSynthesis.cancel(); });
    controlCalls = await control.evaluate("window.__engineCalls");
  } finally {
    await browser.close();
  }
  if (mutedCalls || refused !== false) throw new Fail(`?mute=1 tab reached the speech engine ${mutedCalls} time(s)`);
  if (controlCalls < 1) throw new Fail("the spy saw nothing in an unmuted tab either, so the mute result proves nothing");
  return "muted tab: 0 engine calls after a click, speak() and utter(); unmuted control: reached the engine";
});

check("Teardown bay: REA ready and pinned", async () => {
  const r = await get("/teardown/diag");
  if (r.status !== 200) throw new Fail(`/teardown/diag returned HTTP ${r.status}`);
  const d = JSON.parse(r.body);
  CTX.bay = d;
  const rea = d.rea || {};
  if (rea.installed && rea.installed !== rea.pinned) throw new Fail(`REA ${rea.installed} is installed but Jarvis is pinned to ${rea.pinned}: ${d.fix}`);
  if (!d.ready) throw new Warn("bay not ready (Jarvis still works without it): " + (d.problems || []).join(" "));
  return `REA ${rea.installed} (pinned ${rea.pinned}), Node ${d.node?.version}, Chrome: ${d.chrome?.path}`;
});

check("Teardown kit offline checks: addresses, fingerprints, attribution, containment", async () => {
  const kit = await import("./kitcheck.mjs");
  const results = await kit.run();
  const failed = results.filter(([, ok]) => ok === false).map(([n, , d]) => `${n}: ${d}`);
  const skipped = results.filter(([, ok]) => ok === null).map(([n, , d]) => `${n}: ${d}`);
  if (failed.length) throw new Fail(failed.join("; "));
  if (skipped.length) throw new Warn(skipped.join("; "));
  return `${results.length} offline checks pass`;
});

check("Teardown endpoints refuse anything outside the teardowns folder", async () => {
  const secrets = [...Object.values(loadConfig()).filter((v) => typeof v === "string" && v.length >= 8)].map((s) => Buffer.from(s));
  const probes = ["/api/teardowns/note?index=../config.json", "/api/teardowns/snapshot?index=../config.json",
                  "/api/teardowns/note?index=..%2F..%2Fconfig.json", "/api/teardowns/snapshot?index=-1",
                  "/api/teardowns/note?index=0", "/api/teardowns/../../config.json",
                  "/api/teardowns/%2e%2e/%2e%2e/config.json", "/teardown/job?id=../../config.json"];
  const leaks = [];
  for (const p of probes) {
    const r = await get(p);
    const leaked = secrets.some((s) => r.body.includes(s));
    if (r.status === 200 || leaked) leaks.push(`${p} -> HTTP ${r.status}${leaked ? " WITH CONFIG CONTENTS" : ""}`);
  }
  if (leaks.length) throw new Fail("!!! TEARDOWN ENDPOINTS SERVED SOMETHING THEY SHOULDN'T: " + leaks.join("; "));
  return `${probes.length} traversal attempts refused (400/404), nothing leaked`;
});

check("Teardown law: off-limits targets are refused", async () => {
  const offLimits = ["file:///etc/passwd", "javascript:alert(1)", "http://192.168.1.1/",
                     "http://169.254.169.254/latest/meta-data", "https://user:pw@example.com",
                     "ftp://example.com", "http://0.0.0.0:8080", "http://[::ffff:10.0.0.1]/"];
  const letThrough = [];
  for (const url of offLimits) {
    const [, data] = await postJson("/teardown", { url }, 30);
    if (data.ok || data.action?.line !== "refused") letThrough.push(`${url} -> ${data.answer || JSON.stringify(data)}`);
  }
  if (letThrough.length) throw new Fail("NOT refused: " + letThrough.join("; "));
  const teardown = await import("./teardown.mjs");
  const acting = ["capture-browser-scenario", "capture-electron-scenario", "capture-native-ui-scenario",
                  "debug-with-gdb", "debug-with-rizin", "cutter-command", "execute-rizin-command",
                  "observe-web-session", "observe-web-execution", "capture-process"];
  const bad = acting.filter((c) => teardown.ALLOWED_COMMANDS.has(c));
  if (bad.length) throw new Fail(`teardown.mjs allows REA commands that act: ${bad}`);
  return `${offLimits.length} off-limits targets refused; REA limited to ${teardown.ALLOWED_COMMANDS.size} observation commands`;
});

/** Take preflight's notes back out: newest first, only if they're still the last nodes. */
export function removeBirths(births) {
  const problems = [];
  for (const b of [...births].reverse()) {
    const file = notePath(b.path);
    const graph = build.readGraph();
    const nodes = graph.nodes;
    if (b.index !== nodes.length - 1 || nodes.at(-1).label !== b.node.label) {
      problems.push(`TEST NOTE LEFT BEHIND: ${file} (not the last node any more; remove it and run node build.mjs)`);
      continue;
    }
    for (const link of graph.links) {
      if (link.source === b.index || link.target === b.index) {
        const other = link.source === b.index ? link.target : link.source;
        nodes[other].degree = Math.max(0, nodes[other].degree - 1);
      }
    }
    graph.links = graph.links.filter((l) => l.source !== b.index && l.target !== b.index);
    nodes.pop();
    build.writeGraph(nodes, graph.links);
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    for (const m of text.matchAll(/\]\((assets\/[^)]+)\)/g)) fs.rmSync(path.join(path.dirname(file), decodeURIComponent(m[1])), { force: true });
    fs.rmSync(file, { force: true });
    for (const d of [path.join(path.dirname(file), "assets"), path.dirname(file), path.dirname(path.dirname(file))]) {
      if (fs.existsSync(d) && ["assets", "teardowns", "captures", "concepts"].includes(path.basename(d)) && !fs.readdirSync(d).length) fs.rmdirSync(d);
    }
  }
  return problems;
}

/** The five steps are all there, and every line says who captured it. */
export function evidenceProblems(ev, folder) {
  const who = new Set(["REA", "Jarvis browser", "Jarvis scan of REA-captured code"]);
  const problems = [];
  if (ev.target?.by !== "REA") problems.push("1: no REA target");
  if (!ev.scripts?.length || ev.scripts.some((x) => x.by !== "REA")) problems.push("1: scripts missing or not attributed to REA");
  if (!Array.isArray(ev.routes) || (ev.loads || []).some((x) => x.by !== "REA")) problems.push("2: routes/loads missing or misattributed");
  if (ev.gpu?.by !== "Jarvis scan of REA-captured code") problems.push("2: GPU strings missing or misattributed");
  const png = path.join(folder, "screenshot.png");
  if (ev.screenshot?.by !== "REA" || !fs.existsSync(png) || fs.readFileSync(png).subarray(0, 4).toString("latin1") !== "\x89PNG") {
    problems.push("3: no decoded PNG screenshot from REA");
  }
  const a = ev.assets || {};
  if (a.by !== "Jarvis browser" || !a.files || (a.all || []).some((f) => f.by !== "Jarvis browser")) problems.push("4: asset log missing or misattributed");
  if ([...(ev.stack || []), ...(ev.other_banners || [])].some((r) => !who.has(r.by))) problems.push("5: fingerprint rows without attribution");
  return problems;
}

check("Teardown chain: evidence -> note with snapshot -> [[REA]] -> spoken; one at a time", async () => {
  if (!CTX.bay?.ready) throw new Warn("skipped: the bay isn't ready (see above)");
  const first = postJson("/teardown", { url: BASE + "/", question: "What is this page built with?", headless: true }, 900);
  await sleep(1500);
  const [, second] = await postJson("/teardown", { url: BASE + "/", headless: true }, 30);
  const [, data] = await first;
  const a = data.action || {}, births = data.births || [];
  const problems = [];
  if (!(second.answer || "").includes("already taking one apart")) problems.push(`a second teardown during the first wasn't refused: ${JSON.stringify(second.answer)}`);
  if (!births.length) throw new Fail(`no note was written: ${data.answer || JSON.stringify(data)}` + (problems.length ? "; " + problems.join("; ") : ""));
  const folder = a.evidence_dir || null;
  let brain = null;
  try {
    const note = notePath(births.at(-1).path);
    const text = fs.readFileSync(note, "utf8");
    const img = /!\[[^\]]*\]\((assets\/[^)]+\.png)\)/.exec(text);
    const imgFile = img ? path.join(path.dirname(note), decodeURIComponent(img[1])) : null;
    if (!imgFile || !fs.existsSync(imgFile) || fs.readFileSync(imgFile).subarray(0, 4).toString("latin1") !== "\x89PNG") {
      problems.push("snapshot not saved in assets/ or not embedded");
    }
    const graphNodes = parseGraph((await get("/graph-data.js")).body).nodes;
    if (!text.includes("[[REA]]") || (!births.some((b) => b.node.label === "REA") && !graphNodes.some((n) => n.label === "REA"))) {
      problems.push("no [[REA]] concept note to link to");
    }
    if (!text.includes("## Evidence") || !/`ev_[0-9a-f]{16,}`/.test(text)) problems.push("Evidence section or REA evidence ids missing");
    if (!(data.answer || "").trim()) problems.push("nothing to say aloud");
    if (folder && fs.existsSync(path.join(folder, "evidence.json"))) {
      problems.push(...evidenceProblems(JSON.parse(fs.readFileSync(path.join(folder, "evidence.json"), "utf8")), folder));
    }
    brain = a.analysed ? "analysed by the brain" : null;
    if (!brain) problems.push("brain leg not run: " + (data.answer || "no analysis"));
    else if (a.unsupported?.length) CTX.teardownFlags = a.unsupported;
  } finally {
    problems.push(...removeBirths(births));
    if (folder) fs.rmSync(folder, { recursive: true, force: true });
  }
  if (problems.length) throw new Fail(problems.join("; ") + ` (note, snapshot and ${births.length} node(s) were written and then removed)`);
  if (CTX.teardownFlags) throw new Warn(`note written, but claims not found in the evidence: ${JSON.stringify(CTX.teardownFlags)}`);
  return `${births.length} node(s) born (${births.map((b) => b.node.label).join(", ")}), snapshot embedded, ` +
         `[[REA]] linked, ${brain}; second request refused; test notes removed`;
});

check("Owned browser: a public page opens, loads, scrolls and closes clean", async () => {
  if (!CTX.bay?.ready) throw new Warn("skipped: the bay isn't ready");
  const browser = await import("./browser.mjs");
  const url = process.env.PREFLIGHT_PUBLIC_URL || "https://nodejs.org/en";
  const b = new browser.OwnedBrowser(url, { headless: true });
  let title, seconds, moved;
  try {
    await b.open();
    title = await b.title();
    seconds = b.loadSeconds;
    const y0 = await b.evaluate("window.scrollY");
    await b.scroll(400, 3);
    await sleep(800);
    moved = (await b.evaluate("window.scrollY")) - y0;
  } catch (e) {
    await b.close();
    if (/didn't load|didn't finish/.test(e.message)) throw new Warn(`couldn't reach ${url} (no internet? set PREFLIGHT_PUBLIC_URL): ${e.message}`);
    throw new Fail(e.message);
  }
  const r = await b.close();
  if (r.leftover?.length || !r.folder_removed) throw new Fail(`browser NOT cleaned up: ${JSON.stringify(r)}`);
  if (!(moved > 0)) throw new Warn(`'${title}' loaded in ${seconds}s but wheel scrolling didn't move it`);
  return `'${title}' loaded in ${seconds}s, wheel-scrolled ${moved}px, closed; profile deleted`;
});

check("No investigation Chrome running: no process holds a Jarvis profile, no profile folders remain", async () => {
  const browser = await import("./browser.mjs");
  const holders = browser.processesUsing(browser.PROFILES);
  const leftovers = fs.existsSync(browser.PROFILES) ? fs.readdirSync(browser.PROFILES) : [];
  if (holders.length || leftovers.length) {
    throw new Fail(`Chrome processes still using ${browser.PROFILES}: ${holders.join(", ") || "none"}; leftover profile folders: ${leftovers.join(", ") || "none"}`);
  }
  return `0 processes, 0 folders in ${browser.PROFILES}`;
});

// ── runner ──────────────────────────────────────────────────────────

async function main() {
  const tty = process.stdout.isTTY;
  const paint = (c, s) => (tty ? `\x1b[${c}m${s}\x1b[0m` : s);
  const marks = { pass: paint("32", "✓"), fail: paint("31;1", "✗"), warn: paint("33", "!") };
  const counts = { pass: 0, fail: 0, warn: 0 };
  console.log(`Preflight against ${BASE}\n`);
  for (const [name, fn] of CHECKS) {
    const started = Date.now();
    let detail, outcome;
    try { detail = (await fn()) || ""; outcome = "pass"; }
    catch (e) {
      outcome = e instanceof Fail ? "fail" : e instanceof Warn ? "warn" : "fail";
      detail = e instanceof Fail || e instanceof Warn ? e.message : `check crashed: ${e.name}: ${e.message}`;
    }
    counts[outcome]++;
    console.log(`  ${marks[outcome]} ${name}  ${paint("2", ((Date.now() - started) / 1000).toFixed(1) + "s")}`);
    if (detail) console.log(`      ${paint(outcome === "fail" ? "31" : "2", detail)}`);
  }
  const summary = `${counts.pass} pass, ${counts.fail} fail, ${counts.warn} warn`;
  console.log("\n" + paint(counts.fail ? "31;1" : "32;1", summary));
  return counts.fail ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main());
