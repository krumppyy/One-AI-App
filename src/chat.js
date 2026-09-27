const $ = (id) => document.getElementById(id);
const LS_KEY = "aiToolkitV2.chats.v1";
const LS_ACTIVE = "aiToolkitV2.chats.active";
const LS_MODEL = "aiToolkitV2.chat.model";

const MODELS = [
  { id: "auto", label: "Auto — fastest free route", note: "Tries the ultra-fast AI server first, open-source pool as backup. No key.", route: "auto" },
  { id: "gemini", label: "Gemini 2.5 Flash · Ultra-fast AI", note: "Powered by Gemini 2.5 Flash. Fast reasoning, code, and creative writing.", route: "perchance" },
  { id: "openai", label: "GPT-OSS 20B · open-source · free", note: "Open-source reasoning model (Pollinations free tier). No key, no sign-in.", route: "pollinations", pm: "openai" },
  { id: "perchance", label: "Perchance AI · built-in", note: "Built-in assistant. No key.", route: "perchance" },
  { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", label: "Llama 3.3 70B · open-source", note: "Meta open weights via Puter (free, one-time sign-in, you cover your own usage).", route: "puter", pm: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { id: "mistralai/Mistral-Small-24B-Instruct-2501", label: "Mistral Small · open-source", note: "Mistral open weights via Puter (free, one-time sign-in).", route: "puter", pm: "mistralai/Mistral-Small-24B-Instruct-2501" },
  { id: "deepseek-ai/DeepSeek-V3", label: "DeepSeek V3 · open-source", note: "DeepSeek open weights via Puter (free, one-time sign-in).", route: "puter", pm: "deepseek-ai/DeepSeek-V3" },
  { id: "Qwen/Qwen2.5-72B-Instruct-Turbo", label: "Qwen 2.5 72B · open-source", note: "Qwen open weights via Puter (free, one-time sign-in).", route: "puter", pm: "Qwen/Qwen2.5-72B-Instruct-Turbo" },
];

let chats = [];
let activeId = null;
let busy = false;
let aborter = null;

function uid() { return "c" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
function esc(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function linkify(html) {
  return String(html).replace(/(https?:\/\/[^\s<>"']+)/g, (m) => {
    let u = m.replace(/[),.;!?]+$/, "");
    const trail = m.slice(u.length);
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return m;
    } catch { return m; }
    const safe = u.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer nofollow">' + safe + "</a>" + trail;
  });
}
function now() { return Date.now(); }

function load() {
  try { chats = JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { chats = []; }
  if (!Array.isArray(chats)) chats = [];
  activeId = localStorage.getItem(LS_ACTIVE) || null;
  if (!chats.some((c) => c.id === activeId)) activeId = chats[0]?.id || null;
  if (!activeId) { const c = { id: uid(), title: "New chat", model: curModel(), msgs: [], updated: now() }; chats.unshift(c); activeId = c.id; save(); }
}
function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(chats.slice(0, 60)));
    localStorage.setItem(LS_ACTIVE, activeId || "");
    localStorage.setItem(LS_MODEL, $("chatModelSel")?.value || "auto");
  } catch {}
}
function cur() { return chats.find((c) => c.id === activeId) || null; }
function curModel() { return localStorage.getItem(LS_MODEL) || "auto"; }
function modelOf(id) { return MODELS.find((m) => m.id === id) || MODELS[0]; }

