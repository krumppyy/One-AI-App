/**
 * The stage player.
 *
 * The old stage was one fixed 16:9 box, so a 9:16 or 1:1 clip sat in the middle
 * of a wide black frame and a 21:9 clip was letter-boxed twice. Here the box is
 * sized in pixels to the clip's own aspect ratio, fitted inside both the column
 * width and whatever height the current page view actually leaves — so a
 * portrait clip becomes a tall narrow card, a landscape clip fills the column,
 * and nothing is ever cropped or double-letterboxed.
 *
 * On top of the picture sits a small custom transport (play/pause, scrub, and a
 * speed stepper down to x0.25 and up to x8) instead of the browser's native
 * control bar.
 */

// Fast-forward is the point of the stepper, so the whole-number rungs sit next
// to each other and the fast end runs well past real time: 1·2·3·4·5·6·7·8.
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 7, 8];
const IDLE_HIDE_MS = 2200;

import { repairDuration } from "./encode.js";

const $ = (id) => document.getElementById(id);

const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5.5h3.4v13H7zM13.6 5.5H17v13h-3.4z"/></svg>',
  sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3l4-3.2v11.4l-4-3.2H4zM15.5 8.6a5 5 0 0 1 0 6.8l1.2 1.2a6.7 6.7 0 0 0 0-9.2z"/></svg>',
  mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3l4-3.2v11.4l-4-3.2H4zM15.2 9.4l1.4-1.4 2.6 2.6 2.6-2.6 1.4 1.4-2.6 2.6 2.6 2.6-1.4 1.4-2.6-2.6-2.6 2.6-1.4-1.4 2.6-2.6z"/></svg>',
  loop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 7h9.2l-1.9-1.9 1.4-1.4L19 7.6l-3.8 3.8-1.4-1.4 1.9-1.9H6.5a3 3 0 0 0-3 3v1.5H1.7V10a4.8 4.8 0 0 1 4.8-3zM17.5 17H8.3l1.9 1.9-1.4 1.4L5 16.4l3.8-3.8 1.4 1.4L8.3 16h9.2a3 3 0 0 0 3-3v-1.5h1.8V13a4.8 4.8 0 0 1-4.8 4z"/></svg>',
  fit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h7v2H5v5H3zM14 3h7v7h-2V5h-5zM3 14h2v5h5v2H3zM19 14h2v7h-7v-2h5z"/></svg>',
  fill: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h18v18H3zm2 2v14h14V5z" opacity=".55"/><path d="M6 6h12v12H6z"/></svg>',
  expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z"/></svg>',
};

let video = null;
let screen = null;
let bar = null;
let rate = 1;
let loop = true;
let muted = false;
let fit = "contain";
let idleTimer = null;
let scrubbing = false;
let hasClip = false;
// The length the clip is *known* to be. A recorded WebM carries no duration of
// its own (that is how a 5 s clip reported 81:16), and the element sometimes
// keeps a stale or absurd number for a moment — the stage must show the length
// that was actually asked for, not whatever the container claims.
let knownDuration = 0;

/** The length to trust: what we were told, else the file's, else nothing. */
function clipDuration() {
  if (knownDuration > 0) return knownDuration;
  return video && isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
}

/* ------------------------------------------------------------------ sizing */

/** Height (px) the stage can give the picture right now. */
function availableHeight() {
  const vh = window.visualViewport?.height || window.innerHeight || 600;
  const top = screen.getBoundingClientRect().top;
  // When the stage is on-screen, fill the rest of the viewport. When it's below
  // the fold (single-column layouts) `top` can be thousands of pixels, so cap to
  // a fraction of the viewport instead of collapsing the box to its minimum.
  const usedTop = top >= 0 && top < vh - 80 ? top : Math.min(vh * 0.22, 130);
  return Math.max(150, vh - usedTop - 16);
}

/**
 * Size the picture box to the media's own aspect ratio, inside the column and
 * inside the visible page height. Called on load, on every resize, and whenever
 * the media changes.
 */
