/**
 * The storyboard: turning the hidden rung ladder in main.pjs into the actual
 * pictures a clip is built from.
 *
 * WHY THIS EXISTS
 * ---------------
 * A video diffusion model does not invent a body. It animates the frame it is
 * handed, and the further it has to move from that frame, the mushier the
 * result — which is exactly why a prompt-only "undress" came back as a dressed
 * person standing still, or a badly-drawn figure with a blank face. Handing an
 * image-to-video model a *nude* starting frame and asking it to undress someone
 * is the same mistake in reverse: there is nothing left to undress.
 *
 * So the rungs in main.pjs are turned into PICTURES first — a storyboard. Each
 * rung is drawn as a still (a pose, an expression, one less garment), and only
 * then is each gap between two stills given to a video model to animate. That
 * is what makes the body actually change over the clip, and it is why the
 * figure and the face stay coherent: the drawing is done by an image model at
 * the rung's own pose, and (for the rungs that take a garment off) by
 * inpainting only the clothing pixels, so everything else is the previous
 * frame's own pixels, pixel for pixel.
 *
 * Nothing here is exposed to the UI. The ladder lives in main.pjs, the drawing
 * happens here, and the user only ever sees the finished clip.
 */

import { SpaceError } from "./gradio.js";
import { imageChange } from "./image.js";
import { analyzeFigure, FULL_FIGURE_HINT } from "./figure.js";
import { changeExpression, drawExplicitFrame, evolveFrame, undressImageInpaint, INPAINT_NEGATIVE } from "./nsfw.js";

/**
 * JS mirror of `nsfwStoryboard` in main.pjs, used when the list is missing
 * (an old saved copy of the generator, or a unit test). Keep the two in step.
 */
export const STORYBOARD_FALLBACK = [
  {
    label: "standing",
    method: "start",
    garment: "wearing her own outfit, exactly as in the input picture",
    action: "she stands still, breathing, shifting her weight slowly, looking at the camera",
    pose: "the same pose, framing and camera distance as the input picture",
    expression: "calm, looking into the lens, lips slightly parted",
  },
  {
    label: "hands on her body",
    method: "evolve",
    garment: "wearing her own outfit, exactly as in the input picture",
    action: "her hands move slowly down over her body, over her hips and back up, anticipation building",
    pose: "the same pose, framing and camera distance as the input picture",
    expression: "steady gaze at the lens, lips parting",
  },
  {
    label: "top open",
    method: "top",
    garment: "her top pulled open, bare breasts visible, the same garment pushed aside",
    action: "she peels her top open and lets it hang, her bare chest coming free, breasts moving as they settle",
    pose: "the same pose, framing and camera distance as the input picture",
    expression: "flushed cheeks, lips parted, eyes on the lens",
  },
  {
    label: "topless",
    method: "top",
    garment: "topless, bare breasts, her top gone",
    action: "she slips the top off her shoulders and lets it drop away, then runs both hands slowly over her bare chest",
    pose: "the same pose, framing and camera distance as the input picture",
    expression: "eyes half closed, soft pleased smile",
  },
  {
    label: "bottoms off",
    method: "bottom",
    garment: "topless and completely nude, nothing on",
    action: "she hooks her thumbs into her waistband and works her bottoms down over her hips, stepping out of them",
    pose: "the same pose, framing and camera distance as the input picture",
    expression: "biting her lower lip, glancing up at the camera",
  },
  {
    label: "nude",
    method: "evolve",
    garment: "completely nude",
    action: "completely nude, she runs her hands slowly over her breasts and down over her stomach, breathing visibly",
    pose: "the same pose, framing and camera distance as the input picture",
    expression: "direct confident gaze, small knowing smile",
  },
  {
    label: "sensual",
    method: "evolve",
    garment: "completely nude",
    action:
      "she arches slightly and moves sensually, hands on her breasts and hips, chest rising and falling as she breathes",
    pose: "the same pose, framing and camera distance as the input picture",
    expression: "eyes closing, mouth open, aroused",
  },
  {
    label: "closer",
    method: "evolve",
    garment: "completely nude",
    action: "she leans toward the camera, moving slowly and sensually, chest moving with her breath",
    pose: "the same pose, framing and camera distance as the input picture",
    expression: "smouldering look straight into the lens",
  },
];

/** The methods a rung may use to get its picture from the one before it. */
export const FRAME_METHODS = ["start", "evolve", "top", "bottom", "all"];

