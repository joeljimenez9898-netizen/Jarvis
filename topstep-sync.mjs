#!/usr/bin/env node
// Topstep (TopstepX / ProjectX Gateway) sync for Jarvis's Funding Manager. READ ONLY.
//
//     node topstep-sync.mjs <dir-with-artifact-docs> [out.json] [mercado.json]
//     node topstep-sync.mjs --mercado [mercado.json]      (only the market prices, for the hourly update)
//     ... <dir> out.json mercado.json --checkin Londres|"Nueva York" checkin.json   (also the session question)
//
// Reads TOPSTEPX_USERNAME and TOPSTEPX_API_KEY from the environment (never printed), logs in,
// reads balances and trades, and writes one document for the app (fm/topstep) plus a Spanish
// morning summary. The account rules (target, drawdown, consistency) come from the app's own
// account documents, saved by ArtifactData under <dir>/fm/main/cuentas/*.json.
//
// The market part reads the price of the futures in MERCADO (contract search + price bars) for
// Jarvis's fm/mercado document.
//
// THE LAW: only the read endpoints below may be called. Nothing here can place, change
// or cancel an order, or close a position. Node standard library only; HTTP goes through curl so
// the cloud environment's proxy is used.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const API = "https://api.topstepx.com";
export const READ_ONLY_ENDPOINTS = new Set(["/api/Auth/loginKey", "/api/Account/search", "/api/Trade/search",
                                           "/api/Contract/search", "/api/History/retrieveBars"]);
export const MERCADO = ["MNQ"];
const HISTORY_DAYS = 90;
const OPS_DAYS = HISTORY_DAYS, OPS_MAX = 400;  // the trade list in fm/topstep, newest first

function call(endpoint, body, token) {
  if (!READ_ONLY_ENDPOINTS.has(endpoint)) throw new Error(`refused: ${endpoint} is not a read-only endpoint`);
  const args = ["-sS", "-m", "30", "-X", "POST", API + endpoint, "-H", "Content-Type: application/json", "--data-binary", "@-"];
  if (token) args.push("-H", "Authorization: Bearer " + token);
  const out = execFileSync("curl", args, { input: JSON.stringify(body), encoding: "utf8" });
  const j = JSON.parse(out);
  if (j.success === false) throw new Error(`${endpoint}: Topstep error ${j.errorCode}${j.errorMessage ? " " + j.errorMessage : ""}`);
  return j;
}

/** Futures trading day: a session that opens at 17:00 Chicago belongs to the next date. */
export function tradingDay(ts) {
  const shifted = new Date(new Date(ts).getTime() + 7 * 3600 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(shifted);
}

function readDocs(dir, collection) {
  const d = path.join(dir, ...collection.split("/"));
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => {
    const j = JSON.parse(fs.readFileSync(path.join(d, f), "utf8"));
    return { id: path.basename(f, ".json"), ...(j.data && typeof j.data === "object" ? j.data : j) };
  });
}

const money = (n) => (n == null || !isFinite(n) ? "—" : new Intl.NumberFormat("es-ES", { style: "currency", currency: "USD", useGrouping: "always" }).format(n));
const pts = (n) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" }).format(n);
const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + pts(Math.abs(n));
const pct = (x) => (x == null || !isFinite(x) ? "—" : `${Math.round(x * 100)} %`);

/** The same rules the app uses: EOD trailing floor capped at the lock level, consistency since the last payout. */
export function stats(rule, acct, days, payouts) {
  const ini = Number(rule.balanceInicial) || 0, dd = Number(rule.ddMax) || 0;
  const dates = Object.keys(days).sort();
  let run = ini, peak = ini;
  const pays = payouts.filter((p) => p.cuentaId === rule.id);
  const payBy = {};
  for (const p of pays) payBy[p.fecha] = (payBy[p.fecha] || 0) + (Number(p.bruto) || 0);
  for (const d of [...new Set([...dates, ...Object.keys(payBy)])].sort()) { run += (days[d] || 0) - (payBy[d] || 0); peak = Math.max(peak, run); }
  const balance = acct.balance;
  peak = Math.max(peak, balance);                   // the closing balance counts once the day ends
  const tope = rule.ddTope === "" || rule.ddTope == null ? ini : Number(rule.ddTope);
  const suelo = !dd ? null : rule.ddTipo === "estatico" ? ini - dd : Math.min(peak - dd, tope);
  const lastPay = pays.map((p) => p.fecha).sort().pop() || "";
  const ciclo = dates.filter((d) => d > lastPay).map((d) => days[d]);
  const total = ciclo.reduce((a, b) => a + b, 0), mejor = Math.max(0, ...ciclo);
  const r = (Number(rule.consistencia) || 0) / 100;
  const objetivo = Number(rule.objetivo) || 0, beneficio = balance - ini;
  return { alias: rule.alias, puedeOperar: acct.canTrade, balance, beneficio, objetivo, falta: objetivo ? Math.max(0, objetivo - beneficio) : null,
           progreso: objetivo ? beneficio / objetivo : null, suelo, distancia: suelo == null ? null : balance - suelo, dd,
           consistencia: r ? { regla: r, total, mejor, pctMejor: total > 0 ? mejor / total : null, cumple: total > 0 ? mejor <= r * total + 1e-9 : true,
                              falta: Math.max(0, mejor / r - total), maxHoy: Math.max(mejor, (r * total) / (1 - r)) } : null,
           diasOperados: dates.length, ultimoDia: dates.at(-1) || null, ultimoPnl: dates.length ? days[dates.at(-1)] : null };
}

