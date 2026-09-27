import {
  CAMERA_ANGLES,
  CAMERA_MOVES,
  TRACKING_MODES,
  ASPECTS,
  DEFAULT_NEGATIVE,
  HF_ENDPOINT_IDS,
  NSFW_BOOST,
  NSFW_NEGATIVE,
  OFFLINE_PROVIDER,
  PROVIDERS,
  CODEC_LOCAL,
  KEY_PROVIDERS,
  MUAPI_PROVIDERS,
  STYLES,
  dimsFor,
  getProvider,
  isMultiRef,
  isNsfwCapable,
  isNsfwOnly,
} from "./providers.js";
import { SpaceError, alignData, callEndpoint, loadZeroGpuBlock, spaceParams, spaceToHost, uploadBlob } from "./gradio.js";
import { downloadRelays, privacyStrict, relayBlob, relayFetch, requiredRelay, rotatableCount, untraceInit } from "./relay.js";
import { blobFromUrl, clipMetrics, clipMotion, extractFrame, normalizeToAspect, probe, retimeClip, stitch } from "./video.js";
import { imageStats, shrinkToFit } from "./image.js";
import { renderMotionClip } from "./offline.js";
import { renderStillFilm } from "./stillfilm.js";
import { newRunNonce } from "./anon.js";
import { serverGenerate } from "./server.js";
import { muapiRun } from "./muapi.js";
import { prepareExplicitFrame, stripWatermark } from "./nsfw.js";
import { poolFailMessage } from "./store.js";
import {
  beatPrompt,
  buildPlan,
  drawKeyframes,
  endFrameFor,
  FRAME_ANCHOR,
  FRAME_NEGATIVE,
  planBeats,
  readStoryboard,
  segmentMotion,
  startFrameFor,
  storyboardMotion,
  storyboardOptions,
} from "./storyboard.js";
import {
  analyzeFigure,
  FULL_FIGURE_HINT,
} from "./figure.js";
import {
  driverClipPrompt,
  driverFace,
  driverMotion,
  driverStillPrompt,
  motionEnabled,
  motionOptions,
  motionScore,
  needsDriver,
  pickDriverProvider,
  withMotionProviders,
} from "./motion.js";
import { markCooldown } from "./store.js";
import { durationIsSuspect } from "./encode.js";
import { acceptsExplicit, classifyRequest, recordOutcome, routeStatsSync, tierLabel } from "./router.js";
import { frameStepBlocked, leakBlocked } from "./vault.js";

// Tunables from main.pjs (`motionTail`, `chainPrefix`), with the same values as
// the fallback so the config file tells the truth about what is in use.
const MOTION_TAIL =
  (typeof root !== "undefined" && root.motionTail) ||
  "smooth continuous natural motion, coherent subject, cinematic, high detail, stable";
const CHAIN_PREFIX =
  (typeof root !== "undefined" && root.chainPrefix) || "continuing the same uninterrupted shot, ";
// How long a model that just refused for quota sits out. Short on purpose: the
// allowance is per address and the next run starts from a clean slate, so a
// long bench only ever punished the user for trying again.
const QUOTA_BENCH_S = 60;

/**
 * Below this, a clip is treated as frozen and re-rendered.
 *
 * `clipMotion` returns the share of pixels that changed noticeably between
 * evenly spaced frames, so the scale reads as "how much of the picture moved":
 * a clip that is one repeated frame reads 0.000, a slow drift a few thousandths,
 * and a shot with a person moving in it a few hundredths or more. 0.004 is
 * deliberately conservative — low enough that an unhurried real shot is never
 * thrown away, high enough to catch a dead one. Tune here, not per-provider.
 */
const STATIC_MOTION_FLOOR = 0.004;

/**
 * How far a returned segment's opening frame may sit from the still it was
 * handed before the beat counts as a miss.
 *
 * The storyboard's whole premise is that the model animates the picture it is
 * given. When it instead invents its own shot — a different framing, a different
 * person, or the melted over-exposed frame a bad render produces — the opening
 * frame is nothing like the still, and that is measurable: a real segment
 * differs from its own conditioning frame by a few percent (a little encoder
 * softness and grain), while a segment that threw the still away differs across
 * most of the picture. Measured on the clip that came back with a melted opening
 * second: 90 %+ against the reference still.
 */
const START_DRIFT_MAX = 0.55;

/**
 * How many times one beat may be re-rendered because the clip came back wrong —
 * motionless, blown out, melted, or not the shot it was handed. Each retry is a
 * whole render, so this is deliberately small: two extra tries catch a bad roll
 * or a model that cannot do the beat without turning a four-beat run into an
 * afternoon.
 */
const MAX_BEAT_RETRIES = 2;

/**
 * How far a returned segment's closing frame may sit from the still the beat was
 * aiming at before the beat counts as never having happened.
 *
 * `endDrift` is only measured when the beat was given a target still (the
 * storyboard's next drawn keyframe). A model that ignores it and simply holds
 * the frame it was handed reads very high here — which is the difference between
 * a beat that moved the body *towards* its next state and one that did nothing
 * at all. The bar is deliberately loose: a partial arrival is normal for a
 * pooled model, and only an outright miss is worth a re-render.
 */
const END_DRIFT_MAX = 0.7;

/**
 * The undress timeline, read from the `undressStages` list in main.pjs so it
 * can be edited without touching code. Each entry is one step further than the
 * last: an image-to-video model animates a frame, so "undressing" has to be
 * written as a sequence of moves the body makes, and each stage runs on the
 * last frame of the stage before it.
 */
const UNDRESS_STAGES_FALLBACK = [
  "her hands move slowly over her body, weight shifting, subtle continuous motion",
  "she lifts her top and pulls it up over her head, revealing her bare chest",
  "she unhooks and slips her bra off completely, now topless",
  "she hooks her thumbs into her waistband and slowly slides her bottoms down",
  "now fully nude, she runs her hands over her hips and turns her body",
];

export function undressStages() {
  const raw = typeof root !== "undefined" ? root.undressStages : null;
  // A perchance list is not a plain array: it exposes `selectAll` (each entry is
  // itself a node with `evaluateItem`). Accept a JS array too, so this works the
  // same whether the list came from main.pjs or from a test.
  let items = null;
  if (raw) {
    if (Array.isArray(raw)) items = raw;
    else if (Array.isArray(raw.selectAll)) items = raw.selectAll;
    else if (Array.isArray(raw.items)) items = raw.items;
  }
  const list = (items || UNDRESS_STAGES_FALLBACK)
    .map((s) => String(s && typeof s === "object" ? s.evaluateItem ?? "" : s ?? "").trim())
    .filter(Boolean);
  return list.length ? list : UNDRESS_STAGES_FALLBACK;
}

/** Which undress stage a point in the clip belongs to (0 … stages-1). */
export function undressStageAt(progress, stages) {
  const n = stages?.length || 1;
  const frac = Math.max(0, Math.min(0.9999, Number(progress) || 0));
  return Math.min(n - 1, Math.floor(frac * n));
}

export function composePrompt(o) {
  const parts = [];
  if (o.chain) parts.push(CHAIN_PREFIX.trim());
  const base = (o.prompt || "").trim();
  if (base) parts.push(base);
  if (o.stage) parts.push(o.stage);
  // A run that edits a real picture carries the identity clause so the model
  // keeps the same woman in the same room. Omitted when a `stage` already
  // carries it (the storyboard's `segmentMotion` leads with it), so it can
  // never appear twice in one prompt.
  if (o.anchor && !o.stage) parts.push(FRAME_ANCHOR);
  const angle = CAMERA_ANGLES.find((a) => a.id === o.cameraAngle);
  const move = CAMERA_MOVES.find((m) => m.id === o.cameraMove);
  // Camera words are strictly opt-in (the Studio toggle, off by default): the
  // move itself is performed by the renderer that owns it — the on-device rig,
  // your GPU server, or a trajectory-conditioned model — while naming it in the
  // prompt fights the subject description and degrades the shot.
  if (o.cameraWords === true) {
    if (angle?.phrase) parts.push(angle.phrase);
    if (move?.phrase) parts.push(move.phrase);
  }
  const tracking = (TRACKING_MODES || []).find((t) => t.id === o.tracking);
  if (tracking?.phrase && o.tracking !== "off") {
    const s = Math.max(0, Math.min(1, Number(o.trackStrength) ?? 0.6));
    parts.push(s >= 0.75 ? `${tracking.phrase}, strong smooth tracking` : s <= 0.3 ? `${tracking.phrase}, gentle loose tracking` : tracking.phrase);
  }
  const style = STYLES.find((s) => s.id === o.style);
  if (style?.phrase) parts.push(style.phrase);
  if (o.nsfw) parts.push(NSFW_BOOST);
  parts.push(o.motion || MOTION_TAIL);
  return parts.join(", ");
}

/** The prompt for one segment: rising undress stage, or a plain continuation. */
function segmentPrompt({ composed, chain, progress, stages }) {
  if (!stages || !stages.length) return (chain ? CHAIN_PREFIX : "") + composed;
  const stage = stages[undressStageAt(progress, stages)];
  return (chain ? CHAIN_PREFIX + " " : "") + composed.replace(/, \s*$/, "") + ", " + stage;
}

export function buildNegative(o) {
  let user = o.negative?.trim() || "";
  if (o.nsfw) {
    user = user
      .split(",")
      .map((s) => s.trim())
      .filter((s) => {
        const l = s.toLowerCase();
        if (!l) return false;
        if (/(distorted|unnatural|anatomical anomal|asymmetrical).*(breast|anatomy|body)/.test(l)) return false;
        if (/(breast physics|morphing fabric|wardrobe merging|teleporting clothes)/.test(l)) return false;
        return true;
      })
      .join(", ");
    if (!user) user = DEFAULT_NEGATIVE;
  }
  const parts = [user || DEFAULT_NEGATIVE];
  const style = STYLES.find((s) => s.id === o.style);
  if (style?.negative) parts.push(style.negative);
  if (o.nsfw) parts.push(NSFW_NEGATIVE);
  else parts.push("nsfw, nude, explicit");
  // When the run edits a real picture, the video model is forbidden from
  // re-casting the scene either — otherwise the continuity the keyframes bought
  // is thrown away on the way to the clip (a named place in a prompt is a place
  // a model will build).
  if (o.anchor) parts.push(FRAME_NEGATIVE);
  return parts.join(", ");
}

export function planSegments(total, maxSec, minSec = 0.5) {
  const t = Math.max(0.3, total);
  if (t <= maxSec) return [Math.round(t * 10) / 10];
  let n = Math.ceil(t / maxSec);
  while (n * minSec > t && n > 1) n--;
  const each = t / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(Math.round(each * 10) / 10);
  return out;
}

export function freeProvidersFor(customProviders = []) {
  return [...(customProviders || []), ...PROVIDERS];
}

/**
 * The bench times, read from the `cooldown` list in main.pjs so the tunables
 * there are the real ones (they used to be decorative, which is how a 15-minute
 * `quota` value sat in the config while the engine benched for 5).
 */
export function benchTable() {
  const t = { quota: QUOTA_BENCH_S, busy: 120, paused: 3600, error: 120 };
  try {
    const cfg = typeof root !== "undefined" ? root.cooldown : null;
    for (const k of Object.keys(t)) {
      const n = Number(cfg?.[k]);
      if (Number.isFinite(n) && n >= 0) t[k] = n;
    }
  } catch {}
  return t;
}

/**
 * What to do about a model that just refused.
 *
 *   hop    ask the *same* model again from a different address — the free
 *          allowance is metered per address, so this is often the whole fix.
 *   bench  how long to sit that model out if there is no other address.
 *
 * Pure on purpose: this is the rule that decides whether a second run is even
 * attempted, so it can be exercised directly instead of being inferred from a
 * five-minute network run.
 */
export function retryDecision(kind, tried, addresses, bench = null) {
  const n = Math.max(1, Math.floor(Number(addresses) || 1));
  const t = Math.max(0, Math.floor(Number(tried) || 0));
  const hop = (kind === "quota" || kind === "busy") && t + 1 < n;
  const table = bench || benchTable();
  const secs = Number(table?.[kind]);
  return { hop, bench: Number.isFinite(secs) ? secs : kind === "paused" ? 3600 : 120 };
}

/**
 * Decide which models to try, in order, for this run.
 *
 *   computeMode "offline" -> the on-device rig only
 *   computeMode "server"  -> only the models your own GPU server reports
 *   computeMode "pool"    -> only the free public pool (+ any spaces you added)
 *   computeMode "auto"    -> your server, then the free pool, then the rig
 *
 * The rig is a camera move over one still, so it is left out of an *undress*
 * run: it cannot remove a garment, and handing back a motionless dressed clip
 * for an undress request is the exact failure that made the feature look
 * broken. "Only this device" is an explicit choice, so it still uses the rig —
 * and the result card says what that clip really is.
 */
