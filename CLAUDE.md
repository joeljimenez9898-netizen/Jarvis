# Knowledge Galaxy: working rules

## "Done" means preflight passed

Before saying any change is done:

1. Restart the server so it runs the code on disk: `python3 server.py`
2. Run `python3 preflight.py`
3. Paste its final summary line (`N pass, N fail, N warn`) into the reply.

If anything fails, fix the cause and run it again. Never describe what preflight
would say; run it. If a failure can't be fixed from here (for example, the
placeholder API key in `config.json`), say exactly which checks fail and why.

Every new feature adds its own `@check` to `preflight.py`. It has to be a real
call against the running system, not a mock.

## Invariants the checks protect

- `config.json` stays in the project root and is never served. The server only
  serves `viewer/`, bound to 127.0.0.1.
- Notes born at runtime go through the two doors: `add_note()` in `server.py`
  and `addNote()` in `viewer/index.html`.
- Only `Focus` in `viewer/index.html` moves the camera or changes what's lit.
- Only `utter()` in `viewer/voice.js` hands anything to the speech engine, and
  it checks `?mute=1` first.
- The persona, control tags and receipt lines live in the block at the top of
  `server.py`.
- The teardown bay (REA) only observes: `teardown.ALLOWED_COMMANDS` holds passive website
  commands only, and `check_url()` keeps it to websites the user may look at. REA is pinned
  in `teardown.PINNED_REA` and never installed as "latest" at runtime.
