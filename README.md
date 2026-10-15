# Knowledge Galaxy

A 3D map of your markdown notes, with a brain you can ask questions.

```
notes/                 your .md files (30 sample notes about a coffee roastery)
build.py               indexer -> viewer/graph-data.js   (standard library only)
viewer/index.html      the galaxy (3d-force-graph + three from a CDN, pinned)
server.py              http://127.0.0.1:4700, serves viewer/ and POST /chat
config.json            your Anthropic key + model (gitignored, never served)
```

## Run it

```bash
pip install -r requirements.txt
cp config.example.json config.json      # then put your key in it
python3 build.py                        # or: python3 build.py ~/path/to/notes
python3 server.py
```

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

It needs Node.js 22.19+ (or 24.11+, or 26+) and Google Chrome. `teardown.py` finds both even
when the server starts without your shell's PATH. `GET /teardown/diag` reports what's ready
and what's missing. Say "tear down example.com", or `POST /teardown {"url": ...}`.

The law, enforced in `teardown.py`: only REA's passive website commands may run. Pages open in
a headless Chrome with a fresh profile (no logins, no cookies), and nothing sends input.
Addresses must be http(s), with no credentials and no private-network or cloud-metadata
hosts. Localhost is allowed, for your own projects. Teardowns run in a browser Jarvis owns (`browser.py`, standard library only). Each job gets a
brand-new Chrome profile in `~/.jarvis-tools/rea/profiles/<job id>`, so it never touches your
everyday Chrome, cookies or logins. A fresh profile also means no cache, so file sizes are
honest. Chrome listens on 127.0.0.1:9333 at 1280×820. Jarvis waits for the page to finish
loading plus 2.5 seconds for intro animations. Its small DevTools client does two things only:
read page facts and send mouse-wheel scrolls. When the job ends, Chrome is closed, anything
still using the profile is killed, and the folder is deleted. Try it with
`python3 browser.py https://nodejs.org/en --headless`. Set `JARVIS_TEARDOWN_HEADLESS=1` to keep
teardown windows off your screen.

To upgrade REA, change `PINNED_REA` in
`teardown.py` and re-run the install with the new version. Nothing ever installs "latest".

## Preflight

```bash
python3 server.py          # terminal 1
python3 preflight.py       # terminal 2
```

`preflight.py` runs every live chain end to end against the running system: no mocks. It checks
that the server is up, the graph loads, `/chat` answers, the API key and model are real, and
`/remember` writes a note that the next question can retrieve (the test note is removed
afterwards). It also checks that the served files match the disk and the server isn't running
stale code, that `config.json` can't be reached from the browser, and that a `?mute=1` tab
stays silent in a real browser. It ends with `N pass, N fail, N warn` and exits non-zero on
any failure.

The live mute check needs Playwright (`pip install playwright && playwright install chromium`).
Without it, that check only verifies the source and reports a warning.

## How it fits together

- **Indexer.** Every `.md` file becomes a node: label from the filename, group
  from its parent folder, about a 700-character excerpt. Two notes are linked when
  one mentions the other's title or they share a `[[wikilink]]`. A node's `id` is
  always its index in `nodes`.
- **Brain.** `POST /chat {"question": "..."}` scores every note by keyword overlap
  (title matches weigh more), sends the top 6 to Claude, and returns
  `{"answer": "...", "nodes": [indexes used]}`. The last six exchanges are kept
  server-side, so follow-up questions work.
- **Key safety.** `config.json` sits in the project root. The server only serves
  `viewer/`, binds to 127.0.0.1, and rejects other hosts and origins.

Re-run `build.py` whenever your notes change. The server picks up the new
`graph-data.js` without a restart.

## Growing the brain by voice

Say or type anything starting with "remember that" and it becomes a real note:

- `server.py` → `add_note()` writes `notes/captures/<first few words>.md` with today's date,
  links it with the same rules `build.py` uses, appends it to `viewer/graph-data.js`, and adds
  it to the live search index. The next question can cite it without re-running `build.py`.
- `viewer/index.html` → `addNote()` places it beside its most related note, pulses it and
  flies the camera to it, all without a reload.
- Anything that adds notes at runtime should go through these two functions.
- A capture never fails silently. If the write fails, or the file is saved but couldn't be
  indexed, it says so out loud.

## Personality

The whole character is one commented block at the top of `server.py`:

- `PERSONA` is the system prompt: a dry, polite British butler who says "sir" now and then,
  gives one witty line plus the facts, and says plainly when the notes don't cover something.
- `BOOT_GREETING` is the single line spoken on load ("Hello, sir."). The note count on screen
  comes from the graph data.
- `CONTROL_TAGS` lists the actions the brain can ask for: `[RESET]`, `[SHOW: title]` and
  `[REINDEX]`. When asked for one, the model replies with just the tag and the server runs it.
  To add one, put an entry in `CONTROL_TAGS` and a `@tag_handler("NAME")` function below it.
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