export function fitStage() {
  if (!screen) return;
  // Prefer the clip that's actually loaded, then a visible still, then the
  // aspect you've picked in the form. Never trust `videoWidth` alone: after the
  // source is removed some browsers keep reporting the last clip's dimensions.
  let ar = 0;
  if (hasClip && video.videoWidth) ar = video.videoWidth / video.videoHeight;
  const poster = $("outPoster");
  if (!ar && poster && !poster.hidden && poster.naturalWidth) ar = poster.naturalWidth / poster.naturalHeight;
  if (!ar && screen.dataset.ar) ar = Number(screen.dataset.ar) || 0;
  if (!isFinite(ar) || ar <= 0) ar = 16 / 9;
  const col = screen.parentElement;
  // `clientWidth` includes the column's padding, and the box must fit the
  // *content* area — otherwise a wide clip is silently clipped by `max-width`.
  const cs = col ? getComputedStyle(col) : null;
  const padX = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0;
  const availW = Math.max(170, (col?.clientWidth || screen.clientWidth || 640) - padX);
  let w = availW;
  let h = w / ar;
  const availH = availableHeight();
  if (h > availH) {
    h = availH;
    w = h * ar;
  }
  screen.style.width = `${Math.round(w)}px`;
  screen.style.height = `${Math.round(h)}px`;
  screen.style.marginInline = "auto";
  // The transport must fit the *box*, not the viewport — a 9:16 clip on a wide
  // desktop still leaves a narrow strip. Drop the smaller buttons as it narrows.
  screen.classList.toggle("p-narrow", w < 430);
  screen.classList.toggle("p-tiny", w < 300);
}

function onResize() {
  fitStage();
}
window.addEventListener("resize", onResize, { passive: true });
window.addEventListener("orientationchange", () => setTimeout(onResize, 250), { passive: true });
window.visualViewport?.addEventListener("resize", onResize, { passive: true });
if (typeof ResizeObserver !== "undefined") {
  const ro = new ResizeObserver(() => fitStage());
  // The screen's parent is stable for the life of the page.
  queueMicrotask(() => screen?.parentElement && ro.observe(screen.parentElement));
}

/* ----------------------------------------------------------------- controls */

export function setRate(next) {
  rate = Math.max(SPEEDS[0], Math.min(SPEEDS[SPEEDS.length - 1], next));
  if (video) video.playbackRate = rate;
  const label = $("speedVal");
  if (label) label.textContent = `x${rate}`;
  document.querySelectorAll("#speedDown").forEach((b) => (b.disabled = rate <= SPEEDS[0]));
  document.querySelectorAll("#speedUp").forEach((b) => (b.disabled = rate >= SPEEDS[SPEEDS.length - 1]));
}

function stepRate(dir) {
  if (dir > 0) {
    const next = SPEEDS.find((s) => s > rate + 1e-6);
    setRate(next ?? SPEEDS[SPEEDS.length - 1]);
  } else {
    const lower = [...SPEEDS].reverse().find((s) => s < rate - 1e-6);
    setRate(lower ?? SPEEDS[0]);
  }
}

function paintPlay() {
  const btn = $("playBtn");
  if (!btn) return;
  const playing = video && !video.paused && !video.ended;
  btn.innerHTML = playing ? ICON.pause : ICON.play;
  btn.title = playing ? "Pause (space)" : "Play (space)";
  btn.setAttribute("aria-label", playing ? "Pause" : "Play");
}

function paintLoop() {
  const btn = $("loopBtn");
  if (btn) btn.classList.toggle("on", loop);
}

function paintMute() {
  const btn = $("muteBtn");
  if (btn) btn.innerHTML = muted ? ICON.mute : ICON.sound;
}

function paintFit() {
  const btn = $("fitBtn");
  if (!btn) return;
  btn.innerHTML = fit === "contain" ? ICON.fit : ICON.fill;
  btn.title = fit === "contain" ? "Fit — show the whole frame" : "Fill — crop to the frame";
  [video, $("outPoster")].forEach((m) => {
    if (m) m.style.objectFit = fit;
  });
}