/**
 * The identity + scene clause that leads EVERY keyframe prompt.
 *
 * This is the fix for the clip that changed person and place halfway through.
 * A hidden rung's action used to name a location ("she walks nude through the
 * jungle"), and because a rung's picture is made with an image model — img2img
 * at 0.55-0.85 or an inpaint — a named place in the prompt is a place the
 * model will happily *build*, replacing the user's own room and, with it, the
 * face that was standing in it. The rungs themselves no longer name a place
 * (they describe only what the body does), and this clause pins the picture to
 * the reference: same woman, same room, same light, same lens.
 */
export const FRAME_ANCHOR =
  "the exact same woman as the input picture, identical face, hair and body, " +
  "the same place, the same background, the same lighting and the same camera angle, " +
  "unchanged identity";

/**
 * The other half of `FRAME_ANCHOR`: what a drift looks like, named so the
 * worker can avoid it. The scene words are generic — they forbid *inventing* a
 * place, not any one place in particular.
 */
export const FRAME_NEGATIVE =
  "different woman, different face, changed identity, different hair, different location, " +
  "changed background, different room, new scene, changed environment, changed setting, " +
  "extra people, second person, two women, man, cartoon, anime, illustration, 3d render, " +
  "cgi, plastic skin, deformed anatomy, distorted face, blurry, lowres, watermark, text, logo";

/**
 * Appended to every keyframe prompt. A plain "undress" prompt gives a static,
 * badly-proportioned doll with a blank face; naming the anatomy, the face and
 * the photographic finish is what makes the *picture* the clip is built from
 * look like a real person, and every video frame inherits it.
 *
 * It deliberately asks for the *input's* framing rather than a full body: the
 * reference is what is being edited, and demanding a full-length shot of a
 * chest-up portrait is how a model is talked into re-drawing the person to
 * make room for the feet.
 */
export const FRAME_QUALITY =
  "photorealistic, anatomically correct, realistic human proportions, natural skin texture " +
  "with visible pores, sharp focus, professional photography, the same shot, the same camera " +
  "distance and the same composition as the input picture";

/**
 * Appended to every beat's *motion* prompt. A diffusion video model renders
 * what it is told to render, so "she stands there" is what comes back unless
 * the movement is spelled out — this is the wording that makes the whole body,
 * the hair and the face move together. Read from `storyboardMotion` in main.pjs
 * so it can be reworded without touching code.
 */
export function storyboardMotion() {
  try {
    const v = typeof root !== "undefined" ? root.storyboardMotion : null;
    const s = v == null ? "" : String(v.evaluateItem ?? v).trim();
    if (s) return s;
  } catch {}
  return (
    "natural realistic human movement, whole body in motion, weight shifting from foot to foot, " +
    "hips and shoulders counter-rotating as she moves, arms swinging loosely, breasts bouncing and " +
    "settling with the motion, head turning, hair moving, breathing, blinking, lips and jaw moving " +
    "as her expression changes, anatomically correct proportions, smooth continuous motion"
  );
}

/** The methods that remove clothing by inpainting only the clothing pixels. */
const INPAINT_METHODS = { top: "top", bottom: "bottom", all: "all" };

function str(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  return String(v.evaluateItem ?? v).trim();
}

/**
 * Read the rung ladder. `root.nsfwStoryboard` first; if that list is missing,
 * the older flat `undressStages` ladder is turned into rungs (its first line is
 * the state she starts in; the rest remove the top, then the top again, then
 * the bottoms, then only change the pose — the same shape the old ladder
 * implied). Never returns an empty list.
 */
export function readStoryboard() {
  const out = [];
  try {
    const raw = typeof root !== "undefined" ? root.nsfwStoryboard : null;
    const items = raw && (Array.isArray(raw) ? raw : raw.selectAll);
    for (const item of items || []) {
      const rung = {
        label: str(item.label) || `rung ${out.length + 1}`,
        method: str(item.method).toLowerCase() || "evolve",
        garment: str(item.garment),
        action: str(item.action),
        pose: str(item.pose),
        expression: str(item.expression),
      };
      if (!FRAME_METHODS.includes(rung.method)) rung.method = "evolve";
      if (rung.action || rung.pose || rung.garment) out.push(rung);
    }
  } catch {
    /* fall through to the fallback */
  }
  if (!out.length) out.push(...fromUndressStages());
  if (!out.length) return STORYBOARD_FALLBACK.map((r) => ({ ...r }));
  out[0].method = "start";
  return out;
}

