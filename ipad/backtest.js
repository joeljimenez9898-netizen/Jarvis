// ── 📒 Backtesting: Joel's TradingView backtests (Paper Trading and Bar Replay), one document per trade in fm/plan/backtest.
// build-space.mjs copies this file into the Plan de Futuros script. The setups are his own; the stats say which setup, day,
// hour and session work for him and which mistakes cost him. Hours are New York time, the clock his setups are written in.
const BT_SETUPS = [
  { id: "L1", ses: "Londres", n: "Londres 1 · vela 75 % tras las 2:00", d: "Después de las 2:00 (hora de Nueva York), una vela rompe con más del 75 % de cuerpo: entras a su favor." },
  { id: "L2", ses: "Londres", n: "Londres 2 · vela 75 % rompe la media", d: "Una vela con más del 75 % de cuerpo rompe con cuerpo la media móvil en M5 o M15: entras a su favor." },
  { id: "NYR", ses: "Nueva York", n: "NY · Ruptura", d: "Tu modelo de ruptura en Nueva York." },
  { id: "NYV", ses: "Nueva York", n: "NY · Reversión", d: "Tu modelo de reversión en Nueva York." },
];
const BT_ERRORES = ["Entré antes de que cerrara la vela", "La vela no tenía el 75 % de cuerpo", "No rompió con cuerpo", "Fuera de su horario", "Contra la tendencia",
  "Moví el stop", "Salí antes de tiempo", "Promedié de más", "Sobreoperé"];
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
const btHora = (hora) => { const m = /^(\d{1,2}):/.exec(hora || ""); return m ? String(Number(m[1])).padStart(2, "0") + ":00" : "—"; };
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
    ...btTabla(trades, (t) => (t.setup ? btNombre(t.setup) + " · " + btHora(t.hora) + " (NY)" : null)),
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
S.bt = new Map(); S.btf = null; S.btImp = null; S.btBusy = false;
const btLista = () => list(S.bt).sort((a, b) => ((b.fecha || "") + (b.hora || "")).localeCompare((a.fecha || "") + (a.hora || "")));
function btSub(plan) { plan.collection("backtest").onSnapshot((snap) => { S.bt.clear(); for (const d of snap.docs) S.bt.set(d.id, d.data()); if (S.tab === "backtest") render(); }, () => {}); }
async function btGuardar(t) {
  if (!S.db) { toast("Abre el Plan dentro de Claude para guardar."); return null; }
  const id = t.id || "bt-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), d = { ...t }; delete d.id;
  d.tipo = d.tipo || "backtest"; d.creado = d.creado || new Date().toISOString();
  await S.db.doc("fm/plan").collection("backtest").doc(id).set(d);
  return id;
}
const BT_VACIA = () => ({ fecha: iso(new Date()), hora: "", setup: "", dir: "LONG", instr: "MNQ", tf: "M5", entrada: "", stop: "", salida: "", resultado: "", r: "", pnl: "", errores: [], nota: "", origen: "a mano" });
// a sentence or a chart screenshot → one trade, read by Claude; never invented: what isn't there comes back empty
async function btLeer(texto, imagen) {
  const sample = window.claude?.use ? await window.claude.use("sample") : null;
  if (!sample) throw new Error("Abre Jarvis dentro de Claude para que pueda leerlo.");
  const ask = "Extrae UNA operación de backtesting de trading de Joel" + (imagen ? " de esta captura de TradingView" : "") + (texto ? " (y de lo que dice: «" + texto + "»)" : "") + ". Hoy es " + iso(new Date()) + ".\n" +
    "Sus set ups: L1 = Londres 1 (después de las 2:00 hora de Nueva York, vela que rompe con más del 75 % de cuerpo, entra a favor); L2 = Londres 2 (vela de más del 75 % de cuerpo que rompe con cuerpo la media móvil en M5 o M15); NYR = Nueva York ruptura; NYV = Nueva York reversión.\n" +
    "Errores posibles: " + BT_ERRORES.join("; ") + ".\n" +
    "Responde SOLO con un JSON: {\"fecha\": \"AAAA-MM-DD\" del gráfico o null, \"hora\": \"HH:MM\" de la entrada o null, \"zona\": zona horaria del gráfico si se ve o null, \"instr\": símbolo o null, \"tf\": \"M1\"/\"M5\"/\"M15\"... o null, " +
    "\"dir\": \"LONG\" o \"SHORT\" o null, \"setup\": \"L1\"/\"L2\"/\"NYR\"/\"NYV\" o null, \"entrada\": número o null, \"stop\": número o null, \"salida\": número o null, \"resultado\": \"TP\"/\"SL\"/\"BE\" o null, " +
    "\"r\": resultado en R o null, \"pnl\": dólares o null, \"errores\": [de la lista], \"nota\": texto corto o \"\"}. Si un dato no está, null: no lo inventes.";
  const { text } = await sample([{ role: "user", content: ask }], imagen ? { cache: false, images: [imagen] } : { cache: false, effort: "low" });
  const o = JSON.parse((String(text).match(/\{[\s\S]*\}/) || ["{}"])[0]) || {};
  let fecha = /^\d{4}-\d{2}-\d{2}$/.test(o.fecha || "") ? o.fecha : iso(new Date()), hora = /^\d{1,2}:\d{2}$/.test(o.hora || "") ? o.hora.padStart(5, "0") : "";
  if (hora && o.zona && !/new.?york|nueva york|^et$|est|edt|america\/new_york/i.test(o.zona)) {
    const z = /madrid|españa|cet|cest/i.test(o.zona) ? "Europe/Madrid" : /utc|gmt/i.test(o.zona) ? "UTC" : /chicago|ct|cst|cdt/i.test(o.zona) ? "America/Chicago" : /london|londres|bst/i.test(o.zona) ? "Europe/London" : null;
    if (z) ({ fecha, hora } = btNY(btInstante(fecha + " " + hora, z)));
  }
  const num = (x) => (x == null || x === "" || !Number.isFinite(Number(x)) ? "" : Number(x));
  return { ...BT_VACIA(), fecha, hora, setup: btSetup(o.setup) ? o.setup : "", dir: o.dir === "SHORT" ? "SHORT" : "LONG", instr: o.instr ? String(o.instr).replace(/\d*!$/, "") : "MNQ",
           tf: o.tf || "M5", entrada: num(o.entrada), stop: num(o.stop), salida: num(o.salida), resultado: ["TP", "SL", "BE"].includes(o.resultado) ? o.resultado : "", r: num(o.r), pnl: num(o.pnl),
           errores: (o.errores || []).filter((e) => BT_ERRORES.includes(e)), nota: String(o.nota || ""), origen: imagen ? "captura" : "voz" };
}
// by voice («Jarvis, backtest: …»): straight to the journal, and Jarvis says what it wrote and what is missing
async function btApuntar(texto, imagen) {
  const t = await btLeer(texto, imagen); await btGuardar(t);
  const r = btR(t), falta = [!t.setup && "el set up", !t.hora && "la hora", r == null && !t.resultado && "el resultado"].filter(Boolean);
  return "Apuntado en tu backtesting: " + (t.setup ? btNombre(t.setup) : "sin set up") + ", " + (t.dir === "LONG" ? "largo" : "corto") + " el " + btDia(t.fecha).toLowerCase() + " " + t.fecha.split("-").reverse().join("/") +
    (t.hora ? " a las " + t.hora + " (Nueva York, " + btSesion(t.hora) + ")" : "") + (r != null ? ", " + (r > 0 ? "+" : "") + r + "R" : t.resultado ? ", " + t.resultado : "") +
    (t.errores.length ? ". Errores: " + t.errores.join(", ").toLowerCase() : "") + "." + (falta.length ? " Me falta " + falta.join(" y ") + ": complétalo en Plan de Futuros → Backtesting." : "");
}
// what Jarvis reads when Joel asks about his backtests
function btContexto() {
  const ts = btLista();
  return { operaciones: ts.length, minimoParaConcluir: BT_MIN, conclusiones: btConclusiones(ts), porSetup: btTabla(ts, (t) => btNombre(t.setup)), porDia: btTabla(ts, (t) => btDia(t.fecha)),
           porSesion: btTabla(ts, (t) => btSesion(t.hora)), porHoraNY: btTabla(ts, (t) => btHora(t.hora)), porDireccion: btTabla(ts, (t) => (t.dir === "SHORT" ? "Cortos" : "Largos")),
           errores: BT_ERRORES.map((e) => ({ error: e, ...(btTabla(ts.filter((t) => (t.errores || []).includes(e)), () => e)[0] || { n: 0 }) })).filter((x) => x.n),
           ultimas: ts.slice(0, 15).map((t) => ({ fecha: t.fecha, dia: btDia(t.fecha), horaNY: t.hora, sesion: btSesion(t.hora), setup: btNombre(t.setup), dir: t.dir, r: btR(t), errores: t.errores || [], nota: t.nota || "" })),
           setups: BT_SETUPS.map((s) => s.n + ": " + s.d) };
}

