const $ = (id) => document.getElementById(id);
const kvRoot = () => (typeof root !== "undefined" ? root.kv : null);

export const FEED_CHANNEL = "amt-feedback";
export const TEL_CHANNEL = "amt-insight-k7q2x9m4";
const TEL_ALLOW = ["visit", "nav", "video-gen", "image-gen", "chat", "reader", "voice", "editor-export", "profile", "feedback-post", "storyboard", "compile"];
const TEL_SET = new Set(TEL_ALLOW);
const LS_STATS = "amt_stats";
const LS_PIN = "amt_owner_pin";

function loadStats() {
  try { return JSON.parse(localStorage.getItem(LS_STATS) || "{}"); } catch { return {}; }
}
function bumpStat(k) {
  try {
    const s = loadStats();
    s[k] = (Number(s[k]) || 0) + 1;
    localStorage.setItem(LS_STATS, JSON.stringify(s));
  } catch {}
}

export function telLog(kind, detail) {
  try { bumpStat(String(kind || "event").slice(0, 40)); } catch {}
  try { telBeacon(kind); } catch {}
}

function telSid() {
  try {
    let s = sessionStorage.getItem("amt_sid");
    if (!s) {
      s = Math.random().toString(36).slice(2, 7);
      sessionStorage.setItem("amt_sid", s);
    }
    return s;
  } catch {
    if (!telSid.c) telSid.c = Math.random().toString(36).slice(2, 7);
    return telSid.c;
  }
}

let telCom = null, telReady = false, telPend = {}, telTimer = 0;
let telCache = [], telFeedLive = false;
function ensureTelSender() {
  if (telCom) return telCom;
  try {
    telCom = root.commentsPlugin({
      channel: TEL_CHANNEL, width: "10px", height: 10, hideComments: true,
      commentPlaceholderText: "", submitButtonText: "",
      onLoad: (comments) => {
        telReady = true; telFeedLive = true;
        if (Array.isArray(comments)) telCache = comments.slice(-150);
        try { paintTelDash(); } catch {}
        flushTel();
      },
      onComment: (c) => {
        if (c) { telCache.push(c); telCache = telCache.slice(-150); }
        try { paintTelDash(); } catch {}
      },
    });
    const h = $("telHolder");
    if (h) h.innerHTML = telCom;
  } catch { telCom = null; }
  return telCom;
}
function telBeacon(kind) {
  kind = String(kind || "").slice(0, 24);
  if (!TEL_SET.has(kind)) return;
  telPend[kind] = (telPend[kind] || 0) + 1;
  ensureTelSender();
  if (kind === "visit") flushTel();
  else if (!telTimer) telTimer = setTimeout(flushTel, 12000);
}
function flushTel() {
  telTimer = 0;
  const keys = Object.keys(telPend);
  if (!keys.length || !telCom || !telReady) {
    if (keys.length && telCom && !telReady) telTimer = setTimeout(flushTel, 15000);
    return;
  }
  const parts = keys.map((k) => telPend[k] > 1 ? `${k}x${telPend[k]}` : k);
  telPend = {};
  const msg = `\u26a1 ${parts.join(" ")} s${telSid()}`.slice(0, 140);
  try {
    const r = telCom.submit(msg);
    if (r && r.catch) r.catch(() => {});
  } catch {}
}

