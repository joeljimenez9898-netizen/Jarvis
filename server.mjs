#!/usr/bin/env node
// Knowledge galaxy server.
//
// Serves ONLY the viewer/ folder on http://127.0.0.1:4700 and answers POST /chat from the
// notes. The brain is Claude Code itself (`claude -p`), signed in with your Claude
// subscription: no API key, no SDK. Node standard library only.
//
// config.json (optional) lives in the project root, never in viewer/, so nothing in it is
// reachable from the browser.

// ═════════════════════════════════════════════════════════════════════════════
// PERSONA: the whole character lives in this block. Rewrite it freely.
//
//   PERSONA          the system prompt for every /chat turn
//   BOOT_GREETING    the one line spoken when the page loads (after the first click)
//   CONTROL_TAGS     actions the brain asks for with a [TAG]; the server runs them.
//                    Add a tag here AND a handler in TAG_HANDLERS below.
//   RECEIPT_LINES    what is said after a tag really ran (ok) or failed (fail).
//                    The model never writes these, so it can never claim "done".
// ═════════════════════════════════════════════════════════════════════════════

export const BOOT_GREETING = "Hello, sir.";

const CONTROL_TAGS = {
  RESET:    { usage: "[RESET]",
              when: "they want to start over or have this conversation forgotten" },
  SHOW:     { usage: "[SHOW: exact note title]",
              when: "they ask to see, open, pull up or go to one specific note" },
  REINDEX:  { usage: "[REINDEX]",
              when: "they say their notes changed, or asks to rescan or rebuild the index" },
  TEARDOWN: { usage: "[TEARDOWN:SITE|QUESTION]",
              when: "they ask to tear down, reverse engineer or look under the hood of a website. " +
                    "SITE is its address (stripe.com), or the word this for the tab they're looking " +
                    "at; QUESTION is what they want to know" },
};

export const RECEIPT_LINES = {
  RESET:   { ok: "Slate wiped, sir. I remember nothing, professionally.",
             fail: "I'm afraid the slate refused to wipe: {reason}." },
  SHOW:    { ok: "{title}, as requested.",
             fail: "I can find no note called {title}, sir. I'd rather say so than guess." },
  REINDEX: { ok: "Re-indexed. {count} notes on file; the galaxy will redraw itself.",
             fail: "The re-index did not happen: {reason}." },
  TEARDOWN: { ok: "{spoken}",
              evidence_only: "I've taken it apart and filed the evidence, sir, but I couldn't think " +
                             "it through: {reason}.",
              busy: "I'm already taking one apart, sir.",
              started: "Right away, sir. Taking {host} apart; the panel will show you how it goes.",
              which: "Which site, sir? Say its name, as in stripe dot com.",
              cancelled: "Stopped, sir. Nothing was filed.",
              missing: "The workshop isn't fitted out yet, sir: {fix}.",
              refused: "I won't point the kit at that, sir: {reason}.",
              fail: "The teardown fell over, I'm afraid: {reason}." },
  TEARDOWN_CANCEL: { ok: "Stopping it now, sir.", fail: "Nothing's being taken apart, sir." },
  UNKNOWN: { fail: "I'm afraid I have no means of doing that, sir." },
  // Captures ("remember that ...") are not a tag, but they speak through receipts too.
  REMEMBER: { ok: "Committed to memory, sir: {title}.",
              fail: "I'm afraid that was not written down: {reason}.",
              partial: "I wrote it down but couldn't file it in the index: {reason}. Say rescan and I'll try again.",
              empty: "Remember what, sir?" },
};

const PERSONA = `You are a dry, impeccably polite British butler with a razor wit, and you keep
your employer's notes. You are unflappable, economical, and quietly amused.

Address your employer as "sir" now and then, at most once in a reply and in fewer than half
of your replies. Overdone, it grates.

Your words are read aloud and the note itself is already on their screen. So:
- Give ONE witty sentence, then the facts in plain words. One sentence of facts is
  ideal; two at most. Never recite, quote or narrate the note back.
- One genuinely funny line beats three bland ones. If nothing funny comes
  naturally, skip the wit and just be brief. Never force it.
- Plain spoken English: no markdown, no lists, no emoji.

Each question arrives with a <notes> block of the most relevant notes, numbered by
index. Answer ONLY from those notes and from earlier turns. No outside knowledge.
If the notes do not cover the question, say so plainly and with a little dignity,
in one sentence. Never invent a source, never pad, and never present a related
note as if it were the answer.

You can only talk. The one way to act is a control tag. When they ask for one of
these actions, reply with ONLY the tag, exactly as shown, and nothing else:
{tags}
The server performs the tag and reports back itself, so never describe the result.
If they ask for any other action (sending, booking, saving, deleting, reminding),
say plainly that you can't do it, and offer what you can. Never say anything was
done, sent, booked, saved or changed unless an earlier turn shows a RECEIPT for
it with ok=true. Claiming "done" when nothing happened is the one unforgivable sin.

Turns marked as small talk (greetings, thanks, jokes) get one short line in
character and no notes.

After every reply except a bare tag, add a final line: USED: followed by the
comma-separated indexes of the notes you actually relied on, or USED: none.`;

export const SYSTEM_PROMPT = PERSONA.replace("{tags}",
  Object.values(CONTROL_TAGS).map((t) => `  ${t.usage}  when ${t.when}`).join("\n"));

// The teardown bay's analyst: one call per teardown, given the evidence digest.
const TEARDOWN_BRAIN = `You are the analyst in Jarvis's teardown bay. You receive a DIGEST of evidence
about one website and the user's QUESTION. The evidence was captured three ways, and every
digest line says which:
  [REA]            observed or analysed by REA (Reverse Engineer Anything)
  [Jarvis browser] read by Jarvis's own browser
  [Jarvis scan]    found by Jarvis scanning the code REA captured

Rules:
- Every claim must trace to a line in the digest. If you can't point to the line, leave it out.
- Inference is allowed only when labelled: say "likely" (for example, how an effect probably
  works given the libraries and shader names present).
- Never invent a library, version, file, route, number or technique that isn't in the digest.
- Keep attribution straight: never credit REA with what Jarvis read, or the reverse.
- Quote sizes, counts and versions exactly as given.

Output EXACTLY this, with nothing before or after:
LABEL: Teardown · <host>
SPOKEN: <two or three sentences for a dry British butler to say aloud. The headline answer to
the question first, then the most surprising detail. No web addresses, no file names, no
markdown; numbers as words.>
SUMMARY: <one short paragraph>
---NOTE---
<a markdown note with exactly these parts, in this order:
**Verdict:** <one line>
## The answer
## The stack            (each item with its evidence and who captured it)
## How the effect works (numbered; "likely" for inference)
## What it loads
## Rebuild it           (5 to 7 numbered steps a developer could hand to Claude Code)
## What the evidence can't show
Do not add a title, a snapshot or an Evidence section: Jarvis adds those.>`;

// Written once, the first time anything is taken apart.
const REA_CONCEPT_NOTE =
  "REA (Reverse Engineer Anything, github.com/morluto/rea) is the kit [[Jarvis]] uses to take " +
  "websites apart. It observes a page running in a clean, throwaway browser: it reads the " +
  "scripts, the routes and the files the page loads, and takes a snapshot. It never clicks, " +
  "types, logs in or changes anything. Every teardown note links here.";

// ═════════════════════════════ end of persona ═══════════════════════════════

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as build from "./build.mjs";

// The teardown bay is optional: Jarvis boots and answers without it.
let bay = null, evidence = null, BAY_ERROR = null;
try {
  bay = await import("./teardown.mjs");
  evidence = await import("./evidence.mjs");
} catch (e) {
  bay = evidence = null;
  BAY_ERROR = `${e.name}: ${e.message}`;
}

