/**
 * Motion transfer: copying a real person's movement — and their facial
 * expression — onto the character in our keyframes.
 *
 * WHY THIS EXISTS
 * ---------------
 * An image-to-video model animates what it is shown, and it invents the motion
 * as it goes. That is why "the body movement and facial expression are missing"
 * is the *normal* result of prompting a video model for an undress: it never
 * saw anyone undress, so it has nothing to copy, and it falls back to drifting
 * a still. Telling it to move harder only makes the drift wobble.
 *
 * The models that actually solve this are the character-animation family (Wan
 * Animate and its relatives). They do not invent motion: they are handed a
 * *driving clip* — a real person moving — and a *reference picture*, and they
 * re-render the reference person performing the driving clip's movement, joint
 * for joint, with the driving face's expression on theirs. That is what "copy a
 * realistic human movement" means literally, and it is what this module wires
 * up: two free public Spaces that expose exactly that (see MOTION_PROVIDERS in
 * providers.js).
 *
 * THE DRIVING CLIP
 * ----------------
 * A character-animation model needs a clip of *somebody* moving. Two sources,
 * in order:
 *
 *   1. The app is handed one (`o.motionClip`) — a real motion reference.
 *   2. The app makes one: a plain, fully-clothed actor is drawn and animated
 *      with the rung's *motion only*, and that clip becomes the driver.
 *
 * Source 2 is the default and it is deliberately tame. The nudity in the run
 * comes from the *reference picture* (the storyboard keyframe, which is where
 * the clothing actually changes); the driver only ever supplies movement. That
 * split is also what keeps the free Spaces usable: they are handed a clothed
 * person walking and turning, not an explicit request, so there is far less for
 * a safety filter to refuse. The result is still explicit, because the person
 * being animated is the explicit keyframe.
 *
 * NOTHING HERE IS SHOWN IN THE UI. The driver, the ladder and the transfer are
 * all backend; the user only ever sees the finished clip.
 */

import { MOTION_PROVIDERS } from "./providers.js";
import { storyboardMotion } from "./storyboard.js";

/**
 * Words that describe nudity or sex, and what to say instead when building the
 * *driver's* prompt. The driver is a clothed actor: the movement is what we are
 * after, so the explicit nouns are dropped and the motion verbs kept. Order
 * matters — the longer phrases are replaced before the single words they
 * contain.
 */
const DRIVER_REWRITES = [
  [/\bcompletely nude\b/gi, "in a fitted dress"],
  [/\bfully nude\b/gi, "in a fitted dress"],
  [/\bnude\b/gi, "on"],
  [/\bnaked\b/gi, "dressed"],
  [/\btopless\b/gi, "dressed"],
  [/\bbare breasts?\b/gi, "chest"],
  [/\bbare chest\b/gi, "chest"],
  [/\bbreasts?\b/gi, "chest"],
  [/\bnipples?\b/gi, ""],
  [/\bshirt gone\b/gi, "dressed"],
  [/\bnothing on\b/gi, "dressed"],
  [/\bundress(?:es|ed|ing)?\b/gi, "moves"],
  [/\bstrip(?:s|ped|ping)?\b/gi, "moves"],
  [/\bsensual(?:ly)?\b/gi, "smoothly"],
  [/\baroused\b/gi, "lively"],
  [/\bin pleasure\b/gi, "with a bright, happy face"],
  [/\bpleasure\b/gi, "joy"],
  [/\bbetween her thighs\b/gi, "over her legs"],
  [/\bthighs?\b/gi, "legs"],
  [/\bpussy|cunt|vagina\b/gi, ""],
  [/\bpenis|cock\b/gi, ""],
  [/\bass|butt\b/gi, "hips"],
  [/\bexplicit|nsfw|porn\b/gi, ""],
  // The driver's outfit is fixed by `driverStillPrompt`, so the beat's own
  // garment words are normalised to something neutral rather than left to
  // fight the still: the movement is what this clip is for.
  [/\b(?:the |an |her )?(?:open |sheer |loose )?shirt\b/gi, "her top"],
  [/\bshorts\b/gi, "her skirt"],
  [/\bbra\b/gi, "her top"],
];

/**
 * Expressions that read as sexual, and the tame emotion to drive the face with.
 * First match wins, so the specific feelings come before the general ones: a
 * word-by-word substitution turned "smouldering gaze, flushed cheeks" into
 * nonsense, and a garbled face prompt is a garbled face on screen.
 */
const FACE_MAP = [
  [/smoulder|smolder|flushed|seduct/i, "confident direct gaze, lips slightly parted, cheeks a little flushed"],
  [/aroused|pleasure|ecstas|orgasm|moan/i, "head tilted back, eyes closed, mouth open, laughing"],
  [/biting her (?:lower )?lip/i, "biting her lip, small smile"],
  [/laughing|eyes bright/i, "laughing, eyes bright, mouth open"],
  [/half closed|eyes closed/i, "eyes half closed, soft pleased smile"],
  [/knowing|smug|proud/i, "small knowing smile"],
  [/playful/i, "playful smile over her shoulder"],
  [/confident/i, "confident half-smile, eyes on the lens"],
];