const GUIDES = {
  tabChatBtn: ["AI Chat", "Free open-source chat. Pick a model, type below, Enter sends. Use starter chips or selection popup to send text to Image / Video / Voice."],
  tabImageBtn: ["Image", "Text-to-image or Edit mode. Write prompt, pick model + aspect, Generate. Result bar: grade, format, upscale, Download, send to Video."],
  tabVideoBtn: ["Video", "Drop a starter image, describe motion, pick model, Generate. Longer than one segment chains automatically."],
  tabReaderBtn: ["Reader", "Drop a file (PDF, DOCX, photo of text). Text is extracted on-device, then Generate narration rewrites it. Send to Voice to hear it."],
  tabStoryboardBtn: ["Storyboard", "Type a story idea, Build story splits it into scenes, Generate paints the frames. Project dropdown switches stories. Compile turns frames into video. Voiceover/Narrate send lines to the Voice tab."],
  tabVoiceBtn: ["Voiceover", "Paste a script, pick a voice, Speak. Export below as WAV / MP3 / OGG. Mic button dictates."],
  tabEditorBtn: ["Editor beta testing", "Early beta of a Premiere-style timeline. Import bin clips, double-click adds to V1, drag to move, edges trim, S splits, Space plays. Export renders on-device."],
  tabFeedbackBtn: ["Feedback", "Public suggestion box. Pick a category, write it, Send. Read what others asked below. Top-voted items get built first."],
  tabTutorialBtn: ["Tutorial", "Step-by-step for every studio including Storyboard, plus the live roadmap. Start here if anything is confusing."],
  tutorBtn: ["AI Tutor", "Full-page tutor chat. Ask anything, get manual-grounded answers."],
  chatInput: ["Chat box", "Type here. Enter sends, Shift+Enter is a new line. Select any reply text for the Image / Video / Voice popup."],
  chatModelSel: ["Chat model", "Free open-source models. Bigger is smarter but slower. If one stalls, Stop and try another."],
  chatSendBtn: ["Send", "Sends the message. Watch the Stop button while it thinks."],
  imgPromptInput: ["Image prompt", "Describe subject + light + style. Short works; Auto-enhance expands it."],
  imgEnhanceBtn: ["Auto-enhance", "AI rewrites a few words into a rich prompt. Free."],
  imgModelSel: ["Image model", "Auto picks a working free route. Manual pick wins over Auto."],
  imgGenerateBtn: ["Generate image", "Renders variations on the canvas. Stop cancels mid-run."],
  imgDownloadBtn: ["Download", "Exports with grade + upscale + format applied."],
  promptInput: ["Video prompt", "Describe the MOTION, not the picture: who moves, how, camera move. The starter frame supplies the look."],
  enhanceBtn: ["Auto-enhance", "Expands your idea with motion + camera + detail words, in the selected mode."],
  moveSel: ["Camera", "Camera move baked into the prompt (push-in, orbit, drone…)."],
  angleSel: ["Angle", "Camera angle phrase (close-up, wide, low…)."],
  generateBtn: ["Generate video", "Renders via your server → free pool → this device. Watch the Run log; Simple mode reads like a studio."],
  cancelBtn: ["Stop", "Cancels the run. Partial beats may offer Finish this clip."],
  durRange: ["Duration", "Seconds requested. Longer than one segment auto-chains; the file is cut to exactly this."],
  fpsSel: ["FPS", "Snaps to what the model can really render. Higher = smoother + bigger file."],
  seedInput: ["Seed", "Blank = random. Lock seed reuses the last one for variations."],
  settingsBtn: ["Settings", "Compute, keys, privacy, relays, vault, data. AI Tutor section lives at the bottom."],
  historyBtn: ["Library", "Every finished clip / image / narration, saved on this device. Search, filter, delete."],
  themeBtn: ["Theme", "Flips dark / light. Choice is saved."],
  sbBuildBtn: ["Build story", "AI splits your story idea into numbered visual scenes. Set the count first."],
  sbGenBtn: ["Generate storyboard", "Paints every scene into a frame. + 1 frame paints one from the image prompt."],
  sbCompileBtn: ["Compile + save", "Turns frames into video (WEBM/MP4/MOV/MKV/GIF) with per-scene seconds + Cut/Dissolve, saves it to the Library."],
  sbVoiceBtn: ["Storyboard voiceover", "Sends one narration line per scene to the Voice tab. Narrate rewrites them into spoken form first."],
  sbProjectSel: ["Storyboard project", "Switch between saved stories. + New starts one, Delete removes it."],
  computeSel: ["Compute mode", "Auto = your server first, free pool next, this device last. Server-only/pool-only/offline force one route."],
  serverUrlInput: ["GPU server", "Paste your Colab / own-machine address here, then Test. Weights download once, then work offline."],
  hfTokenInput: ["HF token", "Optional free token. Raises the public pool allowance a little. Never required."],
  relayModeSel: ["Address rotation", "Each address has its own free allowance. Rotate to keep the free pool going."],
  vaultToggle: ["Vault", "Encrypts the library at rest on this device. Optional passphrase = real lock."],
  readerNarrateBtn: ["Generate narration", "AI rewrites extracted text in the chosen style + tone. Only this step sends text out."],
  voicePlayBtn: ["Speak", "Reads the script with the on-device voice. Stop halts it."],
  edExportBtn: ["Export video", "Renders the timeline on this machine, in this tab. Keep the tab visible."],
  fbSendBtn: ["Send suggestion", "Posts to the public Feedback wall with the chosen category."],
  tutorSendBtn: ["Ask", "Sends your question to the AI tutor, grounded in this app's manual."],
};

const APP_CTX = `You are the built-in tutor for "AI Multimedia Toolkit V4", a single-page web app with seven studios: AI Chat (free open-source chat models), Image (text-to-image + edit, grouped picker: Perchance built-in / free / Puter / uncensored / this device), Video (image-to-video via own GPU server / free public pool / on-device camera rig), Reader (file to narration text, then Send to Voice), Storyboard (story idea to Build story to scenes to Generate frames to Compile video; Project dropdown switches stories with auto-save; Voiceover/Narrate send lines to the Voice tab), Voiceover (on-device speech + WAV/MP3/OGG export, mic dictation), Editor beta testing (early Premiere-style timeline, on-device export). Topbar: theme, Library, Settings, AI Tutor, Tutorial, Feedback. Settings has compute mode (auto/server/pool/offline), GPU server address, HF token, relays/address rotation, vault encryption, data wipe. Feedback tab is the public suggestion wall (top-voted first). Tutorial tab has per-studio steps + roadmap. Answer briefly (under 150 words), as numbered steps when it is a how-to. If asked about something outside this app, say so in one line and steer back.`;

