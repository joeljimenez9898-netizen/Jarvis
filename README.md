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
