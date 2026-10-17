// node ipad/build-space.mjs [out.html]   then publish the file to the Jarvis artifact.
//
// Builds jarvis-space.html: the 3D galaxy as a second brain built from the user's own data
// (accounts, firms, their system, their diary), Jarvis in Spanish, and the Funding Manager inside.
import fs from "node:fs";
import path from "node:path";
import * as OS from "./os-layer.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = process.argv[2] || path.join(HERE, "jarvis-space.html");
const FM_SRC = path.join(HERE, "funding-manager.html");
const PLAN_SRC = path.join(HERE, "plan-futuros.html");
const CAP_SRC = path.join(HERE, "capital-propio.html");
const FR_SRC = path.join(HERE, "funding-tracker.html");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const must = (s, a, b) => { if (!s.includes(a)) throw new Error("not found: " + a.slice(0, 90)); return s.split(a).join(b); };

// ── 1. the galaxy page, in Spanish, waiting for the user's data before it starts ──
let html = read("viewer/index.html");
for (const [a, b] of [
  ["<title>Knowledge Galaxy</title>", "<title>Jarvis</title>"],
  ["<h3>CONNECTED</h3>", "<h3>CONECTADO CON</h3>"],
  ['<div id="title"><h1>KNOWLEDGE GALAXY</h1><p id="stats"></p></div>',
   '<div id="title"><h1>JARVIS</h1><p id="stats"></p><button type="button" id="fm-open">Plan de Futuros</button><button type="button" id="cap-open">Capital propio</button><button type="button" id="fr-open">Funding Manager</button></div>'],
  ["${nodes.length} notes indexed · ${links.length} connections · ${groups.length} groups", "${nodes.length} recuerdos · ${links.length} conexiones · ${groups.length} grupos"],
  ["`${greeting} ${nodes.length} notes indexed.`", "`${greeting} ${nodes.length} recuerdos en tu segundo cerebro.`"],
  ["`${nodes.length} notes indexed.`", "`${nodes.length} recuerdos en tu segundo cerebro.`"],
  ['placeholder="Ask your notes anything…"', 'placeholder="Pregunta a Jarvis o di «apunta que…»"'],
  ['aria-label="Question"', 'aria-label="Pregunta"'],
  ['title="Start a new conversation">New</button>', 'title="Empezar una conversación nueva">Nuevo</button>'],
  ['<button type="submit" id="send">Ask</button>', '<button type="submit" id="send">Preguntar</button>'],
  ['"Searching your notes"', '"Buscando en tu segundo cerebro"'],
  ['"Writing it down"', '"Apuntándolo"'],
  ["    if (!addNote(data.node, data.links, data.anchor)) {",
   "    if (!data.node) { Voice.speak(data.answer); return; }   // kept somewhere other than the diary (a movement in the Funding Manager)\n    if (!addNote(data.node, data.links, data.anchor)) {"],
  ["\"No links yet. Mention another note's title and it will join up.\"", '"Aún sin conexiones. Menciona una cuenta u otra nota y se unirán."'],
  ["const REMEMBER = /^\\s*remember that\\b/i;", "const REMEMBER = /^\\s*(?:remember that|apunta|anota|recuerda|guarda)\\b/i;"],
  ["Voice.addRoute(/^remember that\\b/, (m, sentence) => remember(sentence));",
   "Voice.addRoute(/^(?:remember that|apunta|anota|recuerda|guarda)\\b/, (m, sentence) => remember(sentence));\n" +
   "  Voice.addRoute(/^(?:nueva conversación|empezar de nuevo|olvida todo)$/, () => newConversation());\n" +
   "  Voice.addRoute(/^(?:cerrar|cierra|volver|vuelve|alejar|muéstramelo todo)$/, () => Focus.clear());\n" +
   "  Voice.addRoute(/^(?:muéstrame|enséñame|abre|ve a|vuela a|llévame a) (?:la nota |la cuenta |el |la |mi )?(.+)$/, (m) => {\n" +
   "    const want = m[1];\n" +
   "    const hit = nodes.find(n => n.label.toLowerCase() === want) || nodes.find(n => n.label.toLowerCase().includes(want)) || nodes.find(n => want.includes(n.label.toLowerCase()));\n" +
   "    if (!hit) return false;\n" +
   "    Focus.note(hit.id); Voice.speak(hit.label + \".\");\n" +
   "  });"],
  ["  document.head.appendChild(s);\n});\n", "  document.head.appendChild(s);\n});\nawait window.__graphReady;     // the second brain is built from the user's own data first\n"],
  OS.NODE_LABELS, OS.LABEL_FN,
]) html = must(html, a, b);
html = html.replace(/^<!doctype html>\s*<html[^>]*>\s*<head>\s*/i, "").replace(/<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\s*/i, "")
           .replace(/<\/head>\s*<body>/i, "").replace(/<\/body>\s*<\/html>\s*$/i, "");

let voice = read("viewer/voice.js");
for (const [a, b] of [
  ["const british = voices.filter(v => /^en[-_]GB/i.test(v.lang));", "const british = voices.filter(v => /^es[-_]ES/i.test(v.lang));"],
  ["return british.find(v => /google uk english|daniel|serena|arthur|kate|oliver|libby|ryan|sonia/i.test(v.name))",
   "return british.find(v => /jorge|mónica|monica|google español|álvaro|alvaro|elvira|pablo/i.test(v.name))"],
  ["|| voices.find(v => /^en[-_]/i.test(v.lang) && v.default) || voices.find(v => /^en[-_]/i.test(v.lang)) || null;",
   "|| voices.find(v => /^es[-_]/i.test(v.lang) && v.default) || voices.find(v => /^es[-_]/i.test(v.lang)) || null;"],
  ['u.lang = "en-GB";', 'u.lang = "es-ES";'],
  ['rec.lang = "en-GB";', 'rec.lang = "es-ES";'],
  ["      if (last) speak(last.text).then(last.resolve);", "      if (last && !helloed) speak(last.text).then(last.resolve); else if (last) last.resolve();"],
  ["  function unlock() {", "  let helloed = false;\n  function unlock() {"],
  ['"Click the mic and talk, or type below"', '"Toca el micrófono y habla, o escribe abajo"'],
  ['"Type below (this browser has no speech recognition)"', '"Escribe abajo o dicta con el micrófono del teclado"'],
  // iPad: one question per tap. Safari can't listen and speak at once, so the mic closes
  // when you stop talking, the question goes, and the answer is written and spoken.
  ["    rec.continuous = true;", "    rec.continuous = false;"],
  ["      if (state.listening) { try { rec.start(); } catch { stopListening(); } }", "      if (state.listening) stopListening();   // one question per tap"],
  ["    if (!Recognition || state.listening) return;\n    rec = new Recognition();", "    if (!Recognition || state.listening) return;\n    stopSpeaking();                         // a tap on the mic cuts Jarvis short\n    rec = new Recognition();"],
  ['"not-allowed": "Microphone blocked. Allow it in the address bar and try again."', '"not-allowed": "El micrófono está bloqueado en esta ventana. Toque otra vez el micrófono: abro el teclado, toque su 🎤 y hable. Lo envío yo solo."'],
  ['"service-not-allowed": "Microphone blocked by the browser."', '"service-not-allowed": "El iPad no deja reconocer la voz aquí. Activa Ajustes › General › Teclado › Dictado, o usa el micrófono del teclado."'],
  ['"audio-capture": "No microphone found."', '"audio-capture": "No encuentro el micrófono del iPad."'],
  ["network: \"Speech recognition needs the browser's speech service. Brave and some Chromium builds don't have it; use Chrome or Edge.\"", 'network: "El reconocimiento de voz necesita internet. Revisa la conexión y vuelve a tocar el micrófono."'],
  ["}[e.error] || `Speech recognition error: ${e.error}`;", "}[e.error] || `No he podido escucharle (${e.error}). Use el micrófono del teclado.`;"],
  ["set({ note: `Couldn't start the microphone: ${err.message}` });", "set({ note: \"No he podido abrir el micrófono. Use el micrófono del teclado.\" });"],
  ["      if (!Recognition) {\n        mic.disabled = true;\n        mic.title = \"This browser has no speech recognition. Use Chrome, Edge or Safari.\";\n      }",
   "      mic.title = \"Toca y habla: Jarvis te contesta por escrito y en voz alta\";\n      if (!Recognition) {\n        mic.onclick = () => set({ note: \"Aquí no puedo usar el micrófono de la página. Abre Jarvis en Safari, o usa el micrófono del teclado.\" });\n      }"],
  ['set({ note: "Stopped." })', 'set({ note: "Me callo." })'],
  ["      stopListening(why);", "      if (e.error === \"not-allowed\" || e.error === \"service-not-allowed\") window.dispatchEvent(new Event(\"jarvis-mic-blocked\"));\n      stopListening(why);"],
  // Read aloud like a person: no brackets, no "1!" contract suffix, and "30.075" is one number, not two sentences.
  ['    text = String(text || "").trim();', '    text = String(text || "").replace(/\\s*\\([^)]*\\)/g, "").replace(/([A-Z])1!/g, "$1").replace(/ · /g, ", ").replace(/↗/g, "").trim();'],
  ['const parts = text.replace(/\\s+/g, " ").match(/[^.!?;]+[.!?;]*\\s*/g) || [text];', 'const parts = text.replace(/\\s+/g, " ").match(/(?:[^.!?;]|[.,](?=\\d))+[.!?;]*\\s*/g) || [text];'],
  ['text = state.listening ? "Speaking… say “stop” to interrupt" : "Speaking…";', 'text = "Hablando… toque el micrófono para cortarme";'],
  ['"Didn\'t take that: I was talking. Say “stop” to interrupt me."', '"No le he oído bien: estaba hablando yo."'],
  ["`Listening: “${state.heard}”` : \"Listening…\"", "`Escuchando: “${state.heard}”` : \"Escuchando…\""],
  ['text = "Thinking…";', 'text = "Pensando…";'],
  ["  window.Voice = {\n    FINISH_MS,", "  // Spoken INSIDE the tap: iPad only lets a page talk after a deliberate gesture.\n  function hello(text) {\n    helloed = true;   // the test line replaces the waiting greeting\n    queued.splice(0).forEach((q) => q.resolve());\n    unlock();\n    if (!synth) return Promise.resolve(false);\n    stopSpeaking();\n    const u = new SpeechSynthesisUtterance(text || \"A su servicio, Joel.\");\n    const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = \"es-ES\"; }\n    u.volume = 1;\n    return new Promise((res) => {\n      let started = false;\n      u.onstart = () => { started = true; set({ speaking: true }); };\n      u.onend = () => { set({ speaking: false }); res(true); };\n      u.onerror = () => { set({ speaking: false }); res(started); };\n      if (!utter(u)) return res(false);\n      setTimeout(() => { if (!started && !synth.speaking) res(false); }, 2500);\n    });\n  }\n\n  window.Voice = {\n    hello, available: !!synth, FINISH_MS,"],
  // Tell the page when sound really started, so a silent iPad can offer the answer on a tap.
  ["        u.onend = u.onerror = () => { live.delete(u); done(); };", "        u.onstart = () => window.dispatchEvent(new Event(\"jarvis-spoke\"));\n        u.onend = u.onerror = () => { live.delete(u); done(); };"],
  // A silent line spoken inside a tap re-arms the iPad's voice for the answer that follows.
  ["    hello, available: !!synth, FINISH_MS,", "    hello, prime: () => { if (!synth) return; const p = new SpeechSynthesisUtterance(\" \"); p.volume = 0; utter(p); }, available: !!synth, FINISH_MS,"],
  // iPad: speech may only start inside a tap, and dictation in between breaks that. A silent line,
  // started in the tap and kept going, holds the voice open so the answer follows it without a tap.
  ["  function stopSpeaking() {", "  let awake = 0, chain = 0;\n  function keepAwake(ms = 90000) {\n    if (!synth || MUTED) return;\n    const running = awake > Date.now();\n    awake = Date.now() + ms;\n    if (running) return;\n    const id = ++chain;\n    const tick = () => {\n      if (id !== chain || awake <= Date.now()) { if (id === chain) awake = 0; return; }\n      const u = new SpeechSynthesisUtterance(\"silencio\"); u.volume = 0.01; u.rate = 0.6; u.lang = \"es-ES\";\n      live.add(u);\n      u.onend = () => { live.delete(u); tick(); };\n      u.onerror = () => { live.delete(u); if (id === chain) awake = 0; };\n      if (!utter(u)) awake = 0;\n    };\n    tick();\n  }\n  function stopSpeaking() {\n    if (awake > Date.now() && !state.speaking) { generation++; return; }   // only the silent line is playing: keep it\n    chain++; awake = 0;"],
  ["    stopSpeaking();\n    const gen = ++generation;", "    const holding = awake > Date.now();\n    chain++; awake = 0;                     // the silent line ends; the answer is queued right behind it\n    if (!holding) stopSpeaking();\n    const gen = ++generation;"],
  ["    hello, prime:", "    hello, keepAwake, prime:"],
]) voice = must(voice, a, b);