function draftKey(id) { return "aiToolkitV2.draft." + (id || "none"); }
function saveDraft() {
  try { localStorage.setItem(draftKey(activeId), $("chatInput")?.value || ""); } catch {}
}
function restoreDraft() {
  try {
    const v = localStorage.getItem(draftKey(activeId)) || "";
    const input = $("chatInput");
    if (input && document.activeElement !== input) { input.value = v; input.style.height = "auto"; input.style.height = Math.min(140, input.scrollHeight) + "px"; }
  } catch {}
}
function clearDraft() { try { localStorage.removeItem(draftKey(activeId)); } catch {} }
function renderList(filter = "") {
  const box = $("chatList");
  if (!box) return;
  box.innerHTML = "";
  const q = filter.trim().toLowerCase();
  const items = chats.filter((c) => !q || c.title.toLowerCase().includes(q) || c.msgs.some((m) => m.text.toLowerCase().includes(q)));
  if (!items.length) { box.innerHTML = '<div class="hint" style="padding:8px 2px">No chats yet — hit + New.</div>'; return; }
  for (const c of items) {
    const b = document.createElement("div");
    b.className = "chat-item" + (c.id === activeId ? " on" : "");
    const row = document.createElement("div");
    row.className = "chat-item-row";
    const t = document.createElement("strong");
    t.textContent = c.title || "New chat";
    const del = document.createElement("button");
    del.className = "chat-del";
    del.textContent = "×";
    del.title = "Delete chat";
    del.onclick = (e) => { e.stopPropagation(); chats = chats.filter((x) => x.id !== c.id); if (activeId === c.id) activeId = chats[0]?.id || null; if (!activeId) { const n = { id: uid(), title: "New chat", model: curModel(), msgs: [], updated: now() }; chats.unshift(n); activeId = n.id; } save(); renderList($("chatSearchInput")?.value || ""); renderMsgs(); };
    row.append(t, del);
    const sub = document.createElement("span");
    const last = c.msgs[c.msgs.length - 1];
    sub.textContent = last ? last.text.slice(0, 80) : "empty conversation";
    b.append(row, sub);
    b.onclick = () => { if (busy) return; activeId = c.id; save(); renderList($("chatSearchInput")?.value || ""); renderMsgs(); };
    box.appendChild(b);
  }
}

function bubble(role, text, meta, actions) {
  const d = document.createElement("div");
  d.className = "msg " + (role === "user" ? "msg-user" : "msg-ai");
  const body = document.createElement("div");
  body.innerHTML = linkify(esc(text));
  d.appendChild(body);
  if (meta || actions) {
    const m = document.createElement("div");
    m.className = "msg-meta";
    if (meta) {
      const lab = document.createElement("span");
      lab.textContent = meta;
      m.appendChild(lab);
    }
    const mk = (label, title, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.title = title;
      b.onclick = (e) => { e.stopPropagation(); fn(); };
      m.appendChild(b);
      return b;
    };
    mk("Copy", "Copy message text", () => copyText(text, m));
    if (actions && text.trim()) {
      mk("→ Image", "Use this as the Image studio prompt", () => sendTo(text, "image"));
      mk("→ Video", "Use this as the Video studio prompt", () => sendTo(text, "video"));
      mk("→ Voice", "Use this as the Voiceover script (speakable text only)", () => sendTo(text, "voice"));
    }
    d.appendChild(m);
  }
  return d;
}

function copyText(text, scope) {
  const done = (btn) => { if (btn) { btn.textContent = "Copied"; setTimeout(() => (btn.textContent = "Copy"), 1200); } };
  const btn = scope?.querySelector?.("button");
  if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(text).then(() => done(btn)).catch(() => fallbackCopy(text, btn, done)); }
  else fallbackCopy(text, btn, done);
}
function fallbackCopy(text, btn, done) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    done(btn);
  } catch {}
}

function renderMsgs() {
  const box = $("chatMsgs");
  if (!box) return;
  box.innerHTML = "";
  const c = cur();
  if (!c || !c.msgs.length) {
    box.innerHTML = '<div class="screen-ph" id="chatEmpty"><strong>Ask anything</strong><p>Homework, code, writing, ideas — pick an open-source model and start typing below.</p><div class="chat-chips" id="chatStarterRow"><button type="button" data-q="Explain quantum computing in simple terms">Explain quantum computing</button><button type="button" data-q="Write a Python function to check if a string is a palindrome">Python palindrome</button><button type="button" data-q="Help me write a polite email asking for a deadline extension">Email draft</button><button type="button" data-q="Give me a 7-day beginner workout plan with no equipment">Workout plan</button></div></div>';
    bindStarters();
    return;
  }
  for (const m of c.msgs) box.appendChild(bubble(m.role, m.text, m.role === "ai" ? modelOf(m.model || c.model || "auto").label : "you", true));
  box.scrollTop = box.scrollHeight;
  const cc = $("chatCount");
  if (cc) cc.textContent = c.msgs.length + " msgs";
  restoreDraft();
}

