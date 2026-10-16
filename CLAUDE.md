# Knowledge Galaxy: working rules

## "Done" means preflight passed

Before saying any change is done:

1. Restart the server so it runs the code on disk: `node server.mjs`
2. Run `node preflight.mjs`
3. Paste its final summary line (`N pass, N fail, N warn`) into the reply.

If anything fails, fix the cause and run it again. Never describe what preflight
would say; run it. If a failure can't be fixed from here (for example, Claude Code not signed in, or
the subscription usage limit), say exactly which checks fail and why.

Every new feature adds its own `check(...)` to `preflight.mjs`. It has to be a real
call against the running system, not a mock.

## No Python, no API key

- Everything runs on Node.js (22+) with the standard library only: no Python, no `npm install`
  in the project.
- The brain is Claude Code (`claude -p`) on the user's Claude subscription. Never start it with
  `--bare`, never set or pass `ANTHROPIC_API_KEY` (`brainEnv()` removes it), and never add an
  API key to `config.json`.

## Invariants the checks protect

- `config.json` stays in the project root and is never served. The server only
  serves `viewer/`, bound to 127.0.0.1.
- Notes born at runtime go through the two doors: `addNote()` in `server.mjs`
  and `addNote()` in `viewer/index.html`.
- Only `Focus` in `viewer/index.html` moves the camera or changes what's lit.
- Only `utter()` in `viewer/voice.js` hands anything to the speech engine, and
  it checks `?mute=1` first.
- The persona, control tags and receipt lines live in the block at the top of
  `server.mjs`.
- The teardown bay (REA) only observes: `ALLOWED_COMMANDS` in `teardown.mjs` holds passive website
  commands only, and `checkUrl()` keeps it to websites the user may look at. REA is pinned
  in `PINNED_REA` and never installed as "latest" at runtime.
- Teardowns use `OwnedBrowser` in `browser.mjs` only: a fresh profile per job, loopback port 9333,
  always closed with the profile folder deleted. `DevTools` allows only
  Runtime.evaluate (read-only) and Input.dispatchMouseEvent of type mouseWheel. Tests run it
  with `headless: true`.
- Teardown evidence (`evidence.mjs`) labels every item with `by`: "REA", "Jarvis browser", or
  "Jarvis scan of REA-captured code". Never merge or relabel them. Fingerprint patterns live
  in the one `FINGERPRINTS` table, and banner patterns only match inside comments.
- A teardown note is born through `addNote()` (markdown + attachments) and `addNote()`,
  [[REA]] first if new. Its Evidence section and automatic claim check are written by Jarvis,
  never by the brain. One teardown at a time (`currentJob`).
- Voice routes decline by returning `false`, never by calling `ask()` (ask runs the routes, so that loops).
- Before any teardown on camera: `node drill.mjs` must pass, and it must leave the graph byte-identical.