export function orderProviders(settings, opts, customProviders = [], serverProviders = [], cooldowns = {}, outcomes = null) {
  const mode = settings.computeMode || "auto";
  const { nsfw, hasImage, undress, generators } = opts;
  const fits = (p) => (hasImage ? p.caps.i2v : p.caps.t2v || p.caps.i2v);
  const byQuality = (list) => [...list.filter(fits)].sort((a, b) => (b.quality || 0) - (a.quality || 0));
  const custom = customProviders || [];
  const hasToken = !!(settings.hfToken || "").trim();
  // The free pool is always offered. Without a token a request is anonymous,
  // which the platform allows (2 minutes a day per address, low queue priority)
  // and which address rotation can stretch; a free token just raises the
  // allowance and the priority. Hiding the models without a token made the
  // whole free pool look "disconnected".
  const pool = [...custom, ...PROVIDERS];
  const servers = serverProviders || [];

  let order;
  if (mode === "offline") {
    order = [OFFLINE_PROVIDER];
  } else if (mode === "server") {
    order = byQuality(servers);
  } else if (mode === "pool") {
    order = byQuality(pool);
  } else {
    order = byQuality(servers);
    if (settings.poolEnabled !== false) order = order.concat(byQuality(pool));
    if (settings.offlineFallback !== false && !undress) order.push(OFFLINE_PROVIDER);
  }

  if (nsfw) order.sort((a, b) => Number(!!b.caps.nsfw) - Number(!!a.caps.nsfw));

  // ---- The two generators -------------------------------------------------
  // Each row of the Studio panel owns a slice of the model list, and a row that
  // is switched off contributes nothing. Both on = the union.
  //
  //   NSFW only      every model with an uncensored path (a Space's own
  //                  safe_mode switch, an unfiltered MuAPI endpoint, a keyed
  //                  vendor, the on-device rig) plus your own GPU server, which
  //                  is the one route that can attach the free NSFW LoRA.
  //   Standard only  everything except the models that exist *only* for
  //                  explicit content — so an ordinary clip's Auto ladder can
  //                  never wander onto a dedicated uncensored build, while the
  //                  models that merely *have* an uncensored switch (Wan 2.2
  //                  Preview, your server, the rig) are still offered.
  //
  // This is a filter on the pool, not a separate pipeline: the NSFW *pipeline*
  // (explicit starting frame, storyboard, undress timeline) is gated by the
  // `nsfw` flag, which the app takes from the NSFW row's own switch. Turning the
  // NSFW generator off therefore both removes the uncensored models and turns
  // the whole NSFW pipeline off, which is what "standard video" should mean.
  const genStd = generators ? !!generators.standard?.on : true;
  const genNsfw = generators ? !!generators.nsfw?.on : true;
  const genAllowed = (p) => {
    if (!generators) return true;
    if (!genStd && !genNsfw) return false;
    if (genStd && genNsfw) return true;
    if (genNsfw) return isNsfwCapable(p);
    return !isNsfwOnly(p);
  };

  // ---- The uncensored routing engine --------------------------------------
  // An explicit run is not merely deprioritised away from a model that checks
  // content — it is not offered to it at all. Handing explicit content to a
  // model whose checker will refuse does not just waste the attempt: the
  // refusal *is* the submission, and it is the record of it. Turning on “Try
  // every enabled model” (Settings → Privacy & IP rotation) opts out. See
  // src/router.js for the classification and src/vault.js for the leak guard.
  const explicitOnly = !!nsfw && (settings.nsfwRouting || "strict") !== "widen";
  const allowed = (p) => !leakBlocked(settings, p) && (!explicitOnly || acceptsExplicit(p));

  if (generators) order = order.filter((p) => genAllowed(p) && allowed(p));
  else order = order.filter(allowed);

  // Puter's routes cost nothing but need a one-time sign-in in Puter's own
  // window — so Auto never volunteers one (a login popup mid-run is a nasty
  // surprise). Pick the model by hand and it runs first like any other pick;
  // after one successful Puter render this session, Auto may use it too.
  if (settings.puterOk !== true) order = order.filter((p) => p.kind !== "puter");

  // Models that just refused (spent allowance, timeouts, crashes) go to the back
  // of the queue rather than being tried again on the next run. Your own server
  // and the on-device renderer are never hidden that way.
  const now = Date.now();
  const benched = (p) => {
    const c = cooldowns?.[p.id];
    return !!c && c.until > now;
  };
  const awake = order.filter((p) => !benched(p) || p.kind === "offline" || p.ownServer);
  if (awake.length) order = awake;

  // Multi-image runs prefer multi-ref routes first, then the likeness-anchored
  // LTX identity build (the only free single-image route with face/body locks),
  // then everything else. A hand pick below still overrides this.
  if ((opts?.refCount || 0) >= 1) {
    const score = (p) => (isMultiRef(p) ? 0 : p.id === "ltx23_nsfw" ? 1 : 2);
    order = [...order].sort((a, b) => score(a) - score(b));
  }

  // A route that has genuinely refused content before goes to the back. This is
  // knowledge the app earned from real runs, not a guess from a config file,
  // and it is what stops every run rediscovering the same wall. Never a hard
  // block: a Space that refused yesterday can take the job today, so it is
  // still reachable — just after everything that has a better track record.
  if (outcomes && Object.keys(outcomes).length) {    const demote = (p) => {
      const s = outcomes[p.id];
      return s && Number(s.refused) > 0 && !Number(s.ok) ? 1 : 0;
    };
    order = [...order].sort((a, b) => demote(a) - demote(b));
  }

  // Which model a row pinned (its "Pick a model" mode). Both rows may pin one;
  // then the NSFW row's pick leads — an explicit run wants its uncensored model
  // — with the standard row's pick next and the rest of the union after them, so
  // "Pick a model" on both rows still fails forward instead of dead-ending.
  const picks = [];
  if (generators) {
    if (genNsfw && generators.nsfw?.pick) picks.push(generators.nsfw.pick);
    if (genStd && generators.standard?.pick && !picks.includes(generators.standard.pick)) {
      picks.push(generators.standard.pick);
    }
  }
  const chosen = picks.length ? null : settings.provider;
  if (chosen && chosen !== "auto") {
    const pick = [...servers, OFFLINE_PROVIDER, ...pool, ...KEY_PROVIDERS, ...MUAPI_PROVIDERS].find((p) => p.id === chosen);
    if (pick) {
      if (mode === "offline" && pick.id !== OFFLINE_PROVIDER.id) order = [OFFLINE_PROVIDER];
      // A paid model picked by hand is an explicit, billed choice, so it is
      // honoured even in "only the free pool" / "only my server" mode — the one
      // mode that still overrides it is the on-device one, which contacts
      // nobody at all. (Free providers keep the old behaviour.)
      else if (mode === "server" && !pick.ownServer && pick.tier !== "key") order = byQuality(servers);
      else order = [pick, ...order.filter((p) => p.id !== pick.id)];
    }
  }
  if (picks.length) {
    const all = [...servers, OFFLINE_PROVIDER, ...pool, ...KEY_PROVIDERS, ...MUAPI_PROVIDERS];
    const front = [];
    for (const id of picks) {
      const codec = CODEC_LOCAL.find((x) => x.id === id);
      if (codec) {
        const srv = servers.find((x) => (codec.serverId && x.serverModel === codec.serverId) || String(x.family || "").startsWith(codec.serverFamily));
        if (srv) {
          if (!genAllowed(srv) || !allowed(srv)) continue;
          if (mode === "offline") continue;
          if (!front.includes(srv)) front.push(srv);
          continue;
        }
        const cpu = { id: codec.id, label: `${codec.label} · CPU-native`, kind: "codec-cpu", codec: codec.id, family: codec.serverFamily, maxSec: codec.maxSec, quality: 1, caps: { i2v: true, t2v: false } };
        if (!genAllowed(cpu) || !allowed(cpu)) continue;
        if (!front.some((p) => p.id === cpu.id)) front.push(cpu);
        continue;
      }
      const p = all.find((x) => x.id === id);
      if (!p || !genAllowed(p) || !allowed(p)) continue;
      // Mirror the hand-picked rules just above: offline mode only ever runs
      // the rig, and "only my server" ignores a free pick but honours a billed
      // one. A pick the mode forbids is simply not tried, rather than quietly
      // running something else under its name.
      if (mode === "offline" && p.id !== OFFLINE_PROVIDER.id) continue;
      if (mode === "server" && !p.ownServer && p.tier !== "key") continue;
      if (!front.includes(p)) front.push(p);
    }
    if (front.length) {
      const ids = new Set(front.map((p) => p.id));
      order = [...front, ...order.filter((p) => !ids.has(p.id))];
    }
  }
  // `allowPaidOnAuto` deliberately covers only the three per-vendor APIs whose
  // whole model list you consented to by turning it on. MuAPI's 51 models are
  // billed per generation and are never added here — pick one in the model list
  // and it runs first, then falls back to the free pool like any other failure.
  if (settings.allowPaidOnAuto && KEY_PROVIDERS.some((p) => settings[p.requires])) {
    for (const kp of KEY_PROVIDERS) {
      if (settings[kp.requires]) order.push({ ...kp, keyed: true });
    }
  }
  return order;
}

/**
 * The relay a request *must* go through. Turning a missing relay into a
 * `privacy` error (rather than a raw relay error) means the engine can walk on
 * to the next model — and eventually to the on-device renderer, which contacts
 * nobody — instead of quietly leaking your address.
 */
function privacyRelay(settings, caps, why) {
  try {
    return requiredRelay(settings, caps, why);
  } catch (e) {
    throw new SpaceError(
      e.message,
      "privacy",
      e.message,
      "Turn “Perchance's built-in proxy” back on, or add a relay you control, in Settings → Privacy."
    );
  }
}

/**
 * One request to a paid model's API (Replicate, fal, Runway), relayed when
 * privacy is on — the vendor is a model too, and a poll every second and a half
 * from your own address is exactly the kind of trace this is meant to prevent.
 *
 * This is the one request whose headers carry a credential, so a relay can see
 * the vendor key. That is a smaller exposure than handing the vendor your
 * address on every poll, but it is a real one: prefer a relay you run yourself
 * (Settings → Privacy), or turn this off for keyed runs.
 */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function providerRequest(ctx, url, init = {}, why = "a paid model request") {
  const settings = ctx.settings || {};
  const method = (init.method || "GET").toUpperCase();
  const relay = privacyRelay(settings, method === "POST" ? { get: true, post: true } : { get: true }, why);
  if (relay) {
    const r = await relayFetch(relay, url, init, { untrace: settings.untrace !== false, timeoutMs: 120000 });
    return { status: r.status, ok: r.status >= 200 && r.status < 300, text: r.text };
  }
  const r = await fetch(url, untraceInit(init, settings.untrace !== false));
  return { status: r.status, ok: r.ok, text: await r.text() };
}

export async function pollinationsKeyframe(prompt, size, seed, nsfw, settings = null, negative = "") {
  const [w, h] = size;
  const negText = String(negative || "").trim();
  const q = nsfw ? `${prompt}, uncensored` : prompt;
  const full = negText ? `${q} (avoiding: ${negText})` : q;
  // Pollinations is a model too, so a starting frame drawn there is relayed like
  // everything else when privacy is on.
  const relay = settings ? privacyRelay(settings, { get: true }, "the starting-frame image") : null;
  // It also answers `200` with a zero-byte body when it is throttling (observed
  // live), which is not a real failure — so the same prompt is simply asked
  // again, with the seed stepped so a cached empty answer cannot repeat.
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(full)}?width=${w}&height=${h}&seed=${seed + attempt * 13}&nologo=true&model=flux`;
    try {
      let blob;
      if (relay) {
        blob = await relayBlob(relay, url, { untrace: settings?.untrace !== false, timeoutMs: 120000 });
      } else {
        const r = await fetch(url);
        if (!r.ok) throw new SpaceError("Could not generate a starting frame.", "input");
        blob = await r.blob();
      }
      if (blob?.size > 1024) return await stripWatermark(blob);
      lastErr = new SpaceError("The starting-frame service answered with an empty image.", "empty");
    } catch (e) {
      if (e?.kind === "cancelled") throw e;
      // A relay that refused is worth another address, exactly as elsewhere.
      if (e?.kind === "privacy") throw e;
      lastErr = e;
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
  }
  throw lastErr || new SpaceError("Could not generate a starting frame.", "empty");
}

/**
 * Fetch a finished clip. With privacy on this goes through a relay as well, so
 * the model's file server never learns the visitor's address; the relay that
 * carried the job is tried first so the whole run appears to come from one
 * client. Only in relaxed mode can it fall back to a plain download.
 */
async function downloadClip(url, superFetch, o = {}) {
  const { relay = null, strict = false, settings = null, signal = null } = o;
  const pool = [];
  const seen = new Set();
  for (const r of [relay, ...(strict ? downloadRelays(settings || {}) : [])]) {
    if (r && !seen.has(r.id)) {
      seen.add(r.id);
      pool.push(r);
    }
  }
  let lastErr = null;
  for (const r of pool) {
    try {
      const blob = await relayBlob(r, url, { untrace: settings?.untrace !== false, signal, timeoutMs: 240000 });
      if (blob.size < 2048) throw new SpaceError("Model returned an empty video file.", "empty");
      return blob;
    } catch (e) {
      lastErr = e;
      if (e?.kind === "cancelled") throw e;
    }
  }
  if (strict) {
    throw new SpaceError(
      "The clip finished, but it could not be fetched without revealing your address.",
      "privacy",
      lastErr?.message || "no relay could carry the download",
      "A relay that can carry a few MB is needed to pull the file — Perchance's built-in proxy normally does. Turn it back on, or add a relay you control, in Settings → Privacy."
    );
  }
  const blob = await blobFromUrl(url, superFetch, { proxyOnly: !!relay });
  if (blob.size < 2048) throw new SpaceError("Model returned an empty video file.", "empty");
  return blob;
}

/** What `downloadClip` needs from a segment's context. */
function clipDownload(ctx, url, relay = null) {
  return downloadClip(url, ctx.superFetch, {
    relay,
    strict: ctx.strict === true,
    settings: ctx.settings || null,
    signal: ctx.signal || null,
  });
}

async function runGradioSegment(provider, ctx, onEvent) {
  const base = spaceToHost(provider.space);
  const uploadBlobFn = async (blob, name) => {
    onEvent({ type: "stage", stage: "uploading", message: "Uploading reference frame…" });
    const settings = ctx.settings || {};
    const relay = privacyRelay(settings, { post: true, upload: true }, "the reference-frame upload");
    let body = blob;
    let fname = name;
    if (relay?.maxBody && body.size > relay.maxBody) {
      // Too big for the relay to carry means it would have to go out from your
      // own address — so it is re-encoded until it fits instead.
      body = await shrinkToFit(body, relay.maxBody);
      fname = String(name || "input.png").replace(/\.\w+$/, "") + ".jpg";
    }
    if (relay) onEvent({ type: "relay", used: relay, provider: `${provider.label} upload` });
    return await uploadBlob(base, body, fname, ctx.hfToken, {
      relay,
      untrace: settings.untrace !== false,
    });
  };
  const buildCtx = {
    image: ctx.imageBlob,
    endImage: ctx.endImage || null,
    refExtras: Array.isArray(ctx.refExtras) && ctx.refExtras.length
      ? ctx.refExtras
      : (ctx.extraBlobs || []).map((blob, i) => ({ blob, slot: "extra", label: (ctx.extraLabels || [])[i] || "extra" })),
    // The driving clip for a character-animation model (Wan Animate and
    // friends): the clip whose movement is copied onto `image`. Only the
    // motion providers read it, and they are only queued when it exists.
    drivingVideo: ctx.drivingVideo || null,
    drivingPrompt: ctx.drivingPrompt || "",
    prompt: ctx.prompt,
    negative: ctx.negative,
    duration: ctx.duration,
    seed: ctx.seed,
    steps: ctx.steps,
    size: ctx.size,
    nsfw: ctx.nsfw !== false,
    cameraScope: ctx.cameraScope,
    motionScale: ctx.motionScale,
    uploadBlob: uploadBlobFn,
  };
  const built = await provider.build(buildCtx);
  let data = built.data;
  if (built.named) {
    // The adapter named its values, so ask the Space what its parameters are
    // *now* and lay them out to match. A Space that grew a slider since the
    // adapter was written still works.
    const params = await spaceParams(base, provider.endpoint, {
      relay: privacyRelay(ctx.settings || {}, { get: true }, "the model's parameter list"),
      untrace: ctx.settings?.untrace !== false,
      token: ctx.hfToken,
    });
    data = params ? alignData(params, built.named) : Object.values(built.named);
  }
  onEvent({ type: "stage", stage: "queued", message: `${provider.label}: requesting compute…` });
  const res = await callEndpoint(base, provider.endpoint, data, {
    token: ctx.hfToken,
    signal: ctx.signal,
    controller: ctx.controller,
    timeoutMs: ctx.segmentTimeoutMs,
    settings: ctx.settings,
    repo: ctx.spaceRepo,
    onStage: (stage, info) => {
      if (stage === "relaying") {
        onEvent({ type: "relay", ...info, provider: provider.label });
        return;
      }
      if (info?.elapsed != null) {
        onEvent({
          type: "tick",
          elapsed: info.elapsed,
          progress: info.progress,
          message: stage === "running" ? `${provider.label}: generating…` : "",
        });
      }
    },
  });
  if (res.relay) onEvent({ type: "relay", used: res.relay, provider: provider.label });
  onEvent({ type: "stage", stage: "downloading", message: "Downloading result…" });
  const blob = await clipDownload(ctx, res.url, res.relay || null);
  return { blob, seed: res.seed, provider };
}

async function runReplicateSegment(provider, ctx, onEvent) {
  const token = ctx.settings.replicateToken;
  const modelId = ctx.keyModel || provider.models[0].id;
  const [owner, name] = modelId.split("/");
  const input = {
    prompt: ctx.prompt,
    negative_prompt: ctx.negative,
    seed: ctx.seed,
    duration: Math.round(ctx.duration),
    num_frames: Math.round(ctx.duration * 16),
    aspect_ratio: ctx.aspect,
    resolution: ctx.quality === "480p" ? "480p" : "720p",
    disable_safety_checker: !!ctx.nsfw,
  };
  if (ctx.imageUrl) input.image = ctx.imageUrl;
  else if (ctx.imageDataUrl) input.image = ctx.imageDataUrl;
  const r = await providerRequest(
    ctx,
    `https://api.replicate.com/v1/models/${owner}/${name}/predictions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "wait" },
      body: JSON.stringify({ input }),
      signal: ctx.signal,
    },
    "the Replicate request"
  );
  let j = parseJson(r.text) || {};
  if (!r.ok) throw new SpaceError(j?.detail || `Replicate error (${r.status})`, "error");
  const getUrl = j.urls?.get;
  let waited = 0;
  while (j.status && !["succeeded", "failed", "canceled"].includes(j.status)) {
    if (waited > 900) throw new SpaceError("Replicate timed out.", "timeout");
    await new Promise((res) => setTimeout(res, 1500));
    waited += 1.5;
    onEvent({ type: "tick", elapsed: waited * 1000 });
    const rr = await providerRequest(
      ctx,
      getUrl,
      { headers: { Authorization: `Bearer ${token}` }, signal: ctx.signal },
      "the Replicate status poll"
    );
    j = parseJson(rr.text) || {};
  }
  if (j.status !== "succeeded") throw new SpaceError(j.error || "Replicate run failed.", "error", String(j.error || ""));
  const out = Array.isArray(j.output) ? j.output[0] : j.output;
  return { blob: await clipDownload(ctx, typeof out === "string" ? out : out?.url), seed: ctx.seed, provider };
}

