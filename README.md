# Knowledge Galaxy

A 3D map of your markdown notes, with a brain you can ask questions.

```
notes/                 your .md files (30 sample notes about a coffee roastery)
build.mjs              indexer -> viewer/graph-data.js   (Node standard library only)
viewer/index.html      the galaxy (3d-force-graph + three from a CDN, pinned)
server.mjs             http://127.0.0.1:4700, serves viewer/ and POST /chat
config.json            optional: model, notes_dir, claude_cmd (gitignored, never served)
```

## En un Mac, sin saber nada técnico

1. Descarga el ZIP del proyecto (en GitHub: botón verde **Code → Download ZIP**) y ábrelo.
2. En la carpeta, haz **clic derecho en «Iniciar Jarvis» → Abrir → Abrir** (solo la primera vez;
   macOS pregunta porque el archivo viene de internet). Después basta con doble clic.
3. La primera vez descarga Node.js y Claude Code en `~/.jarvis-tools` (sin contraseña de
   administrador) y abre el navegador para que entres con tu cuenta de Claude.
4. Jarvis se abre solo en http://127.0.0.1:4700. Para apagarlo, cierra la ventana de Terminal.

## Run it

No Python, no API key, nothing to `npm install` in the project. You need Node.js 22 or newer and
[Claude Code](https://claude.com/claude-code), signed in with your Claude subscription:

```bash
npm install -g @anthropic-ai/claude-code   # once
claude                                     # once: type /login, sign in with your Claude account

cp config.example.json config.json         # optional: pick a model, a notes folder
node build.mjs                             # or: node build.mjs ~/path/to/notes
node server.mjs
```

The brain is Claude Code itself: every answer is one `claude -p` run with no tools, no MCP
servers and no saved session, started with `ANTHROPIC_API_KEY` removed from its environment,
so it always uses your subscription. It is never started with `--bare` (that mode needs an
API key). If `claude` isn't on your PATH, set `"claude_cmd"` in `config.json` (or `CLAUDE_CMD`).

Open http://127.0.0.1:4700. Click a star to fly to it, Esc to go back, `/` to
jump to the question bar, "New" to start a fresh conversation.

## Teardown bay (REA)

Jarvis can take a website apart with [REA](https://github.com/morluto/rea) (MIT, npm
`rea-agents`), by observation only. REA is installed outside the project, pinned:

```bash
npm view rea-agents repository.url        # must be github.com/morluto/rea
mkdir -p ~/.jarvis-tools/rea && cd ~/.jarvis-tools/rea
npm install rea-agents@6.5.0 --save-exact --ignore-scripts
```

It needs Node.js 22.19+ (or 24.11+, or 26+) and Google Chrome. `teardown.mjs` finds both even
when the server starts without your shell's PATH. `GET /teardown/diag` reports what's ready
and what's missing. Say "tear down example.com", or `POST /teardown {"url": ...}`.

The law, enforced in `teardown.mjs`: only REA's passive website commands may run. Pages open in
a headless Chrome with a fresh profile (no logins, no cookies), and nothing sends input.
Addresses must be http(s), with no credentials and no private-network or cloud-metadata
hosts. Localhost is allowed, for your own projects. Teardowns run in a browser Jarvis owns (`browser.mjs`, Node standard library only). Each job gets a
brand-new Chrome profile in `~/.jarvis-tools/rea/profiles/<job id>`, so it never touches your
everyday Chrome, cookies or logins. A fresh profile also means no cache, so file sizes are
honest. Chrome listens on 127.0.0.1:9333 at 1280×820. Jarvis waits for the page to finish
loading plus 2.5 seconds for intro animations. Its small DevTools client does two things only:
read page facts and send mouse-wheel scrolls. When the job ends, Chrome is closed, anything
still using the profile is killed, and the folder is deleted. Try it with
`node browser.mjs https://nodejs.org/en --headless`. Set `JARVIS_TEARDOWN_HEADLESS=1` to keep
teardown windows off your screen.

Each teardown captures five kinds of evidence. Every line is labelled with who captured it:
REA, Jarvis's own browser reads, or Jarvis scanning the code REA captured.

1. **Watch while scrolling** (REA). `inspect-web-page` runs for 7 s with script sources included,
   while Jarvis scrolls 16 wheel steps, so scroll effects and lazy-loaded files fire while REA watches.
2. **Read the code** (REA, plus a Jarvis scan). `analyze-web-bundle` reports which file loads which,
   and the routes. Jarvis then scans the captured code for the names it hands the graphics card
   (`nearCoCBuffer` means depth of field) and the effect names it registers (`BloomEffect`).
3. **Snapshot** (REA). Jarvis wheels back to the top, then REA runs `capture-web-screenshot`. The PNG
   is saved in `~/.jarvis-tools/rea/evidence/<job>/`.
4. **Asset log** (Jarvis browser). Every file from every origin, read from the browser's own timeline:
   sizes, grouped by kind, the 12 largest. Files whose server hides their size are counted, not guessed.
5. **Fingerprints** (Jarvis scan). License banners in comments (three.js revision, GSAP, postprocessing,
   …) plus code markers. They live in one table in `evidence.mjs`, ordered 3D engine, animation, smooth
   scroll, effects, compression, then build tools. Runtime globals such as `window.__THREE__`
   corroborate them.

**From evidence to a note.** The evidence is compressed into a digest of at most 15,000
characters, with every line tagged with who captured it. One brain call, using `TEARDOWN_BRAIN`
in the persona block, returns a LABEL, a SPOKEN line, a SUMMARY and a markdown note. Jarvis
writes the note to `notes/captures/teardowns/<host>-<date>.md` and embeds the snapshot from
`assets/`. It also adds an Evidence section (the stack, the totals, REA's evidence ids) and an
**automatic check** that lists any library, version, file or size the note names but the
evidence doesn't contain. The first teardown also creates a `[[REA]]` concept note. Both notes
go through the same `add_note()` / `addNote()` doors as "remember that", so they appear live and
can be cited by the next question. If the brain is unavailable, the evidence is still filed as
an "evidence only" note, and Jarvis says why. Only one teardown runs at a time.

**By voice.** Sentences that name a site start a teardown straight away: "reverse engineer
igloo dot inc", "tear down linear.app", "how does stripe.com do that", "what is example.com built
with", or "this site" / "this page" (on a Mac, your front Chrome tab that isn't Jarvis; elsewhere it
asks which site). Spoken "dot", "slash" and "colon" become `.`, `/` and `:`, and localhost is allowed.
Anything else ("tear down the old shed") goes to the brain, which answers
`[TEARDOWN:SITE|QUESTION]` when it's really a teardown. The parser lives in `viewer/intent.js`.

**The card.** It sits top-left, under the legend, labelled with the site and "via REA", and shows
the 8 steps live. When done it folds to "Taken apart in N s", the snapshot, up to 10 stack chips,
the totals and "Read the full teardown", which opens the note with Open in Obsidian. It shrinks to
fit and never covers the answer or other panels (the snapshot goes first). Say "show me the last
teardown", "open the full teardown", "close the teardown" or "cancel the teardown".

**Proving it.** `node kitcheck.mjs` runs the offline checks in about a second: addresses,
fingerprints, digest attribution, and snapshot containment. `node drill.mjs [url]` runs one real
headless teardown and puts everything back exactly as it was. A crashed teardown's Chrome is
cleaned up when the server next starts.

To upgrade REA, change `PINNED_REA` in
`teardown.mjs` and re-run the install with the new version. Nothing ever installs "latest".

## Preflight

```bash
node server.mjs            # terminal 1
node preflight.mjs         # terminal 2
```

`preflight.mjs` runs every live chain end to end against the running system: no mocks. It checks
that the server is up, the graph loads, `/chat` answers, Claude Code answers on your subscription (one real call, with no API key and no `--bare`), and
`/remember` writes a note that the next question can retrieve (the test note is removed
afterwards). It also checks that the served files match the disk and the server isn't running
stale code, that `config.json` can't be reached from the browser, and that a `?mute=1` tab
stays silent in a real browser. It ends with `N pass, N fail, N warn` and exits non-zero on
any failure.

The live mute check uses Playwright if npm can find it (`npm install -g playwright`).
Without it, that check only verifies the source and reports a warning.

## How it fits together

- **Indexer.** Every `.md` file becomes a node: label from the filename, group
  from its parent folder, about a 700-character excerpt. Two notes are linked when
  one mentions the other's title or they share a `[[wikilink]]`. A node's `id` is
  always its index in `nodes`.
- **Brain.** `POST /chat {"question": "..."}` scores every note by keyword overlap
  (title matches weigh more), sends the top 6 to Claude (through `claude -p`), and returns
  `{"answer": "...", "nodes": [indexes used]}`. The last six exchanges are kept
  server-side, so follow-up questions work.
- **Config safety.** `config.json` sits in the project root. The server only serves
  `viewer/`, binds to 127.0.0.1, and rejects other hosts and origins.

Re-run `node build.mjs` whenever your notes change. The server picks up the new
`graph-data.js` without a restart.

## Growing the brain by voice

Say or type anything starting with "remember that" and it becomes a real note:

- `server.mjs` → `addNote()` writes `notes/captures/<first few words>.md` with today's date,
  links it with the same rules `build.mjs` uses, appends it to `viewer/graph-data.js`, and adds
  it to the live search index. The next question can cite it without re-running `build.mjs`.
- `viewer/index.html` → `addNote()` places it beside its most related note, pulses it and
  flies the camera to it, all without a reload.
- Anything that adds notes at runtime should go through these two functions.
- A capture never fails silently. If the write fails, or the file is saved but couldn't be
  indexed, it says so out loud.

## Personality

The whole character is one commented block at the top of `server.mjs`:

- `PERSONA` is the system prompt: a dry, polite British butler who says "sir" now and then,
  gives one witty line plus the facts, and says plainly when the notes don't cover something.
- `BOOT_GREETING` is the single line spoken on load ("Hello, sir."). The note count on screen
  comes from the graph data.
- `CONTROL_TAGS` lists the actions the brain can ask for: `[RESET]`, `[SHOW: title]` and
  `[REINDEX]`. When asked for one, the model replies with just the tag and the server runs it.
  To add one, put an entry in `CONTROL_TAGS` and a handler in `TAG_HANDLERS` below it.
- `RECEIPT_LINES` is what gets said after a tag ran or failed. These lines come from the
  handler's receipt, never from the model, so the assistant can't claim an action it
  didn't take. Unknown tags and other requests ("email Priya") get a polite refusal.

The New button and the "start over" voice command use the same `RESET` through `POST /action`.

## The galaxy shows its sources

The server first decides whether a message is about your notes. Greetings, thanks and
jokes are small talk: no notes are sent and `about_notes` comes back false. Only then do
the sources the answer actually cited (`nodes`, best first) decide the camera:

| sources cited | what happens |
|---|---|
| none, or small talk | nothing moves and nothing is relit |
| 1 to 3 | fly to the top source, light it and its neighbours, open its panel |
| 4 or more | light the whole cluster where it stands, no flight |

`Focus` in `viewer/index.html` is the only code that moves the camera or changes
what's lit. Clicks, chips, the legend and voice commands all call `Focus.note`,
`Focus.cluster` or `Focus.clear`. The spoken answer is at most three sentences. A note is
read aloud only when you say "read it out".

## Voice

Built only on the browser's Web Speech API, so no speech service and no cost.
Listening needs Chrome, Edge or Safari. Firefox and Brave lack the recogniser.

- **Speaking.** Every answer is read aloud, in a British English voice when the system has one.
  Nothing plays until your first click or key press; the greeting is held until then.
- **Listening.** Click the mic and talk. A phrase is only sent after `FINISH_MS`
  (900ms, top of `viewer/voice.js`) of silence, so a mid-sentence pause doesn't cut
  you off. "stop", "wait", "cancel" and similar skip the wait and silence it at once.
  While it is talking it ignores everything except those words, so it never hears itself.
- **Voice routes.** `Voice.addRoute(/pattern/, (match, sentence) => ...)` adds a
  command that is checked before a sentence reaches the brain. Built in: stop/wait,
  "start over", "close" / "go back", "show me <note>".
- **Mute.** Open `http://127.0.0.1:4700/?mute=1` and that tab never makes a sound.