export const ROOT = build.ROOT;
const VIEWER = path.join(ROOT, "viewer");
const CONFIG = path.join(ROOT, "config.json");
const GRAPH_FILE = path.join(VIEWER, "graph-data.js");
export const HOST = "127.0.0.1", PORT = 4700;

const TOP_K = 6;
const HISTORY_TURNS = 6;           // question/answer pairs kept for follow-ups
const MAX_BODY = 16000;
const CHAT_EFFORT = "low";         // short grounded answers
const TEARDOWN_EFFORT = "medium";

const STOPWORDS = new Set(`a an and are as at be but by can could did do does for from had has have
how i if in into is it its me my of on or our so that the their them then there these they
this to was we were what when where which who whom why will with would you your about any
tell much many also than just more most should been being over under up out`.split(/\s+/));

// Fingerprint of the code this process loaded. preflight.mjs compares it with the files
// on disk to catch a server that was never restarted after an edit.
export const CODE_MODULES = ["server.mjs", "build.mjs", "teardown.mjs", "browser.mjs", "evidence.mjs"];
export const CODE_SHA = crypto.createHash("sha256").update(Buffer.concat(CODE_MODULES
  .map((f) => path.join(ROOT, f)).filter((p) => fs.existsSync(p)).map((p) => fs.readFileSync(p)))).digest("hex").slice(0, 16);

let history = [];                  // [{role, content}], at most HISTORY_TURNS * 2
let lastNodes = [];
const graphCache = { mtime: null, notes: [] };
const pushHistory = (...turns) => { history.push(...turns); history = history.slice(-HISTORY_TURNS * 2); };

