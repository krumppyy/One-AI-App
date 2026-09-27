/**
 * The friendly face of a run — plain-English studio talk for the run log and
 * the Stage's busy overlay, with nothing about routes, relays, model ids,
 * queues or pipelines in it.
 *
 * Why this exists: the full log is a build diary (which provider answered,
 * which relay it left from, what the storyboard is doing rung by rung). That
 * is exactly what the owner needs to debug — and exactly what a visitor, or a
 * screenshot of the app, should never show. So the log has two modes: Simple
 * (this file — local rotating lines, no network, no cost) and Full (the raw
 * engine events). The owner flips to Full when something needs debugging.
 */

export const LOG_MODES = [
  { id: "simple", label: "Simple" },
  { id: "full", label: "Full" },
];

let _n = 0;
const pick = (arr) => arr[_n++ % arr.length];

/** Busy-overlay label + message per engine stage. */
export function friendlyStage(stage) {
  switch (String(stage || "")) {
    case "uploading":
      return { label: "preparing", msg: "Preparing your picture…" };
    case "queued":
      return { label: "warming up", msg: pick(["Warming up the studio…", "Booking a canvas…", "Lighting the set…"]) };
    case "running":
      return { label: "dreaming", msg: pick(["Dreaming your clip…", "Filming the scene…", "Painting the motion…"]) };
    case "downloading":
      return { label: "finishing", msg: "Bringing your clip home…" };
    case "rendering":
      return { label: "animating", msg: "Animating on this device…" };
    case "keyframe":
      return { label: "sketching", msg: pick(["Sketching the opening frame…", "Setting the first frame…"]) };
    case "nsfw":
      return { label: "preparing", msg: "Preparing the opening frame…" };
    case "stills":
      return { label: "assembling", msg: "Assembling your clip…" };
    case "storyboard":
      return { label: "directing", msg: pick(["Directing the scene…", "Blocking the next shot…"]) };
    case "stitching":
      return { label: "blending", msg: "Blending it into one clip…" };
    default:
      return { label: "working", msg: pick(["Working on it…", "Still at it…", "Almost there…"]) };
  }
}

export function friendlyRunStart(spec) {
  return pick([
    `Rolling — your ${spec} clip is on the set…`,
    `And… action! Your ${spec} clip is filming…`,
    `Studio is live — crafting your ${spec} clip…`,
  ]);
}

export function friendlyPlan() {
  return pick(["The studio is ready — rolling…", "Canvas booked — here we go…"]);
}

export function friendlyBeats() {
  return pick(["Planning the scenes…", "Storyboarding your clip…"]);
}

export function friendlyBeat() {
  return pick(["Directing the next moment…", "Shaping the motion…", "Framing the shot…"]);
}

export function friendlySegment(index, total) {
  return `Filming part ${index} of ${total}…`;
}

export function friendlyClip() {
  return pick(["That part looks good — keeping it…", "Lovely take — moving on…", "In the can — next part…"]);
}

export function friendlyDone(mb, sec) {
  return pick([`Your clip is ready (${mb} MB · ${sec}s) — enjoy the premiere…`]);
}

export function friendlyCancel() {
  return "Stopped — the set is cleared.";
}