function resumen(list, at) {
  const L = [`Jarvis · Estado de cuentas Topstep (${new Date(at).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "long", timeStyle: "short" })})`, ""];
  const alertas = [];
  for (const s of list) {
    L.push(`${s.alias}: ${money(s.balance)} · beneficio ${money(s.beneficio)}${s.objetivo ? ` · faltan ${money(s.falta)} para el objetivo (${pct(Math.max(0, s.progreso))})` : ""}`);
    if (s.distancia != null) L.push(`  Drawdown: suelo ${money(s.suelo)}, margen ${money(s.distancia)} (${pct(s.distancia / s.dd)} del máximo)`);
    if (s.ultimoDia) L.push(`  Último día operado (${s.ultimoDia}): ${money(s.ultimoPnl)}`);
    if (s.consistencia && s.consistencia.total > 0) {
      const c = s.consistencia;
      L.push(`  Consistencia ${pct(c.regla)}: mejor día ${money(c.mejor)} = ${pct(c.pctMejor)} del beneficio${c.cumple ? " (cumple)" : ` (faltan ${money(c.falta)} de beneficio para cumplir)`}. Máximo hoy sin romperla: ${money(c.maxHoy)}`);
      if (!c.cumple) alertas.push(`${s.alias}: consistencia sin cumplir`);
    }
    if (s.puedeOperar === false) alertas.push(`${s.alias}: Topstep la marca como no operable`);
    if (s.distancia != null && s.distancia <= 0) alertas.push(`${s.alias}: ha tocado el drawdown`);
    else if (s.distancia != null && s.dd && s.distancia / s.dd < 0.3) alertas.push(`${s.alias}: menos del 30 % de margen de drawdown`);
    if (s.objetivo && s.falta === 0) alertas.push(`${s.alias}: objetivo alcanzado, revisa la consistencia y los días mínimos`);
    L.push("");
  }
  L.push(alertas.length ? "Avisos: " + alertas.join("; ") + "." : "Sin avisos: ninguna cuenta cerca de sus límites.");
  return L.join("\n");
}

/** One future: last price (5-minute bars), today's session and yesterday's close (daily bars). */
function precio(simbolo, token) {
  const c = (call("/api/Contract/search", { searchText: simbolo, live: false }, token).contracts || [])
    .filter((x) => x.symbolId === "F.US." + simbolo);
  const k = c.find((x) => x.activeContract) || c[0];
  if (!k) return { error: "contrato no encontrado" };
  const now = new Date();
  const bars = (unit, unitNumber, ms, limit) => call("/api/History/retrieveBars", { contractId: k.id, live: false, startTime: new Date(now - ms).toISOString(),
    endTime: now.toISOString(), unit, unitNumber, limit, includePartialBar: true }, token).bars || [];
  const dias = bars(4, 1, 10 * 86400000, 5).sort((a, b) => (a.t < b.t ? 1 : -1));        // newest first
  const ult = bars(2, 5, 4 * 86400000, 1).sort((a, b) => (a.t < b.t ? 1 : -1))[0];
  if (!dias.length || !ult) return { contrato: k.name, error: "sin precios" };
  const hoy = dias[0], ayer = dias[1];
  const cambio = ayer ? ult.c - ayer.c : null;
  return { contrato: k.name, descripcion: k.description, precio: ult.c, hora: ult.t, dia: hoy.d || tradingDay(hoy.t),
           apertura: hoy.o, maximo: Math.max(hoy.h, ult.h), minimo: Math.min(hoy.l, ult.l), cierreAnterior: ayer ? ayer.c : null,
           cambio, cambioPct: ayer ? cambio / ayer.c : null };
}

export function textoMercado(m) {
  const L = [];
  for (const [s, p] of Object.entries(m.simbolos)) {
    if (p.error) { L.push(`${s}: ${p.error}`); continue; }
    const hora = new Date(p.hora).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" });
    L.push(`${s} (${p.contrato}): ${pts(p.precio)} a las ${hora} (hora de España)` +
           (p.cierreAnterior != null ? `, ${signed(p.cambio)} puntos (${p.cambioPct >= 0 ? "+" : "−"}${Math.abs(p.cambioPct * 100).toFixed(2).replace(".", ",")} %) desde el cierre anterior (${pts(p.cierreAnterior)})` : "") +
           `. Sesión del ${p.dia.split("-").reverse().join("/")}: apertura ${pts(p.apertura)}, máximo ${pts(p.maximo)}, mínimo ${pts(p.minimo)}.`);
  }
  return L.join("\n");
}

function mercado(token) {
  const m = { at: new Date().toISOString(), simbolos: {} };
  for (const s of MERCADO) { try { m.simbolos[s] = precio(s, token); } catch (e) { m.simbolos[s] = { error: "no disponible" }; } }
  m.texto = textoMercado(m);
  return m;
}

/**
 * Whole trades from Topstep's fills (half-turns). A fill with no P&L opens; one with P&L closes,
 * matched first-in first-out per contract. The fills of one closing order make one trade. P&L is net
 * of the fees of both sides, so a day's trades add up to that day's P&L.
 */
