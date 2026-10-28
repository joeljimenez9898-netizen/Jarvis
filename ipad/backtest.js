// ── 📒 Backtesting: Joel's TradingView backtests (Paper Trading and Bar Replay), one document per trade in fm/plan/backtest.
// build-space.mjs copies this file into the Plan de Futuros script. The setups are his own; the stats say which setup, day,
// hour and session work for him and which mistakes cost him. Hours are New York time, the clock his setups are written in.
// His four entry models, from his own checklist («Checklist Caminoalmillon»). Hours are New York time. «rango» is the window
// the model is traded in; each rule is a line of his checklist, and the teacher checks every chart against them one by one.
const BT_SETUPS = [
  { id: "L1", ses: "Londres", n: "Modelo 1 London", rango: ["02:00", "05:00"],
    d: "Después de la línea roja de las 2:00, una vela con volumen (más del 75 % de cuerpo) rompe una zona de liquidez, arriba o abajo: entras a su favor en esa primera vela de M15.",
    reglas: ["Entrada en Londres, en el rango operativo de 2:00 a 5:00", "Rompe una zona de liquidez, arriba o abajo", "Si rompe una acumulación por el medio o lateraliza, el set up se invalida",
      "Si toma el high de Asia con mecha, se invalida; si lo toma con cuerpo, esperar el retroceso", "Entrada siempre en la primera vela de M15, nunca esperar otra",
      "SL siempre por encima o por debajo de los máximos o mínimos secundarios, mínimo 100 puntos; nunca en un máximo o mínimo muy cercano"] },
  { id: "L2", ses: "Londres", n: "Modelo 2 London", rango: ["02:00", "05:00"],
    d: "Si el modelo 1 se escapa o no sucede: una vela con un 75 % de cuerpo toca la media móvil en M5 y la rompe con cuerpo; esperas a que toque la media móvil en M15 y entras a favor.",
    reglas: ["Solo si el modelo 1 se ha escapado o no ha sucedido", "Vela con un 75 % de cuerpo que toca la media móvil en M5 y la rompe con cuerpo", "Esperar a que toque la media móvil en M15 y entrar a favor"] },
  { id: "NYR", ses: "Nueva York", n: "Modelo 1 NY · Ruptura", rango: ["10:30", "12:00"],
    d: "Acumulación de 9:30 a 10:30: a partir de las 10:30 te unes en la dirección en la que rompa, siempre entrando en M5.",
    reglas: ["Acumulación de 9:30 a 10:30; en la apertura, unirse en la dirección que rompa", "Siempre entrada en M5",
      "Si la primera vela de M5 de la apertura no rompe y cierra con cuerpo fuera del rango, se busca el modelo 2 de reversión"] },
  { id: "NYV", ses: "Nueva York", n: "Modelo 2 NY · Reversión", rango: ["11:00", "12:00"],
    d: "Si no hubo entrada en la apertura: pasadas las 11:00, tras un rompimiento, una vela gigante con volumen en M15 a por el PDL/PDH o el PWL; entrada en M15 mirando M5 a la vez.",
    reglas: ["Solo si no hubo entrada en la apertura; rango operativo a partir de las 11:00", "Entrada después de un rompimiento", "Vela gigante con volumen en M15 a por el PDL o el PWL",
      "En la reversión tiene que haber un PDL o PDH cerca al que quiera ir", "Entrada en M15 (da más confianza), mirando M5 a la vez",
      "Si Londres ha expandido mucho y hay cerca un PDH o PDL con el camino en blanco, buscar la reversión hacia ese PDL o PDH cercano (y no operar en contra)"] },
];
const BT_ERRORES = ["Entré antes de que cerrara la vela", "La vela no tenía el 75 % de cuerpo", "No rompió con cuerpo", "Fuera del rango operativo", "Rompió por el medio de la acumulación o lateralizaba",
  "Tomó el high de Asia con mecha", "No entré en la primera vela de M15", "Stop en un máximo o mínimo demasiado cercano", "Sin PDH/PDL cerca para la reversión", "Contra la tendencia",
  "Moví el stop", "Salí antes de tiempo", "Promedié de más", "Sobreoperé"];
// how he trades all of them; the teacher judges every chart against this and the model's checklist
const BT_REGLAS = "Opera siempre después de la línea roja de las 2:00 de Nueva York (las 8:00 en España). Entra a favor de la dirección cuando una vela con volumen, de más del 75 % de cuerpo, rompe. " +
  "Su ratio es 1:1. Si el precio va en contra, promedia; si va a favor, añade contratos. El stop de toda la posición no se mueve nunca. Zonas que marca: AS.H/AS.L = máximo y mínimo de Asia, " +
  "LO.H/LO.L = máximo y mínimo de Londres, PDH/PDL = máximo y mínimo del día anterior, PWL = mínimo de la semana anterior. Sus modelos y su checklist: " +
  BT_SETUPS.map((s) => s.n + " (" + s.rango.join("–") + " hora NY): " + s.reglas.join("; ") + ".").join(" ");
// outside the model's window: the form says so and the teacher counts it as a mistake
const btFueraRango = (t) => { const s = btSetup(t.setup); return !!(s && /^\d{2}:\d{2}$/.test(t.hora || "") && (t.hora < s.rango[0] || t.hora > s.rango[1])); };
const BT_DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const BT_MIN = 10;                       // fewer trades than this and a percentage says nothing yet
const btSetup = (id) => BT_SETUPS.find((s) => s.id === id);
const btNombre = (id) => (btSetup(id) ? btSetup(id).n : "Sin set up");
// New York hour → session: Asia from 18:00, London from 2:00 (his London models start there), New York from 8:00 to 17:00
function btSesion(hora) {
  const m = /^(\d{1,2}):(\d{2})/.exec(hora || ""); if (!m) return "—";
  const h = Number(m[1]);
  return h >= 2 && h < 8 ? "Londres" : h >= 8 && h < 17 ? "Nueva York" : h >= 18 || h < 2 ? "Asia" : "Fuera de sesión";
}
const btDia = (fecha) => (/^\d{4}-\d{2}-\d{2}$/.test(fecha || "") ? BT_DIAS[new Date(fecha + "T12:00:00Z").getUTCDay()] : "—");
const btHora = (hora) => { const m = /^(\d{1,2}):/.exec(hora || ""); return m ? String(Number(m[1])).padStart(2, "0") + ":00" : "Sin hora"; };
// his operating hours (New York time): London 2:00–5:00 and New York 10:30–12:00, in half hours; the hour table follows them
const BT_HORARIO = [["Londres", "02:00", "05:00"], ["Nueva York", "10:30", "12:00"]];
const btHM = (x) => { const [h, m] = x.split(":").map(Number); return h * 60 + m; }, btTxt = (n) => String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
const BT_FRANJAS = BT_HORARIO.flatMap(([, a, z]) => { const out = []; for (let x = btHM(a); x < btHM(z); x += 30) out.push(btTxt(x) + "–" + btTxt(x + 30)); return out; });
function btFranja(t) {
  if (!/^\d{1,2}:\d{2}$/.test(t.hora || "")) return "Sin hora";
  const x = btHM(t.hora.padStart(5, "0")), f = BT_FRANJAS.find((k) => x >= btHM(k.slice(0, 5)) && x < btHM(k.slice(6)));
  return f || "Fuera de tu horario";
}
// the session: from the hour, or, when the hour wasn't read, from the model's session
const btSesionT = (t) => (/^\d{1,2}:\d{2}$/.test(t.hora || "") ? btSesion(t.hora) : btSetup(t.setup) ? btSetup(t.setup).ses : "Sin hora");
// result in R: what he wrote, else from entry, stop and exit
function btR(t) {
  if (t.r != null && t.r !== "" && Number.isFinite(Number(t.r))) return Number(t.r);
  const e = Number(t.entrada), s = Number(t.stop), x = Number(t.salida);
  if (![e, s, x].every(Number.isFinite) || e === s || !t.entrada || !t.stop || !t.salida) return t.resultado === "SL" ? -1 : t.resultado === "BE" ? 0 : null;
  const r = (t.dir === "SHORT" ? e - x : x - e) / Math.abs(e - s);
  return Math.round(r * 100) / 100;
}
const btClase = (t) => { const r = btR(t); return r == null ? (t.resultado === "TP" ? "g" : t.resultado === "SL" ? "p" : t.resultado === "BE" ? "be" : null) : r > 0.05 ? "g" : r < -0.05 ? "p" : "be"; };
// one row per value of a dimension: trades, wins, losses, win rate (break-evens left out), average and total R
function btTabla(trades, clave) {
  const g = new Map();
  for (const t of trades) { const k = clave(t); if (k == null) continue; if (!g.has(k)) g.set(k, []); g.get(k).push(t); }
  return [...g.entries()].map(([k, ts]) => {
    const c = ts.map(btClase), gan = c.filter((x) => x === "g").length, per = c.filter((x) => x === "p").length, rs = ts.map(btR).filter((x) => x != null);
    return { k, n: ts.length, gan, per, be: c.filter((x) => x === "be").length, acierto: gan + per ? Math.round((gan / (gan + per)) * 100) : null,
             rMedio: rs.length ? Math.round((rs.reduce((a, x) => a + x, 0) / rs.length) * 100) / 100 : null, rTotal: Math.round(rs.reduce((a, x) => a + x, 0) * 100) / 100 };
  }).sort((a, b) => b.n - a.n);
}
// what stands out, only from groups with enough trades: the best and worst combination, and the mistake that costs most
function btConclusiones(trades) {
  const out = [], conR = (rows) => rows.filter((r) => r.n >= BT_MIN && r.rMedio != null);
  const combos = conR([
    ...btTabla(trades, (t) => (t.setup ? btNombre(t.setup) + " · " + btDia(t.fecha) : null)),
    ...btTabla(trades, (t) => (t.setup ? btNombre(t.setup) + " · " + btFranja(t) + " (NY)" : null)),
    ...btTabla(trades, (t) => (t.setup ? btNombre(t.setup) : null))]).sort((a, b) => b.rMedio - a.rMedio);
  if (combos.length) {
    const b = combos[0], w = combos[combos.length - 1];
    out.push("✅ Lo que mejor te funciona: " + b.k + " — " + b.acierto + " % de acierto en " + b.n + " operaciones, " + (b.rMedio > 0 ? "+" : "") + b.rMedio + "R de media.");
    if (w !== b && w.rMedio < b.rMedio) out.push("⚠️ Lo que peor te funciona: " + w.k + " — " + w.acierto + " % de acierto en " + w.n + " operaciones, " + (w.rMedio > 0 ? "+" : "") + w.rMedio + "R de media.");
  }
  const limpias = trades.filter((t) => !(t.errores || []).length), base = btTabla(limpias, () => "x")[0];
  const errs = BT_ERRORES.map((e) => ({ e, row: btTabla(trades.filter((t) => (t.errores || []).includes(e)), () => "x")[0] })).filter((x) => x.row && x.row.n >= 5);
  errs.sort((a, b) => a.row.rTotal - b.row.rTotal);
  if (errs.length && errs[0].row.rTotal < 0) {
    const x = errs[0];
    out.push("🛑 El error que más te cuesta: «" + x.e + "» — " + x.row.n + " veces, " + x.row.rTotal + "R en total" + (x.row.acierto != null ? ", " + x.row.acierto + " % de acierto" : "") +
      (base && base.acierto != null ? " (sin errores aciertas el " + base.acierto + " %)" : "") + ".");
  }
  if (!out.length) out.push(trades.length < BT_MIN ? "Llevas " + trades.length + " operaciones de backtest. A partir de " + BT_MIN + " por set up Jarvis empieza a sacar conclusiones." : "Todavía no hay ningún grupo con " + BT_MIN + " operaciones o más: sigue apuntando.");
  return out;
}

