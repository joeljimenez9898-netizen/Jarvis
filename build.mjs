#!/usr/bin/env node
// Index a folder of markdown notes into viewer/graph-data.js.
//
//   node build.mjs [NOTES_DIR]        (default: ./notes)
//
// Node standard library only. Every node's numeric `id` equals its index in the nodes
// array; server.mjs and the viewer both look notes up by that index.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const OUT = path.join(ROOT, "viewer", "graph-data.js");
const EXCERPT_CHARS = 700;
const MIN_TITLE_LEN = 4;   // shorter titles cause too many accidental "mentions"

const WIKILINK = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g;
const FRONTMATTER = /^---\s*\n[\s\S]*?\n---\s*\n/;
// Python's str.split() whitespace, which is a little wider than JavaScript's \s
const WS = new RegExp("[\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]+", "g");
const WORD = "[\\p{L}\\p{N}\\p{M}_]";                          // Python's Unicode \w

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const squash = (t) => t.split(WS).filter(Boolean).join(" ");

export function stripMarkdown(text) {
  text = text.replace(FRONTMATTER, "");
  text = text.replace(WIKILINK, (_, t) => t);
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");          // images
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");         // links
  text = text.replace(/```[\s\S]*?```/g, " ");                // code fences
  text = text.replace(/^\s{0,3}#{1,6}\s*/gm, "");             // headings
  text = text.replace(/[*_`>~]/g, "");
  return squash(text);
}

export function excerpt(text, limit = EXCERPT_CHARS) {
  const chars = Array.from(text);                              // code points, as Python counts
  if (chars.length <= limit) return text;
  let cut = chars.slice(0, limit).join("");
  const sp = cut.lastIndexOf(" ");
  if (sp >= 0) cut = cut.slice(0, sp);
  return cut.replace(/[,.;:]+$/, "") + "…";
}

const posix = (p) => p.split(path.sep).join("/");

export function readNote(file, notesDir) {
  file = path.resolve(file);
  notesDir = path.resolve(notesDir);
  const raw = fs.readFileSync(file, "utf8");
  const stem = path.basename(file, ".md");
  const relParent = path.relative(notesDir, path.dirname(file));
  // The title is already the label; drop a leading "# Title" heading from the text.
  const body = raw.replace(new RegExp("^(---\\s*\\n[\\s\\S]*?\\n---\\s*\\n)?\\s*#\\s+" + escapeRe(stem) + "\\s*\\n"),
                           (_, front) => front || "");
  const inRoot = !path.relative(ROOT, file).startsWith("..") && !path.isAbsolute(path.relative(ROOT, file));
  return {
    label: stem,
    group: relParent === "" ? path.basename(notesDir) : path.basename(path.dirname(file)),
    path: inRoot ? posix(path.relative(ROOT, file)) : file,
    raw,
    text: stripMarkdown(body),
    wikilinks: new Set([...raw.matchAll(WIKILINK)].map((m) => m[1].trim().toLowerCase())),
  };
}

// Python sorts Paths part by part; a plain string sort would put "a-b" before "a/b".
function partCompare(a, b) {
  const pa = a.split("/"), pb = b.split("/");
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return pa.length - pb.length;
}

export function scan(notesDir) {
  notesDir = path.resolve(notesDir);
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(posix(path.relative(notesDir, full)));
    }
  })(notesDir);
  files.sort(partCompare);
  return files.map((rel) => readNote(path.join(notesDir, rel), notesDir));
}

const patterns = new Map();
function titlePattern(title) {
  if (!patterns.has(title)) {
    patterns.set(title, new RegExp(`(?<!${WORD})${escapeRe(title)}(?!${WORD})`, "iu"));
  }
  return patterns.get(title);
}

function mentions(a, b) {
  // Does note a mention note b's title (as plain text or a [[wikilink]])?
  const title = b.label.toLowerCase();
  if (a.wikilinks.has(title)) return true;            // an explicit [[link]] always counts, even to "REA"
  if (Array.from(title).length < MIN_TITLE_LEN) return false;
  return titlePattern(title).test(a.text);
}

/** The rule for linking two notes: "mention", "shared", or null. */
export function linkType(a, b) {
  if (mentions(a, b) || mentions(b, a)) return "mention";
  for (const w of a.wikilinks) if (b.wikilinks.has(w)) return "shared";
  return null;
}

export function buildLinks(notes) {
  const links = [];
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const kind = linkType(notes[i], notes[j]);
      if (kind) links.push({ source: i, target: j, type: kind });
    }
  }
  return links;
}

/** Links for one note against all the others, exactly as buildLinks would make them. */
export function linksFor(index, notes) {
  const out = [];
  notes.forEach((other, j) => {
    if (j === index) return;
    const kind = linkType(notes[index], other);
    if (kind) out.push({ source: Math.min(index, j), target: Math.max(index, j), type: kind });
  });
  return out;
}

export function makeNode(i, note, degree) {
  return { id: i, label: note.label, group: note.group, path: note.path, excerpt: excerpt(note.text), degree };
}

/** Atomic write, so a crash mid-write can't leave the viewer with half a file. */
export function writeGraph(nodes, links) {
  nodes.forEach((n, i) => { if (n.id !== i) throw new Error(`node id ${n.id} != index ${i}`); });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const tmp = OUT + ".tmp";
  fs.writeFileSync(tmp, "// Generated by build.mjs. Do not edit by hand.\nconst GRAPH = "
                   + JSON.stringify({ nodes, links }, null, 1) + ";\n", "utf8");
  fs.renameSync(tmp, OUT);
}

export function readGraph() {
  const raw = fs.readFileSync(OUT, "utf8");
  return JSON.parse(raw.slice(raw.indexOf("=") + 1).trim().replace(/;$/, ""));
}

function main() {
  const notesDir = path.resolve(process.argv[2] || path.join(ROOT, "notes"));
  if (!fs.existsSync(notesDir) || !fs.statSync(notesDir).isDirectory()) {
    console.error(`notes folder not found: ${notesDir}`); process.exit(1);
  }
  const notes = scan(notesDir);
  if (!notes.length) { console.error(`no .md files under ${notesDir}`); process.exit(1); }
  const links = buildLinks(notes);
  const degree = notes.map(() => 0);
  for (const l of links) { degree[l.source]++; degree[l.target]++; }
  const nodes = notes.map((n, i) => makeNode(i, n, degree[i]));
  writeGraph(nodes, links);
  const groups = new Set(nodes.map((n) => n.group));
  console.log(`${nodes.length} notes, ${links.length} links, ${groups.size} groups -> ${posix(path.relative(ROOT, OUT))}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
