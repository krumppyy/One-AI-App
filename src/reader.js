const $ = (id) => document.getElementById(id);
const LS_KEY = "avg_reader_docs";
const MAX_DOCS = 20;
const MAX_CHARS = 120000;

let pdfLib = null;
let mammothLib = null;
let tessLib = null;
let activeGen = null;
let booted = false;

function log(msg) {
  const box = $("readerLog");
  if (!box) return;
  if (box.textContent.trim() === "Ready.") box.textContent = "";
  const t = new Date().toLocaleTimeString();
  box.textContent += `[${t}] ${msg}\n`;
  box.scrollTop = box.scrollHeight;
}

function note(msg) {
  if ($("readerNote")) $("readerNote").textContent = msg;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function loadDocs() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveDocs(docs) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(docs.slice(0, MAX_DOCS))); } catch {}
}

function addDoc(name, text, kind) {
  const docs = loadDocs();
  const clean = String(text || "").replace(/\r/g, "").trim();
  docs.unshift({ id: "doc" + Date.now().toString(36) + Math.floor(Math.random() * 1e4), name: name || "untitled", text: clean.slice(0, MAX_CHARS), chars: clean.length, kind: kind || "text", at: Date.now() });
  saveDocs(docs);
  renderDocs();
  return docs[0];
}

function setBusy(on, msg) {
  if ($("readerBusy")) $("readerBusy").hidden = !on;
  if (msg && $("readerBusyMsg")) $("readerBusyMsg").textContent = msg;
  for (const id of ["readerNarrateBtn", "readerSendVoiceBtn"]) {
    if ($(id)) $(id).disabled = !!on;
  }
}

function renderDocs() {
  const list = $("readerDocList");
  if (!list) return;
  const docs = loadDocs();
  if (!docs.length) {
    list.innerHTML = `<div class="screen-ph"><strong>No documents yet</strong><p>Drop a file to extract its text.</p></div>`;
  } else {
    list.innerHTML = docs.map((d) => `
      <div class="reader-doc" data-id="${esc(d.id)}">
        <div class="reader-doc-head">
          <strong class="reader-doc-name">${esc(d.name)}</strong>
          <span class="mono tiny">${esc(d.kind)} · ${Number(d.chars || 0).toLocaleString()} chars</span>
        </div>
        <p class="reader-doc-snippet">${esc((d.text || "").slice(0, 140))}${(d.text || "").length > 140 ? "…" : ""}</p>
        <div class="reader-doc-actions">
          <button class="btn btn-tiny" type="button" data-act="load">Edit</button>
          <button class="btn btn-tiny" type="button" data-act="voice">→ Voice</button>
          <button class="btn btn-tiny" type="button" data-act="del">Delete</button>
        </div>
      </div>`).join("");
  }
  const tags = $("readerStageTags");
  if (tags) tags.textContent = docs.length ? `${docs.length} saved` : "";
  syncVoiceSelect();
}

