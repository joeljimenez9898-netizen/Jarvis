"""Evidence from the clean browser: five steps, every line labelled with who captured it.

    REA            what REA observed or analysed (inspect-web-page, analyze-web-bundle,
                   capture-web-screenshot)
    JARVIS_BROWSER what Jarvis read itself through its own DevTools client
    JARVIS_SCAN    what Jarvis found by scanning the code REA captured

The brain is told to keep this attribution straight, so every item carries `by`.
Standard library only.
"""
import base64
import json
import pathlib
import re
import threading
import time
import urllib.parse

REA, JARVIS_BROWSER, JARVIS_SCAN = "REA", "Jarvis browser", "Jarvis scan of REA-captured code"

WATCH_MS = 7000            # REA watches this long...
SCROLL_AFTER_S = 1.0       # ...and one second in, Jarvis scrolls
SCROLL_STEPS = 16
SCROLL_DELTA = 320
TOP_ASSETS = 12

# ── 5. FINGERPRINTS: the ONE table, ordered by what matters to a designer ──
# (layer, name, where, pattern, version pattern searched nearby or None)
#   where="banner": must sit inside a /* comment */. License banners survive minification,
#                   while the same words in code can be warnings ("Requires GSAP 3.11.0").
#   where="code":   a marker in the code itself (no banner exists for these).
FINGERPRINTS = [
    ("3D engine",      "Three.js",          "banner", r"Three\.js Authors",                  "three"),
    ("3D engine",      "Babylon.js",        "banner", r"Babylon\.js v(\d+\.\d+\.\d+)",       None),
    ("3D engine",      "PlayCanvas",        "banner", r"PlayCanvas Engine v?(\d+\.\d+\.\d+)", None),
    ("3D engine",      "PixiJS",            "banner", r"pixi\.js - v(\d+\.\d+\.\d+)",        None),
    ("animation",      "GSAP",              "banner", r"GSAP (3\.\d+\.\d+)",                 None),
    ("animation",      "anime.js",          "banner", r"anime\.js v?(\d+\.\d+\.\d+)",        None),
    ("animation",      "Theatre.js",        "code",   r"@theatre/core",                      None),
    ("smooth scroll",  "Lenis",             "code",   r"lenis-smooth|lenis-scrolling",       r'"(1\.\d+\.\d+)"'),
    ("smooth scroll",  "Locomotive Scroll", "banner", r"locomotive-scroll v?(\d+\.\d+\.\d+)", None),
    ("visual effects", "postprocessing",    "banner", r"postprocessing v(6\.\d+\.\d+)",      None),
    # EffectComposer/ShaderPass also exist in postprocessing; these pass names are three.js's own.
    ("visual effects", "three.js passes",   "code",   r"UnrealBloomPass|BokehPass|SSAOPass|SAOPass|OutputPass|AfterimagePass|GlitchPass|FilmPass", None),
    ("compression",    "Draco",             "code",   r"draco_decoder|DracoDecoderModule",   None),
    ("compression",    "Basis / KTX2",      "code",   r"basis_transcoder|BasisTranscoder|KTX2Loader", None),
    ("compression",    "meshoptimizer",     "code",   r"meshopt_decoder|MeshoptDecoder",     None),
    ("build tool",     "Vite",              "code",   r"vite/modulepreload-polyfill|__vite__", None),
    ("build tool",     "webpack",           "code",   r"webpackChunk|__webpack_require__",   None),
    ("build tool",     "Next.js",           "code",   r"__NEXT_DATA__|next/dist/",           None),
    ("build tool",     "Nuxt",              "code",   r"__NUXT__",                           None),
    ("build tool",     "Astro",             "code",   r"astro-island",                       None),
]
COMMENT = re.compile(r"/\*[\s\S]*?\*/")
OTHER_BANNER = re.compile(r"/\*[!*]?\s*(?:@license\s+)?([A-Za-z@][\w@./+-]*(?: [A-Za-z][\w.+-]*){0,3})"
                          r"\s+v?(\d+\.\d+\.\d+(?:-[\w.]+)?)")

