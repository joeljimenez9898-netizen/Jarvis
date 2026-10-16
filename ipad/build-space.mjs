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
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const must = (s, a, b) => { if (!s.includes(a)) throw new Error("not found: " + a.slice(0, 90)); return s.split(a).join(b); };

// ── 1. the galaxy page, in Spanish, waiting for the user's data before it starts ──
let html = read("viewer/index.html");
for (const [a, b] of [
  ["<title>Knowledge Galaxy</title>", "<title>Jarvis</title>"],
  ["<h3>CONNECTED</h3>", "<h3>CONECTADO CON</h3>"],
  ['<div id="title"><h1>KNOWLEDGE GALAXY</h1><p id="stats"></p></div>',
   '<div id="title"><h1>JARVIS</h1><p id="stats"></p><button type="button" id="fm-open">Funding Manager</button></div>'],
  ["${nodes.length} notes indexed · ${links.length} connections · ${groups.length} groups", "${nodes.length} recuerdos · ${links.length} conexiones · ${groups.length} grupos"],
  ["`${greeting} ${nodes.length} notes indexed.`", "`${greeting} ${nodes.length} recuerdos en tu segundo cerebro.`"],
  ["`${nodes.length} notes indexed.`", "`${nodes.length} recuerdos en tu segundo cerebro.`"],
  ['placeholder="Ask your notes anything…"', 'placeholder="Pregunta a Jarvis o di «apunta que…»"'],
  ['aria-label="Question"', 'aria-label="Pregunta"'],
  ['title="Start a new conversation">New</button>', 'title="Empezar una conversación nueva">Nuevo</button>'],
  ['<button type="submit" id="send">Ask</button>', '<button type="submit" id="send">Preguntar</button>'],
  ['"Searching your notes"', '"Buscando en tu segundo cerebro"'],
  ['"Writing it down"', '"Apuntándolo"'],
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
  ['"Click the mic and talk, or type below"', '"Escribe abajo o dicta con el micrófono del teclado"'],
  ['"Type below (this browser has no speech recognition)"', '"Escribe abajo o dicta con el micrófono del teclado"'],
  ["`Listening: “${state.heard}”` : \"Listening…\"", "`Escuchando: “${state.heard}”` : \"Escuchando…\""],
  ['text = "Thinking…";', 'text = "Pensando…";'],
  ["  window.Voice = {\n    FINISH_MS,", "  // Spoken INSIDE the tap: iPad only lets a page talk after a deliberate gesture.\n  function hello(text) {\n    helloed = true;   // the test line replaces the waiting greeting\n    queued.splice(0).forEach((q) => q.resolve());\n    unlock();\n    if (!synth) return Promise.resolve(false);\n    stopSpeaking();\n    const u = new SpeechSynthesisUtterance(text || \"A su servicio, señor.\");\n    const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = \"es-ES\"; }\n    u.volume = 1;\n    return new Promise((res) => {\n      let started = false;\n      u.onstart = () => { started = true; set({ speaking: true }); };\n      u.onend = () => { set({ speaking: false }); res(true); };\n      u.onerror = () => { set({ speaking: false }); res(started); };\n      if (!utter(u)) return res(false);\n      setTimeout(() => { if (!started && !synth.speaking) res(false); }, 2500);\n    });\n  }\n\n  window.Voice = {\n    hello, available: !!synth, FINISH_MS,"],
]) voice = must(voice, a, b);