async function askAI(question, history) {
  const hist = (history || []).slice(-6).map((m) => `${m.me ? "User" : "Tutor"}: ${m.text}`).join("\n");
  const instruction = `${APP_CTX}\n${hist}\nUser: ${question}\nTutor:`;
  return await root.generateText({ instruction, stopSequences: ["\nUser:"] });
}

function bubble(listEl, me, text) {
  const d = document.createElement("div");
  d.className = "tmsg " + (me ? "me" : "ai");
  d.textContent = text;
  listEl.appendChild(d);
  listEl.scrollTop = listEl.scrollHeight;
  return d;
}

function bindTutorPage() {
  const input = $("tutorInput"), out = $("tutorMsgs"), send = $("tutorSendBtn");
  if (!input || !out || !send || send.dataset.bound) return;
  send.dataset.bound = "1";
  const hist = [];
  async function go(q) {
    const question = (q || input.value || "").trim();
    if (!question) return;
    input.value = "";
    bubble(out, true, question);
    const pend = bubble(out, false, "");
    const spin = document.createElement("span");
    spin.className = "busy";
    spin.textContent = "thinking…";
    pend.appendChild(spin);
    try {
      const ans = await askAI(question, hist);
      pend.textContent = String(ans || "No answer — try again.").trim();
      hist.push({ me: true, text: question }, { me: false, text: pend.textContent });
    } catch {
      pend.textContent = "The AI is unreachable right now. Try the Tutorial tab steps instead.";
    }
  }
  send.onclick = () => go();
  input.onkeydown = (e) => { if (e.key === "Enter") go(); };
  document.querySelectorAll("#pageTutor [data-q]").forEach((b) => { b.onclick = () => go(b.dataset.q); });
}

function bindAskFab() {
  const fab = $("tutorFab"), panel = $("tutorAsk"), out = $("tutorAskOut"), input = $("tutorAskInput"), send = $("tutorAskSend");
  if (!fab || fab.dataset.bound) return;
  fab.dataset.bound = "1";
  fab.onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) input.focus(); };
  $("tutorAskClose").onclick = () => { panel.hidden = true; };
  async function go(prefill) {
    const q = String(prefill || input.value || "").trim();
    if (!q) return;
    input.value = "";
    panel.hidden = false;
    const qd = document.createElement("div"); qd.className = "q"; qd.textContent = "You: " + q; out.appendChild(qd);
    const ad = document.createElement("div"); ad.className = "a busy"; ad.textContent = "thinking…"; out.appendChild(ad);
    out.scrollTop = out.scrollHeight;
    try {
      const ans = await askAI(q, []);
      ad.classList.remove("busy"); ad.textContent = String(ans || "No answer — try again.").trim();
    } catch { ad.classList.remove("busy"); ad.textContent = "AI unreachable. See the Tutorial tab."; }
  }
  send.onclick = () => go();
  input.onkeydown = (e) => { if (e.key === "Enter") go(); };
  window.__tutorAsk = go;
}

let hoverOn = false;
function setHover(on) {
  hoverOn = on;
  try { localStorage.setItem("amt_hover", on ? "1" : "0"); } catch {}
  for (const b of document.querySelectorAll("[data-hovertoggle]")) b.textContent = on ? "Hover tips: ON" : "Hover tips: OFF";
}
function bindHover() {
  if (document.body.dataset.hoverBound) return;
  document.body.dataset.hoverBound = "1";
  try { hoverOn = localStorage.getItem("amt_hover") === "1"; } catch {}
  const tip = $("tutorTip");
  let cur = null;
  document.addEventListener("mouseover", (e) => {
    if (!hoverOn || !tip) return;
    const t = e.target.closest ? e.target.closest("[id]") : null;
    const g = t && GUIDES[t.id];
    if (!g) { if (cur && !e.target.closest("#tutorTip")) { tip.hidden = true; cur = null; } return; }
    cur = t.id;
    tip.innerHTML = "";
    const s = document.createElement("strong"); s.textContent = g[0]; tip.appendChild(s);
    const p = document.createElement("div"); p.textContent = g[1]; tip.appendChild(p);
    const b = document.createElement("button"); b.className = "btn btn-tiny tip-ask"; b.textContent = "Ask AI about this";
    b.onclick = (ev) => { ev.stopPropagation(); tip.hidden = true; if (window.__tutorAsk) window.__tutorAsk(`How do I use "${g[0]}"? ${g[1]}`); };
    tip.appendChild(b);
    tip.hidden = false;
  });
  document.addEventListener("mousemove", (e) => {
    if (!hoverOn || !tip || tip.hidden) return;
    tip.style.left = Math.min(window.innerWidth - 300, e.clientX + 16) + "px";
    tip.style.top = Math.min(window.innerHeight - 160, e.clientY + 14) + "px";
  });
  document.addEventListener("click", (e) => { if (tip && !tip.hidden && !e.target.closest("#tutorTip")) tip.hidden = true; }, true);
  document.querySelectorAll("[data-hovertoggle]").forEach((b) => { b.onclick = () => setHover(!hoverOn); });
  setHover(hoverOn);
}

