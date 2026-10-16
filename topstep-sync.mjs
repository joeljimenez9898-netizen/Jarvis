#!/usr/bin/env node
// Topstep (TopstepX / ProjectX Gateway) sync for Jarvis's Funding Manager. READ ONLY.
//
//     node topstep-sync.mjs <dir-with-artifact-docs> [out.json] [mercado.json]
//     node topstep-sync.mjs --mercado [mercado.json]      (only the market prices, for the hourly update)
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
  return { alias: rule.alias, balance, beneficio, objetivo, falta: objetivo ? Math.max(0, objetivo - beneficio) : null,
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
  const dir = process.argv[2], out = process.argv[3] || "/tmp/fm-topstep.json", outM = process.argv[4] || "/tmp/fm-mercado.json";
  const rules = (dir ? readDocs(dir, "fm/main/cuentas") : []).filter((c) => c.topstepId && c.estado === "activa");
  const payouts = dir ? readDocs(dir, "fm/main/payouts") : [];
  const token = login();
  const accounts = call("/api/Account/search", { onlyActiveAccounts: true }, token).accounts || [];
  const at = new Date().toISOString(), since = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString();
  const doc = { at, desde: since.slice(0, 10), cuentas: {} };
  const list = [];
  for (const rule of rules) {
    const acct = accounts.find((a) => String(a.id) === String(rule.topstepId));
    if (!acct) { doc.cuentas[rule.topstepId] = { error: "no aparece entre las cuentas activas de Topstep" }; continue; }
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
                             operaciones: trades.length, sinFecha: unknown };
    list.push(stats(rule, acct, days, payouts));
  }
  doc.resumen = rules.length ? resumen(list, at) : "No hay cuentas de Jarvis vinculadas a Topstep (campo «ID de cuenta en Topstep»).";
  const m = mercado(token);
  fs.writeFileSync(outM, JSON.stringify(m, null, 1));
  doc.resumen += "\n\nMercado: " + m.texto;
  fs.writeFileSync(out, JSON.stringify(doc, null, 1));
  console.log(JSON.stringify({ ok: true, out, cuentasLeidas: accounts.length, vinculadas: rules.length,
                               operaciones: Object.values(doc.cuentas).reduce((n, c) => n + (c.operaciones || 0), 0) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((e) => { console.error("topstep-sync failed:", e.message); process.exit(1); });
}