function stripHtml(html) {
  try {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    doc.querySelectorAll("script,style,noscript,iframe,object,embed,link,meta").forEach((n) => n.remove());
    doc.querySelectorAll("*").forEach((n) => {
      for (const a of [...n.attributes]) {
        if (/^on/i.test(a.name)) n.removeAttribute(a.name);
      }
      n.removeAttribute("href");
      n.removeAttribute("src");
      n.removeAttribute("action");
    });
    return ((doc.body && doc.body.textContent) || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return String(html || "").replace(/<[^>]*>/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }
}

function stripRtf(rtf) {
  return String(rtf)
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\tab/g, " ")
    .replace(/\\'[0-9a-fA-F]{2}/g, " ")
    .replace(/\\[a-z]+\d*\s?/g, "")
    .replace(/[{}]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function ensurePdf() {
  if (pdfLib) return pdfLib;
  const m = await import("https://esm.sh/pdfjs-dist@4.2.67");
  m.GlobalWorkerOptions.workerSrc = "https://esm.sh/pdfjs-dist@4.2.67/build/pdf.worker.min.mjs";
  pdfLib = m;
  return m;
}

async function ensureMammoth() {
  if (mammothLib) return mammothLib;
  mammothLib = await import("https://esm.sh/mammoth@1.10.0");
  return mammothLib;
}

async function ensureTess() {
  if (tessLib) return tessLib;
  tessLib = await import("https://esm.sh/tesseract.js@5.1.1");
  return tessLib;
}

async function ocrImage(blob, onProgress) {
  const T = await ensureTess();
  const fn = T.recognize || (T.default && T.default.recognize);
  if (!fn) throw new Error("OCR engine failed to load");
  const url = URL.createObjectURL(blob);
  try {
    const res = await fn(url, "eng", { logger: (m) => { if (m && m.status === "recognizing text" && onProgress) onProgress(m.progress || 0); } });
    return (res && res.data && res.data.text ? res.data.text : "").trim();
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function extractPdf(file, label) {
  const pdf = await ensurePdf();
  const buf = await file.arrayBuffer();
  const doc = await pdf.getDocument({ data: buf }).promise;
  const parts = [];
  for (let p = 1; p <= Math.min(doc.numPages, 60); p++) {
    setBusy(true, `Reading PDF page ${p}/${doc.numPages}…`);
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const str = (tc.items || []).map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
    if (str.length > 40) {
      parts.push(str);
    } else {
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(2200, Math.floor(viewport.width));
      canvas.height = Math.min(2200, Math.floor(viewport.height));
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: Math.min(2, 2200 / viewport.width) }) }).promise;
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      setBusy(true, `Scanned page ${p} — running OCR…`);
      const txt = await ocrImage(blob, (pr) => setBusy(true, `OCR page ${p}/${doc.numPages} · ${Math.round(pr * 100)}%`));
      if (txt.trim()) parts.push(txt);
    }
  }
  try { await doc.destroy(); } catch {}
  if (!parts.length) throw new Error("No readable text found in " + label);
  return parts.join("\n\n");
}

async function extractDocx(file) {
  const M = await ensureMammoth();
  const buf = await file.arrayBuffer();
  const fn = M.extractRawText || (M.default && M.default.extractRawText);
  if (!fn) throw new Error("DOCX engine failed to load");
  const res = await fn({ arrayBuffer: buf });
  const text = (res && res.value ? res.value : "").trim();
  if (!text) throw new Error("No readable text found in this DOCX");
  return text;
}

function extOf(name) {
  const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

async function extractFile(file) {
  const ext = extOf(file.name);
  const type = file.type || "";
  const label = file.name || "file";
  if (ext === "doc") throw new Error(label + " is legacy .doc — re-save it as .docx or .pdf, then drop it here.");
  if (ext === "pdf" || type === "application/pdf") { setBusy(true, "Reading PDF…"); return { text: await extractPdf(file, label), kind: "pdf" }; }
  if (ext === "docx") { setBusy(true, "Reading DOCX…"); return { text: await extractDocx(file), kind: "docx" }; }
  if (["png", "jpg", "jpeg", "webp", "bmp", "gif"].includes(ext) || type.startsWith("image/")) {
    setBusy(true, "Running OCR on image…");
    const text = await ocrImage(file, (pr) => setBusy(true, `OCR · ${Math.round(pr * 100)}%`));
    if (!text.trim()) throw new Error("No text found in " + label);
    return { text, kind: "ocr" };
  }
  const raw = await file.text();
  if (["html", "htm"].includes(ext)) {
    const text = stripHtml(raw);
    if (!text) throw new Error("No readable text found in " + label);
    return { text, kind: "html" };
  }
  if (ext === "rtf") {
    const text = stripRtf(raw);
    if (!text) throw new Error("No readable text found in " + label);
    return { text, kind: "rtf" };
  }
  if (!raw.trim()) throw new Error(label + " looks empty.");
  return { text: raw.trim(), kind: ext || "text" };
}

async function handleFiles(files) {
  const list = [...(files || [])];
  if (!list.length) return;
  for (const f of list.slice(0, 5)) {
    try {
      log(`reading ${f.name} (${Math.round(f.size / 1024)} KB)…`);
      const { text, kind } = await extractFile(f);
      const doc = addDoc(f.name.replace(/\.[a-z0-9]+$/i, ""), text, kind);
      $("readerTextInput").value = doc.text;
      syncCounts();
      setBusy(false);
      log(`saved "${doc.name}" · ${doc.chars.toLocaleString()} chars (${kind})`);
      note(`Extracted ${doc.chars.toLocaleString()} chars from ${f.name}. Edit above, then Generate narration.`);
    } catch (e) {
      setBusy(false);
      const msg = (e && e.message) || String(e);
      log(`failed ${f.name}: ${msg}`);
      note(msg);
    }
  }
}

function syncCounts() {
  if ($("readerTextCount")) $("readerTextCount").textContent = `${($("readerTextInput").value || "").length.toLocaleString()} chars`;
  if ($("readerNarrCount")) $("readerNarrCount").textContent = `${($("readerNarrOut").value || "").length.toLocaleString()} chars`;
}

const MODE_LINE = {
  cleanup: "Fix OCR artefacts, broken line breaks and punctuation. Keep every fact and keep the wording as close to the original as possible. Do not summarize.",
  voiceover: "Rewrite as a natural spoken voiceover script: flowing sentences, spoken numbers and abbreviations expanded, filler removed, same facts and order.",
  summary: "Condense to a short spoken summary covering only the key points, in flowing narration sentences."
};

const TONE_LINE = {
  neutral: "Tone: neutral and clear.",
  warm: "Tone: warm and friendly.",
  dramatic: "Tone: dramatic and expressive, without changing facts.",
  calm: "Tone: calm and soothing, slow-paced phrasing."
};

async function generateNarration() {
  const src = ($("readerTextInput").value || "").trim();
  if (!src) { note("Nothing to narrate yet — drop a file or paste text first."); return; }
  const gen = typeof root !== "undefined" ? root.generateText : null;
  if (!gen) { note("The narration AI is still loading — try again in a second."); return; }
  const mode = $("readerModeSel").value || "cleanup";
  const tone = $("readerToneSel").value || "neutral";
  const input = src.slice(0, 30000);
  const instruction = [
    "You turn source text into narration for a voiceover. Reply with ONLY the narration script, no preamble, no quotes.",
    MODE_LINE[mode] || MODE_LINE.cleanup,
    TONE_LINE[tone] || TONE_LINE.neutral,
    "Source text:",
    input
  ].join("\n");
  const out = $("readerNarrOut");
  out.value = "";
  setBusy(true, "Writing narration…");
  if ($("readerNarrateLabel")) $("readerNarrateLabel").textContent = "Writing…";
  if ($("readerStopBtn")) $("readerStopBtn").hidden = false;
  log(`narration started (${mode}, ${tone}, ${input.length.toLocaleString()} chars in)`);
  try {
    let ok = false;
    try {
      const p = gen({ instruction, onChunk: (d) => { out.value += (d && d.textChunk) || ""; syncCounts(); } });
      activeGen = p;
      await p;
      activeGen = null;
      ok = out.value.trim().length > 0;
    } catch (e) { log(`narration primary failed: ${(e && e.message) || e} — trying free pool`); }
    if (!ok) {
      out.value = "";
      const res = await fetch("https://text.pollinations.ai/openai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "openai", messages: [{ role: "user", content: instruction }], stream: false, private: true }) });
      if (!res.ok) throw new Error("AI pool busy (" + res.status + ")");
      const j = await res.json();
      out.value = (j.choices?.[0]?.message?.content || "").trim();
      syncCounts();
      if (!out.value) throw new Error("Empty reply from the AI pool.");
    }
    syncCounts();
    if ($("readerNarrMeta")) $("readerNarrMeta").textContent = `${out.value.length.toLocaleString()} chars · ${mode}`;
    log(`narration done · ${out.value.length.toLocaleString()} chars`);
    note("Narration ready. Send it to Voice, or edit it first.");
    addDoc("narration " + new Date().toLocaleTimeString(), out.value, "narration");
    try {
      const { saveTextToLibrary } = await import("./library-save.js");
      saveTextToLibrary({ tab: "reader", text: out.value, filename: "narration-" + new Date().toISOString().slice(0, 10) + ".txt", prompt: out.value.slice(0, 120) });
    } catch (e) {}
  } catch (e) {
    log(`narration failed: ${(e && e.message) || e}`);
    note(`Couldn't generate narration: ${(e && e.message) || e}`);
  } finally {
    setBusy(false);
    if ($("readerNarrateLabel")) $("readerNarrateLabel").textContent = "Generate narration";
    if ($("readerStopBtn")) $("readerStopBtn").hidden = true;
  }
}

function sendToVoice(text, name) {
  const box = $("voiceTextInput");
  if (!box) { note("Voice tab isn't ready yet."); return; }
  box.value = text || "";
  box.dispatchEvent(new Event("input", { bubbles: true }));
  const tab = document.querySelector('[data-page="pageVoice"]');
  if (tab) tab.click();
  log(`sent "${name || "narration"}" to Voice (${(text || "").length.toLocaleString()} chars)`);
}

function syncVoiceSelect() {
  const sel = $("readerVoiceSel");
  if (!sel) return;
  const docs = loadDocs();
  const cur = sel.value;
  sel.innerHTML = docs.length
    ? docs.map((d) => `<option value="${esc(d.id)}">${esc(d.name)} · ${Number(d.chars || 0).toLocaleString()}c</option>`).join("")
    : `<option value="">No saved documents yet</option>`;
  if (cur && docs.some((d) => d.id === cur)) sel.value = cur;
  const btn = $("readerVoiceLoadBtn");
  if (btn) btn.disabled = !docs.length;
}

function injectVoiceRow() {
  if ($("readerVoiceSel") || !$("voiceTextInput")) return false;
  const field = $("voiceTextInput").closest(".field");
  if (!field) return false;
  const row = document.createElement("div");
  row.className = "field";
  row.id = "readerVoiceRow";
  row.innerHTML = `
    <label class="lbl" for="readerVoiceSel">From Reader <span class="hint">named files saved in the Reader tab</span></label>
    <div class="key-row">
      <select id="readerVoiceSel" class="mono"></select>
      <button id="readerVoiceLoadBtn" class="btn btn-tiny" type="button">Load</button>
    </div>`;
  field.after(row);
  $("readerVoiceLoadBtn").onclick = () => {
    const d = loadDocs().find((x) => x.id === $("readerVoiceSel").value);
    if (!d) { note("Pick a saved document first."); return; }
    $("voiceTextInput").value = d.text || "";
    $("voiceTextInput").dispatchEvent(new Event("input", { bubbles: true }));
    log(`loaded "${d.name}" from Reader into Voice`);
  };
  syncVoiceSelect();
  return true;
}

function bind() {
  if (booted || !$("readerDropzone")) return;
  booted = true;
  const dz = $("readerDropzone");
  const fi = $("readerFileInput");
  dz.addEventListener("click", (e) => { if (!e.target.closest("button")) fi.click(); });
  dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fi.click(); } });
  fi.addEventListener("change", () => { handleFiles(fi.files); fi.value = ""; });
  ["dragover", "dragenter"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", (e) => handleFiles(e.dataTransfer && e.dataTransfer.files));
  $("readerAddBtn").onclick = (e) => { e.stopPropagation(); fi.click(); };
  $("readerClearBtn").onclick = (e) => { e.stopPropagation(); $("readerTextInput").value = ""; syncCounts(); note("Cleared. Drop a file to start again."); };
  $("readerTextInput").addEventListener("input", syncCounts);
  $("readerNarrOut").addEventListener("input", syncCounts);
  $("readerNarrateBtn").onclick = generateNarration;
  $("readerStopBtn").onclick = () => { try { activeGen && activeGen.stop && activeGen.stop(); } catch {} };
  $("readerSendVoiceBtn").onclick = () => {
    const t = ($("readerNarrOut").value || "").trim() || ($("readerTextInput").value || "").trim();
    if (!t) { note("Nothing to send yet."); return; }
    sendToVoice(t, "reader narration");
  };
  $("readerDocList").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    const card = e.target.closest(".reader-doc");
    if (!btn || !card) return;
    const docs = loadDocs();
    const d = docs.find((x) => x.id === card.dataset.id);
    if (!d) return;
    if (btn.dataset.act === "del") {
      saveDocs(docs.filter((x) => x.id !== d.id));
      renderDocs();
      log(`deleted "${d.name}"`);
    } else if (btn.dataset.act === "load") {
      $("readerTextInput").value = d.text || "";
      syncCounts();
      note(`Loaded "${d.name}" for editing.`);
    } else if (btn.dataset.act === "voice") {
      const t = ($("readerNarrOut").value || "").trim() || d.text || "";
      sendToVoice(t, d.name);
    }
  });
  renderDocs();
  syncCounts();
  let tries = 0;
  const t = setInterval(() => {
    if (injectVoiceRow() || ++tries > 40) clearInterval(t);
  }, 500);
  injectVoiceRow();
  setInterval(() => { if ($("readerVoiceSel") && !$("readerVoiceSel").options.length) syncVoiceSelect(); }, 2500);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(bind, 400));
else setTimeout(bind, 400);
setInterval(bind, 2500);

window.ReaderBridge = { extractFile, loadDocs, addDoc };