async function runFalSegment(provider, ctx, onEvent) {
  const key = ctx.settings.falKey;
  const modelId = ctx.keyModel || provider.models[0].id;
  const input = {
    prompt: ctx.prompt,
    negative_prompt: ctx.negative,
    seed: ctx.seed,
    duration: String(Math.round(ctx.duration)),
    aspect_ratio: ctx.aspect,
    enable_safety_checker: !ctx.nsfw,
  };
  if (ctx.imageUrl) input.image_url = ctx.imageUrl;
  const r = await providerRequest(
    ctx,
    `https://queue.fal.run/${modelId}`,
    {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: ctx.signal,
    },
    "the fal.ai request"
  );
  const j = parseJson(r.text) || {};
  if (!r.ok) throw new SpaceError(j?.detail || j?.error || `fal.ai error (${r.status})`, "error");
  const statusUrl = j.status_url || `https://queue.fal.run/${modelId}/requests/${j.request_id}/status`;
  const respUrl = j.response_url || `https://queue.fal.run/${modelId}/requests/${j.request_id}`;
  let waited = 0;
  while (waited < 900) {
    await new Promise((res) => setTimeout(res, 1500));
    waited += 1.5;
    onEvent({ type: "tick", elapsed: waited * 1000 });
    const sr = await providerRequest(
      ctx,
      statusUrl,
      { headers: { Authorization: `Key ${key}` }, signal: ctx.signal },
      "the fal.ai status poll"
    );
    const sj = parseJson(sr.text) || {};
    if (sj.status === "COMPLETED") break;
    if (sj.status === "FAILED" || sj.status === "ERROR") throw new SpaceError("fal.ai run failed.", "error", JSON.stringify(sj).slice(0, 300));
  }
  const rr = await providerRequest(ctx, respUrl, { headers: { Authorization: `Key ${key}` }, signal: ctx.signal }, "the fal.ai result");
  const rj = parseJson(rr.text) || {};
  const url = rj?.video?.url || rj?.video_url || rj?.output?.video?.url || (Array.isArray(rj?.videos) ? rj.videos[0]?.url : null);
  if (!url) throw new SpaceError("fal.ai returned no video.", "empty", JSON.stringify(rj).slice(0, 300));
  return { blob: await clipDownload(ctx, url), seed: ctx.seed, provider };
}

async function runRunwaySegment(provider, ctx, onEvent) {
  const key = ctx.settings.runwayKey;
  const model = ctx.keyModel || provider.models[0].id;
  const body = {
    model,
    promptImage: ctx.imageDataUrl || ctx.imageUrl,
    promptText: ctx.prompt,
    ratio: ctx.aspect === "9:16" ? "720:1280" : "1280:720",
    duration: Math.max(5, Math.min(10, Math.round(ctx.duration))),
    seed: ctx.seed,
  };
  const r = await providerRequest(
    ctx,
    "https://api.dev.runwayml.com/v1/image_to_video",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Runway-Version": "2024-11-06",
      },
      body: JSON.stringify(body),
      signal: ctx.signal,
    },
    "the Runway request"
  );
  const j = parseJson(r.text) || {};
  if (!r.ok) throw new SpaceError(j?.error || `Runway error (${r.status})`, "error", j?.error || "");
  const id = j.id;
  let waited = 0;
  let out = null;
  while (waited < 900) {
    await new Promise((res) => setTimeout(res, 2000));
    waited += 2;
    onEvent({ type: "tick", elapsed: waited * 1000 });
    const tr = await providerRequest(
      ctx,
      `https://api.dev.runwayml.com/v1/tasks/${id}`,
      { headers: { Authorization: `Bearer ${key}`, "X-Runway-Version": "2024-11-06" }, signal: ctx.signal },
      "the Runway status poll"
    );
    const tj = parseJson(tr.text) || {};
    if (tj.status === "SUCCEEDED") {
      out = Array.isArray(tj.output) ? tj.output[0] : tj.output;
      break;
    }
    if (["FAILED", "CANCELLED"].includes(tj.status)) throw new SpaceError(tj.failure || "Runway task failed.", "error");
  }
  if (!out) throw new SpaceError("Runway timed out.", "timeout");
  return { blob: await clipDownload(ctx, out), seed: ctx.seed, provider };
}

/**
 * One segment on a paid MuAPI endpoint. The client (src/muapi.js) submits the
 * job, polls it and hands back the finished clip's URL; fetching the file stays
 * here so it follows the same privacy rules as every other model's download.
 */
async function runMuapiSegment(provider, ctx, onEvent) {
  const res = await muapiRun(provider.model, ctx, onEvent);
  onEvent({ type: "stage", stage: "downloading", message: "Downloading result…" });
  const blob = await clipDownload(ctx, res.url);
  return { blob, seed: res.seed, provider, meta: res.meta };
}

async function runOfflineSegment(provider, ctx, onEvent) {
  onEvent({ type: "stage", stage: "rendering", message: "Rendering a camera move over your still, on this device — no model involved…" });
  const res = await renderMotionClip({
    image: ctx.imageBlob,
    duration: ctx.duration,
    width: ctx.size?.[0] ?? 832,
    height: ctx.size?.[1] ?? 480,
    fps: ctx.fps || 30,
    cameraMove: ctx.cameraMove,
    cameraAngle: ctx.cameraAngle,
    tracking: ctx.tracking || "off",
    trackStrength: ctx.trackStrength ?? 0.6,
    motionScale: ctx.motionScale,
    signal: ctx.signal,
    onProgress: (frac, message) =>
      onEvent({ type: "tick", elapsed: Date.now() - ctx.startedAt, progress: frac, message }),
  });
  return {
    blob: res.blob,
    seed: ctx.seed,
    provider,
    meta: { width: res.width, height: res.height, duration: res.duration, fps: res.fps, encoder: res.encoder },
    lastFrame: res.lastFrame,
    frames: res.frames,
  };
}

async function runCodecCpuSegment(provider, ctx, onEvent) {
  onEvent({ type: "stage", stage: "rendering", message: `${provider.label}: encoding your still to .soma and rendering on this device's CPU — no server, no queue…` });
  const { codecVideoClip } = await import("./codec-generate.js");
  const res = await codecVideoClip({
    imageBlob: ctx.imageBlob,
    prompt: ctx.prompt,
    family: provider.family || "wan",
    duration: ctx.duration,
    fps: 12,
  });
  let lastFrame = ctx.imageBlob || null;
  try {
    const { extractFrame } = await import("./video.js");
    const lf = await extractFrame(res.blob);
    if (lf) lastFrame = lf;
  } catch {}
  return {
    blob: res.blob,
    seed: ctx.seed,
    provider,
    meta: { width: 1280, height: 720, duration: ctx.duration, fps: res.meta.fps, encoder: res.meta.encoder, codec: res.meta.codec },
    lastFrame,
    frames: null,
  };
}

async function runServerSegment(provider, ctx, onEvent) {
  onEvent({ type: "stage", stage: "queued", message: `${provider.label}: asking your GPU server…` });
  const res = await serverGenerate(
    provider.serverBase,
    provider,
    ctx,
    onEvent,
    ctx.signal,
    ctx.settings?.serverToken
  );
  return { blob: res.blob, seed: res.seed, provider, meta: res.meta };
}

async function runPuterSegment(provider, ctx, onEvent) {
  onEvent({ type: "stage", stage: "queued", message: "Puter video: signing in once in Puter's window if needed, then filming…" });
  let res = null;
  try {
    const { puterVideo } = await import("./puter.js");
    res = await puterVideo({
      prompt: ctx.prompt,
      seconds: ctx.duration,
      imageBlob: ctx.imageBlob,
      signal: ctx.signal,
      onStage: (m) => onEvent({ type: "log", text: `Puter video · ${m}` }),
    });
  } catch (e) {
    if (e?.kind === "cancelled") throw e;
    throw new SpaceError(`Puter video could not film this beat (${e?.message || e})`, "empty");
  }
  onEvent({ type: "stage", stage: "downloading", message: "Downloading result…" });
  const blob = res?.blob;
  if (!blob || !blob.size) throw new SpaceError("Puter video returned an empty file", "empty");
  let meta = { duration: ctx.duration };
  try {
    const p = await probe(blob);
    if (p) meta = { width: p.width || 0, height: p.height || 0, duration: p.duration || ctx.duration, fps: p.fps || 0 };
  } catch {}
  if (res.usedImage === false && ctx.imageBlob) {
    onEvent({ type: "log", level: "warn", text: "Puter video rendered from the prompt alone — this route did not take the reference frame." });
  }
  try {
    if (ctx.settings) ctx.settings.puterOk = true;
  } catch {}
  return { blob, seed: ctx.seed, provider, meta };
}

/**
 * Portrait size the character-animation Spaces work at. A full-body figure has
 * to be tall, and the Spaces resize whatever they are handed to this shape — so
 * a landscape reference would come back stretched, which is very literally
 * "the figure is not properly drawn". Storyboard frames and the driver are
 * therefore drawn at this shape when motion transfer is in play.
 */
const MOTION_SIZE = [480, 848];

/**
 * Draw a still, look at it, and draw again until one is a whole figure.
 *
 * "The figure is not properly drawn" is not something a video model can be
 * prompted out of: it animates the picture it is handed. So the picture is
 * checked here (see src/figure.js) and a still that is cropped at the knees,
 * half out of frame or too far away to have a body at all is thrown away and
 * drawn again — wider each time, because distance is what pulls the feet back
 * into shot. The best-scoring candidate is returned even when none passes, so
 * a stubborn model costs an attempt, never the run.
 */
async function drawVerifiedFigure({ size, seed, ctx, onEvent, base, nsfw = false, tries = 3, label = "the figure" }) {
  const [w, h] = size;
  let best = null;
  for (let i = 0; i < tries; i++) {
    if (ctx.signal?.aborted) break;
    const text = typeof base === "function" ? base(i) : i > 0 ? `${base}, ${FULL_FIGURE_HINT}` : base;
    let blob = null;
    try {
      blob = await pollinationsKeyframe(text, [w, h], seed + i * 7717, nsfw, ctx.settings, ctx.negative || "");
    } catch (e) {
      if (e?.kind === "cancelled") throw e;
    }
    if (!blob) {
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }
    const verdict = await analyzeFigure(blob).catch(() => null);
    if (!best || (verdict?.score ?? 0) > (best.verdict?.score ?? 0)) best = { blob, verdict, try: i };
    if (verdict?.ok || verdict?.checked === false) break;
    onEvent?.({
      type: "log",
      level: "warn",
      text: `${label} was not a whole figure (${verdict?.reason || "unclear"}) — drawing it again, further back.`,
    });
    await new Promise((r) => setTimeout(r, 900));
  }
  return best;
}

/**
 * Make the driving clip for one beat.
 *
 * A plain, fully-clothed actor is drawn (and checked for a whole figure, since
 * a cropped actor drives a cropped performance) and then animated with the
 * beat's *movement only* (src/motion.js strips the nudity out of the prompt
 * before it is sent). The completed clip is what a character-animation model
 * copies: its joint-for-joint movement becomes our character's movement, and
 * the actor's face becomes hers. The nudity in the run comes from the
 * storyboard keyframe that is being animated, never from the driver — which is
 * both what makes the transfer safe to ask a free Space for, and what makes the
 * undress land.
 *
 * The clip itself is checked for actual movement and re-filmed once if it came
 * back frozen: a frozen driver would copy that frozenness onto her, which is
 * the exact failure this whole path exists to fix.
 *
 * Returns a Blob, or null when no driver could be made (no suitable model, the
 * free allowance is gone, ...). A null driver is not an error: the engine falls
 * back to the ordinary chain for that beat.
 */