// ── 2. the second brain: graph from the user's data, and the in-page brain ──
const brain = String.raw`
window.GRAPH = { nodes: [], links: [] };
(() => {
  const TIPOS = { operacion: "Operaciones", idea: "Ideas", incidencia: "Incidencias", estrategia: "Estrategia", observacion: "Notas" };
  const B = window.BRAIN = { db: null, docs: { cuentas: new Map(), diario: new Map(), sistema: {}, topstep: null }, bodies: [], known: new Set(), byKey: {} };
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
  function build() {
    const nodes = [], links = [], body = [];
    const add = (key, label, group, excerpt, text) => { const id = nodes.length; nodes.push({ id, label, group, path: "", excerpt, degree: 0 }); body.push(text || excerpt); B.byKey[key] = id; return id; };
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
    const notas = [...B.docs.diario.entries()].sort((a, b) => (a[1].creado || "").localeCompare(b[1].creado || ""));
    for (const [id, d] of notas) placeNote(id, d, { nodes, links, add, link });
    for (const [id] of notas) B.known.add(id);
    B.bodies = body;
    return { nodes, links };
  }
  // One note -> one star, linked to its account, to accounts it mentions, and to Mi sistema for strategy.
  function placeNote(id, d, g) {
    const label = titleOf(d.texto), group = TIPOS[d.tipo] || "Notas";
    const text = (d.texto || "") + (d.fecha ? " (" + d.fecha.split("-").reverse().join("/") + ")" : "");
    const n = g.add("nota:" + id, label, group, text, text);
    let linked = false;
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
      add: (key, label, group, excerpt, text) => { const nid = G.nodes.length; B.byKey[key] = nid; B.bodies[nid] = text || excerpt; B._pending = { id: nid, label, group, path: "", excerpt, degree: 0 }; return nid; },
      link: (a, b, type = "mention") => { if (a == null || b == null || a === b || newLinks.some((l) => l.source === Math.min(a, b) && l.target === Math.max(a, b))) return;
                                          newLinks.push({ source: Math.min(a, b), target: Math.max(a, b), type }); } };
    const nid = placeNote(id, d, g);
    const node = B._pending; node.degree = newLinks.length;
    const anchor = newLinks.length ? (newLinks[0].source === nid ? newLinks[0].target : newLinks[0].source) : 0;
    return { index: nid, node, links: newLinks, anchor };
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
        first(db.doc("fm/topstep"), (snap) => { B.docs.topstep = snap.exists ? snap.data() : null; })]);
    }
    window.GRAPH = build();
    B.started = true;
  })();

  // ── the brain: what server.mjs does, in the page, in Spanish ──
  const PERSONA = "Eres Jarvis, un mayordomo británico seco, impecablemente cortés y con un ingenio afilado. Eres el segundo cerebro de tu señor, un trader que gestiona cuentas de fondeo (prop firms). " +
    "Hablas SIEMPRE en español de España; trátale de usted y llámale «señor» como mucho una vez por respuesta, y no en todas.\n\n" +
    "Tus palabras se leen en voz alta y la nota ya está en su pantalla: una frase con ingenio si sale natural, y luego los hechos en una o dos frases. Sin markdown, sin listas, sin emojis. Nunca recites la nota entera.\n\n" +
    "Cada pregunta llega con un bloque <notas> (sus recuerdos más relevantes, numerados por índice) y un bloque <datos> con sus cuentas y cálculos ya hechos (drawdown, consistencia, plan del día). Responde SOLO con eso y con lo dicho antes. " +
    "Si no está, dilo con dignidad en una frase. Nunca inventes cifras, reglas de una firma ni noticias, y no predigas el mercado. Si una cuenta está cerca de un límite, dilo primero.\n\n" +
    "Solo puedes hablar: nunca digas que has guardado, enviado o cambiado nada. Para apuntar algo, dile que empiece la frase con «apunta que…». Para registrar resultados o payouts, que use Funding Manager.\n\n" +
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
  async function chat(question) {
    const sample = window.claude?.use ? await window.claude.use("sample") : null;
    if (!sample) throw new Error("Abra esta página dentro de Claude para que Jarvis pueda pensar.");
    const small = SMALL.test(question.trim());
    const picked = small ? [] : rank(question);
    for (const i of last) if (picked.length < 6 && !picked.includes(i) && i < window.GRAPH.nodes.length) picked.push(i);
    const N = window.GRAPH.nodes;
    const notas = picked.map((i) => '<nota index="' + i + '" titulo="' + N[i].label + '" grupo="' + N[i].group + '">\n' + (B.bodies[i] || N[i].excerpt) + "\n</nota>").join("\n\n") || "(ninguna nota coincide)";
    const datos = window.FM?.contexto ? JSON.stringify(window.FM.contexto()) : "{}";
    const turn = small ? "Charla, sin notas: " + question : "<notas>\n" + notas + "\n</notas>\n\n<datos>\n" + datos + "\n</datos>\n\nPregunta: " + question;
    let text;
    try { ({ text } = await sample([{ role: "user", content: PERSONA }, ...history, { role: "user", content: turn }], { cache: false, effort: "low" })); }
    catch (e) { throw new Error(WHY[e && e.code] || "Jarvis no ha podido responder esta vez. Vuelva a intentarlo en un momento."); }
    const [answer, used] = parse(text, picked);
    history.push({ role: "user", content: "Pregunta: " + question }, { role: "assistant", content: answer }); history = history.slice(-12);
    if (used.length) last = used;
    return { answer, nodes: used, about_notes: used.length > 0 };
  }
  async function remember(text) {
    const content = String(text).replace(/^\s*(?:remember that|apunta|anota|recuerda|guarda)(?:\s+que)?\b[\s,.:;]*/i, "").trim();
    if (!content) return [400, { ok: false, answer: "¿Qué desea que apunte, señor?" }];
    if (!B.db) return [500, { ok: false, answer: "No puedo guardarlo: abra Jarvis dentro de Claude." }];
    const low = content.toLowerCase();
    const hit = [...B.docs.cuentas.entries()].find(([, c]) => c.alias && low.includes(c.alias.toLowerCase()));
    const tipo = /estrategia|regla|setup/.test(low) ? "estrategia" : /idea/.test(low) ? "idea" : /error|fallo|problema|incidencia/.test(low) ? "incidencia" : /entr[eé]|oper[eé]|gan[eé]|perd[ií]|trade/.test(low) ? "operacion" : "observacion";
    const d = new Date(), fecha = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const doc = { texto: content[0].toUpperCase() + content.slice(1), tipo, cuentaId: hit ? hit[0] : "", fecha, creado: d.toISOString(), actualizado: d.toISOString() };
    const id = Math.random().toString(36).slice(2, 10);
    const r = B.birth(id, doc);                       // marks it known, so the live snapshot won't birth it twice
    try { await B.db.doc("fm/main").collection("diario").doc(id).set(doc); }
    catch (e) { B.known.delete(id); return [500, { ok: false, answer: "No se ha guardado: " + (e.message || "error") + "." }]; }
    if (!r) return [200, { ok: true, answer: "Apuntado, señor." }];
    B.bodies[r.index] = doc.texto;
    history.push({ role: "user", content: "Apunta que " + content }, { role: "assistant", content: "[APUNTE] RECEIPT ok=true titulo=" + r.node.label + " index=" + r.index });
    return [200, { ok: true, answer: "Apuntado, señor: " + r.node.label + ".", ...r }];
  }

  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url.startsWith("/")) return realFetch(input, init);
    const p = url.split("?")[0], body = init.body ? JSON.parse(init.body) : {};
    if (p === "/api/boot") return json({ greeting: "Buenos días, señor." });
    if (p === "/chat") { try { return json(await chat(String(body.question || "").slice(0, 2000))); } catch (e) { return json({ error: e.message, answer: "", nodes: [] }, 502); } }
    if (p === "/remember") { const [st, d] = await remember(String(body.text || "").slice(0, 4000)); return json(d, st); }
    if (p === "/action") {
      if (String(body.tag).toUpperCase() === "RESET") { history = []; last = []; return json({ answer: "Pizarra limpia, señor.", nodes: [], about_notes: false, births: [], action: { tag: "RESET", ok: true } }); }
      return json({ answer: "Eso no puedo hacerlo desde aquí, señor.", nodes: [], about_notes: false, births: [], action: { ok: false } });
    }
    if (p === "/teardown/start") return json({ ok: false, answer: "El taller de desmontaje necesita el Mac, señor.", nodes: [], births: [], action: { tag: "TEARDOWN", ok: false } });
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

const shell = `
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
  #fm-open { margin-top: 10px; border: 1px solid var(--line); background: rgba(10,14,24,.75); color: var(--accent); font: 600 13px/1 system-ui, sans-serif;
             letter-spacing: .06em; padding: 9px 14px; border-radius: 999px; cursor: pointer; pointer-events: auto; }
  #fm-open:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  #fm-host { position: fixed; inset: 0; z-index: 50; overflow-y: auto; background: #0e131b; -webkit-overflow-scrolling: touch; }
</style>
<div id="fm-host" hidden></div>
<script>
(() => {
const FMHOST = document.getElementById("fm-host");
const FMROOT = FMHOST.attachShadow({ mode: "open" });
FMROOT.innerHTML = ${JSON.stringify(`<style>${css}</style><div class="fm-body">${markup}</div>`).replace(/</g, "\\u003c")};
${fmScript}
const open = () => { FMHOST.hidden = false; render(); };
const close = () => { FMHOST.hidden = true; };
window.FM.open = open; window.FM.close = close;
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
