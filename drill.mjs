#!/usr/bin/env node
// Live teardown drill that leaves no trace.
//
//     node server.mjs            # running
//     node drill.mjs [URL]       # default: https://nodejs.org/en
//
// Snapshots the graph data file and the teardowns folder, runs ONE real headless teardown of a
// public page through the same job API the panel uses, checks the panel steps, the note, the
// spoken line, the node births and the time, then restores the snapshot and deletes the test
// note and its evidence, so your first real teardown is genuinely the first.
//
// Not restorable from here: the running server's in-memory conversation keeps a one-line
// receipt of the drill until it restarts (there is no episode log file to snapshot).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as browser from "./browser.mjs";
import * as build from "./build.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BASE = "http://127.0.0.1:4700";
const URL_ = process.argv[2] || "https://nodejs.org/en";
const STEPS = ["Opening the site in a clean browser", "Waiting for it to load", "REA is watching while I scroll",
               "REA is reading the code", "Taking a snapshot", "Listing everything it loaded", "Identifying the stack",
               "Writing the teardown"];
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(name, ok, detail) {
  results.push(Boolean(ok));
  console.log(`  ${ok ? "✓" : "✗"} ${name}: ${detail}`);
}

async function post(p, body) {
  const r = await fetch(BASE + p, { method: "POST", body: JSON.stringify(body),
                                    headers: { "Content-Type": "application/json", Origin: BASE } });
  return r.json();
}
const get = async (p) => (await fetch(BASE + p)).json();

function notesDir() {
  const cfgFile = path.join(ROOT, "config.json");
  const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, "utf8")) : {};
  return cfg.notes_dir ? path.resolve(cfg.notes_dir) : path.join(ROOT, "notes");
}

/** {relative path: sha256} of every file under folder. */
function tree(folder) {
  const out = {};
  if (!fs.existsSync(folder)) return out;
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out[path.relative(folder, full)] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    }
  })(folder);
  return out;
}
const sameTree = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
const hasFiles = (d) => Object.keys(tree(d)).length > 0;

