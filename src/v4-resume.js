let last = null;
let timer = null;
const KEY = "v4_lastwork_v1";
function kv() { try { return root.kv.v4work; } catch { return null; } }
async function load() {
  try { const k = kv(); if (k) { const v = await k.get("last"); if (v) return v; } } catch {}
  try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch {}
  return null;
}
async function save(patch) {
  last = Object.assign({}, last || {}, patch || {}, { ts: Date.now() });
  try { localStorage.setItem(KEY, JSON.stringify(last)); } catch {}
  try { const k = kv(); if (k) await k.set("last", last); } catch {}
  const el = document.querySelector("#v4AutoNote");
  if (el) { el.textContent = "auto-saved " + new Date().toLocaleTimeString(); el.hidden = false; }
}
function prompt() { return last ? ("Continue from last saved work (" + (last.story || last.tab || " storyboard") + ", " + new Date(last.ts).toLocaleString() + ")?") : ""; }
function initAuto() {
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.(".studio-tab");
    if (b?.dataset?.page) save({ tab: b.dataset.page });
  }, true);
  ["input", "change"].forEach((ev) => document.addEventListener(ev, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const sb = window.SBStudio?.snapshot?.();
      save(sb ? { tab: "pageStoryboard", story: sb.name, sb } : {});
    }, 1500);
  }, true));
  setInterval(() => {
    try {
      const sb = window.SBStudio?.snapshot?.();
      if (sb?.frames?.length) save({ tab: "pageStoryboard", story: sb.name, sb });
    } catch {}
  }, 15000);
}
async function boot() {
  last = await load();
  initAuto();
  if (!last?.sb?.frames?.length && !last?.tab) return;
  const bar = document.querySelector("#v4ResumeBar");
  const txt = document.querySelector("#v4ResumeTxt");
  if (!bar || !txt) return;
  txt.textContent = prompt() + " Work auto-saves on the go.";
  bar.hidden = false;
  document.querySelector("#v4ResumeGo")?.addEventListener("click", () => {
    try {
      if (last.tab) document.querySelector('[data-page="' + last.tab + '"]')?.click();
      if (last.sb) window.SBStudio?.restore?.(last.sb);
    } catch {}
    bar.hidden = true;
  });
  document.querySelector("#v4ResumeFresh")?.addEventListener("click", () => { bar.hidden = true; });
}
window.V4Resume = { save, load, prompt, snapshot: () => last };
if (document.readyState !== "loading") boot();
else document.addEventListener("DOMContentLoaded", boot, { once: true });