// ── 2. the second brain: graph from the user's data, and the in-page brain ──
const brain = String.raw`
window.GRAPH = { nodes: [], links: [] };
(() => {
  const TIPOS = { operacion: "Operaciones", idea: "Ideas", incidencia: "Incidencias", estrategia: "Estrategia", observacion: "Notas", enlace: "Enlaces", sesion: "Sesiones", analisis: "Análisis de trades" };
  // Your tools, each a star. A link you save hangs from its app by its address.
  const APPS = [
    ["tradingview", "TradingView", "https://www.tradingview.com/", /tradingview/i, "Tus gráficos y alertas de TradingView. Guarda aquí el enlace de cada gráfico o idea."],
    ["excalidraw", "Excalidraw", "https://excalidraw.com/", /excalidraw/i, "Tus dibujos y esquemas de Excalidraw. Guarda el enlace de cada dibujo."],
    ["miro", "Miro", "https://miro.com/app/dashboard/", /miro\.com|\bmiro\b/i, "Tus tableros de Miro, leídos con tu cuenta de Miro."],
    ["youtube", "YouTube", "https://www.youtube.com/", /youtube|youtu\.be/i, "Vídeos de YouTube: formación, ideas y tu canal."],
    ["instagram", "Instagram", "https://www.instagram.com/", /instagram/i, "Instagram: publicaciones, reels e ideas."],
    ["claude", "Apps de Claude", "https://claude.ai/", /claude\.ai\/artifact/i, "Las apps que Claude te ha creado: tus planes de futuros, paneles y Jarvis."],
  ];
  const PLANES = [
    ["MNQ · Short en apertura NY", "https://claude.ai/artifact/E1DdHdQFczDK3v5NzTLemi", "Tu plan de futuros: short en MNQ en la apertura de Nueva York."],
    ["Panel ilustrativo · MNQ apertura NY", "https://claude.ai/artifact/DqWNZBLFDCqKHdnCbmTS4Y", "Panel ilustrativo del MNQ en la apertura de Nueva York."],
    ["Esquema animado: long tras sweep de liquidez", "https://claude.ai/artifact/RXpQJAcHixo9uRj3soEYuN", "Esquema animado de un long después de un barrido de liquidez."],
    ["Backtesting Dashboard", "https://claude.ai/artifact/2JgieCMuWN8u8R3cv4gCsU", "Tu panel de backtesting."],
  ];
  // What runs on its own, set up by Joel with Claude. Jarvis on the page doesn't send these; it knows about them.
  const AVISOS = "Avisos automáticos de Joel (ya programados y funcionando; los envía Claude por su cuenta, no hace falta pedirlo): " +
    "1) Resumen diario de cuentas: de lunes a viernes hacia las 11:00 (hora de España), por notificación en el móvil y por email. Lee sus cuentas de Topstep (TS-2, TS-3 y TS-4): balance, beneficio, lo que falta para el objetivo de 3.000 $, margen de drawdown EOD de 2.000 $, consistencia del 50 % y avisos, más el precio del MNQ. " +
    "2) Cuentas, MNQ y vigilancia de límites: cada hora de lunes a viernes de 8:00 a 22:00 (hora de España): Jarvis lee de nuevo sus cuentas de Topstep (con sus operaciones) y el MNQ, así que lo que sabe tiene como mucho una hora en esas franjas. Además compara lo que lleva hoy cada cuenta viva con el límite de pérdida diaria y el objetivo diario de su pestaña Riesgo, y le avisa una vez al día de cada cosa (al 80 % del límite, al pasarlo y al llegar al objetivo): por notificación en el móvil y, si tiene Jarvis abierto, en voz. Es una vigilancia cada hora, no un stop: el límite de verdad lo pone él en TopstepX. Joel no tiene que registrar nada a mano de las cuentas de Topstep; los payouts y los exámenes se los puede dictar a Jarvis. " +
    "3) Pregunta de sesión: de lunes a viernes hacia las 12:00 (sesión de Londres) y hacia las 18:00 (sesión de Nueva York), una notificación en el móvil con sus cifras del día que le pregunta cómo le ha ido; Jarvis guarda su respuesta en el diario. Joel también puede mandar a Jarvis la foto de un trade con el botón 📷 para que se la analice. " +
    "Todos solo leen de Topstep: nunca operan ni tocan órdenes. Para cambiar la hora o los avisos, Joel se lo pide a Claude en la conversación donde los configuró.";
  const urlIn = (t) => (String(t || "").match(/https?:\/\/[^\s<>"']+/) || [])[0] || "";
  const B = window.BRAIN = { db: null, docs: { cuentas: new Map(), diario: new Map(), sistema: {}, topstep: null, mercado: null, checkin: null }, bodies: [], known: new Set(), byKey: {} };
  const words = (t) => String(t || "").split(/\s+/).filter(Boolean);
  const titleOf = (t) => { const w = words(t).filter((x, i) => i || !/^(que|el|la|los|las|un|una)$/i.test(x)).slice(0, 6).join(" ").replace(/[.,;:!?]+$/, "");
                           return (w[0] || "N").toUpperCase() + w.slice(1, 60) || "Nota"; };
  const fmt = (n) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "USD" }).format(n);

  function cuentaTexto(c) {
    const ts = c.topstepId && B.docs.topstep?.cuentas?.[c.topstepId];
    const bal = ts && isFinite(ts.balance) ? ts.balance : null;
    const parts = [c.firma ? "Cuenta de " + c.firma : "Cuenta", c.fase === "evaluacion" ? "en evaluación" : c.fase === "fondeada" ? "fondeada" : "", c.estado ? "(" + c.estado + ")" : ""].filter(Boolean).join(" ") + ".";
    const rules = [c.objetivo ? "Objetivo " + fmt(c.objetivo) : "", c.ddMax ? "drawdown " + fmt(c.ddMax) + (c.ddTipo === "eod" ? " EOD" : "") : "",
                   c.consistencia ? "consistencia " + c.consistencia + " %" : "", c.perdidaDiaria ? "pérdida diaria " + fmt(c.perdidaDiaria) : "sin límite diario"].filter(Boolean).join(", ");
    return [parts, bal != null ? "Balance según Topstep: " + fmt(bal) + "." : "", rules ? rules + "." : "", c.notas || ""].filter(Boolean).join(" ");
  }
  // The market prices Topstep gave the last update (fm/mercado), with how old they are: never passed off as live.
  B.mercadoTxt = (sim) => {
    const m = B.docs.mercado;
    if (!m || !m.simbolos) return "";
    const p = sim ? m.simbolos[sim] : null;
    if (sim && (!p || p.error)) return "";
    const min = Math.round((Date.now() - new Date(m.at)) / 60000);
    const hace = min < 2 ? "ahora mismo" : min < 90 ? "hace " + min + " minutos" : "hace " + Math.round(min / 60) + " horas";
    const lines = String(m.texto || "").split("\n").filter((l) => !sim || l.startsWith(sim + " "));
    return lines.join("\n") + " (Topstep, actualizado " + hace + "; no es en directo)";
  };
  function build() {
    const nodes = [], links = [], body = [];
    const add = (key, label, group, excerpt, text, url) => { const id = nodes.length; nodes.push({ id, label, group, path: "", excerpt, degree: 0, url: url || "" }); body.push(text || excerpt); B.byKey[key] = id; return id; };
    const link = (a, b, type = "mention") => { if (a == null || b == null || a === b) return; if (links.some((l) => (l.source === Math.min(a, b) && l.target === Math.max(a, b)))) return;
                                               links.push({ source: Math.min(a, b), target: Math.max(a, b), type }); nodes[a].degree++; nodes[b].degree++; };
    B.byKey = {};
    const jarvis = add("jarvis", "Jarvis", "Jarvis", "Tu segundo cerebro: tus cuentas, tu sistema y todo lo que me pidas que apunte.");
    const s = B.docs.sistema || {};
    const sisTxt = [s.estrategia ? "Estrategia: " + s.estrategia : "", s.reglas ? "Reglas: " + s.reglas : ""].filter(Boolean).join(" ") || "Aún sin definir. Escríbelo en Funding Manager → Mi sistema.";
    const sistema = add("sistema", "Mi sistema", "Sistema", sisTxt);
    link(jarvis, sistema);
    const cuentas = [...B.docs.cuentas.entries()].sort((a, b) => (a[1].alias || "").localeCompare(b[1].alias || ""));
    const firmas = {};
    for (const [, c] of cuentas) if (c.firma && !(c.firma in firmas)) {
      const lista = cuentas.filter(([, x]) => x.firma === c.firma).map(([, x]) => x.alias).join(", ");
      firmas[c.firma] = add("firma:" + c.firma, c.firma, "Firmas", "Firma de fondeo. Cuentas: " + lista + ".");
      link(jarvis, firmas[c.firma]);
    }
    for (const [id, c] of cuentas) {
      const n = add("cuenta:" + id, c.alias || "Cuenta", "Cuentas", cuentaTexto(c));
      link(n, c.firma ? firmas[c.firma] : jarvis);
    }
    for (const [k, label, url, , desc] of APPS) link(jarvis, add("app:" + k, label, "Apps", desc, desc + " " + label, url));
    link(add("avisos", "Avisos automáticos", "Sistema", AVISOS, AVISOS + " resumen reporte informe notificacion email correo 11:00 once mañana programado automatico avisos limite limites vigilancia"), jarvis);
    { const t = B.mercadoTxt("MNQ") || "El precio del MNQ llegará con la próxima actualización de Topstep.";
      link(add("mercado:MNQ", "MNQ", "Mercado", t, t + " MNQ Nasdaq precio mercado", "https://www.tradingview.com/chart/?symbol=" + encodeURIComponent("CME_MINI:MNQ1!")), B.byKey["app:tradingview"]); }
    for (const [label, url, desc] of PLANES) { const p = add("plan:" + url, label, "Planes de trading", desc, desc, url); link(p, B.byKey["app:claude"]); link(p, sistema); }
    const notas = [...B.docs.diario.entries()].sort((a, b) => (a[1].creado || "").localeCompare(b[1].creado || ""));
    for (const [id, d] of notas) placeNote(id, d, { nodes, links, add, link });
    for (const [id] of notas) B.known.add(id);
    B.bodies = body;
    return { nodes, links };
  }
  // One note -> one star, linked to its account, to accounts it mentions, and to Mi sistema for strategy.
  function placeNote(id, d, g) {
    const url = d.url || urlIn(d.texto);
    const clean = String(d.texto || "").replace(url, "").trim();
    const label = d.titulo || titleOf(clean || url.replace(/^https?:\/\/(www\.)?/, "")), group = TIPOS[d.tipo] || (url ? "Enlaces" : "Notas");
    const text = (d.texto || "") + (d.fecha ? " (" + d.fecha.split("-").reverse().join("/") + ")" : "");
    const n = g.add("nota:" + id, label, group, text, text, url);
    let linked = false;
    for (const [k, , , re] of APPS) if (re.test(url) || re.test(d.texto || "")) { g.link(n, B.byKey["app:" + k]); linked = true; }
    if (d.cuentaId && B.byKey["cuenta:" + d.cuentaId] != null) { g.link(n, B.byKey["cuenta:" + d.cuentaId]); linked = true; }
    const low = (d.texto || "").toLowerCase();
    for (const [cid, c] of B.docs.cuentas) if (c.alias && low.includes(c.alias.toLowerCase())) { g.link(n, B.byKey["cuenta:" + cid]); linked = true; }
    if (d.tipo === "estrategia" || /estrategia|regla|sistema|setup/.test(low)) { g.link(n, B.byKey.sistema); linked = true; }
    if (!linked) g.link(n, B.byKey.jarvis, "shared");
    return n;
  }
  // A new note born at runtime: the same rules, against the live graph, through galaxy.addNote.
  B.birth = (id, d) => {
    if (B.known.has(id) || !window.galaxy) return null;
    B.known.add(id);
    const G = window.GRAPH, newLinks = [];
    const g = { nodes: G.nodes, links: newLinks,
      add: (key, label, group, excerpt, text, url) => { const nid = G.nodes.length; B.byKey[key] = nid; B.bodies[nid] = text || excerpt; B._pending = { id: nid, label, group, path: "", excerpt, degree: 0, url: url || "" }; return nid; },
      link: (a, b, type = "mention") => { if (a == null || b == null || a === b || newLinks.some((l) => l.source === Math.min(a, b) && l.target === Math.max(a, b))) return;
                                          newLinks.push({ source: Math.min(a, b), target: Math.max(a, b), type }); } };
    const nid = placeNote(id, d, g);
    const node = B._pending; node.degree = newLinks.length;
    const anchor = newLinks.length ? (newLinks[0].source === nid ? newLinks[0].target : newLinks[0].source) : 0;
    return { index: nid, node, links: newLinks, anchor };
  };
  // Miro, read live with the viewer's own Miro account: each board becomes a star under Miro.
  B.loadMiro = async () => {
    const use = window.claude?.use ? window.claude.use.bind(window.claude) : null;
    const mcp = use ? await use("mcp") : null;
    if (!mcp || !window.galaxy) return "sin conexión";
    let boards;
    try { boards = (await mcp.callTool("Miro", "board_search_boards", { limit: 50 })).payload?.data || []; }
    catch (e) { return e && e.code === "server_not_connected" ? "Miro no está conectado en tu Claude" : "Miro no respondió"; }
    // Born beside the Miro star, so wait until the simulation has placed it.
    for (let i = 0; i < 100 && !isFinite(window.GRAPH.nodes[B.byKey["app:miro"]]?.x); i++) await new Promise((r) => setTimeout(r, 100));
    let n = 0, sin = 0;
    for (const bd of boards) {
      if (!bd.miro_url || B.byKey["miro:" + bd.miro_url] != null) continue;
      const G = window.GRAPH, nid = G.nodes.length, hub = B.byKey["app:miro"];
      const name = bd.name && bd.name !== "Sin título" ? bd.name : "Tablero sin título " + (++sin);
      const node = { id: nid, label: name, group: "Tableros Miro", path: "", excerpt: "Tablero de Miro: " + name + ".", degree: 1, url: bd.miro_url };
      B.byKey["miro:" + bd.miro_url] = nid; B.bodies[nid] = node.excerpt + " Miro";
      if (window.galaxy.addNote(node, [{ source: Math.min(hub, nid), target: Math.max(hub, nid), type: "mention" }], hub, { fly: false })) n++;
    }
    return n + " tableros";
  };
  // "Añadir enlace": the one door for links, same as a note, born as a star at once.
  B.saveLink = async (titulo, url) => {
    if (!B.db) return "Abre Jarvis dentro de Claude para guardarlo.";
    url = String(url || "").trim(); titulo = String(titulo || "").trim();
    if (!/^https?:\/\//i.test(url)) return "El enlace tiene que empezar por https://";
    const d = new Date(), fecha = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const doc = { texto: (titulo ? titulo + " " : "") + url, titulo, url, tipo: "enlace", cuentaId: "", fecha, creado: d.toISOString(), actualizado: d.toISOString() };
    const id = Math.random().toString(36).slice(2, 10);
    const born = B.birth(id, doc);
    try { await B.db.doc("fm/main").collection("diario").doc(id).set(doc); } catch (e) { B.known.delete(id); return "No se ha guardado: " + (e.message || "error"); }
    if (born) window.galaxy.addNote(born.node, born.links, born.anchor);
    return "Guardado.";
  };
  window.__graphReady = (async () => {
    const use = window.claude?.use ? window.claude.use.bind(window.claude) : null;
    const db = use ? await use("db") : null;
    B.db = db;
    if (db) {
      const first = (ref, apply) => new Promise((res) => {
        let done = false; const finish = () => { if (!done) { done = true; res(); } };
        ref.onSnapshot((snap) => { apply(snap); finish(); }, finish); setTimeout(finish, 8000);
      });
      const col = (name) => (snap) => { B.docs[name] = new Map(snap.docs.map((x) => [x.id, x.data()])); };
      await Promise.all([first(db.doc("fm/main").collection("cuentas"), col("cuentas")), first(db.doc("fm/main").collection("diario"), (snap) => {
          const before = B.docs.diario; col("diario")(snap);
          if (B.started) for (const [id, d] of B.docs.diario) if (!before.has(id)) { const r = B.birth(id, d); if (r) window.galaxy.addNote(r.node, r.links, r.anchor); }
        }), first(db.doc("fm/sistema"), (snap) => { B.docs.sistema = snap.exists ? snap.data() : {}; }),
        first(db.doc("fm/topstep"), (snap) => { B.docs.topstep = snap.exists ? snap.data() : null; }),
        first(db.doc("fm/checkin"), (snap) => { B.docs.checkin = snap.exists ? snap.data() : null; }),
        first(db.doc("fm/mercado"), (snap) => {
          B.docs.mercado = snap.exists ? snap.data() : null;
          const i = B.byKey["mercado:MNQ"], t = B.mercadoTxt("MNQ");
          if (B.started && i != null && t) { window.GRAPH.nodes[i].excerpt = t; B.bodies[i] = t + " MNQ Nasdaq precio mercado"; }
        })]);
    }
    window.GRAPH = build();
    B.started = true;
  })();

  // ── the brain: what server.mjs does, in the page, in Spanish ──
  const PERSONA = "Eres Jarvis, un mayordomo británico seco, impecablemente cortés y con un ingenio afilado. Eres el segundo cerebro de Joel, un trader que gestiona cuentas de fondeo (prop firms). " +
    "Hablas SIEMPRE en español de España; trátale de usted y llámale por su nombre, «Joel» (nunca otro nombre), como mucho una vez por respuesta, y no en todas.\n\n" +
    "Tus palabras se leen en voz alta y la nota ya está en su pantalla: una frase con ingenio si sale natural, y luego los hechos en una o dos frases. Sin markdown, sin listas, sin emojis. Nunca recites la nota entera.\n\n" +
    "Cada pregunta llega con un bloque <notas> (sus recuerdos más relevantes, numerados por índice) y un bloque <datos> con sus cuentas y cálculos ya hechos (drawdown, consistencia, plan del día), un bloque <avisos> con lo que ya está programado (si pregunta por informes, resúmenes o avisos, contéstale con eso: sí existen y funcionan), y un bloque <mercado> con el último precio que dio Topstep: al citarlo di siempre de qué hora es y nunca lo presentes como en directo; no predices el mercado ni recomiendas operaciones. En un mal día (pérdidas grandes, drawdown tocado, cuenta no operable) sé humano: primero una frase breve de apoyo, luego los hechos y una o dos lecciones, sin sermones. Responde SOLO con eso y con lo dicho antes. " +
    "Si no está, dilo con dignidad en una frase. Nunca inventes cifras, reglas de una firma ni noticias, y no predigas el mercado. Si una cuenta está cerca de un límite, dilo primero.\n\n" +
    "Solo puedes hablar: nunca digas que has guardado, enviado o cambiado nada (los payouts y exámenes que Joel dicta los guarda Jarvis antes de llegar a ti; si te llega uno, pídele la frase con la cantidad y la empresa, sin decir que solo puedes hablar). Para apuntar algo, dile que empiece la frase con «apunta que…». Para registrar operaciones, cuentas o la revisión del domingo, que te diga «llévame al Plan de Futuros» (se abre solo) o use su botón. En <datos>, «planDeFuturos» trae sus grupos (MAESTRA, GRUPO 1, GRUPO 2, SUPLENTES), cuentas, riesgo, operaciones y reglas de rotación, suplentes y pausa grupal: úsalo cuando pregunte por su plan, sus grupos o qué cuenta toca. Dentro, «vigilanciaHoy» dice cuánto lleva hoy cada cuenta viva de Topstep frente a su límite de pérdida y su objetivo diario (úsalo si pregunta cómo va con sus límites), y «fichaTopstepX» trae los valores que él mismo tiene que poner en los ajustes de riesgo de TopstepX y el multiplicador de su copiador (úsalo si pide la ficha o qué poner en Topstep). Jarvis solo lee Topstep: nunca digas que puedes cambiar ajustes, órdenes o límites allí. «capitalPropio» es su cuenta de capital propio en euros (riesgo compuesto sobre el saldo de hoy, stops máximos al día, racha): úsalo cuando pregunte por su capital propio, cuánto arriesga hoy o cuántos stops le quedan; para registrar un win o un loss, que te diga «llévame a Capital propio» (se abre solo). Dentro, «planDeDinero» son SUS reglas de dinero: cómo reparte cada payout (capital propio, más exámenes, para él, Hacienda), cuándo y cuánto retirar de capital propio, cuándo meter más y qué riesgo toca según cuánto ha crecido la cuenta; las cifras ya vienen calculadas: dalas tal cual y di que salen de su plan. «comoVoy» son las frases ya calculadas de cómo va su capital propio (qué pasa si la siguiente es TP o stop, con cuántos stops seguidos quema la cuenta según su plan, si ya puede retirar o cuánto le falta, si ya puede meter capital o cuánto le falta, y cuándo sube el riesgo): úsalas tal cual cuando pregunte cómo va, si puede retirar, meter capital o subir el riesgo; «payoutsDeFondeo» trae sus payouts con su reparto. «propuestaDeJarvis» es la propuesta de riesgo y plan calculada con sus datos (esperanza, Kelly a un cuarto, racha esperable): úsala si pide recomendación sin dar números nuevos, y dile que puede decir «aplícalo» o usar el botón «Aplicar la propuesta». Si pregunta qué porcentajes poner, explícale los pros y contras y que los cambia en Capital propio, sección «Plan de dinero»; lo de Hacienda, que lo confirme con un asesor. «fundingManager» son sus retiradas (payouts) y costes de examen por prop firm, con beneficio neto y ROI: úsalo cuando pregunte cuánto ha retirado, cuánto lleva gastado en exámenes o si le sale rentable una empresa; para apuntar una retirada o un coste, que te lo diga en una frase («regístrame la compra de un examen de Topstep de 50 dólares», «apunta el payout de 500 de TS-2») y Jarvis lo guarda solo; si quiere verlo, que diga «llévame al Funding Manager» y se abre solo. Nunca le digas que tiene que pinchar un botón: basta con pedírtelo.\n\n" +
    "Los saludos y agradecimientos reciben una línea breve en personaje y ninguna nota.\n\n" +
    "Después de cada respuesta añade una última línea: USED: y los índices de las notas en las que te has basado, separados por comas, o USED: none.";
  const STOP = new Set("a al algo como con cual cuales cuando de del desde donde dos el ella ellas ellos en entre era es esa ese eso esta este esto estos fue ha han hay la las le les lo los mas me mi mis muy no nos o para pero por que quien se ser si sin sobre su sus te tengo tiene tu tus un una uno unos y ya yo cuanto cuanta cuantos dime decir hacer puedo como va van esta estan the of and to is what".split(" "));
  const fold = (w) => w.length > 4 && w.endsWith("es") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w;
  const toks = (t) => (String(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9ñ]+/g) || []).filter((x) => x.length > 1 && !STOP.has(x)).map(fold);
  function rank(q) {
    const terms = new Set(toks(q)), scored = [];
    window.GRAPH.nodes.forEach((n, i) => {
      const tt = new Set(toks(n.label)), bt = toks(B.bodies[i] || "");
      let s = 0;
      for (const t of terms) { if (tt.has(t)) s += 5; const h = bt.filter((x) => x === t).length; if (h) s += 1 + Math.min(h, 4) * 0.5; }
      if (s) scored.push([s, i]);
    });
    return scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, 6).map((x) => x[1]);
  }
  const SMALL = /^(?:hola|buenas|buenos dias|buenos días|buenas tardes|buenas noches|gracias|muchas gracias|vale|ok|genial|perfecto|adios|adiós|hasta luego|que tal|qué tal|como estas|cómo estás|hey|hello|hi|thanks)\b[\s,.!?¡¿]*$/i;
  let history = [], last = [];
  function parse(text, picked) {
    const m = /\n?\s*USED:\s*(.*)\s*$/i.exec(text);
    if (!m) return [text.trim(), []];
    const cited = new Set((m[1].match(/\d+/g) || []).map(Number));
    return [text.slice(0, m.index).trim(), picked.filter((i) => cited.has(i))];
  }
  const WHY = { not_granted: "Necesito su permiso para usar Claude. Recargue la página y pulse Permitir.", rate_limited: "Ha llegado a su límite de uso de Claude por ahora. Pruebe en un rato.",
                session_expired: "Vuelva a iniciar sesión en Claude.", sampling_disabled: "Claude no está disponible en esta cuenta." };
  // "Ábreme TradingView en el MNQ": answered here, with a button to tap (iPad only opens a page from a tap).
  const SYMBOLS = [[/\bm\s*n\s*q\b|micro nasdaq/, "CME_MINI:MNQ1!", "MNQ1!"], [/\bn\s*q\b|nasdaq/, "CME_MINI:NQ1!", "NQ1!"],
    [/\bm\s*e\s*s\b|micro s\s*&?\s*p/, "CME_MINI:MES1!", "MES1!"], [/\bES\b|\be-?mini s\s*&?\s*p|s\s*&?\s*p\s*500|sp500/, "CME_MINI:ES1!", "ES1!"],
    [/\bm\s*y\s*m\b|micro dow/, "CBOT_MINI:MYM1!", "MYM1!"], [/\by\s*m\b|\bdow\b/, "CBOT_MINI:YM1!", "YM1!"],
    [/\bm\s*2\s*k\b|micro russell/, "CME_MINI:M2K1!", "M2K1!"], [/\br\s*t\s*y\b|russell/, "CME_MINI:RTY1!", "RTY1!"],
    [/\bm\s*g\s*c\b|micro oro/, "COMEX:MGC1!", "MGC1!"], [/\bg\s*c\b|\boro\b|gold/, "COMEX:GC1!", "GC1!"],
    [/\bm\s*c\s*l\b|micro petroleo/, "NYMEX:MCL1!", "MCL1!"], [/\bc\s*l\b|petroleo|crudo/, "NYMEX:CL1!", "CL1!"]];
  const OPEN = /\b(abre|abreme|abrir|abrid|abra|abrame|ensename|ensenam|muestrame|pon|ponme|llevame|ve a)\b/;
  function openRoute(question) {
    const q = String(question).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!OPEN.test(q)) return null;
    const N = window.GRAPH.nodes, app = APPS.find(([k, label]) => q.includes(label.toLowerCase()) || q.includes(k));
    let target = null, label = "";
    if (app && app[0] === "tradingview") {
      const front = (t) => t.replace(/([A-Za-z])1!?/g, "$1 ");   // MNQ1 / MNQ1! -> MNQ
      const sym = SYMBOLS.find(([re]) => re.test(front(re.source.startsWith("\\bES") ? question : q)));   // "es" is a Spanish word; only ES in capitals is the future
      target = sym ? "https://www.tradingview.com/chart/?symbol=" + encodeURIComponent(sym[1]) : app[2];
      label = sym ? "TradingView · " + sym[2] : "TradingView";
    } else {
      // a star with an address named in the question (a Miro board, a plan, a saved link), longest name first
      const fold = (t) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const hit = N.filter((n) => n.url && n.label.length > 3 && q.includes(fold(n.label))).sort((a, b) => b.label.length - a.label.length)[0];
      if (hit) { target = hit.url; label = hit.label; }
      else if (app) { target = app[2]; label = app[1]; }
    }
    if (!target) return null;
    const star = app ? B.byKey["app:" + app[0]] : N.findIndex((n) => n.url === target);
    B.openNext = { url: target, label };
    const precio = /precio|punto|cotiza|como esta|donde esta|nivel|va el|va la/.test(q) && label.startsWith("TradingView");
    return { answer: "Aquí tiene " + label + ", Joel: toque el botón para abrirlo." +
             (precio ? (() => { const t = B.mercadoTxt(label.replace(/^TradingView · /, "").replace(/1!$/, ""));
                return t ? " Según Topstep: " + t + "." : " Ese precio no lo tengo: Topstep solo me da el del MNQ, y TradingView no deja que Jarvis lea sus gráficos."; })() : ""),
             nodes: star >= 0 && star != null ? [star] : [], about_notes: false };
  }
  B.showOpen = () => {
    const o = B.openNext; B.openNext = null;
    document.getElementById("os-open-app")?.remove();
    if (!o) return;
    const a = document.createElement("a"); a.id = "os-open-app"; a.href = o.url; a.target = "_blank"; a.rel = "noopener";
    a.textContent = "Abrir " + o.label + " ↗";
    a.style.cssText = "display:inline-block;margin-top:10px;padding:8px 14px;border-radius:999px;background:var(--accent,#7aa7ff);color:#07101f;font-weight:600;text-decoration:none;pointer-events:auto";
    (document.querySelector("#answer .a")?.parentElement || document.getElementById("answer"))?.appendChild(a);
  };
  const hoyISO = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  B.checkinPending = () => { const c = B.docs.checkin; return c && !c.respondido && c.dia === hoyISO() ? c : null; };
  // Save a line in the diary (the same door as "apunta"): it becomes a star at once.
  B.saveNote = async (texto, tipo) => {
    if (!B.db) return null;
    const d = new Date();
    const doc = { texto, tipo, cuentaId: "", fecha: hoyISO(), creado: d.toISOString(), actualizado: d.toISOString() };
    const id = Math.random().toString(36).slice(2, 10);
    const born = B.birth(id, doc);
    try { await B.db.doc("fm/main").collection("diario").doc(id).set(doc); } catch (e) { B.known.delete(id); return null; }
    if (born) { B.bodies[born.index] = texto; window.galaxy.addNote(born.node, born.links, born.anchor); }
    return born;
  };
  // "Regístrame la compra de un examen de Topstep de 50 dólares" / "apunta el payout de 500 de TS-2": Claude reads the
  // details and Jarvis saves them in the Funding Manager (fm/retiradas/movs). If the amount or the firm is missing, Jarvis asks.
  const MOV_WHAT = /(examen|evaluaci[oó]n|challenge|combine|payout|retirada|retiro|reset|mensualidad|suscripci[oó]n|activaci[oó]n|cobro)/i;
  const MOV_DO = /(registr|apunt|anot|a[ñn]ad|mete|guard|compr[eéa]|he comprado|pagu[eé]|he pagado|cobr[eé]|he cobrado|me han pagado|retir[eé]|he retirado|he hecho)/i;
  const MOV_ASK = /^\s*¿?\s*(cu[aá]nt|qu[eé]\b|c[oó]mo|cu[aá]l|por qu[eé]|d[oó]nde|me sale|vale la pena)/i;
  B.pendingMov = null;
  const usd = (n) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "USD", minimumFractionDigits: 2, useGrouping: "always" }).format(n);
  async function movRoute(question, sample) {
    const q = String(question).trim();
    const pend = B.pendingMov && Date.now() - B.pendingMov.at < 5 * 60000 && q.length < 160 && !MOV_ASK.test(q) ? B.pendingMov : null;
    const f = q.normalize("NFD").replace(/[\u0300-\u036f]/g, "");                                     // «regístrame» = «registrame»
    if (!pend && (!(MOV_WHAT.test(q) || MOV_WHAT.test(f)) || !(MOV_DO.test(q) || MOV_DO.test(f)) || MOV_ASK.test(q) || MOV_ASK.test(f))) return null;
    if (!sample) return null;
    const hoy = hoyISO();
    const ask = "Extrae un movimiento para el Funding Manager de Joel (retiradas y costes de examen de prop firms) de su frase. Hoy es " + hoy + ".\n" +
      (pend ? "Ya sabías esto de antes: " + JSON.stringify(pend.mov) + ". Su frase nueva completa lo que faltaba.\n" : "") +
      "Responde SOLO con un JSON, sin texto alrededor: {\"tipo\": \"coste\" o \"retirada\", \"empresa\": nombre o null, \"subtipo\": texto, \"importe\": número positivo en dólares o null, \"fecha\": \"AAAA-MM-DD\", \"notas\": texto o \"\"}.\n" +
      "Reglas: comprar o pagar un examen, challenge, evaluación o combine es tipo coste con subtipo Registro (Mensualidad, Reset o Activación si lo dice). Un payout, retirada o cobro es tipo retirada con subtipo Payout. " +
      "Empresas: TopStep, Lucid, Tradeify, Apex u otra que diga; una cuenta TS-… es TopStep, L-… es Lucid, T-… es Tradeify, y la cuenta va en notas. Si no dice la empresa o el importe, pon null: no lo inventes. " +
      "«Ayer» es el día anterior a hoy; si no dice fecha, hoy.\n\nFrase: " + q;
    let mov;
    try { const { text } = await sample([{ role: "user", content: ask }], { cache: false, effort: "low" }); mov = JSON.parse((text.match(/\{[\s\S]*\}/) || ["null"])[0]); } catch { mov = null; }
    if (!mov || (mov.tipo !== "coste" && mov.tipo !== "retirada")) return pend ? (B.pendingMov = null, null) : null;
    const m = { tipo: mov.tipo, empresa: mov.empresa ? String(mov.empresa).trim() : (pend && pend.mov.empresa) || null,
                subtipo: String(mov.subtipo || (mov.tipo === "retirada" ? "Payout" : "Registro")), importe: Math.abs(Number(mov.importe)) || (pend && pend.mov.importe) || null,
                fecha: /^\d{4}-\d{2}-\d{2}$/.test(mov.fecha || "") ? mov.fecha : hoy, notas: String(mov.notas || "") };
    const que = m.tipo === "retirada" ? "el payout" : "el coste del examen";
    if (!m.importe || !m.empresa) {
      B.pendingMov = { mov: m, at: Date.now() };
      const pregunta = !m.importe ? "¿De cuánto fue " + que + (m.empresa ? " de " + m.empresa : "") + ", Joel?" : "¿De qué empresa es " + que + " de " + usd(m.importe) + ", Joel?";
      history.push({ role: "user", content: "Pregunta: " + q }, { role: "assistant", content: pregunta }); history = history.slice(-12);
      return { answer: !m.importe ? "¿De cuánto fue " + que + (m.empresa ? " de " + m.empresa : "") + ", Joel?" : "¿De qué empresa es " + que + " de " + usd(m.importe) + ", Joel?", nodes: [], about_notes: false };
    }
    B.pendingMov = null;
    if (!B.db) return { answer: "No puedo guardarlo: abra Jarvis dentro de Claude.", nodes: [], about_notes: false };
    try { await B.db.doc("fm/retiradas").collection("movs").doc().set({ ...m, creado: new Date().toISOString(), origen: "voz" }); }
    catch (e) { return { answer: "No se ha guardado el movimiento, Joel. Pruebe otra vez o apúntelo en el Funding Manager.", nodes: [], about_notes: false }; }
    const answer = "Hecho, Joel: he apuntado en el Funding Manager " + (m.tipo === "retirada" ? "un payout" : "un coste de examen") + " de " + m.empresa + " (" + m.subtipo + ") de " +
      usd(m.importe) + ", con fecha " + m.fecha.split("-").reverse().join("/") + (m.notas ? " · " + m.notas : "") + ". Si algo no está bien, lo puede cambiar o borrar allí." +
      (m.tipo === "retirada" && window.CAPITAL && window.CAPITAL.textoReparto ? " " + window.CAPITAL.textoReparto(m.importe) : "");
    history.push({ role: "user", content: "Pregunta: " + q }, { role: "assistant", content: answer }); history = history.slice(-12);
    return { answer, nodes: [], about_notes: false };
  }
  // "Llévame al Funding Manager", "ábreme el plan de futuros en riesgo", "enséñame mi capital propio": Jarvis opens its own panels.
  const GO = /\b(abre|abreme|abrir|abra|abrame|abrelo|llevame|lleva|llevar|ve a|vete a|vamos a|ir a|ensename|ensenam|muestrame|pon|ponme|entra|entrar|quiero ver|accede)\b/;
  const PANELS = [[/funding|retirad|payout|costes? de (los )?examen|gastos? de (los )?examen/, "funding", "el Funding Manager"],
    [/capital propio|plan de dinero|reparto/, "capital", "su Capital propio y su plan de dinero"],
    [/plan de futuros|\bel plan\b|\bmi plan\b|control maestro|riesgo|ficha|operaciones|semanas|calendario|grupos|dashboard|como estan (mis |las )?cuentas/, "plan", "el Plan de Futuros"]];
  const PLAN_TABS = [[/riesgo|ficha|limite/, "riesgo", "Riesgo"], [/operacion/, "operaciones", "Operaciones"], [/semana/, "semanas", "Semanas"], [/calendario/, "calendario", "Calendario"],
    [/grupo/, "grupos", "Grupos"], [/reglas/, "reglas", "Reglas"], [/domingo|revision semanal/, "domingo", "Domingo"], [/pestana (de )?cuentas|apartado (de )?cuentas|lista de cuentas/, "cuentas", "Cuentas"]];
  function panelRoute(question) {
    const q = String(question).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!GO.test(q)) return null;
    const p = PANELS.find(([re]) => re.test(q));
    if (!p) return null;
    let tab = null, donde = "";
    if (p[1] === "plan") { const t = PLAN_TABS.find(([re]) => re.test(q)); tab = t ? t[1] : "dashboard"; donde = t ? ", en " + t[2] : ""; }
    if (p[1] === "funding" && /empresa/.test(q)) { tab = "empresas"; donde = ", en Empresas"; }
    setTimeout(() => { const F = window.FM; if (!F) return; p[1] === "funding" ? F.openFunding(tab) : p[1] === "capital" ? F.openCapital() : F.open(tab); }, 400);
    return { answer: "Aquí tiene " + p[2] + donde + ", Joel." + (p[1] === "funding" ? " Para apuntar algo, también me lo puede dictar." : ""), nodes: [], about_notes: false };
  }
  // "Voy a empezar con 2.000 €, mi winrate es 75 y mi ratio 0,5: ¿qué me recomiendas?": Claude reads the numbers, Capital propio's
  // fixed formulas make the proposal, and «aplícalo» puts it in place.
  const PLAN_ASK = /(recomiend|recomenda|propon|propuesta|aconsej|que riesgo deberia|cuanto deberia arriesgar|hazme (el|un|mi) plan|calcula(me)? (el|un|mi) plan)/;
  const PLAN_ABOUT = /(capital|riesgo|plan|winrate|win rate|ratio|arriesg|stops?)/;
  const PLAN_APPLY = /^\s*(si|vale|ok|okay|de acuerdo|perfecto)?[\s,.!]*(aplica|aplicalo|aplicala|aplicar|hazlo|ponlo|guardalo|adelante)/;
  B.pendingPlan = null;
  async function planRoute(question, sample) {
    const f = String(question).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""), C = window.CAPITAL;
    if (!C || !C.recomendar) return null;
    if (B.pendingPlan && Date.now() - B.pendingPlan.at < 10 * 60000 && PLAN_APPLY.test(f)) {
      const rec = B.pendingPlan.rec; B.pendingPlan = null; C.aplicarPropuesta(rec);
      const answer = "Hecho, Joel: su Capital propio queda con un riesgo del " + String(rec.riesgo).replace(".", ",") + " %, " + rec.stops + " stops al día y el plan de escalones y retiros propuesto. Lo puede ver o cambiar en Capital propio.";
      history.push({ role: "user", content: "Pregunta: " + question }, { role: "assistant", content: answer }); history = history.slice(-12);
      return { answer, nodes: [], about_notes: false };
    }
    if (!PLAN_ASK.test(f) || !PLAN_ABOUT.test(f) || !sample) return null;
    const ask = "Saca de la frase de Joel los datos de su cuenta de capital propio. Responde SOLO con un JSON, sin texto alrededor, con números o null si no lo dice: " +
      "{\"saldoInicial\": euros, \"winrate\": porcentaje de 0 a 100, \"ratioTpSl\": lo que gana un acierto dividido por lo que pierde un fallo (\"ratio 0,31\" = 0.31; \"1 a 2\" o \"1:2\" riesgo:beneficio = 2), " +
      "\"opsPorDia\": operaciones al día, \"rachaMaxima\": su peor racha de pérdidas seguidas, \"maxPerdidaAceptada\": porcentaje máximo que acepta perder, \"margenSeguridad\": veces de margen}.\n\nFrase: " + question;
    let o = {};
    try { const { text } = await sample([{ role: "user", content: ask }], { cache: false, effort: "low" }); o = JSON.parse((text.match(/\{[\s\S]*\}/) || ["{}"])[0]) || {}; } catch { o = {}; }
    const dados = {}; for (const [k, v] of Object.entries(o)) if (v != null && Number.isFinite(Number(v)) && Number(v) > 0) dados[k] = Number(v);
    const rec = C.recomendar(dados), I = rec.inputs, P = rec.plan, n = (x) => String(x).replace(".", ",");
    B.pendingPlan = { rec, at: Date.now() };
    const supuesto = ["saldoInicial", "winrate", "ratioTpSl", "opsPorDia"].filter((k) => !(k in dados));
    const answer = rec.sinVentaja ? rec.porque + " Si aun así quiere guardar estos datos con riesgo mínimo, dígame «aplícalo»." :
      "Con " + Math.round(I.saldoInicial) + " euros, un winrate del " + n(I.winrate) + " % y un ratio de " + n(I.ratioTpSl) + ", le propongo: arriesgar el " + n(rec.riesgo) + " % por operación (unos " +
      Math.round(I.saldoInicial * rec.riesgo / 100) + " euros al empezar), como mucho " + rec.stops + " stops al día; subir " + n(P.subePuntos) + " puntos cada vez que la cuenta crezca un " + P.cadaPct + " %, hasta el " + n(P.riesgoMax) +
      " %; bajar un escalón y esperar para meter más capital si cae un " + P.bajaSiCae + " % desde su máximo; y retirar el " + P.pctRetiro + " % del beneficio cada mes. " + rec.porque +
      (supuesto.length ? " Lo que no me ha dicho lo he tomado de su Capital propio." : "") + " ¿Lo aplico? Dígame «aplícalo».";
    history.push({ role: "user", content: "Pregunta: " + question }, { role: "assistant", content: answer }); history = history.slice(-12);
    return { answer, nodes: [], about_notes: false };
  }
  async function chat(question) {
    document.getElementById("os-open-app")?.remove();
    const panel = panelRoute(question);
    if (panel) return panel;
    const opened = openRoute(question);
    if (opened) { setTimeout(B.showOpen, 600); return opened; }
    const sample = window.claude?.use ? await window.claude.use("sample") : null;
    if (!sample) throw new Error("Abra esta página dentro de Claude para que Jarvis pueda pensar.");
    if (!B.pendingImage) { const plan = await planRoute(question, sample); if (plan) return plan; }
    if (!B.pendingImage) { const mov = await movRoute(question, sample); if (mov) return mov; }
    const image = B.pendingImage; B.pendingImage = null;
    const ci = B.checkinPending();
    const small = !image && SMALL.test(question.trim());
    const picked = small ? [] : rank(question);
    for (const i of last) if (picked.length < 6 && !picked.includes(i) && i < window.GRAPH.nodes.length) picked.push(i);
    const N = window.GRAPH.nodes;
    const notas = picked.map((i) => '<nota index="' + i + '" titulo="' + N[i].label + '" grupo="' + N[i].group + '">\n' + (B.bodies[i] || N[i].excerpt) + "\n</nota>").join("\n\n") || "(ninguna nota coincide)";
    const datos = JSON.stringify({ ...(window.FM?.contexto ? window.FM.contexto() : {}), planDeFuturos: window.PLAN?.contexto ? window.PLAN.contexto() : null, capitalPropio: window.CAPITAL?.contexto ? window.CAPITAL.contexto() : null, fundingManager: window.FUNDING?.contexto ? window.FUNDING.contexto() : null });
    let extra = "";
    if (ci && !small) extra += "\n\n<sesion>\nEsta es la respuesta de Joel a la pregunta del día: «" + ci.pregunta + "». Comenta cómo le fue en la sesión de " + ci.sesion + " con sus cifras de hoy y sus reglas; si fue un mal día, primero una frase de apoyo y luego una o dos lecciones concretas.\n</sesion>";
    if (image) extra += "\n\n<foto>\nJoel te manda la captura de un trade suyo" + (question.replace(/^📷.*$/, "").trim() ? " con este comentario: " + question : "") + ". Mírala con atención: describe lo que ves (instrumento, temporalidad, entrada, stop, objetivo, contexto) sin inventar lo que no se ve, compáralo con su sistema y sus reglas, di qué hizo bien y qué mejoraría, y si fue una pérdida o un mal día, apóyale y dale una o dos lecciones para la próxima vez. No recomiendes operaciones futuras concretas ni predigas el mercado.\n</foto>";
    const turn = small ? "Charla, sin notas: " + question : "<notas>\n" + notas + "\n</notas>\n\n<datos>\n" + datos + "\n</datos>\n\n<avisos>\n" + AVISOS + "\n</avisos>\n\n<mercado>\n" + (B.mercadoTxt() || "(sin datos de mercado)") + "\n</mercado>" + extra + "\n\nPregunta: " + question;
    let text;
    try { ({ text } = await sample([{ role: "user", content: PERSONA }, ...history, { role: "user", content: turn }], image ? { cache: false, images: [image] } : { cache: false, effort: "low" })); }
    catch (e) { throw new Error(WHY[e && e.code] || "Jarvis no ha podido responder esta vez. Vuelva a intentarlo en un momento."); }
    const [answer, used] = parse(text, picked);
    // What Joel told about his session, and the advice on a trade photo, go in his diary.
    if (ci && !small) {
      B.docs.checkin = { ...ci, respondido: true };
      try { await B.db.doc("fm/checkin").update({ respondido: true, respuesta: question, respondidoEn: new Date().toISOString() }); } catch {}
      await B.saveNote("Sesión de " + ci.sesion + " (" + ci.dia.split("-").reverse().join("/") + "): " + question + " · Resultado del día: " + fmt(ci.total) + ".", "sesion");
    }
    if (image) await B.saveNote("Análisis de trade (" + hoyISO().split("-").reverse().join("/") + "): " + answer, "analisis");
    history.push({ role: "user", content: "Pregunta: " + question }, { role: "assistant", content: answer }); history = history.slice(-12);
    if (used.length) last = used;
    return { answer, nodes: used, about_notes: used.length > 0 };
  }
  async function remember(text) {
    const content = String(text).replace(/^\s*(?:remember that|apunta|anota|recuerda|guarda)(?:\s+que)?\b[\s,.:;]*/i, "").trim();
    if (!content) return [400, { ok: false, answer: "¿Qué desea que apunte, Joel?" }];
    if (!B.db) return [500, { ok: false, answer: "No puedo guardarlo: abra Jarvis dentro de Claude." }];
    const movSample = window.claude?.use ? await window.claude.use("sample") : null;
    const mov = await movRoute(String(text), movSample);   // with its verb: «apunta el payout…»
    if (mov) return [200, { ok: true, answer: mov.answer }];
    const low = content.toLowerCase();
    const hit = [...B.docs.cuentas.entries()].find(([, c]) => c.alias && low.includes(c.alias.toLowerCase()));
    const tipo = /estrategia|regla|setup/.test(low) ? "estrategia" : /idea/.test(low) ? "idea" : /error|fallo|problema|incidencia/.test(low) ? "incidencia" : /entr[eé]|oper[eé]|gan[eé]|perd[ií]|trade/.test(low) ? "operacion" : "observacion";
    const d = new Date(), fecha = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const doc = { texto: content[0].toUpperCase() + content.slice(1), tipo, cuentaId: hit ? hit[0] : "", fecha, creado: d.toISOString(), actualizado: d.toISOString() };
    const id = Math.random().toString(36).slice(2, 10);
    const r = B.birth(id, doc);                       // marks it known, so the live snapshot won't birth it twice
    try { await B.db.doc("fm/main").collection("diario").doc(id).set(doc); }
    catch (e) { B.known.delete(id); return [500, { ok: false, answer: "No se ha guardado: " + (e.message || "error") + "." }]; }
    if (!r) return [200, { ok: true, answer: "Apuntado, Joel." }];
    B.bodies[r.index] = doc.texto;
    history.push({ role: "user", content: "Apunta que " + content }, { role: "assistant", content: "[APUNTE] RECEIPT ok=true titulo=" + r.node.label + " index=" + r.index });
    return [200, { ok: true, answer: "Apuntado, Joel: " + r.node.label + ".", ...r }];
  }

  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url.startsWith("/")) return realFetch(input, init);
    const p = url.split("?")[0], body = init.body ? JSON.parse(init.body) : {};
    if (p === "/api/boot") { const h = new Date().getHours(); const hi = (h >= 6 && h < 14 ? "Buenos días" : h >= 14 && h < 21 ? "Buenas tardes" : "Buenas noches") + ", Joel.", ci = B.checkinPending();
      return json({ greeting: ci ? hi + " ¿Cómo le ha ido en la sesión de " + ci.sesion + "? Cuéntemelo cuando quiera." : hi }); }
    if (p === "/chat") { try { return json(await chat(String(body.question || "").slice(0, 2000))); } catch (e) { return json({ error: e.message, answer: "", nodes: [] }, 502); } }
    if (p === "/remember") { const [st, d] = await remember(String(body.text || "").slice(0, 4000)); return json(d, st); }
    if (p === "/action") {
      if (String(body.tag).toUpperCase() === "RESET") { history = []; last = []; return json({ answer: "Pizarra limpia, Joel.", nodes: [], about_notes: false, births: [], action: { tag: "RESET", ok: true } }); }
      return json({ answer: "Eso no puedo hacerlo desde aquí, Joel.", nodes: [], about_notes: false, births: [], action: { ok: false } });
    }
    if (p === "/teardown/start") return json({ ok: false, answer: "El taller de desmontaje necesita el Mac, Joel.", nodes: [], births: [], action: { tag: "TEARDOWN", ok: false } });
    return json({ error: "no disponible aquí" }, 404);
  };
})();
`;