async function makeDriverClip({ rung, duration, provider, seed, ctx, onEvent }) {
  const [w, h] = MOTION_SIZE;
  const still = await drawVerifiedFigure({
    size: MOTION_SIZE,
    seed,
    ctx,
    onEvent,
    base: (i) => driverStillPrompt(i),
    label: "the motion reference",
  });
  if (!still?.blob) return null;
  if (still.verdict?.checked && !still.verdict.ok) {
    onEvent?.({
      type: "log",
      level: "warn",
      text: `Motion reference: using the best figure drawn (${still.verdict.reason}).`,
    });
  } else if (still.verdict?.checked) {
    onEvent?.({ type: "log", text: `Motion reference: whole figure verified (candidate ${still.try + 1}).` });
  }
  const base = driverClipPrompt(rung);
  let best = null;
  for (let tries = 0; tries < 2; tries++) {
    const driverCtx = {
      imageBlob: still.blob,
      endImage: null,
      prompt:
        tries > 0
          ? `${base}, strong clear whole-body movement, big steps, arms swinging, she turns and moves a lot, the whole body is moving`
          : base,
      negative: DEFAULT_NEGATIVE,
      duration,
      seed: seed + tries * 991,
      steps: ctx.steps,
      size: [w, h],
      aspect: ctx.aspect,
      quality: ctx.quality,
      nsfw: false,
      motionScale: 1,
      hfToken: ctx.hfToken,
      signal: ctx.signal,
      controller: ctx.controller,
      superFetch: ctx.superFetch,
      publicUpload: ctx.publicUpload,
      strict: ctx.strict,
      settings: ctx.settings,
      spaceRepo: provider.repo || HF_ENDPOINT_IDS[provider.id] || null,
      startedAt: ctx.startedAt,
      estSecs: provider.estSecs,
      fps: provider.fps || 16,
      keyModel: ctx.keyModel,
      imageDataUrl: null,
      endImageDataUrl: null,
      imageUrl: null,
      segmentTimeoutMs: 900000,
    };
    let res = null;
    try {
      res = await runSegment(provider, driverCtx, onEvent);
    } catch (e) {
      if (e?.kind === "cancelled") throw e;
      onEvent?.({ type: "log", level: "warn", text: `The driving clip could not be filmed (${e.message}).` });
      break;
    }
    const blob = res?.blob || null;
    if (!blob) continue;
    best = blob;
    if (provider.kind === "offline") break;
    const m = await withTimeout(clipMotion(blob, { samples: 6 }), 20000).catch(() => null);
    if (!m || m.motion >= STATIC_MOTION_FLOOR) break;
    onEvent?.({
      type: "log",
      level: "warn",
      text: "The driving clip came back almost motionless — filming it again with the movement told harder.",
    });
  }
  return best;
}

function runSegment(provider, ctx, onEvent) {
  switch (provider.kind) {
    case "replicate":
      return runReplicateSegment(provider, ctx, onEvent);
    case "fal":
      return runFalSegment(provider, ctx, onEvent);
    case "runway":
      return runRunwaySegment(provider, ctx, onEvent);
    case "muapi":
      return runMuapiSegment(provider, ctx, onEvent);
    case "offline":
      return runOfflineSegment(provider, ctx, onEvent);
    case "codec-cpu":
      return runCodecCpuSegment(provider, ctx, onEvent);
    case "puter":
      return runPuterSegment(provider, ctx, onEvent);
    case "server":
      return runServerSegment(provider, ctx, onEvent);
    default:
      return runGradioSegment(provider, ctx, onEvent);
  }
}

