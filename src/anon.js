/**
 * One anonymous name per run.
 *
 * Every request the app makes to a free model hands it a file: the reference
 * picture, and a still or a driving clip for each beat of a storyboard. Those
 * carry an *original filename*, and a filename is a link — `IMG_4417.jpg`
 * uploaded from the same browser five times tells the endpoint that the same
 * person came back five times, whatever the cookies say.
 *
 * This module mints one short random token per run and renames every file the
 * run uploads with it, so nothing across runs is correlated by name. It pairs
 * with the metadata strip in src/image.js: the name is anonymised, and the
 * picture itself carries no camera, GPS or software tag either.
 *
 * It is deliberately tiny and stateful — the token is set once, at the top of
 * `generate()` (see src/engine.js), and every later `freshName()` in that run
 * sees the same one.
 */

let NONCE = "";

/** Mint a new run token. Called once at the start of each run. */
export function newRunNonce() {
  NONCE = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  return NONCE;
}

/** The token for the run in progress (minting one if none is set yet). */
export function runNonce() {
  return NONCE || newRunNonce();
}

/**
 * `start.png` → `start-k3f9a1x2.png`. The stem is kept (so a log or a Space's
 * own history still reads sensibly) but the token makes it unique. Anything
 * that is not a filename-safe character is folded to a dash.
 */
export function freshName(name = "input.png") {
  const raw = String(name || "input").trim() || "input";
  const m = raw.match(/^(.*?)(\.[a-z0-9]{1,5})?$/i);
  const stem = (m?.[1] || "input").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "input";
  const ext = (m?.[2] || "").toLowerCase() || ".png";
  return `${stem}-${runNonce()}${ext}`;
}