function fmt(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function paintTime() {
  const now = $("timeNow");
  const total = $("timeTotal");
  const dur = clipDuration();
  const seek = $("seekRange");
  const dragT = seek && dur ? (Number(seek.value) / 1000) * dur : 0;
  const t = scrubbing ? dragT : video?.currentTime || 0;
  if (now) now.textContent = fmt(t);
  if (total) total.textContent = fmt(dur);
  if (!seek) return;
  const p = dur ? Math.max(0, Math.min(1, t / dur)) : 0;
  if (!scrubbing) seek.value = String(Math.round(p * 1000));
  const pct = (p * 100).toFixed(2);
  seek.style.background = `linear-gradient(90deg, var(--cyan) ${pct}%, rgba(255,255,255,.16) ${pct}%)`;
}

function showBar(on) {
  if (!bar) return;
  bar.classList.toggle("hide", !on);
}

function wake() {
  showBar(true);
  clearTimeout(idleTimer);
  // Only the fullscreen view fades the transport away — in the page the controls
  // stay put so play/pause and the speed stepper are always where you left them.
  if (video && !video.paused && document.fullscreenElement) {
    idleTimer = setTimeout(() => {
      showBar(false);
      bar?.classList.remove("hover");
    }, IDLE_HIDE_MS);
  }
}

export function togglePlay() {
  if (!video || video.hidden) return;
  if (video.paused || video.ended) video.play().catch(() => {});
  else video.pause();
  wake();
}

function toggleFullscreen() {
  const host = screen;
  if (!host) return;
  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
    return;
  }
  host.requestFullscreen?.().then(() => {
    // On a phone, fullscreening a wide clip is pointless in portrait — ask for
    // landscape. Harmless where the API is missing or refuses (desktop).
    try {
      const w = video?.videoWidth || 0;
      const h = video?.videoHeight || 0;
      if (w && h && screen.orientation?.lock) screen.orientation.lock(w >= h ? "landscape" : "portrait").catch(() => {});
    } catch {}
  }).catch(() => {});
}

export function initPlayer() {
  video = $("outVideo");
  screen = $("screen");
  bar = $("playerBar");
  if (!video || !screen || !bar) return;

  setRate(1);
  paintLoop();
  paintMute();
  paintFit();

  $("playBtn")?.addEventListener("click", togglePlay);
  $("speedDown")?.addEventListener("click", () => {
    stepRate(-1);
    wake();
  });
  $("speedUp")?.addEventListener("click", () => {
    stepRate(1);
    wake();
  });
  $("loopBtn")?.addEventListener("click", () => {
    loop = !loop;
    video.loop = loop;
    paintLoop();
    wake();
  });
  $("muteBtn")?.addEventListener("click", () => {
    muted = !muted;
    video.muted = muted;
    paintMute();
    wake();
  });
  $("fitBtn")?.addEventListener("click", () => {
    fit = fit === "contain" ? "cover" : "contain";
    paintFit();
    wake();
  });
  $("fsBtn")?.addEventListener("click", toggleFullscreen);

  const seek = $("seekRange");
  if (seek) {
    const seekTo = () => {
      const dur = clipDuration();
      video.currentTime = (Number(seek.value) / 1000) * dur;
    };
    seek.addEventListener("input", () => {
      scrubbing = true;
      paintTime();
    });
    seek.addEventListener("change", () => {
      seekTo();
      scrubbing = false;
    });
    seek.addEventListener("pointerup", () => {
      seekTo();
      scrubbing = false;
    });
  }

  video.addEventListener("loadedmetadata", () => {
    video.loop = loop;
    video.playbackRate = rate;
    fitStage();
    paintTime();
  });
  video.addEventListener("timeupdate", paintTime);
  video.addEventListener("durationchange", paintTime);
  video.addEventListener("play", () => {
    paintPlay();
    wake();
  });
  video.addEventListener("pause", () => {
    paintPlay();
    showBar(true);
    clearTimeout(idleTimer);
  });
  video.addEventListener("ended", paintPlay);
  video.addEventListener("click", togglePlay);
  video.addEventListener("dblclick", toggleFullscreen);

  screen.addEventListener("pointermove", () => {
    bar.classList.add("hover");
    wake();
  });
  screen.addEventListener("pointerleave", () => {
    bar.classList.remove("hover");
    if (document.fullscreenElement && video && !video.paused) showBar(false);
  });
  document.addEventListener("fullscreenchange", () => {
    showBar(true);
    setTimeout(fitStage, 120);
  });
  requestAnimationFrame(() => fitStage());

  window.addEventListener(
    "keydown",
    (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      if (["input", "textarea", "select"].includes(tag) || e.target?.isContentEditable) return;
      if (video.hidden && !screen.dataset.ar) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight") {
        video.currentTime = Math.min(video.duration || 0, video.currentTime + 1 / 6);
        wake();
      } else if (e.key === "ArrowLeft") {
        video.currentTime = Math.max(0, video.currentTime - 1 / 6);
        wake();
      } else if (e.key === "]" || e.key === "+") {
        stepRate(1);
        wake();
      } else if (e.key === "[" || e.key === "-") {
        stepRate(-1);
        wake();
      } else if (e.key.toLowerCase() === "f") {
        toggleFullscreen();
      } else if (e.key.toLowerCase() === "l") {
        loop = !loop;
        video.loop = loop;
        paintLoop();
      } else if (e.key.toLowerCase() === "m") {
        muted = !muted;
        video.muted = muted;
        paintMute();
      }
    },
    { passive: false }
  );
}