// ── 3. the Funding Manager, inside a shadow root so its styles and the galaxy's never meet ──
const fm = fs.readFileSync(FM_SRC, "utf8");
const fmStyle = fm.slice(fm.indexOf("<style>") + 7, fm.indexOf("</style>"));
const fmMarkup = fm.slice(fm.indexOf("</style>") + 8, fm.indexOf("<script>"));
let fmScript = fm.slice(fm.indexOf("<script>") + 8, fm.lastIndexOf("</script>"));
// dark only, scoped to the host
const dark = /:root\[data-theme="dark"\] \{([\s\S]*?)\}/.exec(fmStyle)[1];
let css = fmStyle
  .replace(/:root \{[\s\S]*?--r: 12px;\n\}/, (m) => m.replace(":root {", ":host {"))
  .replace(/@media \(prefers-color-scheme: dark\) \{ :root:not\(\[data-theme="light"\]\) \{[\s\S]*?\} \}\n/, "")
  .replace(/:root\[data-theme="dark"\] \{[\s\S]*?\}\n/, `:host {${dark}}\n`)
  .replace("body { margin: 0;", ".fm-body { margin: 0; min-height: 100%;")
  .replace(/body::before \{[^}]*\}\n/, "")
  .replace("header.top { position: sticky; top: env(safe-area-inset-top, 0px);", "header.top { position: sticky; top: 0;");