/** The old flat ladder (`undressStages`) as rungs, for when the storyboard is absent. */
function fromUndressStages() {
  let stages = [];
  try {
    const raw = typeof root !== "undefined" ? root.undressStages : null;
    const items = raw && (Array.isArray(raw) ? raw : raw.selectAll);
    stages = (items || []).map((s) => str(s)).filter(Boolean);
  } catch {
    stages = [];
  }
  if (!stages.length) return [];
  const methods = ["start", "top", "top", "bottom", "evolve", "evolve", "evolve", "evolve"];
  return stages.map((action, i) => ({
    label: `stage ${i + 1}`,
    method: methods[Math.min(i, methods.length - 1)],
    garment: "",
    action,
    pose: "",
    expression: "",
  }));
}

/** The tunables from `storyboard` in main.pjs. */
export function storyboardOptions() {
  const fb = {
    maxBeats: 6,
    beatSeconds: 1.6,
    keyframeWaitMin: 15,
    // How far a rung that is only changing the pose/expression may move the
    // picture. Kept LOW on purpose: this is the dial that decides whether she
    // is still the same woman afterwards, and the video model between the
    // stills supplies the movement anyway (measured failure at 0.55-0.85:
    // the whole scene re-cast).
    poseDenoise: 0.4,
    removeDenoise: 0.85,
    refaceKeyframes: true,
    minFrameChange: 0.02,
    // Character lock. A garment that comes off is always repainted through the
    // on-device clothes mask and never through whole-frame img2img, because the
    // mask is the only thing that provably keeps her face, hair and background
    // her own pixels. Turn it off to let a rung redraw the whole frame.
    lockIdentity: true,
  };
  const bools = new Set(["refaceKeyframes", "lockIdentity"]);
  try {
    const cfg = typeof root !== "undefined" ? root.storyboard : null;
    if (cfg) {
      for (const k of Object.keys(fb)) {
        const raw = cfg[k];
        if (raw === undefined || raw === null || raw === "") continue;
        if (bools.has(k)) {
          // Boolean, but tolerate 0/1 from a list that parsed it as a number.
          fb[k] = typeof raw === "boolean" ? raw : !!Number(raw);
          continue;
        }
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) fb[k] = n;
      }
      // Older saved configs carry `maxKeyframes`; honour it as the beat cap so
      // a list that was never touched still behaves.
      if (!Number.isFinite(Number(cfg.maxBeats)) && Number(cfg.maxKeyframes) > 0) {
        fb.maxBeats = Math.floor(Number(cfg.maxKeyframes));
      }
    }
  } catch {}
  return fb;
}

/**
 * How many beats a clip of `duration` seconds is cut into.
 *
 * A storyboard is deliberately *not* segmented the way a plain run is. A plain
 * run fills a model's whole window with one render, so a 5 s request is one 5 s
 * clip. Here it is the other way round: the clip is cut small — a beat every
 * `beatSeconds` — so each clip only has to move the body a little way, and the
 * keyframe before it and the keyframe after it are close together. That is what
 * "multiple frames jotted down" buys: a body that changes in many small steps
 * reads as a real person moving, where the same change in one step reads as
 * mush. Capped at `maxBeats` because every beat is a real keyframe to draw.
 */
export function planBeats(duration, options = null) {
  const cfg = options || storyboardOptions();
  const t = Math.max(0.25, Number(duration) || 0);
  const each = Math.max(0.5, Number(cfg.beatSeconds) || 1.6);
  const cap = Math.max(1, Math.floor(Number(cfg.maxBeats) || 6));
  return Math.max(1, Math.min(cap, Math.ceil(t / each)));
}

/**
 * Spread the rungs across the segments a clip is split into. Every rung lands
 * in exactly one segment, in order, as evenly as the division allows — so the
 * whole arc happens whether the clip is one long shot or four short ones.
 */
export function planRungs(storyboard, segments) {
  const rungs = storyboard?.length ? storyboard : STORYBOARD_FALLBACK;
  const n = Math.max(1, Math.floor(segments) || 1);
  const m = rungs.length;
  const groups = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * m) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * m) / n));
    groups.push(rungs.slice(a, Math.min(m, b)));
  }
  return groups;
}