export async function generate(o) {
  const {
    settings,
    image,
    extras = [],
    prompt,
    negative,
    cameraMove,
    cameraAngle,
    tracking = "off",
    trackStrength = 0.6,
    style,
    nsfw,
    aspect,
    quality,
    duration: rawDuration,
    onEvent = () => {},
    controller,
    repaintBox = null,
    repaintWant = "all",
    repaintAuto = true,
    publicUpload = null,
    fps = null,
    undress = false,
    resume = null,
  } = o;
  const signal = controller?.signal;
  const started = Date.now();
  const emit = (e) => onEvent({ ...e, elapsed: Date.now() - started });

  // Sub-second units (ms/µs/ns) can ask for less than one frame. A clip cannot
  // hold less than a single frame at the run's rate, so the floor is one frame
  // here and the timeline trims to exactly what was asked where it can.
  const runFps = Number(fps) || 24;
  const duration = Math.max(Number(rawDuration) || 5, 1 / runFps);

  const refExtras = Array.isArray(extras) ? extras.filter((e) => e && e.blob) : [];
  const refHint = refExtras.length
    ? `, reference-guided: match ${refExtras.map((e) => `the ${String(e.hint || e.label || e.slot || "reference").toLowerCase()} from the ${String(e.label || e.slot || "reference")} reference image`).join(", ")}`
    : "";
  const promptWithRefs = `${prompt || ""}${refHint}`.trim();

  // Mint this run's anonymous token. Every file uploaded after this point is
  // renamed with it (src/anon.js → `freshName` in src/providers.js), so no two
  // runs arrive at a model under the same filename.
  newRunNonce();

  const superFetch = typeof root !== "undefined" ? root.superFetch : null;
  const hfToken = settings.hfToken?.trim() || "";
  const seed = Number.isFinite(Number(o.seed)) && String(o.seed).length ? Math.floor(Number(o.seed)) : Math.floor(Math.random() * 1e9);

  // ---- What kind of request is this, and where may it go? -----------------
  // The content tier decides which routes an explicit run is allowed to reach
  // (src/router.js); the leak guard decides whether a route may publish
  // anything at all (src/vault.js). Both are decided here, on this device —
  // nothing is sent anywhere in order to classify anything.
  const frameMode = settings.nsfwFrame || "auto";
  const reqTier = classifyRequest({ prompt, negative, nsfw, undress, frameMode });
  const outcomes = o.outcomes || routeStatsSync();
  // A run whose whole point is to send the photo to a third party cannot run in
  // “nothing leaves this device” mode. Say so plainly rather than sending it.
  const blockedStep = frameStepBlocked(settings, { frameMode, hasImage: !!image });
  if (blockedStep) throw new SpaceError(blockedStep, "input");
  const pickedId = o.generators?.nsfw?.pick || o.generators?.standard?.pick || "";
  if (settings.leakGuard !== false && pickedId.startsWith("muapi:")) {
    emit({
      type: "log",
      level: "warn",
      text:
        "Leak guard: MuAPI will not accept a data: URL, so it needs your reference frame published to a public upload URL. " +
        "This run will not use it. Turn the leak guard off in Settings → Privacy & IP rotation if you accept that.",
    });
  }

  // The storyboard is the *backend* timeline behind an undress run: the rung
  // ladder in main.pjs is turned into keyframe pictures, and the clip is the
  // motion between them (see src/storyboard.js). It is not a UI feature — the
  // user only ever sees the finished clip — and it is on whenever an undress
  // run is asked for, because a video model cannot undress anyone on its own.
  // ---- Picking up a run that stopped part-way ----------------------------
  // A run that ran out of allowance (or was stopped) can be continued rather
  // than restarted: the clips it already rendered are carried in, so the chain
  // continues from the frame it actually reached, and the storyboard's drawn
  // keyframes come back with it so resuming never pays for them twice. The
  // user's own reference picture is still the identity anchor in every prompt
  // (see `composePrompt({anchor})` below), which is what keeps her *her* across
  // the join — the continuation starts from the last frame, but it is still
  // anchored to the picture the run began with.
  const resumeClips = Array.isArray(resume?.clips) ? resume.clips.filter(Boolean) : [];
  const resumeFrames =
    Array.isArray(resume?.storyFrames) && resume.storyFrames.length ? resume.storyFrames.filter((e) => e && e[1]) : null;
  const resuming = !!(resumeClips.length || resume?.lastFrame);
  const storyboardMode = !!nsfw && !!(o.storyboard ?? undress) && !(resuming && !resumeFrames);
  const rungs = storyboardMode ? readStoryboard() : null;
  // Motion transfer: instead of asking a video model to *invent* the movement
  // (which is how a body ends up not moving), copy a real person's movement —
  // and their facial expression — onto each storyboard keyframe. See src/motion.js.
  let motionOn = !!rungs && motionEnabled(settings, { storyboard: storyboardMode, undress });
  const mtOpts = motionOn ? motionOptions() : null;

  let imageBlob = image;
  const offlineOnly = (settings.computeMode || "auto") === "offline";
  if (!imageBlob && prompt?.trim() && !offlineOnly) {
    emit({ type: "stage", stage: "keyframe", message: "No reference image — drawing a starting frame…" });
    const [kw, kh] = dimsFor(aspect, quality, null);
    // The frame a storyboard starts from is the person *dressed* — the rungs
    // take it from there. A naked starting frame is the one thing that would
    // make the ladder pointless.
    const first = storyboardMode && rungs?.length ? beatPrompt(rungs[0], { base: prompt.trim(), withAction: false }) : prompt.trim();
    // When motion transfer is in play the starting frame has to be a whole
    // standing figure in portrait at the size the character-animation model
    // renders at — a cropped start figure becomes a cropped clip, and a
    // landscape one comes back stretched. So it is drawn, checked, and drawn
    // again until the figure is whole (src/figure.js).
    const [fw, fh] = motionOn ? MOTION_SIZE : [kw, kh];
    if (motionOn) {
      const picked = await drawVerifiedFigure({
        size: [fw, fh],
        seed,
        ctx: { settings, signal, negative },
        onEvent: (e) => emit(e),
        base: first,
        nsfw,
        label: "the starting frame",
      });
      imageBlob = picked?.blob || (await pollinationsKeyframe(first, [fw, fh], seed, nsfw, settings, negative));
    } else {
      imageBlob = await pollinationsKeyframe(first, [fw, fh], seed, nsfw, settings, negative);
    }
  }
  if (!imageBlob) {
    throw new SpaceError(
      offlineOnly
        ? "Offline mode renders your own picture, so it needs a reference image — drop one in."
        : "Add a reference image or type a prompt to create one.",
      "input"
    );
  }

  // ---- Where may this run go? --------------------------------------------
  // The order is worked out *here*, before the picture steps, for two reasons.
  // An empty order should fail before anything expensive is paid for; and the
  // free pool's allowance (below) decides whether those steps are worth taking
  // at all.
  let order = orderProviders(
    settings,
    { nsfw, duration, hasImage: true, undress, generators: o.generators || null, refCount: refExtras.length },
    o.customProviders || [],
    o.serverProviders || [],
    o.cooldowns || {},
    outcomes
  );
  if (!order.length) {
    const gens = o.generators || null;
    if (gens && !gens.standard?.on && !gens.nsfw?.on) {
      throw new SpaceError(
        "Both generators are switched off — turn the Standard generator or the NSFW generator back on (the two switches at the top of the Model section).",
        "input"
      );
    }
    const mode = settings.computeMode || "auto";
    const routedOut =
      nsfw && (settings.nsfwRouting || "strict") !== "widen"
        ? " An explicit run is only sent to routes that accept it, so the ordinary models — the ones with a content check — were skipped on purpose. Your own GPU server and the dedicated uncensored builds are the routes that take it (Settings → Privacy & IP rotation can widen the net, at the cost of submitting explicit content to services that check)."
        : "";
    const which =
      gens && !gens.standard?.on
        ? " The Standard generator is switched off, so only the uncensored models were tried."
        : gens && !gens.nsfw?.on
        ? " The NSFW generator is switched off, so the uncensored models were left out."
        : "";
    const msg =
      mode === "server"
        ? "Your GPU server did not report any usable model for this generator. Open Settings → Where the rendering happens and press Test." + which + routedOut
        : mode === "pool"
        ? "No free model can take this request right now. Add a free Hugging Face token in Settings → Free GPU boost — it raises the allowance a lot and moves you up the queue — a free token raises the allowance, or switch the compute mode to Auto or Only this device." + which + routedOut
        : undress
        ? "Nothing can render an undress run right now. The on-device rig was deliberately not used — it is a camera move over one still, so it cannot undress anyone. Connect your GPU server or add a free Hugging Face token (Settings → Free GPU boost), or pick “Only this device” if you would accept a camera move instead." + which + routedOut
        : "Nothing can render this request right now — connect your GPU server, add a free Hugging Face token, or re-enable the on-device renderer, in Settings → Where the rendering happens." + which + routedOut;
    let msgOut = msg;
    if (settings.communityOptIn === true) msgOut += " " + poolFailMessage(settings);
    throw new SpaceError(msgOut, "input");
  }

  // ---- Is there anything left that can render this? -----------------------
  // The free pool is ZeroGPU. Its allowance is metered per identity — against
  // the Hugging Face account a token belongs to, against the address otherwise
  // — and an exhausted *account* refuses every free Space at once, from every
  // address, until the day rolls over. So once this page has seen that refusal
  // with a token in play, no amount of walking the free pool ends in a clip.
  //
  // The steps below are the expensive half of an NSFW run: a free image queue
  // measured in minutes, plus the storyboard's stills. They exist only to feed
  // a video model. Spending them and then falling through to the on-device rig
  // — a camera move over one still — is the worst of both worlds, and it is
  // exactly what "it cannot generate, it only makes a fixed image with motion"
  // looks like from the outside. So: stop now, and say what is actually wrong
  // and what the ways out are.
  {
    // Read the refusal from this page, or from the last one (a page reload is
    // not a fresh allowance). The window is deliberately short — an instant
    // refusal can also mean "every shared GPU is busy" rather than "spent", and
    // this must not turn a two-minute queue into a twenty-minute lockout. It
    // only has to outlast the picture steps it is there to skip.
    const blocked = await loadZeroGpuBlock();
    const recent = blocked && Date.now() - blocked.at < 20 * 60000;
    const renderers = order.filter((p) => p.kind !== "offline");
    const onlyFreeSpaces = renderers.length > 0 && renderers.every((p) => p.kind === "gradio" && !p.ownServer);
    // With a token the allowance belongs to the account, so no other address
    // can answer it. Without one it is per address — and with only one address
    // configured there is nothing else to ask either.
    const noWayRound = !!blocked?.withToken || rotatableCount(settings) <= 1;
    // And only when there is real work to skip. The picture steps are what this
    // is protecting; a run that needs no starting frame and no storyboard is
    // one cheap request, and blocking *that* would be trading a possible retry
    // for nothing.
    const pictureWork = (storyboardMode && rungs?.length) || (!storyboardMode && nsfw && frameMode !== "off" && frameMode !== "image" && frameMode !== "given");
    if (recent && onlyFreeSpaces && noWayRound && pictureWork && (blocked.withToken ? !!hfToken : true)) {
      emit({
        type: "log",
        level: "warn",
        text:
          (blocked.withToken
            ? "every free model refused the last job instantly: your Hugging Face account's ZeroGPU allowance is spent, and no address change brings it back until the day rolls over."
            : "every free model refused the last job instantly, and this run has no second address to ask.") +
          " Stopping before the picture steps rather than after them — they would cost minutes of the free image queue and still end in a camera move over the still. Pressing Generate again later is free.",
      });
      throw new SpaceError(
        blocked.withToken
          ? "Nothing free can render this run: your Hugging Face account's free GPU allowance is spent."
          : "Nothing free can render this run: this address's free GPU allowance is spent.",
        "quota",
        blocked.withToken
          ? "ZeroGPU meters its daily allowance against the account the token belongs to, so with a token every free Space refuses at once — from every address — and nothing the app can do brings it back before the daily reset. (An instant empty refusal can also mean every shared GPU is busy, in which case this clears by itself.)"
          : "Without a token the allowance is metered per address, and the app has only one address to ask from — the relay's, or yours. Every free Space is a ZeroGPU Space, so they all refuse together. (An instant empty refusal can also mean every shared GPU is busy, in which case this clears by itself.)",
        blocked.withToken
          ? "Ways out, best first: (1) run the free GPU server — Settings → Where the rendering happens → free Colab T4 — which has no allowance at all and is the only free route that can render an uncensored clip; (2) clear the Hugging Face token and turn strict privacy off, so requests are metered to your own address's 2-minute anonymous share instead of the relay's spent one; (3) add a relay or switch your VPN for a genuinely different address; (4) wait for the daily reset. “Only this device” always works, but it is a camera move over one still, not a generated video."
          : "Ways out, best first: (1) run the free GPU server — Settings → Where the rendering happens → free Colab T4 — which has no allowance at all; (2) step to a different address: add a Cloudflare Worker relay or switch your VPN (Settings → Privacy & IP rotation) — while strict privacy is on, anonymous calls leave from the relay's shared address, which is usually spent, so a relay of your own or strict privacy off is what actually changes it; (3) wait for the daily reset. “Only this device” always works, but it is a camera move over one still, not a generated video."
      );
    }
  }

  // ---- NSFW starting frame -------------------------------------------------
  // An image-to-video model animates the frame it is handed — it does not
  // undress anyone. So when NSFW is on the frame has to be explicit *before*
  // any renderer sees it, otherwise "spent GPU quota → on-device rig" returns a
  // clip of a fully dressed person, which is what "not working" looks like.
  // Both services used here are free and outside Hugging Face (see src/nsfw.js).
  if (storyboardMode) {
    emit({
      type: "log",
      text:
        `Storyboard: ${rungs.length} rungs planned — the frame she starts in is kept as it is and the rungs draw ` +
        `the rest (pose, face and clothing change in the pictures, not just in the prompt).`,
    });
  }
  if (!storyboardMode && nsfw && (settings.nsfwFrame || "auto") !== "off" && (settings.nsfwFrame || "auto") !== "image" && (settings.nsfwFrame || "auto") !== "given") {
    const onNsfwStage = (e) => emit({ type: "stage", stage: "nsfw", message: e.message, notice: !!e.notice });
    try {
      const relayFor = (cap) =>
        privacyRelay(settings, cap === "post" ? { post: true } : { get: true }, "the NSFW starting frame");
      const [fw, fh] = dimsFor(aspect, quality, null);
      const prepared = await prepareExplicitFrame({
        image: imageBlob,
        prompt: prompt?.trim() || "",
        size: [fw, fh],
        seed,
        mode: settings.nsfwFrame || "auto",
        key: settings.hordeKey || "",
        relayFor,
        signal,
        onStage: onNsfwStage,
        strictPrivacy: privacyStrict(settings),
        box: repaintBox,
        want: repaintWant,
        useSegmentation: repaintAuto !== false,
        negative,
      });
      if (prepared?.blob) {
        imageBlob = prepared.blob;
        emit({ type: "log", text: `NSFW frame → ${prepared.by}: ${prepared.note}` });
      }
    } catch (e) {
      if (e?.kind === "cancelled" || e?.fatal) throw e;
      emit({ type: "log", text: `NSFW frame: ${e.message} — using the reference image as it is`, level: "warn" });
    }
  }

  // Motion transfer copies a whole standing figure's movement joint for joint,
  // so it needs a whole standing figure to copy onto. A chest-up portrait is
  // the wrong input for it: the character-animation Spaces cannot find a body
  // to drive, the "draw it again, wider" retry burns a minute and still comes
  // back cropped, and forcing the keyframes into the portrait 480x848 the
  // transfer renders at re-frames a picture that was never meant to move. So
  // when the reference is provably not a whole figure, the run says so and
  // lets the video model supply the motion — in the user's own aspect ratio.
  if (motionOn && imageBlob) {
    const ref = await analyzeFigure(imageBlob).catch(() => null);
    if (ref?.checked && !ref.ok) {
      motionOn = false;
      emit({
        type: "log",
        level: "warn",
        text:
          `Motion transfer skipped — the reference picture is not a whole standing figure (${ref.reason}), ` +
          `so there is no full-body pose to copy movement onto. The video model will supply the motion instead.`,
      });
    }
  }

  if (refExtras.length) {
    const multi = order.filter((p) => isMultiRef(p));
    const single = order.filter((p) => !isMultiRef(p));
    const has = (s) => refExtras.some((e) => (e.slot || "").toLowerCase() === s);
    const wired = [
      has("face") ? "Face→MSR ref2" : null,
      has("body") || refExtras.some((e) => (e.slot || "").toLowerCase() === "outfit") ? "Body/outfit→MSR ref3" : null,
      has("char1") || has("char2") ? "Character→MSR ref4" : null,
      has("scene") ? "Scene→MSR background" : null,
      has("style") ? "Style/pose→prompt guidance (no pixel input takes it)" : null,
    ].filter(Boolean);
    try {
      let headless = false;
      if ("FaceDetector" in window && imageBlob) {
        const probeUrl = URL.createObjectURL(imageBlob);
        try {
          const probeImg = new Image();
          probeImg.src = probeUrl;
          await probeImg.decode();
          const det = new FaceDetector({ fastMode: true });
          const faces = await det.detect(probeImg).catch(() => []);
          headless = !(faces && faces.length);
        } catch {} finally { setTimeout(() => URL.revokeObjectURL(probeUrl), 4000); }
      }
      if (headless && has("face")) {
        emit({
          type: "log",
          level: "warn",
          text: "Starter has no detectable face (headless torso) — Face ref rides as MSR ref2 so LTX anchors identity itself. No pixels composited; the Space holds the face.",
        });
      }
    } catch {}
    const tall = (ASPECTS[aspect]?.ratio || 1) < 1;
    if (tall && refExtras.length >= 1) {
      const hy = order.findIndex((p) => p.id === "hunyuan15");
      if (hy >= 0) {
        const [hunyuan] = order.splice(hy, 1);
        order.push(hunyuan);
        emit({
          type: "log",
          level: "warn",
          text: "HunyuanVideo 1.5 moved last: it force-renders 854×480 landscape whatever you send, so it beheads portrait multi-ref shots. LTX identity / multi-ref routes lead.",
        });
      }
    }
    emit({
      type: "log",
      text: `References → starter + ${refExtras.length} (${refExtras.map((e) => e.label || e.slot).join(", ")}). ${wired.length ? `LTX MSR wiring: ${wired.join(" · ")}.` : ""} Multi-ref [${multi.slice(0, 3).map((p) => p.label).join(", ") || "none in this pool"}] get every image as pixels; single-image [${single.slice(0, 3).map((p) => p.label).join(", ")}] animate the starter with the rest as prompt guidance only.`,
    });
    if (!multi.length && refExtras.length >= 2) {
      emit({
        type: "log",
        level: "warn",
        text: "No multi-reference route in this pool — attach ONE combined photo for single-image models, or pick a ◆ multi-ref model (LTX identity, Seedance / Pixverse / Veo Fast via MuAPI).",
      });
    }
  }
  const anchored = !!imageBlob;
  const composed = composePrompt({ prompt: promptWithRefs, cameraMove, cameraAngle, tracking, trackStrength, cameraWords: o.cameraWords, style, nsfw, anchor: anchored });
  const neg = buildNegative({ negative, nsfw, style, anchor: anchored });
  const moveDef = CAMERA_MOVES.find((m) => m.id === cameraMove);

  // (The provider order, and the free-pool allowance check that goes with it,
  // are worked out above — before the picture steps.)
  // Say it out loud rather than surprising the user with a camera move at the end.
  if (undress && (settings.computeMode || "auto") !== "offline" && !order.some((p) => p.kind === "offline")) {
    emit({
      type: "log",
      level: "warn",
      text: "On-device rig left out of this run: it is a camera move over your still, so it cannot undress anyone — only a real video model can.",
    });
  }

  emit({
    type: "plan",
    total: duration,
    providers: order.slice(0, 4).map((p) => ({ id: p.id, label: p.label, tier: p.tier })),
    prompt: composed,
  });
  emit({ type: "log", text: `Prompt → ${composed}` });

  // Say what the router decided, out loud: an explicit run that quietly skipped
  // every model with a content check would otherwise be a mystery, and “the
  // uncensored one wasn't even tried” is the kind of thing a user should never
  // have to guess at.
  if (nsfw) {
    emit({
      type: "log",
      text:
        `content tier · ${tierLabel(reqTier.tier)} (${reqTier.signals.slice(0, 3).join("; ") || "nothing explicit in the text"}) · ` +
        `routing: ${(settings.nsfwRouting || "strict") === "widen" ? "every enabled model" : "uncensored routes only"}`,
    });
    if ((settings.nsfwRouting || "strict") !== "widen") {
      emit({
        type: "log",
        text:
          `explicit run → only routes that accept it are asked: ${order.slice(0, 6).map((p) => p.label).join(" → ")}` +
          (order.length > 6 ? ` … (${order.length} in all)` : ""),
      });
    }
  }
  if (settings.localOnly) {
    emit({
      type: "log",
      text: "nothing-leaves-device mode: only your own server and the on-device rig may render, and no step may hand your picture to a third party.",
    });
  }

  // ---- The storyboard: draw the frames the clip is built from --------------
  // Every rung that takes a garment off is drawn as a picture before a single
  // frame of video is rendered, so the clip is the motion *between* two real,
  // well-drawn stills rather than one still asked to invent an undress.
  let sbPlan = null;
  let sbFrames = new Map();
  let sbBeatSeconds = 0;
  if (storyboardMode && rungs?.length) {
    const sbOpts = storyboardOptions();
    // The beats come from the *clip length*, not from how long one model
    // happens to render: the whole point of the storyboard is that the body
    // changes in several small steps, so this is what decides both how many
    // keyframes get drawn and how long each clip in the chain is.
    // Motion transfer buys real movement, but each beat costs an extra driver
    // clip on top of the transfer itself, so a motion-transfer run is cut into
    // fewer, longer beats than a plain storyboard run (see `motionTransfer` in
    // main.pjs). Every beat is still one keyframe and one small step.
    const beats = Number(resume?.storySegments) > 0
      ? Math.max(1, Math.floor(Number(resume.storySegments)))
      : motionOn
      ? Math.max(1, Math.min(planBeats(duration, sbOpts), Math.floor(mtOpts.maxBeats) || 4))
      : planBeats(duration, sbOpts);
    sbPlan = buildPlan({
      storyboard: rungs,
      segments: beats,
      maxKeyframes: beats,
    });
    sbBeatSeconds = Math.max(0.5, duration / sbPlan.segments);
    // Beats are whole frames of the run's own rate, so the beats add up to the
    // clip's length instead of drifting a fraction of a frame short at each one.
    {
      const beatRate = Number(fps) || Number(order[0]?.fps) || 16;
      sbBeatSeconds = Math.max(1 / beatRate, Math.round(sbBeatSeconds * beatRate) / beatRate);
    }
    emit({ type: "beats", total: sbPlan.frames, segments: sbPlan.segments });
    emit({
      type: "log",
      text:
        `Storyboard: ${sbPlan.segments} beats of ${Math.round(sbBeatSeconds * 10) / 10}s — ` +
        `the sequence is cut into ${sbPlan.segments} steps, so each clip only has to move the body one small step.`,
    });
    if (motionOn) {
      emit({
        type: "log",
        text:
          `Motion transfer on — each beat's movement (and the face that goes with it) is copied from a real driving clip, ` +
          `built from the beat's motion at ${mtOpts.maxBeats} beats max, rather than being invented by the video model.`,
      });
    }
    if (resumeFrames) {
      // Resuming: the frames drawn by the run that stopped are re-used as they
      // are. Redrawing them would cost another wait on the free image queue for
      // pictures that already exist, and (worse) could come back different,
      // which would put a seam in the middle of the clip.
      for (const [boundary, blob] of resumeFrames) sbFrames.set(Number(boundary), blob);
      emit({
        type: "log",
        text:
          `Resuming — the ${sbFrames.size} keyframe${sbFrames.size === 1 ? "" : "s"} drawn last time are kept ` +
          `(they are not drawn again), and the frames already rendered are still in the chain.`,
      });
    } else {
      try {
        // A full-body figure is tall. When a character-animation model is going to
        // be handed these frames, they are drawn at the portrait shape it renders
        // at, so nothing is stretched on the way in or out.
        const [kw, kh] = dimsFor(aspect, quality, null);
        const [fw, fh] = motionOn ? MOTION_SIZE : [kw, kh];
        if (motionOn && (kw !== fw || kh !== fh)) {
          emit({ type: "log", text: `Motion transfer renders in portrait ${fw}×${fh} — the clip is portrait.` });
        }
        const relayFor = (cap) =>
          privacyRelay(settings, cap === "post" ? { get: true, post: true } : { get: true }, "a storyboard frame");
        const drawn = await drawKeyframes({
          plan: sbPlan,
          input: imageBlob,
          base: prompt?.trim() || "",
          userNegative: negative?.trim() || "",
          size: [fw, fh],
          seed,
          key: settings.hordeKey || "",
          relay: relayFor,
          signal,
          onStage: (e) => emit({ type: "beat", ...e }),
          options: { ...sbOpts, verifyFigure: motionOn },
          strictPrivacy: privacyStrict(settings),
        });
        sbFrames = drawn.frames;
        emit({
          type: "log",
          text:
            `Storyboard: ${drawn.drawn}/${sbPlan.drawAt.length} frames drawn` +
            (drawn.failed.length ? ` — ${drawn.failed.length} reused the frame before` : " — the clip animates between them"),
          level: drawn.drawn === 0 && drawn.failed.length ? "warn" : "",
        });
        if (drawn.drawn === 0 && drawn.failed.length) {
          emit({
            type: "log",
            level: "warn",
            text:
              "None of the keyframes could be drawn, so nothing in this run will take a garment off — the pictures are where " +
              "that happens. The lines above name what the drawing service said. A free key from aihorde.net/register skips " +
              "most of that queue, and a shorter/inpaint-friendly prompt helps with a refusal.",
          });
        }
      } catch (e) {
        if (e?.kind === "cancelled") throw e;
        emit({ type: "log", level: "warn", text: `Storyboard frames: ${e.message} — continuing from the frame we already have.` });
      }
    }
    // Not one picture came back. On an undress run the clothing comes off in the
    // *stills* — that is the whole design — so a run with no drawn frame is a
    // run that cannot undress anyone, whatever happens next. Rendering it anyway
    // would spend the free allowance on a dressed clip and leave the *next* run
    // (which might have worked) with nothing, so it stops here and says why.
    if (!resumeFrames && sbFrames.size < 2) {
      throw new SpaceError(
        "The storyboard could not draw a single frame, so this run cannot take anything off — on an undress run the clothing comes off in the pictures, and none of them could be made. The lines above say exactly why. " +
          "If they say AI Horde blocked the attempts, that route is filtered by its workers' own safety check and no retry will get past it: your own GPU server (Settings → Where the rendering happens, free Colab T4) and the paid vendors are the routes that will draw an explicit still. " +
          "Otherwise press Generate again — the free image queue lands on different workers each time — or add a free key from aihorde.net/register (Settings → Free GPU boost) to skip most of the queue. Turning the Undress switch off gets an ordinary clip instead.",
        "input"
      );
    }
  }

  // A storyboard is only as good as the models that can take *both* ends of a
  // beat. A first-frame + last-frame model animates the body from the keyframe
  // before a beat to the keyframe after it, which is directed motion rather
  // than motion the model has to invent; those go first. An uncensored model
  // still outranks them on an explicit run, or the best-directed model in the
  // list would be one that refuses the content.
  if (sbPlan) {
    // The character-animation Spaces go to the very front: they are the only
    // models here that *copy* real motion rather than inventing it, and the
    // engine walks past them on its own if a beat's driver clip is missing.
    if (motionOn) order = withMotionProviders(order);
    order.sort((a, b) => motionScore(b, nsfw) - motionScore(a, nsfw));
  }

  // Which model animates the *driver* — the clothed actor whose clip is copied.
  // Any fast image-to-video model will do; a text-to-video one is just as good.
  const driverProvider = motionOn ? pickDriverProvider(order) : null;
  // One driving clip per beat, made once and reused if the run comes back to
  // that beat (a provider swap re-renders the same beat).
  const driverClips = new Map();
  const driverFailed = new Set();
  const driverFor = async (beatIdx, beatLen) => {
    if (driverClips.has(beatIdx)) return driverClips.get(beatIdx);
    if (!driverProvider || driverFailed.has(beatIdx)) return null;
    const rung = sbPlan?.endRung[beatIdx];
    emit({
      type: "log",
      text: `Motion reference ${beatIdx + 1}/${sbPlan.segments} — building the driving clip whose movement will be copied onto her.`,
    });
    try {
      const clip = await makeDriverClip({
        rung,
        duration: Math.max(driverProvider.minSec, Math.min(driverProvider.maxSec, beatLen)),
        provider: driverProvider,
        seed: seed + 9001 + beatIdx * 17,
        ctx: {
          settings,
          signal,
          controller,
          superFetch,
          hfToken,
          publicUpload,
          strict: privacyStrict(settings),
          startedAt: started,
          steps: settings.steps || undefined,
          aspect,
          quality,
          keyModel: o.keyModel,
        },
        onEvent: emit,
      });
      if (clip) {
        driverClips.set(beatIdx, clip);
        return clip;
      }
    } catch (e) {
      if (e?.kind === "cancelled") throw e;
      emit({ type: "log", level: "warn", text: `Could not build the driving clip (${e.message}).` });
    }
    driverFailed.add(beatIdx);
    return null;
  };

  // A length that is actually delivered is a promise, so the loop below fills
  // real seconds rather than assumed ones. `madeSec` is the sum of the clips'
  // own measured lengths and a crossfade eats one overlap per join, so
  // `coveredSec()` is how much of the request the chain genuinely holds — the
  // difference between "four beats were planned" and "four beats of video came
  // back". That is the accounting that used to be missing: a 5 s request was
  // delivered as a 3.25 s file because the beats rendered a frame short each and
  // two crossfades took another half second, and nobody was counting.
  let lastFrame = resume?.lastFrame || imageBlob;
  const clips = [...resumeClips];
  // How much of the request the carried-in clips already cover. Their real
  // lengths are what the run was accounted with when they were made, so they
  // are what the continuation is measured against too.
  let madeSec = Math.max(0, Number(resume?.madeSec) || 0);
  // A storyboard chain is already contiguous: beat N+1 is animated from the same
  // keyframe beat N was animated *to*, so there is nothing between them to
  // blend. A crossfade there does not smooth anything — it overlaps two clips
  // that are showing the same still, and it eats `crossfade` seconds of the clip
  // at every join (four beats lost 0.75 s of a 5 s request that way). Plain
  // chains keep the user's crossfade, because their segments are independent
  // renders that do not line up.
  const cfSec = sbPlan ? 0 : Math.max(0, Number(settings.crossfade ?? 0.25) || 0);
  const coveredSec = () => Math.max(0, madeSec - Math.max(0, clips.length - 1) * cfSec);
  // ---- The last resort that needs no GPU ---------------------------------
  // On an undress run the clothes come off in the *stills*: the storyboard draws
  // her one step further along, and the video model's only job is the motion
  // between two of those pictures. So when every video route refuses — which is
  // what a spent per-address allowance looks like — the run can still be
  // delivered as those stills: cross-dissolved into a clip at exactly the length
  // and frame rate that were asked for (src/stillfilm.js). It is not generated
  // motion and the result card says so in as many words, but it is her, it is
  // the undress, and it costs nothing. The alternative was an error message.
  let stillsFilm = null;
  const buildStillsFilm = async (why) => {
    if (clips.length) return null;
    const stills = sbPlan
      ? [...sbFrames.entries()].filter(([b]) => Number(b) > 0).sort((a, b) => a[0] - b[0]).map((e) => e[1])
      : [];
    if (stills.length < 2) return null;
    try {
      emit({ type: "stage", stage: "stills", message: `Building the clip from the ${stills.length} drawn stills…` });
      const film = await renderStillFilm({
        frames: stills,
        duration,
        fps: Number(fps) || Number(order[0]?.fps) || 16,
        signal,
        onProgress: (p) => emit({ type: "progress", value: 0.5 + p * 0.5, label: "building from the stills" }),
      });
      emit({
        type: "log",
        level: "warn",
        text:
          `No video route would take this run (${why}), so the clip was built from the ${stills.length} stills the storyboard ` +
          `drew — the undress is in those pictures, and they are cross-dissolved here over ${film.duration.toFixed(1)}s. ` +
          `No video model animated it: the pictures are real, the movement between them is a dissolve.`,
      });
      return film;
    } catch (err) {
      emit({ type: "log", level: "warn", text: `Could not build the clip from the stills either (${err.message}).` });
      return null;
    }
  };

  let remaining = Math.max(0, duration - coveredSec());
  // Enough beats to fill the run even when each one comes back short, without
  // letting a pathological model spin forever. A continuation starts from the
  // beats it already has.
  const maxClips = Math.min(30, Math.max(clips.length + 3, Math.ceil(duration / 0.6) + 2));
  // How far up the storyboard's keyframe ladder the chain has actually got. A
  // beat is only handed a planned keyframe to start from when that keyframe is
  // *ahead* of where the chain is — otherwise a beat that came back shorter than
  // planned would jump backwards to re-animate a step that already happened.
  let reachedBoundary = Math.max(0, Number(resume?.reachedBoundary) || 0);
  // A spent allowance is not always an empty one. The free pool meters
  // GPU-seconds per address, so a *smaller* job often still goes through — its
  // own refusal message says so ("a shorter clip or a lighter model often still
  // goes through"). On a quota refusal the run therefore halves the ask and
  // tries the same model again, and makes the missed time up with more, cheaper
  // beats, instead of writing the model off at the first refusal.
  let askScale = Math.max(0.25, Math.min(1, Number(resume?.askScale) || 1));
  if (resuming) {
    emit({
      type: "log",
      text:
        `Continuing from the last frame of the previous run — ${clips.length} clip${clips.length === 1 ? "" : "s"} ` +
        `(${coveredSec().toFixed(2)}s) carried in, ${remaining.toFixed(2)}s still to make. Your reference picture is still ` +
        `anchoring her identity in every prompt.`,
    });
  }
  let usedProvider = null;
  let usedOffline = false;
  // Beats that no model could render properly, and the still stats of each
  // frame a segment is conditioned on (measured by src/image.js `imageStats`,
  // the same way the returned clip is measured by src/video.js `clipMetrics`,
  // so the two numbers are comparable).
  let dubiousBeats = 0;
  const statCache = new Map();
  const stillStats = async (b) => {
    if (!b) return null;
    if (statCache.has(b)) return statCache.get(b);
    const s = await imageStats(b).catch(() => null);
    statCache.set(b, s);
    return s;
  };
  // The undress ladder for this run, read once — main.pjs owns the wording.
  const stagesForRun = undress ? undressStages() : null;
  let attempt = 0;
  let orderIdx = 0;
  let quotaFails = 0;
  let lastError = null;
  // What has actually worked *this run*. The free pool's allowance is one pot
  // shared by every free Space and metered to the identity the request leaves
  // as, so a refusal says almost nothing about a *model* and a great deal about
  // the pool being empty for now. Without this the run rediscovers that on every
  // single beat: six models refuse in turn while the one model that is actually
  // answering the pool sits at the back of the queue, reached only after minutes
  // of the others refusing — which is exactly what a run log full of
  // "token dropped" followed by "out of allowance" is. So the run remembers: a
  // provider that just delivered a beat is asked first next time, and one that
  // has refused for allowance is asked last.
  const runWins = new Map();
  const runRefusals = new Map();
  const providerStanding = (p) => (runWins.get(p.id) || 0) * 100 - Math.min(4, runRefusals.get(p.id) || 0) * 110;
  const rankProviders = () => {
    if (!runWins.size && !runRefusals.size) return;
    const pos = new Map(order.map((p, i) => [p.id, i]));
    order = order
      .slice()
      .sort((a, b) => providerStanding(b) - providerStanding(a) || (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
  };
  // A segment that comes back almost motionless is re-rendered rather than
  // stitched in: "the body does not move" is the one failure a console never
  // reports, because the file is a perfectly valid video. Two extra tries per
  // beat, with the motion told louder each time.
  let staticRetries = 0;
  let staticRerenders = 0;
  // Re-renders of the *current* beat because the clip came back wrong in any
  // way (motionless, blown out, melted, or not the frame it was handed). Reset
  // the moment a beat is accepted.
  let beatRetries = 0;
  // The best attempt at the beat being rendered, so a retry can never ship
  // something worse than the try before it (see the scoring in the loop).
  let beatBest = null;
  // How many distinct addresses this configuration can actually leave from.
  // The free pool meters an allowance per *address*, so a refusal is worth
  // re-trying from the next one before that model is written off — and the
  // app's own bench is only applied once every address has refused.
  const addresses = Math.max(1, rotatableCount(settings));
  const addressTries = {};
  const benches = benchTable();
  let lastSegMeta = null;
  let lastSegFrames = null;
  let lastSegFrame = null;
  let segTotal = planSegments(remaining, order[0].maxSec, order[0].minSec).length;

  // The loop fills *real* seconds, so it stops when the chain genuinely covers
  // the request. The tolerance is one frame: a chain that is a quarter-second
  // short is a quarter-second short, and the last beat is asked for slightly
  // more than remains and then trimmed, so the file lands on the requested
  // length instead of just under it.
  while (remaining > 0.02 && clips.length < maxClips) {
    if (signal?.aborted) {
      // Stopping is not the same as losing the work: whatever has been rendered
      // is delivered, and the result card offers to finish the clip from the
      // frame the chain reached.
      if (!clips.length) throw new SpaceError("Cancelled", "cancelled");
      emit({
        type: "log",
        level: "warn",
        text:
          `Stopped — keeping the ${clips.length} beat${clips.length === 1 ? "" : "s"} already rendered ` +
          `(${coveredSec().toFixed(2)}s of ${duration}s). “Finish this clip” carries on from the frame the run reached, ` +
          `with your reference picture still anchoring her identity.`,
      });
      break;
    }
    // A new beat is about to start (orderIdx is only 0 here or just after a beat
    // was accepted), so re-rank the routes by what has worked this run — the
    // model that just delivered a beat goes first, the ones that have refused
    // for allowance go last. Re-ranking mid-beat would move the entry under
    // `orderIdx`, so it only ever happens at a beat boundary.
    if (orderIdx === 0) rankProviders();
    const provider = order[orderIdx];
    if (!provider) {
      if (clips.length) break;
      throw new SpaceError("All free models failed. Try again in a few minutes, or add a model API key in Settings.", "quota");
    }
    // Which storyboard rungs this segment covers. Indexed by how far through
    // the clip we are rather than by segment number, so a provider swap (which
    // changes how long a segment can be) still lands on the right rung.
    const progress = Math.min(0.9999, (duration - remaining) / duration);
    const sbIdx = sbPlan ? Math.max(0, Math.min(sbPlan.segments - 1, Math.floor(progress * sbPlan.segments))) : -1;
    // A beat past the end of the plan — which happens when the chain renders
    // more beats than were planned, and when it is filling the last of a long
    // request — has no keyframe of its own to start from or aim at. It continues
    // from the frame the chain actually reached, holding the final rung's state,
    // instead of replaying the last planned beat.
    //
    // The same rule covers a beat that came back shorter than planned: the plan's
    // next keyframe is only handed over when it is genuinely *ahead* of where the
    // chain has got to, so a short beat never sends the picture backwards to
    // re-animate a step that already happened.
    const sbStartB = sbPlan ? sbPlan.startFor[sbIdx] : 0;
    const sbEndB = sbPlan ? sbPlan.endFor[sbIdx] : null;
    const sbStart = sbPlan && sbStartB > reachedBoundary ? startFrameFor(sbFrames, sbPlan, sbIdx) : null;
    const sbEnd = sbPlan && sbEndB != null && sbEndB > reachedBoundary ? endFrameFor(sbFrames, sbPlan, sbIdx) : null;
    const segImage = sbStart || lastFrame;
    // A beat is one small step, so its length comes from the plan rather than
    // from the model's whole window — that is the entire point of cutting the
    // clip into beats. A plain run still fills the window as it always did.
    const beatLen = sbPlan ? Math.min(sbBeatSeconds, Math.max(0.25, remaining)) : null;
    // Whole frames, not tenths. A model renders whole frames, so 1.3 s at
    // 16 fps is 20 frames whatever the request says — and 20 frames is 1.25 s.
    // Asking in tenths threw that away at every beat; asking in frames means the
    // beats add up to what was asked for. (`fps` is Auto unless the user picked
    // a rate, hence the provider's own rate as the fallback.)
    const rate = Number(fps) || Number(provider.fps) || 16;
    const rawDuration = Math.min(provider.maxSec, Math.max(provider.minSec, (sbPlan ? beatLen : remaining) * askScale));
    const segDuration = Math.max(1 / rate, Math.min(provider.maxSec, Math.round(rawDuration * rate) / rate));
    // The plan's beat length is snapped the same way, so the rung survives the
    // chain reaching the last beat with a little time left over.
    sbBeatSeconds = sbPlan ? Math.max(1 / rate, Math.round(sbBeatSeconds * rate) / rate) : sbBeatSeconds;
    // A character-animation model is only usable with a driving clip. Make one
    // for this beat (once, cached), or step past the motion providers for this
    // beat — the ordinary chain still renders it, it just invents the motion.
    let driverClip = null;
    if (sbPlan && motionOn && needsDriver(provider)) {
      driverClip = await driverFor(sbIdx, segDuration);
      if (!driverClip) {
        emit({
          type: "log",
          level: "warn",
          text: "No driving motion clip for this beat — rendering it with the normal chain (the motion will be invented rather than copied).",
        });
        const next = order.findIndex((p, i) => i > orderIdx && !needsDriver(p));
        orderIdx = next >= 0 && next < order.length ? next : order.length;
        if (orderIdx >= order.length) break;
        continue;
      }
    }
    // Motion is not free: a video model renders the movement it is told about,
    // so every upbeat beat carries the whole-body motion block, and a beat that
    // came back static gets it said again, harder (see `staticRetries` below).
    const motionPhrase = sbPlan
      ? storyboardMotion() + (staticRetries ? ", strong pronounced movement, clearly moving, dynamic motion" : "")
      : "";
    const segCtx = {
      imageBlob: segImage,
      extraBlobs: refExtras.map((e) => e.blob),
      extraLabels: refExtras.map((e) => e.label || e.slot),
      refExtras: refExtras.map((e) => ({ blob: e.blob, slot: e.slot, label: e.label || e.slot, hint: e.hint || "" })),
      // The rung this segment should *arrive* at. Providers that take a last
      // frame use it (first-frame + last-frame models, and any space whose
      // call has an end/last argument — see src/gradio.js); the rest simply
      // animate from the frame before it with the rung's motion prompt.
      endImage: sbEnd && sbEnd !== segImage ? sbEnd : null,
      // The clip whose movement is copied onto this beat's keyframe, for the
      // character-animation models. Null for every other provider.
      drivingVideo: driverClip,
      drivingPrompt: driverClip ? `${driverMotion(sbPlan.endRung[sbIdx])}, ${driverFace(sbPlan.endRung[sbIdx])}` : "",
      prompt: sbPlan
        ? composePrompt({ prompt: promptWithRefs, stage: segmentMotion(sbPlan.groups[sbIdx], promptWithRefs, null, { anchor: !!segImage }), motion: motionPhrase, cameraMove, cameraAngle, tracking, trackStrength, cameraWords: o.cameraWords, style, nsfw })
        : segmentPrompt({
            composed,
            chain: clips.length > 0,
            progress,
            stages: stagesForRun,
          }),
      negative: neg,
      duration: segDuration,
      seed: seed + clips.length * 7 + beatRetries * 1013,
      steps: settings.steps || undefined,
      size: dimsFor(aspect, quality, provider),
      aspect,
      quality,
      nsfw,
      cameraScope: provider.caps.camera ? moveDef?.scope || null : null,
      motionScale: o.motionScale ?? 1,
      hfToken,
      signal,
      controller,
      superFetch,
      publicUpload,
      strict: privacyStrict(settings),
      settings,
      spaceRepo: provider.repo || HF_ENDPOINT_IDS[provider.id] || null,
      startedAt: started,
      estSecs: provider.estSecs,
      fps: fps || provider.fps || null,
      cameraMove,
      cameraAngle,
      tracking,
      trackStrength,
      keyModel: o.keyModel,
      imageDataUrl: segImage ? await blobToDataUrlCached(segImage) : null,
      // The other end of the beat, in the form the server client posts. The
      // GPU server's first/last-frame models use it (see `lastImage` in
      // src/server/server.py's call_kwargs); every other route ignores it.
      endImageDataUrl:
        sbEnd && sbEnd !== segImage ? await blobToDataUrlCached(sbEnd) : null,
      imageUrl: o.imageUrl || null,
      segmentTimeoutMs: 900000,
    };

    const segNum = clips.length + 1;
    emit({
      type: "segment",
      index: segNum,
      total: Math.max(segTotal, segNum),
      duration: segCtx.duration,
      provider: { id: provider.id, label: provider.label, tier: provider.tier, vendor: provider.vendor, estSecs: provider.estSecs, maxSec: provider.maxSec },
    });
    emit({
      type: "log",
      text:
        `Segment ${segNum} · ${provider.label} · ${Math.round(segCtx.duration * 100) / 100}s` +
        (sbPlan
          ? ` · storyboard ${sbIdx + 1}/${sbPlan.segments}` +
            (segCtx.endImage ? " (animating to the next drawn frame)" : "")
          : stagesForRun
          ? ` · undress stage ${undressStageAt(progress, stagesForRun) + 1}/${stagesForRun.length}`
          : ""),
    });
    if (provider.kind === "offline") {
      usedOffline = true;
      emit({
        type: "log",
        level: "warn",
        text: "No model took this run, so this clip is a camera move over your still — it is not generated video, and nothing in it will move the way a person moves. Your own GPU server (free Colab T4) or a free Hugging Face token in Settings are what produce real motion.",
      });
    }

    try {
      const { blob, provider: usedP, lastFrame: returnedFrame, frames: returnedFrames, meta: segMeta } = await runSegment(provider, segCtx, emit);
      // Judge the clip itself, in one pass over the file. "It produced a video"
      // and "it produced the shot that was asked for" are different things, and
      // the difference is measurable: how much of the picture moves, whether the
      // opening frame is the still the beat was handed (rather than a shot the
      // model invented, which is what a melted or re-cast render looks like), and
      // whether it arrived at the frame the beat was aiming for. A console can
      // see none of this — the file is a perfectly valid video either way — and
      // every one of these failures used to reach the finished clip.
      //
      // The comparison is against the frame *this segment* was given, measured
      // the same way (src/image.js `imageStats`), so it stays true as the ladder
      // undresses her: a nude beat is judged against the nude still it started
      // from, not against the clothed picture the run opened on.
      let check = null;
      if (provider.kind !== "offline") {
        const refStats = await stillStats(segImage);
        let checkErr = null;
        check = await withTimeout(
          clipMetrics(blob, { samples: 6, ref: refStats, start: segImage, end: segCtx.endImage || null }),
          25000
        ).catch((e) => {
          checkErr = e;
          return null;
        });
        // A file that will not decode is not a judgement about the shot — it is
        // a corrupt or unplayable download. It used to sail straight through
        // here (no metrics meant no problems), get stitched in at the very end
        // and take the whole finished run down with it with "This browser cannot
        // play that video file." — after every beat had already been paid for.
        // The file read is the one place that can tell the difference, so a real
        // decode failure is a *failed attempt* now: the beat is re-rendered on
        // the next route instead of being kept. A slow device that merely timed
        // this read out is NOT evidence about the clip, so a timeout still falls
        // through with no metrics rather than throwing the clip away.
        if (!check && !/timeout/i.test(checkErr?.message || "")) {
          throw new SpaceError(
            "The model returned a file this browser cannot decode, so it is not a usable clip.",
            "empty",
            "",
            checkErr?.message || "the returned file could not be read back as video"
          );
        }
      }
      const problems = [];
      let score = 0;
      if (check) {
        // One number per attempt, so "the best of three tries" is a comparison
        // rather than a hope. Motion is what the clip is for; a blown, melted or
        // re-cast opening frame costs more than any amount of movement is worth;
        // and drift at either end is penalised in proportion to how far off it
        // is.
        score = check.motion * 10;
        if (check.motion < STATIC_MOTION_FLOOR) {
          score -= 3;
          problems.push(`it barely moves (motion ${check.motion.toFixed(4)} — a frozen clip)`);
        }
        if (check.blown) {
          score -= 4;
          problems.push(
            `its opening frame is blown out (brightness ${Math.round(check.first.lum)} and saturation ` +
              `${Math.round(check.first.sat)}, against the ${Math.round(check.ref?.lum ?? 0)}/${Math.round(check.ref?.sat ?? 0)} of the frame it was given)`
          );
        }
        if (check.flat) {
          score -= 3;
          problems.push(
            `its opening frame is melted (detail ${check.first.detail} against the ${check.ref?.detail ?? "?"} of the frame it was given)`
          );
        }
        if (check.startDrift != null && check.startDrift > START_DRIFT_MAX) {
          score -= check.startDrift * 4;
          problems.push(`it did not start from the frame it was given (${Math.round(check.startDrift * 100)}% of it changed)`);
        }
        if (check.endDrift != null && check.endDrift > END_DRIFT_MAX) {
          score -= check.endDrift * 3;
          problems.push(
            `it never arrived at the frame this beat was aiming for (${Math.round(check.endDrift * 100)}% of the way short)`
          );
        }
      }
      // A clean attempt always beats a flagged one, whatever their motion: the
      // penalty scores above can only order attempts of the same kind.
      if (check && !problems.length) score += 20;
      // The best attempt at this beat so far. Two retries must not be able to end
      // up shipping something *worse* than the first try, so the attempts are
      // scored and the best one is what gets kept if none of them is clean.
      if (!beatBest || score > beatBest.score) {
        beatBest = { blob, usedP, returnedFrame, returnedFrames, segMeta, score, check, problems };
      }
      if (problems.length && beatRetries < MAX_BEAT_RETRIES) {
        beatRetries += 1;
        if (check && check.motion < STATIC_MOTION_FLOOR) {
          staticRetries += 1;
          staticRerenders += 1;
        }
        emit({
          type: "log",
          level: "warn",
          text:
            `${provider.label} came back wrong — ${problems.join("; ")}. Re-rendering this beat ` +
            `(try ${beatRetries + 1} of ${MAX_BEAT_RETRIES + 1}), with the movement told more forcefully and a fresh seed.`,
        });
        // A re-render on the same provider and the same seed is the same file
        // again, so the beat's seed is bumped in `segCtx` above and the run
        // steps to the next model when there is one.
        const next = order.findIndex((p, i) => i > orderIdx && p.id !== provider.id);
        if (next >= 0) orderIdx = next;
        continue;
      }
      // Nothing left to try: keep the best attempt rather than the last one.
      let kept = { blob, usedP, returnedFrame, returnedFrames, segMeta, check, problems };
      if (beatBest && beatBest.score > score + 1e-6) {
        kept = beatBest;
        emit({
          type: "log",
          level: "warn",
          text: `Keeping the best of ${beatRetries + 1} attempts at this beat — the later re-render${beatRetries > 1 ? "s" : ""} did not improve on it.`,
        });
      }
      beatBest = null;
      if (kept.problems.length) {
        // Every model that could take this beat got it wrong. Better an
        // imperfect beat than a hole in the clip — but it is said out loud, and
        // the result card repeats it, rather than being counted as a clean
        // render.
        dubiousBeats += 1;
        emit({
          type: "log",
          level: "warn",
          text: `${kept.usedP?.label || provider.label}: out of models to try for this beat, so the best attempt is being kept — ${kept.problems.join("; ")}.`,
        });
      } else if (kept.check) {
        emit({
          type: "log",
          text:
            `motion ok · ${kept.usedP?.label || provider.label} · ${(kept.check.motion * 100).toFixed(1)}% of the frame moving · ` +
            `opened on ${kept.check.startDrift == null ? "its frame" : `${Math.round(kept.check.startDrift * 100)}% drift from the frame it was given`}` +
            (kept.check.endDrift != null ? ` · landed ${Math.round(kept.check.endDrift * 100)}% from the beat's target frame` : ""),
        });
      }
      const segBlob = kept.blob;
      usedProvider = kept.usedP;
      runWins.set((kept.usedP || provider).id, (runWins.get((kept.usedP || provider).id) || 0) + 1);
      // The pool answered at this size, so it can answer at least this big:
      // grow the ask back one rung (0.3 → 0.5 → 1) rather than leaving it pinned
      // at the floor for the rest of the run. Without this, a single early
      // refusal shrank *every* later beat — which is why a run that hit one
      // quota refusal went on to deliver a chain of tiny half-second beats even
      // after the pool was clearly answering again.
      if (askScale < 1) askScale = askScale < 0.5 ? 0.5 : 1;
      recordOutcome((kept.usedP || provider).id, { tier: reqTier.tier, ok: true }).catch(() => {});
      if (kept.segMeta) lastSegMeta = kept.segMeta;
      if (kept.returnedFrames?.length) lastSegFrames = kept.returnedFrames;
      if (kept.returnedFrame) lastSegFrame = kept.returnedFrame;
      const clip = kept.returnedFrame || (await withTimeout(extractFrame(segBlob, "last"), 15000).catch(() => null));
      clips.push(segBlob);
      // Real seconds, measured from the file rather than assumed from the
      // request. A beat that came back a frame or two short is short, and the
      // chain has to make the time up somewhere — which is what the loop
      // condition above now does.
      madeSec += await withTimeout(probe(segBlob), 15000)
        .then((p) => Number(p?.duration) || segCtx.duration)
        .catch(() => segCtx.duration);
      remaining = Math.max(0, Math.round((duration - coveredSec()) * 100) / 100);
      // The chain is now as far up the ladder as this beat aimed.
      if (sbPlan && sbEndB != null) reachedBoundary = Math.max(reachedBoundary, sbEndB);
      emit({ type: "clip", index: segNum, blob: segBlob, provider: usedProvider, duration: segCtx.duration });
      if (clip) lastFrame = clip;
      emit({ type: "progress", value: Math.min(0.97, (duration - remaining) / duration), label: `segment ${segNum} done` });
      attempt = 0;
      staticRetries = 0;
      beatRetries = 0;
      orderIdx = 0;
      segTotal = clips.length + (sbPlan ? Math.max(1, sbPlan.segments - clips.length) : planSegments(Math.max(0, remaining), provider.maxSec, provider.minSec).length);
    } catch (e) {
      if (e?.kind === "cancelled") {
        // A cancel that arrives mid-beat keeps the beats that completed.
        if (!clips.length) throw e;
        emit({
          type: "log",
          level: "warn",
          text: `Stopped — keeping the ${clips.length} beat${clips.length === 1 ? "" : "s"} already rendered. “Finish this clip” carries on from here.`,
        });
        break;
      }
      attempt += 1;
      lastError = e;
      if (e?.kind === "quota") quotaFails += 1;
      if (e?.kind === "safety") {
        // A real content refusal is information about the endpoint, not just a
        // failed attempt — remember it so the next run does not walk into it.
        const st = await recordOutcome(provider.id, { tier: reqTier.tier, ok: false, refused: true }).catch(() => null);
        emit({
          type: "log",
          level: "warn",
          text: st
            ? `content refusal recorded on ${provider.label} (${st.refused}) — this route goes last from now on.`
            : `${provider.label} refused the content.`,
        });
      }
      emit({ type: "log", level: "warn", text: `${provider.label} failed: ${e.message}${e.hint ? ` — ${e.hint}` : ""}` });
      // A content refusal is not fatal either: another model (and, in auto mode,
      // the on-device renderer, which has no content filter at all) may well
      // take it. Only a genuine input error kills the run.
      const retryable =
        ["quota", "busy", "timeout", "error", "empty", "oom", "paused", "privacy"].includes(e?.kind) ||
        (e?.kind === "safety" && !provider.keyed);
      if (retryable) {
        // First: a spent allowance is metered per *address*, so before writing
        // this model off, ask it again from the next address. That is the one
        // failure a new address genuinely cures, and it is the difference
        // between "one video and done" and "another one every time".
        const tried = addressTries[provider.id] || 0;
        const { hop, bench: benchSecs } = retryDecision(e?.kind, tried, addresses, benches);
        if (hop) {
          addressTries[provider.id] = tried + 1;
          settings.relayIndex = Math.abs(Number(settings.relayIndex) || 0) + 1;
          emit({
            type: "log",
            level: "warn",
            text: `${provider.label} refused on this address — trying it again from address ${tried + 2} of ${addresses}`,
          });
          continue;
        }
        // No fresh address left, and the refusal was about cost rather than
        // content: ask for *less*. The free pool meters GPU-seconds, so a
        // smaller job frequently goes through where this one did not — it is
        // the pool's own advice ("a shorter clip or a lighter model often still
        // goes through"), and it is now done automatically instead of being
        // left as something to read. The clip still ends up the length that was
        // asked for: the missed time is made up by more, cheaper beats, and the
        // storyboard's ladder is unaffected because a beat's rung comes from how
        // far through the clip the chain has got, not from how long the beat is.
        if (
          (e?.kind === "quota" || e?.kind === "busy") &&
          askScale > 0.3 &&
          clips.length < maxClips &&
          provider.kind !== "offline" &&
          provider.kind !== "server"
        ) {
          const was = askScale;
          askScale = Math.max(0.3, Math.round(askScale * 50) / 100);
          emit({
            type: "log",
            level: "warn",
            text:
              `${provider.label} refused for ${e.kind === "quota" ? "quota" : "being busy"} — asking it for a smaller beat instead ` +
              `(${(segCtx.duration * was).toFixed(2)}s → ${(segCtx.duration * askScale).toFixed(2)}s). A smaller job is cheaper for ` +
              `the pool, and the clip still reaches the length you asked for — it is made of more, shorter beats.`,
          });
          continue;
        }
        // The route is only being *left* here, so this is the refusal the run's
        // ranking counts. A refusal that was cured by asking for a smaller beat
        // never reaches this line and is not held against the model.
        if (e?.kind === "quota" || e?.kind === "busy" || e?.kind === "empty") {
          runRefusals.set(provider.id, (runRefusals.get(provider.id) || 0) + 1);
        }
        // A privacy failure says nothing bad about the model, so it must not
        // put that model on cooldown — the relay settings are the problem.
        if (e.kind !== "privacy" && provider.kind !== "offline" && provider.kind !== "server") {
          await markCooldown(provider.id, benchSecs, e.kind);
        }
        const next = order.findIndex((p, i) => i > orderIdx && p.id !== provider.id);
        orderIdx = next >= 0 ? next : orderIdx + 1;
        if (orderIdx >= order.length && clips.length === 0) {
          // Nothing will render this. Before giving up, the stills the
          // storyboard drew can become the clip on their own — they are where
          // the undress actually happened, and turning them into a clip costs
          // no GPU and no allowance at all.
          const film = await buildStillsFilm(e?.message || "every route refused the job");
          if (film) {
            clips.push(film.blob);
            madeSec += film.duration;
            stillsFilm = film;
            break;
          }
          // With privacy on, every model failed for the same reason: nothing
          // could carry the request. Say that plainly instead of blaming quota.
          if (e?.kind === "privacy") throw e;
          if (e?.kind === "safety" && quotaFails === 0) {
            throw new SpaceError(
              "Every model that could take this request refused its content. Turn the NSFW toggle off, soften the prompt, or switch Compute mode to “Only this device” — the on-device renderer has no content filter at all.",
              "safety",
              `${e.message}${e.hint ? ` — ${e.hint}` : ""}`
            );
          }
          throw new SpaceError(
            quotaFails >= 3
              ? `The free allowance is spent for ${addresses === 1 ? "this address" : "every address you have"} — it is metered per address and shared by all of the free models, so a second address is the real fix: Settings → Privacy & IP rotation → add a relay (the one-click Cloudflare Worker in "Help me set this up" counts, and a second Colab or Kaggle session is another free one), then press Check addresses. A free Hugging Face token raises the part metered to your account instead of your address, a shorter clip costs less of it, and your own GPU server and the on-device renderer have no allowance at all. The app's own bench is cleared before every run, so pressing Generate again never waits on it.${undress ? " (The on-device rig was left out of this undress run — a camera move cannot undress anyone.)" : ""}`
              : `Every free model failed for this request. Try again — the app starts each run from a clean slate and a different address when you have one — or use a shorter clip. The on-device renderer has no allowance at all.${undress ? " It was not tried here, though: it cannot undress anyone." : ""}`,
            "quota",
            `${e.message}${e.hint ? ` — ${e.hint}` : ""}`
          );
        }
        if (orderIdx >= order.length) break;
        continue;
      }
      throw e;
    }
  }

  // Every route gone and nothing rendered: the drawn stills are the last thing
  // that can be turned into a clip, and they need nothing but this device.
  if (!clips.length) {
    const film = await buildStillsFilm("every route was exhausted");
    if (film) {
      clips.push(film.blob);
      madeSec += film.duration;
      stillsFilm = film;
    }
  }
  if (!clips.length) throw new SpaceError("No video was produced.", "empty");

  let finalBlob;
  let meta = {};
  if (stillsFilm) {
    // The clip is the storyboard's own stills, cross-dissolved. There is no
    // provider to name and nothing to probe — the encoder was told exactly how
    // many frames to write — so the metadata comes straight from the render.
    usedProvider = {
      id: "storyboard_stills",
      label: `Storyboard stills ×${stillsFilm.stills}`,
      kind: "stills",
      fps: stillsFilm.fps,
    };
    finalBlob = stillsFilm.blob;
    meta = {
      width: stillsFilm.width,
      height: stillsFilm.height,
      duration: stillsFilm.duration,
      fps: stillsFilm.fps,
      encoder: stillsFilm.encoder,
      stills: stillsFilm.stills,
      short: false,
    };
    emit({ type: "progress", value: 1, label: "ready" });
  } else if (clips.length === 1) {
    const native = Number(usedProvider?.fps) || 0;
    const want = Number(fps) || 0;
    let clipBlob = clips[0];
    let retimed = null;
    // A free or commercial model renders at its own rate and will not be asked
    // for another, so a rate that was actually *chosen* is applied here rather
    // than being written on the label and nowhere else. The on-device renderer
    // already encoded at the chosen rate, and the GPU server interpolates, so
    // only the pooled and keyed models need this.
    if (want && native && want !== native && usedProvider?.kind !== "offline" && usedProvider?.kind !== "server") {
      emit({ type: "stage", stage: "retiming", message: `Re-timing the clip to ${want} fps…` });
      retimed = await withTimeout(
        retimeClip(clipBlob, {
          fps: want,
          fromFps: native,
          duration: Number(lastSegMeta?.duration) || 0,
          signal,
          onProgress: (p) => emit({ type: "progress", value: 0.5 + p * 0.5, label: "re-timing" }),
        }),
        600000
      ).catch((e) => {
        emit({ type: "log", level: "warn", text: `Could not re-time the clip to ${want} fps (${e.message}) — keeping the model's own rate.` });
        return null;
      });
      if (retimed?.blob) {
        clipBlob = retimed.blob;
        emit({ type: "log", text: `re-timed ${native} fps → ${want} fps (${retimed.frames} frames, ${retimed.encoder})` });
      }
    }
    const info = await withTimeout(
      (async () => {
        const { probe } = await import("./video.js");
        return await probe(clipBlob);
      })(),
      12000
    ).catch(() => ({}));
    const probed = Number(info?.duration) || 0;
    const known = Number(retimed?.duration) || Number(lastSegMeta?.duration) || 0;
    // A single model renders to its own window, which lands a little either side
    // of the request (Wan's 5 s is 81 frames at 16 fps — 5.06 s). Over-length is
    // cut back to what was asked for; under-length is reported, not stretched.
    const realDur = !durationIsSuspect(probed) ? probed : known || probed;
    let finalDur = realDur > 0 ? realDur : duration;
    let short = false;
    if (usedProvider?.kind !== "offline" && realDur > duration + 0.05) {
      const trimmed = await withTimeout(
        retimeClip(clipBlob, {
          fps: retimed?.fps || Number(lastSegMeta?.fps) || native || 16,
          fromFps: native,
          duration: realDur,
          targetDuration: duration,
          signal,
          onProgress: (p) => emit({ type: "progress", value: 0.5 + p * 0.5, label: "trimming" }),
        }),
        600000
      ).catch(() => null);
      if (trimmed?.blob) {
        clipBlob = trimmed.blob;
        finalDur = trimmed.duration;
        emit({ type: "log", text: `trimmed to the ${duration}s asked for (was ${realDur.toFixed(2)}s)` });
      }
    } else if (realDur > 0 && realDur < duration - 0.05) {
      short = true;
      emit({
        type: "log",
        level: "warn",
        text: `The model returned ${realDur.toFixed(2)}s of the ${duration}s asked for — this is the model's own window, and it is the real length of the clip.`,
      });
    }
    finalBlob = clipBlob;
    meta = {
      width: info?.width || retimed?.width || lastSegMeta?.width,
      height: info?.height || retimed?.height || lastSegMeta?.height,
      // A container with broken metadata reports nonsense here (a 5 s clip once
      // came back as 4876 s); the segment already knows what it rendered.
      duration: finalDur,
      short,
      fps: retimed?.fps || Number(lastSegMeta?.fps) || native || 0,
      encoder: retimed?.encoder || lastSegMeta?.encoder,
      // What a GPU server actually did with the job — precision, adapters and
      // whether it interpolated — so the result note can say it out loud.
      lora: lastSegMeta?.lora || null,
      precision: lastSegMeta?.precision || null,
      interpolated: !!lastSegMeta?.interpolated,
    };
    emit({ type: "progress", value: 1, label: "ready" });
  } else {
    emit({ type: "stage", stage: "stitching", message: `Stitching ${clips.length} segments…` });
    // Native rate when nothing was chosen: a Wan chain belongs at 16 fps, and
    // encoding it at a guess of 24 would invent frames nobody made.
    const stitchFps = Number(fps) || Number(usedProvider?.fps) || 24;
    const stitched = await stitch(clips, {
      fps: stitchFps,
      // Storyboard beats butt up against each other — see `cfSec` above — so
      // they are cut together with no crossfade and no lost time. A plain chain
      // keeps the user's crossfade between its independent segments.
      crossfade: sbPlan ? 0 : settings.crossfade ?? 0.25,
      targetDuration: duration,
      signal,
      onProgress: (p) => emit({ type: "progress", value: 0.5 + p * 0.5, label: "stitching" }),
    });
    if (stitched.skipped) {
      emit({
        type: "log",
        level: "warn",
        text:
          `${stitched.skipped} returned clip${stitched.skipped === 1 ? "" : "s"} could not be read back as video and ` +
          `${stitched.skipped === 1 ? "was" : "were"} left out of the finished file — the beats that did render were kept ` +
          `rather than losing the whole run to one corrupt download.`,
      });
    }
    if (stitched.short) {
      emit({
        type: "log",
        level: "warn",
        text:
          `The chain holds ${stitched.timeline.toFixed(2)}s of the ${duration}s asked for — ` +
          `${clips.length} beats were rendered and the rest of the routes refused. Press Generate again for the ` +
          `remaining ${(duration - stitched.timeline).toFixed(1)}s (each run starts from a clean slate), or ask for a shorter clip.`,
      });
    } else if (stitched.timeline > duration + 0.1) {
      emit({
        type: "log",
        text: `${clips.length} beats made ${stitched.timeline.toFixed(2)}s — cut back to the ${duration}s asked for.`,
      });
    }
    finalBlob = stitched.blob;
    meta = {
      width: stitched.width,
      height: stitched.height,
      duration: stitched.duration,
      short: !!stitched.short,
      timeline: stitched.timeline,
      fps: stitched.fps,
      encoder: stitched.encoder,
    };
    emit({ type: "progress", value: 1, label: "ready" });
  }

  // The file the user keeps is always the shape they picked. Pooled models
  // render at their own shape (a 16:9 request routinely comes back 1:1), so the
  // finished clip is reframed to the requested ratio here — centre cover-crop
  // at its own scale, never stretched or letterboxed — whatever path made it.
  {
    const wantRatio = ASPECTS[aspect]?.ratio || 16 / 9;
    const curW = Number(meta?.width) || 0;
    const curH = Number(meta?.height) || 0;
    const off = curW > 0 && curH > 0 ? Math.abs(curW / curH - wantRatio) / wantRatio : 0;
    if (!stillsFilm && (!curW || !curH || off >= 0.015) && finalBlob) {
      try {
        emit({ type: "stage", stage: "reframing", message: `Framing the clip to ${aspect}…` });
        const fixed = await withTimeout(
          normalizeToAspect(finalBlob, {
            ratio: wantRatio,
            fps: Number(meta?.fps) || Number(fps) || Number(usedProvider?.fps) || 24,
            duration: Number(meta?.duration) || duration,
            signal,
          }),
          600000
        ).catch(() => null);
        if (fixed?.blob && fixed.changed) {
          finalBlob = fixed.blob;
          meta = { ...meta, width: fixed.width, height: fixed.height };
          emit({
            type: "log",
            level: "warn",
            text: `The model returned ${curW || "?"}×${curH || "?"} for a ${aspect} request, so the clip was reframed to ${fixed.width}×${fixed.height} (centre crop, nothing stretched).`,
          });
        } else if (fixed && !fixed.changed) {
          meta = { ...meta, width: fixed.width || curW, height: fixed.height || curH };
        }
      } catch {
        /* keep the clip as rendered rather than failing the run over framing */
      }
    }
    meta = { ...meta, aspect };
  }

  return {
    blob: finalBlob,
    clips: clips.length,
    provider: usedProvider,
    providerLabel: usedProvider?.label || "?",
    prompt: composed,
    negative: neg,
    seed,
    duration,
    aspect,
    quality,
    cameraMove,
    cameraAngle,
    tracking,
    trackStrength,
    style,
    nsfw,
    meta,
    frames: lastSegFrames,
    // The frame the chain actually reached — always a real picture, so a stopped
    // run has something to continue from (see `resume`).
    lastFrame: lastFrame || lastSegFrame,
    madeSec: Math.round(coveredSec() * 100) / 100,
    // What a continuation needs to pick this run up without paying for anything
    // twice: the clips already rendered, the drawn keyframes, and where on the
    // ladder the chain got to.
    clipBlobs: clips.slice(),
    storyFrames: sbPlan && sbFrames.size ? [...sbFrames.entries()] : null,
    storySegments: sbPlan ? sbPlan.segments : 0,
    reachedBoundary,
    askScale,
    stills: stillsFilm ? stillsFilm.stills : 0,
    fps: meta.fps || fps || usedProvider?.fps || null,
    undress: !!undress,
    storyboard: sbPlan ? sbPlan.segments : 0,
    staticRerenders,
    // How many re-renders happened because a clip came back wrong (motionless,
    // blown out, melted, or not the shot it was handed), and how many beats no
    // model could get right at all. Both are said out loud on the result card
    // rather than being hidden behind a "done".
    rerenders: staticRerenders,
    imperfectBeats: dubiousBeats,
    // How many beats actually got real, copied motion (and who animated the
    // driving clip), so the result card can say it instead of guessing.
    motion: sbPlan && motionOn ? { beats: driverClips.size, driver: driverProvider?.label || null } : null,
    offline: usedOffline,
    elapsed: Date.now() - started,
  };
}

const dataUrlCache = new WeakMap();
async function blobToDataUrlCached(blob) {
  if (dataUrlCache.has(blob)) return dataUrlCache.get(blob);
  const p = new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(blob);
  });
  dataUrlCache.set(blob, p);
  return p;
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}
