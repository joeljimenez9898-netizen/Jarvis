// The "OS" layout: left inspector column, the brain in the middle, Jarvis HUD and filters on the right.
export const NODE_LABELS = [
  "    group.add(glow, core);\n    n.__core = core; n.__glow = glow;\n    return group;",
  `    group.add(glow, core);
    const tag = labelSprite(n.label, n.degree || 0);
    tag.position.set(0, size + 2.6, 0);
    group.add(tag);
    n.__core = core; n.__glow = glow; n.__tag = tag;
    return group;`,
];
export const LABEL_FN = [
  "  const sphere = new THREE.SphereGeometry(1, 20, 14);",
  `  const sphere = new THREE.SphereGeometry(1, 20, 14);
  // Every star carries its name, bigger for hubs, like a map of the brain.
  function labelSprite(text, degree) {
    const c = document.createElement("canvas"), ctx = c.getContext("2d"), fs = 44;
    ctx.font = \`600 \${fs}px ui-sans-serif, system-ui, sans-serif\`;
    const w = Math.ceil(ctx.measureText(text).width) + 24;
    c.width = w; c.height = fs + 22;
    ctx.font = \`600 \${fs}px ui-sans-serif, system-ui, sans-serif\`;
    ctx.fillStyle = "rgba(225,233,255,0.92)"; ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,.9)"; ctx.shadowBlur = 8;
    ctx.fillText(text, 12, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    const h = 2.6 + Math.min(4, Math.sqrt(degree) * 0.7);
    s.scale.set(h * c.width / c.height, h, 1);
    return s;
  }`,
];