export function operaciones(fills) {
  const open = {}, byOrder = new Map();
  const sorted = fills.filter((f) => !f.voided && f.creationTimestamp).sort((a, b) => (a.creationTimestamp < b.creationTimestamp ? -1 : 1));
  for (const f of sorted) {
    const q = (open[f.contractId] ||= []), size = Number(f.size) || 0;
    if (f.profitAndLoss == null) { q.push({ left: size, size, price: f.price, at: f.creationTimestamp, fee: Number(f.fees) || 0 }); continue; }
    let left = size, cost = 0, matched = 0, fees = Number(f.fees) || 0, first = null;
    while (left > 0 && q.length) {
      const lot = q[0], n = Math.min(left, lot.left);
      cost += n * lot.price; matched += n; fees += (lot.fee * n) / lot.size; first ||= lot.at;
      lot.left -= n; left -= n; if (!lot.left) q.shift();
    }
    const key = f.orderId ?? f.id, t = byOrder.get(key) || { id: String(key), contrato: f.contractId, side: f.side, size: 0, exitCost: 0, cost: 0, matched: 0,
                                                        bruto: 0, fees: 0, abre: first, cierra: f.creationTimestamp };
    t.size += size; t.exitCost += size * f.price; t.cost += cost; t.matched += matched; t.bruto += Number(f.profitAndLoss) || 0; t.fees += fees;
    t.abre = t.abre && first ? (t.abre < first ? t.abre : first) : t.abre || first; t.cierra = f.creationTimestamp;
    byOrder.set(key, t);
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  return [...byOrder.values()].map((t) => {
    const pnl = r2(t.bruto - t.fees);
    return { id: t.id, fecha: tradingDay(t.cierra), instr: (t.contrato.split(".")[3] || t.contrato), dir: t.side === 1 ? "LONG" : "SHORT",
             entrada: t.matched ? r2(t.cost / t.matched) : null, salida: r2(t.exitCost / t.size), contratos: t.size, pnl, bruto: r2(t.bruto),
             resultado: pnl > 0 ? "TP" : pnl < 0 ? "SL" : "BE", dur: t.abre ? Math.max(0, Math.round((new Date(t.cierra) - new Date(t.abre)) / 60000)) : null,
             abre: t.abre, cierra: t.cierra };
  }).sort((a, b) => (a.cierra < b.cierra ? 1 : -1));
}

/**
 * Watching Joel's own daily limits (the Riesgo tab of his Plan de Futuros, fm/plan/cuentas): today's P&L of each
 * live account linked to Topstep against its daily loss limit and daily profit target. Each warning is given once a day.
 */
export function vigilancia(planCuentas, cuentasTs, at, prev) {
  const hoy = tradingDay(at), ya = new Set(prev && prev.fecha === hoy ? prev.avisados || [] : []);
  const filas = [], nuevos = [];
  for (const c of planCuentas) {
    const t = c.topstepId && cuentasTs[c.topstepId];
    if (!t || !t.dias || !["ACTIVA", "EXAM"].includes(c.estado)) continue;
    const pnl = Math.round((t.dias[hoy] || 0) * 100) / 100;
    const dll = c.dllOn === false ? null : Number(c.dll ?? Math.abs(Number(c.sl) || 0)) || null;
    const dpt = c.dptOn === false ? null : Number(c.dpt ?? (Number(c.tp) || 0)) || null;
    const nivel = dll && pnl <= -dll ? "dll100" : dll && pnl <= -0.8 * dll ? "dll80" : dpt && pnl >= dpt ? "dpt100" : null;
    filas.push({ cuenta: c.codigo, hoy: pnl, limitePerdida: dll, objetivo: dpt, nivel });
    if (!nivel || ya.has(c.codigo + ":" + nivel) || (nivel === "dll80" && ya.has(c.codigo + ":dll100"))) continue;
    ya.add(c.codigo + ":" + nivel);
    nuevos.push(nivel === "dll100" ? `🛑 ${c.codigo} ha pasado su límite de pérdida diaria: lleva ${money(pnl)} hoy (límite ${money(-dll)}). Su plan dice: ${c.dllAccion || "Liquidar"}.`
      : nivel === "dll80" ? `⚠️ ${c.codigo} lleva ${money(pnl)} hoy: está al ${pct(-pnl / dll)} de su límite de pérdida diaria (${money(-dll)}).`
      : `🎯 ${c.codigo} ha llegado a su objetivo diario: lleva ${money(pnl)} hoy (objetivo ${money(dpt)}). Su plan dice: ${c.dptAccion || "Liquidar"}.`);
  }
  return { fecha: hoy, at, cuentas: filas, avisados: [...ya], nuevos };
}

// <motor-reglas> Joel's rules engine. One copy: the iPad Plan de Futuros runs this same text (build-space.mjs copies it in),
// so the hourly watch on his phone and the app always say the same. Pure: no I/O, no clock, plain JavaScript.
//   estrategia: his settings (Plan de Futuros → Hoy operas → Ajustar la estrategia)
//   cuentas: [{ codigo, tipo, estado, grupo, tp, sl, orden, pnl, dias: { "YYYY-MM-DD": pnl }, tradesHoy: [pnl or { pnl, at }, …] }]
//   ahora: the time of the reading (ISO), to know whether London is over; londresCerrada: true after the London session
// Exams, London + New York (exModo "londres"): London enters risking lonIni for the same ratio; averaging into a pullback
// raises the whole position's risk to at most lonR and the target to lonT (the better average price reaches it sooner).
// With lonMax above lonT, past +lonT the stop goes to +lonT to reach for lonMax. Nothing ever takes the position past −lonR. New York only plays with London's profit, up to the day's
// consistency cap; a London stop means no New York on that account. Exams, 2 bullets (exModo "balas"): bullet 1 risks b1r for
// b1t; if it wins, bullet 2 in the same account closes at exactly b2t (no trailing). The day never passes the consistency cap.
// Exams that start the day at +examCerca or more (on a 3.000 target; scaled to the account's) are group B, near passing: kept
// apart from group A, one trade a day risking cercaR for what is left. They enter group B the day after they cross.
// Pause: pausaStops stops in one day end the day; a week at −pausaSemana or pausaRojos red days means a day off.
// Funded: group A goes for the big day (+fuerteTP), group B (big day done) does diasPayout minimum days (risk minimoSL for
// minimo, then the stop goes to +minimo) and asks for the payout; each group splits in two halves that never take the same
// trade. An account with margin for less than two stops trades in recovery (recupR risk) until it has it again.
export const ESTRATEGIA_DEF = { v: 5, modo: "individual", exModo: "londres", lonIni: 500, lonR: 1000, lonT: 1000, lonMax: 1000, opsDia: 2, b1r: 1000, b1t: 1000, b2r: 1000, b2t: 500,
  consistencia: 50, fuerteTP: 1500, fuerteSL: 1000, minimo: 150, minimoSL: 1000, recupR: 500, diasPayout: 4, pausaStops: 2, pausaSemana: 2000, pausaRojos: 3,
  examCerca: 2000, cercaR: 500 };
// Older saved settings: before v2 the funded numbers were the old ones; before v3 there was no London + New York plan;
// before v4 London was 1.000 for 500 with trailing, now it is 1:1; before v5 the big day was +1.000 and the payout took 5 days.
export function estrategiaDe(guardada) {
  const g = { ...(guardada || {}) }, v = Number(g.v) || 1;
  if (v < 2) for (const k of ["fuerteTP", "fuerteSL", "minimo", "minimoSL", "recupR"]) delete g[k];
  if (v < 3) delete g.exModo;
  if (v < 4) { delete g.lonT; delete g.lonMax; }
  if (v < 5) { delete g.fuerteTP; delete g.diasPayout; }
  delete g.v;
  return { ...ESTRATEGIA_DEF, ...g };
}
export function motorReglas({ estrategia: E, cuentas, hoy, ahora, londresCerrada }) {
  const m = (n) => Math.round(Math.abs(n)).toLocaleString("es-ES", { useGrouping: "always" }) + " $";
  const sg = (n) => (Math.round(n) === 0 ? "" : n < 0 ? "−" : "+") + m(n);
  const viva = (c) => c.estado === "ACTIVA" || c.estado === "EXAM";
  const out = { examenes: [], fondeadas: [], avisos: [], resumen: "" };
  const av = (k, txt) => out.avisos.push({ key: hoy + ":" + k, txt });
  // margin to the end-of-day trailing floor (Topstep): the floor follows the best closing balance, never above the start
  const margen = (c) => {
    const dias = c.dias || {}, h = Number(dias[hoy]) || 0, dd = Math.abs(Number(c.sl) || 2000), pnl0 = (Number(c.pnl) || 0) - h;
    const prev = Object.keys(dias).filter((d) => d < hoy).sort(), suma = prev.reduce((a, d) => a + (Number(dias[d]) || 0), 0);
    let run = pnl0 - suma, pico = Math.max(0, run);
    for (const d of prev) { run += Number(dias[d]) || 0; pico = Math.max(pico, run); }
    const suelo = Math.min(pico - dd, 0);
    return { h, pnl0, antes: prev.map((d) => Number(dias[d]) || 0), m0: pnl0 - suelo, ahora: (Number(c.pnl) || 0) - suelo };
  };
  // Joel's hours are New York time: London 2:00–5:00, New York 10:30–12:00. Past 5:00 (until the evening session at 18:00)
  // London is over and anything he trades belongs to New York.
  const hm = (t, tz) => { const [h, mi] = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(t)).split(":").map(Number); return h * 60 + mi; };
  const enNY = (t) => { const x = hm(t, "America/New_York"); return x >= 300 && x < 1080; }, nyYa = !!londresCerrada || (!!ahora && enNY(ahora));
  // New York's 10:30–12:00 in Spain's time on this day (the gap is 5 or 6 hours depending on the clock changes)
  const dif = ((hm(ahora || Date.now(), "Europe/Madrid") - hm(ahora || Date.now(), "America/New_York")) + 1440) % 1440;
  const hh = (n) => String(Math.floor(n / 60) % 24).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
  const nyHora = "10:30–12:00 de Nueva York, " + hh(630 + dif) + "–" + hh(720 + dif) + " en España";
  // each group can play its own exam plan (modos: { groupId: "londres" | "balas" }); without one, the general exModo
  const modoDe = (c) => (E.modos && E.modos[c.grupo]) || E.exModo, stopDe = (c) => (modoDe(c) === "londres" ? E.lonR : E.b1r);
  for (const c of cuentas.filter((x) => viva(x) && x.tipo !== "Fondeada")) {
    let ops = (c.tradesHoy || []).map((x, i) => (typeof x === "number" ? { pnl: x, ny: i > 0 } : { pnl: Number(x.pnl) || 0, ny: x.at ? enNY(x.at) : i > 0 }));
    // no London today: New York plays London's part (same plan), but it is still called New York
    const soloNY = ops.length > 0 && ops.every((x) => x.ny);
    if (soloNY) ops = ops.map((x) => ({ ...x, ny: false }));
    const tr = ops.map((x) => x.pnl), tot = tr.reduce((a, x) => a + x, 0), obj = Number(c.tp) || 3000, tope = obj * E.consistencia / 100, g = margen(c);
    const L = ops.filter((x) => !x.ny).reduce((a, x) => a + x.pnl, 0), hayNY = ops.some((x) => x.ny);
    const umbral = E.examCerca * obj / 3000, cerca = g.pnl0 >= umbral, falta = obj - (Number(c.pnl) || 0);
    let txt;
    if ((Number(c.pnl) || 0) >= obj) { txt = "🏁 Examen pasado (" + sg(c.pnl) + "). No operes más en ella: revisa la consistencia y pide la fondeada.";
      av(c.codigo + ":objetivo", "🏁 " + c.codigo + " ha llegado al objetivo del examen (" + sg(c.pnl) + "). No operes más en ella: revisa la consistencia y pide la fondeada. Su sitio en la rotación lo ocupa la suplente."); }
    else if (g.ahora <= 0) { txt = "🔥 Cuenta quemada.";
      av(c.codigo + ":quemada", "🔥 " + c.codigo + " se ha quemado. Entra la suplente en su lugar y repón la reserva comprando otro examen con el fondo de exámenes."); }
    else if (tot >= tope) { txt = "🏁 Tope del día: " + sg(tot) + ". Cierra y no operes más esta cuenta hoy.";
      av(c.codigo + ":tope", "🏁 " + c.codigo + " lleva " + sg(tot) + " hoy: es el tope del día por la consistencia (" + m(tope) + "). Cierra y no operes más esta cuenta hoy."); }
    else if (cerca) {
      const r = Math.min(E.cercaR, g.m0), ga = Math.min(falta, tope - tot);
      if (!tr.length) txt = "Grupo B · cerca de pasar (" + sg(g.pnl0) + ", faltan " + m(obj - g.pnl0) + "): conservador, aparte del grupo A. Un solo trade: arriesga " + m(r) +
        " para ganar " + m(ga) + " y pasas el examen. Si promedias, el riesgo total nunca pasa de " + m(r) + ".";
      else if (tot <= -0.9 * r) { txt = "🛑 Grupo B · stop (" + sg(tot) + "): para por hoy. Mañana, otro trade conservador.";
        av(c.codigo + ":cerca-ko", "🛑 " + c.codigo + " (cerca de pasar) ha hecho stop (" + sg(tot) + "). Para por hoy; " + ((Number(c.pnl) || 0) >= umbral ? "sigue en el grupo B, mañana otro trade conservador de " + m(r) + "." : "baja de +" + m(umbral) + " y mañana vuelve al grupo A.")); }
      else txt = "Grupo B · hoy " + sg(tot) + ", le faltan " + m(falta) + ". Un trade al día: para por hoy y mañana a por lo que falta.";
    }
    else if (modoDe(c) === "londres") {
      const r = Math.min(E.lonR, g.m0), ini = Math.min(E.lonIni || r, r), tIni = Math.round(ini * E.lonT / E.lonR), t = Math.round(r * E.lonT / E.lonR);
      const lonTxt = "Londres: entra (2–3 contratos) arriesgando " + m(ini) + " para ganar " + m(tIni) + (E.lonT === E.lonR ? " (1:1)" : "") + ". " +
        (r > ini ? "Si retrocede, promedia: el riesgo de toda la posición sube como máximo a " + m(r) + " y el objetivo pasa a " + m(t) + ", que con el mejor precio medio llega antes. " : "") +
        "Si va a favor, puedes añadir contratos. " +
        (E.lonMax > E.lonT ? "Si llega a " + sg(t) + " y empuja con fuerza, sube el stop a " + sg(t) + " y busca " + sg(E.lonMax) + ". " : "") +
        "Nunca más de −" + m(r) + " en toda la posición.";
      if (soloNY) {
        if (L <= -0.9 * r) { txt = "🛑 Stop en Nueva York (" + sg(L) + "), hoy sin Londres: día cerrado en esta cuenta.";
          av(c.codigo + ":ny-ko", "🛑 " + c.codigo + " ha hecho stop en Nueva York (" + sg(L) + "); hoy no hubo entrada en Londres. Día cerrado en esta cuenta."); }
        else if (L > 0) { txt = "✅ Nueva York en " + sg(L) + " (hoy no hubo entrada en Londres). Día en verde: mañana sigue esta cuenta.";
          av(c.codigo + ":ny-ok", "✅ " + c.codigo + " ha cerrado Nueva York en " + sg(L) + " (hoy no hubo entrada en Londres). Día en verde: mañana sigue esta cuenta."); }
        else txt = "Nueva York en " + sg(L) + " (hoy sin Londres). Si sigues, el stop de todo lo de hoy no pasa de −" + m(r) + ".";
      }
      else if (L <= -0.9 * r) { txt = "🛑 Stop en Londres (" + sg(L) + "): hoy no opera Nueva York.";
        av(c.codigo + ":lon-ko", "🛑 " + c.codigo + " ha hecho stop en Londres (" + sg(L) + "). Hoy no operes Nueva York en esta cuenta: no hay ganancias con las que jugar. Mañana toca la siguiente cuenta."); }
      else if (L > 0 && hayNY && tot <= 0) { txt = "🛑 Nueva York se ha comido lo de Londres (" + sg(tot) + "): día cerrado.";
        av(c.codigo + ":ny-cero", "🛑 En " + c.codigo + " Nueva York se ha comido las ganancias de Londres (día en " + sg(tot) + "). Cierra el día en esta cuenta."); }
      else if (L > 0 && (hayNY || nyYa)) { txt = "🗽 Nueva York: juega solo con lo de Londres. Arriesga como máximo " + m(tot) + " y busca " + sg(tope - tot) + " más (día a " + sg(tope) + ").";
        av(c.codigo + ":lon-ok", "✅ " + c.codigo + " ha cerrado Londres en " + sg(L) + ". En Nueva York juegas solo con esas ganancias: arriesga como máximo " + m(L) + " y busca " + sg(tope - L) +
          " más para dejar el día en " + sg(tope) + ". Si Nueva York se lo come, cierras el día en 0."); }
      else if (L > 0) txt = "Londres en " + sg(L) + ". En Nueva York (" + nyHora + ") juegas solo con estas ganancias.";
      else if (tr.length && (hayNY || nyYa)) txt = "Londres en " + sg(L) + ": sin ganancias, hoy no hay Nueva York en esta cuenta.";
      else if (tr.length) txt = "Londres en " + sg(L) + ". Si sigues, el stop de todo lo de hoy no pasa de −" + m(r) + ".";
      else txt = nyYa ? "Londres ya pasó sin entrada. 🗽 Foco en Nueva York (" + nyHora + "): " + lonTxt.replace(/^Londres: /, "") : lonTxt;
    }
    else if (tr.length === 1 && tr[0] > 0) { const ga = Math.min(E.b2t, tope - tot), r = Math.min(E.b2r, g.ahora);
      txt = "✅ Bala 1 ganada. Bala 2: arriesga " + m(r) + " para ganar " + m(ga) + " y cierra en " + sg(ga) + " justos, sin trailing.";
      av(c.codigo + ":bala2", "✅ " + c.codigo + " ha ganado la bala 1 (" + sg(tr[0]) + "). Bala 2 en la misma cuenta: arriesga " + m(r) + " para ganar " + m(ga) + " y cierra en " + sg(ga) + " justos, sin trailing. Así el día queda en " + sg(tot + ga) + ", dentro del tope de " + m(tope) + "."); }
    else if (tr.length === 1 && tr[0] < 0) { txt = "🛑 Stop en la bala 1: esta cuenta para hoy.";
      av(c.codigo + ":stop", "🛑 " + c.codigo + " ha hecho stop en la bala 1 (" + sg(tr[0]) + "): esta cuenta para hoy. La siguiente bala va a la siguiente cuenta."); }
    else txt = tr.length ? "Día cerrado (" + sg(tot) + ")." : "Bala 1: arriesga " + m(Math.min(E.b1r, g.m0)) + " para ganar " + m(Math.min(E.b1t, obj - g.pnl0, tope)) + ".";
    if (g.ahora > 0 && g.ahora <= stopDe(c) && !((Number(c.pnl) || 0) >= obj) && !(tr.length === 1 && tr[0] < 0) && !(modoDe(c) === "londres" && L <= -0.9 * Math.min(E.lonR, g.m0)))
      av(c.codigo + ":margen", "⚠️ A " + c.codigo + " solo le quedan " + m(g.ahora) + " de margen: le cabe un stop más. Su próxima bala es la última.");
    if (!cerca && (Number(c.pnl) || 0) >= umbral && falta > 0)
      av(c.codigo + ":cerca", "🎯 " + c.codigo + " ya va " + sg(c.pnl) + ": pasa al grupo B, cerca de pasar. Desde mañana va aparte del resto (no la copies con ellas) y en conservador: " +
        "un trade de " + m(Math.min(E.cercaR, g.ahora)) + " para ganar lo que le falte (" + m(falta) + ").");
    out.examenes.push({ cuenta: c.codigo, fase: cerca ? "B" : "A", txt, hoy: tot, londres: L, pnl: Number(c.pnl) || 0, margen: g.ahora, falta: Math.max(0, obj - (Number(c.pnl) || 0)) });
  }
  const exB = out.examenes.filter((x) => x.fase === "B").map((x) => x.cuenta), exA = out.examenes.filter((x) => x.fase === "A").map((x) => x.cuenta);
  out.resumenEx = exB.length ? "Exámenes: grupo B, cerca de pasar, aparte y en conservador: " + exB.join(", ") + (exA.length ? " · grupo A, el plan normal: " + exA.join(", ") : "") + "." : "";
  // Funded accounts in two groups, each split in two so the same trade never goes into all of them:
  //   A (A1, A2): still need their big day (a day of +fuerteTP or more). B (B1, B2): big day done, doing diasPayout minimum
  //   days after it, then the payout. A big day today moves the account to B tomorrow. Halves alternate by account order.
  const fs_ = cuentas.filter((x) => viva(x) && x.tipo === "Fondeada")
    .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0) || String(a.codigo).localeCompare(String(b.codigo), "es", { numeric: true }));
  const info = fs_.map((c) => { const g = margen(c), i = g.antes.findIndex((v) => v >= E.fuerteTP), d0 = i < 0 ? 0 : g.antes.slice(i + 1).filter((v) => v >= E.minimo).length;
    return { c, ...g, grande: i >= 0, d0, d: d0 + (i >= 0 && g.h >= E.minimo ? 1 : 0) }; });
  const listo = (x) => x.grande && x.d0 >= E.diasPayout, riesgo = (x, r) => (x.m0 >= 2 * r ? r : Math.max(0, Math.min(E.recupR, x.m0)));
  const mitad = {};
  for (const L of ["A", "B"]) info.filter((x) => x.ahora > 0 && !listo(x) && (L === "B") === x.grande).forEach((x, i) => { mitad[x.c.codigo] = L + (i % 2 + 1); });
  for (const x of info) {
    const cod = x.c.codigo, sub = mitad[cod];
    if (x.ahora <= 0) { av(cod + ":quemada", "🔥 " + cod + " se ha quemado. Sale de su grupo; repón la cuenta con un examen nuevo del fondo de exámenes.");
      out.fondeadas.push({ cuenta: cod, rol: "quemada", grupo: "", txt: "🔥 Cuenta quemada.", hoy: x.h, pnl: Number(x.c.pnl) || 0, margen: x.ahora, dias: x.d }); continue; }
    const rol = listo(x) ? "payout" : x.grande ? "minimos" : x.m0 < 2 * E.fuerteSL ? "recuperacion" : "fuerte";
    const r = rol === "fuerte" ? riesgo(x, E.fuerteSL) : riesgo(x, E.minimoSL), suave = r < (rol === "fuerte" ? E.fuerteSL : E.minimoSL);
    const pre = sub ? "Grupo " + sub + " · " : "";
    let txt = rol === "payout" ? "💰 Tiene el día grande y " + x.d0 + " días mínimos: pide el payout."
      : rol === "fuerte" ? "💪 Día grande: arriesga " + m(r) + " para ganar " + m(E.fuerteTP) + "."
      : rol === "recuperacion" ? "🩹 Recuperación: arriesga " + m(r) + " para ganar " + m(E.minimo) + "; al llegar a " + sg(E.minimo) + " sube el stop a " + sg(E.minimo) +
        " y deja correr. Vuelve a por el día grande cuando tenga margen para 2 stops (le faltan " + m(2 * E.fuerteSL - x.m0) + ")."
      : (suave ? "🩹 Día mínimo suave: " : "📅 Día mínimo: ") + "arriesga " + m(r) + " para ganar " + m(E.minimo) + "; al llegar a " + sg(E.minimo) +
        " sube el stop a " + sg(E.minimo) + " y deja correr (lleva " + x.d0 + "/" + E.diasPayout + ").";
    if (rol !== "minimos" && rol !== "payout" && x.h >= E.fuerteTP) { txt = "✅ Día grande hecho hoy (" + sg(x.h) + "). Mañana pasa al grupo B: días mínimos.";
      av(cod + ":fuerte-ok", "✅ " + cod + " ha hecho su día grande (" + sg(x.h) + "). Cierra por hoy. Mañana pasa al grupo B para hacer " + E.diasPayout + " días mínimos y pedir el payout."); }
    else if (rol === "fuerte" && r && x.h <= -0.9 * r) { txt = "🛑 Día grande fallado (" + sg(x.h) + "): para por hoy.";
      av(cod + ":fuerte-ko", "🛑 " + cod + " ha fallado el día grande (" + sg(x.h) + "). Para por hoy" + (x.ahora < 2 * E.fuerteSL ? "; mañana va en recuperación (arriesga " + m(E.recupR) + ")" : "; mañana lo vuelve a intentar") + "."); }
    else if (rol === "minimos" && x.h >= E.minimo) {
      txt = "✅ Día mínimo hecho hoy (" + sg(x.h) + ", " + x.d + "/" + E.diasPayout + ").";
      av(cod + ":min-ok", "✅ " + cod + " ya tiene su día mínimo (" + sg(x.h) + ", lleva " + x.d + "/" + E.diasPayout + "). Si sigue abierta, el stop en " + sg(E.minimo) + " y deja correr."); }
    else if ((rol === "minimos" || rol === "recuperacion") && r && x.h <= -0.9 * r) { txt = "🛑 Stop en el día mínimo (" + sg(x.h) + "): para por hoy.";
      av(cod + ":min-ko", "🛑 " + cod + " ha hecho stop en su día mínimo (" + sg(x.h) + "): para por hoy."); }
    if (x.grande && !listo(x) && x.d >= E.diasPayout) av(cod + ":payout", "💰 " + cod + " ya tiene el día grande y " + x.d + " días mínimos: puedes pedir el payout.");
    const ko = r && x.h <= -0.9 * r && rol !== "payout";
    if (!ko && x.ahora > 0 && x.ahora <= Math.max(E.fuerteSL, E.minimoSL) && x.m0 > Math.max(E.fuerteSL, E.minimoSL))
      av(cod + ":margen", "⚠️ A " + cod + " solo le quedan " + m(x.ahora) + " de margen: le cabe un stop más. Mañana opera en recuperación.");
    out.fondeadas.push({ cuenta: cod, rol, grupo: sub || (rol === "payout" ? "Payout" : ""), txt: pre + txt, hoy: x.h, pnl: Number(x.c.pnl) || 0, margen: x.ahora, dias: x.d });
  }
  const de = (g) => out.fondeadas.filter((f) => f.grupo === g).map((f) => f.cuenta);
  const lado = (L, que) => (de(L + "1").length ? L + "1 (" + de(L + "1").join(", ") + ")" + (de(L + "2").length ? " y " + L + "2 (" + de(L + "2").join(", ") + ")" : "") + " " + que : "");
  const partes = [lado("A", "a por el día grande"), lado("B", "en días mínimos"), de("Payout").length ? "listas para el payout: " + de("Payout").join(", ") : ""].filter(Boolean);
  out.resumen = !info.length ? "" : !partes.length ? "Fondeadas hoy: ninguna cuenta opera." :
    "Fondeadas hoy: " + partes.join(" · ") + "." + (de("A2").length || de("B2").length ? " Cada mitad lleva su propio trade, nunca el mismo en todas." : "");
  // the pause: stops today across all accounts, and the week so far (Monday to today) across all accounts
  const vivas = cuentas.filter(viva), dia = (c, d) => Number((c.dias || {})[d]) || 0;
  const stopsHoy = vivas.filter((c) => dia(c, hoy) <= -0.9 * (c.tipo === "Fondeada" ? E.fuerteSL : stopDe(c))).length;
  const t0 = Date.parse(hoy + "T12:00:00Z"), lunes = new Date(t0 - ((new Date(t0).getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
  const porDia = {};
  for (const c of vivas) for (const [d, v] of Object.entries(c.dias || {})) if (d >= lunes && d <= hoy) porDia[d] = (porDia[d] || 0) + (Number(v) || 0);
  const semana = Object.values(porDia).reduce((a, v) => a + v, 0), rojos = Object.values(porDia).filter((v) => v < 0).length;
  out.pausa = { stopsHoy, semana: Math.round(semana), rojos, dia: stopsHoy >= E.pausaStops, semanal: semana <= -E.pausaSemana || rojos >= E.pausaRojos };
  if (out.pausa.dia) av("pausa-dia", "🛑 Hoy llevas " + stopsHoy + " stops entre todas tus cuentas: se acabó el día. No operes Nueva York ni ninguna otra cuenta hasta mañana.");
  if (out.pausa.semanal) av("pausa-semana", "⏸ Pausa: esta semana llevas " + sg(semana) + " entre todas tus cuentas" + (rojos ? " y " + rojos + (rojos === 1 ? " día" : " días") + " en rojo" : "") +
    ". Mañana no operes (copiador apagado): revisa qué ha fallado. Vuelves operando una sola cuenta hasta cerrar un día en verde.");
  return out;
}
// </motor-reglas>

/** The rules engine on the accounts Topstep reads (linked plan accounts only); a warning already given today is not repeated. */
export function reglasDelDia(planCuentas, cuentasTs, estrategia, at, prev) {
  // what was said is kept in vigilancia.avisados too, which every older copy of this script carries over within the day
  const hoy = tradingDay(at), ya = new Set(prev && prev.fecha === hoy ? [...((prev.reglas && prev.reglas.avisados) || []), ...(prev.avisados || []).filter((k) => k.startsWith(hoy + ":"))] : []);
  const cuentas = planCuentas.filter((c) => c.topstepId && cuentasTs[c.topstepId] && cuentasTs[c.topstepId].balance != null).map((c) => {
    const t = cuentasTs[c.topstepId];
    return { codigo: c.codigo, tipo: c.tipo, estado: c.estado, tp: c.tp, sl: c.sl, orden: c.orden, grupo: c.grupo, pnl: Math.round((t.balance - (Number(c.balanceIni) || 0)) * 100) / 100, dias: t.dias || {},
             tradesHoy: (t.trades || []).filter((o) => o.fecha === hoy).sort((a, b) => (a.cierra < b.cierra ? -1 : 1)).map((o) => ({ pnl: Number(o.pnl) || 0, at: o.cierra })) };
  });
  const r = motorReglas({ estrategia: estrategiaDe(estrategia), cuentas, hoy, ahora: at });
  const nuevos = r.avisos.filter((a) => !ya.has(a.key));
  return { examenes: r.examenes, fondeadas: r.fondeadas, resumen: [r.resumenEx, r.resumen].filter(Boolean).join("\n"), avisos: r.avisos.map((a) => a.txt), avisados: [...ya, ...nuevos.map((a) => a.key)], nuevos: nuevos.map((a) => a.txt) };
}

/**
 * After a session (London or New York): what was traded in each account today, how the account stands, and the next step
 * from his rules. This is the message that reaches his phone and the Jarvis page.
 */
export function resumenSesion(planCuentas, cuentasTs, estrategia, sesion, at) {
  const hoy = tradingDay(at), E = estrategiaDe(estrategia), usd = (n) => Math.round(Math.abs(n)).toLocaleString("es-ES", { useGrouping: "always" }) + " $";
  const sg = (n) => (Math.round(n) === 0 ? "" : n < 0 ? "−" : "+") + usd(n);
  const vinc = planCuentas.filter((c) => c.topstepId && cuentasTs[c.topstepId] && cuentasTs[c.topstepId].balance != null && ["ACTIVA", "EXAM"].includes(c.estado));
  const cuentas = vinc.map((c) => { const t = cuentasTs[c.topstepId];
    return { codigo: c.codigo, tipo: c.tipo, estado: c.estado, tp: c.tp, sl: c.sl, orden: c.orden, grupo: c.grupo, pnl: Math.round((t.balance - (Number(c.balanceIni) || 0)) * 100) / 100, dias: t.dias || {},
             tradesHoy: (t.trades || []).filter((o) => o.fecha === hoy).sort((a, b) => (a.cierra < b.cierra ? -1 : 1)).map((o) => ({ pnl: Number(o.pnl) || 0, at: o.cierra })) }; });
  const r = motorReglas({ estrategia: E, cuentas, hoy, ahora: at, londresCerrada: true });
  const L = ["Joel, resumen de " + sesion + ":"];
  for (const c of vinc) {
    const t = cuentasTs[c.topstepId], ops = (t.trades || []).filter((o) => o.fecha === hoy).sort((a, b) => (a.cierra < b.cierra ? -1 : 1));
    const ex = r.examenes.find((x) => x.cuenta === c.codigo), fo = r.fondeadas.find((x) => x.cuenta === c.codigo), info = ex || fo;
    if (!info) continue;
    const hecho = ops.length ? ops.map((o) => o.instr + " " + (o.dir === "LONG" ? "largo" : "corto") + " " + o.contratos + (o.contratos === 1 ? " contrato " : " contratos ") + sg(o.pnl)).join(", ") : "sin operar";
    const dia = ops.reduce((a, o) => a + (Number(o.pnl) || 0), 0);
    L.push("• " + c.codigo + (c.tipo === "Fondeada" ? " (fondeada)" : " (examen)") + ": " + hecho + (ops.length ? ". Hoy " + sg(dia) : "") + ". La cuenta va " + sg(info.pnl) +
      (ex ? ", le faltan " + usd(ex.falta) + " para pasar el examen" : ", " + fo.dias + "/" + E.diasPayout + " días mínimos") + " y tiene " + usd(info.margen) + " de margen. Siguiente paso: " + info.txt);
  }
  if (L.length === 1) L.push("No hay cuentas de Topstep vinculadas en tu Plan de Futuros.");
  if (r.resumenEx) L.push(r.resumenEx);
  if (r.resumen) L.push(r.resumen);
  if (r.pausa.dia || r.pausa.semanal) L.push(r.avisos.filter((a) => /:pausa-/.test(a.key)).map((a) => a.txt).join(" "));
  return L.join("\n");
}

/** The weekday session question: today's P&L per account, and what Jarvis asks. */
export function checkin(list, sesion, at) {
  const hoy = tradingDay(at);
  const filas = list.map((s) => ({ alias: s.alias, pnl: s.ultimoDia === hoy ? s.ultimoPnl : 0 }));
  const total = filas.reduce((a, f) => a + f.pnl, 0);
  const cifras = filas.map((f) => `${f.alias} ${money(f.pnl)}`).join(", ");
  const pregunta = `Joel, ¿cómo le ha ido en la sesión de ${sesion}? Hoy en Topstep: ${cifras} (total ${money(total)}). ` +
                   "Cuéntemelo en Jarvis: toque el micrófono y hábleme, o mándeme la foto del trade.";
  return { at, dia: hoy, sesion, filas, total: Math.round(total * 100) / 100, pregunta, respondido: false };
}

function login() {
  const u = (process.env.TOPSTEPX_USERNAME || "").trim(), k = (process.env.TOPSTEPX_API_KEY || "").trim();
  if (!u || !k) throw new Error("TOPSTEPX_USERNAME / TOPSTEPX_API_KEY are not set in this environment");
  const { token } = call("/api/Auth/loginKey", { userName: u, apiKey: k });
  if (!token) throw new Error("Topstep login returned no token");
  return token;
}

async function main() {
  if (process.argv[2] === "--mercado") {
    const out = process.argv[3] || "/tmp/fm-mercado.json", m = mercado(login());
    fs.writeFileSync(out, JSON.stringify(m, null, 1));
    console.log(JSON.stringify({ ok: true, out, simbolos: Object.keys(m.simbolos) }));
    return;
  }
  const pos = process.argv.slice(2, process.argv.includes("--checkin") ? process.argv.indexOf("--checkin") : undefined);
  const dir = pos[0], out = pos[1] || "/tmp/fm-topstep.json", outM = pos[2] || "/tmp/fm-mercado.json";
  const rules = (dir ? readDocs(dir, "fm/main/cuentas") : []).filter((c) => c.topstepId && c.estado === "activa");
  const payouts = dir ? readDocs(dir, "fm/main/payouts") : [];
  const token = login();
  const accounts = call("/api/Account/search", { onlyActiveAccounts: true }, token).accounts || [];
  const at = new Date().toISOString(), since = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString();
  const doc = { at, desde: since.slice(0, 10), cuentas: {} };
  const opsSince = new Date(Date.now() - OPS_DAYS * 86400000).toISOString();
  // Every active Topstep account is read, so any account the app links by its ID updates by itself;
  // the summary covers the ones Jarvis has rules for.
  for (const acct of accounts) {
    const trades = call("/api/Trade/search", { accountId: acct.id, startTimestamp: since, endTimestamp: at }, token).trades || [];
    const days = {};
    let unknown = 0;
    for (const t of trades) {
      if (t.voided) continue;
      if (!t.creationTimestamp) { unknown++; continue; }
      const d = tradingDay(t.creationTimestamp);
      days[d] = Math.round(((days[d] || 0) + (Number(t.profitAndLoss) || 0) - (Number(t.fees) || 0)) * 100) / 100;
    }
    doc.cuentas[acct.id] = { nombre: acct.name, balance: acct.balance, puedeOperar: acct.canTrade, simulada: acct.simulated, dias: days,
                             operaciones: trades.length, sinFecha: unknown,
                             trades: operaciones(trades).filter((o) => o.cierra >= opsSince).slice(0, OPS_MAX) };
  }
  const list = [];
  for (const rule of rules) {
    const acct = accounts.find((a) => String(a.id) === String(rule.topstepId));
    if (!acct) { doc.cuentas[rule.topstepId] = { error: "no aparece entre las cuentas activas de Topstep" }; continue; }
    list.push(stats(rule, acct, doc.cuentas[acct.id].dias, payouts));
  }
  doc.resumen = rules.length ? resumen(list, at) : "No hay cuentas de Jarvis vinculadas a Topstep (campo «ID de cuenta en Topstep»).";
  // the limits Joel set in his Plan de Futuros, and what was already said today (the previous fm/topstep, saved under <dir>/fm/topstep.json)
  const prevFile = dir && path.join(dir, "fm", "topstep.json");
  const raw = prevFile && fs.existsSync(prevFile) ? JSON.parse(fs.readFileSync(prevFile, "utf8")) : null;
  const prev = raw && raw.data && typeof raw.data === "object" ? raw.data : raw;
  doc.vigilancia = vigilancia(dir ? readDocs(dir, "fm/plan/cuentas") : [], doc.cuentas, at, prev && prev.vigilancia);
  // Joel's rules (exams: 2 bullets; funded: strong day + minimum days), each warning once a day, on the same phone message
  const estFile = dir && path.join(dir, "fm", "plan", "config", "estrategia.json");
  const estRaw = estFile && fs.existsSync(estFile) ? JSON.parse(fs.readFileSync(estFile, "utf8")) : null;
  doc.vigilancia.reglas = reglasDelDia(dir ? readDocs(dir, "fm/plan/cuentas") : [], doc.cuentas, estRaw && estRaw.data && typeof estRaw.data === "object" ? estRaw.data : estRaw, at, prev && prev.vigilancia);
  doc.vigilancia.nuevos.push(...doc.vigilancia.reglas.nuevos);
  doc.vigilancia.avisados = [...new Set([...doc.vigilancia.avisados, ...doc.vigilancia.reglas.avisados])];
  if (doc.vigilancia.nuevos.length) doc.resumen = "Avisos de hoy:\n" + doc.vigilancia.nuevos.join("\n") + "\n\n" + doc.resumen;
  if (doc.vigilancia.reglas.resumen) doc.resumen += "\n" + doc.vigilancia.reglas.resumen;
  const m = mercado(token);
  fs.writeFileSync(outM, JSON.stringify(m, null, 1));
  doc.resumen += "\n\nMercado: " + m.texto;
  const ci = process.argv.indexOf("--checkin");
  if (ci > 0) {
    const q = checkin(list, process.argv[ci + 1] || "Londres", at);
    q.resumen = resumenSesion(dir ? readDocs(dir, "fm/plan/cuentas") : [], doc.cuentas, estRaw && estRaw.data && typeof estRaw.data === "object" ? estRaw.data : estRaw, q.sesion, at);
    q.pregunta = q.resumen + "\n¿Cómo te has sentido operando? Cuéntamelo en Jarvis: toca el micrófono y háblame, o mándame la foto del trade.";
    fs.writeFileSync(process.argv[ci + 2] || "/tmp/fm-checkin.json", JSON.stringify(q, null, 1));
  }
  fs.writeFileSync(out, JSON.stringify(doc, null, 1));
  console.log(JSON.stringify({ ok: true, out, cuentasLeidas: accounts.length, vinculadas: rules.length, avisos: doc.vigilancia.nuevos.length,
                               operaciones: Object.values(doc.cuentas).reduce((n, c) => n + (c.operaciones || 0), 0) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((e) => { console.error("topstep-sync failed:", e.message); process.exit(1); });
}