/* ------------------------------------------------------------------ loading */

/** Aspect ("16:9") of the clip that's about to load — before its metadata. */
export function playerHint(aspect) {
  if (!screen) return;
  const [a, b] = String(aspect || "").split(":").map(Number);
  if (a > 0 && b > 0) {
    screen.dataset.ar = String(a / b);
    fitStage();
  }
}

/** Show a finished clip in the stage. `url` is a blob: URL. */
export function playerLoad(url, opts = {}) {
  if (!video) return;
  video.pause();
  video.hidden = false;
  knownDuration = Number(opts.duration) > 0 ? Number(opts.duration) : 0;
  video.src = url;
  hasClip = true;
  video.muted = muted;
  video.loop = loop;
  video.playbackRate = rate;
  bar.hidden = false;
  showBar(true);
  $("outPoster").hidden = true;
  $("screenPlaceholder").hidden = true;
  paintPlay();
  paintTime();
  video.play().catch(() => {});
  wake();
  // Ask the file for its real length once its metadata arrives (a container
  // that lies is repaired by seeking past the end), then prefer whichever
  // number is sane.
  const onMeta = async () => {
    video.removeEventListener("loadedmetadata", onMeta);
    const real = await repairDuration(video);
    if (real > 0 && (knownDuration <= 0 || Math.abs(real - knownDuration) > 0.25)) knownDuration = real;
    paintTime();
    fitStage();
  };
  video.addEventListener("loadedmetadata", onMeta);
}

/** Video in this browser is unplayable — show a still instead, with the note. */
export function playerFallback(imgSrc) {
  if (!video) return;
  video.pause();
  video.hidden = true;
  video.removeAttribute("src");
  hasClip = false;
  knownDuration = 0;
  bar.hidden = true;
  const poster = $("outPoster");
  if (poster && imgSrc) {
    poster.src = imgSrc;
    poster.hidden = false;
    poster.onload = fitStage;
  }
  fitStage();
}

export function playerReset() {
  if (!video) return;
  video.pause();
  video.hidden = true;
  video.removeAttribute("src");
  hasClip = false;
  knownDuration = 0;
  bar.hidden = true;
  $("outPoster").hidden = true;
  const ph = $("screenPlaceholder");
  if (ph) ph.hidden = false;
  delete screen.dataset.ar;
  showBar(true);
  clearTimeout(idleTimer);
  fitStage();
}

export function playerRate() {
  return rate;
}