// ── TradingView exports (Paper Trading). Two files are understood: the order history (Side, Fill Price, Status…; entries and
// exits are paired first-in first-out per symbol) and the balance history (one «Close … position» line per closed trade).
function btCSV(texto) {
  const filas = [], s = String(texto || "").replace(/^﻿/, "");
  let f = [], c = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"' && s[i + 1] === '"') { c += '"'; i++; } else if (ch === '"') q = false; else c += ch; }
    else if (ch === '"') q = true; else if (ch === "," || ch === ";") { f.push(c); c = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && s[i + 1] === "\n") i++; f.push(c); c = ""; if (f.some((x) => x.trim())) filas.push(f); f = []; }
    else c += ch;
  }
  f.push(c); if (f.some((x) => x.trim())) filas.push(f);
  if (!filas.length) return [];
  const cab = filas[0].map((h) => h.trim());
  return filas.slice(1).map((r) => Object.fromEntries(cab.map((h, i) => [h, (r[i] || "").trim()])));
}
// a clock time written in a time zone → the instant; then that instant's date and hour in New York
function btInstante(txt, zona) {
  const m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(txt || ""); if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (zona === "UTC") return guess;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const off = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - guess;
  return guess - off;
}
function btNY(t) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { fecha: p.year + "-" + p.month + "-" + p.day, hora: p.hour + ":" + p.minute };
}
const btNum = (x) => { const n = Number(String(x || "").replace(/[^\d.,\-]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
function btImportar(filas, zona, riesgo) {
  const cab = filas.length ? Object.keys(filas[0]) : [], col = (re) => cab.find((h) => re.test(h));
  const out = [], ny = (txt) => { const t = btInstante(txt, zona); return t == null ? null : btNY(t); };
  const instr = (sym) => (String(sym || "").split(":").pop() || "").replace(/\d*!$/, "") || "MNQ";
  const cAccion = col(/^action$/i), cPnl = col(/realized p&l \(value\)|realized p&l|p&l/i), cTime = col(/^time$/i);
  if (cAccion && cTime) {
    for (const f of filas) {
      const a = /close (long|short) position for symbol (\S+) at price ([\d.]+) for ([\d.]+) units?\.\s*position avg price was ([\d.]+)/i.exec(f[cAccion] || "");
      if (!a) continue;
      const w = ny(f[cTime]); if (!w) continue;
      const pnl = btNum(f[cPnl]);
      out.push({ ...w, horaEs: "cierre", instr: instr(a[2]), dir: a[1].toLowerCase() === "long" ? "LONG" : "SHORT", contratos: Number(a[4]), entrada: Number(a[5]), salida: Number(a[3]),
                 pnl, r: riesgo && pnl != null ? Math.round((pnl / riesgo) * 100) / 100 : null });
    }
    return out;
  }
  const cSide = col(/^side$/i), cFill = col(/fill price|avg.*price|precio/i), cQty = col(/^qty$|quantity|cantidad/i), cStatus = col(/^status$/i), cSym = col(/^symbol$/i);
  const cTiempo = col(/closing time|fill time|time/i);
  if (!cSide || !cFill || !cTiempo) return out;
  const abiertas = {};
  const llenas = filas.filter((f) => !cStatus || /filled|ejecutad/i.test(f[cStatus])).map((f) => ({ f, t: btInstante(f[cTiempo], zona) })).filter((x) => x.t != null).sort((a, b) => a.t - b.t);
  for (const { f, t } of llenas) {
    const sym = f[cSym] || "", lado = /buy|compra/i.test(f[cSide]) ? 1 : -1, precio = btNum(f[cFill]); let qty = Math.abs(btNum(f[cQty]) || 1);
    const pila = (abiertas[sym] ||= []);
    while (qty > 0 && pila.length && pila[0].lado !== lado) {
      const o = pila[0], n = Math.min(qty, o.qty), w = btNY(o.t);
      out.push({ ...w, horaEs: "entrada", instr: instr(sym), dir: o.lado === 1 ? "LONG" : "SHORT", contratos: n, entrada: o.precio, salida: precio, pnl: null, r: null });
      o.qty -= n; qty -= n; if (!o.qty) pila.shift();
    }
    if (qty > 0) pila.push({ lado, precio, qty, t });
  }
  return out;
}

// ── data and state
S.bt = new Map(); S.btClases = new Map(); S.btCons = null; S.btSubida = null; S.btf = null; S.btImp = null; S.btBusy = false;
const btLista = () => list(S.bt).sort((a, b) => ((b.fecha || "") + (b.hora || "")).localeCompare((a.fecha || "") + (a.hora || "")));
function btSub(plan) {
  plan.collection("clases").onSnapshot((snap) => { S.btClases.clear(); for (const d of snap.docs) S.btClases.set(d.id, d.data()); if (S.tab === "backtest") render(); }, () => {});
  plan.collection("backtest").onSnapshot((snap) => { S.bt.clear(); for (const d of snap.docs) S.bt.set(d.id, d.data()); if (S.tab === "backtest") render(); }, () => {}); }
async function btGuardar(t) {
  if (!S.db) { toast("Abre el Plan dentro de Claude para guardar."); return null; }
  const id = t.id || "bt-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), d = { ...t }; delete d.id;
  d.tipo = d.tipo || "backtest"; d.creado = d.creado || new Date().toISOString();
  await S.db.doc("fm/plan").collection("backtest").doc(id).set(d);
  return id;
}
const BT_VACIA = () => ({ tipo: "backtest", fecha: iso(new Date()), hora: "", setup: "", dir: "LONG", instr: "MNQ", tf: "M5", entrada: "", stop: "", salida: "", resultado: "", r: "", pnl: "", errores: [], nota: "", origen: "a mano" });
// a sentence or a chart screenshot → one trade, read by Claude; never invented: what isn't there comes back empty
// a video of the trade → frames in order (Claude reads images, not video): evenly spaced, the last one at the very end.
// iPhone and iPad only load a video's pictures once it has played, so it is put in the page, played muted and paused first.
async function btFotogramas(file, n) {
  const url = URL.createObjectURL(file), v = document.createElement("video");
  v.muted = true; v.defaultMuted = true; v.playsInline = true; v.setAttribute("playsinline", ""); v.setAttribute("muted", ""); v.preload = "auto";
  v.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
  root.appendChild(v);
  const espera = (ev, ms, msg) => new Promise((ok, ko) => { const tm = setTimeout(() => (msg ? ko(new Error(msg)) : ok()), ms); v.addEventListener(ev, () => { clearTimeout(tm); ok(); }, { once: true }); });
  try {
    const meta = espera("loadedmetadata", 30000, "el vídeo tarda demasiado en abrir");
    v.addEventListener("error", () => {}, { once: true });
    v.src = url; v.load();
    try { await v.play(); v.pause(); } catch {}
    await meta;
    if (v.readyState < 2) await espera("loadeddata", 15000);
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 1, k = Math.max(2, n || 8), out = [];
    const esc_ = Math.min(1, 1280 / (v.videoWidth || 1280)), c = document.createElement("canvas");
    c.width = Math.round((v.videoWidth || 1280) * esc_); c.height = Math.round((v.videoHeight || 720) * esc_);
    for (let i = 0; i < k; i++) {
      const t = Math.min(dur - 0.1, (dur * i) / (k - 1));
      const visto = espera("seeked", 8000); v.currentTime = Math.max(0, t); await visto;
      await new Promise((ok) => (v.requestVideoFrameCallback ? (v.requestVideoFrameCallback(() => ok()), setTimeout(ok, 500)) : requestAnimationFrame(() => setTimeout(ok, 80))));
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.8));
      if (blob) out.push(new File([blob], "fotograma-" + (i + 1) + ".jpg", { type: "image/jpeg" }));
    }
    if (!out.length) throw new Error("no he podido sacar imágenes del vídeo");
    return { frames: out, dur };
  } finally { v.removeAttribute("src"); v.load(); v.remove(); URL.revokeObjectURL(url); }
}
// Claude may take fewer pictures at once than a long video gives: try them all, then fewer, keeping the order
async function btLeerSecuencia(fotos, texto) {
  let ultimoError = null;
  for (const n of [fotos.length, 6, 4, 2]) {
    if (n > fotos.length || n < 1) continue;
    const pick = n === fotos.length ? fotos : Array.from({ length: n }, (_, i) => fotos[Math.round((i * (fotos.length - 1)) / (n - 1 || 1))]);
    try { return await btLeer(texto || "", pick.length === 1 ? pick[0] : pick); } catch (err) { ultimoError = err; }
  }
  throw ultimoError || new Error("no he podido leerlo");
}
async function btLeer(texto, imagen) {
  const sample = window.claude?.use ? await window.claude.use("sample") : null;
  if (!sample) throw new Error("Abre Jarvis dentro de Claude para que pueda leerlo.");
  const ask = "Extrae UNA operación de backtesting de trading de Joel" + (Array.isArray(imagen) ? " de estas " + imagen.length + " imágenes de TradingView en orden de principio a fin (fotogramas de un vídeo o capturas seguidas de la misma operación: mira cómo evoluciona, la entrada, lo que hace el precio y cómo termina)" : imagen ? " de esta captura de TradingView" : "") + (texto && !imagen ? " (y de lo que dice: «" + texto + "»)" : "") + ". Hoy es " + iso(new Date()) + ".\n" +
    "Sus modelos (id = nombre): " + BT_SETUPS.map((s) => s.id + " = " + s.n).join("; ") + ".\n" +
    "Cómo opera: " + BT_REGLAS + "\n" +
    "Errores posibles: " + BT_ERRORES.join("; ") + ".\n" +
    (imagen && texto ? "Joel te explica él mismo por qué entró, cómo ejecutó y qué opina: «" + texto + "». Tenlo en cuenta al corregirle: dile con sinceridad en qué tiene razón y en qué no, y usa lo que cuenta (hora, set up, gestión) si en el gráfico no se ve.\n" : "") +
    (imagen ? "Además eres su profesor de trading: revisa la entrada contra el checklist de su modelo, regla por regla, con lo que se ve en el gráfico (velas, cuerpos, media móvil, líneas de hora, zonas AS/LO, la caja de la posición). Sé concreto y honesto; si algo no se ve, dilo en vez de suponerlo.\n" : "") +
    "Responde SOLO con un JSON: {\"fecha\": \"AAAA-MM-DD\" del gráfico o null, \"hora\": \"HH:MM\" de la entrada (búscala en el eje de tiempo, en la etiqueta de fecha y hora o en la caja de la posición; es muy importante) o null, \"zona\": zona horaria del gráfico si se ve o null, \"instr\": símbolo o null, \"tf\": \"M1\"/\"M5\"/\"M15\"... o null, " +
    "\"dir\": \"LONG\" o \"SHORT\" o null, \"setup\": \"L1\"/\"L2\"/\"NYR\"/\"NYV\" o null, \"entrada\": número o null, \"stop\": número o null, \"salida\": número o null, \"resultado\": \"TP\"/\"SL\"/\"BE\" o null, " +
    "\"r\": resultado en R o null, \"pnl\": dólares o null, \"errores\": [de la lista], \"nota\": texto corto o \"\"" +
    (imagen ? ", \"profesor\": {\"veredicto\": \"libro\" (cumple sus reglas), \"dudosa\" o \"no\" (no era su set up), \"reglas\": [{\"regla\": texto corto, \"ok\": true/false/null si no se ve, \"por\": por qué}], " +
      "\"loQueVeo\": 2-3 frases de lo que pasa en el gráfico, \"queHabriaHecho\": qué habría hecho un buen trader con sus reglas (otra entrada, otro stop, no entrar, una segunda oportunidad…), \"leccion\": una frase para recordar, \"bien\": [lo que ha hecho bien, frases cortas], \"mal\": [lo que ha hecho mal, frases cortas]" + (texto ? ", \"respuesta\": 2-4 frases contestando a su explicación (en qué acierta su razonamiento y en qué se equivoca)" : "") + "}" : "") +
    "}. Si un dato no está, null: no lo inventes. Háblale de tú, en español.";
  const { text } = await sample([{ role: "user", content: ask }], imagen ? { cache: false, images: Array.isArray(imagen) ? imagen : [imagen] } : { cache: false, effort: "low" });
  const o = JSON.parse((String(text).match(/\{[\s\S]*\}/) || ["{}"])[0]) || {};
  let fecha = /^\d{4}-\d{2}-\d{2}$/.test(o.fecha || "") ? o.fecha : iso(new Date()), hora = /^\d{1,2}:\d{2}$/.test(o.hora || "") ? o.hora.padStart(5, "0") : "";
  if (hora && o.zona && !/new.?york|nueva york|^et$|est|edt|america\/new_york/i.test(o.zona)) {
    const z = /madrid|españa|cet|cest/i.test(o.zona) ? "Europe/Madrid" : /utc|gmt/i.test(o.zona) ? "UTC" : /chicago|ct|cst|cdt/i.test(o.zona) ? "America/Chicago" : /london|londres|bst/i.test(o.zona) ? "Europe/London" : null;
    if (z) ({ fecha, hora } = btNY(btInstante(fecha + " " + hora, z)));
  }
  const num = (x) => (x == null || x === "" || !Number.isFinite(Number(x)) ? "" : Number(x));
  return { ...BT_VACIA(), fecha, hora, setup: btSetup(o.setup) ? o.setup : "", dir: o.dir === "SHORT" ? "SHORT" : "LONG", instr: o.instr ? String(o.instr).replace(/\d*!$/, "") : "MNQ",
           tf: o.tf || "M5", entrada: num(o.entrada), stop: num(o.stop), salida: num(o.salida), resultado: ["TP", "SL", "BE"].includes(o.resultado) ? o.resultado : "", r: num(o.r), pnl: num(o.pnl),
           errores: (o.errores || []).filter((e) => BT_ERRORES.includes(e)), nota: String(o.nota || ""), origen: Array.isArray(imagen) ? "vídeo" : imagen ? "captura" : "voz", tipo: /\breal\b|topstep|en directo|en vivo/i.test(texto || "") ? "real" : "backtest",
           ...(o.profesor && typeof o.profesor === "object" ? { profesor: { veredicto: ["libro", "dudosa", "no"].includes(o.profesor.veredicto) ? o.profesor.veredicto : "dudosa",
             reglas: (o.profesor.reglas || []).slice(0, 8).map((r) => ({ regla: String(r.regla || ""), ok: r.ok === true ? true : r.ok === false ? false : null, por: String(r.por || "") })),
             loQueVeo: String(o.profesor.loQueVeo || ""), queHabriaHecho: String(o.profesor.queHabriaHecho || ""), leccion: String(o.profesor.leccion || ""),
             bien: (o.profesor.bien || []).slice(0, 6).map(String), mal: (o.profesor.mal || []).slice(0, 6).map(String), respuesta: String(o.profesor.respuesta || "") } } : {}),
           ...(imagen && texto ? { explicacion: String(texto) } : {}) };
}
// with the 📷 of Jarvis and «¿puedo entrar?»: the same question, answered in words
async function btConsultar(texto, imagen) { return btConsultaTexto(await btConsulta(texto, imagen)); }
// by voice («Jarvis, backtest: …»): straight to the journal, and Jarvis says what it wrote and what is missing
async function btApuntar(texto, imagen) {
  const t = await btLeer(texto, imagen); await btGuardar(t);
  const r = btR(t), falta = [!t.setup && "el set up", !t.hora && "la hora", r == null && !t.resultado && "el resultado"].filter(Boolean);
  return "Apuntado en tu diario" + (t.tipo === "real" ? " (operación real)" : " de backtesting") + ": " + (t.setup ? btNombre(t.setup) : "sin set up") + ", " + (t.dir === "LONG" ? "largo" : "corto") + " el " + btDia(t.fecha).toLowerCase() + " " + t.fecha.split("-").reverse().join("/") +
    (t.hora ? " a las " + t.hora + " (Nueva York, " + btSesion(t.hora) + ")" : "") + (r != null ? ", " + (r > 0 ? "+" : "") + r + "R" : t.resultado ? ", " + t.resultado : "") +
    (t.errores.length ? ". Errores: " + t.errores.join(", ").toLowerCase() : "") + "." + (t.profesor ? " " + BT_VERED[t.profesor.veredicto] + ". " + t.profesobtFin(r.loQueVeo) + " " +
      (t.profesor.veredicto !== "libro" && t.profesor.queHabriaHecho ? "Lo que yo habría hecho: " + t.profesor.queHabriaHecho + " " : "") + (t.profesor.leccion ? "Lección: " + t.profesor.leccion : "") : "") + (falta.length ? " Me falta " + falta.join(" y ") + ": complétalo en Plan de Futuros → Backtesting." : "");
}
const BT_VERED = { libro: "✅ De libro", dudosa: "⚠️ Dudosa", no: "❌ No era tu set up" };
// the teacher's class: reads the journal (trades and corrections) and explains patterns, mistakes and what to practise;
// «estrategia» writes his strategy from his best trades. Saved in fm/plan/clases.
async function btLeccion(tipo) {
  const sample = window.claude?.use ? await window.claude.use("sample") : null;
  if (!sample) throw new Error("Abre Jarvis dentro de Claude para la clase.");
  const ts = btLista(), desde = iso(new Date(Date.now() - 7 * 86400000)), semana = tipo === "semana" ? ts.filter((t) => t.fecha >= desde) : ts;
  const reales = tipo === "semana" ? btRealesTopstep(desde) : [];
  if (!semana.length && !reales.length) return tipo === "semana" ? "Esta semana no has apuntado ninguna operación de backtest, Joel. Mándame capturas y te corrijo." : "Todavía no hay operaciones apuntadas para explicarte tu estrategia.";
  const datos = semana.slice(0, 60).map((t) => ({ tipo: t.tipo === "real" ? "real" : "backtest", fecha: t.fecha, dia: btDia(t.fecha), horaNY: t.hora, sesion: btSesionT(t), setup: btNombre(t.setup), dir: t.dir, tf: t.tf, r: btR(t), errores: t.errores || [], nota: t.nota || "", explicacionDeJoel: t.explicacion || null,
    profesor: t.profesor ? { veredicto: t.profesor.veredicto, loQueVeo: t.profesor.loQueVeo, queHabriaHecho: t.profesor.queHabriaHecho, leccion: t.profesor.leccion } : null }));
  const ask = "Eres el profesor de trading de Joel. Sus set ups: " + BT_SETUPS.map((s) => s.n + ": " + s.d).join(" ") + " Cómo opera: " + BT_REGLAS + "\n" +
    "Estadísticas de todo su backtesting: " + JSON.stringify({ porSetup: btTabla(ts, (t) => btNombre(t.setup)), porDia: btTabla(ts, (t) => btDia(t.fecha)), porSesion: btTabla(ts, btSesionT), porFranjaNY: btTabla(ts, btFranja), horario: "Londres 2:00–5:00 y Nueva York 10:30–12:00, hora de Nueva York" }) + "\n" +
    "Operaciones de su diario" + (tipo === "semana" ? " de esta semana" : "") + " (tipo backtest o real, con la corrección del profesor si mandó captura): " + JSON.stringify(datos) + "\n" +
    (reales.length ? "Sus operaciones reales de Topstep de esta semana, leídas de su cuenta (sin set up ni captura): " + JSON.stringify(reales) + "\n" : "") +
    (tipo === "semana" ? "Dale su clase de la semana, en español, de tú, en texto plano sin markdown y en menos de 250 palabras: 1) cómo ha ido, separando backtest y real (números), 2) los patrones que se repiten en sus aciertos y en sus fallos, 3) en qué se ha equivocado en real y si en real hace lo mismo que en el backtest (horas, sesiones, promediar), 4) la regla que más se salta, 5) dos cosas concretas para practicar la semana que viene."
      : "Explícale su estrategia con sus propias operaciones, en español, de tú, en texto plano sin markdown y en menos de 300 palabras: cómo es una entrada de libro de cada set up, en qué horas, días y sesiones funciona mejor, qué la estropea y qué gestión le funciona (promediar, añadir). ") +
    " Di siempre cuántas operaciones hay detrás de cada conclusión; con menos de " + BT_MIN + " en un grupo, dile que todavía es pronto.";
  const { text } = await sample([{ role: "user", content: ask }], { cache: false });
  const txt = String(text || "").trim();
  if (S.db) await S.db.doc("fm/plan").collection("clases").doc(tipo + "-" + iso(new Date())).set({ tipo, texto: txt, operaciones: semana.length, creado: new Date().toISOString() });
  return txt;
}
// ── «¿Puedo entrar?»: a picture of the chart right now (M15 and/or M5) and the teacher says, by his own strategy, enter, wait
// or don't; with the hour he is in, today's state of his rules (stops, pause) and the plan (entry, stop by his rule, 1:1 target).
// It is an opinion, never an order: he decides. Each question is kept in fm/plan/consultas for the weekly class.
const BT_CONS_VER = { entra: "✅ Puedes entrar", espera: "⏳ Espera", no: "❌ No entres" };
function btAhora() {
  const w = btNY(Date.now()), dentro = BT_HORARIO.find(([, a, z]) => w.hora >= a && w.hora < z);
  let reglas = []; try { const m = motor(); reglas = m.avisos.map((a) => a.txt); if (m.pausa && (m.pausa.dia || m.pausa.semanal)) reglas.unshift("PAUSA ACTIVA según sus reglas."); } catch {}
  return { ...w, sesion: btSesion(w.hora), dentro: dentro ? dentro[0] : null, reglas };
}
async function btConsulta(texto, imagenes) {
  const sample = window.claude?.use ? await window.claude.use("sample") : null;
  if (!sample) throw new Error("Abre Jarvis dentro de Claude para preguntarle al profesor.");
  const A = btAhora(), imgs = Array.isArray(imagenes) ? imagenes : [imagenes];
  const ask = "Eres el profesor de trading de Joel y está operando AHORA, en directo. Mira " + (imgs.length > 1 ? "estas " + imgs.length + " imágenes del gráfico (pueden ser M15 y M5 del mismo momento)" : "esta imagen del gráfico") +
    " y dile si, según SU estrategia, puede entrar ya, debe esperar o no debe entrar.\n" +
    "Ahora en Nueva York son las " + A.hora + " (" + A.fecha + ", " + btDia(A.fecha).toLowerCase() + "). Su horario operativo: Londres de 2:00 a 5:00 y Nueva York de 10:30 a 12:00 (hora de Nueva York). " +
    (A.dentro ? "Está dentro de su horario de " + A.dentro + "." : "Está FUERA de su horario operativo: díselo claro.") + "\n" +
    (A.reglas.length ? "Lo que dicen hoy sus reglas (Jarvis): " + A.reglas.join(" ") + "\n" : "") +
    "Cómo opera y el checklist de cada modelo: " + BT_REGLAS + "\n" +
    (texto ? "Joel te dice: «" + texto + "».\n" : "") +
    "Sé prudente y honesto: si algo no se ve (escala de precios, hora, media móvil, niveles), dilo y no lo supongas; si la vela de entrada aún no ha cerrado, dile que espere al cierre. Es una opinión: él decide.\n" +
    "Responde SOLO con un JSON: {\"veredicto\": \"entra\" | \"espera\" | \"no\", \"modelo\": \"L1\"/\"L2\"/\"NYR\"/\"NYV\" o null, \"reglas\": [{\"regla\": línea de su checklist, \"ok\": true/false/null si no se ve, \"por\": por qué}], " +
    "\"loQueVeo\": 2-3 frases, \"plan\": {\"direccion\": \"LONG\"/\"SHORT\"/null, \"entrada\": dónde, \"stop\": dónde según su regla (detrás de máximos o mínimos secundarios, mínimo 100 puntos), \"objetivo\": dónde para 1:1}, " +
    "\"queEsperar\": qué tiene que pasar para que sea entrada (si es esperar) o \"\", \"invalida\": qué lo invalidaría, \"resumen\": una frase}. De tú, en español.";
  const { text } = await sample([{ role: "user", content: ask }], { cache: false, images: imgs });
  const o = JSON.parse((String(text).match(/\{[\s\S]*\}/) || ["{}"])[0]) || {};
  const r = { veredicto: ["entra", "espera", "no"].includes(o.veredicto) ? o.veredicto : "espera", modelo: btSetup(o.modelo) ? o.modelo : null,
    reglas: (o.reglas || []).slice(0, 8).map((x) => ({ regla: String(x.regla || ""), ok: x.ok === true ? true : x.ok === false ? false : null, por: String(x.por || "") })),
    loQueVeo: String(o.loQueVeo || ""), plan: o.plan && typeof o.plan === "object" ? { direccion: o.plan.direccion === "SHORT" ? "SHORT" : o.plan.direccion === "LONG" ? "LONG" : null,
      entrada: String(o.plan.entrada || ""), stop: String(o.plan.stop || ""), objetivo: String(o.plan.objetivo || "") } : null,
    queEsperar: String(o.queEsperar || ""), invalida: String(o.invalida || ""), resumen: String(o.resumen || ""), horaNY: A.hora, fechaNY: A.fecha, sesion: A.sesion, dentro: A.dentro, reglasHoy: A.reglas, texto: texto || "" };
  if (S.db) try { await S.db.doc("fm/plan").collection("consultas").doc("c-" + Date.now().toString(36)).set({ ...r, creado: new Date().toISOString() }); } catch {}
  return r;
}
const btFin = (s) => (s && !/[.!?…]$/.test(s.trim()) ? s.trim() + "." : (s || "").trim()), btSinSi = (s) => (s || "").replace(/^\s*si\s+/i, "");
const btConsultaTexto = (r) => BT_CONS_VER[r.veredicto] + (r.modelo ? " (" + btNombre(r.modelo) + ")" : "") + ". " + (r.dentro ? "" : "Ojo: estás fuera de tu horario. ") + r.loQueVeo + " " +
  (r.veredicto === "entra" && r.plan ? "Entrada " + r.plan.entrada + ", stop " + r.plan.stop + ", objetivo " + r.plan.objetivo + ". " : "") + (r.queEsperar ? btFin("Espera a que " + r.queEsperar.replace(/^\s*(a\s+)?que\s+/i, "")) + " " : "") +
  (r.invalida ? btFin("Se invalida si " + btSinSi(r.invalida)) + " " : "") + "La decisión es tuya.";
function btConsHtml() {
  const C = S.btCons, A = btAhora(), r = C.res;
  if (!r) return `<div class="card" style="margin-bottom:18px;border:2px solid #0ea5e9"><h3>🔎 ¿Puedo entrar?</h3>
    <p class="hint">📎 ${C.files.length === 1 ? "1 imagen lista" : C.files.length + " imágenes listas"} · Ahora son las <b>${A.hora}</b> en Nueva York (${A.dentro ? "dentro de tu horario de " + A.dentro : "⚠️ fuera de tu horario"}).</p>
    ${A.reglas.length ? `<div class="banner warn" style="margin-top:8px">${A.reglas.map(esc).join("<br>")}</div>` : ""}
    <textarea data-btcons rows="3" placeholder="Opcional: qué ves tú (ej.: vela de M15 rompiendo el high de Asia con cuerpo, quiero comprar)" style="width:100%;border:1px solid var(--line);border-radius:12px;padding:10px;margin-top:10px">${esc(C.texto || "")}</textarea>
    <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap"><button type="button" class="btn green" data-bt="cons-enviar">🔎 Preguntar al profesor</button><button type="button" class="btn" data-bt="cons-cerrar">Cancelar</button></div></div>`;
  return `<div class="card" style="margin-bottom:18px;border:2px solid ${r.veredicto === "entra" ? "#22c55e" : r.veredicto === "no" ? "#ef4444" : "#f59e0b"}"><h3 style="font-size:22px">${esc(BT_CONS_VER[r.veredicto])}</h3>
    <p class="hint">${r.modelo ? esc(btNombre(r.modelo)) + " · " : ""}${esc(r.horaNY)} en Nueva York${r.dentro ? "" : " · ⚠️ fuera de tu horario"}</p>
    ${r.resumen ? `<p style="margin:10px 0"><b>${esc(r.resumen)}</b></p>` : ""}${r.loQueVeo ? `<p style="margin:6px 0">${esc(r.loQueVeo)}</p>` : ""}
    ${r.reglas.map((x) => `<div style="margin:3px 0">${x.ok === true ? "✅" : x.ok === false ? "❌" : "❔"} <b>${esc(x.regla)}</b> — ${esc(x.por)}</div>`).join("")}
    ${r.plan && (r.plan.entrada || r.plan.stop) ? `<div class="banner ${r.veredicto === "entra" ? "ok" : ""}" style="margin-top:10px;font-weight:400;border-color:var(--line)">${r.plan.direccion ? "<b>" + (r.plan.direccion === "LONG" ? "Largo" : "Corto") + "</b> · " : ""}Entrada: ${esc(r.plan.entrada || "—")}<br>Stop: ${esc(r.plan.stop || "—")}<br>Objetivo (1:1): ${esc(r.plan.objetivo || "—")}</div>` : ""}
    ${r.queEsperar ? `<p style="margin:8px 0"><b>⏳ Qué esperar:</b> ${esc(r.queEsperar)}</p>` : ""}${r.invalida ? `<p style="margin:6px 0"><b>🚫 Se invalida si:</b> ${esc(btSinSi(r.invalida))}</p>` : ""}
    <p class="hint" style="margin-top:8px">Es la opinión de tu profesor con lo que se ve en la imagen. La decisión y el stop son tuyos.</p>
    <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap"><button type="button" class="btn dark" data-bt="consulta">🔎 Otra foto</button><button type="button" class="btn" data-bt="cons-cerrar">Cerrar</button></div></div>`;
}
// the week's real trades as Topstep reports them (account, New York hour, session, result), for the class
function btRealesTopstep(desde) {
  const por = new Map(cuentas().filter((c) => c.topstepId).map((c) => [String(c.topstepId), c.codigo]));
  return Object.entries(S.topstep?.cuentas || {}).flatMap(([id, a]) => (a.trades || []).filter((o) => o.fecha >= desde).map((o) => {
    const w = o.abre || o.cierra ? btNY(Date.parse(o.abre || o.cierra)) : { fecha: o.fecha, hora: "" };
    return { cuenta: por.get(String(id)) || a.nombre, fecha: o.fecha, dia: btDia(o.fecha), horaEntradaNY: w.hora, sesion: btSesion(w.hora), instr: o.instr, dir: o.dir, contratos: o.contratos, pnl: o.pnl, minutos: o.dur };
  })).sort((a, b) => (a.fecha + a.horaEntradaNY).localeCompare(b.fecha + b.horaEntradaNY)).slice(-80);
}
// what Jarvis reads when Joel asks about his backtests
function btContexto() {
  const ts = btLista();
  return { operaciones: ts.length, minimoParaConcluir: BT_MIN, conclusiones: btConclusiones(ts), porSetup: btTabla(ts, (t) => btNombre(t.setup)), porDia: btTabla(ts, (t) => btDia(t.fecha)),
           porSesion: btTabla(ts, btSesionT), porFranjaNY: btTabla(ts, btFranja), horario: "Londres 2:00–5:00, Nueva York 10:30–12:00 (hora de Nueva York)", porDireccion: btTabla(ts, (t) => (t.dir === "SHORT" ? "Cortos" : "Largos")),
           errores: BT_ERRORES.map((e) => ({ error: e, ...(btTabla(ts.filter((t) => (t.errores || []).includes(e)), () => e)[0] || { n: 0 }) })).filter((x) => x.n),
           ultimas: ts.slice(0, 15).map((t) => ({ fecha: t.fecha, dia: btDia(t.fecha), horaNY: t.hora, sesion: btSesion(t.hora), setup: btNombre(t.setup), dir: t.dir, r: btR(t), errores: t.errores || [], nota: t.nota || "", profesor: t.profesor ? BT_VERED[t.profesor.veredicto] + ". " + t.profesor.leccion : null })),
           ultimaClase: (list(S.btClases).sort((a, b) => (b.creado || "").localeCompare(a.creado || ""))[0] || {}).texto || null, comoOpera: BT_REGLAS,
           setups: BT_SETUPS.map((s) => s.n + " (" + s.rango.join("–") + " hora NY): " + s.d + " Checklist: " + s.reglas.join("; ")) };
}

// ── the tab
function btTablaHtml(titulo, rows, nota) {
  if (!rows.length) return "";
  const fmt = (x) => (x == null ? "—" : (x > 0 ? "+" : "") + x + "R");
  return `<div class="sec">${esc(titulo)}</div>${nota ? `<p class="hint">${esc(nota)}</p>` : ""}<div class="tablewrap"><table><thead><tr><th></th><th>OPERACIONES</th><th>ACIERTO</th><th>R MEDIO</th><th>R TOTAL</th></tr></thead><tbody>
    ${rows.map((r) => `<tr${r.n < BT_MIN ? ' class="dim"' : ""}><td><b>${esc(r.k)}</b></td><td>${r.n} <small class="dim">(${r.gan}✓ ${r.per}✗${r.be ? " " + r.be + "=" : ""})</small></td><td>${r.acierto == null ? "—" : r.acierto + " %"}${r.n < BT_MIN ? ' <small class="dim">pocas</small>' : ""}</td><td>${fmt(r.rMedio)}</td><td>${fmt(r.rTotal)}</td></tr>`).join("")}</tbody></table></div>`;
}
function btProfHtml(P) {
  return `<div class="banner ${P.veredicto === "libro" ? "ok" : P.veredicto === "no" ? "bad" : "warn"}" style="margin-top:12px;font-weight:400"><b>🎓 Tu profesor: ${esc(BT_VERED[P.veredicto])}</b>
    ${P.loQueVeo ? `<p style="margin:6px 0">${esc(P.loQueVeo)}</p>` : ""}
    ${(P.reglas || []).map((r) => `<div style="margin:3px 0">${r.ok === true ? "✅" : r.ok === false ? "❌" : "❔"} <b>${esc(r.regla)}</b> — ${esc(r.por)}</div>`).join("")}
    ${(P.bien || []).length ? `<p style="margin:8px 0 2px"><b>👍 Lo que has hecho bien</b></p>${P.bien.map((x) => `<div style="margin:2px 0">• ${esc(x)}</div>`).join("")}` : ""}
    ${(P.mal || []).length ? `<p style="margin:8px 0 2px"><b>👎 Lo que has hecho mal</b></p>${P.mal.map((x) => `<div style="margin:2px 0">• ${esc(x)}</div>`).join("")}` : ""}
    ${P.respuesta ? `<p style="margin:8px 0"><b>💬 Sobre tu explicación:</b> ${esc(P.respuesta)}</p>` : ""}
    ${P.queHabriaHecho ? `<p style="margin:6px 0"><b>Lo que yo habría hecho:</b> ${esc(P.queHabriaHecho)}</p>` : ""}
    ${P.leccion ? `<p style="margin:6px 0 0"><b>Lección:</b> ${esc(P.leccion)}</p>` : ""}</div>`;
}
function btFormHtml() {
  const f = S.btf, chip = (campo, val, txt, on) => `<button type="button" data-btc="${campo}:${esc(val)}" aria-pressed="${on}">${esc(txt)}</button>`;
  const inp = (campo, tipo, ph, w) => `<input type="${tipo}" data-btf="${campo}" value="${esc(f[campo])}" placeholder="${esc(ph || "")}" style="width:${w || 120}px"${tipo === "number" ? ' inputmode="decimal" step="any"' : ""}>`;
  const lab = (t, h) => `<label style="display:grid;gap:4px;font-size:12px;color:var(--muted)">${t}${h}</label>`;
  const r = btR(f);
  return `<div class="card" style="margin-bottom:18px;border:2px solid #6366f1"><h3>${f.id ? "Editar operación" : "Nueva operación de backtest"}</h3>
    <p class="hint">Hora de Nueva York (la de tus set ups). Jarvis pone solo el día y la sesión: <b id="bt-auto">${esc(btDia(f.fecha))}, ${esc(btSesion(f.hora))}</b>.</p>
    ${!f.hora ? '<div class="banner warn" style="margin-top:10px">⚠️ Falta la hora de entrada: ponla para que la operación cuente en tu horario (Londres 2:00–5:00, Nueva York 10:30–12:00).</div>' : ""}
    <div class="filters" style="margin-top:12px">${lab("Fecha del gráfico", inp("fecha", "date", "", 160))}${lab("Hora de entrada (NY)", inp("hora", "time", "", 120))}${lab("Instrumento", inp("instr", "text", "MNQ", 90))}</div>
    ${f.profesor ? btProfHtml(f.profesor) : ""}
    <div class="chips" style="margin-top:12px">${chip("tipo", "backtest", "🧪 Backtest", f.tipo !== "real")}${chip("tipo", "real", "💵 Operación real", f.tipo === "real")}</div>
    <div class="sec" style="margin-top:6px">SET UP</div><div class="chips">${BT_SETUPS.map((s) => chip("setup", s.id, s.n, f.setup === s.id)).join("")}</div>
    ${f.setup ? `<p class="hint" style="margin-top:-10px">${esc(btSetup(f.setup).d)} <b>Rango: ${btSetup(f.setup).rango.join("–")} (NY).</b></p>${btFueraRango(f) ? `<div class="banner warn" style="margin:-6px 0 12px">⚠️ A las ${esc(f.hora)} estás fuera del rango operativo de este modelo.</div>` : ""}` : ""}
    <div class="chips">${chip("dir", "LONG", "Largo", f.dir === "LONG")}${chip("dir", "SHORT", "Corto", f.dir === "SHORT")}<span style="width:12px"></span>${["M1", "M5", "M15"].map((x) => chip("tf", x, x, f.tf === x)).join("")}</div>
    <div class="sec">RESULTADO</div>
    <div class="filters">${lab("Entrada", inp("entrada", "number"))}${lab("Stop", inp("stop", "number"))}${lab("Salida", inp("salida", "number"))}${lab("Resultado en R", inp("r", "number", "si no pones precios", 140))}${lab("Dólares", inp("pnl", "number"))}</div>
    <div class="chips">${["TP", "SL", "BE"].map((x) => chip("resultado", x, x === "TP" ? "✅ TP" : x === "SL" ? "🛑 SL" : "➖ BE", f.resultado === x)).join("")}<span class="hint" id="bt-r" style="align-self:center">${r == null ? "" : "Resultado: " + (r > 0 ? "+" : "") + r + "R"}</span></div>
    <div class="sec">¿QUÉ FALLÓ? <small class="dim">(nada marcado = bien ejecutada)</small></div>
    <div class="chips">${BT_ERRORES.map((e) => chip("err", e, e, (f.errores || []).includes(e))).join("")}</div>
    ${f.explicacion != null || f.profesor ? `<div class="sec">TU EXPLICACIÓN</div><textarea data-btf="explicacion" rows="3" placeholder="Por qué entraste, cómo ejecutaste, qué opinas…" style="width:100%;border:1px solid var(--line);border-radius:12px;padding:10px;margin-bottom:8px">${esc(f.explicacion || "")}</textarea>` : ""}
    <textarea data-btf="nota" rows="2" placeholder="Nota: qué viste, qué sentiste…" style="width:100%;border:1px solid var(--line);border-radius:12px;padding:10px">${esc(f.nota)}</textarea>
    <div style="display:flex;gap:10px;margin-top:12px"><button type="button" class="btn green" data-bt="guardar">Guardar</button><button type="button" class="btn" data-bt="cancelar">Cancelar</button></div></div>`;
}
function btSubidaHtml() {
  const U = S.btSubida, v = U.files.find(btEsVideo), n = U.files.length;
  return `<div class="card" style="margin-bottom:18px;border:2px solid #6366f1"><h3>🎓 Explícale tu operación al profesor</h3>
    <p class="hint">📎 ${v ? "1 vídeo listo" : n === 1 ? "1 captura lista" : n + " capturas listas"}. Antes de mandarla, cuéntale por qué entraste, cómo la ejecutaste y qué opinas tú. Puedes dictarlo con el micrófono del teclado.</p>
    <textarea data-btsub rows="5" placeholder="Ej.: Entré en la primera vela de M15 después de las 2:00 porque rompió el high de Asia con cuerpo. Promedié una vez porque retrocedió hasta la media. Creo que salí demasiado pronto…" style="width:100%;border:1px solid var(--line);border-radius:12px;padding:10px;margin-top:10px">${esc(U.texto || "")}</textarea>
    <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap"><button type="button" class="btn green" data-bt="enviar-prof">🎓 Mandar al profesor</button><button type="button" class="btn" data-bt="cancelar-sub">Cancelar</button></div>
    <p class="hint" style="margin-top:8px">Si no quieres explicar nada, mándala igual: el profesor la corrige solo con lo que ve.</p></div>`;
}
const btEsVideo = (f) => /^video\//.test(f.type) || /\.(mov|mp4|m4v|webm)$/i.test(f.name || "");
function btImpHtml() {
  const I = S.btImp;
  return `<div class="card" style="margin-bottom:18px;border:2px solid #0ea5e9"><h3>Importar de TradingView</h3>
    <p class="hint">${I.trades.length} operaciones leídas del archivo. Revisa que la fecha y la hora de Nueva York sean las del gráfico; si no cuadran, cambia la zona horaria del archivo.${I.trades[0] && I.trades[0].horaEs === "cierre" ? " Este archivo solo trae la hora de cierre: la entrada fue antes." : ""}</p>
    <div class="filters" style="margin-top:10px"><label style="display:grid;gap:4px;font-size:12px;color:var(--muted)">Zona horaria del archivo<select data-bti="zona">${[["UTC", "UTC"], ["America/New_York", "Nueva York"], ["Europe/Madrid", "España"], ["America/Chicago", "Chicago"]].map(([v, n]) => `<option value="${v}"${I.zona === v ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <label style="display:grid;gap:4px;font-size:12px;color:var(--muted)">Riesgo por operación ($), para el R<input type="number" data-bti="riesgo" value="${I.riesgo || ""}" style="width:140px"></label></div>
    <div class="tablewrap"><table><thead><tr><th>FECHA</th><th>HORA NY</th><th>SESIÓN</th><th></th><th>ENTRADA → SALIDA</th><th>R</th></tr></thead><tbody>
      ${I.trades.slice(0, 12).map((t) => `<tr><td>${esc(btDia(t.fecha))} ${esc(t.fecha)}</td><td>${esc(t.hora)}</td><td>${esc(btSesion(t.hora))}</td><td>${esc(t.instr)} ${t.dir === "LONG" ? "largo" : "corto"} ${t.contratos}</td><td>${t.entrada} → ${t.salida}</td><td>${btR(t) == null ? "—" : btR(t) + "R"}</td></tr>`).join("")}</tbody></table></div>
    ${I.trades.length > 12 ? `<p class="hint">…y ${I.trades.length - 12} más.</p>` : ""}
    <p class="hint">Entran sin set up: luego tocas el set up de cada una en la lista.</p>
    <div style="display:flex;gap:10px;margin-top:12px"><button type="button" class="btn green" data-bt="importar"${I.trades.length ? "" : " disabled"}>Importar ${I.trades.length}</button><button type="button" class="btn" data-bt="cancelar-imp">Cancelar</button></div></div>`;
}
S.btVer = "todo";
V.backtest = () => {
  const todas = btLista(), ts = S.btVer === "todo" ? todas : todas.filter((t) => (t.tipo === "real" ? "real" : "backtest") === S.btVer), sinSet = todas.filter((t) => !t.setup).length;
  return (S.btCons && !S.btConsBusy ? btConsHtml() : "") + (S.btConsBusy ? '<div class="banner warn" style="margin-bottom:18px">🔎 Tu profesor está mirando el gráfico…</div>' : "") +
    (S.btCons ? "" : `<div class="card" style="margin-bottom:18px;border:2px solid #0ea5e9"><h3>🔎 ¿Puedo entrar?</h3><p class="hint">En mitad de la sesión, mándale una foto del gráfico (M15 y M5 si quieres, a la vez) y tu profesor te dice, según tu estrategia, si es entrada, si esperar o si no entrar.</p>
      <button type="button" class="btn green" data-bt="consulta" style="margin-top:10px">🔎 Foto del gráfico</button></div>`) + '<input type="file" id="bt-cons" accept="image/*" multiple hidden>' +
    (S.btSubida && !S.btBusy ? btSubidaHtml() : "") + (S.btf ? btFormHtml() : "") + (S.btImp ? btImpHtml() : "") +
  `<div class="card" style="margin-bottom:18px"><div class="cardhead"><div><h3>📒 Backtesting</h3><p class="hint">Tus pruebas de TradingView (Paper Trading y Bar Replay) y tus operaciones reales. Jarvis guarda set up, día, hora y sesión de cada entrada para decirte qué te funciona y en qué fallas.</p></div></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="btn green" data-bt="nueva">+ Apuntar operación</button>
      <button type="button" class="btn" data-bt="foto">📷 Captura o vídeo</button><button type="button" class="btn" data-bt="csv">⬆️ Importar de TradingView</button>
      <input type="file" id="bt-foto" accept="image/*,video/*" multiple hidden><input type="file" id="bt-csv" accept=".csv,text/csv" hidden></div>
    <p class="hint" style="margin-top:10px">También por voz: «Jarvis, backtest: martes 2:40, Londres 1, corto, gané 2R, entré antes de que cerrara la vela».</p>
    ${S.btBusy ? '<div class="banner warn" style="margin-top:10px">Jarvis está mirando tu operación…</div>' : ""}</div>
  <div class="card" style="margin-bottom:18px"><h3>🎓 Tu profesor</h3><p class="hint">Mándale un vídeo o varias capturas seguidas de cada operación, de backtest o real (📷), y te la corrige contra tus reglas. Cada domingo te llega sola la clase de la semana, con tus operaciones de backtest y las reales de Topstep.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px"><button type="button" class="btn dark" data-bt="clase-semana">🎓 Clase de la semana</button><button type="button" class="btn" data-bt="clase-estrategia">📘 Explícame mi estrategia</button></div>
    ${S.btClaseBusy ? '<div class="banner warn" style="margin-top:10px">Tu profesor está preparando la clase…</div>' : ""}
    ${(() => { const c = list(S.btClases).sort((a, b) => (b.creado || "").localeCompare(a.creado || ""))[0]; return c ? `<div class="banner" style="margin-top:12px;font-weight:400;white-space:pre-line;border-color:var(--line)"><b>${c.tipo === "semana" ? "Clase de la semana" : "Tu estrategia"} · ${esc(c.creado.slice(0, 10).split("-").reverse().join("/"))}</b>\n${esc(c.texto)}</div>` : ""; })()}</div>
  <div class="card" style="margin-bottom:18px"><h3>🧠 Lo que dice tu backtesting</h3>
    <div class="seg" style="margin:8px 0 4px">${[["todo", "Todo"], ["backtest", "🧪 Backtest"], ["real", "💵 Real"]].map(([k, n]) => `<button type="button" data-btver="${k}" aria-pressed="${S.btVer === k}">${n}</button>`).join("")}</div>
    <p class="hint">${ts.length} operaciones apuntadas. Los grupos con menos de ${BT_MIN} salen en gris: todavía no dicen nada.</p>
    ${btConclusiones(ts).map((c) => `<div class="banner ${/^✅/.test(c) ? "ok" : /^⚠️|^🛑/.test(c) ? "warn" : ""}" style="margin-top:8px">${esc(c)}</div>`).join("")}
    ${btTablaHtml("POR SET UP", btTabla(ts, (t) => btNombre(t.setup)))}
    ${btTablaHtml("POR SESIÓN", btTabla(ts, btSesionT))}
    ${btTablaHtml("POR DÍA", btTabla(ts, (t) => btDia(t.fecha)).sort((a, b) => BT_DIAS.indexOf(a.k) - BT_DIAS.indexOf(b.k)))}
    ${btTablaHtml("POR HORA DE ENTRADA · TU HORARIO", (() => { const rows = btTabla(ts, btFranja), orden = [...BT_FRANJAS, "Fuera de tu horario", "Sin hora"];
      return orden.map((k) => rows.find((r) => r.k === k) || (BT_FRANJAS.includes(k) ? { k, n: 0, gan: 0, per: 0, be: 0, acierto: null, rMedio: null, rTotal: 0 } : null)).filter(Boolean); })(),
      "Hora de Nueva York. Londres de 2:00 a 5:00 y Nueva York de 10:30 a 12:00 (en España, de 8:00 a 11:00 y de 16:30 a 18:00).")}
    ${btTablaHtml("LARGOS Y CORTOS", btTabla(ts, (t) => (t.dir === "SHORT" ? "Cortos" : "Largos")))}
    ${btTablaHtml("ERRORES", [btTabla(ts.filter((t) => !(t.errores || []).length), () => "✓ Bien ejecutadas")[0], ...BT_ERRORES.map((e) => btTabla(ts.filter((t) => (t.errores || []).includes(e)), () => e)[0])].filter(Boolean), "Cómo te va cuando cometes cada error, frente a las operaciones bien ejecutadas.")}</div>
  <div class="card"><h3>Tu diario${sinSet ? ` <small class="dim">· ${sinSet} sin set up</small>` : ""}</h3>
    ${todas.length ? `<div class="tablewrap"><table><thead><tr><th>CUÁNDO (NY)</th><th>SET UP</th><th>RESULTADO</th><th></th></tr></thead><tbody>${todas.slice(0, 80).map((t) => { const r = btR(t);
      return `<tr><td>${t.tipo === "real" ? "💵 " : ""}${esc(btDia(t.fecha).slice(0, 3))} ${esc(t.fecha.split("-").reverse().join("/"))} ${esc(t.hora || "")}<br><small class="dim">${t.hora ? esc(btSesion(t.hora)) : "⚠️ sin hora"} · ${esc(t.instr || "")} ${t.dir === "SHORT" ? "corto" : "largo"}${t.tf ? " · " + esc(t.tf) : ""}</small></td>
        <td style="white-space:normal">${t.setup ? esc(btNombre(t.setup)) : `<div class="chips" style="margin:0">${BT_SETUPS.map((s) => `<button type="button" data-btset="${t.id}:${s.id}">${esc(s.id)}</button>`).join("")}</div>`}${(t.errores || []).length ? `<br><small class="dim">${esc(t.errores.join(" · "))}</small>` : ""}${t.profesor ? `<br><small>${esc(BT_VERED[t.profesor.veredicto])}${t.profesor.leccion ? " · " + esc(t.profesor.leccion) : ""}</small>` : ""}</td>
        <td>${r == null ? esc(t.resultado || "—") : (r > 0 ? "+" : "") + r + "R"}${t.pnl ? `<br><small class="dim">${esc(signed(t.pnl))}</small>` : ""}</td>
        <td><button type="button" class="btn small" data-btedit="${t.id}">Editar</button> <button type="button" class="btn small" data-btdel="${t.id}">Borrar</button></td></tr>`; }).join("")}</tbody></table></div>` : '<p class="empty">Todavía no hay operaciones. Apunta la primera, mándale una captura a Jarvis o importa tu historial de Paper Trading.</p>'}</div>`;
};
// ── events
root.addEventListener("click", async (e) => {
  const t = e.target.closest("button"); if (!t) return;
  const d = t.dataset;
  if (d.bt === "nueva") { S.btf = BT_VACIA(); render(); return; }
  if (d.bt === "cancelar") { S.btf = null; render(); return; }
  if (d.bt === "foto") { $("#bt-foto").value = ""; $("#bt-foto").click(); return; }
  if (d.bt === "csv") { $("#bt-csv").value = ""; $("#bt-csv").click(); return; }
  if (d.bt === "cancelar-imp") { S.btImp = null; render(); return; }
  if (d.bt === "cancelar-sub") { S.btSubida = null; render(); return; }
  if (d.bt === "ir-consulta") { S.tab = "backtest"; try { localStorage.setItem("pf-tab", S.tab); } catch {} render(); const el = $("#bt-cons"); if (el) { el.value = ""; el.click(); } return; }
  if (d.bt === "consulta") { const el = $("#bt-cons"); if (el) { el.value = ""; el.click(); } return; }
  if (d.bt === "cons-cerrar") { S.btCons = null; render(); return; }
  if (d.bt === "cons-enviar" && S.btCons) {
    S.btConsBusy = true; render();
    try { S.btCons.res = await btConsulta((S.btCons.texto || "").trim(), S.btCons.files); }
    catch (err) { toast("No he podido preguntarle al profesor: " + (err.message || "error")); }
    finally { S.btConsBusy = false; render(); }
    return;
  }
  if (d.bt === "enviar-prof" && S.btSubida) {
    const U = S.btSubida, files = U.files, video = files.find(btEsVideo), texto = (U.texto || "").trim();
    S.btBusy = true; render();
    try {
      if (video) {
        const { frames, dur } = await btFotogramas(video, 12);
        if (dur > 180) toast("Vídeo de " + Math.round(dur / 60) + " minutos: para que el profesor vea bien la operación, mejor vídeos de 1 o 2 minutos.");
        S.btf = await btLeerSecuencia(frames, texto);
      } else {
        const fotos = files.filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|heic|webp)$/i.test(f.name || "")).sort((a, b) => a.lastModified - b.lastModified);
        S.btf = fotos.length > 1 ? await btLeerSecuencia(fotos, texto) : await btLeer(texto, fotos[0] || files[0]);
      }
      if (texto && S.btf.explicacion == null) S.btf.explicacion = texto;
      S.btSubida = null;
      toast("Mira la corrección de tu profesor, revisa los datos y guarda.");
    }
    catch (err) { toast("No he podido leer tu operación: " + (err.message || "error") + (video ? ". Prueba con 3 o 4 capturas seguidas (entrada, mitad y final): elígelas a la vez." : "")); }
    finally { S.btBusy = false; render(); }
    return;
  }
  if (d.bt === "clase-semana" || d.bt === "clase-estrategia") {
    S.btClaseBusy = true; render();
    try { const txt = await btLeccion(d.bt === "clase-semana" ? "semana" : "estrategia"); if (!S.db) toast(txt.slice(0, 120)); }
    catch (err) { toast("No he podido preparar la clase: " + (err.message || "error")); }
    finally { S.btClaseBusy = false; render(); }
    return;
  }
  if (d.bt === "guardar") {
    const f = S.btf; if (!f.setup && !confirmarSinSet(t)) return;
    if (btFueraRango(f) && !(f.errores || []).includes("Fuera del rango operativo")) f.errores = [...(f.errores || []), "Fuera del rango operativo"];
    const x = { ...f, entrada: f.entrada === "" ? "" : Number(f.entrada), stop: f.stop === "" ? "" : Number(f.stop), salida: f.salida === "" ? "" : Number(f.salida), r: f.r === "" ? "" : Number(f.r), pnl: f.pnl === "" ? "" : Number(f.pnl) };
    await btGuardar(x); S.btf = null; render(); toast("Operación guardada."); return;
  }
  if (d.bt === "importar") {
    const I = S.btImp; if (!S.db) return toast("Abre el Plan dentro de Claude para guardar.");
    for (const x of I.trades) { const y = { ...x }; delete y.horaEs; await btGuardar({ ...BT_VACIA(), ...y, origen: "TradingView", nota: x.horaEs === "cierre" ? "Hora de cierre (el archivo no trae la de entrada)" : "" }); }
    toast(I.trades.length + " operaciones importadas. Ahora ponles el set up."); S.btImp = null; render(); return;
  }
  if (d.btc) {
    const [campo, ...v] = d.btc.split(":"), val = v.join(":"), f = S.btf;
    if (campo === "err") f.errores = (f.errores || []).includes(val) ? f.errores.filter((x) => x !== val) : [...(f.errores || []), val];
    else f[campo] = f[campo] === val && (campo === "setup" || campo === "resultado") ? "" : val;
    render(); return;
  }
  if (d.btver) { S.btVer = d.btver; render(); return; }
  if (d.btset) { const [id, s] = d.btset.split(":"), x = S.bt.get(id); if (x) { await btGuardar({ ...x, id, setup: s }); toast(btNombre(s) + "."); } return; }
  if (d.btedit) { const x = S.bt.get(d.btedit); if (x) { S.btf = { ...BT_VACIA(), ...x, id: d.btedit, errores: [...(x.errores || [])] }; render(); } return; }
  if (d.btdel) { if (!dosToques(t, "¿Borrar? Toca otra vez")) return; if (S.db) await S.db.doc("fm/plan").collection("backtest").doc(d.btdel).delete(); toast("Borrada."); return; }
});
// Saving without a setup takes a second tap: the stats need it
function confirmarSinSet(btn) { if (dosToques(btn, "Sin set up: toca otra vez para guardar igual")) return true; return false; }
root.addEventListener("input", (e) => {
  const d = e.target.dataset;
  if (d.btcons != null && S.btCons) { S.btCons.texto = e.target.value; return; }
  if (d.btsub != null && S.btSubida) { S.btSubida.texto = e.target.value; return; }
  if (d.btf != null && S.btf) {
    S.btf[d.btf] = e.target.value;
    if (["fecha", "hora"].includes(d.btf)) { const h = $("#bt-auto"); if (h) h.textContent = btDia(S.btf.fecha) + ", " + btSesion(S.btf.hora); }
    const r = btR(S.btf), el = $("#bt-r"); if (el) el.textContent = r == null ? "" : "Resultado: " + (r > 0 ? "+" : "") + r + "R";
  }
  if (d.bti && S.btImp && d.bti === "riesgo") { S.btImp.riesgo = Number(e.target.value) || null; S.btImp.trades = btImportar(S.btImp.filas, S.btImp.zona, S.btImp.riesgo); }
});
root.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.dataset.bti === "zona" && S.btImp) { S.btImp.zona = t.value; S.btImp.trades = btImportar(S.btImp.filas, S.btImp.zona, S.btImp.riesgo); render(); return; }
  if (t.dataset.bti === "riesgo" && S.btImp) { render(); return; }
  if (t.id === "bt-csv" && t.files && t.files[0]) {
    const filas = btCSV(await t.files[0].text()), riesgo = est().exModo === "londres" ? est().lonR : est().b1r;
    S.btImp = { filas, zona: "UTC", riesgo, trades: btImportar(filas, "UTC", riesgo) };
    if (!S.btImp.trades.length) toast("No he encontrado operaciones cerradas en ese archivo. Exporta el historial de Paper Trading (órdenes o balance).");
    render(); return;
  }
  if (t.id === "bt-cons" && t.files && t.files[0]) { S.btCons = { files: [...t.files].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|heic|webp)$/i.test(f.name || "")).slice(0, 4), texto: "", res: null }; render(); return; }
  if (t.id === "bt-foto" && t.files && t.files[0]) { S.btSubida = { files: [...t.files], texto: "" }; S.btf = null; render(); }
});