export const CSS = `
<style>
  #os-left, #os-right { position: fixed; top: 12px; bottom: 12px; z-index: 4; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; scrollbar-width: none; }
  #os-left { left: 12px; width: 282px; } #os-right { right: 12px; width: 236px; }
  #os-left::-webkit-scrollbar, #os-right::-webkit-scrollbar { display: none; }
  .os-box { padding: 12px 14px; }
  .os-h { font-size: 10.5px; letter-spacing: .2em; text-transform: uppercase; color: var(--muted); margin: 0 0 8px; font-weight: 600; }
  #os-left #title { position: static; pointer-events: auto; }
  #os-left #title h1 { font-size: 15px; letter-spacing: .28em; color: var(--text); }
  #fm-open { margin-top: 10px; width: 100%; }
  #cap-open { width: 100%; }
  #os-search { width: 100%; box-sizing: border-box; background: rgba(255,255,255,.04); border: 1px solid var(--line); border-radius: 10px; color: var(--text);
               font: inherit; font-size: 13px; padding: 9px 11px; outline: none; }
  #os-search:focus, .os-in:focus { border-color: var(--accent); }
  .os-in { width: 100%; box-sizing: border-box; background: rgba(255,255,255,.04); border: 1px solid var(--line); border-radius: 10px; color: var(--text); font: inherit; font-size: 13px; padding: 9px 11px; outline: none; margin-bottom: 6px; }
  #os-link { display: flex; flex-direction: column; gap: 0; }
  #os-link .os-toggle { justify-content: center; text-transform: none; letter-spacing: 0; width: 100%; }
  #os-listen { display: inline-block; margin: 10px 8px 0 0; padding: 8px 14px; border-radius: 999px; border: 1px solid var(--accent); background: transparent; color: var(--text); font: inherit; font-size: 13px; pointer-events: auto; cursor: pointer; }
  #os-photo { display: grid; place-items: center; width: 42px; padding: 0; border-radius: 10px; border: 1px solid var(--line); background: rgba(255,255,255,.04); color: var(--text); font-size: 18px; cursor: pointer; }
  #os-photo[hidden] { display: none; }
  #os-listen.os-pulse { background: var(--accent); color: #07101f; animation: pulse 1.4s infinite; }
  .os-msg { font-size: 12px; color: var(--muted); min-height: 1em; margin-top: 4px; }
  #os-open-link { display: inline-block; margin: 10px 0 2px; padding: 7px 12px; border-radius: 999px; background: var(--accent); color: #07101f; font-weight: 600; font-size: 13px; text-decoration: none; }
  #os-results { margin-top: 6px; display: grid; gap: 2px; }
  .os-row { display: flex; align-items: center; gap: 8px; padding: 5px 6px; border-radius: 8px; cursor: pointer; font-size: 13px; color: var(--text); background: none; border: 0; width: 100%; text-align: left; font-family: inherit; }
  .os-row:hover, .os-row:focus-visible { background: rgba(255,255,255,.06); outline: none; }
  .os-row i { width: 8px; height: 8px; border-radius: 50%; flex: none; box-shadow: 0 0 8px currentColor; }
  .os-row span { margin-left: auto; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  #os-left #panel { position: static; transform: none; width: auto; inset: auto; padding: 0; border: 0; background: none; backdrop-filter: none; -webkit-backdrop-filter: none; overflow: visible; }
  #os-left #panel:not(.open) { display: none; }
  #os-left #panel.open + #os-insp-empty { display: none; }
  #os-left #panel h2 { font-size: 18px; margin: 4px 0 8px; }
  #os-left #panel .excerpt { font-size: 13px; }
  #os-left #close { top: -4px; right: -4px; }
  #os-insp-empty { font-size: 13px; color: var(--muted); line-height: 1.5; }
  .os-slider { display: grid; grid-template-columns: 82px 1fr; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); margin: 6px 0; }
  .os-slider input { width: 100%; accent-color: var(--accent); }
  #os-right #legend { position: static; padding: 12px 14px; }
  #os-hud { display: grid; justify-items: center; gap: 10px; padding: 16px 12px; }
  #os-ring { width: 150px; height: 150px; }
  #os-ring .r1 { transform-origin: 75px 75px; animation: osspin 14s linear infinite; }
  #os-ring .r2 { transform-origin: 75px 75px; animation: osspin 9s linear infinite reverse; }
  #os-ring .r3 { transform-origin: 75px 75px; animation: osspin 22s linear infinite; }
  #os-hud[data-mode="thinking"] .r1, #os-hud[data-mode="speaking"] .r1 { animation-duration: 2.5s; }
  #os-hud[data-mode="thinking"] .r2, #os-hud[data-mode="speaking"] .r2 { animation-duration: 1.8s; }
  @keyframes osspin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { #os-ring * { animation: none !important; } }
  .os-pill { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; padding: 5px 12px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); display: inline-flex; gap: 6px; align-items: center; }
  .os-pill b { width: 7px; height: 7px; border-radius: 50%; background: #5d6b8a; display: inline-block; }
  #os-hud[data-mode="listening"] .os-pill b { background: #7ef0c4; box-shadow: 0 0 8px #7ef0c4; }
  #os-hud[data-mode="thinking"] .os-pill b, #os-hud[data-mode="speaking"] .os-pill b { background: var(--accent); box-shadow: 0 0 8px var(--accent); }
  .os-toggle { display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 9px 12px; border-radius: 10px; border: 1px solid var(--line);
               background: rgba(255,255,255,.02); color: var(--text); font: inherit; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; cursor: pointer; margin-top: 6px; }
  .os-toggle span { color: var(--muted); letter-spacing: 0; text-transform: none; font-size: 12px; }
  .os-toggle[aria-pressed="true"] span { color: var(--accent); }
  #os-top { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 4; display: flex; gap: 6px; padding: 5px; }
  #os-top button, #os-drawers button { border: 0; background: none; color: var(--text); font: inherit; font-size: 12.5px; padding: 6px 12px; border-radius: 9px; cursor: pointer; }
  #os-top button:hover { background: rgba(255,255,255,.07); }
  #ask { left: calc(12px + 282px + 18px) !important; right: calc(12px + 236px + 18px); width: auto !important; transform: none !important; }
  #os-drawers { display: none; }
  @media (max-width: 1000px) {
    #os-left, #os-right { display: none; bottom: auto; max-height: calc(100% - 140px); }
    body.os-left-open #os-left, body.os-right-open #os-right { display: flex; }
    #ask { left: 16px !important; right: 16px; }
    #os-drawers { display: flex; position: fixed; top: 12px; left: 12px; right: 12px; justify-content: space-between; z-index: 5; pointer-events: none; }
    #os-drawers button { pointer-events: auto; background: rgba(10,14,24,.85); border: 1px solid var(--line); }
    body.os-left-open #os-drawers .l, body.os-right-open #os-drawers .r { color: var(--accent); }
    #os-left { top: 56px; } #os-right { top: 56px; }
    #os-top { top: 12px; }
  }
</style>`;