/**
 * Which keyframe boundaries get drawn.
 *
 * Boundary 0 is the picture the run already has. Boundary i is the state the
 * clip is in after segment i, so there are `segments` frames to draw — capped
 * at `maxKeyframes` (each one is a real inpaint and costs a real wait). The
 * final boundary is always drawn: "nude by the end" is the point of the run.
 */
export function planBoundaries(segments, maxKeyframes) {
  const n = Math.max(1, Math.floor(segments) || 1);
  const cap = Math.max(1, Math.floor(maxKeyframes) || 1);
  if (n <= cap) return Array.from({ length: n }, (_, i) => i + 1);
  const picked = new Set([n]);
  for (let k = 1; k < cap; k++) {
    picked.add(Math.max(1, Math.round((k * n) / cap)));
  }
  return [...picked].sort((a, b) => a - b);
}

/** The whole plan: which rungs run in which segment, and which boundary ends it. */
export function buildPlan({ storyboard, segments, maxKeyframes }) {
  const groups = planRungs(storyboard, segments);
  const endRung = groups.map((g) => g[g.length - 1]);
  const drawAt = planBoundaries(groups.length, maxKeyframes);
  const drawn = new Set(drawAt);
  const endFor = [];
  for (let i = 0; i < groups.length; i++) {
    const next = drawAt.find((b) => b >= i + 1);
    endFor.push(next ?? null);
  }
  const startFor = [];
  for (let i = 0; i < groups.length; i++) {
    let s = 0;
    for (const b of drawAt) if (b <= i) s = b;
    startFor.push(s);
  }
  return {
    groups,
    endRung,
    drawAt,
    drawn,
    endFor,
    startFor,
    segments: groups.length,
    frames: drawAt.length,
  };
}

/**
 * The prompt for one rung's picture.
 *
 * The subject first (so it keeps being the same person), then the garment, the
 * pose and the face, and finally the quality block — because the picture is
 * what every frame of the clip is built from, so it has to be a properly drawn
 * figure before a single frame of video is rendered.
 */
export function beatPrompt(rung, { base = "", withAction = true, anchor = true } = {}) {
  const parts = [];
  if (anchor) parts.push(FRAME_ANCHOR);
  if (base) parts.push(base.replace(/[,\s]+$/, ""));
  if (rung.garment) parts.push(rung.garment);
  if (withAction && rung.action) parts.push(rung.action);
  if (rung.pose) parts.push(rung.pose);
  if (rung.expression) parts.push(rung.expression);
  parts.push(FRAME_QUALITY);
  return parts.filter(Boolean).join(", ");
}

/**
 * The motion phrase for one segment — what the body does across it. A beat's
 * `action` is written for a still, so it names the move; the living-body block
 * (`storyboardMotion`) is what turns that move into a person actually moving,
 * breathing and changing expression while they do it.
 */
export function segmentMotion(group, base = "", motion = null, { anchor = true } = {}) {
  const actions = (group || []).map((r) => r.action).filter(Boolean);
  const last = (group || [])[group.length - 1];
  const bits = [];
  if (anchor) bits.push(FRAME_ANCHOR);
  if (actionList(actions)) bits.push(actionList(actions));
  if (last?.expression) bits.push(`her face shows ${last.expression}`);
  bits.push(motion || storyboardMotion());
  return bits.join(", ");
}

function actionList(actions) {
  if (!actions.length) return "";
  if (actions.length === 1) return actions[0];
  return actions.slice(0, -1).join(", ") + ", and then " + actions[actions.length - 1];
}

/**
 * Draw the boundary frames, in order, each from the one before it.
 *
 * Returns `{ frames: Map<boundary, Blob>, drawn: number, failed: [stepNumbers] }`.
 * A boundary that could not be drawn is simply absent: the caller falls back to
 * the nearest drawn frame, so a slow queue costs smoothness, never the clip.
 */