if (/:root/.test(css)) throw new Error("FM css still has :root");
let markup = must(fmMarkup, '<h1>JARVIS <span>· FUNDING MANAGER</span></h1>', '<h1><button class="btn" id="fm-back" type="button">← Galaxia</button> FUNDING <span>MANAGER</span></h1>');
for (const [a, b] of [
  ["const $ = (s, el = document) => el.querySelector(s);", "const $ = (s, el = FMROOT) => el.querySelector(s);"],
  ['document.querySelectorAll(".msg.j")', 'FMROOT.querySelectorAll(".msg.j")'],
  ["renderTabs(); render(); window.scrollTo(0, 0);", "renderTabs(); render(); FMHOST.scrollTo(0, 0);"],
  ['const TABS = [["jarvis", "Jarvis"], ["panel", "Panel"],', 'const TABS = [["panel", "Panel"], ["jarvis", "Asistente"],'],
  ['localStorage.getItem("fm-tab") || "jarvis"; } catch {}\nif (!TABS.some(([k]) => k === S.tab)) S.tab = "jarvis";', 'localStorage.getItem("fm-tab") || "panel"; } catch {}\nif (!TABS.some(([k]) => k === S.tab)) S.tab = "panel";'],
  ["\nboot();\n", "\nboot();\nwindow.FM = { contexto };\n"],
]) fmScript = must(fmScript, a, b);
fmScript = fmScript.split("document.addEventListener(").join("FMROOT.addEventListener(");
if (/document\.(addEventListener|querySelector)/.test(fmScript)) throw new Error("FM script still reaches into document");

