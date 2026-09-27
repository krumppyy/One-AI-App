import { getHistory, listHistory } from "./store.js";

const ICO_COMPUTER = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="3" y="4.5" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 20.5h6M12 16.5v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 11.5V7.5m0 0-2.5 2.5M12 7.5l2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICO_LIBRARY = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h5l2 2.5h7A1.5 1.5 0 0 1 20.5 9v8.5a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const ICO_IMG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="10" r="1.6" fill="currentColor"/><path d="M4.5 17.5 10 12l3.5 3.5 2.5-2.5 3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICO_VID = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="3" y="5.5" width="12.5" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15.5 10.5 20.5 7.8v8.4l-5-2.7z" fill="currentColor"/></svg>';

export function chooseImportSource(anchor) {
  return new Promise((resolve) => {
    const old = document.getElementById("importChoiceMenu");
    if (old) old.remove();
    const menu = document.createElement("div");
    menu.id = "importChoiceMenu";
    menu.className = "import-choice";
    menu.setAttribute("role", "menu");
    const mk = (icon, label, val) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "import-choice-btn";
      b.setAttribute("role", "menuitem");
      const ic = document.createElement("span");
      ic.className = "imp-ico";
      ic.innerHTML = icon;
      const t = document.createElement("span");
      t.className = "imp-label";
      t.textContent = label;
      b.append(ic, t);
      b.onclick = (e) => { e.stopPropagation(); close(val); };
      return b;
    };
    menu.append(
      mk(ICO_COMPUTER, "My computer", "computer"),
      mk(ICO_LIBRARY, "Library", "library")
    );
    document.body.appendChild(menu);
    const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
    const mw = 220, mh = 120;
    let x = r ? r.left + window.scrollX : window.scrollX + innerWidth / 2 - mw / 2;
    let y = r ? r.bottom + window.scrollY + 6 : window.scrollY + 200;
    x = Math.max(8 + window.scrollX, Math.min(x, window.scrollX + innerWidth - mw - 8));
    if (y + mh > window.scrollY + innerHeight - 8) y = Math.max(8, (r ? r.top + window.scrollY - mh - 6 : y));
    menu.style.left = x + "px";
    menu.style.top = y + "px";
    let done = false;
    const close = (val) => {
      if (done) return;
      done = true;
      document.removeEventListener("pointerdown", onDoc, true);
      document.removeEventListener("keydown", onKey, true);
      menu.remove();
      resolve(val);
    };
    const onDoc = (e) => { if (!menu.contains(e.target)) close(null); };
    const onKey = (e) => { if (e.key === "Escape") close(null); };
    setTimeout(() => {
      document.addEventListener("pointerdown", onDoc, true);
      document.addEventListener("keydown", onKey, true);
    }, 0);
  });
}

function thumbFor(it) {
  if (it.poster && typeof it.poster === "string" && it.poster.startsWith("data:")) return it.poster;
  return "";
}

