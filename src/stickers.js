export const STICKERS = ["😀", "😍", "🔥", "⭐", "🎉", "💯", "❤️", "👍", "🎬", "✨", "🌟", "💥", "😎", "🥳", "👏", "💡", "🎵", "🏆", "💎", "🚀"];

export const FRAMES = [
  { id: "none", label: "No frame" },
  { id: "cinema", label: "Cinema bars" },
  { id: "polaroid", label: "Polaroid" },
  { id: "neon", label: "Neon" },
  { id: "rounded", label: "Rounded" },
  { id: "vignette", label: "Vignette" },
];

export function stickerLayer(host) {
  if (!host) return null;
  let layer = host.querySelector(":scope > .sticker-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "sticker-layer";
    layer.setAttribute("aria-hidden", "false");
    host.appendChild(layer);
  }
  return layer;
}

export function frameLayer(host) {
  if (!host) return null;
  let layer = host.querySelector(":scope > .frame-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "frame-layer";
    layer.dataset.frame = "none";
    layer.setAttribute("aria-hidden", "true");
    host.appendChild(layer);
  }
  return layer;
}

export function setFrame(host, id) {
  const layer = frameLayer(host);
  if (!layer) return;
  layer.dataset.frame = FRAMES.some((f) => f.id === id) ? id : "none";
  layer.hidden = layer.dataset.frame === "none";
}

export function getFrame(host) {
  return host?.querySelector(":scope > .frame-layer")?.dataset.frame || "none";
}

export function addSticker(host, emoji, x, y) {
  const layer = stickerLayer(host);
  if (!layer) return null;
  const s = document.createElement("div");
  s.className = "stk";
  s.textContent = emoji || "⭐";
  s.style.left = (x ?? (8 + Math.random() * 60)) + "%";
  s.style.top = (y ?? (8 + Math.random() * 60)) + "%";
  s.title = "drag to move · double-click to remove";
  layer.appendChild(s);
  dragSticker(s, layer);
  return s;
}

export function listStickers(host) {
  const layer = host?.querySelector(":scope > .sticker-layer");
  if (!layer) return [];
  return [...layer.querySelectorAll(".stk")].map((s) => ({
    emoji: s.textContent,
    x: parseFloat(s.style.left) / 100 || 0,
    y: parseFloat(s.style.top) / 100 || 0,
    size: parseFloat(s.style.fontSize) || 34,
  }));
}

export function clearStickers(host) {
  host?.querySelector(":scope > .sticker-layer")?.replaceChildren();
}

function dragSticker(el, layer) {
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    el.setPointerCapture?.(e.pointerId);
    layer.querySelectorAll(".stk.sel").forEach((o) => o.classList.remove("sel"));
    el.classList.add("sel");
    const r = layer.getBoundingClientRect();
    const move = (ev) => {
      const px = ((ev.clientX - r.left) / Math.max(1, r.width)) * 100;
      const py = ((ev.clientY - r.top) / Math.max(1, r.height)) * 100;
      el.style.left = Math.min(92, Math.max(0, px)) + "%";
      el.style.top = Math.min(92, Math.max(0, py)) + "%";
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  });
  el.addEventListener("dblclick", () => el.remove());
  el.addEventListener("wheel", (e) => {
    e.preventDefault();
    const cur = parseFloat(el.style.fontSize) || 34;
    el.style.fontSize = Math.min(120, Math.max(16, cur + (e.deltaY < 0 ? 4 : -4))) + "px";
  }, { passive: false });
}

export function drawStickersOn(ctx, w, h, stickers) {
  if (!stickers || !stickers.length) return;
  ctx.save();
  ctx.textBaseline = "top";
  for (const s of stickers) {
    const px = Math.round((s.x || 0) * w);
    const py = Math.round((s.y || 0) * h);
    ctx.font = `${Math.max(12, Math.round((s.size || 34) * (w / 560)))}px serif`;
    ctx.fillText(s.emoji || "⭐", px, py);
  }
  ctx.restore();
}

export function drawFrameOn(ctx, w, h, frameId) {
  if (!frameId || frameId === "none") return;
  ctx.save();
  if (frameId === "cinema") {
    ctx.fillStyle = "#000";
    const bar = Math.round(h * 0.09);
    ctx.fillRect(0, 0, w, bar);
    ctx.fillRect(0, h - bar, w, bar);
  } else if (frameId === "polaroid") {
    ctx.strokeStyle = "#f4f1ea";
    ctx.lineWidth = Math.max(8, Math.round(w * 0.03));
    ctx.strokeRect(0, 0, w, h);
    ctx.fillStyle = "#f4f1ea";
    ctx.fillRect(0, h - Math.round(h * 0.1), w, Math.round(h * 0.1));
  } else if (frameId === "neon") {
    ctx.strokeStyle = "rgba(55,224,200,0.9)";
    ctx.lineWidth = Math.max(3, Math.round(w * 0.008));
    const r = Math.round(w * 0.03);
    ctx.beginPath();
    ctx.roundRect(ctx.lineWidth, ctx.lineWidth, w - ctx.lineWidth * 2, h - ctx.lineWidth * 2, r);
    ctx.stroke();
  } else if (frameId === "rounded") {
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = Math.max(2, Math.round(w * 0.004));
    ctx.beginPath();
    ctx.roundRect(2, 2, w - 4, h - 4, Math.round(w * 0.05));
    ctx.stroke();
  } else if (frameId === "vignette") {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}