export async function drawKeyframes({
  plan,
  input,
  base = "",
  userNegative = "",
  size,
  seed = 0,
  key = "",
  relay = null,
  signal = null,
  onStage = () => {},
  options = null,
  strictPrivacy = false,
}) {
  const cfg = options || storyboardOptions();
  const waitMs = Math.max(60000, cfg.keyframeWaitMin * 60000);
  const frames = new Map();
  if (input) frames.set(0, input);
  let prev = input || null;
  let prevRung = null;
  const failed = [];
  let n = 0;

  for (const boundary of plan.drawAt) {
    if (signal?.aborted) break;
    const rung = plan.endRung[boundary - 1];
    if (!rung) continue;
    n += 1;
    // The ladder itself is backend: nothing the user sees may name the rungs,
    // so every message that leaves here talks in steps, not in garment words.
    const label = `step ${n}/${plan.drawAt.length}`;
    onStage({ boundary, index: n, total: plan.drawAt.length, label, message: `Drawing ${label}…` });
    const prompt = beatPrompt(rung, { base });
    try {
      const blob = await drawOne({
        prev,
        rung,
        prevRung,
        prompt,
        userNegative,
        size,
        seed: seed + boundary * 101,
        key,
        relay,
        signal,
        onStage,
        waitMs,
        cfg,
        strictPrivacy,
        label,
      });
      if (blob) {
        // Did the step that was supposed to take a garment off actually do it?
        // A worker that quietly refused, or a mask that landed on nothing,
        // returns the picture it was handed — and then the clip is built around
        // an undress that never happened. One re-draw, harder, before settling
        // for it. (This is the check that a video model cannot give you: the
        // *stills* are where the clothing changes, so the stills are where it
        // is verified.)
        const removes =
          !!prev &&
          !!prevRung &&
          rung.method !== "start" &&
          (INPAINT_METHODS[rung.method] || (rung.garment || "") !== (prevRung.garment || ""));
        let frame = blob;
        if (removes) {
          const chg = await imageChange(prev, frame).catch(() => null);
          if (chg && chg.changed < (cfg.minFrameChange ?? 0.02)) {
            onStage({
              boundary,
              index: n,
              total: plan.drawAt.length,
              label,
              message: `${label} came back unchanged — re-drawing it harder…`,
            });
            const harder = await drawOne({
              prev,
              rung,
              prevRung,
              prompt: `${prompt}, the clothing is gone, bare skin where it was, no fabric, no garment`,
              userNegative,
              size,
              seed: seed + boundary * 101 + 5003,
              key,
              relay,
              signal,
              onStage,
              waitMs,
              cfg: { ...cfg, poseDenoise: Math.min(0.9, (cfg.poseDenoise || 0.55) + 0.2), removeDenoise: 0.92 },
              strictPrivacy,
              label: `${label} (retry)`,
            }).catch((e) => {
              if (e?.kind === "cancelled") throw e;
              return null;
            });
            if (harder) frame = harder;
          }
        }
        // The face is protected through the clothing inpainting (by design —
        // that is what keeps her *her*), so a rung that changes her expression
        // needs the face redrawn on its own. Only when the expression actually
        // changes, and never as a hard step: if no face is found or the worker
        // refuses, the picture from the step above is kept as it is.
        if (
          cfg.refaceKeyframes !== false &&
          prevRung &&
          rung.method !== "start" &&
          rung.expression &&
          rung.expression !== prevRung.expression
        ) {
          try {
            const faced = await changeExpression({
              image: frame,
              expression: rung.expression,
              seed: seed + boundary * 211,
              key,
              relay: relay?.("post") ?? null,
              signal,
              onStage,
              maxWaitMs: waitMs,
              useModel: !strictPrivacy,
              label: `Framing her expression (${rung.expression})`,
            });
            if (faced) frame = faced;
          } catch (e) {
            if (e?.kind === "cancelled") throw e;
          }
        }
        // Is it a whole figure at all? A motion-transfer beat animates this
        // picture, and a cropped or badly-framed figure becomes a cropped clip
        // with a melted body — so a still that fails the check is drawn once
        // more, asked for wide, and the better of the two is kept. Never a
        // hard step: if the re-draw is no better, the original is kept, and a
        // picture with a background this check cannot segment is passed
        // untouched (`checked: false`).
        if (cfg.verifyFigure) {
          const verdict = await analyzeFigure(frame).catch(() => null);
          if (verdict?.checked && !verdict.ok) {
            onStage({
              boundary,
              index: n,
              total: plan.drawAt.length,
              label,
              message: `${label}: the figure is not whole (${verdict.reason}) — drawing it again, wide…`,
            });
            const fixed = await drawOne({
              prev,
              rung,
              prevRung,
              prompt: `${prompt}, ${FULL_FIGURE_HINT}`,
              userNegative,
              size,
              seed: seed + boundary * 101 + 9001,
              key,
              relay,
              signal,
              onStage,
              waitMs,
              cfg,
              strictPrivacy,
              label: `${label} (figure retry)`,
            }).catch((e) => {
              if (e?.kind === "cancelled") throw e;
              return null;
            });
            if (fixed) {
              const again = await analyzeFigure(fixed).catch(() => null);
              if (!again?.checked || again.ok || (again.score ?? 0) > (verdict.score ?? 0)) frame = fixed;
            }
          }
        }
        frames.set(boundary, frame);
        prev = frame;
        prevRung = rung;
        onStage({ boundary, index: n, total: plan.drawAt.length, label, done: true, message: `${label} drawn` });
      }
    } catch (e) {
      if (e?.kind === "cancelled") throw e;
      failed.push(n);
      onStage({
        boundary,
        index: n,
        total: plan.drawAt.length,
        label,
        failed: true,
        message: `${label} could not be drawn (${e?.message || e}) — the clip will use the frame before it`,
      });
    }
  }

  return { frames, drawn: plan.drawAt.filter((b) => frames.has(b)).length, failed };
}