const cap = fs.readFileSync(CAP_SRC, "utf8");
const capCss = cap.slice(cap.indexOf("<style>") + 7, cap.indexOf("</style>"));
const capMarkup = cap.slice(cap.indexOf("</style>") + 8, cap.indexOf("<script>"));
const capScript = cap.slice(cap.indexOf("<script>") + 8, cap.lastIndexOf("</script>"));
if (/:root|document\.querySelector|document\.getElementById/.test(capCss + capScript)) throw new Error("Capital propio reaches outside its shadow root");
const fr = fs.readFileSync(FR_SRC, "utf8");
const frCss = fr.slice(fr.indexOf("<style>") + 7, fr.indexOf("</style>"));
const frMarkup = fr.slice(fr.indexOf("</style>") + 8, fr.indexOf("<script>"));
const frScript = fr.slice(fr.indexOf("<script>") + 8, fr.lastIndexOf("</script>"));
if (/:root|document\.querySelector|document\.getElementById/.test(frCss + frScript)) throw new Error("the Funding Manager reaches outside its shadow root");
const plan = fs.readFileSync(PLAN_SRC, "utf8");
const planCss = plan.slice(plan.indexOf("<style>") + 7, plan.indexOf("</style>"));
const planMarkup = plan.slice(plan.indexOf("</style>") + 8, plan.indexOf("<script>"));
const planScript = plan.slice(plan.indexOf("<script>") + 8, plan.lastIndexOf("</script>"));
if (/:root|document\.querySelector|document\.getElementById/.test(planCss + planScript)) throw new Error("the Plan reaches outside its shadow root");