export const MARKUP = `
<aside id="os-left" aria-label="Panel del cerebro">
  <div class="glass os-box" id="os-brand"></div>
  <div class="glass os-box"><input id="os-search" type="search" placeholder="Busca en tu cerebro…" aria-label="Buscar en el cerebro" autocomplete="off"><div id="os-results"></div></div>
  <div class="glass os-box"><p class="os-h">Inspector</p><div id="os-insp"></div><div id="os-insp-empty">Toca una estrella para enfocarla: solo ella y sus conexiones se iluminan, y aquí puedes leer su nota.</div></div>
  <div class="glass os-box"><p class="os-h">Añadir enlace</p>
    <form id="os-link" autocomplete="off"><input id="os-link-t" class="os-in" placeholder="Título (ej. Gráfico MNQ 5m)" aria-label="Título del enlace">
    <input id="os-link-u" class="os-in" inputmode="url" placeholder="Pega el enlace: TradingView, YouTube, Excalidraw…" aria-label="Enlace">
    <button class="os-toggle" type="submit" style="justify-content:center">Guardar como estrella</button><div id="os-link-msg" class="os-msg"></div></form></div>
  <div class="glass os-box"><p class="os-h">Nodos principales</p><div id="os-hubs"></div></div>
  <div class="glass os-box"><p class="os-h">Fuerzas</p>
    <label class="os-slider">Repulsión<input id="os-repel" type="range" min="40" max="400" value="140"></label>
    <label class="os-slider">Longitud<input id="os-length" type="range" min="20" max="220" value="75"></label></div>
</aside>
<aside id="os-right" aria-label="Jarvis">
  <div class="glass" id="os-filter-box"><p class="os-h" style="padding:12px 14px 0">Filtro</p></div>
  <div class="glass" id="os-hud" data-mode="idle">
    <svg id="os-ring" viewBox="0 0 150 150" aria-hidden="true">
      <defs><linearGradient id="osg" x1="0" x2="1"><stop offset="0" stop-color="#b48cff"/><stop offset="1" stop-color="#6ea8ff"/></linearGradient></defs>
      <circle cx="75" cy="75" r="70" fill="none" stroke="rgba(180,140,255,.18)" stroke-width="1"/>
      <g class="r1"><circle cx="75" cy="75" r="64" fill="none" stroke="url(#osg)" stroke-width="3" stroke-dasharray="120 40 30 40 60 112" stroke-linecap="round"/></g>
      <g class="r2"><circle cx="75" cy="75" r="54" fill="none" stroke="#b48cff" stroke-width="1.5" stroke-dasharray="4 6" opacity=".8"/></g>
      <g class="r3"><circle cx="75" cy="75" r="45" fill="none" stroke="#6ea8ff" stroke-width="2" stroke-dasharray="60 20 10 20" opacity=".7"/></g>
      <circle cx="75" cy="75" r="34" fill="rgba(110,168,255,.08)" stroke="rgba(110,168,255,.35)"/>
      <text x="75" y="79" text-anchor="middle" fill="#e6ecff" font-size="11" font-weight="700" letter-spacing="3" font-family="ui-sans-serif, system-ui">J.A.R.V.I.S.</text>
    </svg>
    <span class="os-pill"><b></b><em id="os-mode" style="font-style:normal">En espera</em></span>
    <span class="os-pill" style="font-size:10px">Claude · tu cuenta</span>
    <div style="width:100%">
      <button class="os-toggle" id="os-voice">🔊 Voz <span>tocar para activar</span></button>
      <button class="os-toggle" id="os-labels" aria-pressed="true">Etiquetas <span>sí</span></button>
      <button class="os-toggle" id="os-fm">Plan de Futuros <span>abrir</span></button>
      <button class="os-toggle" id="os-cap">Capital propio <span>abrir</span></button>
      <button class="os-toggle" id="os-fr">Funding Manager <span>abrir</span></button>
      <button class="os-toggle" id="os-sq">TopStep Squad <span>abrir</span></button>
      <button class="os-toggle" id="os-avisos">⚠️ Avisos de hoy <span>—</span></button>
    </div>
  </div>
</aside>
<div id="os-top" class="glass"><button type="button" id="os-voice-top">🔊 Voz</button><button type="button" id="os-fit">◎ Ver todo</button><button type="button" id="os-new">Nueva conversación</button></div>
<div id="os-drawers"><button type="button" class="l">☰ Cerebro</button><button type="button" class="r">J.A.R.V.I.S. ◎</button></div>`;