function bindStarters() {
  document.querySelectorAll("#chatStarterRow button").forEach((b) => {
    b.onclick = () => { const i = $("chatInput"); if (i) { i.value = b.dataset.q; i.focus(); send(); } };
  });
}

function setBusy(on, label) {
  busy = on;
  const s = $("chatStopRow");
  if (s) s.hidden = !on;
  if (label && $("chatStatus")) $("chatStatus").textContent = label;
  if ($("chatSendBtn")) $("chatSendBtn").disabled = on;
}

function historyFor(c, cap = 20) {
  return c.msgs.slice(-cap).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
}

async function askPollinations(history, model, signal, onToken) {
  const url = "https://text.pollinations.ai/openai";
  const body = { model: model || "openai", messages: history, stream: true, private: true };
  let res = null;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) {
    const sf = window.root?.superFetch || null;
    if (!sf) throw e;
    const txt = await sf(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.text());
    onToken(txt);
    return txt;
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error("Chat pool busy (" + res.status + "). " + t.slice(0, 160));
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop();
    for (const p of parts) {
      const line = p.trim().split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const j = JSON.parse(data);
        const tok = j.choices?.[0]?.delta?.content || j.choices?.[0]?.message?.content || "";
        if (tok) { out += tok; onToken(tok); }
      } catch {}
    }
    if (signal?.aborted) { try { reader.cancel(); } catch {} break; }
  }
  if (!out) throw new Error("Empty reply from the chat pool.");
  return out;
}

async function askPerchance(history, signal, onToken) {
  const convo = history.map((m) => (m.role === "user" ? "User: " : "Assistant: ") + m.content).join("\n\n");
  const prompt = convo + "\n\nAssistant:";
  let out = "";
  const p = window.root?.generateText?.({ instruction: prompt, onChunk: (d) => { const t = d?.textChunk || ""; if (t && !signal?.aborted) { out += t; onToken(t); } } });
  if (!p) throw new Error("Built-in AI is not loaded yet.");
  signal?.addEventListener?.("abort", () => { try { p.stop?.(); } catch {} });
  const r = await p;
  const finalText = String(r?.text || r || out || "").trim();
  if (!finalText && !out) throw new Error("Empty reply from the built-in AI.");
  if (finalText && finalText.length > out.length) { onToken(finalText.slice(out.length)); return finalText; }
  return out || finalText;
}

let puterLoad = null;
function ensurePuter() {
  if (window.puter?.ai?.chat) return Promise.resolve(window.puter);
  if (puterLoad) return puterLoad;
  puterLoad = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://js.puter.com/v2/";
    s.async = true;
    s.onload = () => (window.puter?.ai?.chat ? res(window.puter) : rej(new Error("Puter loaded without chat")));
    s.onerror = () => rej(new Error("Puter did not load — check connection"));
    document.head.appendChild(s);
    setTimeout(() => rej(new Error("Puter timed out")), 30000);
  }).catch((e) => { puterLoad = null; throw e; });
  return puterLoad;
}

async function askPuter(history, model, signal, onToken) {
  const puter = await ensurePuter();
  const out = await puter.ai.chat(history, { model, stream: false });
  let text = "";
  if (typeof out === "string") text = out;
  else text = out?.message?.content || out?.text || out?.toString?.() || "";
  if (typeof text !== "string") text = String(text);
  text = text.trim();
  if (!text) throw new Error("Empty reply from " + model + ".");
  onToken(text);
  return text;
}

async function answer(history, modelId, signal, onToken) {
  const m = modelOf(modelId);
  const errs = [];
  const chain = m.route === "auto" ? ["perchance", "pollinations"] : [m.route];
  for (const route of chain) {
    if (signal?.aborted) throw Object.assign(new Error("stopped"), { kind: "cancelled" });
    try {
      if (route === "pollinations") return await askPollinations(history, m.pm || "openai", signal, onToken);
      if (route === "perchance") return await askPerchance(history, signal, onToken);
      if (route === "puter") return await askPuter(history, m.pm, signal, onToken);
    } catch (e) {
      if (e?.kind === "cancelled" || /stopped|cancel|abort/i.test(e?.message || "")) throw e;
      errs.push(route + ": " + (e?.message || e));
    }
  }
  throw new Error(errs.join(" · ") || "All chat routes failed.");
}

