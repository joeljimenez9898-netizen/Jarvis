#!/usr/bin/env node
// Offline checks for the teardown kit: fast, no browser, no network, the real code.
//
//     node kitcheck.mjs
//
// Used by preflight.mjs and drill.mjs. Each check returns [ok, detail]; ok null is a warning.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// spoken phrase -> the address it must become (null: must not start anything)
const ADDRESSES = [
  ["igloo dot inc",            "igloo.inc"],
  ["stripe.com slash pricing", "stripe.com/pricing"],
  ["localhost:5001",           "localhost:5001"],
  ["make it pop",              null],
  ["wikipedia.org",            "wikipedia.org"],      // keeps its first letter
];

const SYNTHETIC_CODE =
  "/**\n * @license\n * Copyright 2010-2024 Three.js Authors\n * SPDX-License-Identifier: MIT\n */\n" +
  "const e=\"165\";\"undefined\"!=typeof window&&(window.__THREE__=e);\n" +
  "/*!\n * GSAP 3.12.5\n * https://gsap.com\n */\n" +
  "console.warn(\"Requires GSAP 3.11.0 or later\");\n";     // a decoy: a warning, not a banner

function checkAddresses() {
  const { teardownIntent } = require(path.join(ROOT, "viewer", "intent.js"));   // the page's own parser
  const got = Object.fromEntries(ADDRESSES.map(([p]) => {
    const r = teardownIntent("tear down " + p);
    return [p, r ? r.url : null];
  }));
  const wrong = ADDRESSES.filter(([p, want]) => got[p] !== want)
    .map(([p, want]) => `'${p}' -> ${JSON.stringify(got[p])} (expected ${JSON.stringify(want)})`);
  return [!wrong.length, wrong.length ? wrong.join("; ") : ADDRESSES.map(([p]) => `'${p}' -> ${got[p] || "nothing"}`).join(", ")];
}

async function checkFingerprints() {
  const evidence = await import("./evidence.mjs");
  const [stack] = evidence.fingerprints([{ text: SYNTHETIC_CODE, url: "synthetic.js" }], {});
  const found = Object.fromEntries(stack.map((r) => [r.name, r.version]));
  const ok = found["Three.js"] === "r165" && found.GSAP === "3.12.5";
  return [ok, ok ? `Three.js ${found["Three.js"]}, GSAP ${found.GSAP} (the 'Requires GSAP 3.11.0' decoy ignored)`
                 : `expected Three.js r165 and GSAP 3.12.5, got ${JSON.stringify(found)}`];
}

function syntheticEvidence() {
  const REA = "REA", BR = "Jarvis browser", SCAN = "Jarvis scan of REA-captured code";
  return {
    url: "https://example.com/", title: "Example", job_id: "x", load_seconds: 1.2,
    runtime_globals: { by: BR, three: "165", height: 2400, images: 3, videos: 1, canvases: 1 },
    rea_dom_nodes: 412,
    scripts: [{ by: REA, url: "https://example.com/app.js", chars: 120000, module: true }],
    loads: [{ by: REA, from: "https://example.com/app.js", to: "https://example.com/c.js", how: "dynamic_import" }],
    routes: ["/", "/work"], endpoints: ["/api/x"],
    gpu: { by: SCAN, signals: [{ by: SCAN, meaning: "bloom", count: 1, names: ["BloomEffect"] }],
           custom_named: ["uTime"], effects: ["BloomEffect"] },
    stack: [{ by: SCAN, layer: "3D engine", name: "Three.js", version: "r165", file: "https://example.com/app.js",
              runtime: { by: BR, version: "r165" } }],
    rea_vendors: ["React"], other_banners: [{ by: SCAN, banner: "lil-gui", version: "0.19.1" }],
    assets: { by: BR, files: 4, bytes: 3000000,
              by_origin: { "https://example.com": { files: 2, bytes: 1000000 },
                           "https://cdn.example.net": { files: 2, bytes: 2000000 } },
              by_kind: { "3D models": { files: 1, bytes: 2000000, hidden: 0 },
                         scripts: { files: 3, bytes: 1000000, hidden: 1 } },
              largest: [{ by: BR, bytes: 2000000, kind: "3D models", url: "https://cdn.example.net/a.glb" }],
              notes: ["1 cross-origin files hide their size"] },
    screenshot: { by: REA, width: 1280, height: 628 },
    rea_limitations: ["Observation starts when REA attaches."],
  };
}