export const SCRIPT = `
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const MODES = { idle: "En espera", listening: "Escuchando", thinking: "Pensando", speaking: "Hablando" };
  function start() {
    const g = window.galaxy;
    if (!g) return setTimeout(start, 200);
    const { Graph, Focus } = g, N = () => window.GRAPH.nodes;
    $("os-brand").appendChild($("title"));
    $("os-insp").appendChild($("panel"));
    $("os-insp").appendChild($("os-insp-empty"));
    $("os-filter-box").appendChild($("legend"));
    const dot = (n) => '<i style="background:var(--c);color:var(--c)"></i>';
    const colourOf = (n) => (n.__core && n.__core.material && "#" + n.__core.material.color.getHexString()) || "#6ea8ff";
    const row = (n, extra) => { const b = document.createElement("button"); b.type = "button"; b.className = "os-row";
      b.innerHTML = dot(n) + '<b style="font-weight:400"></b>' + (extra != null ? "<span>" + extra + "</span>" : "");
      b.querySelector("b").textContent = n.label; b.style.setProperty("--c", colourOf(n)); b.onclick = () => Focus.note(n.id); return b; };
    function hubs() {
      const box = $("os-hubs"); box.replaceChildren();
      [...N()].sort((a, b) => (b.degree || 0) - (a.degree || 0)).slice(0, 8).forEach((n) => box.appendChild(row(n, n.degree || 0)));
    }
    hubs(); setInterval(hubs, 5000);
    $("os-search").addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase(), box = $("os-results"); box.replaceChildren();
      if (!q) return;
      const B = window.BRAIN;
      N().map((n, i) => [n, (n.label.toLowerCase().includes(q) ? 2 : 0) + ((B && B.bodies[i] || n.excerpt || "").toLowerCase().includes(q) ? 1 : 0)])
        .filter(([, s]) => s).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([n]) => box.appendChild(row(n)));
      if (!box.children.length) box.innerHTML = '<div class="os-row" style="cursor:default;color:var(--muted)">Nada con eso en tu cerebro.</div>';
    });
    $("os-search").addEventListener("keydown", (e) => { if (e.key === "Enter") { const f = $("os-results").querySelector("button"); f && f.click(); } });
    const reheat = () => Graph.d3ReheatSimulation();
    $("os-repel").addEventListener("input", (e) => { Graph.d3Force("charge").strength(-Number(e.target.value)); reheat(); });
    $("os-length").addEventListener("input", (e) => { const v = Number(e.target.value); Graph.d3Force("link").distance((l) => (l.type === "mention" ? v : v * 1.7)); reheat(); });
    $("os-labels").addEventListener("click", (e) => {
      const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
      e.currentTarget.setAttribute("aria-pressed", on); e.currentTarget.querySelector("span").textContent = on ? "sí" : "no";
      N().forEach((n) => { if (n.__tag) n.__tag.visible = on; });
    });
    $("os-fm").addEventListener("click", () => window.FM && window.FM.open());
    $("os-cap").addEventListener("click", () => window.FM && window.FM.openCapital && window.FM.openCapital());
    $("os-fr").addEventListener("click", () => window.FM && window.FM.openFunding && window.FM.openFunding());
    // Today's limit warnings, kept in Jarvis: what the hourly watch found (fm/topstep vigilancia), read again whenever he asks.
    const AVISOS = window.AVISOS = (() => {
      const dia = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(new Date(t).getTime() + 7 * 3600 * 1000));
      const usd = (n) => (n < 0 ? "−" : "") + Math.abs(n).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" }) + " $";
      const hoy = () => { const v = window.BRAIN && window.BRAIN.docs && window.BRAIN.docs.topstep && window.BRAIN.docs.topstep.vigilancia;
        return v && Array.isArray(v.cuentas) && v.fecha === dia(Date.now()) ? v : null; };
      const frase = (f) => f.nivel === "dll100" ? "🛑 " + f.cuenta + " ha pasado su límite de pérdida diaria: lleva " + usd(f.hoy) + " hoy (límite " + usd(-f.limitePerdida) + "). Tu plan dice parar."
        : f.nivel === "dll80" ? "⚠️ " + f.cuenta + " lleva " + usd(f.hoy) + " hoy: está al " + Math.round((-f.hoy / f.limitePerdida) * 100) + " % de su límite de pérdida diaria (" + usd(-f.limitePerdida) + ")."
        : "🎯 " + f.cuenta + " ha llegado a su objetivo del día: lleva " + usd(f.hoy) + " (objetivo " + usd(f.objetivo) + "). Tu plan dice cerrar.";
      // plus what his own rules say now (Plan de Futuros: 2 bullets, strong day + minimum days), the same the hourly watch sends to his phone
      const reglas = () => (window.PLAN && window.PLAN.avisos ? window.PLAN.avisos().map((a) => a.txt) : []);
      const lista = () => { const v = hoy(); return [...(v ? v.cuentas.filter((f) => f.nivel).map(frase) : []), ...reglas()]; };
      const texto = () => {
        const v = hoy();
        if (!v) return reglas().length ? "Avisos de tus reglas, Joel:\\n" + reglas().join("\\n") : "Hoy todavía no hay ninguna comprobación de tus cuentas, Joel. Jarvis las mira cada hora de 8:00 a 22:00, de lunes a viernes.";
        const hora = new Date(v.at).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" }), L = lista();
        const resto = v.cuentas.filter((f) => !f.nivel).map((f) => f.cuenta + " " + usd(f.hoy)).join(", ");
        return (L.length ? "Avisos de hoy, Joel:\\n" + L.join("\\n") : "Sin avisos hoy, Joel: todas tus cuentas están dentro de sus límites y ninguna regla ha saltado.") +
          (resto ? "\\n" + (L.length ? "El resto, dentro de sus límites: " : "Hoy llevan: ") + resto + "." : "") + "\\nÚltima comprobación: " + hora + " (hora de España).";
      };
      const mostrar = () => {
        const t = texto(), card = $("answer");
        card.className = "glass show";
        card.querySelector(".q").textContent = "Jarvis · avisos de hoy";
        card.querySelector(".chips").replaceChildren();
        const a = card.querySelector(".a"); a.style.whiteSpace = "pre-line"; a.textContent = t;
        if (window.Voice) { Voice.stopSpeaking && Voice.stopSpeaking(); Voice.speak(t.replace(/[🛑⚠️🎯✅🏁💪💰⏭⏸🩹📅]/gu, "").replace(/\\$/g, "dólares")); }
        return t;
      };
      setInterval(() => { const b = $("os-avisos"); if (!b) return; const n = lista().length; b.querySelector("span").textContent = hoy() || n ? (n ? n + (n === 1 ? " aviso" : " avisos") : "sin avisos") : "—";
        b.style.borderColor = n ? "#ff7b6b" : ""; }, 4000);
      return { lista, texto, mostrar };
    })();
    $("os-avisos").addEventListener("click", () => AVISOS.mostrar());
    // Inspector: a star with an address gets a button that opens it in its app.
    const panel = $("panel");
    const showLink = () => {
      let a = $("os-open-link");
      const id = g.Focus && g.Focus.current, n = id != null ? N()[id] : null;
      if (!n || !n.url || !panel.classList.contains("open")) { if (a) a.remove(); return; }
      if (!a) { a = document.createElement("a"); a.id = "os-open-link"; a.target = "_blank"; a.rel = "noopener"; }
      if (a.getAttribute("href") !== n.url) { a.href = n.url; a.textContent = "Abrir ↗"; }
      const ex = $("p-excerpt");
      if (ex && a.previousElementSibling !== ex) ex.after(a);   // only move it when needed: the observer sees our own insert
    };
    new MutationObserver(showLink).observe(panel, { attributes: true, childList: true, subtree: true, attributeFilter: ["class"] });
    $("os-link").addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = $("os-link-msg"); msg.textContent = "Guardando…";
      msg.textContent = await window.BRAIN.saveLink($("os-link-t").value, $("os-link-u").value);
      if (msg.textContent === "Guardado.") { $("os-link-t").value = ""; $("os-link-u").value = ""; }
    });
    if (window.BRAIN && window.BRAIN.loadMiro) window.BRAIN.loadMiro().then((s) => { const h = document.querySelector("#os-hubs"); if (h) h.title = "Miro: " + s; });
    // Where the page can't use the microphone (Claude's frame blocks it), the mic button opens the
    // keyboard instead: tap its 🎤, speak, and the question goes by itself when the dictation pauses.
    let micBlocked = false;
    try { micBlocked = localStorage.getItem("jarvis-mic-blocked") === "1"; } catch {}
    const q = $("q");
    window.addEventListener("jarvis-mic-blocked", () => { micBlocked = true; try { localStorage.setItem("jarvis-mic-blocked", "1"); } catch {} });
    let dictating = false;
    document.addEventListener("click", (e) => {
      if (!micBlocked || !e.target.closest || !e.target.closest("#mic")) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (window.Voice) { Voice.stopSpeaking(); Voice.keepAwake && Voice.keepAwake(); }
      dictating = true; q.value = ""; q.focus();          // focus inside the tap: iPad opens the keyboard
      window.Voice && Voice.setNote("Toque el 🎤 del teclado y hable. Cuando haga una pausa, se lo envío.");
    }, true);
    // Watch the box itself, not its events: iPad dictation doesn't always fire them. Words arriving
    // several letters at a time are dictation (typing adds one), so it counts even without the page mic.
    let last = "", still = 0;
    setInterval(() => {
      const v = q.value;
      if (document.activeElement !== q) { last = v; still = 0; return; }
      if (v !== last) { if (v.length - last.length >= 4) dictating = true; last = v; still = 0; return; }
      if (!dictating || !v.trim()) return;
      still += 300;
      if (still >= 2100) { dictating = false; still = 0; last = ""; q.blur(); $("send").click(); }
    }, 300);
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") dictating = false; });
    q.addEventListener("pointerdown", () => { window.Voice && Voice.keepAwake && Voice.keepAwake(); });   // each tap holds the voice open for the answer
    // Every answer gets a "🔊 Escuchar" button. If the iPad stayed silent, it lights up: a tap always plays.
    let spokeAt = 0, shown = "";
    window.addEventListener("jarvis-spoke", () => { spokeAt = Date.now(); const b = $("os-listen"); if (b) b.classList.remove("os-pulse"); });
    const answerA = document.querySelector("#answer .a");
    const listenBtn = () => {
      const text = answerA.textContent.trim();
      if (!text || text === shown || document.getElementById("answer").classList.contains("thinking")) return;
      shown = text;
      let b = $("os-listen");
      if (!b) { b = document.createElement("button"); b.type = "button"; b.id = "os-listen"; b.textContent = "🔊 Escuchar";
        b.onclick = () => { b.classList.remove("os-pulse"); window.Voice && Voice.speak(answerA.textContent); };
        document.getElementById("answer").appendChild(b); }
      const at = Date.now();
      // Silent after dictation? The iPad sometimes drops the first line while the mic hands back the
      // speaker: say it once more by itself, and only then offer the button.
      setTimeout(() => { if (spokeAt < at && window.Voice && !Voice.MUTED && answerA.textContent.trim() === text) Voice.speak(text); }, 3000);
      setTimeout(() => { if (spokeAt < at && window.Voice && !Voice.MUTED) { unheard = text; b.classList.add("os-pulse"); Voice.setNote("Toque en cualquier sitio y se lo leo."); } }, 6500);
    };
    new MutationObserver(listenBtn).observe(document.getElementById("answer"), { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    // A tap anywhere plays an answer the iPad kept silent (a tap is the one thing it always allows).
    let unheard = "";
    document.addEventListener("pointerdown", (e) => {
      if (!unheard || !window.Voice || (e.target.closest && e.target.closest("#mic, #q, #os-listen, #os-photo, #send"))) return;
      const t = unheard; unheard = ""; $("os-listen")?.classList.remove("os-pulse"); Voice.speak(t);
    }, true);
    window.addEventListener("jarvis-spoke", () => { unheard = ""; });
    // The session question (fm/checkin) arrives while Jarvis is open: it appears on the answer card and Jarvis says it aloud.
    // On a fresh page load the boot greeting already carries it, so only a question that lands later is announced here.
    { const t0 = Date.now(); let announced = null;
      setInterval(() => {
        const B = window.BRAIN, c = B && B.checkinPending && B.checkinPending();
        if (!c || c.at === announced) return;
        if (announced === null && Date.now() - t0 < 12000) { announced = c.at; return; }
        announced = c.at;
        const card = $("answer");
        card.className = "glass show";
        card.querySelector(".q").textContent = "Jarvis · sesión de " + c.sesion;
        card.querySelector(".chips").replaceChildren();
        card.querySelector(".a").textContent = c.pregunta;
        if (window.Voice) { Voice.stopSpeaking && Voice.stopSpeaking(); Voice.speak(c.pregunta); }
      }, 3000); }
    // Daily-limit warnings (fm/topstep vigilancia, written by the hourly read): Jarvis says each one aloud once a day while it is
    // open, and on opening it says the ones not heard yet. If the iPad keeps it silent, the answer card's 🔊 / tap-anywhere plays it.
    { const t0 = Date.now(), KEY = "jarvis-avisos-oidos";
      const usd = (n) => Math.abs(n).toLocaleString("es-ES", { maximumFractionDigits: 0 }) + " dólares";
      const said = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
      setInterval(() => {
        const v = window.BRAIN && window.BRAIN.docs && window.BRAIN.docs.topstep && window.BRAIN.docs.topstep.vigilancia;
        if (!v || !Array.isArray(v.cuentas) || Date.now() - t0 < 12000) return;          // after the greeting
        if (Date.now() - new Date(v.at).getTime() > 12 * 3600000) return;                  // only today's watch
        const heard = said(), nuevos = v.cuentas.filter((f) => f.nivel && !heard.includes(v.fecha + ":" + f.cuenta + ":" + f.nivel));
        if (!nuevos.length || document.getElementById("answer").classList.contains("thinking")) return;
        const frases = nuevos.map((f) => f.nivel === "dll100" ? f.cuenta + " ha pasado su límite de pérdida diaria: lleva menos " + usd(f.hoy) + " hoy, y su límite es " + usd(f.limitePerdida) + ". Su plan dice que pare."
          : f.nivel === "dll80" ? f.cuenta + " lleva menos " + usd(f.hoy) + " hoy: está al " + Math.round((-f.hoy / f.limitePerdida) * 100) + " por ciento de su límite de pérdida diaria, que es " + usd(f.limitePerdida) + "."
          : f.cuenta + " ha llegado a su objetivo del día: lleva " + usd(f.hoy) + ". Su plan dice que cierre.");
        try { localStorage.setItem(KEY, JSON.stringify([...heard, ...nuevos.map((f) => v.fecha + ":" + f.cuenta + ":" + f.nivel)].slice(-60))); } catch {}
        const texto = "Aviso de límites, Joel. " + frases.join(" ");
        const card = $("answer");
        card.className = "glass show";
        card.querySelector(".q").textContent = "Jarvis · vigilancia de límites";
        card.querySelector(".chips").replaceChildren();
        card.querySelector(".a").textContent = texto;
        if (window.Voice) { Voice.stopSpeaking && Voice.stopSpeaking(); Voice.speak(texto); }
      }, 4000); }
    // His rules (Plan de Futuros): each new warning is said once while Jarvis is open (the hourly watch also sends it to his phone).
    { const t0 = Date.now(), KEY = "jarvis-reglas-oidas";
      setInterval(() => {
        const P = window.PLAN; if (!P || !P.avisos || Date.now() - t0 < 15000) return;
        if (document.getElementById("answer").classList.contains("thinking")) return;
        let heard = []; try { heard = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch {}
        const nuevos = P.avisos().filter((a) => !heard.includes(a.key));
        if (!nuevos.length) return;
        try { localStorage.setItem(KEY, JSON.stringify([...heard, ...nuevos.map((a) => a.key)].slice(-80))); } catch {}
        const texto = "Joel, tus reglas. " + nuevos.map((a) => a.txt).join(" "), card = $("answer");
        card.className = "glass show";
        card.querySelector(".q").textContent = "Jarvis · tus reglas";
        card.querySelector(".chips").replaceChildren();
        card.querySelector(".a").textContent = texto;
        if (window.Voice) { Voice.stopSpeaking && Voice.stopSpeaking(); Voice.speak(texto.replace(/[🛑⚠️🎯✅🏁💪💰⏭⏸🩹📅]/gu, "").replace(/ \\$/g, " dólares")); }
      }, 6000); }
    // Money plan (Capital propio): on withdrawal day, and when the risk his rules call for has changed, Jarvis says it once.
    { const t0 = Date.now(), KEY = "jarvis-dinero-oido";
      setInterval(() => {
        const C = window.CAPITAL; if (!C || !C.dinero || Date.now() - t0 < 20000) return;
        if (document.getElementById("answer").classList.contains("thinking")) return;
        let heard = []; try { heard = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch {}
        const d = C.dinero(), frases = [], keys = [];
        const riesgo = (window.CAPITAL.contexto().riesgoPorOperacion || "").replace("%", "");
        if (d.puedeRetirar && !heard.includes("retiro:" + d.periodoRetiro.desde)) {
          frases.push("Ya puede retirar de capital propio: según su plan, " + Math.round(d.sugerido) + " euros de lo ganado " + d.periodoRetiro.nombre + ". " + C.textoRepartoRetiro(d.sugerido)); keys.push("retiro:" + d.periodoRetiro.desde); }
        if (d.puedeAportar && !heard.includes("aporte:" + Math.round(d.metaAporte))) {
          frases.push("Su cuenta de capital propio ha crecido lo que pide su plan: ya puede meter más capital."); keys.push("aporte:" + Math.round(d.metaAporte)); }
        const kr = "riesgo:" + d.recomendado;
        if (Math.abs(d.recomendado - Number(riesgo)) > 0.001 && !heard.includes(kr)) {
          frases.push((d.recomendado > Number(riesgo) ? "Su cuenta de capital propio ha crecido: su plan dice subir el riesgo al " : "Su cuenta de capital propio ha caído: su plan dice bajar el riesgo al ") +
            String(d.recomendado).replace(".", ",") + " por ciento. Lo cambia en Capital propio."); keys.push(kr); }
        if (!frases.length) return;
        try { localStorage.setItem(KEY, JSON.stringify([...heard, ...keys].slice(-40))); } catch {}
        const texto = "Joel, su plan de dinero. " + frases.join(" "), card = $("answer");
        card.className = "glass show";
        card.querySelector(".q").textContent = "Jarvis · plan de dinero";
        card.querySelector(".chips").replaceChildren();
        card.querySelector(".a").textContent = texto;
        if (window.Voice) { Voice.stopSpeaking && Voice.stopSpeaking(); Voice.speak(texto); }
      }, 5000); }
    // 📷: a photo of a trade for Jarvis to look at, where this view can send images to Claude.
    const photo = document.createElement("button"); photo.type = "button"; photo.id = "os-photo"; photo.title = "Mándame la foto de un trade"; photo.textContent = "📷"; photo.hidden = true;
    const pick = document.createElement("input"); pick.type = "file"; pick.hidden = true;
    $("mic").before(photo); document.body.appendChild(pick);
    (async () => { try { const smp = await window.claude?.use?.("sample"); const caps = smp && (await smp.limits().catch(() => null));
      if (caps && caps.images) { photo.hidden = false; pick.accept = caps.images.mediaTypes.join(","); } } catch {} })();
    photo.onclick = () => { window.Voice && Voice.keepAwake && Voice.keepAwake(); pick.value = ""; pick.click(); };
    pick.onchange = () => {
      const f = pick.files && pick.files[0]; if (!f || !window.BRAIN) return;
      window.BRAIN.pendingImage = f;
      if (!q.value.trim()) q.value = "📷 Analiza mi trade";
      $("send").click();
    };
    const voiceOn = (e) => {
      const tag = $("os-voice").querySelector("span");
      if (!window.Voice || !Voice.available) { tag.textContent = "no disponible aquí"; Voice && Voice.setNote("Este navegador no deja hablar a la página. Abre Jarvis en Safari."); return; }
      tag.textContent = "probando…";
      Voice.hello("A su servicio, Joel. Ya me oye.").then((ok) => {
        tag.textContent = ok ? "activada" : "sin sonido";
        $("os-voice-top").textContent = ok ? "🔊 Voz activada" : "🔇 Sin sonido";
        if (!ok) Voice.setNote("No he podido hablar: sube el volumen, quita el modo silencio y vuelve a tocar «Voz». Si sigue sin sonar, abre Jarvis en Safari.");
      });
    };
    $("os-voice").addEventListener("click", voiceOn);
    $("os-voice-top").addEventListener("click", voiceOn);
    $("os-fit").addEventListener("click", () => Focus.clear());
    $("os-new").addEventListener("click", () => $("reset").click());
    document.querySelector("#os-drawers .l").addEventListener("click", () => { document.body.classList.toggle("os-left-open"); document.body.classList.remove("os-right-open"); });
    document.querySelector("#os-drawers .r").addEventListener("click", () => { document.body.classList.toggle("os-right-open"); document.body.classList.remove("os-left-open"); });
    const status = $("status"), hud = $("os-hud");
    const sync = () => { const m = status.dataset.mode || "idle"; hud.dataset.mode = m; $("os-mode").textContent = MODES[m] || "En espera"; };
    new MutationObserver(sync).observe(status, { attributes: true, attributeFilter: ["data-mode"] }); sync();
  }
  start();
})();
</script>`;