let toastTimer = null;
function toast(msg) {
  const t = $("chatToast");
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function setField(id, value) {
  const el = document.getElementById(id);
  if (!el) return false;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.classList.remove("flash-field");
  void el.offsetWidth;
  el.classList.add("flash-field");
  return true;
}

function gotoTab(page) {
  document.querySelector(`[data-page="${page}"]`)?.click();
}

function stripFences(s) {
  return String(s || "")
    .replace(/```[\w-]*\n?/g, "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
}

function extractPrompt(text) {
  const src = String(text || "");
  let prompt = src, negative = "";
  const neg = src.match(/(?:^|\n)\s*negative\s*prompt\s*:\s*([\s\S]*?)(?=\n\s*(?:prompt|script|narration|voiceover|title)\s*:|$)/i);
  if (neg) { negative = stripFences(neg[1]); prompt = (src.slice(0, neg.index) + src.slice(neg.index + neg[0].length)).trim(); }
  const pos = prompt.match(/(?:^|\n)\s*(?:image\s*|video\s*)?prompt\s*:\s*([\s\S]*?)(?=\n\s*(?:negative\s*prompt|script|narration|voiceover|title)\s*:|$)/i);
  if (pos) prompt = pos[1];
  return { prompt: stripFences(prompt).slice(0, 1500), negative: stripFences(negative).slice(0, 600) };
}

function cleanSpeech(text) {
  let s = String(text || "");
  s = s.replace(/```[\w-]*\n?/g, " ");
  s = s.replace(/(?:^|\n)\s*(?:(?:image|video)\s*)?prompt\s*:\s*/gi, " ");
  s = s.replace(/(?:^|\n)\s*negative\s*prompt\s*:[\s\S]*?(?=\n|$)/gi, " ");
  s = s.replace(/(?:^|\n)\s*(?:script|narration|voiceover)\s*:\s*/gi, " ");
  s = s.replace(/https?:\/\/\S+/g, " ");
  s = s.replace(/[#*_`>~|]/g, "");
  s = s.replace(/^\s*[-•\d.)]+\s+/gm, "");
  s = s.replace(/\s+/g, " ").trim();
  return s.slice(0, 4000);
}

function sendTo(text, dest) {
  if (!text || !text.trim()) return;
  if (dest === "copy") { copyText(text); toast("Selection copied."); return; }
  if (dest === "image") {
    const { prompt, negative } = extractPrompt(text);
    if (!setField("imgPromptInput", prompt)) { toast("Image studio is not ready."); return; }
    if (negative) setField("imgNegInput", negative);
    gotoTab("pageImage");
    toast("Sent to Image as prompt" + (negative ? " (+ negative)" : "") + ".");
  } else if (dest === "video") {
    const { prompt, negative } = extractPrompt(text);
    if (!setField("promptInput", prompt)) { toast("Video studio is not ready."); return; }
    if (negative) setField("negInput", negative);
    gotoTab("pageVideo");
    toast("Sent to Video as prompt" + (negative ? " (+ negative)" : "") + ".");
  } else if (dest === "voice") {
    const said = cleanSpeech(extractPrompt(text).prompt || text);
    if (!said) { toast("Nothing speakable in that text."); return; }
    if (!setField("voiceTextInput", said)) { toast("Voiceover studio is not ready."); return; }
    gotoTab("pageVoice");
    toast("Sent to Voiceover as script (labels removed).");
  }
  setTimeout(() => document.querySelector(".studio-tab.on")?.scrollIntoView?.({ block: "nearest" }), 50);
}

function downloadFile(name, mime, content) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}

function chatBaseName() {
  const c = cur();
  const slug = (c?.title || "chat").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "chat";
  return slug + "-" + new Date().toISOString().slice(0, 10);
}

function doExport(fmt) {
  const c = cur();
  if (!c || !c.msgs.length) { toast("Nothing to export yet."); return; }
  const base = chatBaseName();
  const date = new Date().toLocaleString();
  if (fmt === "txt") {
    const out = [`${c.title} — exported ${date}`, ""];
    for (const m of c.msgs) out.push(m.role === "user" ? "You:" : `AI (${modelOf(m.model || c.model || "auto").label}):`, m.text, "");
    downloadFile(base + ".txt", "text/plain;charset=utf-8", out.join("\n"));
    toast("Exported .txt.");
  } else if (fmt === "csv") {
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = ["role,model,text"];
    for (const m of c.msgs) rows.push([m.role, m.role === "ai" ? modelOf(m.model || c.model || "auto").label : "", m.text.replace(/\r?\n/g, " ")].map(q).join(","));
    downloadFile(base + ".csv", "text/csv;charset=utf-8", "\ufeff" + rows.join("\n"));
    toast("Exported for Excel (.csv).");
  } else if (fmt === "json") {
    downloadFile(base + ".json", "application/json;charset=utf-8", JSON.stringify({ title: c.title, exported: date, messages: c.msgs }, null, 2));
    toast("Exported .json.");
  } else if (fmt === "doc") {
    const paras = c.msgs.map((m) => `<p><b>${m.role === "user" ? "You" : "AI"}:</b> ${esc(m.text).replace(/\n/g, "<br>")}</p>`).join("");
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(c.title)}</title></head><body><h1>${esc(c.title)}</h1><p>Exported ${esc(date)}</p>${paras}</body></html>`;
    downloadFile(base + ".doc", "application/msword;charset=utf-8", html);
    toast("Exported Word (.doc).");
  } else if (fmt === "pdf") {
    const paras = c.msgs.map((m) => `<p><b>${m.role === "user" ? "You" : "AI"}:</b> ${esc(m.text).replace(/\n/g, "<br>")}</p>`).join("");
    const w = window.open("", "_blank");
    if (!w) { toast("Allow pop-ups to export PDF."); return; }
    w.document.write(`<html><head><title>${esc(c.title)}</title><style>body{font:14px/1.6 system-ui,sans-serif;max-width:700px;margin:40px auto;padding:0 20px;color:#111}p{background:#f4f5f7;padding:10px 14px;border-radius:8px}</style></head><body><h1>${esc(c.title)}</h1><p>Exported ${esc(date)}</p>${paras}<script>onload=()=>{print();}<\/script></body></html>`);
    w.document.close();
    toast("PDF opened — print / save as PDF.");
  }
}

let selText = "";
function bindSelection() {
  const box = $("chatMsgs");
  const pop = $("chatSelPop");
  if (!box || !pop || pop.dataset.bound) return;
  pop.dataset.bound = "1";
  const hide = () => { pop.hidden = true; selText = ""; };
  document.addEventListener("mousedown", (e) => { if (!pop.hidden && !pop.contains(e.target)) hide(); });
  box.addEventListener("scroll", hide);
  box.addEventListener("mouseup", () => {
    setTimeout(() => {
      const sel = window.getSelection();
      const t = sel?.toString().trim() || "";
      if (!t || !sel.rangeCount) { hide(); return; }
      const node = sel.anchorNode;
      const holder = node instanceof Element ? node.closest?.(".msg") : node?.parentElement?.closest?.(".msg");
      if (!holder || !box.contains(holder) || t.length > 1500) { hide(); return; }
      selText = t;
      const r = sel.getRangeAt(0).getBoundingClientRect();
      pop.hidden = false;
      const pw = pop.offsetWidth || 300, ph = pop.offsetHeight || 40;
      pop.style.left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.left + r.width / 2 - pw / 2)) + "px";
      pop.style.top = Math.max(8, (r.top - ph - 10 > 8 ? r.top - ph - 10 : r.bottom + 10)) + "px";
    }, 30);
  });
  pop.querySelectorAll("button").forEach((b) => {
    b.onclick = () => { const t = selText; hide(); if (t) { try { window.getSelection()?.removeAllRanges(); } catch {} sendTo(t, b.dataset.to); } };
  });
}

