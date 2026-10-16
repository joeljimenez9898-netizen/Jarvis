// Evidence from the clean browser: five steps, every line labelled with who captured it.
//
//   REA            what REA observed or analysed (inspect-web-page, analyze-web-bundle,
//                  capture-web-screenshot)
//   JARVIS_BROWSER what Jarvis read itself through its own DevTools client
//   JARVIS_SCAN    what Jarvis found by scanning the code REA captured
//
// The brain is told to keep this attribution straight, so every item carries `by`.
// Node standard library only.
import fs from "node:fs";
import path from "node:path";

export const REA = "REA", JARVIS_BROWSER = "Jarvis browser", JARVIS_SCAN = "Jarvis scan of REA-captured code";

const WATCH_MS = 7000;          // REA watches this long...
const SCROLL_AFTER_S = 1.0;     // ...and one second in, Jarvis scrolls
const SCROLL_STEPS = 16;
const SCROLL_DELTA = 320;
const TOP_ASSETS = 12;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 5. FINGERPRINTS: the ONE table, ordered by what matters to a designer ──
// [layer, name, where, pattern, version pattern searched nearby or null]
//   where "banner": must sit inside a /* comment */. License banners survive minification,
//                   while the same words in code can be warnings ("Requires GSAP 3.11.0").
//   where "code":   a marker in the code itself (no banner exists for these).
export const FINGERPRINTS = [
  ["3D engine",      "Three.js",          "banner", /Three\.js Authors/,                  "three"],
  ["3D engine",      "Babylon.js",        "banner", /Babylon\.js v(\d+\.\d+\.\d+)/,       null],
  ["3D engine",      "PlayCanvas",        "banner", /PlayCanvas Engine v?(\d+\.\d+\.\d+)/, null],
  ["3D engine",      "PixiJS",            "banner", /pixi\.js - v(\d+\.\d+\.\d+)/,        null],
  ["animation",      "GSAP",              "banner", /GSAP (3\.\d+\.\d+)/,                 null],
  ["animation",      "anime.js",          "banner", /anime\.js v?(\d+\.\d+\.\d+)/,        null],
  ["animation",      "Theatre.js",        "code",   /@theatre\/core/,                      null],
  ["smooth scroll",  "Lenis",             "code",   /lenis-smooth|lenis-scrolling/,       /"(1\.\d+\.\d+)"/],
  ["smooth scroll",  "Locomotive Scroll", "banner", /locomotive-scroll v?(\d+\.\d+\.\d+)/, null],
  ["visual effects", "postprocessing",    "banner", /postprocessing v(6\.\d+\.\d+)/,      null],
  // EffectComposer/ShaderPass also exist in postprocessing; these pass names are three.js's own.
  ["visual effects", "three.js passes",   "code",   /UnrealBloomPass|BokehPass|SSAOPass|SAOPass|OutputPass|AfterimagePass|GlitchPass|FilmPass/, null],
  ["compression",    "Draco",             "code",   /draco_decoder|DracoDecoderModule/,   null],
  ["compression",    "Basis / KTX2",      "code",   /basis_transcoder|BasisTranscoder|KTX2Loader/, null],
  ["compression",    "meshoptimizer",     "code",   /meshopt_decoder|MeshoptDecoder/,     null],
  ["build tool",     "Vite",              "code",   /vite\/modulepreload-polyfill|__vite__/, null],
  ["build tool",     "webpack",           "code",   /webpackChunk|__webpack_require__/,   null],
  ["build tool",     "Next.js",           "code",   /__NEXT_DATA__|next\/dist\//,          null],
  ["build tool",     "Nuxt",              "code",   /__NUXT__/,                           null],
  ["build tool",     "Astro",             "code",   /astro-island/,                       null],
];
const COMMENT = /\/\*[\s\S]*?\*\//g;
const OTHER_BANNER = /\/\*[!*]?\s*(?:@license\s+)?([A-Za-z@][\w@./+-]*(?: [A-Za-z][\w.+-]*){0,3})\s+v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/g;

// Read-only globals that libraries set on window, read by Jarvis's own browser.
const RUNTIME_PROBE = `({
  height: document.documentElement.scrollHeight,
  images: document.images.length,
  videos: document.querySelectorAll('video').length,
  three: window.__THREE__ || null,
  gsap: (window.gsap && window.gsap.version) || null,
  babylon: (window.BABYLON && window.BABYLON.Engine && window.BABYLON.Engine.Version) || null,
  playcanvas: (window.pc && window.pc.version) || null,
  pixi: (window.PIXI && window.PIXI.VERSION) || null,
  canvases: document.querySelectorAll('canvas').length
})`;

// ── 2b. GPU STRINGS: names code hands to the graphics card, and what they mean ──
const GPU_DECL = /\buniform\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+(\w+)|getUniformLocation\(\s*\w+\s*,\s*["'](\w+)["']/g;
const GPU_SIGNALS = [   // ordered; first match wins
  ["depth of field", /coc|bokeh|focus|aperture|dof/], ["bloom", /bloom|luminosity|luminance/],
  ["ambient occlusion", /ssao|ambientocclusion|^ao|aomap/], ["motion blur", /motionblur|velocity/],
  ["chromatic aberration", /chromatic|aberration|rgbshift/], ["film grain / noise", /grain|noise/],
  ["vignette", /vignette/], ["tone mapping", /tonemapping|exposure|whitepoint/], ["fog", /fog/],
  ["shadows", /shadow/], ["reflections / environment", /envmap|irradiance|reflect|cubemap/],
  ["refraction / glass", /refract|transmission|ior|thickness/],
  ["PBR materials", /metalness|roughness|clearcoat|sheen|iridescence|specular/],
  ["surface detail", /normalmap|bumpmap|displacement/], ["skinned / morphing models", /bone|skin|morph/],
  ["instancing", /instance/], ["mouse-reactive", /mouse|pointer|cursor/], ["scroll-driven", /scroll|progress/],
  ["animated over time", /^u?_?time$|elapsed/], ["particles", /particle|pointsize/],
  ["fluid / simulation", /fluid|pressure|divergence|curl|advect/],
];
// Post-processing libraries name their effects with strings that survive minification:
// postprocessing registers "BloomEffect", three.js passes are "UnrealBloomPass" and so on.
const EFFECT_NAME = /["']([A-Z]\w{2,40}(?:Effect|Pass))["']/g;
const EFFECT_SIGNALS = [
  ["depth of field", /DepthOfField|Bokeh/], ["bloom", /Bloom|SelectiveBloom/], ["ambient occlusion", /SSAO|SAO|N8AO|GTAO/],
  ["motion blur", /MotionBlur|Afterimage/], ["chromatic aberration", /ChromaticAberration|RGBShift/],
  ["film grain / noise", /Noise|Film/], ["vignette", /Vignette/], ["tone mapping", /ToneMapping|Output/],
  ["god rays", /GodRays/], ["glitch", /Glitch/], ["pixelation / dither", /Pixelat|Dither|DotScreen|Scanline/],
  ["outlines", /Outline/], ["color grading", /LUT|HueSaturation|BrightnessContrast|ColorAverage|Sepia/],
  ["anti-aliasing", /SMAA|FXAA|TAA/],
];

// ── 4. ASSET LOG: kinds, by extension (and initiator) ──
const KINDS = [
  ["3D models", [".glb", ".gltf", ".obj", ".fbx", ".usdz", ".drc", ".ply", ".splat", ".ksplat", ".spz", ".vrm"]],
  ["compressed textures", [".ktx2", ".basis", ".ktx", ".dds"]], ["environment maps", [".hdr", ".exr"]],
  ["video", [".mp4", ".webm", ".mov", ".m3u8", ".m4s", ".ogv"]],
  ["audio", [".mp3", ".ogg", ".wav", ".m4a", ".aac", ".flac", ".opus"]],
  ["fonts", [".woff2", ".woff", ".ttf", ".otf"]], ["WebAssembly", [".wasm"]], ["scripts", [".js", ".mjs", ".cjs"]],
  ["images", [".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".svg", ".ico"]], ["styles", [".css"]],
  ["data", [".json", ".bin", ".txt", ".csv"]],
];
const ASSET_PROBE = `(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const res = performance.getEntriesByType('resource').map(e => [e.name, e.initiatorType,
    e.transferSize, e.encodedBodySize, e.decodedBodySize, Math.round(e.startTime)]);
  return { resources: res,
           document: nav ? [nav.name, 'navigation', nav.transferSize, nav.encodedBodySize, nav.decodedBodySize, 0] : null };
})()`;

function kindOf(url, initiator) {
  let p = "";
  try { p = new URL(url).pathname.toLowerCase(); } catch { /* keep "" */ }
  for (const [name, exts] of KINDS) if (exts.some((e) => p.endsWith(e))) return name;
  return { script: "scripts", css: "styles", link: "styles", img: "images", video: "video", audio: "audio" }[initiator] || "other";
}

/** Every file the page loaded, from any origin, from the browser's own timeline. */
export async function assetLog(page) {
  const raw = await page.evaluate(ASSET_PROBE);
  const entries = [...raw.resources];
  if (raw.document) entries.unshift(raw.document);
  const files = [];
  for (const [url, initiator, transfer, encoded, decoded, start] of entries) {
    if (!/^https?:\/\//.test(url)) continue;
    const size = encoded || transfer || null;               // 0 cross-origin without Timing-Allow-Origin
    files.push({ by: JARVIS_BROWSER, url, origin: new URL(url).origin,
                 kind: initiator === "navigation" ? "document" : kindOf(url, initiator),
                 bytes: size, decoded_bytes: decoded || null, started_ms: start });
  }
  const totals = {}, origins = {};
  for (const f of files) {
    const t = (totals[f.kind] ||= { files: 0, bytes: 0, hidden: 0 });
    t.files++;
    if (f.bytes) t.bytes += f.bytes; else t.hidden++;
    const o = (origins[f.origin] ||= { files: 0, bytes: 0 });
    o.files++;
    o.bytes += f.bytes || 0;
  }
  const largest = files.filter((f) => f.bytes).sort((a, b) => b.bytes - a.bytes).slice(0, TOP_ASSETS);
  const notes = [];
  if (raw.resources.length >= 250) notes.push("The browser's resource timeline holds 250 entries by default; files after that aren't listed.");
  const hidden = Object.values(totals).reduce((n, t) => n + t.hidden, 0);
  if (hidden) notes.push(`${hidden} cross-origin files hide their size (no Timing-Allow-Origin header); counted, not sized.`);
  return { by: JARVIS_BROWSER, files: files.length, bytes: files.reduce((n, f) => n + (f.bytes || 0), 0),
           by_kind: totals, by_origin: origins, largest, all: files, notes };
}

function scriptsOf(inspect) {
  const items = inspect?.normalized_result?.scripts?.items || [];
  return items.map((it) => ({ by: REA, url: it.url, chars: it.length, module: it.is_module,
                              source_map: it.source_map_url, text: it.source?.artifact?.text || "" }));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** REVISION survives minification as the value window.__THREE__ is set to. */
function threeRevision(code) {
  const m = /REVISION\s*=\s*["'](\d{2,3}(?:dev)?)["']/.exec(code);
  if (m) return m[1];
  const v = /__THREE__\s*=\s*([\w$]+)/.exec(code);
  if (v) {
    const val = new RegExp(`(?<![\\w$.])${escapeRe(v[1])}\\s*=\\s*["'](\\d{2,3}(?:dev)?)["']`).exec(code);
    if (val) return val[1];
  }
  return null;
}

export function fingerprints(scripts, runtime) {
  const code = scripts.map((s) => s.text).join("\n");
  const comments = new Map(scripts.map((s) => [s.url, (s.text.match(COMMENT) || []).join("\n")]));
  const stack = [], matched = new Set();
  for (const [layer, name, where, pattern, rule] of FINGERPRINTS) {
    const hay = where === "banner" ? [...comments.values()].join("\n") : code;
    const m = pattern.exec(hay);
    if (!m) continue;
    let version = m[1] || null;
    if (rule === "three") {
      const rev = threeRevision(code);
      version = rev ? `r${rev}` : null;
    } else if (rule) {
      const pos = code.indexOf(m[0]);
      const near = pos >= 0 ? rule.exec(code.slice(Math.max(0, pos - 3000), pos + 3000)) : null;
      version = near ? near[1] : null;
    }
    const file = scripts.find((s) => pattern.test(where === "banner" ? comments.get(s.url) : s.text))?.url || null;
    stack.push({ by: JARVIS_SCAN, layer, name, version, file });
    matched.add(name.toLowerCase().split(" ")[0].split(".")[0]);
  }
  // corroboration from globals the libraries set at runtime
  for (const [key, name] of [["three", "Three.js"], ["gsap", "GSAP"], ["babylon", "Babylon.js"],
                             ["playcanvas", "PlayCanvas"], ["pixi", "PixiJS"]]) {
    let value = (runtime || {})[key];
    if (!value) continue;
    value = key === "three" ? `r${value}` : String(value);
    const row = stack.find((r) => r.name === name);
    if (row) { row.runtime = { by: JARVIS_BROWSER, version: value }; row.version = row.version || value; }
    else stack.push({ by: JARVIS_BROWSER, layer: key === "gsap" ? "animation" : "3D engine", name, version: value,
                      file: null, note: "set on window at runtime; no banner in captured code" });
  }
  const order = FINGERPRINTS.map((r) => r[0]);
  const rankOf = (l) => (order.includes(l) ? order.indexOf(l) : 99);
  stack.sort((a, b) => rankOf(a.layer) - rankOf(b.layer));
  const others = [], seen = new Set();
  for (const s of scripts) {
    for (const m of s.text.matchAll(OTHER_BANNER)) {
      const name = m[1].trim(), version = m[2], key = `${name.toLowerCase()} ${version}`;
      if (seen.has(key) || [...matched].some((k) => k && name.toLowerCase().includes(k))) continue;
      seen.add(key);
      others.push({ by: JARVIS_SCAN, banner: name, version, file: s.url });
    }
  }
  return [stack, others.slice(0, 20)];
}

export function gpuStrings(scripts) {
  const names = new Map();
  for (const s of scripts) for (const m of s.text.matchAll(GPU_DECL)) {
    const n = m[1] || m[2];
    names.set(n, (names.get(n) || 0) + 1);
  }
  const signals = new Map();
  const add = (meaning, name, count) => {
    const sig = signals.get(meaning) || { by: JARVIS_SCAN, meaning, count: 0, names: [] };
    sig.count += count; sig.names.push(name); signals.set(meaning, sig);
  };
  for (const [name, count] of names) {
    const hit = GPU_SIGNALS.find(([, re]) => re.test(name.toLowerCase()));
    if (hit) add(hit[0], name, count);
  }
  const effects = new Set();
  for (const s of scripts) for (const m of s.text.matchAll(EFFECT_NAME)) effects.add(m[1]);
  for (const effect of [...effects].sort()) {
    const hit = EFFECT_SIGNALS.find(([, re]) => re.test(effect));
    if (hit) { add(hit[0], effect, 1); if (!names.has(effect)) names.set(effect, 1); }
  }
  const custom = [...names.keys()].filter((n) => /^u[A-Z_]/.test(n)).sort();   // uTime, u_resolution: hand-written
  // Ranked by what matters to a designer (the table's order), not by count: an engine's built-in
  // material names would otherwise drown out the effects a site chose to add.
  const priority = [...GPU_SIGNALS.map((r) => r[0]), ...EFFECT_SIGNALS.map((r) => r[0]).filter((m) => !GPU_SIGNALS.some((g) => g[0] === m))];
  const ranked = [...signals.values()].sort((a, b) => priority.indexOf(a.meaning) - priority.indexOf(b.meaning));
  for (const s of ranked) s.names = s.names.sort((a, b) => names.get(b) - names.get(a)).slice(0, 6);
  return { by: JARVIS_SCAN, uniforms: names.size, signals: ranked, custom_named: custom.slice(0, 25), effects: [...effects].sort() };
}

const isoNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, "+0000");

/** Run the five steps on an OwnedBrowser `page`. Saves the screenshot and the full evidence
 *  JSON in outDir. Returns the evidence object. step(name): watch, read, snapshot, assets, stack. */
export async function capture(page, runRea, outDir, step = () => {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const ep = page.endpoint;
  const ev = { url: page.target.url, title: await page.title(), job_id: page.jobId, load_seconds: page.loadSeconds,
               captured_at: isoNow() };
  const timings = (ev.timings_s = {});
  let t0 = Date.now();
  const lap = (name) => { timings[name] = Math.round((Date.now() - t0) / 100) / 10; t0 = Date.now(); };

  // 1. WATCH WHILE SCROLLING
  step("watch");
  const targets = await runRea("list-browser-targets", [ep]);
  const found = targets?.normalized_result?.targets || [];
  const targetId = (found.find((t) => t.target_id === page.targetId) || found[0] || {}).target_id || page.targetId;
  ev.target = { by: REA, target_id: targetId, targets_listed: found.length };
  const watching = runRea("inspect-web-page", [ep, targetId, "--observation-ms", String(WATCH_MS), "--include-script-sources"],
                          { timeout: 180 });
  watching.catch(() => {});                                // awaited below; don't let it go unhandled
  await sleep(SCROLL_AFTER_S * 1000);
  await page.scroll(SCROLL_DELTA, SCROLL_STEPS, 0.3);
  let inspect;
  try { inspect = await watching; } catch (e) { throw new Error(`REA inspect-web-page failed: ${e.message}`); }
  const ir = inspect.normalized_result || {};
  const scripts = scriptsOf(inspect);
  ev.scripts = scripts.map(({ text, ...rest }) => rest);
  ev.rea_resources = (ir.resources || []).map((r) => ({ by: REA, url: r.url, type: r.type, bytes: r.content_size }));
  ev.rea_dom_nodes = ir.dom?.total_nodes ?? null;
  ev.rea_limitations = inspect.limitations || [];
  ev.rea_evidence_ids = { "inspect-web-page": inspect.evidence_id };
  lap("watch");

  // 2. READ THE CODE
  step("read");
  const bundle = await runRea("analyze-web-bundle", [ep, targetId], { timeout: 180 });
  const obs = bundle?.normalized_result?.observations || {};
  const nodes = obs.chunks?.nodes || [];
  const keyToUrl = new Map(nodes.map((n) => [n.script_key, n.url]));
  ev.loads = (obs.chunks?.edges || []).map((e) => ({ by: REA, from: keyToUrl.get(e.from_script_key) || e.from_script_key,
                                                      to: e.resolved_url || e.specifier, how: e.kind }));
  // Bundle analysis can see scripts inspect-web-page missed (lazy chunks loaded later).
  const seen = new Set(ev.scripts.map((s) => s.url));
  for (const n of nodes) {
    if (seen.has(n.url)) continue;
    ev.scripts.push({ by: REA, url: n.url, chars: Number(n.bytes) || null, module: null, source_map: null,
                      note: "seen by bundle analysis; source not scanned" });
    seen.add(n.url);
  }
  ev.routes = [...new Set((obs.routes || []).map((r) => r.value).filter(Boolean))].sort();
  ev.endpoints = [...new Set((obs.endpoints || []).map((e) => e.value).filter(Boolean))].sort();
  ev.rea_evidence_ids["analyze-web-bundle"] = bundle.evidence_id;
  ev.rea_vendors = [...new Set((bundle?.normalized_result?.inferences || [])
    .filter((i) => i.kind === "vendor_fingerprint" && i.value).map((i) => i.value))].sort();
  ev.gpu = gpuStrings(scripts);
  lap("read_code");

  // 3. SNAPSHOT (back to the top with the wheel first)
  step("snapshot");
  for (let i = 0; i < 60; i++) {
    if (((await page.evaluate("window.scrollY")) || 0) <= 0) break;
    await page.scroll(-600, 1, 0.12);
  }
  await sleep(800);
  const shot = await runRea("capture-web-screenshot", [ep, targetId]);
  const art = shot?.normalized_result?.artifact || {};
  const png = Buffer.from(art.data_base64 || "", "base64");
  if (png.subarray(0, 4).toString("binary") !== "\x89PNG") throw new Error("REA's screenshot wasn't a PNG");
  const shotPath = path.join(outDir, "screenshot.png");
  fs.writeFileSync(shotPath, png);
  const vp = shot?.normalized_result?.viewport || {};
  ev.rea_evidence_ids["capture-web-screenshot"] = shot.evidence_id;
  ev.screenshot = { by: REA, path: shotPath, bytes: png.length, width: vp.width, height: vp.height, sha256: art.sha256 };
  lap("snapshot");

  // 4. THE ASSET LOG (Jarvis's own browser read; REA saw only its origin, from when it attached)
  step("assets");
  ev.assets = await assetLog(page);
  lap("asset_log");

  // 5. FINGERPRINTS
  step("stack");
  const runtime = await page.evaluate(RUNTIME_PROBE);
  ev.runtime_globals = { by: JARVIS_BROWSER, ...(runtime || {}) };
  [ev.stack, ev.other_banners] = fingerprints(scripts, runtime);
  lap("fingerprints");
  fs.writeFileSync(path.join(outDir, "evidence.json"), JSON.stringify(ev, null, 1));
  return ev;
}

export function size(n) {
  if (!n) return "size hidden";
  for (const unit of ["B", "KB", "MB", "GB"]) {
    if (n < 1024 || unit === "GB") return unit === "B" ? `${n.toFixed(0)} ${unit}` : `${n.toFixed(1)} ${unit}`;
    n /= 1024;
  }
}

/** The short, attributed summary (for a person). */
export function digest(ev) {
  const L = [`${ev.url}  (loaded in ${ev.load_seconds}s, job ${ev.job_id})`, ""];
  L.push("SCRIPTS");
  for (const s of [...ev.scripts].sort((a, b) => (b.chars || 0) - (a.chars || 0)).slice(0, 10)) {
    L.push(`  [${s.by}] ${size(s.chars)}  ${s.module ? "module " : ""}${s.url}`);
  }
  if (ev.scripts.length > 10) L.push(`  [${REA}] … and ${ev.scripts.length - 10} more (${ev.scripts.length} total)`);
  L.push("WHICH FILE LOADS WHICH");
  L.push(...(ev.loads.length ? ev.loads.slice(0, 8).map((e) => `  [${e.by}] ${e.from} -> ${e.to} (${e.how})`) : [`  [${REA}] no load edges found`]));
  L.push("ROUTES", `  [${REA}] ` + (ev.routes.slice(0, 15).join(", ") || "none found"));
  L.push("CODE SIGNALS (strings handed to the graphics card)");
  const g = ev.gpu;
  if (g.signals.length) {
    for (const s of g.signals.slice(0, 6)) L.push(`  [${s.by}] ${s.meaning}: ${s.count}x  (${s.names.slice(0, 4).join(", ")})`);
    if (g.custom_named.length) L.push(`  [${g.by}] hand-written uniforms: ${g.custom_named.slice(0, 10).join(", ")}`);
  } else L.push(`  [${g.by}] no shader uniforms in the captured code`);
  L.push("STACK");
  for (const r of ev.stack) {
    const rt = r.runtime ? `; runtime says ${r.runtime.version} [${r.runtime.by}]` : "";
    L.push(`  [${r.by}] ${r.layer.padEnd(14)} ${r.name} ${r.version || "(version not in banner)"}${rt}`);
  }
  if (!ev.stack.length) L.push(`  [${JARVIS_SCAN}] no known banners`);
  if (ev.rea_vendors.length) L.push(`  [${REA}] REA's own vendor fingerprints: ${ev.rea_vendors.join(", ")}`);
  if (ev.other_banners.length) L.push("  other banners: " + ev.other_banners.slice(0, 8).map((b) => `${b.banner} ${b.version}`).join(", ") + ` [${JARVIS_SCAN}]`);
  const a = ev.assets;
  L.push(`ASSETS  [${a.by}] ${a.files} files, ${size(a.bytes)} from ${Object.keys(a.by_origin).length} origin(s)`);
  for (const [kind, t] of Object.entries(a.by_kind).sort((x, y) => y[1].bytes - x[1].bytes)) {
    L.push(`  ${kind.padEnd(20)} ${String(t.files).padStart(3)} files  ${size(t.bytes)}${t.hidden ? `, ${t.hidden} unsized` : ""}`);
  }
  L.push("  largest:", ...a.largest.map((f) => `    ${size(f.bytes).padStart(9)}  ${f.kind.padEnd(20)} ${f.url}`));
  L.push(...a.notes.map((n) => `  note: ${n}`));
  const s = ev.screenshot;
  L.push(`SNAPSHOT  [${s.by}] ${s.width}x${s.height} PNG, ${size(s.bytes)} -> ${s.path}`);
  return L.join("\n");
}

// ── the brain's digest: everything, compressed, attributed, under ~15,000 characters ──

export const DIGEST_LIMIT = 15000;
export const LIMITS = [
  "REA attaches to a page that is already running: anything before it attached (the first network requests, console output, the intro) is not in REA's observation.",
  "REA reports only the site's own origin. Files from other origins come from Jarvis's own read of the browser's resource timeline.",
  "Library names and versions come from license banners and strings left in the code. A library that strips its banner, or is renamed, goes undetected; a banner proves the code was shipped, not that it runs.",
  "Shader and effect names show what the code can hand the graphics card, not what is on screen at any moment.",
  "Nothing was clicked or typed: views behind interaction weren't observed.",
];
const DIGEST_TAG = { [REA]: "[REA]", [JARVIS_BROWSER]: "[Jarvis browser]", [JARVIS_SCAN]: "[Jarvis scan]" };

export function brainDigest(ev, question) {
  const u = new URL(ev.url), host = u.hostname || ev.url, pageOrigin = u.origin;
  const rt = ev.runtime_globals || {}, a = ev.assets, g = ev.gpu;
  const sections = [];
  const sec = (title, lines, cap) => {
    lines = [...lines];
    if (cap && lines.length > cap) lines = [...lines.slice(0, cap), `… ${lines.length - cap} more not shown`];
    sections.push([title, lines]);
  };
  sec("SITE", [`${host}  (${ev.url})`, `title: ${JSON.stringify(ev.title)}`]);
  sec("QUESTION", [question || "(none given: explain how the site is built and what makes it look the way it does)"]);
  const globals = ["three", "gsap", "babylon", "playcanvas", "pixi"].filter((k) => rt[k]).map((k) => `${k}=${rt[k]}`).join(", ");
  sec("PAGE FACTS", [
    `[Jarvis browser] loaded (readyState complete) ${ev.load_seconds}s after launch; page height ${rt.height}px; canvases ${rt.canvases}; images ${rt.images}; videos ${rt.videos}`,
    `[REA] DOM nodes at observation: ${ev.rea_dom_nodes}`,
    `[Jarvis browser] runtime globals: ${globals || "none"}`]);
  sec("SCRIPTS (REA)", [...ev.scripts].sort((x, y) => (y.chars || 0) - (x.chars || 0))
    .map((s) => `[REA] ${size(s.chars)}  ${s.module ? "module " : ""}${s.url}${s.note ? `  (${s.note})` : ""}`), 30);
  sec("WHICH FILE LOADS WHICH (REA)", ev.loads.length ? ev.loads.map((e) => `[REA] ${e.from} -> ${e.to} (${e.how})`) : ["[REA] no load edges found"], 30);
  sec("ROUTES (REA)", [`[REA] ${ev.routes.join(", ") || "none found"}`]);
  if (ev.endpoints?.length) sec("ENDPOINT CANDIDATES (REA, low confidence)", [`[REA] ${ev.endpoints.slice(0, 20).join(", ")}`]);
  sec("CODE SIGNALS (Jarvis scan of REA-captured code)", [
    ...g.signals.map((s) => `[Jarvis scan] ${s.meaning}: ${s.names.slice(0, 5).join(", ")}`),
    ...(g.custom_named.length ? [`[Jarvis scan] hand-written uniforms: ${g.custom_named.join(", ")}`] : []),
    ...(g.effects?.length ? [`[Jarvis scan] effect names in code: ${g.effects.join(", ")}`] : [])], 20);
  sec("STACK", ev.stack.length ? ev.stack.map((r) => `${DIGEST_TAG[r.by]} ${r.layer}: ${r.name} ${r.version || "(no version in banner)"}`
    + (r.runtime ? ` — runtime agrees: ${r.runtime.version} ${DIGEST_TAG[r.runtime.by]}` : "")
    + (r.file ? ` — found in ${r.file}` : "")) : ["[Jarvis scan] no known banners or markers"]);
  if (ev.rea_vendors?.length) sec("REA'S OWN VENDOR FINGERPRINTS", [`[REA] ${ev.rea_vendors.join(", ")}`]);
  if (ev.other_banners?.length) sec("OTHER BANNERS (Jarvis scan)", ev.other_banners.map((b) => `[Jarvis scan] ${b.banner} ${b.version}`), 12);
  sec("ASSET TOTALS (Jarvis browser)", [
    `[Jarvis browser] ${a.files} files, ${size(a.bytes)} sized, from ${Object.keys(a.by_origin).length} origin(s)`,
    ...Object.entries(a.by_kind).sort((x, y) => y[1].bytes - x[1].bytes)
      .map(([k, t]) => `[Jarvis browser] ${k}: ${t.files} files, ${size(t.bytes)}${t.hidden ? `, ${t.hidden} with hidden size` : ""}`)]);
  sec("LARGEST FILES (Jarvis browser)", a.largest.map((f) => `[Jarvis browser] ${size(f.bytes)}  ${f.kind}  ${f.url}`));
  const third = Object.entries(a.by_origin).filter(([o]) => o !== pageOrigin).sort((x, y) => y[1].bytes - x[1].bytes);
  sec("THIRD-PARTY ORIGINS (Jarvis browser)", third.length ? third.map(([o, v]) => `[Jarvis browser] ${o}: ${v.files} files, ${size(v.bytes)}`)
                                                         : ["[Jarvis browser] none"], 15);
  sec("SNAPSHOT (REA)", [`[REA] ${ev.screenshot.width}x${ev.screenshot.height} PNG of the top of the page`]);
  sec("LIMITS", [...LIMITS, ...(ev.rea_limitations || []).slice(0, 3).map((l) => `[REA] ${l}`), ...a.notes.map((n) => `[Jarvis browser] ${n}`)]);
  let text = sections.map(([t, lines]) => `${t}\n${lines.join("\n")}`).join("\n\n");
  if (text.length > DIGEST_LIMIT) {                // last resort: keep the start of every section
    const per = Math.floor(DIGEST_LIMIT / sections.length) - 40;
    text = sections.map(([t, lines]) => `${t}\n${lines.join("\n").slice(0, per)}`).join("\n\n");
  }
  return text.slice(0, DIGEST_LIMIT);
}
