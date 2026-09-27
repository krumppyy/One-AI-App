function toast(m) {
  const h = document.querySelector(".toasts") || (() => { const d = document.createElement("div"); d.className = "toasts"; document.body.appendChild(d); return d; })();
  const t = document.createElement("div"); t.className = "toast"; t.textContent = m; h.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 320); }, 3400);
}

const SR = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
let active = null;

function insertAtCursor(el, text) {
  const s = el.selectionStart ?? el.value.length;
  const e = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, s);
  const after = el.value.slice(e);
  const needSpace = before && !/\s$/.test(before) ? " " : "";
  el.value = before + needSpace + text + after;
  const pos = (before + needSpace + text).length;
  try { el.setSelectionRange(pos, pos); } catch {}
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
}

function attach(id) {
  const el = document.getElementById(id);
  if (!el || el.dataset.dictBtn) return;
  el.dataset.dictBtn = "1";
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn btn-tiny";
  b.textContent = "🎤 Dictate";
  b.title = "Record voice → text into this field";
  b.style.marginTop = "6px";
  if (!SR) { b.disabled = true; b.title = "Voice typing is not supported in this browser — try Chrome or Edge."; }
  b.onclick = () => {
    if (active) { try { active.rec.stop(); } catch {} return; }
    const rec = new SR();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    let base = "";
    let finalText = "";
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const tr = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += tr + " ";
        else interim += tr;
      }
      b.textContent = "■ Stop" + (interim ? " · " + interim.slice(0, 24) + "…" : " · listening…");
    };
    rec.onerror = (ev) => {
      const k = ev?.error || "";
      if (k === "not-allowed" || k === "service-not-allowed") toast("Mic blocked — allow microphone access first.");
      else if (k !== "aborted" && k !== "no-speech") toast("Dictation hiccup: " + k);
    };
    rec.onend = () => {
      if (active?.rec === rec) {
        active = null;
        b.textContent = "🎤 Dictate";
        const t = (base + " " + finalText).trim();
        if (t) insertAtCursor(el, t);
        else el.focus();
      }
    };
    base = "";
    active = { rec, btn: b };
    b.textContent = "■ Stop · listening…";
    try { rec.start(); } catch { active = null; b.textContent = "🎤 Dictate"; }
  };
  el.after(b);
}

function boot() {
  for (const id of ["voiceTextInput", "promptInput", "imgPromptInput", "chatInput", "readerTextInput"]) {
    try { attach(id); } catch {}
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 700));
else setTimeout(boot, 700);
try {
  new MutationObserver(() => boot()).observe(document.documentElement, { childList: true, subtree: true });
} catch {}