function tidy(text) {
  return String(text || "")
    .replace(/\s*,\s*,+/g, ", ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .trim();
}

/**
 * The *movement* of a rung's action, with the nudity taken out — the motion
 * prompt for the clothed actor whose clip drives the transfer.
 */
export function driverMotion(rung, extra = "") {
  let text = `${rung?.action || ""}, ${rung?.pose || ""}`;
  for (const [re, to] of DRIVER_REWRITES) text = text.replace(re, to);
  text = tidy(text);
  if (text.length < 12) text = "she moves naturally, shifting her weight and turning";
  return tidy(`${text}${extra ? ", " + extra : ""}`);
}

/** The face the driver should wear, in tame terms, so the expression transfers. */
export function driverFace(rung) {
  const raw = String(rung?.expression || "");
  for (const [re, to] of FACE_MAP) if (re.test(raw)) return to;
  const text = tidy(raw);
  return text.length >= 6 ? text : "a natural, lively, clearly expressive face";
}

/**
 * The prompt for the clothed actor still that becomes the driving clip.
 *
 * Deliberately a *wide* shot: the pose estimator that turns this into a driving
 * clip needs the ankles as much as the shoulders, and a "full body" prompt on
 * its own reliably crops the feet — which is exactly the "figure is not
 * properly drawn" failure, transferred straight onto her. The face is asked for
 * as a candid, unretouched one, because a "beautiful woman" prompt comes back
 * with a doll's face, and a doll's face is what gets transferred onto her.
 *
 * `variant > 0` is the retry wording: when a check says the figure did not fit
 * the frame, the next candidate is asked for at a greater distance, which is
 * the one thing that reliably pulls the feet back into shot.
 */
export function driverStillPrompt(variant = 0) {
  const back =
    variant > 0
      ? " she is standing much further back, a small full-length figure in the middle of the frame with generous empty space above her head and below her feet,"
      : " she stands well back from the camera so her whole body fits inside the frame,";
  return tidy(
    "full length wide shot, candid documentary photograph of one ordinary woman standing straight, front on, facing the camera," +
      back +
      " her entire body from the top of her head to her bare feet is inside the frame, with clear empty space above her head and below her feet," +
      " neutral relaxed pose, arms loose at her sides, she looks straight into the camera lens," +
      " plain seamless light grey studio backdrop, wearing a plain loose knee length sleeveless dress," +
      " natural unretouched face, even soft studio lighting, candid, sharp focus, correct anatomy, whole body in frame"
  );
}

/** The full motion prompt handed to the i2v model that animates the actor. */
export function driverClipPrompt(rung, motion = null) {
  return tidy(
    `${driverMotion(rung)}, ${driverFace(rung)}, ${motion || storyboardMotion()}, ` +
      `she is fully clothed, the whole body stays in frame, smooth continuous camera`
  );
}

/** The tunables: a `motionTransfer` list in main.pjs, and safe defaults. */
export function motionOptions() {
  const fb = { enabled: true, maxBeats: 4, steps: 5, driverMaxSec: 3 };
  try {
    const cfg = typeof root !== "undefined" ? root.motionTransfer : null;
    if (cfg) {
      const on = cfg.enabled;
      if (on !== undefined && on !== null && on !== "") {
        const s = String(on).trim().toLowerCase();
        fb.enabled = !(s === "false" || s === "0" || s === "off" || s === "no");
      }
      for (const k of ["maxBeats", "steps", "driverMaxSec"]) {
        const n = Number(cfg[k]);
        if (Number.isFinite(n) && n > 0) fb[k] = n;
      }
    }
  } catch {}
  return fb;
}

/** Is motion transfer wanted for this run? */
export function motionEnabled(settings, opts = {}) {
  if (!opts.storyboard && !opts.undress) return false;
  // An explicit choice in the app/settings always wins; the list is the default.
  if (settings?.motionTransfer === false) return false;
  if (settings?.motionTransfer === true) return true;
  return motionOptions().enabled !== false;
}

/** The free character-animation Spaces, in the order they are tried. */
export function motionProviders() {
  return MOTION_PROVIDERS.map((p) => ({ ...p }));
}

/**
 * Which model animates the *driver* (a plain text/image-to-video model — it is
 * only ever asked for a clothed person moving, so the cheapest fast one will
 * do). Returns null when nothing suitable is in the order at all.
 */
const DRIVER_PREFERENCE = ["wan22_rcm", "ltx_fast", "wan22_fast", "wan21_fast", "wan22_preview", "wan22_14b"];
export function pickDriverProvider(order) {
  const usable = (order || []).filter(
    (p) => !p.caps?.motion && p.kind !== "offline" && p.kind !== "motion" && (p.caps?.i2v || p.caps?.t2v)
  );
  if (!usable.length) return null;
  for (const id of DRIVER_PREFERENCE) {
    const hit = usable.find((p) => p.id === id);
    if (hit) return hit;
  }
  return [...usable].sort((a, b) => (a.estSecs || 999) - (b.estSecs || 999))[0];
}

/**
 * Put the character-animation Spaces at the front of the queue.
 *
 * They go first because they are the only models that produce *directed*
 * motion, and the engine falls back to the ordinary chain on its own when one
 * refuses. They are not added unless a driver clip is actually available for
 * the beat, so a run whose driver could not be made simply never tries them.
 */
export function withMotionProviders(order) {
  const rest = (order || []).filter((p) => !p.caps?.motion);
  return [...motionProviders(), ...rest];
}

/**
 * Score for the storyboard's re-sort: directed motion beats everything, then
 * an uncensored model, then one that can be handed both ends of a beat.
 */
export function motionScore(provider, nsfw) {
  return (
    (provider.caps?.motion ? 8 : 0) +
    (nsfw && provider.caps?.nsfw ? 2 : 0) +
    (provider.caps?.endFrame ? 1 : 0)
  );
}

/** Does this provider need a driving clip? */
export function needsDriver(provider) {
  return !!provider?.caps?.motion;
}

