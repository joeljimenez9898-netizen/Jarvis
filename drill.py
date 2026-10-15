#!/usr/bin/env python3
"""Live teardown drill that leaves no trace.

    python3 server.py            # running
    python3 drill.py [URL]       # default: https://nodejs.org/en

Snapshots the graph data file and the teardowns folder, runs ONE real headless teardown of a
public page through the same job API the panel uses, checks the panel steps, the note, the
spoken line, the node births and the time, then restores the snapshot and deletes the test
note and its evidence, so your first real teardown is genuinely the first.

Not restorable from here: the running server's in-memory conversation keeps a one-line
receipt of the drill until it restarts (there is no episode log file to snapshot).
"""
import hashlib
import json
import pathlib
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import browser    # noqa: E402
import build      # noqa: E402

BASE = "http://127.0.0.1:4700"
URL = sys.argv[1] if len(sys.argv) > 1 else "https://nodejs.org/en"
STEPS = ["Opening the site in a clean browser", "Waiting for it to load", "REA is watching while I scroll",
         "REA is reading the code", "Taking a snapshot", "Listing everything it loaded", "Identifying the stack",
         "Writing the teardown"]
results = []


def check(name, ok, detail):
    results.append(ok)
    print(f"  {'✓' if ok else '✗'} {name}: {detail}")