# Read-only globals that libraries set on window, read by Jarvis's own browser.
RUNTIME_PROBE = """({
  three: window.__THREE__ || null,
  gsap: (window.gsap && window.gsap.version) || null,
  babylon: (window.BABYLON && window.BABYLON.Engine && window.BABYLON.Engine.Version) || null,
  playcanvas: (window.pc && window.pc.version) || null,
  pixi: (window.PIXI && window.PIXI.VERSION) || null,
  webgl: (() => { const c = document.querySelectorAll('canvas'); return c.length; })()
})"""

# ── 2b. GPU STRINGS: names code hands to the graphics card, and what they mean ──
GPU_DECL = re.compile(r"\buniform\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+(\w+)|"
                      r"getUniformLocation\(\s*\w+\s*,\s*[\"'](\w+)[\"']")
GPU_SIGNALS = [   # ordered; first match wins
    ("depth of field",        r"coc|bokeh|focus|aperture|dof"),
    ("bloom",                 r"bloom|luminosity|luminance"),
    ("ambient occlusion",     r"ssao|ambientocclusion|^ao|aomap"),
    ("motion blur",           r"motionblur|velocity"),
    ("chromatic aberration",  r"chromatic|aberration|rgbshift"),
    ("film grain / noise",    r"grain|noise"),
    ("vignette",              r"vignette"),
    ("tone mapping",          r"tonemapping|exposure|whitepoint"),
    ("fog",                   r"fog"),
    ("shadows",               r"shadow"),
    ("reflections / environment", r"envmap|irradiance|reflect|cubemap"),
    ("refraction / glass",    r"refract|transmission|ior|thickness"),
    ("PBR materials",         r"metalness|roughness|clearcoat|sheen|iridescence|specular"),
    ("surface detail",        r"normalmap|bumpmap|displacement"),
    ("skinned / morphing models", r"bone|skin|morph"),
    ("instancing",            r"instance"),
    ("mouse-reactive",        r"mouse|pointer|cursor"),
    ("scroll-driven",         r"scroll|progress"),
    ("animated over time",    r"^u?_?time$|elapsed"),
    ("particles",             r"particle|pointsize"),
    ("fluid / simulation",    r"fluid|pressure|divergence|curl|advect"),
]

# Post-processing libraries name their effects with strings that survive minification:
# postprocessing registers "BloomEffect", three.js passes are "UnrealBloomPass" and so on.
EFFECT_NAME = re.compile(r"[\"']([A-Z]\w{2,40}(?:Effect|Pass))[\"']")
EFFECT_SIGNALS = [   # (meaning, pattern over the effect name); same meanings as GPU_SIGNALS where they overlap
    ("depth of field",       r"DepthOfField|Bokeh"),
    ("bloom",                r"Bloom|SelectiveBloom"),
    ("ambient occlusion",    r"SSAO|SAO|N8AO|GTAO"),
    ("motion blur",          r"MotionBlur|Afterimage"),
    ("chromatic aberration", r"ChromaticAberration|RGBShift"),
    ("film grain / noise",   r"Noise|Film"),
    ("vignette",             r"Vignette"),
    ("tone mapping",         r"ToneMapping|Output"),
    ("god rays",             r"GodRays"),
    ("glitch",               r"Glitch"),
    ("pixelation / dither",  r"Pixelat|Dither|DotScreen|Scanline"),
    ("outlines",             r"Outline"),
    ("color grading",        r"LUT|HueSaturation|BrightnessContrast|ColorAverage|Sepia"),
    ("anti-aliasing",        r"SMAA|FXAA|TAA"),
]