let fbCom = null;
let fbReady = false;
function bindVotes() {
  const love = $("voteLoveBtn"), like = $("voteLikeBtn");
  if (!love || love.dataset.bound) return;
  love.dataset.bound = "1";
  const paint = (v) => {
    if ($("voteLoveCount")) $("voteLoveCount").textContent = String(v.love || 0);
    if ($("voteLikeCount")) $("voteLikeCount").textContent = String(v.like || 0);
    love.classList.toggle("voted", (v.love || 0) > 0);
    like.classList.toggle("voted", (v.like || 0) > 0);
  };
  const load = async () => {
    try {
      paint((await kvRoot().guide.get("votes")) || { love: 0, like: 0 });
    } catch {}
  };
  const bump = async (key) => {
    let v = { love: 0, like: 0 };
    try {
      v = { ...v, ...((await kvRoot().guide.get("votes")) || {}) };
    } catch {}
    v[key] = (Number(v[key]) || 0) + 1;
    try {
      await kvRoot().guide.set("votes", v);
    } catch {}
    paint(v);
  };
  love.onclick = () => bump("love");
  like.onclick = () => bump("like");
  load();
}
function bindFeedback() {
  const box = $("fbBox"), send = $("fbSendBtn");
  if (!box || send.dataset.bound) return;
  send.dataset.bound = "1";
  try {
    fbCom = root.commentsPlugin({ channel: FEED_CHANNEL, width: "100%", height: 420, commentPlaceholderText: "Read suggestions below — or write yours in the form on the left.", onLoad: () => { fbReady = true; } });
    box.innerHTML = fbCom;
  } catch { box.textContent = "Feedback wall failed to load. Check connection and refresh."; }
  send.onclick = async () => {
    const cat = $("fbCatSel") ? $("fbCatSel").value : "idea";
    const nick = ($("fbNickInput") ? $("fbNickInput").value : "").trim();
    const text = ($("fbTextInput") ? $("fbTextInput").value : "").trim();
    const note = $("fbNote");
    if (!text) { if (note) note.textContent = "Write the suggestion first."; return; }
    if (!fbReady) { if (note) note.textContent = "Wall still loading — wait a moment and press Send again. Your text is kept."; return; }
    if (send.disabled) return;
    send.disabled = true;
    const prevLabel = send.textContent;
    send.textContent = "Sending…";
    if (note) note.textContent = "Sending… (the wall can take up to ~25s when busy)";
    const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("wall busy — timed out")), ms))]);
    try {
      if (!fbCom || !fbCom.submit) throw new Error("wall not ready — refresh and try again");
      if (fbCom.setNicknameForNextComment && nick) { try { await withTimeout(fbCom.setNicknameForNextComment(nick), 8000); } catch {} }
      await withTimeout(fbCom.submit(`[${cat}] ${text.slice(0, 800)}`, { timeoutMs: 25000 }), 28000);
      if ($("fbTextInput")) $("fbTextInput").value = "";
      try { telLog("feedback-post"); } catch {}
      if (note) note.textContent = "Posted. Thanks!";
    } catch (e) {
      const msg = String((e && e.message) || e || "");
      if (note) note.textContent = /timed out|wall busy/i.test(msg) ? "The wall is busy and did not answer in time — your text is kept above, wait a moment and press Send again." : "Could not post (" + msg.slice(0, 120) + "). Wait a moment and try again.";
    } finally {
      send.disabled = false;
      send.textContent = prevLabel;
    }
  };
}

function hookTelemetry() {
  if (document.body.dataset.telBound) return;
  document.body.dataset.telBound = "1";
  document.addEventListener("click", (e) => {
    const tab = e.target.closest ? e.target.closest(".studio-tab") : null;
    if (tab) { telLog("nav"); return; }
    const id = e.target.closest ? (e.target.closest("[id]") || {}).id : "";
    if (id === "generateBtn") telLog("video-gen");
    else if (id === "imgGenerateBtn") telLog("image-gen");
    else if (id === "chatSendBtn") telLog("chat");
    else if (id === "readerNarrateBtn") telLog("reader");
    else if (id === "voicePlayBtn") telLog("voice");
    else if (id === "edExportBtn") telLog("editor-export");
    else if (id === "sbGenBtn") telLog("storyboard");
    else if (id === "sbCompileBtn") telLog("compile");
  }, true);
  telLog("visit");
}

async function firstRun() {
  let prof = null;
  try { prof = await kvRoot().guide.get("profile"); } catch {}
  if (prof) return;
  const dlg = $("guideFirstRun");
  if (!dlg || !dlg.showModal) return;
  const save = async (type) => {
    try { await kvRoot().guide.set("profile", { type, ts: Date.now() }); } catch {}
    telLog("profile");
    dlg.close();
    if (type === "new") {
      document.querySelector('[data-page="pageTutorial"]')?.click();
      setHover(true);
    }
  };
  $("guideNewBtn").onclick = () => save("new");
  $("guideRetBtn").onclick = () => save("returning");
  dlg.showModal();
}