export function pickLibraryMedia({ accept = "image", multi = false, title = "Import from Library" } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const close = (val) => {
      if (done) return;
      done = true;
      dlg.close();
      dlg.remove();
      resolve(val);
    };
    const dlg = document.createElement("dialog");
    dlg.className = "modal libpick-dlg";
    const okLabel = multi ? "Import selected" : "Import";
    dlg.innerHTML = "";
    const inner = document.createElement("div");
    inner.className = "modal-inner";
    const head = document.createElement("header");
    head.className = "modal-head";
    const h = document.createElement("h3");
    h.textContent = title;
    const x = document.createElement("button");
    x.type = "button";
    x.className = "btn btn-tiny";
    x.textContent = "Cancel";
    x.onclick = () => close(null);
    head.append(h, x);
    const tools = document.createElement("div");
    tools.className = "libpick-tools";
    const search = document.createElement("input");
    search.className = "mono";
    search.type = "search";
    search.placeholder = "Find…";
    search.autocomplete = "off";
    const count = document.createElement("span");
    count.className = "mono tiny";
    tools.append(search, count);
    const grid = document.createElement("div");
    grid.className = "libpick-grid";
    const foot = document.createElement("div");
    foot.className = "libpick-foot";
    const selInfo = document.createElement("span");
    selInfo.className = "mono tiny";
    const go = document.createElement("button");
    go.type = "button";
    go.className = "btn btn-primary btn-tiny";
    go.textContent = okLabel;
    go.disabled = true;
    foot.append(selInfo, go);
    inner.append(head, tools, grid, foot);
    dlg.appendChild(inner);
    document.body.appendChild(dlg);
    let items = [];
    const picked = new Set();
    const isVid = (it) => String(it.mime || "").startsWith("video/");
    const isImg = (it) => String(it.mime || "").startsWith("image/");
    const isCodecFile = (it) => /\.(soma|ankan)$/i.test(it.filename || "") || /^(ankan|soma)-codec$/.test(it.provider || "");
    const usable = (it) => {
      if (it.locked) return false;
      if (isCodecFile(it)) return true;
      if (accept === "image") return isImg(it);
      if (accept === "video") return isVid(it);
      return isImg(it) || isVid(it);
    };
    const paint = () => {
      const q = search.value.trim().toLowerCase();
      grid.innerHTML = "";
      const rows = items.filter((it) => {
        if (!usable(it)) return false;
        if (!q) return true;
        const hay = ((it.name || "") + " " + (it.filename || "")).toLowerCase();
        return hay.includes(q);
      });
      count.textContent = rows.length + " file" + (rows.length === 1 ? "" : "s");
      if (!rows.length) {
        const p = document.createElement("p");
        p.className = "muted small";
        p.textContent = "Nothing here yet — generate or import something first.";
        grid.appendChild(p);
      }
      for (const it of rows) {
        const vid = isVid(it);
        const name = (it.name || it.filename || "untitled").slice(0, 32);
        const card = document.createElement("button");
        card.type = "button";
        card.className = "libpick-card" + (picked.has(it.key) ? " on" : "");
        card.title = name;
        const th = thumbFor(it);
        if (th) {
          const wrap = document.createElement("span");
          wrap.className = "libpick-thumb";
          const img = document.createElement("img");
          img.src = th;
          img.alt = name;
          img.loading = "lazy";
          wrap.appendChild(img);
          card.appendChild(wrap);
        } else {
          const ph = document.createElement("span");
          ph.className = "libpick-ph";
          ph.innerHTML = vid ? ICO_VID : ICO_IMG;
          card.appendChild(ph);
        }
        const meta = document.createElement("span");
        meta.className = "libpick-meta";
        const ic = document.createElement("span");
        ic.className = "libpick-ico";
        ic.innerHTML = vid ? ICO_VID : ICO_IMG;
        const tag = document.createElement("span");
        tag.className = "libpick-name";
        tag.textContent = name;
        meta.append(ic, tag);
        card.appendChild(meta);
        card.onclick = async () => {
          if (multi) {
            if (picked.has(it.key)) picked.delete(it.key);
            else picked.add(it.key);
            card.classList.toggle("on", picked.has(it.key));
            sync();
          } else {
            close(await loadItems([it.key]));
          }
        };
        grid.appendChild(card);
      }
      sync();
    };
    const sync = () => {
      selInfo.textContent = picked.size ? picked.size + " selected" : multi ? "tap to select" : "tap an item";
      go.disabled = picked.size === 0;
      go.textContent = multi ? "Import selected (" + picked.size + ")" : okLabel;
    };
    const loadItems = async (keys) => {
      const out = [];
      for (const k of keys) {
        try {
          const rec = await getHistory(k);
          if (rec && rec.video instanceof Blob && rec.video.size) {
            out.push({ blob: rec.video, name: rec.name || rec.filename || "library" });
          }
        } catch {}
      }
      return out;
    };
    go.onclick = async () => {
      go.disabled = true;
      go.textContent = "Loading…";
      close(await loadItems([...picked]));
    };
    search.oninput = paint;
    dlg.oncancel = (e) => { e.preventDefault(); close(null); };
    dlg.showModal();
    listHistory().then((rows) => { items = rows || []; paint(); }).catch(() => paint());
  });
}
