#!/usr/bin/env node
// Market replay data for Jarvis: the MNQ 1-minute bars of each past weekday, from 0:00 to 12:00 New York time
// (London 2:00–5:00 and New York 9:30–12:00 included), one JSON file per day, for the artifact's fm/replay/dias.
//
//     node replay-sync.mjs <out-dir> [days back, default 30]
//
// READ ONLY, like topstep-sync.mjs: only login, contract search and price bars. It never touches orders or positions.
// Reads TOPSTEPX_USERNAME and TOPSTEPX_API_KEY from the environment and never prints them. Node standard library only.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const API = "https://api.topstepx.com";
export const READ_ONLY_ENDPOINTS = new Set(["/api/Auth/loginKey", "/api/Contract/search", "/api/History/retrieveBars"]);
function call(endpoint, body, token) {
  if (!READ_ONLY_ENDPOINTS.has(endpoint)) throw new Error(`refused: ${endpoint} is not a read-only endpoint`);
  const args = ["-sS", "-m", "30", "-X", "POST", API + endpoint, "-H", "Content-Type: application/json", "--data-binary", "@-"];
  if (token) args.push("-H", "Authorization: Bearer " + token);
  const j = JSON.parse(execFileSync("curl", args, { input: JSON.stringify(body), encoding: "utf8" }));
  if (j.success === false) throw new Error(`${endpoint}: Topstep error ${j.errorCode}`);
  return j;
}
// New York midnight of a date, as an instant (the offset is 4 or 5 hours depending on the clock change)
export function medianocheNY(fecha) {
  const guess = new Date(fecha + "T05:00:00Z");
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).format(guess));
  return new Date(guess.getTime() - h * 3600000);
}
// The bars of one day, packed: minutes since New York midnight and the four prices
export function empaquetar(fecha, contrato, bars) {
  const t0 = medianocheNY(fecha).getTime(), ord = [...bars].sort((a, b) => (a.t < b.t ? -1 : 1));
  return { fecha, contrato, inicio: new Date(t0).toISOString(), m: ord.map((b) => Math.round((Date.parse(b.t) - t0) / 60000)),
           o: ord.map((b) => b.o), h: ord.map((b) => b.h), l: ord.map((b) => b.l), c: ord.map((b) => b.c), v: ord.map((b) => b.v || 0) };
}
async function main() {
  const out = process.argv[2], dias = Number(process.argv[3] || 30);
  if (!out) throw new Error("usage: node replay-sync.mjs <out-dir> [days]");
  const u = (process.env.TOPSTEPX_USERNAME || "").trim(), k = (process.env.TOPSTEPX_API_KEY || "").trim();
  if (!u || !k) throw new Error("TOPSTEPX_USERNAME / TOPSTEPX_API_KEY are not set in this environment");
  const { token } = call("/api/Auth/loginKey", { userName: u, apiKey: k });
  const cs = (call("/api/Contract/search", { searchText: "MNQ", live: false }, token).contracts || []).filter((x) => x.symbolId === "F.US.MNQ");
  const k0 = cs.find((x) => x.activeContract) || cs[0];
  if (!k0) throw new Error("MNQ contract not found");
  fs.mkdirSync(out, { recursive: true });
  const hechos = [];
  for (let i = 0; i <= dias; i++) {
    const fecha = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10), wd = new Date(fecha + "T12:00:00Z").getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const t0 = medianocheNY(fecha);
    const bars = call("/api/History/retrieveBars", { contractId: k0.id, live: false, startTime: t0.toISOString(), endTime: new Date(t0.getTime() + 12 * 3600000).toISOString(),
      unit: 2, unitNumber: 1, limit: 1000, includePartialBar: false }, token).bars || [];
    if (bars.length < 60) continue;   // a holiday or no data
    if (i === 0 && Date.now() < t0.getTime() + 12 * 3600000) continue;   // today, until New York 12:00 is over
    fs.writeFileSync(path.join(out, fecha + ".json"), JSON.stringify(empaquetar(fecha, k0.name, bars)));
    hechos.push(fecha + ":" + bars.length);
  }
  console.log(JSON.stringify({ ok: true, contrato: k0.name, dias: hechos }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) main().catch((e) => { console.error("replay-sync failed:", e.message); process.exit(1); });