async function send() {
  if (busy) return;
  const input = $("chatInput");
  const text = (input?.value || "").trim();
  if (!text) return;
  let c = cur();
  if (!c) return;
  const modelId = $("chatModelSel")?.value || "auto";
  c.model = modelId;
  c.msgs.push({ role: "user", text, ts: now() });
  if (c.msgs.length === 1) c.title = text.slice(0, 42) + (text.length > 42 ? "…" : "");
  c.updated = now();
  save(); renderMsgs(); renderList($("chatSearchInput")?.value || "");
  input.value = "";
  input.style.height = "auto";
  clearDraft();

  aborter = new AbortController();
  const signal = aborter.signal;
  setBusy(true, "thinking…");
  const box = $("chatMsgs");
  const streamEl = bubble("ai", "", null);
  streamEl.classList.add("typing");
  const streamBody = streamEl.firstChild;
  box.appendChild(streamEl);
  box.scrollTop = box.scrollHeight;
  let acc = "";
  const onToken = (tok) => {
    acc += tok;
    streamBody.innerHTML = linkify(esc(acc));
    if ($("chatStatus")) $("chatStatus").textContent = "writing… (" + acc.length + " chars)";
    box.scrollTop = box.scrollHeight;
  };
  try {
    const full = await answer(historyFor(c), modelId, signal, onToken);
    const finalText = (full || acc).trim();
    streamEl.classList.remove("typing");
    streamEl.remove();
    if (!finalText) throw new Error("Empty reply — try again.");
    c.msgs.push({ role: "ai", text: finalText, model: modelId, ts: now() });
  } catch (e) {
    streamEl.classList.remove("typing");
    streamEl.remove();
    const cancelled = e?.kind === "cancelled" || /stopped|cancel|abort/i.test(e?.message || "");
    if (!cancelled) c.msgs.push({ role: "ai", text: "Couldn't answer that: " + (e?.message || e) + "\n\nTip: switch model above or hit send again.", model: modelId, ts: now() });
    else if (acc.trim()) c.msgs.push({ role: "ai", text: acc.trim(), model: modelId, ts: now() });
  }
  c.updated = now();
  save(); renderMsgs(); renderList($("chatSearchInput")?.value || "");
  setBusy(false);
  aborter = null;
}