# ── 4. ASSET LOG: kinds, by extension (and initiator) ──
KINDS = [
    ("3D models",            (".glb", ".gltf", ".obj", ".fbx", ".usdz", ".drc", ".ply", ".splat", ".ksplat", ".spz", ".vrm")),
    ("compressed textures",  (".ktx2", ".basis", ".ktx", ".dds")),
    ("environment maps",     (".hdr", ".exr")),
    ("video",                (".mp4", ".webm", ".mov", ".m3u8", ".m4s", ".ogv")),
    ("audio",                (".mp3", ".ogg", ".wav", ".m4a", ".aac", ".flac", ".opus")),
    ("fonts",                (".woff2", ".woff", ".ttf", ".otf")),
    ("WebAssembly",          (".wasm",)),
    ("scripts",              (".js", ".mjs", ".cjs")),
    ("images",               (".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".svg", ".ico")),
    ("styles",               (".css",)),
    ("data",                 (".json", ".bin", ".txt", ".csv")),
]
ASSET_PROBE = """(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const res = performance.getEntriesByType('resource').map(e => [e.name, e.initiatorType,
    e.transferSize, e.encodedBodySize, e.decodedBodySize, Math.round(e.startTime)]);
  return { resources: res,
           document: nav ? [nav.name, 'navigation', nav.transferSize, nav.encodedBodySize, nav.decodedBodySize, 0] : null };
})()"""


def _kind(url, initiator):
    path = urllib.parse.urlsplit(url).path.lower()
    for name, exts in KINDS:
        if path.endswith(exts):
            return name
    return {"script": "scripts", "css": "styles", "link": "styles", "img": "images",
            "video": "video", "audio": "audio"}.get(initiator, "other")


def asset_log(page):
    """Every file the page loaded, from any origin, from the browser's own timeline."""
    raw = page.evaluate(ASSET_PROBE)
    entries = list(raw["resources"])
    if raw.get("document"):
        entries.insert(0, raw["document"])
    files = []
    for url, initiator, transfer, encoded, decoded, start in entries:
        if not url.startswith(("http://", "https://")):
            continue
        size = encoded or transfer or None          # 0 cross-origin without Timing-Allow-Origin
        files.append({"by": JARVIS_BROWSER, "url": url, "origin": "{0.scheme}://{0.netloc}".format(urllib.parse.urlsplit(url)),
                      "kind": "document" if initiator == "navigation" else _kind(url, initiator),
                      "bytes": size, "decoded_bytes": decoded or None, "started_ms": start})
    totals = {}
    for f in files:
        t = totals.setdefault(f["kind"], {"files": 0, "bytes": 0, "hidden": 0})
        t["files"] += 1
        if f["bytes"]:
            t["bytes"] += f["bytes"]
        else:
            t["hidden"] += 1
    origins = {}
    for f in files:
        o = origins.setdefault(f["origin"], {"files": 0, "bytes": 0})
        o["files"] += 1
        o["bytes"] += f["bytes"] or 0
    largest = sorted((f for f in files if f["bytes"]), key=lambda f: -f["bytes"])[:TOP_ASSETS]
    notes = []
    if len(raw["resources"]) >= 250:
        notes.append("The browser's resource timeline holds 250 entries by default; files after that aren't listed.")
    hidden = sum(t["hidden"] for t in totals.values())
    if hidden:
        notes.append(f"{hidden} cross-origin files hide their size (no Timing-Allow-Origin header); counted, not sized.")
    return {"by": JARVIS_BROWSER, "files": len(files), "bytes": sum(f["bytes"] or 0 for f in files),
            "by_kind": totals, "by_origin": origins, "largest": largest, "all": files, "notes": notes}


def _scripts(inspect):
    items = ((inspect.get("normalized_result") or {}).get("scripts") or {}).get("items") or []
    out = []
    for it in items:
        art = (it.get("source") or {}).get("artifact") or {}
        out.append({"by": REA, "url": it.get("url"), "chars": it.get("length"), "module": it.get("is_module"),
                    "source_map": it.get("source_map_url"), "text": art.get("text") or ""})
    return out


def _three_revision(code):
    """REVISION survives minification as the value window.__THREE__ is set to."""
    m = re.search(r"REVISION\s*=\s*[\"'](\d{2,3}(?:dev)?)[\"']", code)
    if m:
        return m.group(1)
    var = re.search(r"__THREE__\s*=\s*([\w$]+)", code)
    if var:
        val = re.search(r"(?<![\w$.])" + re.escape(var.group(1)) + r"\s*=\s*[\"'](\d{2,3}(?:dev)?)[\"']", code)
        if val:
            return val.group(1)
    return None


def fingerprints(scripts, runtime):
    code = "\n".join(s["text"] for s in scripts)
    comments = {s["url"]: "\n".join(COMMENT.findall(s["text"])) for s in scripts}
    stack, matched_names = [], set()
    for layer, name, where_kind, pattern, version_rule in FINGERPRINTS:
        hay = "\n".join(comments.values()) if where_kind == "banner" else code
        m = re.search(pattern, hay)
        if not m:
            continue
        version = m.group(1) if m.groups() else None
        if version_rule == "three":
            rev = _three_revision(code)
            version = f"r{rev}" if rev else None
        elif version_rule:
            pos = code.find(m.group(0))
            near = re.search(version_rule, code[max(0, pos - 3000):pos + 3000]) if pos >= 0 else None
            version = near.group(1) if near else None
        where = next((s["url"] for s in scripts
                      if re.search(pattern, comments[s["url"]] if where_kind == "banner" else s["text"])), None)
        stack.append({"by": JARVIS_SCAN, "layer": layer, "name": name, "version": version, "file": where})
        matched_names.add(name.lower().split()[0].split(".")[0])
    # corroboration from globals the libraries set at runtime
    for key, name in (("three", "Three.js"), ("gsap", "GSAP"), ("babylon", "Babylon.js"),
                      ("playcanvas", "PlayCanvas"), ("pixi", "PixiJS")):
        value = (runtime or {}).get(key)
        if value:
            value = f"r{value}" if key == "three" else str(value)
            row = next((r for r in stack if r["name"] == name), None)
            if row:
                row["runtime"] = {"by": JARVIS_BROWSER, "version": value}
                row["version"] = row["version"] or value
            else:
                layer = "animation" if key == "gsap" else "3D engine"
                stack.append({"by": JARVIS_BROWSER, "layer": layer, "name": name, "version": value,
                              "file": None, "note": "set on window at runtime; no banner in captured code"})
    order = [row[0] for row in FINGERPRINTS]
    stack.sort(key=lambda r: order.index(r["layer"]) if r["layer"] in order else 99)
    others, seen = [], set()
    for s in scripts:
        for m in OTHER_BANNER.finditer(s["text"]):
            name, version = m.group(1).strip(), m.group(2)
            key = (name.lower(), version)
            if key in seen or any(k in name.lower() for k in matched_names if k):
                continue
            seen.add(key)
            others.append({"by": JARVIS_SCAN, "banner": name, "version": version, "file": s["url"]})
    return stack, others[:20]


def gpu_strings(scripts):
    names = {}
    for s in scripts:
        for m in GPU_DECL.finditer(s["text"]):
            n = m.group(1) or m.group(2)
            names[n] = names.get(n, 0) + 1
    signals = {}
    for name, count in names.items():
        low = name.lower()
        for meaning, pattern in GPU_SIGNALS:
            if re.search(pattern, low):
                sig = signals.setdefault(meaning, {"by": JARVIS_SCAN, "meaning": meaning, "count": 0, "names": []})
                sig["count"] += count
                sig["names"].append(name)
                break
    effects = set()
    for s in scripts:
        effects.update(EFFECT_NAME.findall(s["text"]))
    for effect in sorted(effects):
        for meaning, pattern in EFFECT_SIGNALS:
            if re.search(pattern, effect):
                sig = signals.setdefault(meaning, {"by": JARVIS_SCAN, "meaning": meaning, "count": 0, "names": []})
                sig["count"] += 1
                sig["names"].append(effect)
                names.setdefault(effect, 1)
                break
    custom = sorted(n for n in names if re.match(r"^u[A-Z_]", n))      # uTime, u_resolution: hand-written
    # Ranked by what matters to a designer (the table's order), not by count: an engine's
    # built-in material names would otherwise drown out the effects a site chose to add.
    priority = [m for m, _ in GPU_SIGNALS] + [m for m, _ in EFFECT_SIGNALS if m not in dict(GPU_SIGNALS)]
    ranked = sorted(signals.values(), key=lambda s: priority.index(s["meaning"]))
    for s in ranked:
        s["names"] = sorted(s["names"], key=lambda n: -names[n])[:6]
    return {"by": JARVIS_SCAN, "uniforms": len(names), "signals": ranked, "custom_named": custom[:25],
            "effects": sorted(effects)}


def capture(page, run_rea, out_dir):
    """Run the five steps on an OwnedBrowser `page`. Saves the screenshot and the full
    evidence JSON in out_dir. Returns the evidence dict."""
    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    ep = page.endpoint
    ev = {"url": page.target.get("url"), "title": page.title, "job_id": page.job_id, "load_seconds": page.load_seconds,
          "captured_at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}

    timings, _t = {}, time.monotonic()
    ev["timings_s"] = timings

    # 1. WATCH WHILE SCROLLING
    targets = run_rea("list-browser-targets", ep)
    found = (targets.get("normalized_result") or {}).get("targets") or []
    target_id = next((t["target_id"] for t in found if t.get("target_id") == page.target_id),
                     found[0]["target_id"] if found else page.target_id)
    ev["target"] = {"by": REA, "target_id": target_id, "targets_listed": len(found)}
    box = {}

    def watch():
        try:
            box["inspect"] = run_rea("inspect-web-page", ep, target_id, "--observation-ms", str(WATCH_MS),
                                     "--include-script-sources", timeout=180)
        except Exception as e:  # noqa: BLE001 — reported in the evidence, not raised from a thread
            box["error"] = f"{e.__class__.__name__}: {e}"

    watcher = threading.Thread(target=watch, daemon=True)
    watcher.start()
    time.sleep(SCROLL_AFTER_S)
    page.scroll(SCROLL_DELTA, steps=SCROLL_STEPS, pause_s=0.3)
    watcher.join(timeout=200)
    if "error" in box or "inspect" not in box:
        raise RuntimeError(f"REA inspect-web-page failed: {box.get('error', 'timed out')}")
    inspect = box["inspect"]
    ir = inspect.get("normalized_result") or {}
    scripts = _scripts(inspect)
    ev["scripts"] = [{k: v for k, v in s.items() if k != "text"} for s in scripts]
    ev["rea_resources"] = [{"by": REA, "url": r.get("url"), "type": r.get("type"), "bytes": r.get("content_size")}
                           for r in ir.get("resources") or []]
    ev["rea_dom_nodes"] = (ir.get("dom") or {}).get("total_nodes")
    ev["rea_limitations"] = inspect.get("limitations", [])

    timings["watch"] = round(time.monotonic() - _t, 1); _t = time.monotonic()
    # 2. READ THE CODE
    bundle = run_rea("analyze-web-bundle", ep, target_id, timeout=180)
    br = bundle.get("normalized_result") or {}
    obs = br.get("observations") or {}
    nodes = (obs.get("chunks") or {}).get("nodes", [])
    key_to_url = {n.get("script_key"): n.get("url") for n in nodes}
    ev["loads"] = [{"by": REA, "from": key_to_url.get(e.get("from_script_key"), e.get("from_script_key")),
                    "to": e.get("resolved_url") or e.get("specifier"), "how": e.get("kind")}
                   for e in (obs.get("chunks") or {}).get("edges", [])]
    # Bundle analysis can see scripts inspect-web-page missed (lazy chunks loaded later).
    seen = {s["url"] for s in ev["scripts"]}
    for n in nodes:
        if n.get("url") not in seen:
            ev["scripts"].append({"by": REA, "url": n.get("url"), "chars": int(n.get("bytes") or 0) or None,
                                  "module": None, "source_map": None, "note": "seen by bundle analysis; source not scanned"})
            seen.add(n.get("url"))
    ev["routes"] = sorted({r.get("value") for r in obs.get("routes", []) if r.get("value")})
    ev["endpoints"] = sorted({e.get("value") for e in obs.get("endpoints", []) if e.get("value")})
    ev["rea_vendors"] = sorted({i["value"] for i in br.get("inferences", [])
                                if i.get("kind") == "vendor_fingerprint" and i.get("value")})
    ev["gpu"] = gpu_strings(scripts)

    timings["read_code"] = round(time.monotonic() - _t, 1); _t = time.monotonic()
    # 3. SNAPSHOT (back to the top with the wheel first)
    for _ in range(60):
        if (page.evaluate("window.scrollY") or 0) <= 0:
            break
        page.scroll(-600, steps=1, pause_s=0.12)
    time.sleep(0.8)
    shot = run_rea("capture-web-screenshot", ep, target_id)
    art = ((shot.get("normalized_result") or {}).get("artifact") or {})
    png = base64.b64decode(art.get("data_base64") or "")
    if not png.startswith(b"\x89PNG"):
        raise RuntimeError("REA's screenshot wasn't a PNG")
    (out_dir / "screenshot.png").write_bytes(png)
    vp = (shot.get("normalized_result") or {}).get("viewport") or {}
    ev["screenshot"] = {"by": REA, "path": str(out_dir / "screenshot.png"), "bytes": len(png),
                        "width": vp.get("width"), "height": vp.get("height"), "sha256": art.get("sha256")}

    timings["snapshot"] = round(time.monotonic() - _t, 1); _t = time.monotonic()
    # 4. THE ASSET LOG (Jarvis's own browser read; REA saw only its origin, from when it attached)
    ev["assets"] = asset_log(page)

    timings["asset_log"] = round(time.monotonic() - _t, 1); _t = time.monotonic()
    # 5. FINGERPRINTS
    runtime = page.evaluate(RUNTIME_PROBE)
    ev["runtime_globals"] = {"by": JARVIS_BROWSER, **(runtime or {})}
    ev["stack"], ev["other_banners"] = fingerprints(scripts, runtime)

    timings["fingerprints"] = round(time.monotonic() - _t, 1); _t = time.monotonic()
    (out_dir / "evidence.json").write_text(json.dumps(ev, indent=1))
    return ev


def _size(n):
    if not n:
        return "size hidden"
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024


def digest(ev):
    """The short, attributed summary."""
    L = [f"{ev['url']}  (loaded in {ev['load_seconds']}s, job {ev['job_id']})", ""]
    L.append("SCRIPTS")
    for s in sorted(ev["scripts"], key=lambda s: -(s["chars"] or 0))[:10]:
        L.append(f"  [{s['by']}] {_size(s['chars'])}  {'module ' if s['module'] else ''}{s['url']}")
    if len(ev["scripts"]) > 10:
        L.append(f"  [{REA}] … and {len(ev['scripts']) - 10} more ({len(ev['scripts'])} total)")
    L.append("WHICH FILE LOADS WHICH")
    L += [f"  [{e['by']}] {e['from']} -> {e['to']} ({e['how']})" for e in ev["loads"][:8]] or [f"  [{REA}] no load edges found"]
    L.append("ROUTES")
    L.append(f"  [{REA}] " + (", ".join(ev["routes"][:15]) or "none found"))
    L.append("CODE SIGNALS (strings handed to the graphics card)")
    g = ev["gpu"]
    if g["signals"]:
        for s in g["signals"][:6]:
            L.append(f"  [{s['by']}] {s['meaning']}: {s['count']}x  ({', '.join(s['names'][:4])})")
        if g["custom_named"]:
            L.append(f"  [{g['by']}] hand-written uniforms: {', '.join(g['custom_named'][:10])}")
    else:
        L.append(f"  [{g['by']}] no shader uniforms in the captured code")
    L.append("STACK")
    for r in ev["stack"]:
        rt = f"; runtime says {r['runtime']['version']} [{r['runtime']['by']}]" if r.get("runtime") else ""
        L.append(f"  [{r['by']}] {r['layer']:14} {r['name']} {r['version'] or '(version not in banner)'}{rt}")
    if not ev["stack"]:
        L.append(f"  [{JARVIS_SCAN}] no known banners")
    if ev["rea_vendors"]:
        L.append(f"  [{REA}] REA's own vendor fingerprints: {', '.join(ev['rea_vendors'])}")
    if ev["other_banners"]:
        L.append("  other banners: " + ", ".join(f"{b['banner']} {b['version']}" for b in ev["other_banners"][:8])
                 + f" [{JARVIS_SCAN}]")
    a = ev["assets"]
    L.append(f"ASSETS  [{a['by']}] {a['files']} files, {_size(a['bytes'])} from {len(a['by_origin'])} origin(s)")
    for kind, t in sorted(a["by_kind"].items(), key=lambda kv: -kv[1]["bytes"]):
        hidden = f", {t['hidden']} unsized" if t["hidden"] else ""
        L.append(f"  {kind:20} {t['files']:3} files  {_size(t['bytes'])}{hidden}")
    L.append("  largest:")
    L += [f"    {_size(f['bytes']):>9}  {f['kind']:20} {f['url']}" for f in a["largest"]]
    L += [f"  note: {n}" for n in a["notes"]]
    s = ev["screenshot"]
    L.append(f"SNAPSHOT  [{s['by']}] {s['width']}x{s['height']} PNG, {_size(s['bytes'])} -> {s['path']}")
    return "\n".join(L)