// One conversation at a time: a /chat waits for the one before it (the brain call is async).
let chain = Promise.resolve();
function serialized(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

// Python's urllib.parse.quote: everything but letters, digits, _.-~ and /.
const quote = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
  .replace(/%2F/g, "/");
const squash = (s) => String(s).split(/\s+/).filter(Boolean).join(" ");
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const resolveNotePath = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const isInside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

// ── notes ─────────────────────────────────────────────────────────

/** Crude plural folding so "margins" matches "margin". */
function fold(word) {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 3 && word.endsWith("s") && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

export function tokens(text) {
  return (String(text).toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter((t) => t.length > 1 && !STOPWORDS.has(t)).map(fold);
}

function indexEntry(i, label, body) {
  const counts = new Map();
  for (const t of tokens(body)) counts.set(t, (counts.get(t) || 0) + 1);
  return { id: i, label, body, titleTokens: new Set(tokens(label)), bodyCounts: counts };
}

/** Nodes from graph-data.js (so indexes match the viewer) + full note text. */
export function loadNotes() {
  const mtime = fs.statSync(GRAPH_FILE).mtimeMs;
  if (graphCache.mtime !== mtime) {
    const graph = build.readGraph();
    const notes = graph.nodes.map((node) => {
      let body;
      try { body = fs.readFileSync(resolveNotePath(node.path), "utf8"); } catch { body = node.excerpt; }
      return indexEntry(node.id, node.label, body);
    });
    Object.assign(graphCache, { mtime, notes });
  }
  return graphCache.notes;
}

export function rank(question, notes) {
  const terms = new Set(tokens(question));
  const scored = [];
  for (const note of notes) {
    let score = 0;
    for (const term of terms) {
      if (note.titleTokens.has(term)) score += 5;
      const hits = note.bodyCounts.get(term) || 0;
      if (hits) score += 1 + Math.min(hits, 4) * 0.5;
    }
    if (score) scored.push([score, note.id]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  return scored.slice(0, TOP_K).map((s) => s[1]);
}

// Small talk never touches the notes, so it can never move the camera. Greetings
// are stripped first, so "good morning, who owns the loyalty app?" is still a question.
const GREETING = new RegExp(
  // longer phrases first: "how are you doing" must win over "how are you"
  "^(?:(?:how are you doing|how are you|how's it going|how's your day|what's up|" +
  "who are you|what can you do|are you there|you there|good (?:morning|afternoon|evening|night)|" +
  "thanks a lot|thank you|thanks|nice one|good one|well done|see you|goodbye|bye|hello|hiya|" +
  "howdy|hi|hey|yo|morning|evening|cheers|ta|nice|great|cool|okay|ok)" +
  "(?: (?:there|again|so much|very much|jarvis|galaxy|today|mate))*(?:[ ,.!?]+|$))+");
const JOKE = /\b(?:joke|jokes|pun|puns|riddle|make me laugh|something funny|cheer me up)\b/;
const stripChars = (s, chars) => s.replace(new RegExp(`^[${chars}]+|[${chars}]+$`, "g"), "");

/** Returns [aboutNotes, questionForRetrieval]. */
export function classify(question) {
  const text = squash(question.toLowerCase().replace(/’/g, "'"));
  if (JOKE.test(text)) return [false, ""];
  const rest = stripChars(text.replace(GREETING, "").trim(), " ,.!?");
  if (!rest) return [false, ""];
  return [true, rest];
}

// ── captures: the ONE door for new notes ────────────────────────
// Everything that births a note at runtime goes through addNote(): it writes the file,
// links it exactly as build.mjs would, appends it to graph-data.js, and adds it to the
// live search index so the very next /chat can cite it. No re-run of build.mjs needed.
// It is synchronous, so no other request can run in the middle of it.

export class CaptureError extends Error {
  constructor(reason, written = false, file = null) {
    super(reason);
    Object.assign(this, { reason, written, path: file });
  }
}

function config() {
  try { return JSON.parse(fs.readFileSync(CONFIG, "utf8")); } catch { return {}; }
}

export function notesDir() {
  const configured = config().notes_dir;
  return configured ? path.resolve(String(configured).replace(/^~(?=$|\/|\\)/, os.homedir())) : path.join(ROOT, "notes");
}

export function makeTitle(text, words = 6) {
  const parts = text.match(/[\p{L}\p{N}\p{M}_'’-]+/gu) || [];
  while (parts.length && ["the", "a", "an", "that", "to"].includes(parts[0].toLowerCase())) parts.shift();
  const title = Array.from(stripChars(parts.slice(0, words).join(" ").trim(), " \\-'’")).slice(0, 60).join("").trim();
  return title ? title[0].toUpperCase() + title.slice(1) : "Capture";
}

export const LABEL_SLOT = "@@LABEL@@";           // replaced with the note's final label
export const LABEL_URL_SLOT = "@@LABEL_URL@@";   // the same, URL-encoded, for links: "a (2).png" -> "a%20%282%29.png"

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
                "October", "November", "December"];
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const frontValue = (v) => (typeof v === "string" && v.includes(":") ? JSON.stringify(v)
  : typeof v === "boolean" ? (v ? "True" : "False") : String(v));

/** THE door for new notes. Write, link, append, index. Returns {index, node, links, anchor, path}.
 *    text:        the sentence to capture, or for a markdown note the text to place it by
 *    markdown:    a full note body instead of the one-sentence form (LABEL_SLOT is filled in)
 *    attachments: {path relative to the note's folder: Buffer}, written before the note
 *    meta:        extra frontmatter fields
 *  Throws CaptureError; .written says whether the file exists despite the failure. */
export function addNote(text, { folder = "captures", title = null, kind = "capture", markdown = null,
                                 attachments = null, meta = null } = {}) {
  text = squash(text);
  if (!text) throw new CaptureError("there was nothing to write down");
  let sentence = text[0].toUpperCase() + text.slice(1);
  if (!".!?".includes(sentence.at(-1))) sentence += ".";
  title = (title || makeTitle(text)).replace(/[\\/:*?"<>|]+/g, " ").trim() || "Capture";

  // 1. the file
  const graph = build.readGraph();
  const taken = new Set(graph.nodes.map((n) => n.label.toLowerCase()));
  let base, file, label;
  try {
    base = notesDir();
    if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) throw new CaptureError(`the notes folder ${base} doesn't exist`);
    const folderPath = path.join(base, folder);
    fs.mkdirSync(folderPath, { recursive: true });
    label = title;
    for (let n = 2; taken.has(label.toLowerCase()) || fs.existsSync(path.join(folderPath, `${label}.md`)); n++) label = `${title} (${n})`;
    file = path.join(folderPath, `${label}.md`);
    const now = new Date();
    const front = { type: kind, date: localDate(now), ...(meta || {}) };
    const head = "---\n" + Object.entries(front).map(([k, v]) => `${k}: ${frontValue(v)}\n`).join("") + "---\n\n";
    const content = markdown != null
      ? `${head}# ${label}\n\n${markdown.replaceAll(LABEL_URL_SLOT, quote(label)).replaceAll(LABEL_SLOT, label).trim()}\n`
      : `${head}# ${label}\n\n${sentence}\n\nCaptured ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}.\n`;
    for (const [rel, data] of Object.entries(attachments || {})) {
      const target = path.join(folderPath, rel.replaceAll(LABEL_SLOT, label));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data, { flag: "wx" });
    }
    fs.writeFileSync(file, content, { encoding: "utf8", flag: "wx" });
    if (fs.readFileSync(file, "utf8") !== content) throw new CaptureError("the file didn't read back the way it was written", true, file);
  } catch (e) {
    if (e instanceof CaptureError) throw e;
    throw new CaptureError(e.code === "EEXIST" ? "a file by that name appeared at the same moment" : (e.message || String(e)));
  }

  // 2. link it, append it, index it. The file exists from here on.
  try {
    const index = graph.nodes.length;
    const records = graph.nodes.map((node) => {
      const p = resolveNotePath(node.path);
      try { return build.readNote(p, path.dirname(p)); }
      catch { return { label: node.label, text: node.excerpt, wikilinks: new Set() }; }   // gone since the last build
    });
    const record = build.readNote(file, base);
    const newLinks = build.linksFor(index, [...records, record]);
    const node = build.makeNode(index, record, newLinks.length);
    for (const link of newLinks) graph.nodes[link.target === index ? link.source : link.target].degree += 1;
    graph.nodes.push(node);
    graph.links.push(...newLinks);

    // Born next to its most related neighbour: best retrieval score among its links.
    const notes = loadNotes();
    const ranked = rank(text, notes);
    const linked = new Set(newLinks.map((l) => (l.target === index ? l.source : l.target)));
    let anchor = ranked.find((i) => linked.has(i)) ?? null;
    if (anchor === null) anchor = [...linked].sort((a, b) => a - b)[0] ?? (ranked.length ? ranked[0] : null);

    build.writeGraph(graph.nodes, graph.links);
    // Live search index: append directly, and mark the cache current for the new file.
    notes.push(indexEntry(index, label, fs.readFileSync(file, "utf8")));
    graphCache.mtime = fs.statSync(GRAPH_FILE).mtimeMs;
    lastNodes = [index];
    return { index, node, links: newLinks, anchor, path: node.path };
  } catch (e) {        // the file is safe; say exactly what didn't happen
    throw new CaptureError(e.message || e.name, true, file);
  }
}

/** The /remember endpoint's work: one capture, one spoken receipt line. */
export function remember(text) {
  const lines = RECEIPT_LINES.REMEMBER;
  const content = stripChars(text.replace(/^\s*remember(?:\s+that)?\b[\s,.:;]*/i, "").trim(), " ,.:;");
  if (!content) return [400, { ok: false, answer: lines.empty, error: "nothing to remember" }];
  let result;
  try {
    result = addNote(content);
  } catch (e) {
    if (!(e instanceof CaptureError)) throw e;
    const line = (e.written ? lines.partial : lines.fail).replace("{reason}", e.reason);
    return [500, { ok: false, answer: line, error: e.reason, written: e.written }];
  }
  pushHistory({ role: "user", content: `Remember that ${content}` },
              { role: "assistant", content: `[REMEMBER] RECEIPT ok=true title=${result.node.label} index=${result.index}` });
  return [200, { ok: true, answer: lines.ok.replace("{title}", result.node.label), ...result }];
}

// ── the brain: Claude Code, on your subscription ──────────────────
// Each call is one `claude -p` run with no tools, no MCP servers, no settings and no saved
// session. ANTHROPIC_API_KEY is removed from its environment, so it always uses the
// signed-in Claude subscription. Never --bare (that mode needs an API key).

export class ChatError extends Error {
  /** spoken: a short reason fit to be said aloud (no paths, no file names) */
  constructor(message, status = 502, spoken = "the brain gave an error") {
    super(message);
    Object.assign(this, { status, spoken });
  }
}

const COMMON_BIN = [path.join(os.homedir(), ".local", "bin"), path.join(os.homedir(), ".claude", "local"),
                    path.join(os.homedir(), ".npm-global", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

/** The Claude Code command: CLAUDE_CMD, then config.json "claude_cmd", then PATH, then the usual folders. */
export function findClaude() {
  const set = process.env.CLAUDE_CMD || config().claude_cmd;
  if (set) return String(set).replace(/^~(?=$|\/|\\)/, os.homedir());
  if (bay) {
    const hit = bay.which("claude");
    if (hit) return hit;
  }
  const names = process.platform === "win32" ? ["claude.cmd", "claude.exe", "claude"] : ["claude"];
  for (const dir of [...(process.env.PATH || "").split(path.delimiter).filter(Boolean), ...COMMON_BIN]) {
    for (const n of names) {
      const p = path.join(dir, n);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
    }
  }
  return null;
}

/** The environment the brain runs with: yours, minus any API key. */
export function brainEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  return env;
}

export function brainArgs(effort, model) {
  const args = ["-p", "--output-format", "json", "--tools", "", "--no-session-persistence",
                "--strict-mcp-config", "--setting-sources", "", "--effort", effort];
  if (model) args.push("--model", model);
  return args;
}

/** History is plain text; each call is stateless, so the earlier turns ride in the prompt. */
function promptWithHistory(turns, turn) {
  if (!turns.length) return turn;
  const past = turns.map((t) => `<turn role="${t.role}">\n${t.content}\n</turn>`).join("\n");
  return `<earlier_turns>\n${past}\n</earlier_turns>\n\nThe new turn, to answer now:\n\n${turn}`;
}

function runClaude(cmd, system, prompt, { effort, timeoutS, signal }) {
  const work = path.join(os.tmpdir(), "jarvis-brain");       // an empty folder: no project files leak in
  fs.mkdirSync(work, { recursive: true });
  const sysFile = path.join(work, `system-${process.pid}-${crypto.randomBytes(4).toString("hex")}.txt`);
  fs.writeFileSync(sysFile, system);
  const args = [...brainArgs(effort, config().model ? String(config().model) : null), "--system-prompt-file", sysFile];
  const shell = process.platform === "win32" && /\.(cmd|bat)$/i.test(cmd);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(shell ? `"${cmd}"` : cmd, shell ? args.map((a) => `"${a}"`) : args,
                    { cwd: work, env: brainEnv(), stdio: ["pipe", "pipe", "pipe"], shell });
    } catch (e) {
      fs.rmSync(sysFile, { force: true });
      return resolve({ code: -1, out: "", err: String(e), spawnError: e });
    }
    let out = "", err = "", timedOut = false, aborted = false, spawnError = null;
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const kill = () => { try { child.kill("SIGKILL"); } catch { /* gone */ } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutS * 1000);
    const onAbort = () => { aborted = true; kill(); };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => { spawnError = e; });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fs.rmSync(sysFile, { force: true });
      resolve({ code, out, err, timedOut, aborted, spawnError });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}

/** One brain call. Returns the reply text or throws ChatError. */
export async function callModel(prompt, { system = SYSTEM_PROMPT, effort = CHAT_EFFORT, timeoutS = 150, signal } = {}) {
  const cmd = findClaude();
  if (!cmd) {
    throw new ChatError("Claude Code isn't installed: install it (npm install -g @anthropic-ai/claude-code), " +
                        "run claude once and sign in with your Claude account, then ask again.", 503,
                        "Claude Code isn't installed on this computer");
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await runClaude(cmd, system, prompt, { effort, timeoutS, signal });
    if (r.aborted) throw new ChatError("cancelled", 499, "it was cancelled");
    if (r.spawnError) {
      throw new ChatError(`Couldn't start Claude Code (${r.spawnError.code || r.spawnError.message}).`, 503,
                          "Claude Code isn't installed on this computer");
    }
    if (r.timedOut) throw new ChatError(`Claude Code took longer than ${timeoutS}s to answer.`, 504, "the brain took too long");
    let data = null;
    try { data = JSON.parse(r.out.trim().split("\n").filter(Boolean).at(-1) || ""); } catch { /* below */ }
    const said = String(data?.result ?? (r.err || r.out)).trim();
    if (!data || data.is_error) {
      const status = data?.api_error_status;
      if (/log ?in|logged|sign(ed)? in|authenticat|api key|\b401\b/i.test(said) || status === 401) {
        throw new ChatError("Claude Code isn't signed in: run claude in a terminal, type /login and sign in " +
                            "with your Claude account (no API key needed), then ask again.", 401,
                            "Claude Code isn't signed in on this computer");
      }
      if (status === 429 || /limit|rate/i.test(said)) {
        throw new ChatError(`Claude usage limit reached: ${said.slice(0, 160)}`, 429, "the Claude usage limit is reached for now");
      }
      if (data?.stop_reason === "refusal") throw new ChatError("The model declined to answer that question.", 200, "it declined");
      throw new ChatError(`Claude Code failed: ${said.slice(-200) || `exit ${r.code}`}`, 502);
    }
    if (data.stop_reason === "refusal") throw new ChatError("The model declined to answer that question.", 200, "it declined");
    if (said) return said;
  }
  throw new ChatError("The model returned no text, even on a second try.", 502, "the brain returned nothing");
}

/** Strip the USED line. Returns [text, sources in retrieval-rank order (best first)]. */
export function parseAnswer(text, picked) {
  const m = /\n?\s*USED:\s*(.*)\s*$/i.exec(text);
  if (!m) return [text.trim(), []];
  const cited = new Set((m[1].match(/\d+/g) || []).map(Number));
  return [text.slice(0, m.index).trim(), picked.filter((i) => cited.has(i))];
}

// ── control tags ──────────────────────────────────────────────────
// A handler does the real work and returns a receipt: {ok: bool, ...fields for
// RECEIPT_LINES}. Only a receipt ever produces a "done" line.

const TAG_RE = /\[([A-Z][A-Z_]*)(?::\s*([^\]]*))?\]/g;

/** A reply that is (or contains) a known tag is an action; prose around it is ignored,
 *  so the model can't sneak a claim of success in next to the tag. */
export function findTag(text) {
  for (const m of text.matchAll(TAG_RE)) {
    if (m[1] in CONTROL_TAGS) return [m[1], (m[2] || "").trim()];
  }
  const m = /^\s*\[([A-Z][A-Z_]*)(?::[^\]]*)?\]\s*$/.exec(text);
  return m ? [m[1], ""] : [null, ""];             // unknown bare tag -> UNKNOWN
}

/** Execute a tag. Returns [spoken line, receipt]. */
async function runTag(tag, arg = "", opts = {}) {
  const handler = TAG_HANDLERS[tag];
  if (!(tag in CONTROL_TAGS) || !handler) {
    return [RECEIPT_LINES.UNKNOWN.fail, { tag, ok: false, reason: "no such action" }];
  }
  let receipt;
  try { receipt = await handler(arg, opts); }
  catch (e) { receipt = { ok: false, reason: e.message || e.name }; }     // a failed action is reported, not thrown
  receipt = { tag, arg, ...receipt };
  return [receiptLine(tag, receipt, arg), receipt];
}

export function receiptLine(tag, receipt, arg = "") {
  const lines = RECEIPT_LINES[tag] || {};
  const template = lines[receipt.line || (receipt.ok ? "ok" : "fail")] || (receipt.ok ? "Done." : "That did not happen: {reason}.");
  const fields = { title: arg, reason: "unknown error", ...receipt };
  let missing = false;
  const out = template.replace(/\{(\w+)\}/g, (_, k) => {
    if (!(k in fields)) { missing = true; return ""; }
    const v = fields[k];
    return v === null || v === undefined ? "None" : String(v);
  });
  return missing ? template : out;
}

function resetHistory() {
  history = [];
  lastNodes = [];
}

function bayDiag() {
  if (!bay) return { ready: false, problems: [`teardown.mjs could not be loaded (${BAY_ERROR}).`], fix: "restore teardown.mjs next to server.mjs" };
  return bay.diag();
}

const TEARDOWN_HEADLESS = process.env.JARVIS_TEARDOWN_HEADLESS === "1";

/** LABEL / SPOKEN / SUMMARY / ---NOTE--- -> object, or throws. */
export function parseTeardown(text) {
  const m = /^\s*LABEL:\s*(.+?)\s*$\s*^SPOKEN:\s*(.+?)\s*^SUMMARY:\s*(.+?)\s*^---NOTE---\s*$(.*)$/ms.exec(text.trim());
  if (!m) throw new Error("the analysis didn't come back in the LABEL / SPOKEN / SUMMARY / NOTE shape");
  const [label, spoken, summary, note] = m.slice(1).map((g) => g.trim());
  if (!label.startsWith("Teardown · ") || !spoken || !note) throw new Error("the analysis came back with an empty or mislabelled part");
  const missing = ["**Verdict:**", "## The answer", "## The stack", "## How the effect works", "## What it loads",
                   "## Rebuild it", "## What the evidence can't show"].filter((h) => !note.includes(h));
  return { label, spoken, summary, note, missing_sections: missing };
}

// Names a note might drop in. Any of these mentioned but absent from the digest is flagged.
export const KNOWN_TECH = ["Three.js", "Babylon.js", "PlayCanvas", "PixiJS", "OGL", "React Three Fiber", "R3F", "drei",
  "React", "Vue", "Svelte", "Angular", "Next.js", "Nuxt", "Astro", "Remix", "Gatsby", "GSAP",
  "ScrollTrigger", "Lenis", "Locomotive Scroll", "Theatre.js", "Framer Motion", "Motion One",
  "anime.js", "Lottie", "Rive", "Spline", "postprocessing", "Draco", "Basis", "KTX2",
  "meshoptimizer", "Vite", "webpack", "esbuild", "Rollup", "Parcel", "WebGPU", "Barba",
  "Swup", "Howler", "Tone.js", "Matter.js", "Cannon", "Rapier", "Ammo", "Tailwind", "jQuery"];
const LIBRARIES = new Set(KNOWN_TECH.map((t) => t.toLowerCase()));
// "Node.js", "Three.js": a capitalised name ending in .js is a product, not a file.
export const isProductName = (name) => LIBRARIES.has(name.toLowerCase()) || /^[A-Z][A-Za-z]*\.js$/.test(name);
const W = "[\\p{L}\\p{N}\\p{M}_]";                         // Python's Unicode \w
const FILE_RE = "\\b[\\w-]+\\.(?:js|mjs|glb|gltf|wasm|ktx2|hdr|exr|png|jpe?g|webp|mp4|webm|woff2?)\\b";

/** Claims in the note that the digest doesn't contain: libraries, versions, files, sizes. */
export function checkAgainstDigest(note, digest) {
  // "Rebuild it" recommends tools for *your* rebuild; it makes no claims about the site.
  note = note.replace(/## Rebuild it[\s\S]*?(?=\n## |$)/g, "");
  const low = digest.toLowerCase();
  const flags = [];
  for (const tech of KNOWN_TECH) {
    const word = new RegExp(`(?<![\\p{L}\\p{N}\\p{M}_.-])${escapeRe(tech)}(?![\\p{L}\\p{N}\\p{M}_-])`, "iu");   // "react" ≠ "mouse-reactive"
    if (word.test(note) && !word.test(digest)) flags.push(`library not in the evidence: ${tech}`);
  }
  for (const v of [...new Set(note.match(/\b(?:r\d{3}|\d+\.\d+\.\d+)\b/g) || [])].sort()) {
    if (!digest.includes(v)) flags.push(`version not in the evidence: ${v}`);
  }
  for (const f of [...new Set(note.match(new RegExp(FILE_RE, "gi")) || [])].sort()) {
    if (!low.includes(f.toLowerCase()) && !isProductName(f)) flags.push(`file not in the evidence: ${f}`);
  }
  const flat = digest.replace(/ /g, "");
  for (const size of [...new Set(note.match(/\b\d+(?:\.\d+)?\s?(?:KB|MB|GB)\b/g) || [])].sort()) {
    if (!flat.includes(size.replace(/ /g, ""))) flags.push(`size not in the evidence: ${size}`);
  }
  return flags;
}

/** The butler says no web addresses or file names, whatever the brain wrote. */
export function speakable(text) {
  text = text.replace(/https?:\/\/\S+/g, "the site");
  text = text.replace(/\b[\w-]+\.(?:js|mjs|glb|gltf|wasm|ktx2|hdr|exr|png|jpe?g|webp|avif|mp4|webm|json|css|html)\b/gi,
                      (m) => (isProductName(m) ? m : "a file"));       // "Three.js" is a library, not a file
  text = text.replace(/\b(?:[a-z0-9-]+\.)+(?:com|co|io|net|org|dev|app|design|studio|xyz|ai|uk|tech)\b/gi, "the site");
  return text.replace(/[*_`#]/g, "").trim();
}

function evidenceSection(ev, digestChars, flags = null) {
  const a = ev.assets, size = evidence.size;
  const rows = ["| Layer | Library | Version | Captured by | Evidence |", "|---|---|---|---|---|"];
  for (const r of ev.stack) {
    const how = r.file ? `banner/marker in \`${r.file.split("/").at(-1)}\`` : (r.note || "runtime global");
    const rt = r.runtime ? `; runtime: ${r.runtime.version} (${r.runtime.by})` : "";
    rows.push(`| ${r.layer} | ${r.name} | ${r.version || "—"} | ${r.by} | ${how}${rt} |`);
  }
  if (!ev.stack.length) rows.push("| — | nothing recognised | — | Jarvis scan of REA-captured code | no banners or markers |");
  const kinds = Object.entries(a.by_kind).sort((x, y) => y[1].bytes - x[1].bytes)
    .map(([k, t]) => `${k} ${t.files} (${size(t.bytes)})`).join(", ");
  const ids = Object.entries(ev.rea_evidence_ids || {}).filter(([, id]) => id).map(([op, id]) => `- \`${op}\`: \`${id}\``).join("\n");
  const origins = Object.keys(a.by_origin).length;
  return `## Evidence\n\n### Stack\n\n${rows.join("\n")}` +
    `\n\n### Totals (Jarvis browser)\n\n${a.files} files, ${size(a.bytes)} sized, ` +
    `from ${origins} origin${origins === 1 ? "" : "s"}: ${kinds}.\n` +
    a.notes.map((n) => `\n> ${n}`).join("") +
    `\n\n### REA evidence ids\n\n${ids}\n\n` +
    `Captured ${ev.captured_at} · job \`${ev.job_id}\` · loaded in ${ev.load_seconds}s · ` +
    `${ev.scripts.length} scripts (REA) · digest ${digestChars.toLocaleString("en-US")} characters.\n` +
    (flags === null ? "" : "\n### Automatic check against the evidence\n\n" +
      (!flags.length ? "Every library, version, file and size named above appears in the evidence.\n"
        : "These claims were **not found** in the evidence:\n\n" + flags.map((f) => `- ${f}`).join("\n") + "\n"));
}

function evidenceOnlyNote(ev, reason) {
  const a = ev.assets, size = evidence.size;
  const stack = ev.stack.map((r) => `- **${r.name}**${r.version ? " " + r.version : ""} (${r.layer}): ${r.by}`).join("\n")
    || "- Nothing recognised.";
  const largest = a.largest.slice(0, 8).map((f) => `- ${size(f.bytes)}: ${f.kind}`).join("\n");
  const limits = evidence.LIMITS.map((l) => `- ${l}`).join("\n");
  return `**Verdict:** Evidence only. The analysis didn't run (${reason}), so nothing here is ` +
    `interpreted.\n\n## The stack\n\n${stack}\n\n## What it loads\n\n${a.files} files, ` +
    `${size(a.bytes)} sized (Jarvis browser).\n\n${largest}\n\n` +
    `## What the evidence can't show\n\n${limits}\n\n` +
    "*The answer, how the effect works and how to rebuild it need the brain. Re-run the " +
    "teardown once it's available.*";
}

/** The [[REA]] concept note, born the first time anything is taken apart. Returns a birth or null. */
function ensureReaNote() {
  if (loadNotes().some((n) => n.label.toLowerCase() === "rea")) return null;
  return addNote(REA_CONCEPT_NOTE, { folder: "concepts", title: "REA", kind: "concept", markdown: REA_CONCEPT_NOTE });
}

const TEARDOWN_STEPS = ["Opening the site in a clean browser", "Waiting for it to load",
  "REA is watching while I scroll", "REA is reading the code", "Taking a snapshot",
  "Listing everything it loaded", "Identifying the stack", "Writing the teardown"];
const STEP = { open: 0, load: 1, watch: 2, read: 3, snapshot: 4, assets: 5, stack: 6, write: 7 };
const THIS_WORDS = new Set(["this", "this site", "this page", "this tab", "the current tab", "current tab"]);

class TeardownJob {
  constructor(url, question, headless) {
    this.id = crypto.randomBytes(6).toString("hex");
    Object.assign(this, { url, question, headless });
    try { this.host = new URL(url.includes("://") ? url : "https://" + url).hostname || url; } catch { this.host = url; }
    this.started = Date.now();
    this.step = -1;
    this.state = "running";
    this.result = null;
    this.controller = new AbortController();
  }

  elapsed() { return Math.round((Date.now() - this.started) / 1000); }

  at(name) {
    if (this.controller.signal.aborted) throw new bay.Cancelled();
    this.step = STEP[name];
  }

  async run() {
    try {
      this.result = await teardownWork(this);
    } catch (e) {
      this.result = e instanceof bay.Cancelled || this.controller.signal.aborted
        ? { ok: false, line: "cancelled" }
        : { ok: false, reason: String(e.message || e.name).slice(0, 200) };    // a job reports, it never crashes the server
    }
    this.finished = this.elapsed();
    this.state = this.result.line === "cancelled" ? "cancelled" : this.result.ok ? "done" : "failed";
    this.answer = receiptLine("TEARDOWN", { tag: "TEARDOWN", arg: this.url, ...this.result }, this.url);
    pushHistory({ role: "user", content: `Tear down ${this.url}: ${this.question}` },
                { role: "assistant", content: `[TEARDOWN: ${this.url}] RECEIPT ok=${this.state === "done"} ` +
                  `state=${this.state}` + (this.result.note ? ` note=${this.result.note}` : "") });
  }

  toJSON() {
    const out = { id: this.id, host: this.host, state: this.state, step: this.step, steps: TEARDOWN_STEPS, elapsed: this.elapsed() };
    if (this.state !== "running") {
      Object.assign(out, { answer: this.answer, finished_in: this.finished, births: this.result.births || [] });
      if (this.result.births?.length) out.card = teardownCard(this.result.births.at(-1).index);
    }
    return out;
  }
}

const jobs = new Map();
let currentJob = null;

/** The address of the user's front Chrome tab (macOS only), never Jarvis's own tab. */
function resolveThis() {
  if (process.platform !== "darwin") return null;
  const script = 'tell application "Google Chrome"\n set out to ""\n' +
    ' repeat with w in windows\n set out to out & (URL of active tab of w) & linefeed\n end repeat\n' +
    ' repeat with t in tabs of front window\n set out to out & (URL of t) & linefeed\n end repeat\n' +
    " return out\nend tell";
  const done = spawnSync("osascript", ["-e", script], { encoding: "utf8", timeout: 5000 });
  if (done.error) return null;
  for (const line of (done.stdout || "").split("\n")) {
    try {
      const u = new URL(line.trim());
      if (["http:", "https:"].includes(u.protocol) && ![`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(u.host)) return line.trim();
    } catch { /* next */ }
  }
  return null;
}

/** Start a teardown in the background. Returns a receipt with the job id, at once. */
function startTeardown(url, question = "", headless = null) {
  if (currentJob && currentJob.state === "running") return { ok: false, line: "busy" };
  if (!bay) return { ok: false, line: "missing", fix: "the teardown bay (teardown.mjs) isn't loaded" };
  url = stripChars((url || "").trim(), ".,!?");
  if (THIS_WORDS.has(url.toLowerCase()) || !url) {
    url = resolveThis();
    if (!url) return { ok: false, line: "which" };
  }
  try { bay.parseUrl(url); }                         // refuse the obviously off-limits at once
  catch (e) {
    if (e instanceof bay.LawError) return { ok: false, line: "refused", reason: e.message };
    throw e;
  }
  const info = bay.diag();
  if (!info.ready) return { ok: false, line: "missing", fix: info.fix };
  const job = new TeardownJob(url, question, headless === null ? TEARDOWN_HEADLESS : headless);
  jobs.set(job.id, job);
  currentJob = job;
  job.done = job.run();
  return { ok: true, line: "started", host: job.host, job: job.id };
}

function cancelTeardown() {
  const job = currentJob;
  if (job && job.state === "running") {
    job.controller.abort();
    return { ok: true, job: job.id };
  }
  return { ok: false };
}

/** Start, wait, return the finished receipt (used by POST /teardown and preflight). */
async function runTeardown(url, question = "", headless = null) {
  const started = startTeardown(url, question, headless);
  if (!started.ok) return started;
  const job = jobs.get(started.job);
  await job.done;
  return { ...job.result, job: job.id };
}

/** Evidence -> digest -> one brain call -> note(s). Returns a receipt. */
async function teardownWork(job) {
  const signal = job.controller.signal;
  let result;
  try {
    result = await bay.teardown(job.url, { headless: job.headless, step: (s) => job.at(s), signal });
  } catch (e) {
    if (e instanceof bay.LawError) return { ok: false, line: "refused", reason: e.message };
    if (e instanceof bay.NotReady) return { ok: false, line: "missing", fix: e.fix };
    throw e;
  }
  const ev = result.evidence, summary = result.summary;
  let host = "site";
  try { host = new URL(ev.url).hostname || "site"; } catch { /* keep */ }
  const digest = evidence.brainDigest(ev, job.question);

  job.at("write");
  // one call to the brain
  let brain = null, brainError = null;
  try {
    const raw = await callModel(`DIGEST\n\n${digest}`, { system: TEARDOWN_BRAIN, effort: TEARDOWN_EFFORT, timeoutS: 300, signal });
    brain = parseTeardown(raw);
  } catch (e) {
    if (signal.aborted) throw new bay.Cancelled();
    brainError = e instanceof ChatError ? e.spoken : e.message;
  }

  const label = brain ? brain.label : `Teardown · ${host}`;
  const flags = brain ? checkAgainstDigest(`${brain.note}\n${brain.spoken}\n${brain.summary}`, digest) : null;
  const body = brain ? brain.note : evidenceOnlyNote(ev, brainError);
  const shot = fs.readFileSync(ev.screenshot.path);
  const markdown = `**${label}** · [[REA]] · ${ev.url}\n\n` +
    `![Snapshot of ${host}](assets/${LABEL_URL_SLOT}.png)\n\n${body.trim()}\n\n` +
    evidenceSection(ev, digest.length, flags);
  if (signal.aborted) throw new bay.Cancelled();
  const births = [];
  try {
    const rea = ensureReaNote();
    if (rea) births.push(rea);
    births.push(addNote(brain ? brain.summary : `Teardown of ${host}: ${summary.stack}`, {
      folder: "captures/teardowns", title: `${host}-${localDate()}`, kind: "teardown", markdown,
      attachments: { [`assets/${LABEL_SLOT}.png`]: shot },
      meta: { label, url: ev.url, job: ev.job_id, analysed: Boolean(brain), took_s: job.elapsed() } }));
  } catch (e) {
    if (!(e instanceof CaptureError)) throw e;
    return { ok: false, reason: `the evidence was captured but the note wasn't written: ${e.reason}`, births };
  }
  const note = births.at(-1);
  const out = { ok: true, births, note: note.path, label, title: summary.title, analysed: Boolean(brain),
                digest_chars: digest.length, evidence_dir: summary.evidence_dir, stack: summary.stack };
  if (brain) Object.assign(out, { spoken: speakable(brain.spoken), summary: brain.summary,
                                  missing_sections: brain.missing_sections, unsupported: flags });
  else Object.assign(out, { line: "evidence_only", reason: brainError });
  return out;
}

function teardownNotePath(index) {
  const nodes = build.readGraph().nodes;
  if (!Number.isInteger(index) || index < 0 || index >= nodes.length || nodes[index].group !== "teardowns") return null;
  return resolveNotePath(nodes[index].path);
}

/** What the panel shows, read from the note on disk (so it survives a restart). */
export function teardownCard(index) {
  const file = teardownNotePath(index);
  if (!file || !fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  const front = Object.fromEntries([...text.split("\n---")[0].matchAll(/^(\w+): (.*)$/gm)].map((m) => [m[1], m[2]]));
  const clean = (v) => (v.startsWith('"') ? JSON.parse(v) : v);
  const url = clean(front.url || "");
  const chips = [];
  const table = /### Stack\n\n([\s\S]*?)\n\n/.exec(text);
  for (const row of table ? table[1].split("\n").slice(2) : []) {
    const cells = row.trim().replace(/^\|+|\|+$/g, "").split("|").map((c) => c.trim());
    if (cells.length >= 3 && cells[1] !== "nothing recognised") chips.push(cells[1] + (["—", ""].includes(cells[2]) ? "" : ` ${cells[2]}`));
  }
  const totals = /### Totals \(Jarvis browser\)\n\n([^:\n]+)/.exec(text);
  const nd = notesDir();
  const rel = isInside(file, nd) ? path.relative(nd, file).replace(/\.md$/, "").split(path.sep).join("/") : path.basename(file, ".md");
  let host = path.basename(file, ".md");
  try { host = new URL(url).hostname || host; } catch { /* keep */ }
  return { index, host, label: clean(front.label || ""),
           took_s: /^\d+$/.test(front.took_s || "") ? Number(front.took_s) : null,
           analysed: front.analysed === "True", chips: chips.slice(0, 10),
           totals: totals ? totals[1].replace(" origin(s)", " origins").replace(/\b1 origins\b/g, "1 origin").trim() : "",
           snapshot: /!\[[^\]]*\]\(assets\/[^)]+\)/.test(text),
           obsidian: "obsidian://open?vault=" + quote(path.basename(nd)) + "&file=" + quote(rel) };
}

function latestTeardownIndex() {
  const folder = path.join(notesDir(), "captures", "teardowns");
  const notes = fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => f.endsWith(".md")).map((f) => path.join(folder, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs) : [];
  const graph = build.readGraph().nodes;
  for (const p of notes) {
    for (const n of graph) if (path.resolve(resolveNotePath(n.path)) === path.resolve(p)) return n.id;
  }
  return null;
}

/** The full note for the reader: frontmatter dropped, the snapshot pointed at the API. */
function teardownMarkdown(index) {
  let text = fs.readFileSync(teardownNotePath(index), "utf8");
  text = text.replace(/^---\n[\s\S]*?\n---\n+/, "");
  return text.replace(/\]\(assets\/[^)]+\.png\)/g, `](/api/teardowns/snapshot?index=${index})`);
}

function teardownSnapshot(index) {
  return snapshotFor(teardownNotePath(index));
}

/** The image a teardown note shows, only from inside that note's own folder. */
export function snapshotFor(file) {
  const m = file ? /\]\((assets\/[^)]+\.png)\)/.exec(fs.readFileSync(file, "utf8")) : null;
  if (!m) return null;
  let rel;
  try { rel = decodeURIComponent(m[1]); } catch { return null; }
  const dir = path.resolve(path.dirname(file));
  const img = path.resolve(dir, rel);
  return isInside(img, dir) && fs.existsSync(img) ? fs.readFileSync(img) : null;
}

const TAG_HANDLERS = {
  RESET() {
    resetHistory();
    return { ok: history.length === 0 };
  },
  SHOW(arg) {
    const want = stripChars(arg.toLowerCase().trim(), " .\"'");
    const notes = loadNotes();
    const hit = notes.find((n) => n.label.toLowerCase() === want) || notes.find((n) => want && n.label.toLowerCase().includes(want));
    if (!hit) return { ok: false, title: arg || "by that name" };
    return { ok: true, title: hit.label, nodes: [hit.id] };
  },
  REINDEX() {
    const cmd = [path.join(ROOT, "build.mjs")];
    const nd = config().notes_dir;
    if (nd) cmd.push(String(nd));
    const done = spawnSync(process.execPath, cmd, { cwd: ROOT, encoding: "utf8", timeout: 120000 });
    if (done.status !== 0) return { ok: false, reason: ((done.stderr || done.stdout || "").trim().slice(-200)) || "build.mjs failed" };
    const count = loadNotes().length;
    resetHistory();               // indexes may have shifted; old citations are stale
    return { ok: true, count, reload: true };
  },
  TEARDOWN(arg, { headless = null, question = null, wait = false } = {}) {
    const bar = arg.indexOf("|");
    const url = bar < 0 ? arg : arg.slice(0, bar), asked = bar < 0 ? "" : arg.slice(bar + 1);
    const q = question !== null ? question : asked.trim();
    return (wait ? runTeardown : startTeardown)(url.trim(), q, headless);
  },
};
for (const t of Object.keys(CONTROL_TAGS)) if (!TAG_HANDLERS[t]) throw new Error(`CONTROL_TAG ${t} needs a handler`);

const ACTION_KEYS = new Set(["tag", "arg", "ok", "reason", "reload", "count", "line", "fix", "title", "url", "origin",
  "scripts", "resources", "dom_nodes", "requests_seen", "frames", "evidence_id",
  "load_seconds", "page_height", "images", "job_id", "stack", "assets", "asset_bytes",
  "routes", "evidence_dir", "screenshot", "note", "label", "analysed", "summary",
  "digest_chars", "missing_sections", "unsupported", "job", "host"]);

async function actionResponse(tag, arg = "", opts = {}) {
  const [line, receipt] = await runTag(tag, arg, opts);
  const nodes = receipt.ok ? receipt.nodes || [] : [];
  return { answer: line, nodes, about_notes: nodes.length > 0, births: receipt.births || [],
           action: Object.fromEntries(Object.entries(receipt).filter(([k]) => ACTION_KEYS.has(k))) };
}

/** Exactly the notes /chat would send for this question: [aboutNotes, [indexes]]. */
export function selectNotes(question) {
  const [aboutNotes, query] = classify(question);
  if (!aboutNotes) return [false, []];
  const notes = loadNotes();
  const picked = rank(query, notes);
  // Follow-ups ("and who owns it?") have few keywords: top up from last turn.
  // Indexes can go stale if a note was removed since, so check they still exist.
  for (const i of lastNodes) {
    if (picked.length >= TOP_K) break;
    if (i < notes.length && !picked.includes(i)) picked.push(i);
  }
  return [true, picked];
}

async function chat(question) {
  const decided = await serialized(async () => {
    const [aboutNotes, picked] = selectNotes(question);
    let turn;
    if (aboutNotes) {
      const notes = loadNotes();
      const context = picked.map((i) => `<note index="${i}" title="${notes[i].label}">\n${notes[i].body.trim()}\n</note>`).join("\n\n")
        || "(no notes matched this question)";
      turn = `<notes>\n${context}\n</notes>\n\nQuestion: ${question}`;
    } else {
      turn = `Small talk, no notes needed: ${question}`;
    }
    // History is kept as plain text and only appended to.
    const [answer, used] = parseAnswer(await callModel(promptWithHistory(history, turn)), picked);
    const [tag, arg] = findTag(answer);
    if (!tag) {
      pushHistory({ role: "user", content: `Question: ${question}` }, { role: "assistant", content: answer });
      if (used.length) lastNodes = used;
      // about_notes is the camera's permission: only true when notes were really used.
      return { reply: { answer, nodes: used, about_notes: Boolean(aboutNotes && used.length) } };
    }
    return { tag, arg };
  });
  if (decided.reply) return decided.reply;

  // Tags run outside the conversation queue: a teardown takes minutes and chat mustn't freeze.
  let { tag, arg } = decided;
  if (tag === "TEARDOWN" && !arg.includes("|")) arg = `${arg} | ${question}`;     // the user's own words are the question
  const result = await actionResponse(tag, arg);
  if (tag !== "RESET") {
    const a = result.action;
    pushHistory({ role: "user", content: `Question: ${question}` },
                { role: "assistant", content: `[${tag}${arg ? ": " + arg : ""}] RECEIPT ok=${Boolean(a.ok)}` +
                  (a.reason ? ` reason=${a.reason}` : "") + (a.note ? ` note=${a.note}` : "") });
  }
  if (result.nodes.length) lastNodes = result.nodes;
  else if (result.births.length) lastNodes = [result.births.at(-1).index];
  return result;
}

// ── http ──────────────────────────────────────────────────────────

const TYPES = { ".html": "text/html", ".htm": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/vnd.microsoft.icon", ".webp": "image/webp",
  ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain", ".md": "text/markdown", ".map": "application/json" };
const POST_ROUTES = new Set(["/chat", "/action", "/remember", "/api/recall", "/teardown", "/teardown/start", "/teardown/cancel"]);
const GOOD_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const GOOD_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);

function send(res, status, body, type, head = false) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, { "Content-Type": type, "Content-Length": buf.length,
                          "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
  res.end(head ? undefined : buf);
}
const sendJson = (res, payload, status = 200) => send(res, status, JSON.stringify(payload), "application/json");
const sendError = (res, status, message, head = false) =>
  send(res, status, `<!DOCTYPE html>\n<title>Error ${status}</title><p>${status}: ${message}</p>\n`, "text/html;charset=utf-8", head);

/** Only files inside viewer/. ".." segments are dropped, like Python's http.server. */
function serveStatic(req, res, rawPath, head) {
  let p;
  try { p = decodeURIComponent(rawPath.split("?")[0].split("#")[0]); } catch { p = rawPath; }
  const trailing = p.endsWith("/");
  const words = p.split("/").filter((w) => w && w !== "." && w !== ".." && !w.includes("\\") && !w.includes(":"));
  let file = path.join(VIEWER, ...words);
  if (!isInside(file, VIEWER)) return sendError(res, 404, "File not found", head);
  let st;
  try { st = fs.statSync(file); } catch { return sendError(res, 404, "File not found", head); }
  if (st.isDirectory()) {
    if (!trailing) {
      res.writeHead(301, { Location: rawPath.split("?")[0] + "/", "Content-Length": 0, "Cache-Control": "no-store",
                           "X-Content-Type-Options": "nosniff" });
      return res.end();
    }
    const index = ["index.html", "index.htm"].map((n) => path.join(file, n)).find((f) => fs.existsSync(f));
    if (!index) return sendError(res, 404, "not found", head);       // never list a directory
    file = index;
  } else if (trailing) {
    return sendError(res, 404, "File not found", head);
  }
  let data;
  try { data = fs.readFileSync(file); } catch { return sendError(res, 404, "File not found", head); }
  send(res, 200, data, TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", head);
}

function teardownApi(res, pathname, query) {
  if (pathname === "/api/teardowns/latest") {
    const index = latestTeardownIndex();
    const card = index !== null ? teardownCard(index) : null;
    return sendJson(res, card ? { card } : { error: "no teardowns yet" }, card ? 200 : 404);
  }
  const raw = query.get("index") ?? "";
  if (!/^\s*[+-]?\d+\s*$/.test(raw)) return sendJson(res, { error: "index required" }, 400);
  const index = Number(raw);
  if (teardownNotePath(index) === null) return sendJson(res, { error: "not a teardown" }, 404);   // only teardown notes, by graph index
  if (pathname === "/api/teardowns/note") return sendJson(res, { card: teardownCard(index), markdown: teardownMarkdown(index) });
  if (pathname === "/api/teardowns/snapshot") {
    const png = teardownSnapshot(index);
    if (!png) return sendJson(res, { error: "no snapshot" }, 404);
    return send(res, 200, png, "image/png");
  }
  return sendJson(res, { error: "not found" }, 404);
}

function readBody(req, length) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let got = 0;
    req.on("data", (c) => {
      got += c.length;
      if (got > length) { req.destroy(); return reject(new Error("too long")); }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function handlePost(req, res, rawPath) {
  if (!POST_ROUTES.has(rawPath)) return sendJson(res, { error: "not found" }, 404);
  const origin = req.headers.origin;
  if (!GOOD_HOSTS.has(req.headers.host || "") || (origin && !GOOD_ORIGINS.has(origin))) {
    return sendJson(res, { error: "origin rejected" }, 403);
  }
  if ((req.headers["content-type"] || "").split(";")[0].trim() !== "application/json") {
    return sendJson(res, { error: "send application/json" }, 415);
  }
  const length = /^\d+$/.test(req.headers["content-length"] || "") ? Number(req.headers["content-length"]) : -1;
  if (!(length > 0 && length <= MAX_BODY)) return sendJson(res, { error: "bad request size" }, 413);
  let data;
  try {
    data = JSON.parse((await readBody(req, length)).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("not an object");
  } catch {
    return sendJson(res, { error: "invalid JSON" }, 400);
  }
  const str = (v, d = "") => (v === undefined ? d : v === null ? "None" : typeof v === "string" ? v : JSON.stringify(v));
  const question = str(data.question).trim().slice(0, 2000);
  const tag = str(data.tag).trim().toUpperCase();
  const headless = "headless" in data ? Boolean(data.headless) : null;

  if (rawPath === "/teardown" || rawPath === "/teardown/start") {
    // Same handler the brain's [TEARDOWN: ...] tag uses.
    const result = await actionResponse("TEARDOWN", str(data.url).slice(0, 500),
      { headless, question: str(data.question).slice(0, 1000), wait: rawPath === "/teardown" });
    return sendJson(res, { ok: result.action.ok, ...result });
  }
  if (rawPath === "/teardown/cancel") {
    const receipt = cancelTeardown();
    return sendJson(res, { ok: receipt.ok, answer: receiptLine("TEARDOWN_CANCEL", receipt) });
  }
  if (rawPath === "/api/recall") {
    const [about, picked] = selectNotes(question);
    const notes = loadNotes();
    return sendJson(res, { about_notes: about, notes: picked.map((i) => ({ index: i, label: notes[i].label })) });
  }
  if (rawPath === "/remember") {
    let status, payload;
    try {
      [status, payload] = await serialized(() => remember(str(data.text).slice(0, 4000)));
    } catch (e) {              // a capture never fails silently
      console.error("remember failed:", e);
      [status, payload] = [500, { ok: false, error: String(e.message || e),
                                  answer: RECEIPT_LINES.REMEMBER.fail.replace("{reason}", "an internal error") }];
    }
    return sendJson(res, payload, status);
  }
  // Buttons and voice commands run the same tags the brain asks for.
  if (rawPath === "/action") {
    if (!(tag in CONTROL_TAGS)) return sendJson(res, { error: `unknown action '${tag}'` }, 400);
    return sendJson(res, await actionResponse(tag, str(data.arg).slice(0, 500)));
  }
  if (!question) return sendJson(res, { error: "empty question" }, 400);
  try {
    return sendJson(res, await chat(question));
  } catch (e) {
    if (e instanceof ChatError) return sendJson(res, { error: e.message, answer: "", nodes: [] }, e.status);
    console.error("chat failed:", e);
    return sendJson(res, { error: "Internal error while answering. See the server log.", answer: "", nodes: [] }, 500);
  }
}

async function handle(req, res) {
  const rawPath = req.url || "/";
  const method = req.method;
  if (method === "POST") return handlePost(req, res, rawPath);
  if (method !== "GET" && method !== "HEAD") return sendError(res, 501, `Unsupported method (${method})`);
  const head = method === "HEAD";
  if (!GOOD_HOSTS.has(req.headers.host || "")) return sendError(res, 403, "invalid host", head);
  let decoded;
  try { decoded = decodeURIComponent(rawPath); } catch { decoded = rawPath; }
  // A NUL byte (e.g. /config.json%00.js) is refused cleanly.
  if (decoded.includes("\x00")) return sendError(res, 400, "bad path", head);
  if (head) return serveStatic(req, res, rawPath, true);
  const url = new URL(rawPath, "http://127.0.0.1");
  if (url.pathname === "/api/boot") return sendJson(res, { greeting: BOOT_GREETING, code: CODE_SHA });
  if (url.pathname === "/teardown/diag") return sendJson(res, bayDiag());
  if (url.pathname === "/teardown/job") {
    const asked = url.searchParams.get("id");
    const job = asked !== null ? jobs.get(asked) : currentJob;     // an unknown id is a 404
    return sendJson(res, job ? job.toJSON() : { error: "no teardown yet" }, job ? 200 : 404);
  }
  if (url.pathname.startsWith("/api/teardowns/")) return teardownApi(res, url.pathname, url.searchParams);
  return serveStatic(req, res, rawPath, false);
}

async function main() {
  if (!fs.existsSync(GRAPH_FILE)) {
    console.error("viewer/graph-data.js missing: run node build.mjs first");
    process.exit(1);
  }
  try {                                    // a crash mid-teardown can leave Chrome running
    const browser = await import("./browser.mjs");
    const swept = await browser.sweepOrphans();
    if (swept.killed.length || swept.removed.length) {
      console.log(`Cleaned up after a crashed teardown: ${swept.killed.length} Chrome processes, ${swept.removed.length} profile folders`);
    }
  } catch (e) {
    console.log(`(teardown cleanup skipped: ${e.message})`);
  }
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {        // never crash the server on one request
      console.error("request failed:", e);
      if (!res.headersSent) sendJson(res, { error: "internal error" }, 500); else res.end();
    });
  });
  server.on("clientError", (_e, socket) => { try { socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"); } catch { /* gone */ } });
  server.listen(PORT, HOST, () => console.log(`Knowledge galaxy on http://${HOST}:${PORT}  (Ctrl+C to stop)`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