function newChat() {
  if (busy) return;
  const c = { id: uid(), title: "New chat", model: $("chatModelSel")?.value || "auto", msgs: [], updated: now() };
  chats.unshift(c);
  activeId = c.id;
  save(); renderList($("chatSearchInput")?.value || ""); renderMsgs();
  $("chatInput")?.focus();
}

function boot() {
  if ($("chatSendBtn")?.dataset.bound) return;
  if (!$("chatSendBtn")) return;
  $("chatSendBtn").dataset.bound = "1";
  const sel = $("chatModelSel");
  sel.innerHTML = "";
  for (const m of MODELS) {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = m.label;
    sel.appendChild(o);
  }
  sel.value = curModel();
  const syncNote = () => { const n = $("chatModelNote"); if (n) n.textContent = modelOf(sel.value).note; save(); };
  sel.onchange = syncNote;
  syncNote();
  load();
  sel.value = cur()?.model || sel.value || "auto";
  syncNote();
  renderList("");
  renderMsgs();
  $("chatNewBtn").onclick = newChat;
  $("chatClearBtn").onclick = () => {
    if (busy) return;
    if (!confirm("Delete all chats on this device?")) return;
    chats = [];
    activeId = null;
    load(); renderList(""); renderMsgs();
  };
  $("chatSearchInput").oninput = (e) => renderList(e.target.value);
  $("chatSendBtn").onclick = send;
  $("chatStopBtn").onclick = () => { try { aborter?.abort(); } catch {} };
  const input = $("chatInput");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(140, input.scrollHeight) + "px"; saveDraft(); });
  const ex = $("chatExportSel");
  if (ex && !ex.dataset.bound) {
    ex.dataset.bound = "1";
    ex.onchange = () => { const v = ex.value; ex.value = ""; if (v) doExport(v); };
  }
  bindSelection();
  bindStarters();
}

if (document.readyState !== "loading") boot();
else document.addEventListener("DOMContentLoaded", boot, { once: true });