async function main() {
  console.log(`Drill: one headless teardown of ${URL_}, then put everything back\n`);
  const notes = notesDir();
  const teardowns = path.join(notes, "captures", "teardowns"), concepts = path.join(notes, "concepts");
  const graphFile = path.join(ROOT, "viewer", "graph-data.js");
  const snap = { graph: fs.readFileSync(graphFile), teardowns: tree(teardowns), concepts: tree(concepts),
                 dirs: [path.join(teardowns, "assets"), teardowns, concepts, path.join(notes, "captures")].map((d) => [d, fs.existsSync(d)]) };
  const labelsBefore = build.readGraph().nodes.map((n) => n.label);
  let job = null, evidenceJob = null;
  try {
    const t0 = Date.now();
    const start = await post("/teardown/start", { url: URL_, question: "What is this site built with?", headless: true });
    const ackS = (Date.now() - t0) / 1000;
    check("acknowledged at once", start.ok && ackS < 3, `${JSON.stringify(start.answer)} in ${ackS.toFixed(2)}s`);
    if (!start.ok) return;
    const jobId = start.action.job, seen = [];
    for (;;) {
      job = await get(`/teardown/job?id=${jobId}`);
      if (job.step >= 0 && seen.at(-1) !== job.step) seen.push(job.step);
      if (job.state !== "running") break;
      if (Date.now() - t0 > 900000) throw new Error("the teardown took over 15 minutes");
      await sleep(300);
    }
    const wall = (Date.now() - t0) / 1000;
    check("panel steps", JSON.stringify(job.steps) === JSON.stringify(STEPS) && seen.every((s, i) => i === 0 || s >= seen[i - 1])
          && seen.at(-1) === 7 && seen.length >= 4,
          `the 8 steps in order; saw ${seen.length} live: ` + seen.map((i) => i + 1).join(" -> "));
    check("finished", job.state === "done", `state ${job.state}: ${JSON.stringify(job.answer)}`);
    check("time", job.finished_in != null && wall < 900, `${job.finished_in} s by the job's clock, ${wall.toFixed(0)} s wall`);
    const births = job.births || [];
    const expect = [...(labelsBefore.includes("REA") ? [] : ["REA"]), "teardown"];
    const got = births.map((b) => (b.node.label === "REA" ? "REA" : b.node.group.replace(/s$/, "")));
    check("node births", JSON.stringify(got) === JSON.stringify(expect) &&
          births.every((b, i) => b.index === labelsBefore.length + i),
          births.map((b) => `${b.index}: ${b.node.label} (${b.node.group})`).join(", ") || "none");
    const answer = job.answer || "";
    const badSpeech = (answer.match(/https?:\/\/\S+|\b[\w-]+\.(?:js|glb|wasm|png|json|html)\b/g) || [])
      .filter((w) => !/^[A-Z][A-Za-z]*\.js$/.test(w));          // "Next.js" is a library, not a file
    check("spoken line", answer.trim() && !badSpeech.length, JSON.stringify(answer) + (badSpeech.length ? ` (contains ${badSpeech})` : ""));
    const card = job.card || {};
    const onCard = JSON.stringify(card.chips || []) + (card.totals || "") + (card.host || "");
    check("panel card", card.totals && !/\/(root|home|Users)\/|\.md\b/.test(onCard),
          `${card.host}: ${(card.chips || []).length} chips, ${JSON.stringify(card.totals)}, snapshot ${card.snapshot}`);
    if (births.length) {
      const note = path.isAbsolute(births.at(-1).path) ? births.at(-1).path : path.join(ROOT, births.at(-1).path);
      const text = fs.readFileSync(note, "utf8");
      const analysed = text.includes("analysed: True");
      const want = [...(analysed ? ["**Verdict:**", "## The answer", "## The stack", "## How the effect works", "## What it loads",
                                    "## Rebuild it", "## What the evidence can't show"]
                                 : ["**Verdict:**", "## The stack", "## What it loads", "## What the evidence can't show"]),
                    "[[REA]]", "## Evidence", "### REA evidence ids"];
      const missing = want.filter((w) => !text.includes(w));
      const img = /!\[[^\]]*\]\((assets\/[^)]+\.png)\)/.exec(text);
      const imgFile = img ? path.join(path.dirname(note), decodeURIComponent(img[1])) : null;
      const imgOk = Boolean(imgFile && fs.existsSync(imgFile) && fs.readFileSync(imgFile).subarray(0, 4).toString("latin1") === "\x89PNG");
      check("note sections", !missing.length && imgOk,
            `${analysed ? "analysed" : "evidence only (no brain)"}; ` +
            (missing.length ? `missing ${JSON.stringify(missing)}` : `all ${want.length} parts present`) + `; snapshot embedded: ${imgOk}`);
      evidenceJob = (/^job: (\S+)/m.exec(text) || [])[1] || null;
    }
  } finally {
    // ── put everything back ──
    fs.writeFileSync(graphFile, snap.graph);
    for (const [folder, before] of [[teardowns, snap.teardowns], [concepts, snap.concepts]]) {
      for (const rel of Object.keys(tree(folder))) if (!(rel in before)) fs.rmSync(path.join(folder, rel));
    }
    for (const [d, existed] of snap.dirs) {          // only folders the drill created, and only if empty
      if (!existed && fs.existsSync(d) && !hasFiles(d)) fs.rmSync(d, { recursive: true, force: true });
    }
    if (evidenceJob && /^[\w-]+$/.test(evidenceJob)) {
      fs.rmSync(path.join(path.dirname(browser.PROFILES), "evidence", evidenceJob), { recursive: true, force: true });
    }
    console.log();
    check("restored: graph data", fs.readFileSync(graphFile).equals(snap.graph), "byte-identical to before the drill");
    check("restored: teardowns and concepts", sameTree(tree(teardowns), snap.teardowns) && sameTree(tree(concepts), snap.concepts),
          "test note, snapshot and any new REA note deleted; nothing else touched");
    const held = browser.processesUsing(browser.PROFILES);
    const left = fs.existsSync(browser.PROFILES) ? fs.readdirSync(browser.PROFILES) : [];
    check("no investigation Chrome", !held.length && !left.length, `${held.length} processes, ${left.length} profile folders`);
    const nAfter = build.readGraph().nodes.length;
    check("galaxy back to its old size", nAfter === labelsBefore.length, `${nAfter} notes`);
  }
  const fails = results.filter((r) => !r).length;
  console.log(`\ndrill: ${results.length - fails} pass, ${fails} fail`);
  console.log("note: the server's in-memory conversation still holds the drill's one-line receipt until it restarts.");
  return fails ? 1 : 0;
}

process.exit(await main());
