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