// ── the tab
function btTablaHtml(titulo, rows, nota) {
  if (!rows.length) return "";
  const fmt = (x) => (x == null ? "—" : (x > 0 ? "+" : "") + x + "R");
  return `<div class="sec">${esc(titulo)}</div>${nota ? `<p class="hint">${esc(nota)}</p>` : ""}<div class="tablewrap"><table><thead><tr><th></th><th>OPERACIONES</th><th>ACIERTO</th><th>R MEDIO</th><th>R TOTAL</th></tr></thead><tbody>
    ${rows.map((r) => `<tr${r.n < BT_MIN ? ' class="dim"' : ""}><td><b>${esc(r.k)}</b></td><td>${r.n} <small class="dim">(${r.gan}✓ ${r.per}✗${r.be ? " " + r.be + "=" : ""})</small></td><td>${r.acierto == null ? "—" : r.acierto + " %"}${r.n < BT_MIN ? ' <small class="dim">pocas</small>' : ""}</td><td>${fmt(r.rMedio)}</td><td>${fmt(r.rTotal)}</td></tr>`).join("")}</tbody></table></div>`;
}
function btFormHtml() {
  const f = S.btf, chip = (campo, val, txt, on) => `<button type="button" data-btc="${campo}:${esc(val)}" aria-pressed="${on}">${esc(txt)}</button>`;
  const inp = (campo, tipo, ph, w) => `<input type="${tipo}" data-btf="${campo}" value="${esc(f[campo])}" placeholder="${esc(ph || "")}" style="width:${w || 120}px"${tipo === "number" ? ' inputmode="decimal" step="any"' : ""}>`;
  const lab = (t, h) => `<label style="display:grid;gap:4px;font-size:12px;color:var(--muted)">${t}${h}</label>`;
  const r = btR(f);
  return `<div class="card" style="margin-bottom:18px;border:2px solid #6366f1"><h3>${f.id ? "Editar operación" : "Nueva operación de backtest"}</h3>
    <p class="hint">Hora de Nueva York (la de tus set ups). Jarvis pone solo el día y la sesión: <b id="bt-auto">${esc(btDia(f.fecha))}, ${esc(btSesion(f.hora))}</b>.</p>
    <div class="filters" style="margin-top:12px">${lab("Fecha del gráfico", inp("fecha", "date", "", 160))}${lab("Hora de entrada (NY)", inp("hora", "time", "", 120))}${lab("Instrumento", inp("instr", "text", "MNQ", 90))}</div>
    <div class="sec" style="margin-top:6px">SET UP</div><div class="chips">${BT_SETUPS.map((s) => chip("setup", s.id, s.n, f.setup === s.id)).join("")}</div>
    ${f.setup ? `<p class="hint" style="margin-top:-10px">${esc(btSetup(f.setup).d)}</p>` : ""}
    <div class="chips">${chip("dir", "LONG", "Largo", f.dir === "LONG")}${chip("dir", "SHORT", "Corto", f.dir === "SHORT")}<span style="width:12px"></span>${["M1", "M5", "M15"].map((x) => chip("tf", x, x, f.tf === x)).join("")}</div>
    <div class="sec">RESULTADO</div>
    <div class="filters">${lab("Entrada", inp("entrada", "number"))}${lab("Stop", inp("stop", "number"))}${lab("Salida", inp("salida", "number"))}${lab("Resultado en R", inp("r", "number", "si no pones precios", 140))}${lab("Dólares", inp("pnl", "number"))}</div>
    <div class="chips">${["TP", "SL", "BE"].map((x) => chip("resultado", x, x === "TP" ? "✅ TP" : x === "SL" ? "🛑 SL" : "➖ BE", f.resultado === x)).join("")}<span class="hint" id="bt-r" style="align-self:center">${r == null ? "" : "Resultado: " + (r > 0 ? "+" : "") + r + "R"}</span></div>
    <div class="sec">¿QUÉ FALLÓ? <small class="dim">(nada marcado = bien ejecutada)</small></div>
    <div class="chips">${BT_ERRORES.map((e) => chip("err", e, e, (f.errores || []).includes(e))).join("")}</div>
    <textarea data-btf="nota" rows="2" placeholder="Nota: qué viste, qué sentiste…" style="width:100%;border:1px solid var(--line);border-radius:12px;padding:10px">${esc(f.nota)}</textarea>
    <div style="display:flex;gap:10px;margin-top:12px"><button type="button" class="btn green" data-bt="guardar">Guardar</button><button type="button" class="btn" data-bt="cancelar">Cancelar</button></div></div>`;
}
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
V.backtest = () => {
  const ts = btLista(), sinSet = ts.filter((t) => !t.setup).length;
  return (S.btf ? btFormHtml() : "") + (S.btImp ? btImpHtml() : "") +
  `<div class="card" style="margin-bottom:18px"><div class="cardhead"><div><h3>📒 Backtesting</h3><p class="hint">Tus pruebas de TradingView (Paper Trading y Bar Replay). Jarvis guarda set up, día, hora y sesión de cada entrada para decirte qué te funciona y en qué fallas.</p></div></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="btn green" data-bt="nueva">+ Apuntar operación</button>
      <button type="button" class="btn" data-bt="foto">📷 Desde una captura</button><button type="button" class="btn" data-bt="csv">⬆️ Importar de TradingView</button>
      <input type="file" id="bt-foto" accept="image/*" hidden><input type="file" id="bt-csv" accept=".csv,text/csv" hidden></div>
    <p class="hint" style="margin-top:10px">También por voz: «Jarvis, backtest: martes 2:40, Londres 1, corto, gané 2R, entré antes de que cerrara la vela».</p>
    ${S.btBusy ? '<div class="banner warn" style="margin-top:10px">Jarvis está leyendo la captura…</div>' : ""}</div>
  <div class="card" style="margin-bottom:18px"><h3>🧠 Lo que dice tu backtesting</h3><p class="hint">${ts.length} operaciones apuntadas. Los grupos con menos de ${BT_MIN} salen en gris: todavía no dicen nada.</p>
    ${btConclusiones(ts).map((c) => `<div class="banner ${/^✅/.test(c) ? "ok" : /^⚠️|^🛑/.test(c) ? "warn" : ""}" style="margin-top:8px">${esc(c)}</div>`).join("")}
    ${btTablaHtml("POR SET UP", btTabla(ts, (t) => btNombre(t.setup)))}
    ${btTablaHtml("POR SESIÓN", btTabla(ts, (t) => btSesion(t.hora)))}
    ${btTablaHtml("POR DÍA", btTabla(ts, (t) => btDia(t.fecha)).sort((a, b) => BT_DIAS.indexOf(a.k) - BT_DIAS.indexOf(b.k)))}
    ${btTablaHtml("POR HORA DE ENTRADA (NUEVA YORK)", btTabla(ts, (t) => btHora(t.hora)).sort((a, b) => a.k.localeCompare(b.k)))}
    ${btTablaHtml("LARGOS Y CORTOS", btTabla(ts, (t) => (t.dir === "SHORT" ? "Cortos" : "Largos")))}
    ${btTablaHtml("ERRORES", [btTabla(ts.filter((t) => !(t.errores || []).length), () => "✓ Bien ejecutadas")[0], ...BT_ERRORES.map((e) => btTabla(ts.filter((t) => (t.errores || []).includes(e)), () => e)[0])].filter(Boolean), "Cómo te va cuando cometes cada error, frente a las operaciones bien ejecutadas.")}</div>
  <div class="card"><h3>Operaciones${sinSet ? ` <small class="dim">· ${sinSet} sin set up</small>` : ""}</h3>
    ${ts.length ? `<div class="tablewrap"><table><thead><tr><th>CUÁNDO (NY)</th><th>SET UP</th><th>RESULTADO</th><th></th></tr></thead><tbody>${ts.slice(0, 80).map((t) => { const r = btR(t);
      return `<tr><td>${esc(btDia(t.fecha).slice(0, 3))} ${esc(t.fecha.split("-").reverse().join("/"))} ${esc(t.hora || "")}<br><small class="dim">${esc(btSesion(t.hora))} · ${esc(t.instr || "")} ${t.dir === "SHORT" ? "corto" : "largo"}${t.tf ? " · " + esc(t.tf) : ""}</small></td>
        <td style="white-space:normal">${t.setup ? esc(btNombre(t.setup)) : `<div class="chips" style="margin:0">${BT_SETUPS.map((s) => `<button type="button" data-btset="${t.id}:${s.id}">${esc(s.id)}</button>`).join("")}</div>`}${(t.errores || []).length ? `<br><small class="dim">${esc(t.errores.join(" · "))}</small>` : ""}</td>
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
  if (d.bt === "guardar") {
    const f = S.btf; if (!f.setup && !confirmarSinSet(t)) return;
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
  if (d.btset) { const [id, s] = d.btset.split(":"), x = S.bt.get(id); if (x) { await btGuardar({ ...x, id, setup: s }); toast(btNombre(s) + "."); } return; }
  if (d.btedit) { const x = S.bt.get(d.btedit); if (x) { S.btf = { ...BT_VACIA(), ...x, id: d.btedit, errores: [...(x.errores || [])] }; render(); } return; }
  if (d.btdel) { if (!dosToques(t, "¿Borrar? Toca otra vez")) return; if (S.db) await S.db.doc("fm/plan").collection("backtest").doc(d.btdel).delete(); toast("Borrada."); return; }
});
// Saving without a setup takes a second tap: the stats need it
function confirmarSinSet(btn) { if (dosToques(btn, "Sin set up: toca otra vez para guardar igual")) return true; return false; }
root.addEventListener("input", (e) => {
  const d = e.target.dataset;
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
  if (t.id === "bt-foto" && t.files && t.files[0]) {
    S.btBusy = true; render();
    try { S.btf = await btLeer("", t.files[0]); toast("Revisa lo que ha leído Jarvis y guarda."); }
    catch (err) { toast("No he podido leer la captura: " + (err.message || "error")); }
    finally { S.btBusy = false; render(); }
  }
});