async function checkDigestAttribution() {
  const evidence = await import("./evidence.mjs");
  const digest = evidence.brainDigest(syntheticEvidence(), "How is it built?");
  const sources = ["[REA]", "[Jarvis browser]", "[Jarvis scan]"];
  const bad = [];
  let lines = 0;
  for (const block of digest.split("\n\n")) {
    const [title, ...rest] = block.split("\n");
    if (["SITE", "QUESTION", "LIMITS"].includes(title)) continue;   // the site, the ask, and statements about method
    for (const line of rest) {
      if (line.startsWith("…")) continue;
      lines++;
      if (!sources.some((s) => line.startsWith(s))) bad.push(`${title}: ${line.slice(0, 70)}`);
    }
  }
  return [!bad.length, !bad.length ? `${lines} evidence lines, every one names REA, Jarvis browser or Jarvis scan`
                                   : "lines with no source: " + bad.slice(0, 4).join("; ")];
}

/** The snapshot server's own path check, against a note that tries to escape its folder. */
async function checkSnapshotContainment() {
  const server = await import("./server.mjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-kit-"));
  try {
    const teardowns = path.join(tmp, "captures", "teardowns");
    fs.mkdirSync(path.join(teardowns, "assets"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "secret.png"), "\x89PNG secret", "latin1");
    fs.writeFileSync(path.join(teardowns, "assets", "ok.png"), "\x89PNG fine", "latin1");
    const evil = path.join(teardowns, "evil.md"), encoded = path.join(teardowns, "encoded.md"), good = path.join(teardowns, "good.md");
    fs.writeFileSync(evil, "![x](assets/../../../secret.png)\n");
    fs.writeFileSync(encoded, "![x](assets/%2E%2E/%2E%2E/%2E%2E/secret.png)\n");
    fs.writeFileSync(good, "![x](assets/ok.png)\n");
    const escaped = server.snapshotFor(evil), escaped2 = server.snapshotFor(encoded), served = server.snapshotFor(good);
    const ok = escaped === null && escaped2 === null && served?.toString("latin1") === "\x89PNG fine";
    return [ok, ok ? "a note pointing at ../../../secret.png (plain or URL-encoded) is refused; its own assets/ image is served"
                   : `containment broken: escaped=${escaped}, encoded=${escaped2}, own image=${served}`];
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** The Topstep sync may only read: login, account list, trade history, contracts and price bars. Never orders or positions. */
async function checkTopstepReadOnly() {
  const ts = await import("./topstep-sync.mjs");
  const allowed = [...ts.READ_ONLY_ENDPOINTS].sort();
  const want = ["/api/Account/search", "/api/Auth/loginKey", "/api/Contract/search", "/api/History/retrieveBars", "/api/Trade/search"];
  const acting = allowed.filter((e) => /order|position|close|cancel|place|modify/i.test(e));
  const ok = JSON.stringify(allowed) === JSON.stringify(want) && !acting.length;
  const day = ts.tradingDay("2026-10-15T23:30:00Z");          // 18:30 Chicago belongs to the next session
  return [ok && day === "2026-10-16", ok ? `Topstep sync limited to ${allowed.join(", ")}; trading day rolls at 17:00 Chicago (${day})`
                                         : `Topstep sync allows: ${allowed.join(", ")}`];
}

/** The iPad Jarvis builds, its app stars are there, and the only Miro tool it calls only reads. */
async function checkIpadApps() {
  const { execFileSync } = await import("node:child_process");
  const out = path.join(os.tmpdir(), "jarvis-space-check.html");
  try {
    execFileSync(process.execPath, [path.join(ROOT, "ipad", "build-space.mjs"), out], { stdio: "pipe" });
    const page = fs.readFileSync(out, "utf8");
    const tools = [...new Set([...page.matchAll(/callTool\("Miro", "([^"]+)"/g)].map((m) => m[1]))];
    const apps = ["TradingView", "Excalidraw", "Miro", "YouTube", "Instagram", "Apps de Claude"].filter((a) => !page.includes('"' + a + '"'));
    // the spoken "ábreme TradingView en el MNQ1" route, with the page's own symbol table
    const i = page.indexOf("const SYMBOLS"), j = page.indexOf("const OPEN", i);
    const SYMBOLS = new Function(page.slice(i, j) + "; return SYMBOLS;")();
    const front = (t) => t.replace(/([A-Za-z])1!?/g, "$1 ");
    const symOf = (q) => { const x = q.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const f = SYMBOLS.find(([re]) => re.test(front(re.source.startsWith("\\bES") ? q : x))); return f ? f[2] : null; };
    const said = { "Oye Jarvis, ábreme TradingView y mira en qué punto está el MNQ1": "MNQ1!", "ábreme TradingView en el ES": "ES1!",
                   "ábreme TradingView, ¿en qué punto está? es urgente": null };
    const wrongSym = Object.entries(said).filter(([q, want]) => symOf(q) !== want).map(([q]) => q);
    if (!page.includes("Joel.")) wrongSym.push("the greeting does not name Joel");
    if (!page.includes("rec.continuous = false;") || !page.includes("if (state.listening) stopListening();   // one question per tap") || !page.includes("El micrófono está bloqueado") || !page.includes('window.addEventListener("jarvis-mic-blocked"') || !page.includes('b.id = "os-listen"') || !page.includes('new Event(\"jarvis-spoke\")'.replace(/\\/g, "")))
      wrongSym.push("the page mic is not one-question-per-tap with Spanish help");
    if (!page.includes("<avisos>") || !page.includes("hacia las 11:00")) wrongSym.push("Jarvis does not know the scheduled 11:00 summary");
    if (!page.includes('db.doc("fm/mercado")') || !page.includes("no es en directo")) wrongSym.push("the MNQ price star is missing or not marked as not live");
    const ok = JSON.stringify(tools) === '["board_search_boards"]' && !apps.length && page.includes("tiene que empezar por https://") && !wrongSym.length;
    return [ok, ok ? "iPad page builds; 6 app stars; Miro limited to board_search_boards (read); links must be http(s); 'ábreme TradingView… MNQ1' -> MNQ1!, a Spanish 'es' is not the ES; greets Joel; page mic: one question per tap, then written + spoken answer"
                   : `Miro tools: ${tools.join(", ") || "none"}; missing apps: ${apps.join(", ") || "none"}; misheard: ${wrongSym.join(" | ") || "none"}`];
  } finally { fs.rmSync(out, { force: true }); }
}

export const CHECKS = [["spoken addresses parse", checkAddresses],
                       ["fingerprints from banners", checkFingerprints],
                       ["every digest line names its source", checkDigestAttribution],
                       ["snapshots can't leave the teardowns folder", checkSnapshotContainment],
                       ["Topstep sync is read-only", checkTopstepReadOnly],
                       ["iPad Jarvis: app stars, Miro read-only", checkIpadApps]];

export async function run() {
  const results = [];
  for (const [name, fn] of CHECKS) {
    let ok, detail;
    try { [ok, detail] = await fn(); }
    catch (e) { [ok, detail] = [false, `crashed: ${e.name}: ${e.message}`]; }
    results.push([name, ok, detail]);
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const results = await run();
  for (const [name, ok, detail] of results) console.log(`  ${ok ? "✓" : ok === null ? "!" : "✗"} ${name}: ${detail}`);
  process.exit(results.every(([, ok]) => ok !== false) ? 0 : 1);
}
