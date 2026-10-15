// Which sentences start a teardown, and the address they name. Shared by the page (voice and
// typed questions) and by preflight's offline checks, which load this same file in Node.
// Only sentences that NAME a site (or say "this site") count; anything else goes to the brain.
(function (root) {
"use strict";

const TEARDOWN_ASKS = [
  /^(?:(?:hey |ok )?jarvis[,\s]+)?(?:please |can you |could you )?(?:reverse engineer|tear down|take apart|dissect|look under the hood of)\s+(.+)$/i,
  /^(?:jarvis[,\s]+)?how (?:does|did|do) (.+?) (?:do|pull off|make) (?:that|this|it)[?!.]*$/i,
  /^(?:jarvis[,\s]+)?how (?:does|did|do) (.+?) work[?!.]*$/i,
  /^(?:jarvis[,\s]+)?what(?:'s| is| was) (.+?) (?:built|made|written) (?:with|in|on)[?!.]*$/i,
  /^(?:jarvis[,\s]+)?how (?:is|was) (.+?) (?:built|made)[?!.]*$/i,
];
const THIS_SITE = /^(?:this|this (?:site|page|tab|website)|the (?:current )?(?:site|page|tab))$/i;

// Speech to address: "igloo dot inc" -> igloo.inc, "slash" -> /, "colon" -> :. localhost allowed.
function spokenAddress(text) {
  return text.toLowerCase().trim()
    .replace(/\s*\bdot\b\s*/g, ".").replace(/\s*\bslash\b\s*/g, "/").replace(/\s*\bcolon\b\s*/g, ":")
    .replace(/[?!,]+$/, "").replace(/\.+$/, "");
}

/** {url, question} when the sentence asks to take apart a NAMED site (or "this site"); else null. */
function teardownIntent(sentence) {
  const said = sentence.trim();
  for (const re of TEARDOWN_ASKS) {
    const m = said.match(re);
    if (!m) continue;
    const target = m[1].trim().replace(/[?!.,]+$/, "");
    if (THIS_SITE.test(target)) return { url: "this", question: said };
    const addr = spokenAddress(target).match(
      /^(?:https?:\/\/)?((?:localhost|(?:[a-z0-9-]+\.)+[a-z]{2,24}|\d{1,3}(?:\.\d{1,3}){3})(?::\d{2,5})?(?:\/\S*)?)(?=\s|$)/);
    if (addr) return { url: addr[1], question: said };
    return null;                          // "tear down the old shed": not a site, not ours
  }
  return null;
}

const api = { spokenAddress, teardownIntent, TEARDOWN_ASKS, THIS_SITE };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.TeardownIntent = api;
})(typeof window !== "undefined" ? window : globalThis);