const shell = `
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
  #fm-open { margin-top: 10px; border: 1px solid var(--line); background: rgba(10,14,24,.75); color: var(--accent); font: 600 13px/1 system-ui, sans-serif;
             letter-spacing: .06em; padding: 9px 14px; border-radius: 999px; cursor: pointer; pointer-events: auto; }
  #fm-open:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  #fm-host { position: fixed; inset: 0; z-index: 50; overflow-y: auto; background: #0e131b; -webkit-overflow-scrolling: touch; }
  #cap-host { position: fixed; inset: 0; z-index: 50; overflow-y: auto; background: #000; -webkit-overflow-scrolling: touch; }
  #fr-open { margin-top: 8px; border: 1px solid rgba(34,197,94,.45); background: rgba(10,14,24,.75); color: #4ade80; font: 600 13px/1 system-ui, sans-serif;
             letter-spacing: .06em; padding: 9px 14px; border-radius: 999px; cursor: pointer; pointer-events: auto; width: 100%; }
  #cap-open { margin-top: 8px; border: 1px solid rgba(0,217,145,.45); background: rgba(10,14,24,.75); color: #00D991; font: 600 13px/1 system-ui, sans-serif;
              letter-spacing: .06em; padding: 9px 14px; border-radius: 999px; cursor: pointer; pointer-events: auto; width: 100%; }
  #fr-host { position: fixed; inset: 0; z-index: 50; overflow-y: auto; background: #f1f4f9; -webkit-overflow-scrolling: touch; }
  #plan-host { position: fixed; inset: 0; z-index: 50; overflow-y: auto; background: #f1f4f9; -webkit-overflow-scrolling: touch; }
</style>
<div id="fm-host" hidden></div>
<div id="plan-host" hidden></div>
<div id="cap-host" hidden></div>
<div id="fr-host" hidden></div>
<script>
(() => {
const FMHOST = document.getElementById("fm-host");
const FMROOT = FMHOST.attachShadow({ mode: "open" });
FMROOT.innerHTML = ${JSON.stringify(`<style>${css}</style><div class="fm-body">${markup}</div>`).replace(/</g, "\\u003c")};
${fmScript}
// The Plan de Futuros is the panel Joel sees; the FM above keeps running unseen for its Topstep figures.
const PLANHOST = document.getElementById("plan-host");
const PROOT = PLANHOST.attachShadow({ mode: "open" });
PROOT.innerHTML = ${JSON.stringify(`<style>${planCss}</style>${planMarkup}`).replace(/</g, "\\u003c")};
window.__PLAN_ROOT = PROOT;
${planScript}
// Capital propio: the same way, in its own shadow root.
const CAPHOST = document.getElementById("cap-host");
const CROOT = CAPHOST.attachShadow({ mode: "open" });
CROOT.innerHTML = ${JSON.stringify(`<style>${capCss}</style>${capMarkup}`).replace(/</g, "\\u003c")};
window.__CAP_ROOT = CROOT;
${capScript}
const openCap = () => { CAPHOST.hidden = false; window.CAPITAL && window.CAPITAL.render(); };
const capBack = CROOT.getElementById("cp-back"); capBack.hidden = false; capBack.addEventListener("click", () => { CAPHOST.hidden = true; });
document.getElementById("cap-open").addEventListener("click", openCap);
window.FM.openCapital = openCap;
// Funding Manager (withdrawals and exam costs): the same way, in its own shadow root.
const FRHOST = document.getElementById("fr-host");
const FRROOT = FRHOST.attachShadow({ mode: "open" });
FRROOT.innerHTML = ${JSON.stringify(`<style>${frCss}</style>${frMarkup}`).replace(/</g, "\\u003c")};
window.__FR_ROOT = FRROOT;
${frScript}
const openFunding = (tab) => { FRHOST.hidden = false; window.FUNDING && window.FUNDING.open(typeof tab === "string" ? tab : null); };
const frBack = FRROOT.getElementById("fr-back"); frBack.hidden = false; frBack.addEventListener("click", () => { FRHOST.hidden = true; });
window.FM.openFunding = openFunding;
document.getElementById("fr-open").addEventListener("click", openFunding);
const open = (tab) => { PLANHOST.hidden = false; window.PLAN && window.PLAN.open(typeof tab === "string" ? tab : null); };
const close = () => { PLANHOST.hidden = true; FMHOST.hidden = true; CAPHOST.hidden = true; FRHOST.hidden = true; };
window.FM.open = open; window.FM.close = close;
const back = PROOT.getElementById("pf-back"); back.hidden = false; back.addEventListener("click", close);
FMROOT.getElementById("fm-back").addEventListener("click", close);
document.getElementById("fm-open").addEventListener("click", open);
})();
</script>`;

html = must(html, '<script>\n' /* first inline script */, "<script>\n");     // sanity
html = html.replace('<script src="graph-data.js"></script>', () => `<script>\n${brain}\n</script>`)
           .replace('<script src="voice.js"></script>', () => `<script>\n${voice}\n</script>`)
           .replace('<script src="intent.js"></script>', () => `<script>\n${read("viewer/intent.js")}\n</script>`);
if (/src="(graph-data|voice|intent)\.js"/.test(html)) throw new Error("a viewer script was not inlined");
html = html.replace('<div id="graph"></div>', '<div id="graph"></div>' + shell.replace(/<script>[\s\S]*<\/script>/, "") );
html += shell.match(/<script>[\s\S]*<\/script>/)[0];
html = html.replace('<div id="graph"></div>', '<div id="graph"></div>' + OS.CSS + OS.MARKUP) + OS.SCRIPT;
fs.writeFileSync(OUT, html);
console.log(`${OUT}: ${(html.length / 1024).toFixed(0)} KB`);