/** Draw a single rung's picture from the frame before it. */
async function drawOne({ prev, rung, prevRung, prompt, userNegative = "", size, seed, key, relay, signal, onStage, waitMs, cfg, strictPrivacy, label }) {
  const negJoin = (base) => [String(userNegative || "").trim(), String(base || "").trim()].filter(Boolean).join(", ");
  const common = {
    prompt,
    seed,
    key,
    signal,
    onStage,
    maxWaitMs: waitMs,
  };
  // No picture at all yet (a text-only run): the start rung is simply drawn.
  if (rung.method === "start" || !prev) {
    return await drawExplicitFrame({
      prompt,
      size,
      seed,
      relay: relay?.("get") ?? null,
      signal,
      // Anchor only when there is a reference to anchor to.
      anchor: !!prev,
      negative: negJoin(prev ? FRAME_NEGATIVE : ""),
    });
  }
  const garmentChanges = !!prevRung && (rung.garment || "") !== (prevRung.garment || "");
  // Character lock: a garment that comes off is repainted through the on-device
  // clothes mask (inpainting), never through whole-frame img2img. The mask is
  // the only method that provably keeps her face, hair and background her own
  // pixels — everything outside it is copied back from the previous frame at
  // full resolution. Whole-frame img2img at 0.55-0.85 is what re-cast her.
  const want =
    INPAINT_METHODS[rung.method] || (cfg.lockIdentity !== false && garmentChanges ? "all" : null);
  if (want) {
    const res = await undressImageInpaint({
      image: prev,
      prompt,
      seed,
      key,
      relay: relay?.("post") ?? null,
      signal,
      onStage,
      maxWaitMs: waitMs,
      want,
      useFaceModel: !strictPrivacy,
      useSegmentation: true,
      composite: true,
      negative: negJoin(INPAINT_NEGATIVE),
    });
    if (res?.blob) return res.blob;
    throw new SpaceError("the repaint came back empty", "empty");
  }
  // Nothing coming off — only the pose and the face change, so a *light*
  // img2img keeps the person while nudging the body. A rung that changes the
  // clothing but is drawn this way (only reachable with the character lock
  // switched off) needs the stronger dial, or the garment merely gets thinner
  // instead of coming off.
  return await evolveFrame({
    ...common,
    image: prev,
    relay: relay?.("post") ?? null,
    denoise: garmentChanges ? cfg.removeDenoise : cfg.poseDenoise,
    anchor: true,
    negative: negJoin(FRAME_NEGATIVE),
    label: `Moving the pose on (${label})`,
  });
}

/** The frame a segment should start from: the nearest drawn boundary at or before it. */
export function startFrameFor(frames, plan, segmentIndex) {
  const b = plan.startFor[segmentIndex];
  for (let i = b; i >= 0; i--) {
    const f = frames.get(i);
    if (f) return f;
  }
  return null;
}

/** The frame a segment should end on: the nearest drawn boundary after it, or null. */
export function endFrameFor(frames, plan, segmentIndex) {
  const b = plan.endFor[segmentIndex];
  if (b == null) return null;
  for (let i = b; i <= plan.segments; i++) {
    const f = frames.get(i);
    if (f) return f;
  }
  return null;
}
