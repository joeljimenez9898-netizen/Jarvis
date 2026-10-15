"""Offline checks for the teardown kit: fast, no browser, no network, the real code.

    python3 kitcheck.py

Used by preflight.py and drill.py. Each check returns (ok, detail).
"""
import json
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

# spoken phrase -> the address it must become (None: must not start anything)
ADDRESSES = [
    ("igloo dot inc",            "igloo.inc"),
    ("stripe.com slash pricing", "stripe.com/pricing"),
    ("localhost:5001",           "localhost:5001"),
    ("make it pop",              None),
    ("wikipedia.org",            "wikipedia.org"),      # keeps its first letter
]

SYNTHETIC_CODE = (
    "/**\n * @license\n * Copyright 2010-2024 Three.js Authors\n * SPDX-License-Identifier: MIT\n */\n"
    "const e=\"165\";\"undefined\"!=typeof window&&(window.__THREE__=e);\n"
    "/*!\n * GSAP 3.12.5\n * https://gsap.com\n */\n"
    "console.warn(\"Requires GSAP 3.11.0 or later\");\n")     # a decoy: a warning, not a banner


def check_addresses():
    import teardown
    node, version, ok = teardown.find_node()
    if not node:
        return None, "Node.js not found, so the page's address parser can't be run offline"
    script = ("const {teardownIntent}=require(process.argv[1]);"
              "const out={};for(const p of JSON.parse(process.argv[2])){const r=teardownIntent('tear down '+p);"
              "out[p]=r?r.url:null}console.log(JSON.stringify(out))")
    done = subprocess.run([node, "-e", script, str(ROOT / "viewer" / "intent.js"),
                           json.dumps([p for p, _ in ADDRESSES])], capture_output=True, text=True, timeout=30)
    if done.returncode != 0:
        return False, f"intent.js failed in Node: {done.stderr.strip()[-200:]}"
    got = json.loads(done.stdout)
    wrong = [f"{p!r} -> {got.get(p)!r} (expected {want!r})" for p, want in ADDRESSES if got.get(p) != want]
    return (not wrong), ("; ".join(wrong) if wrong else
                         ", ".join(f"{p!r} -> {got[p] or 'nothing'}" for p, _ in ADDRESSES))


def check_fingerprints():
    import evidence
    stack, _ = evidence.fingerprints([{"text": SYNTHETIC_CODE, "url": "synthetic.js"}], {})
    found = {r["name"]: r["version"] for r in stack}
    ok = found.get("Three.js") == "r165" and found.get("GSAP") == "3.12.5"
    return ok, f"Three.js {found.get('Three.js')}, GSAP {found.get('GSAP')} (the 'Requires GSAP 3.11.0' decoy ignored)" \
        if ok else f"expected Three.js r165 and GSAP 3.12.5, got {found}"


def _synthetic_evidence():
    REA, BR, SCAN = "REA", "Jarvis browser", "Jarvis scan of REA-captured code"
    return {
        "url": "https://example.com/", "title": "Example", "job_id": "x", "load_seconds": 1.2,
        "runtime_globals": {"by": BR, "three": "165", "height": 2400, "images": 3, "videos": 1, "canvases": 1},
        "rea_dom_nodes": 412,
        "scripts": [{"by": REA, "url": "https://example.com/app.js", "chars": 120000, "module": True}],
        "loads": [{"by": REA, "from": "https://example.com/app.js", "to": "https://example.com/c.js", "how": "dynamic_import"}],
        "routes": ["/", "/work"], "endpoints": ["/api/x"],
        "gpu": {"by": SCAN, "signals": [{"by": SCAN, "meaning": "bloom", "count": 1, "names": ["BloomEffect"]}],
                "custom_named": ["uTime"], "effects": ["BloomEffect"]},
        "stack": [{"by": SCAN, "layer": "3D engine", "name": "Three.js", "version": "r165", "file": "https://example.com/app.js",
                   "runtime": {"by": BR, "version": "r165"}}],
        "rea_vendors": ["React"], "other_banners": [{"by": SCAN, "banner": "lil-gui", "version": "0.19.1"}],
        "assets": {"by": BR, "files": 4, "bytes": 3_000_000,
                   "by_origin": {"https://example.com": {"files": 2, "bytes": 1_000_000},
                                 "https://cdn.example.net": {"files": 2, "bytes": 2_000_000}},
                   "by_kind": {"3D models": {"files": 1, "bytes": 2_000_000, "hidden": 0},
                               "scripts": {"files": 3, "bytes": 1_000_000, "hidden": 1}},
                   "largest": [{"by": BR, "bytes": 2_000_000, "kind": "3D models", "url": "https://cdn.example.net/a.glb"}],
                   "notes": ["1 cross-origin files hide their size"]},
        "screenshot": {"by": REA, "width": 1280, "height": 628},
        "rea_limitations": ["Observation starts when REA attaches."],
    }


def check_digest_attribution():
    import evidence
    digest = evidence.brain_digest(_synthetic_evidence(), "How is it built?")
    sources = ("[REA]", "[Jarvis browser]", "[Jarvis scan]")
    bad, evidence_lines = [], 0
    for block in digest.split("\n\n"):
        title, *lines = block.split("\n")
        if title in ("SITE", "QUESTION", "LIMITS"):
            continue                                   # the site, the ask, and statements about method
        for line in lines:
            if line.startswith("…"):
                continue
            evidence_lines += 1
            if not line.startswith(sources):
                bad.append(f"{title}: {line[:70]}")
    return (not bad), (f"{evidence_lines} evidence lines, every one names REA, Jarvis browser or Jarvis scan"
                       if not bad else "lines with no source: " + "; ".join(bad[:4]))


def check_snapshot_containment():
    """The snapshot server's own path check, against a note that tries to escape its folder."""
    import server
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        teardowns = tmp / "captures" / "teardowns"
        (teardowns / "assets").mkdir(parents=True)
        (tmp / "secret.png").write_bytes(b"\x89PNG secret")
        (teardowns / "assets" / "ok.png").write_bytes(b"\x89PNG fine")
        evil, good = teardowns / "evil.md", teardowns / "good.md"
        evil.write_text("![x](assets/../../../secret.png)\n")
        good.write_text("![x](assets/ok.png)\n")
        original = server._teardown_note_path
        try:
            server._teardown_note_path = lambda i: {1: evil, 2: good}.get(i)
            escaped, served = server.teardown_snapshot(1), server.teardown_snapshot(2)
        finally:
            server._teardown_note_path = original
    ok = escaped is None and served == b"\x89PNG fine"
    return ok, ("a note pointing at ../../../secret.png is refused; its own assets/ image is served" if ok
                else f"containment broken: escaped={escaped!r}, own image={served!r}")


CHECKS = [("spoken addresses parse", check_addresses),
          ("fingerprints from banners", check_fingerprints),
          ("every digest line names its source", check_digest_attribution),
          ("snapshots can't leave the teardowns folder", check_snapshot_containment)]


def run():
    results = []
    for name, fn in CHECKS:
        try:
            ok, detail = fn()
        except Exception as e:  # noqa: BLE001
            ok, detail = False, f"crashed: {e.__class__.__name__}: {e}"
        results.append((name, ok, detail))
    return results


if __name__ == "__main__":
    results = run()
    for name, ok, detail in results:
        print(f"  {'✓' if ok else ('!' if ok is None else '✗')} {name}: {detail}")
    sys.exit(0 if all(ok is not False for _, ok, _ in results) else 1)