function bindTutorialHelpers() {
  const again = $("tutReplayBtn");
  if (again && !again.dataset.bound) {
    again.dataset.bound = "1";
    again.onclick = async () => {
      try { await kvRoot().guide.delete("profile"); } catch {}
      location.reload();
    };
  }
  document.querySelectorAll("[data-goto]").forEach((b) => {
    if (b.dataset.gotoBound) return;
    b.dataset.gotoBound = "1";
    b.onclick = () => {
      if (b.dataset.goto === "tutor-settings") { const d = $("settingsDlg"); if (d && d.showModal) d.showModal(); return; }
      document.querySelector(`[data-page="${b.dataset.goto}"]`)?.click();
      if (b.dataset.anchor) setTimeout(() => $(b.dataset.anchor)?.scrollIntoView({ behavior: "smooth" }), 150);
    };
  });
  const fb = $("footFeedback"), rm = $("footRoadmap"), tb = $("footTutorial");
  if (fb) fb.onclick = () => document.querySelector('[data-page="pageFeedback"]')?.click();
  if (tb) tb.onclick = () => document.querySelector('[data-page="pageTutorial"]')?.click();
  if (rm) rm.onclick = () => {
    document.querySelector('[data-page="pageTutorial"]')?.click();
    setTimeout(() => $("tutRoadmap")?.scrollIntoView({ behavior: "smooth" }), 150);
  };
  const st = $("settingsTutorBtn");
  if (st) st.onclick = () => { const d = $("settingsDlg"); if (d && d.open) d.close(); document.querySelector('[data-page="pageTutor"]')?.click(); };
}

let logoClicks = [];
let logoTimer = 0;
function bindOwnerEntry() {
  const logo = $("brandLogo");
  if (!logo) return;
  logo.setAttribute("title", "AI Multimedia Toolkit (Tap 7 times for private vault)");
  logo.onclick = (e) => {
    e.preventDefault();
    const now = Date.now();
    logoClicks = logoClicks.filter((t) => now - t < 3500);
    logoClicks.push(now);

    // Subtle tactile tap response
    logo.style.transform = "scale(0.92)";
    setTimeout(() => { if (logo) logo.style.transform = ""; }, 120);

    if (logoClicks.length >= 7) {
      logoClicks = [];
      clearTimeout(logoTimer);
      openOwnerGate();
      return;
    }
  };
  if ((location.hash || "") === "#owner") setTimeout(openOwnerGate, 1200);
}

function openOwnerGate() {
  const dlg = $("ownerGate");
  if (!dlg || !dlg.showModal) return;
  const has = (() => { try { return !!localStorage.getItem(LS_PIN); } catch { return false; } })();
  $("ownerGateTitle").textContent = has ? "Owner Vault Unlock" : "Create Owner PIN";
  $("ownerGateMsg").textContent = has ? "Enter your owner PIN. Stored only in this browser." : "First time: set a PIN. It is stored ONLY in this browser, never in the app source.";
  $("ownerPinInput").value = "";
  dlg.showModal();
}

function bindOwner() {
  bindOwnerEntry();
  const ok = $("ownerPinOk"), cancel = $("ownerPinCancel");
  if (!ok || ok.dataset.bound) return;
  ok.dataset.bound = "1";
  let fails = 0, lockedUntil = 0;
  const closeBox = () => {
    const b = $("ownerBox");
    if (b) {
      b.hidden = true;
      b.setAttribute("hidden", "");
    }
  };
  $("ownerCloseBtn").onclick = closeBox;
  const ob = $("ownerBox");
  if (ob) {
    ob.onclick = (e) => { if (e.target === ob) closeBox(); };
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const b = $("ownerBox");
      if (b && !b.hidden) closeBox();
    }
  });

  cancel.onclick = () => $("ownerGate").close();
  ok.onclick = () => {
    const now = Date.now();
    const msg = $("ownerGateMsg");
    if (now < lockedUntil) { msg.textContent = "Locked after failed attempts. Wait a minute and retry."; return; }
    const pin = $("ownerPinInput").value || "";
    if (pin.length < 4) { msg.textContent = "PIN needs at least 4 characters."; return; }
    let saved = null;
    try { saved = localStorage.getItem(LS_PIN); } catch {}
    if (!saved) {
      try { localStorage.setItem(LS_PIN, pin); } catch {}
      $("ownerGate").close();
      openOwnerBox();
      return;
    }
    if (pin === saved) {
      fails = 0;
      $("ownerGate").close();
      openOwnerBox();
    } else {
      fails++;
      if (fails >= 5) { lockedUntil = now + 60000; fails = 0; msg.textContent = "Too many tries. Locked 60s."; }
      else msg.textContent = `Wrong PIN (${fails}/5).`;
    }
  };
  $("ownerExportBtn").onclick = () => {
    const data = JSON.stringify({ stats: loadStats(), exportedAt: new Date().toISOString() }, null, 2);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    a.download = "owner-stats.json";
    a.click();
  };
  $("ownerRefreshBtn").onclick = () => openOwnerBox(true);
}

