// How long to wait after a finalized phrase before treating the thought as finished.
// Speech recognition finalizes on every short pause; more speech inside this window
// is appended to the same sentence and restarts the wait.
const FINISH_MS = 900;

/*
 * Voice for the knowledge galaxy, using only what the browser ships:
 *   speaking  -> speechSynthesis (Web Speech API)
 *   listening -> webkitSpeechRecognition / SpeechRecognition
 *
 * Public surface (window.Voice):
 *   Voice.speak(text)                 the ONE function that makes sound
 *   Voice.stopSpeaking()
 *   Voice.addRoute(pattern, handler)  voice commands checked before the brain
 *   Voice.routes                      the route list itself
 *   Voice.setThinking(bool)           status line: the brain is working
 *   Voice.init({ ask })               ask(text) sends a sentence to /chat
 */
(() => {
  "use strict";

  const MUTED = new URLSearchParams(location.search).get("mute") === "1";
  const synth = window.speechSynthesis || null;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;

  // Short words that cut through the finish window and fire immediately.
  const INTERRUPT = /^(?:stop|wait|cancel|quiet|pause|enough|hold on|hang on|be quiet|shh+|shush)(?: (?:it|that|talking|speaking|please|now))?$/;

  const state = { listening: false, thinking: false, speaking: false, heard: "", note: "" };
  let ask = text => console.warn("Voice.init() was never called; dropped:", text);

  // ── status line ───────────────────────────────────────────────
  function render() {
    const el = document.getElementById("status");
    if (!el) return;
    let mode = "idle", text = Recognition ? "Click the mic and talk, or type below" : "Type below (this browser has no speech recognition)";
    if (state.listening) { mode = "listening"; text = state.heard ? `Listening: “${state.heard}”` : "Listening…"; }
    if (state.thinking) { mode = "thinking"; text = "Thinking…"; }
    if (state.speaking) { mode = "speaking"; text = state.listening ? "Speaking… say “stop” to interrupt" : "Speaking…"; }
    if (state.note && mode === "idle") text = state.note;
    el.dataset.mode = mode;
    el.querySelector(".label").textContent = text;
    el.querySelector(".muted").hidden = !MUTED;
    const mic = document.getElementById("mic");
    if (mic) {
      mic.classList.toggle("on", state.listening);
      mic.setAttribute("aria-pressed", String(state.listening));
    }
  }
  const set = patch => { Object.assign(state, patch); render(); };

  // ── speaking ──────────────────────────────────────────────────
  let unlocked = false;       // true after the first user gesture
  const queued = [];          // lines requested before that gesture
  let generation = 0;         // bumps on stop, so stale callbacks are ignored
  const live = new Set();     // keep utterances referenced (Chrome drops onend otherwise)

  function pickVoice() {
    const voices = synth.getVoices();
    const british = voices.filter(v => /^en[-_]GB/i.test(v.lang));
    return british.find(v => /google uk english|daniel|serena|arthur|kate|oliver|libby|ryan|sonia/i.test(v.name))
      || british.find(v => v.localService) || british[0]
      || voices.find(v => /^en[-_]/i.test(v.lang) && v.default) || voices.find(v => /^en[-_]/i.test(v.lang)) || null;
  }

  // Chrome stops long utterances after ~15s, so speak sentence-sized chunks.
  function chunks(text) {
    const parts = text.replace(/\s+/g, " ").match(/[^.!?;]+[.!?;]*\s*/g) || [text];
    const out = [];
    for (const p of parts) {
      const last = out[out.length - 1];
      if (last && last.length + p.length < 180) out[out.length - 1] = last + p;
      else out.push(p);
    }
    return out.map(s => s.trim()).filter(Boolean);
  }

  /**
   * The ONE place that hands anything to the speech engine. Every sound, including the
   * silent unlock primer, goes through here, so ?mute=1 can't be routed around.
   * Returns false when it refused.
   */
  function utter(u) {
    if (MUTED) return false;                      // ?mute=1: this tab never speaks
    if (!synth) return false;
    synth.speak(u);
    return true;
  }

  /** Speak a line (queued until the first user gesture). Resolves when done. */
  function speak(text) {
    if (MUTED) return Promise.resolve();          // nothing to queue or wait for
    text = String(text || "").trim();
    if (!synth || !text) return Promise.resolve();
    if (!unlocked) {                               // browsers block audio before a gesture
      return new Promise(resolve => queued.push({ text, resolve }));
    }
    stopSpeaking();
    const gen = ++generation;
    const voice = pickVoice();
    const parts = chunks(text);
    set({ speaking: true, note: "" });
    return new Promise(resolve => {
      let left = parts.length;
      const done = () => {
        if (gen !== generation) return resolve();
        if (--left > 0) return;
        set({ speaking: false });
        resolve();
      };
      for (const part of parts) {
        const u = new SpeechSynthesisUtterance(part);
        if (voice) { u.voice = voice; u.lang = voice.lang; } else { u.lang = "en-GB"; }
        u.rate = 1; u.pitch = 1;
        live.add(u);
        u.onend = u.onerror = () => { live.delete(u); done(); };
        if (!utter(u)) { live.delete(u); done(); }
      }
      if (synth.paused) synth.resume();
    });
  }

  function stopSpeaking() {
    generation++;
    live.clear();
    if (synth && (synth.speaking || synth.pending)) synth.cancel();
    if (state.speaking) set({ speaking: false });
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    removeEventListener("pointerdown", unlock, true);
    removeEventListener("keydown", unlock, true);
    if (!synth || MUTED) { queued.splice(0).forEach(q => q.resolve()); return; }
    // Speaking inside the gesture is what unlocks audio in Chrome and Safari.
    const primer = new SpeechSynthesisUtterance(" ");
    primer.volume = 0;
    utter(primer);
    const pending = queued.splice(0);
    // Let the gesture finish, then play what was waiting (only the latest line matters).
    setTimeout(() => {
      pending.slice(0, -1).forEach(q => q.resolve());
      const last = pending[pending.length - 1];
      if (last) speak(last.text).then(last.resolve);
    }, 50);
  }
  addEventListener("pointerdown", unlock, true);
  addEventListener("keydown", unlock, true);
  if (synth && "onvoiceschanged" in synth) synth.onvoiceschanged = () => synth.getVoices();

  // ── voice routes ──────────────────────────────────────────────
  // Each route: { pattern: RegExp, handler(match, sentence) }. First match wins and
  // the sentence never reaches the brain. Add new commands with Voice.addRoute().
  const routes = [];
  function addRoute(pattern, handler) { routes.push({ pattern, handler }); }

  function normalise(text) {
    return text.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
  }

  function dispatch(sentence) {
    const clean = normalise(sentence);
    if (!clean) return;
    for (const route of routes) {
      const m = clean.match(route.pattern);
      if (m) { route.handler(m, sentence); return; }
    }
    ask(sentence);
  }

  addRoute(INTERRUPT, () => { stopSpeaking(); set({ note: "Stopped." }); });

  // ── listening ─────────────────────────────────────────────────
  let rec = null;
  let buffer = "";            // finalized phrases waiting for the finish window
  let interim = "";           // words heard but not finalized yet
  let consumed = 0;           // results before this index are already handled
  let resultCount = 0;
  let timer = null;

  function armTimer() {
    clearTimeout(timer);
    timer = setTimeout(finish, FINISH_MS);
  }

  function finish() {
    timer = null;
    const sentence = `${buffer} ${interim}`.replace(/\s+/g, " ").trim();
    if (interim) consumed = resultCount;    // don't append these words again when they finalize
    buffer = interim = "";
    set({ heard: "" });
    if (sentence) dispatch(sentence);
  }

  function interrupt(text) {
    clearTimeout(timer); timer = null;
    buffer = interim = "";
    set({ heard: "" });
    dispatch(text);
  }

  function onResult(e) {
    resultCount = e.results.length;
    let liveText = "";
    for (let i = Math.max(e.resultIndex, consumed); i < e.results.length; i++) {
      const r = e.results[i];
      const text = r[0].transcript.trim();
      if (!r.isFinal) { liveText += " " + text; continue; }
      consumed = i + 1;
      if (!text) continue;
      if (INTERRUPT.test(normalise(text))) { interrupt(text); continue; }
      if (state.speaking) {                   // likely our own voice leaking into the mic
        set({ note: "Didn't take that: I was talking. Say “stop” to interrupt me." });
        continue;
      }
      buffer = `${buffer} ${text}`.trim();
      armTimer();
    }
    interim = liveText.trim();
    if (interim) {
      // Barge-in: "stop" while it's talking cuts the voice before the word finalizes.
      if (state.speaking && INTERRUPT.test(normalise(interim))) stopSpeaking();
      if (!state.speaking) armTimer();        // still talking: restart the finish window
    }
    set({ heard: state.speaking ? "" : `${buffer} ${interim}`.trim() });
  }

  function startListening() {
    if (!Recognition || state.listening) return;
    rec = new Recognition();
    rec.lang = "en-GB";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = onResult;
    rec.onerror = e => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      const why = {
        "not-allowed": "Microphone blocked. Allow it in the address bar and try again.",
        "service-not-allowed": "Microphone blocked by the browser.",
        "audio-capture": "No microphone found.",
        network: "Speech recognition needs the browser's speech service. Brave and some Chromium builds don't have it; use Chrome or Edge.",
      }[e.error] || `Speech recognition error: ${e.error}`;
      stopListening(why);
    };
    // Chrome ends continuous sessions after a while; reopen while the mic is on.
    rec.onend = () => {
      consumed = 0; resultCount = 0;
      if (state.listening) { try { rec.start(); } catch { stopListening(); } }
    };
    try { rec.start(); } catch (err) { set({ note: `Couldn't start the microphone: ${err.message}` }); return; }
    set({ listening: true, heard: "", note: "" });
  }

  function stopListening(note = "") {
    const r = rec; rec = null;
    set({ listening: false, heard: "", note });
    if (r) { r.onend = null; try { r.stop(); } catch { /* already stopped */ } }
    // Whatever was said before the click still counts.
    if (timer) { clearTimeout(timer); finish(); }
    consumed = 0; resultCount = 0;
  }

  // ── wiring ────────────────────────────────────────────────────
  function init(options) {
    ask = options.ask;
    const mic = document.getElementById("mic");
    if (mic) {
      if (!Recognition) {
        mic.disabled = true;
        mic.title = "This browser has no speech recognition. Use Chrome, Edge or Safari.";
      } else {
        mic.onclick = () => (state.listening ? stopListening() : startListening());
      }
    }
    render();
  }

  window.Voice = {
    FINISH_MS, MUTED, routes, addRoute, speak, utter, stopSpeaking, init,
    setThinking: on => set({ thinking: !!on, note: "" }),
    setNote: text => set({ note: String(text || "") }),
    get state() { return { ...state }; },
    _test: { dispatch, onResult, normalise },  // used by the automated check
  };
})();