def post(path, body, timeout=30):
    req = urllib.request.Request(BASE + path, json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Origin": BASE})
    return json.load(urllib.request.urlopen(req, timeout=timeout))


def get(path):
    try:
        return json.load(urllib.request.urlopen(BASE + path, timeout=30))
    except urllib.error.HTTPError as e:
        return json.load(e)


def notes_dir():
    cfg = json.loads((ROOT / "config.json").read_text()) if (ROOT / "config.json").exists() else {}
    return pathlib.Path(cfg.get("notes_dir") or ROOT / "notes").expanduser()


def tree(folder):
    return {str(p.relative_to(folder)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in folder.rglob("*") if p.is_file()} if folder.exists() else {}


def main():
    print(f"Drill: one headless teardown of {URL}, then put everything back\n")
    notes = notes_dir()
    teardowns, concepts = notes / "captures" / "teardowns", notes / "concepts"
    graph_file = ROOT / "viewer" / "graph-data.js"
    snap = {"graph": graph_file.read_bytes(), "teardowns": tree(teardowns), "concepts": tree(concepts),
            "dirs": {d: d.exists() for d in (teardowns / "assets", teardowns, concepts, notes / "captures")}}
    labels_before = [n["label"] for n in build.read_graph()["nodes"]]
    job = None
    try:
        t0 = time.monotonic()
        start = post("/teardown/start", {"url": URL, "question": "What is this site built with?", "headless": True})
        ack_s = time.monotonic() - t0
        check("acknowledged at once", bool(start.get("ok")) and ack_s < 3,
              f"{start.get('answer')!r} in {ack_s:.2f}s")
        if not start.get("ok"):
            return
        job_id, seen = start["action"]["job"], []
        while True:
            job = get(f"/teardown/job?id={job_id}")
            if job["step"] >= 0 and (not seen or seen[-1] != job["step"]):
                seen.append(job["step"])
            if job["state"] != "running":
                break
            if time.monotonic() - t0 > 900:
                raise TimeoutError("the teardown took over 15 minutes")
            time.sleep(0.3)
        wall = time.monotonic() - t0
        check("panel steps", job["steps"] == STEPS and seen == sorted(seen) and seen[-1] == 7 and len(seen) >= 4,
              f"the 8 steps in order; saw {len(seen)} live: " + " -> ".join(str(i + 1) for i in seen))
        check("finished", job["state"] == "done", f"state {job['state']}: {job.get('answer')!r}")
        check("time", job.get("finished_in") is not None and wall < 900,
              f"{job.get('finished_in')} s by the job's clock, {wall:.0f} s wall")
        births = job.get("births") or []
        expect = ([] if "REA" in labels_before else ["REA"]) + ["teardown"]
        got = ["REA" if b["node"]["label"] == "REA" else b["node"]["group"].rstrip("s") for b in births]
        check("node births", got == expect and [b["index"] for b in births] ==
              list(range(len(labels_before), len(labels_before) + len(births))),
              ", ".join(f"{b['index']}: {b['node']['label']} ({b['node']['group']})" for b in births) or "none")
        answer = job.get("answer") or ""
        bad_speech = re.findall(r"https?://\S+|\b[\w-]+\.(?:js|glb|wasm|png|json|html)\b", answer)
        check("spoken line", bool(answer.strip()) and not bad_speech,
              f"{answer!r}" + (f" (contains {bad_speech})" if bad_speech else ""))
        card = job.get("card") or {}
        on_card = json.dumps(card.get("chips", [])) + card.get("totals", "") + card.get("host", "")
        check("panel card", bool(card) and bool(card.get("totals")) and not re.search(r"/(root|home|Users)/|\.md\b", on_card),
              f"{card.get('host')}: {len(card.get('chips', []))} chips, {card.get('totals')!r}, snapshot {card.get('snapshot')}")
        if births:
            note = pathlib.Path(births[-1]["path"])
            note = note if note.is_absolute() else ROOT / note
            text = note.read_text(encoding="utf-8")
            analysed = "analysed: True" in text
            want = (["**Verdict:**", "## The answer", "## The stack", "## How the effect works", "## What it loads",
                     "## Rebuild it", "## What the evidence can't show"] if analysed else
                    ["**Verdict:**", "## The stack", "## What it loads", "## What the evidence can't show"])
            want += ["[[REA]]", "## Evidence", "### REA evidence ids"]
            missing = [w for w in want if w not in text]
            img = re.search(r"!\[[^\]]*\]\((assets/[^)]+\.png)\)", text)
            img_ok = bool(img) and (note.parent / urllib.parse.unquote(img.group(1))).read_bytes()[:4] == b"\x89PNG"
            check("note sections", not missing and img_ok,
                  f"{'analysed' if analysed else 'evidence only (no brain)'}; "
                  + (f"missing {missing}" if missing else f"all {len(want)} parts present") + f"; snapshot embedded: {img_ok}")
            job["_evidence"] = re.search(r"^job: (\S+)", text, re.M)
    finally:
        # ── put everything back ──
        graph_file.write_bytes(snap["graph"])
        for folder, before in ((teardowns, snap["teardowns"]), (concepts, snap["concepts"])):
            for rel in set(tree(folder)) - set(before):
                (folder / rel).unlink()
        for d, existed in snap["dirs"].items():          # only folders the drill created, and only if empty
            if not existed and d.exists() and not any(p.is_file() for p in d.rglob("*")):
                shutil.rmtree(d)
        if job and job.get("_evidence"):
            shutil.rmtree(browser.PROFILES.parent / "evidence" / job["_evidence"].group(1), ignore_errors=True)
        print()
        check("restored: graph data", graph_file.read_bytes() == snap["graph"], "byte-identical to before the drill")
        check("restored: teardowns and concepts", tree(teardowns) == snap["teardowns"] and tree(concepts) == snap["concepts"],
              "test note, snapshot and any new REA note deleted; nothing else touched")
        held, left = browser.processes_using(browser.PROFILES), \
            [p.name for p in browser.PROFILES.iterdir()] if browser.PROFILES.exists() else []
        check("no investigation Chrome", not held and not left, f"{len(held)} processes, {len(left)} profile folders")
        n_after = len(build.read_graph()["nodes"])
        check("galaxy back to its old size", n_after == len(labels_before), f"{n_after} notes")
    fails = results.count(False)
    print(f"\ndrill: {results.count(True)} pass, {fails} fail")
    print("note: the server's in-memory conversation still holds the drill's one-line receipt until it restarts.")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
