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
  const ci = ts.checkin([{ alias: "TS-3", ultimoDia: ts.tradingDay("2026-10-16T19:00:00Z"), ultimoPnl: -2002.2 }, { alias: "TS-2", ultimoDia: "2026-10-01", ultimoPnl: 50 }], "Nueva York", "2026-10-16T16:00:00Z");
  if (ci.total !== -2002.2 || !ci.pregunta.includes("sesión de Nueva York") || ci.respondido !== false) return [false, "session question: " + JSON.stringify(ci).slice(0, 160)];
  // whole trades from fills: a short opened in one fill and closed in two fills of one order is one trade, fees of both sides off
  const ops = ts.operaciones([
    { id: 1, contractId: "CON.F.US.MNQ.Z26", creationTimestamp: "2026-10-16T13:30:54Z", price: 30004, profitAndLoss: null, fees: 4.32, side: 1, size: 12, orderId: 10 },
    { id: 2, contractId: "CON.F.US.MNQ.Z26", creationTimestamp: "2026-10-16T13:35:39Z", price: 29941, profitAndLoss: 1008, fees: 2.88, side: 0, size: 8, orderId: 11 },
    { id: 3, contractId: "CON.F.US.MNQ.Z26", creationTimestamp: "2026-10-16T13:35:40Z", price: 29941, profitAndLoss: 504, fees: 1.44, side: 0, size: 4, orderId: 11 },
    { id: 4, contractId: "CON.F.US.MNQ.Z26", creationTimestamp: "2026-10-16T14:00:00Z", price: 1, profitAndLoss: 99, fees: 0, side: 0, size: 1, voided: true }]);
  const o = ops[0] || {};
  if (ops.length !== 1 || o.dir !== "SHORT" || o.entrada !== 30004 || o.salida !== 29941 || o.contratos !== 12 || o.pnl !== 1503.36 || o.dur !== 5 || o.fecha !== "2026-10-16")
    return [false, "trades from fills: " + JSON.stringify(ops).slice(0, 200)];
  // Joel's own daily limits are watched, each warning once a day; a lost account is not watched
  const at = "2026-10-16T15:00:00Z", d = ts.tradingDay(at);
  const pc = [{ codigo: "TS-2", estado: "EXAM", topstepId: "1", dll: 1000 }, { codigo: "TS-3", estado: "PERDIDA", topstepId: "2", dll: 1000 }];
  const v1 = ts.vigilancia(pc, { 1: { dias: { [d]: -850 } }, 2: { dias: { [d]: -2000 } } }, at, null);
  const v2 = ts.vigilancia(pc, { 1: { dias: { [d]: -1050 } }, 2: { dias: {} } }, at, v1);
  const v3 = ts.vigilancia(pc, { 1: { dias: { [d]: -1100 } }, 2: { dias: {} } }, at, v2);
  if (v1.nuevos.length !== 1 || !v1.nuevos[0].includes("85 %") || v2.nuevos.length !== 1 || !v2.nuevos[0].includes("ha pasado") || v3.nuevos.length)
    return [false, "daily limit watch: " + JSON.stringify([v1.nuevos, v2.nuevos, v3.nuevos])];
  // Joel's rules engine: bullet 2 closes at exactly +500, the day caps at +1.500, the strong-day ladder hands on, a failed strong day
  // goes to recovery, and the hourly watch says each warning once a day; old saved settings get the new funded numbers
  const E0 = ts.estrategiaDe({ fuerteTP: 2500, minimoSL: 300, modo: "grupo" }), E = ts.estrategiaDe({ v: 3, exModo: "balas" }), H = "2026-10-27";
  if (E0.fuerteTP !== 1000 || E0.minimoSL !== 1000 || E0.recupR !== 500 || E0.modo !== "grupo" || E0.exModo !== "londres" || E.exModo !== "balas" || E0.lonT !== 1000 || ts.estrategiaDe({ v: 3, lonT: 500, lonMax: 1000 }).lonT !== 1000) return [false, "strategy defaults: " + JSON.stringify(E0)];
  const Fd = (codigo, orden, dias) => ({ codigo, tipo: "Fondeada", estado: "ACTIVA", sl: -2000, orden, dias, pnl: Object.values(dias).reduce((a, b) => a + b, 0) });
  const Ex = (codigo, t) => ({ codigo, tipo: "Challenge", estado: "EXAM", tp: 3000, sl: -2000, dias: { [H]: t.reduce((a, b) => a + b, 0) }, tradesHoy: t, pnl: t.reduce((a, b) => a + b, 0) });
  const mr = ts.motorReglas({ estrategia: E, hoy: H, cuentas: [Ex("E1", [1000]), Ex("E2", [1000, 500]), Ex("E3", [-1000]), Fd("A", 1, { "2026-10-26": 1000, [H]: 200 }), Fd("B", 2, { [H]: -1000 }), Fd("C", 3, {})] });
  const k = mr.avisos.map((a) => a.key.split(":").slice(1).join(":")).join(" ");
  const rol = Object.fromEntries(mr.fondeadas.map((x) => [x.cuenta, x.rol]));
  if (k !== "E1:bala2 E2:tope E3:stop A:min-ok B:fuerte-ko pausa-dia" || !mr.avisos[0].txt.includes("justos, sin trailing") || !mr.avisos[1].txt.includes("+1.500 $")
      || rol.A !== "minimos" || rol.B !== "fuerte" || rol.C !== "espera" || !mr.avisos[4].txt.includes("modo recuperación") || !mr.avisos[4].txt.includes("lo hace C"))
    return [false, "rules engine: " + k + " " + JSON.stringify(rol)];
  const next = ts.motorReglas({ estrategia: E, hoy: "2026-10-28", cuentas: [Fd("A", 1, { "2026-10-26": 1000, "2026-10-27": 200 }), Fd("B", 2, { "2026-10-27": -1000 }), Fd("C", 3, {})] });
  const fb = next.fondeadas.find((x) => x.cuenta === "B");
  if (fb.rol !== "recuperacion" || !fb.txt.includes("arriesga 500 $") || next.fondeadas.find((x) => x.cuenta === "C").rol !== "fuerte" || !next.resumen.includes("A, B en días mínimos + C en día fuerte"))
    return [false, "strong-day ladder next day: " + JSON.stringify(next.fondeadas)];
  // London + New York: London's profit is all New York may risk; a London stop closes the account's day; 2 stops end the day
  const LO = "2026-10-27T08:00:00Z", NYt = "2026-10-27T15:00:00Z", XL = (codigo, t) => ({ ...Ex(codigo, t.map((x) => x.pnl)), tradesHoy: t });
  const ml = ts.motorReglas({ estrategia: E0, hoy: H, ahora: NYt, cuentas: [XL("L1", [{ pnl: 500, at: LO }]), XL("L2", [{ pnl: -1000, at: LO }]), XL("L3", [{ pnl: 600, at: LO }, { pnl: -600, at: NYt }]), XL("L4", [])] });
  const kl = ml.avisos.map((a) => a.key.split(":").slice(1).join(":")).join(" "), l1 = ml.examenes.find((x) => x.cuenta === "L1").txt, l4 = ml.examenes.find((x) => x.cuenta === "L4").txt;
  if (kl !== "L1:lon-ok L2:lon-ko L3:ny-cero" || !ml.avisos[0].txt.includes("arriesga como máximo 500 $") || !l1.includes("+1.000 $ más") || !l4.includes("nunca pasa de −1.000 $"))
    return [false, "London + New York: " + kl + " | " + l1];
  const sem = ts.motorReglas({ estrategia: E0, hoy: H, cuentas: [{ ...Ex("W1", [-500]), dias: { "2026-10-26": -1600, [H]: -500 }, pnl: -2100 }, Ex("W2", [-1000])] });
  if (!sem.pausa.semanal || !sem.avisos.some((a) => a.key.endsWith(":pausa-semana")) || !sem.avisos.some((a) => a.key.endsWith(":W1:quemada")))
    return [false, "weekly pause / burned account: " + JSON.stringify(sem.pausa)];
  // after London: what he traded, how each account stands and the next step
  const rs = ts.resumenSesion([{ codigo: "TS-1", tipo: "Challenge", estado: "EXAM", tp: 3000, sl: -2000, balanceIni: 50000, topstepId: "1" }],
    { 1: { balance: 50620, dias: { [H]: 620 }, trades: [{ fecha: H, instr: "MNQ", dir: "LONG", contratos: 3, pnl: 620, cierra: LO }] } }, null, "Londres", "2026-10-27T10:57:00Z");
  if (!rs.includes("MNQ largo 3 contratos +620 $") || !rs.includes("le faltan 2.380 $") || !rs.includes("Siguiente paso: 🗽 Nueva York") || !rs.includes("como máximo 620 $"))
    return [false, "London summary: " + rs];
  const atR = "2026-10-27T15:00:00Z", dR = ts.tradingDay(atR), pcR = [{ codigo: "TS-1", tipo: "Challenge", estado: "EXAM", tp: 3000, sl: -2000, balanceIni: 50000, topstepId: "9" }];
  const tsR = (t) => ({ 9: { balance: 50000 + t.reduce((a, b) => a + b, 0), dias: { [dR]: t.reduce((a, b) => a + b, 0) }, trades: t.map((pnl, i) => ({ fecha: dR, pnl, cierra: "2026-10-27T1" + i + ":00:00Z" })) } });
  const r1 = ts.reglasDelDia(pcR, tsR([1000]), null, atR, null), r2 = ts.reglasDelDia(pcR, tsR([1000]), null, atR, { fecha: dR, reglas: r1 }), r3 = ts.reglasDelDia(pcR, tsR([1000, 500]), null, atR, { fecha: dR, reglas: r2 });
  if (r1.nuevos.length !== 1 || r2.nuevos.length || r3.nuevos.length !== 1 || !r3.nuevos[0].includes("tope del día")) return [false, "hourly rule warnings: " + JSON.stringify([r1.nuevos, r2.nuevos, r3.nuevos])];
  // the morning summary and the session question still run the previous copy: what they carry over (vigilancia.avisados) keeps a warning from repeating
  const vR = ts.vigilancia(pcR, tsR([1000]), atR, null); vR.avisados = [...vR.avisados, ...r1.avisados];
  if (ts.reglasDelDia(pcR, tsR([1000]), null, atR, ts.vigilancia(pcR, tsR([1000]), atR, vR)).nuevos.length) return [false, "a rule warning repeats after a run of the older script"];
  const day = ts.tradingDay("2026-10-15T23:30:00Z");          // 18:30 Chicago belongs to the next session
  return [ok && day === "2026-10-16", ok ? `Topstep sync limited to ${allowed.join(", ")}; trading day rolls at 17:00 Chicago (${day}); fills become whole trades (SHORT 12 MNQ, +1.503,36 net); daily limits warned once (85 %, then passed); his rules: London + New York on London's profit, bullet 2 to +500 sharp, +1.500 day cap, strong-day ladder with recovery, day and week pause, each warning once; London summary with the next step`
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
    if (!page.includes("v.length - last.length >= 4") || !page.includes("answerA.textContent.trim() === text) Voice.speak(text)")) wrongSym.push("dictation auto-send or the spoken retry is missing");
    if (!page.includes("function keepAwake(") || !page.includes("Voice.keepAwake && Voice.keepAwake(); });")) wrongSym.push("the voice is not held open from the tap to the answer");
    if (!page.includes('db.doc("fm/checkin")') || !page.includes('images: [image]') || !page.includes('b.id = "os-listen"')) wrongSym.push("session question or trade photo is missing");
    if (!page.includes('id="plan-host"') || !page.includes("planDeFuturos: window.PLAN?.contexto") || !page.includes("Control Maestro")) wrongSym.push("the Plan de Futuros panel is not wired into Jarvis");
    if (!page.includes("const tsOps = () =>") || !page.includes("function semanasAll(") || !page.includes("Calculada por Jarvis con Topstep")) wrongSym.push("Topstep trades and weeks are not filled in automatically in the Plan");
    if (!page.includes('id="fr-host"') || !page.includes("fundingManager: window.FUNDING?.contexto") || !page.includes('doc("fm/retiradas").collection("movs")') || !page.includes('id="os-fr"')) wrongSym.push("the Funding Manager (withdrawals and exam costs) is not wired into Jarvis");
    if (!page.includes("async function movRoute(") || !page.includes("const mov = await movRoute(question, sample)") || !page.includes("const mov = await movRoute(String(text), movSample)") || !page.includes("if (!data.node) { Voice.speak(data.answer); return; }")) wrongSym.push("saying «regístrame el payout / la compra del examen» does not reach the Funding Manager");
    if (!page.includes("📋 Ficha para TopstepX") || !page.includes("fichaTopstepX: vigil()") || !page.includes("nunca digas que puedes cambiar ajustes")) wrongSym.push("the TopstepX limits sheet is missing from the Plan");
    if (!page.includes("jarvis-avisos-oidos") || !page.includes("Aviso de límites, Joel. ") || !page.includes("vigilancia de límites: cada hora")) wrongSym.push("limit warnings are not spoken by Jarvis");
    if (!page.includes("function panelRoute(") || !page.includes("const panel = panelRoute(question)") || !page.includes("window.FUNDING.open(") || !page.includes("Nunca le digas que tiene que pinchar un botón")) wrongSym.push("«llévame al Funding Manager / al Plan de Futuros» does not open the panel");
    if (!page.includes("function planDeDinero()") || !page.includes("window.CAPITAL.textoReparto(m.importe)") || !page.includes("jarvis-dinero-oido") || !page.includes("MOV_DO.test(f)")) wrongSym.push("the money plan (payout split, withdrawals, top-ups, risk steps) is not wired into Jarvis");
    if (!page.includes("function recomendar(") || !page.includes("async function planRoute(") || !page.includes("const plan = await planRoute(question, sample)") || !page.includes("propuestaDeJarvis")) wrongSym.push("Jarvis cannot propose a risk plan from Joel’s numbers");
    if (!page.includes("function comoVoy(") || !page.includes("function avisoTrasRegistro(") || !page.includes("function dosToques(") || /if \(!confirm\(/.test(page) || !page.includes("payoutsDeFondeo") || !page.includes("Date.now() - S.tocado < 4000")) wrongSym.push("Capital propio: «cómo vas», spoken status after each tap, two-tap confirmations or payout splits are missing");
    if (!page.includes("function tablaRiesgo(") || !page.includes("function explicaEscalones(") || !page.includes("tocoEn = Date.now(); accion(b);") || !page.includes("Mándale una captura a Claude")) wrongSym.push("Capital propio: the risk table, the plain risk-steps explanation or the touch-safe buttons are missing");
    if (!page.includes("d.log.map((e) => ({ ...e }))")) wrongSym.push("Capital propio keeps the frozen log the database hands back, so Win/Loss cannot be added");
    if (!page.includes("function renderOperacion(") || !page.includes("function importeOp(") || !page.includes("data-op=\"res\"")) wrongSym.push("Capital propio: the per-trade risk and real-result fields are missing");
    if (!page.includes("function vivo()") || !page.includes('id="cp-hoy"') || !page.includes('id="cp-como"') || !page.includes("data-sim=") || !/function calc\(\) \{\s*const I = S\.inputs, s = saldo\(\), r = rOp\(\);/.test(page)) wrongSym.push("Capital propio: 'Cómo vas', 'Tu número de hoy' and the risk table must follow this trade's risk live, with a try-a-risk box");
    if (!page.includes("function gestion(") || !page.includes("TRAMOS_GENERAL") || !page.includes('data-act="modo-auto"') || !page.includes("function aportesHtml(") || !page.includes("costes") || !page.includes("cuantoMeterAlAportar")) wrongSym.push("Capital propio: Jarvis's managed payout split (Hacienda, exams fund, own-capital goal) and the top-up amount and levels are missing");
    if (!page.includes("function recomendarRetiro(") || !page.includes("function probPeriodoNegativo(") || !page.includes("data-rsim=") || !page.includes('data-act="usar-retiro"') || !page.includes("recomendacionJarvis")) wrongSym.push("Capital propio: Jarvis's withdrawal advice (how much, how often) and the try-a-withdrawal table are missing");
    if (!page.includes("function cierre(") || !page.includes("const ventana = hoy >= per.dia") || !page.includes("RETIRO EN CAMINO") || !/periodo: \(dn\.puedeRetirar/.test(page)) wrongSym.push("Capital propio: withdrawals must wait for the period's close (on the way before it, the closed period in the first days after)");
    if (!page.includes('chip("pct-retiro"') || !page.includes('a === "frec-retiro"') || !page.includes("e.target.dataset.p !== \"frecuencia\"") || !page.includes("¿Y QUÉ METO?")) wrongSym.push("Capital propio: his own withdrawal choice (tap to change, typed values apply live) and the top-up example are missing");
    if (!page.includes('id="cp-miplan"') || !page.includes('id="cp-ret-estado"') || !page.includes("const opciones = (lista, v)") || !page.includes('set("#cp-miplan", miPlanHtml())')) wrongSym.push("Capital propio: a typed withdrawal target or percentage must show up at once (its own button, the plan and the status)");
    if (!page.includes("function fijoVista(") || !page.includes('type="range" min="0" max="100" step="1" data-p=') || !page.includes('set("#cp-fijo-vista", fijoVista())') || !page.includes("function autoVista(") || !page.includes("data-fsim=")) wrongSym.push("Capital propio: the fixed-percentage sliders must show each share's money live, with a payout to try");
    if (!page.includes('id="os-avisos"') || !page.includes("window.AVISOS =") || !page.includes("function avisosRoute(") || !page.includes("const avisos = avisosRoute(question)")) wrongSym.push("Jarvis: today's limit warnings must be kept in Jarvis (button and voice)");
    if (!page.includes('id="sq-host"') || !page.includes('id="os-sq"') || !page.includes('id="sq-open"') || !page.includes("window.__SQ_FEED")) wrongSym.push("Jarvis: the TopStep Squad panel (published from another conversation) must stay in the build");
    if (!page.includes("function guardarRiesgo(") || !page.includes("S.renderLuego")) wrongSym.push("Plan de Futuros: risk limits must save themselves when changed, without being lost to a re-render");
    if (!page.includes("async function autoRegistro(") || !page.includes("function reparto()") || !page.includes('data-act="repartir"') || !page.includes("tsTipo")) wrongSym.push("Plan de Futuros: new Topstep accounts must register themselves and groups must be split like TopStep Squad");
    if (!page.includes("window.__SQ_RESET_AT") || !page.includes('doc("fm/main").collection("cuentas").doc("ts-auto-"') || !page.includes('c.estado === "perdida" || c.estado === "retirada"')) wrongSym.push("Reset: TopStep Squad must start from zero after a reset, and new accounts must reach the squad and the morning summary");
    if (!page.includes("function hoyOperas(") || !page.includes("function balas(c, d)") || !page.includes("async function avanzarFoco(") || !page.includes("«hoyOperas»")) wrongSym.push("Plan de Futuros: 'Hoy operas' (2 bullets, rotation, strong day + minimum days) must tell Joel what to trade, on screen and by voice");
    if (!page.includes("function reglas()") || !page.includes("EXÁMENES · PLAN DE 2 BALAS") || page.includes("const REGLAS = [")) wrongSym.push("Plan de Futuros: the system rules must come from Joel's own strategy settings");
    if (!page.includes("const REGLAS_ANTES = [") || !page.includes("const CHECKS_ANTES = {") || !page.includes('eleccion("reglas"') || !page.includes('eleccion("checks"')) wrongSym.push("Plan de Futuros: the old rules and Sunday checklists must stay one tap away to compare");
    if (!page.includes("function motorReglas(") || page.includes("@motor-reglas@") || !page.includes("avisos: () => (S.ready ? motor().avisos : [])") || !page.includes("function ahoraHtml()")
        || !page.includes('"jarvis-reglas-oidas"') || !page.includes("window.PLAN.avisos().map((a) => a.txt)")) wrongSym.push("Plan de Futuros: the rules engine (shared with the hourly watch) must run in the app, show «Lo que te toca ahora» and speak each warning in Avisos de hoy");
    if (!page.includes('data-ver=\"exModo:londres\"') || !page.includes('"EXÁMENES · LONDRES + NUEVA YORK"') || !page.includes('"SISTEMA SUPLENTE"') || !page.includes('"REGLA DE PAUSA"'))
      wrongSym.push("Plan de Futuros: his rules must offer London + New York and carry the suplente and pause rules of his strategy");
    // 📒 Backtesting: his 4 setups, New York hours to sessions, R from prices, TradingView Paper Trading exports, and the voice route
    { const i = page.indexOf("const BT_SETUPS"), j = page.indexOf("// ── data and state", i);
      const BT = i > 0 && j > i ? new Function(page.slice(i, j) + "; return { BT_SETUPS, btSesion, btDia, btR, btTabla, btCSV, btImportar, btConclusiones };")() : null;
      const bal = "Time,Realized P&L (value),Action\n2026-10-20 07:05:00,1000,\"Close short position for symbol CME_MINI:MNQ1! at price 20900.00 for 5 units. Position AVG Price was 21000.000000, currency: USD\"\n";
      const ord = "Symbol,Side,Qty,Fill Price,Status,Closing Time\nCME_MINI:MNQ1!,Buy,2,21000.25,Filled,2026-10-22 06:30:01\nCME_MINI:MNQ1!,Sell,2,21050.25,Filled,2026-10-22 07:10:00\nCME_MINI:MNQ1!,Sell,2,,Cancelled,2026-10-22 07:10:00\n";
      const b1 = BT && BT.btImportar(BT.btCSV(bal), "UTC", 1000)[0], b2 = BT && BT.btImportar(BT.btCSV(ord), "Europe/Madrid", 1000);
      const tab = BT && BT.btTabla([{ r: 2 }, { r: -1 }, { r: 0 }], () => "x")[0];
      if (!BT || BT.BT_SETUPS.map((x) => x.id).join() !== "L1,L2,NYR,NYV" || BT.btSesion("02:40") !== "Londres" || BT.btSesion("09:45") !== "Nueva York" || BT.btDia("2026-10-20") !== "Martes"
          || BT.btR({ dir: "SHORT", entrada: 21000, stop: 21020, salida: 20960 }) !== 2 || !b1 || b1.hora !== "03:05" || b1.dir !== "SHORT" || b1.r !== 1
          || b2.length !== 1 || b2[0].hora !== "00:30" || b2[0].dir !== "LONG" || tab.acierto !== 50 || tab.be !== 1)
        wrongSym.push("Backtesting: setups, sessions, R or the TradingView import are wrong: " + JSON.stringify([b1, b2, tab]));
      if (!page.includes('["backtest", "📒 Backtesting"]') || !page.includes("backtesting: btContexto()") || !page.includes("const bt = await btRoute(question);"))
        wrongSym.push("Backtesting: the tab, Jarvis's context or the «Jarvis, backtest:» voice route is missing");
      if (!page.includes("async function btLeccion(tipo)") || !page.includes("eres su profesor de trading") || !page.includes("function btProfHtml(P)") || !page.includes("BT_CLASE.test(f) && window.PLAN && window.PLAN.btClase"))
        wrongSym.push("Backtesting: the teacher (correction of each screenshot, weekly class, strategy explained) is missing");
      if (!page.includes("async function btFotogramas(file, n)") || !page.includes("accept=\"image/*,video/*\"") || !page.includes("function btRealesTopstep(desde)") || !page.includes("data-btver=")
          || !page.includes("Si toma el high de Asia con mecha, se invalida") || !page.includes("const btFueraRango = (t)"))
        wrongSym.push("Backtesting: video frames, real trades, his checklist per model or the operating window is missing");
      if (!page.includes('const BT_HORARIO = [["Londres", "02:00", "05:00"], ["Nueva York", "10:30", "12:00"]];') || !page.includes("POR HORA DE ENTRADA · TU HORARIO") || !page.includes("⚠️ Falta la hora de entrada"))
        wrongSym.push("Backtesting: the hour table must follow his hours (London 2:00–5:00, New York 10:30–12:00) and ask for a missing hour");
      if (!page.includes("function btSubidaHtml()") || !page.includes("Joel te explica él mismo por qué entró") || !page.includes("💬 Sobre tu explicación:") || !page.includes("explicacionDeJoel: t.explicacion"))
        wrongSym.push("Backtesting: his own explanation must go with each screenshot or video to the teacher, be answered and kept"); }
    if (!page.includes('id="cap-host"') || !page.includes("capitalPropio: window.CAPITAL?.contexto") || !page.includes('db.doc("fm/capital")')) wrongSym.push("Capital propio is not wired into Jarvis");
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