const TEL_WORD = {
  visit: "opened the app", nav: "moved around", "video-gen": "made a video",
  "image-gen": "made a picture", chat: "used AI chat", reader: "read a document",
  voice: "made a voiceover", "editor-export": "exported an edit",
  profile: "answered the welcome box", "feedback-post": "sent feedback",
  storyboard: "built a storyboard", compile: "compiled a story video",
};
function telTime(c) {
  try {
    const t = new Date(c.time || 0).getTime();
    if (!t) return "";
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " hr ago";
    return new Date(t).toLocaleDateString();
  } catch { return ""; }
}
function telKindsOf(msg) {
  const out = [];
  const re = /(visit|nav|video-gen|image-gen|chat|reader|voice|editor-export|profile|feedback-post|storyboard|compile)(?:x(\d+))?/g;
  let m;
  while ((m = re.exec(String(msg || "")))) out.push({ kind: m[1], n: Math.min(99, Number(m[2]) || 1) });
  return out;
}
function telAgg() {
  const counts = {};
  const active = new Set();
  let visits = 0, gens = 0;
  const now = Date.now();
  for (const c of telCache) {
    const sidm = /s([a-z0-9]{5})\b/.exec(String(c.message || ""));
    let t = 0;
    try { t = new Date(c.time || 0).getTime() || 0; } catch {}
    if (t && now - t < 5 * 60 * 1000 && sidm) active.add(sidm[1]);
    for (const k of telKindsOf(c.message)) {
      counts[k.kind] = (counts[k.kind] || 0) + k.n;
      if (k.kind === "visit") visits += k.n;
      if (k.kind === "video-gen" || k.kind === "image-gen") gens += k.n;
    }
  }
  return { counts, activeNow: active.size, visits, gens };
}
function paintTelDash() {
  const box = $("ownerTelBox");
  if (!box || !box.dataset.wired) return;
  const agg = telAgg();
  const counts = agg.counts;
  const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  set("telNow", telFeedLive ? String(agg.activeNow) : "...");
  set("telVisits", telFeedLive ? String(agg.visits) : "...");
  set("telGens", telFeedLive ? String(agg.gens) : "...");
  const dot = $("telDot");
  if (dot) dot.className = "tel-dot " + (telFeedLive ? (agg.activeNow > 0 ? "live" : "idle") : "off");
  const st = $("telStatus");
  if (st) {
    st.textContent = !telFeedLive ? "Connecting to the live channel..."
      : (!telCache.length ? "Connected - no visitor activity yet. (Normal before launch: this fills itself once the app is public.)"
        : (agg.activeNow > 0 ? "Live - visitors active now." : "Connected - no one active in the last 5 minutes."));
  }
  const bars = $("telBars");
  if (bars) {
    bars.innerHTML = "";
    const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 8);
    if (!keys.length) {
      const d = document.createElement("div");
      d.className = "tel-empty";
      d.textContent = telFeedLive ? "Nothing to show yet." : "Connecting...";
      bars.appendChild(d);
    }
    const max = Math.max(1, ...keys.map((k) => counts[k]));
    for (const k of keys) {
      const row = document.createElement("div");
      row.className = "tel-bar-row";
      const lab = document.createElement("span");
      lab.className = "tel-bar-lab";
      lab.textContent = TEL_WORD[k] || k;
      const bar = document.createElement("span");
      bar.className = "tel-bar";
      const fill = document.createElement("i");
      fill.style.width = Math.max(4, Math.round((counts[k] / max) * 100)) + "%";
      bar.appendChild(fill);
      const n = document.createElement("span");
      n.className = "tel-bar-n mono";
      n.textContent = String(counts[k]);
      row.appendChild(lab); row.appendChild(bar); row.appendChild(n);
      bars.appendChild(row);
    }
  }
  const feed = $("ownerTelFeed");
  if (feed) {
    feed.innerHTML = "";
    const recent = telCache.slice(-12).reverse();
    if (!recent.length) {
      const d = document.createElement("div");
      d.className = "tel-empty";
      d.textContent = telDemo ? "Sample preview is ON - real visits will appear here too." : (telFeedLive ? "Latest doings will appear here." : "Connecting...");
      feed.appendChild(d);
    }
    for (const c of recent) {
      const kinds = telKindsOf(c.message);
      const row = document.createElement("div");
      row.className = "tel-row";
      const t = document.createElement("span");
      t.className = "tel-t";
      t.textContent = telTime(c);
      const m = document.createElement("span");
      m.className = "tel-m";
      m.textContent = kinds.length
        ? "Someone " + kinds.map((k) => (TEL_WORD[k.kind] || k.kind) + (k.n > 1 ? " (" + k.n + "x)" : "")).join(", ")
        : "Heartbeat from a visitor";
      row.appendChild(t); row.appendChild(m);
      feed.appendChild(row);
    }
  }
}
let telDemo = false;
function telDemoRows() {
  const now = Date.now();
  const mk = (minAgo, msg) => ({ message: msg + " sDEMO1", time: new Date(now - minAgo * 60000).toISOString() });
  return [
    mk(1, "visit video-gen"),
    mk(4, "chat"),
    mk(9, "image-genx2"),
    mk(16, "visit reader voice"),
    mk(31, "storyboard compile"),
  ];
}
function bindTelFeed() {
  const box = $("ownerTelBox");
  if (!box || box.dataset.wired) return;
  box.dataset.wired = "1";
  box.innerHTML = "";
  const head = document.createElement("div");
  head.className = "tel-head";
  const dot = document.createElement("span");
  dot.id = "telDot"; dot.className = "tel-dot off";
  const st = document.createElement("span");
  st.id = "telStatus"; st.className = "tel-status";
  st.textContent = "Connecting to the live channel...";
  head.appendChild(dot); head.appendChild(st);
  box.appendChild(head);
  const cards = document.createElement("div");
  cards.className = "tel-cards";
  const defs = [["telNow", "Here now"], ["telVisits", "Opened app"], ["telGens", "Videos + pictures"]];
  for (const [id, label] of defs) {
    const c = document.createElement("div");
    c.className = "tel-card";
    const v = document.createElement("div");
    v.id = id; v.className = "tel-big mono"; v.textContent = "...";
    const l = document.createElement("div");
    l.className = "tel-lab"; l.textContent = label;
    c.appendChild(v); c.appendChild(l);
    cards.appendChild(c);
  }
  box.appendChild(cards);
  const h1 = document.createElement("h5");
  h1.className = "tel-h"; h1.textContent = "What visitors are doing";
  box.appendChild(h1);
  const bars = document.createElement("div");
  bars.id = "telBars";
  box.appendChild(bars);
  const h2 = document.createElement("h5");
  h2.className = "tel-h"; h2.textContent = "Latest doings";
  box.appendChild(h2);
  const feed = document.createElement("div");
  feed.id = "ownerTelFeed"; feed.className = "tel-feed";
  box.appendChild(feed);
  const row = document.createElement("div");
  row.className = "tel-btnrow";
  const demo = document.createElement("button");
  demo.type = "button"; demo.className = "btn btn-tiny"; demo.textContent = "Show sample preview";
  demo.onclick = () => {
    telDemo = !telDemo;
    demo.textContent = telDemo ? "Hide sample preview" : "Show sample preview";
    if (telDemo) telCache = telCache.concat(telDemoRows());
    else telCache = telCache.filter((c) => !/sDEMO1\b/.test(String(c.message || "")));
    if (telDemo) telFeedLive = true;
    paintTelDash();
  };
  const csv = document.createElement("button");
  csv.type = "button"; csv.className = "btn btn-tiny"; csv.textContent = "Download report";
  csv.onclick = () => {
    const agg = telAgg();
    const lines = ["What,How many", "Here now," + agg.activeNow, "Opened app," + agg.visits, "Videos + pictures," + agg.gens];
    for (const k of Object.keys(agg.counts).sort()) lines.push('"' + (TEL_WORD[k] || k).replace(/"/g, "") + '",' + agg.counts[k]);
    lines.push("", "When,What happened");
    for (const c of telCache.slice(-50)) {
      const what = telKindsOf(c.message).map((k) => TEL_WORD[k.kind] || k.kind).join(" + ") || "heartbeat";
      let when = "";
      try { when = new Date(c.time || 0).toLocaleString(); } catch {}
      lines.push('"' + when + '","' + what.replace(/"/g, "") + '"');
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = "visitor-report.csv";
    a.click();
  };
  row.appendChild(demo); row.appendChild(csv);
  box.appendChild(row);
  const safe = document.createElement("button");
  safe.type = "button"; safe.className = "btn btn-tiny btn-danger";
  safe.style.marginTop = "8px";
  const paintSafe = () => { safe.textContent = isSafeMode() ? "Safe mode is ON - tap to reopen the app" : "Emergency: lock app to offline"; };
  safe.onclick = () => { setSafeMode(!isSafeMode()); paintSafe(); };
  paintSafe();
  box.appendChild(safe);
  paintTelDash();
}

const LS_SAFE = "amt_safe";
function isSafeMode() {
  try { return localStorage.getItem(LS_SAFE) === "1"; } catch { return !!window.__AMT_SAFE; }
}
function setSafeMode(on) {
  try { localStorage.setItem(LS_SAFE, on ? "1" : "0"); } catch {}
  window.__AMT_SAFE = !!on;
  try { paintSafeBanner(); } catch {}
}
function paintSafeBanner() {
  let b = document.getElementById("safeBanner");
  if (!isSafeMode()) { if (b) b.hidden = true; return; }
  if (!b) {
    b = document.createElement("div");
    b.id = "safeBanner";
    b.className = "banner";
    b.style.marginTop = "8px";
    const app = document.getElementById("app");
    if (app && app.firstChild) app.insertBefore(b, app.firstChild.nextSibling);
    else return;
  }
  b.hidden = false;
  b.innerHTML = "";
  const s = document.createElement("span");
  s.textContent = "Safe mode is ON: the app is locked to on-device rendering only. Visitors can browse but nothing leaves the device.";
  b.appendChild(s);
}

function openOwnerBox(refresh) {
  const box = $("ownerBox");
  if (!box) return;
  box.hidden = false;
  box.removeAttribute("hidden");
  const st = $("ownerStats");
  if (st) {
    const s = loadStats();
    const keys = Object.keys(s);
    st.textContent = keys.length ? keys.map((k) => `${k}: ${s[k]}`).join(" · ") : "No local events yet on this device.";
  }
  try {
    if (!refresh || !$("ownerFbBox").dataset.loaded) {
      const f = root.commentsPlugin({ channel: FEED_CHANNEL, width: "100%", height: 300, newestCommentsAtTop: true });
      if (f instanceof Node) {
        $("ownerFbBox").replaceChildren(f);
      } else {
        $("ownerFbBox").innerHTML = String(f || "");
      }
      $("ownerFbBox").dataset.loaded = "1";
    }
  } catch {}
  try { bindTelFeed(); paintTelDash(); } catch {}
}

function bindFontSize() {
  const range = $("fontSizeRange"), out = $("fontSizeVal"), reset = $("fontSizeResetBtn");
  const apply = (v) => {
    const app = $("app");
    if (app) app.style.zoom = v === 100 ? "" : String(v / 100);
    if (out) out.textContent = v + "%";
    if (range && range.value !== String(v)) range.value = String(v);
    try { localStorage.setItem("amt_font", String(v)); } catch {}
  };
  let saved = 100;
  try { saved = Math.min(125, Math.max(80, Number(localStorage.getItem("amt_font")) || 100)); } catch {}
  apply(saved);
  if (!range || range.dataset.bound) return;
  range.dataset.bound = "1";
  range.oninput = () => apply(Number(range.value));
  if (reset) reset.onclick = () => apply(100);
}

const IMG_STAGES = [
  "Warming up the studio…",
  "Dreaming the composition…",
  "Painting light and color…",
  "Directing the details…",
  "Polishing pixels…",
  "Framing the variations…",
];
let imgLogTimer = 0;
let imgLogMode = "Simple";
function imgLogFacts() {
  const m = ($("imgModelSel") || {}).value || "auto";
  const d = ($("imgDimsOut") || {}).textContent || "";
  const s = (($("imgSeedInput") || {}).value || "").trim() || "random";
  return `model ${m}${d ? " · " + d.trim() : ""} · seed ${s}`;
}
function imgLogLine(msg) {
  const box = $("imgLogBox");
  if (!box) return;
  if (!box.textContent || box.textContent === "Ready.") box.textContent = msg;
  else box.textContent += "\n" + msg;
  box.scrollTop = box.scrollHeight;
}
function bindImgLog() {
  const box = $("imgLogBox");
  if (!box || box.dataset.bound) return;
  box.dataset.bound = "1";
  const row = $("imgLogModeRow");
  if (row) {
    row.innerHTML = "";
    for (const m of ["Simple", "Full"]) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = m;
      if (m === imgLogMode) b.classList.add("on");
      b.onclick = () => { imgLogMode = m; [...row.children].forEach((x) => x.classList.toggle("on", x === b)); };
      row.appendChild(b);
    }
  }
  const stop = (msg) => { if (imgLogTimer) { clearInterval(imgLogTimer); imgLogTimer = 0; } if (msg) imgLogLine(msg); };
  let i = 0;
  const gen = $("imgGenerateBtn");
  if (gen) gen.addEventListener("click", () => {
    stop();
    box.textContent = "";
    i = 0;
    imgLogLine(imgLogMode === "Full" ? `Starting · ${imgLogFacts()}` : "Starting…");
    imgLogTimer = setInterval(() => {
      const st = IMG_STAGES[i % IMG_STAGES.length];
      imgLogLine(imgLogMode === "Full" ? `${st} · ${imgLogFacts()}` : st);
      i++;
    }, 1600);
  });
  const cancel = $("imgCancelBtn");
  if (cancel) cancel.addEventListener("click", () => stop("Stopped."));
  const busy = $("imgBusy");
  if (busy) new MutationObserver(() => { if (busy.hidden && imgLogTimer) stop("Done — on the canvas."); }).observe(busy, { attributes: true, attributeFilter: ["hidden"] });
}

if (typeof window !== "undefined" && !window.__amtRejGuard) {
  window.__amtRejGuard = true;
  window.addEventListener("unhandledrejection", (e) => {
    const msg = String((e && e.reason && e.reason.message) || e.reason || "");
    if (/comment to be submitted|message_submit_response/i.test(msg)) { try { e.preventDefault(); } catch {} }
  });
}
function init() {
  bindFontSize();
  bindImgLog();
  bindTutorPage();
  bindAskFab();
  bindHover();
  bindFeedback();
  bindVotes();
  bindTutorialHelpers();
  bindOwner();
  hookTelemetry();
  firstRun();
  try { paintSafeBanner(); } catch {}
  window.AMTGuide = { telLog, askAI, setHover, openOwnerGate };
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
