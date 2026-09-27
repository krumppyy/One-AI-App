/**
 * The uncensored routing engine.
 *
 * There is no such thing as a client-side trick that stops a model's server
 * from seeing a request. The prompt, the picture and the job all arrive at
 * whatever machine does the work, and if that machine runs a content check it
 * sees them — full stop. What a client *can* do is make sure an explicit
 * request is only ever sent to endpoints that will accept it:
 *
 *   - the models that are uncensored by construction (a dedicated NSFW build, a
 *     MuAPI `✦ uncensored` endpoint),
 *   - the models that expose their own safety switch through the API, which the
 *     app turns off (Wan 2.2 Preview / Preview II),
 *   - a paid vendor that permits it,
 *   - and the two routes that involve nobody else at all: your own GPU server
 *     and the on-device renderer.
 *
 * Everything else — the ordinary Wan / LTX / SVD Spaces — runs a content check.
 * Sending explicit content to one of those does not merely fail: the refusal is
 * the record of the attempt. So the router keeps explicit runs off them
 * entirely. That is the actual mechanism behind “don't get caught”: not hiding
 * the content, but never submitting it to a service that would report it.
 *
 * This module classifies a request, says what each provider's moderation
 * behaviour really is, filters a pool accordingly, and remembers which routes
 * have actually accepted explicit work before — so a run stops rediscovering
 * that the same endpoint refuses.
 */

import { isNsfwCapable } from "./providers.js";

export const ROUTING_MODES = [
  {
    id: "strict",
    label: "Uncensored models only (recommended)",
    note: "An explicit run is only ever sent to a route that accepts it. A model that would refuse is never asked, so nothing is submitted to a service that would log or report it.",
  },
  {
    id: "widen",
    label: "Try every enabled model",
    note: "An explicit run also tries the ordinary models, and falls forward into the standard pool when the uncensored ones are unavailable. More routes — but each refusal is a submission to a service whose checker will see it, and to no benefit.",
  },
];

export const TIER = { SFW: "sfw", SUGGESTIVE: "suggestive", EXPLICIT: "explicit" };

/**
 * Vocabulary for the local classifier. Deliberately clinical rather than
 * exhaustive: the job is to separate “an ordinary clip” from “a run that must
 * not be handed to a moderated model”, which a few dozen clear stems do well.
 * It runs on the prompt the user typed, in this browser — nothing is sent to
 * classify anything.
 */
const EXPLICIT_STEMS = [
  "nude", "nudes", "naked", "topless", "bottomless", "undress", "undressing", "stripped", "strip",
  "nipple", "areola", "breast", "boobs", "boob", "tits", "titty", "cleavage", "chest exposed",
  "pussy", "vagina", "vulva", "labia", "clit", "clitoris", "crotch", "genital", "penis", "cock",
  "dick", "erection", "cum", "semen", "orgasm", "masturbat", "fingering", "dildo", "vibrator",
  "anal", "anus", "butt naked", "bare ass", "ass naked", "sex", "sexual", "intercourse", "penetrat",
  "blowjob", "handjob", "fellatio", "cunnilingus", "creampie", "bdsm", "bondage", "nsfw", "porn",
  "explicit", "lingerie only", "no clothes", "unclothed", "clothing removed", "top off", "bra off",
  "panties off", "shirtless", "expose her", "expose her body", "heavy breasts", "huge breasts",
];
const SUGGESTIVE_STEMS = [
  "lingerie", "bikini", "underwear", "panties", "bra", "seductive", "sensual", "sultry", "provocative",
  "revealing", "sexy", "erotic", "tease", "striptease", "boudoir", "lingerie set", "sheer",
];

function hits(text, stems) {
  const found = [];
  for (const s of stems) if (text.includes(s)) found.push(s);
  return found;
}

/**
 * What kind of request is this? Local, instantaneous, and used only to decide
 * which pool is permitted — never to change the prompt.
 */
export function classifyRequest({ prompt = "", negative = "", nsfw = false, undress = false, frameMode = "image" } = {}) {
  const text = ` ${String(prompt || "")} ${String(negative || "")} `.toLowerCase();
  const explicitHits = hits(text, EXPLICIT_STEMS);
  const suggestiveHits = hits(text, SUGGESTIVE_STEMS);

  let tier = TIER.SFW;
  const reasons = [];
  if (nsfw) {
    tier = TIER.SUGGESTIVE;
    reasons.push("the NSFW generator is on");
  }
  if (suggestiveHits.length) {
    if (tier !== TIER.EXPLICIT) tier = TIER.SUGGESTIVE;
    reasons.push(`suggestive words: ${suggestiveHits.slice(0, 4).join(", ")}`);
  }
  if (explicitHits.length) {
    tier = TIER.EXPLICIT;
    reasons.push(`explicit words: ${explicitHits.slice(0, 4).join(", ")}`);
  }
  if (undress) {
    tier = TIER.EXPLICIT;
    reasons.push("the undress sequence is on");
  }
  // An NSFW run whose first frame is made explicit is explicit whether or not
  // the words in the prompt say so — the picture being animated is.
  if (nsfw && (frameMode === "auto" || frameMode === "undress" || frameMode === "draw")) {
    tier = TIER.EXPLICIT;
    reasons.push(`the NSFW starting frame is being made explicitly (${frameMode})`);
  }
  return { tier, explicit: tier === TIER.EXPLICIT, signals: reasons };
}

export function tierLabel(tier) {
  return tier === TIER.EXPLICIT ? "explicit" : tier === TIER.SUGGESTIVE ? "suggestive" : "standard";
}

/**
 * What this provider does about explicit content.
 *
 *   device      this device, no filter, nobody told
 *   own         your own GPU server
 *   uncensored  a build that exists to do this
 *   switch      the Space exposes safe_mode / enable_safety_checker and the app
 *               turns it off through the API
 *   vendor      a paid vendor that permits it (their own terms still apply)
 *   check       runs a content check — an explicit request is refused, and the
 *               refusal is a record on their side
 *   unknown     a provider with no declared capability
 */
export function moderationOf(p) {
  if (!p) return { kind: "unknown", label: "unknown", accepts: false, detail: "No provider was selected." };
  if (p.kind === "offline" || p.id === "offline_motion" || p.kind === "codec-cpu") {
    return { kind: "device", accepts: true, label: "this device", detail: "No network at all — nothing to check, nobody to report to." };
  }
  if (p.kind === "server" || p.ownServer === true) {
    return { kind: "own", accepts: true, label: "your own server", detail: "Your hardware. It checks nothing unless you make it." };
  }
  if (p.nsfwOnly) {
    return { kind: "uncensored", accepts: true, label: "dedicated uncensored build", detail: "Trained without a safety filter; it exists for explicit work." };
  }
  if (p.caps?.nsfw) {
    if (p.tier === "key" || p.requires) {
      return { kind: "vendor", accepts: true, label: "paid vendor", detail: "Permits it, but the vendor's own terms still govern what they keep." };
    }
    return {
      kind: "switch",
      accepts: true,
      label: "safety switch turned off",
      detail: "The Space exposes its own checker (safe_mode / enable_safety_checker) and the app switches it off for an NSFW run.",
    };
  }
  if (p.kind === "gradio") {
    return { kind: "check", accepts: false, label: "runs a content check", detail: "An explicit request would be refused — and the refusal is the record of the attempt." };
  }
  if (p.kind === "puter") {
    return { kind: "check", accepts: false, label: "Puter's own content check", detail: "Puter's models are moderated — an explicit request would be refused there, under your own Puter account." };
  }
  return { kind: "unknown", accepts: false, label: "no uncensored path", detail: "This provider has no declared uncensored path." };
}

/** May an explicit request be sent here? */
export function acceptsExplicit(p) {
  return !!p && moderationOf(p).accepts === true;
}

/**
 * Split a pool into the routes an explicit run may use and the ones it may not,
 * with a reason for each — so the UI and the log can say what was left out
 * instead of silently trying everything.
 */
export function routeReadout(providers, tier = TIER.EXPLICIT) {
  const allowed = [];
  const blocked = [];
  for (const p of providers || []) {
    const mod = moderationOf(p);
    const row = { id: p.id, label: p.label, kind: mod.kind, moderation: mod.label, detail: mod.detail };
    if (tier === TIER.EXPLICIT && !mod.accepts) blocked.push(row);
    else allowed.push(row);
  }
  return { allowed, blocked, tier };
}

/* ------------------------------------------------- remembered outcomes ---- */

/**
 * Which routes have actually accepted explicit work. A refusal here is not a
 * failure of the app — it is information about the endpoint, and it is exactly
 * what stops a later run from walking into the same wall.
 */
const FOLDER = "avg_route";
let cache = null;

let kvRef = null;
function kv() {
  kvRef = kvRef || (typeof root !== "undefined" ? root.kv : null);
  return kvRef;
}

export async function loadRouteStats() {
  if (cache) return cache;
  cache = {};
  try {
    const entries = await kv()[FOLDER].entries();
    for (const [id, v] of entries) if (v && typeof v === "object") cache[id] = v;
  } catch {}
  return cache;
}

export function routeStatsSync() {
  return cache || {};
}

/**
 * Record how a route behaved on a request of a given tier. `ok` is the render
 * succeeding; `refused` is a real content refusal (as opposed to a quota or a
 * network failure, which say nothing about the route's tolerance).
 */
export async function recordOutcome(providerId, { tier = TIER.SFW, ok = true, refused = false } = {}) {
  if (!providerId) return null;
  const stats = await loadRouteStats();
  const cur = stats[providerId] || { ok: 0, refused: 0 };
  if (refused) cur.refused = (cur.refused || 0) + 1;
  else if (ok) cur.ok = (cur.ok || 0) + 1;
  cur.tier = tier;
  cur.last = Date.now();
  stats[providerId] = cur;
  try {
    await kv()[FOLDER].set(providerId, cur);
  } catch {}
  return cur;
}

/** 0 when the route has never been tried, negative once it has refused. */
export function outcomeScore(providerId) {
  const s = cache?.[providerId];
  if (!s) return 0;
  const ok = Number(s.ok) || 0;
  const refused = Number(s.refused) || 0;
  if (refused && !ok) return -2;
  if (refused) return -0.5;
  return Math.min(2, 0.5 + ok * 0.25);
}

export function labelForRefusal(providerId) {
  const s = cache?.[providerId];
  if (!s?.refused) return "";
  return `${s.refused} content refusal${s.refused === 1 ? "" : "s"} recorded on this route`;
}

export async function resetRouteStats() {
  cache = {};
  try {
    const keys = await kv()[FOLDER].keys();
    if (keys.length) await kv()[FOLDER].deleteMany(keys);
    return keys.length;
  } catch {
    return 0;
  }
}

/** Providers that are capable at all — the router never invents a route. */
export function explicitCapablePool(providers) {
  return (providers || []).filter((p) => isNsfwCapable(p));
}
