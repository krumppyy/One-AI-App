// Perchance Runtime Compatibility Shim for AI Multimedia Toolkit V4
// Provides window.root, root.kv (IndexedDB/localStorage backed), root.generateText (Gemini API backed),
// root.generateImage (Pollinations/AI backed), root.superFetch, and all tunables from main.pjs.

(function () {
  const root = window.root || {};
  window.root = root;

  // Tunables from main.pjs
  root.motionTail = "smooth continuous natural motion, coherent subject, cinematic, high detail, stable";
  root.chainPrefix = "continuing the same uninterrupted shot, ";
  root.segmentLimits = { wan22: 5, ltx: 8.5, svd: 4 };
  root.cooldown = { quota: 60, busy: 90, paused: 3600, error: 120 };

  root.undressStages = [
    "her hands move slowly over her body, weight shifting, subtle continuous motion",
    "she lifts her top and pulls it up over her head, revealing her bare chest",
    "she unhooks and slips her bra off completely, now topless",
    "she hooks her thumbs into her waistband and slowly slides her bottoms down",
    "now fully nude, she runs her hands over her hips and turns her body"
  ];

  root.nsfwStoryboard = [
    { label: "standing", method: "start", garment: "wearing her own outfit, exactly as in the input picture", action: "she stands still, breathing, shifting her weight slowly, looking at the camera", pose: "the same pose, framing and camera distance as the input picture", expression: "calm, looking into the lens, lips slightly parted" },
    { label: "hands on her body", method: "evolve", garment: "wearing her own outfit, exactly as in the input picture", action: "her hands move slowly down over her body, over her hips and back up, anticipation building", pose: "the same pose, framing and camera distance as the input picture", expression: "steady gaze at the lens, lips parting" },
    { label: "top open", method: "top", garment: "her top pulled open, bare breasts visible, the same garment pushed aside", action: "she peels her top open and lets it hang, her bare chest coming free, breasts moving as they settle", pose: "the same pose, framing and camera distance as the input picture", expression: "flushed cheeks, lips parted, eyes on the lens" },
    { label: "topless", method: "top", garment: "topless, bare breasts, her top gone", action: "she slips the top off her shoulders and lets it drop away, then runs both hands slowly over her bare chest", pose: "the same pose, framing and camera distance as the input picture", expression: "eyes half closed, soft pleased smile" },
    { label: "bottoms off", method: "bottom", garment: "topless and completely nude, nothing on", action: "she hooks her thumbs into her waistband and works her bottoms down over her hips, stepping out of them", pose: "the same pose, framing and camera distance as the input picture", expression: "biting her lower lip, glancing up at the camera" },
    { label: "nude", method: "evolve", garment: "completely nude", action: "completely nude, she runs her hands slowly over her breasts and down over her stomach, breathing visibly", pose: "the same pose, framing and camera distance as the input picture", expression: "direct confident gaze, small knowing smile" },
    { label: "sensual", method: "evolve", garment: "completely nude", action: "she arches slightly and moves sensually, hands on her breasts and hips, chest rising and falling as she breathes", pose: "the same pose, framing and camera distance as the input picture", expression: "eyes closing, mouth open, aroused" },
    { label: "closer", method: "evolve", garment: "completely nude", action: "she leans toward the camera, moving slowly and sensually, chest moving with her breath", pose: "the same pose, framing and camera distance as the input picture", expression: "smouldering look straight into the lens" }
  ];

  root.storyboard = {
    maxBeats: 6,
    beatSeconds: 1.6,
    keyframeWaitMin: 15,
    poseDenoise: 0.4,
    removeDenoise: 0.85,
    refaceKeyframes: true,
    minFrameChange: 0.02,
    lockIdentity: true
  };

  root.motionTransfer = {
    enabled: true,
    maxBeats: 4,
    steps: 5,
    driverMaxSec: 3
  };

  root.storyboardMotion = "natural realistic human movement, whole body in motion, weight shifting from foot to foot, hips and shoulders counter-rotating as she moves, arms swinging loosely, breasts bouncing and settling with the motion, head turning, hair moving, breathing, blinking, lips and jaw moving as her expression changes, anatomically correct proportions, smooth continuous motion";

  root.nsfwMask = {
    grow: 0.014,
    feather: 0.02,
    protect: 1.15
  };

  root.defaults = {
    aspect: "16:9",
    quality: "480p",
    style: "cinematic",
    crossfade: 0.35,
    duration: 5,
    fps: 0,
    undress: false,
    muapiKey: ""
  };

  // IndexedDB + LocalStorage Key-Value Store
  function createKvStore(folderName) {
    const memory = new Map();
    const dbPromise = new Promise((resolve) => {
      try {
        if (typeof indexedDB === "undefined") return resolve(null);
        const req = indexedDB.open("AMT_KV_DB", 3);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains("kv")) {
            db.createObjectStore("kv");
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });

    async function get(key) {
      if (memory.has(key)) return memory.get(key);

      const db = await dbPromise;
      if (db) {
        try {
          const val = await new Promise((res) => {
            const tx = db.transaction("kv", "readonly");
            const store = tx.objectStore("kv");
            const req = store.get(`${folderName}:${key}`);
            req.onsuccess = () => res(req.result);
            req.onerror = () => res(undefined);
          });
          if (val !== undefined) {
            memory.set(key, val);
            return val;
          }
        } catch {}
      }

      try {
        const lsKey = `kv_${folderName}_${key}`;
        const ls = localStorage.getItem(lsKey);
        if (ls) {
          const parsed = JSON.parse(ls);
          memory.set(key, parsed);
          return parsed;
        }
      } catch {}

      return undefined;
    }

    async function set(key, val) {
      memory.set(key, val);

      const db = await dbPromise;
      if (db) {
        try {
          await new Promise((res) => {
            const tx = db.transaction("kv", "readwrite");
            const store = tx.objectStore("kv");
            const req = store.put(val, `${folderName}:${key}`);
            req.onsuccess = () => res(val);
            req.onerror = () => res(val);
          });
        } catch {}
      }

      // Safe localStorage sync for small primitives/non-blob objects
      try {
        if (!(val instanceof Blob) && typeof val !== "function") {
          const str = JSON.stringify(val);
          if (str && str.length < 200000) {
            localStorage.setItem(`kv_${folderName}_${key}`, str);
          }
        }
      } catch {}

      return val;
    }

    async function del(key) {
      memory.delete(key);
      try {
        localStorage.removeItem(`kv_${folderName}_${key}`);
      } catch {}
      const db = await dbPromise;
      if (!db) return true;
      return new Promise((res) => {
        try {
          const tx = db.transaction("kv", "readwrite");
          const store = tx.objectStore("kv");
          const req = store.delete(`${folderName}:${key}`);
          req.onsuccess = () => res(true);
          req.onerror = () => res(true);
        } catch {
          res(true);
        }
      });
    }

    async function keys() {
      const list = new Set(memory.keys());
      const db = await dbPromise;
      if (db) {
        try {
          await new Promise((res) => {
            const tx = db.transaction("kv", "readonly");
            const store = tx.objectStore("kv");
            const req = store.getAllKeys();
            req.onsuccess = () => {
              (req.result || []).forEach((k) => {
                const str = String(k);
                if (str.startsWith(`${folderName}:`)) {
                  list.add(str.slice(`${folderName}:`.length));
                }
              });
              res();
            };
            req.onerror = () => res();
          });
        } catch {}
      }
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(`kv_${folderName}_`)) {
            list.add(k.slice(`kv_${folderName}_`.length));
          }
        }
      } catch {}
      return Array.from(list);
    }

    async function entries() {
      const allKeys = await keys();
      const result = [];
      for (const k of allKeys) {
        const v = await get(k);
        if (v !== undefined) {
          result.push([k, v]);
        }
      }
      return result;
    }

    async function deleteMany(keysToDelete) {
      if (!Array.isArray(keysToDelete)) return;
      for (const k of keysToDelete) {
        await del(k);
      }
    }

    async function list() {
      const allKeys = await keys();
      const result = [];
      for (const k of allKeys) {
        const v = await get(k);
        if (v !== undefined) result.push({ key: k, value: v });
      }
      return result;
    }

    async function clear() {
      const allKeys = await keys();
      await deleteMany(allKeys);
    }

    return { get, set, delete: del, del, keys, entries, deleteMany, list, clear };
  }

  root.kv = new Proxy({}, {
    get(target, prop) {
      if (typeof prop !== "string") return undefined;
      if (!target[prop]) {
        target[prop] = createKvStore(prop);
      }
      return target[prop];
    }
  });

  // superFetch: direct fetch with server CORS proxy fallback
  root.superFetch = async function (url, opts = {}) {
    try {
      const res = await fetch(url, opts);
      if (res.ok) return res;
    } catch {}
    const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
    return await fetch(proxyUrl, opts);
  };

  // generateText: Gemini API powered text generator
  root.generateText = async function (opts = {}) {
    const instruction = opts.instruction || opts.prompt || "";
    const onChunk = opts.onChunk;
    try {
      const res = await fetch("/api/generateText", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction,
          model: opts.model,
          stopSequences: opts.stopSequences
        })
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || "AI Generation error");
      }
      if (res.body && onChunk) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          fullText += chunk;
          onChunk({ textChunk: chunk });
        }
        return fullText;
      } else {
        const data = await res.json();
        const txt = data.text || "";
        if (onChunk) onChunk({ textChunk: txt });
        return txt;
      }
    } catch (e) {
      console.warn("generateText fallback:", e);
      const mock = `[AI response for: ${instruction.slice(0, 60)}]`;
      if (onChunk) onChunk({ textChunk: mock });
      return mock;
    }
  };

  // generateImage: Pollinations or client canvas generator
  root.generateImage = async function (opts = {}) {
    const prompt = opts.prompt || "a cinematic visual masterpiece";
    const seed = opts.seed && opts.seed !== -1 ? opts.seed : Math.floor(Math.random() * 1000000);
    const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?seed=${seed}&nologo=true`;
    try {
      const res = await root.superFetch(pollinationsUrl);
      if (!res.ok) throw new Error("Image fetch failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const dataUrl = await new Promise((resD) => {
        const reader = new FileReader();
        reader.onloadend = () => resD(reader.result);
        reader.readAsDataURL(blob);
      });
      return { blob, url, dataUrl, seed, inputs: { prompt, seed } };
    } catch (err) {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext("2d");
      const grad = ctx.createLinearGradient(0, 0, 512, 512);
      grad.addColorStop(0, "#1a1a2e");
      grad.addColorStop(1, "#16213e");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 512);
      ctx.fillStyle = "#a78bff";
      ctx.font = "bold 20px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("AI Image Studio", 256, 240);
      ctx.fillStyle = "#8e9bb0";
      ctx.font = "14px sans-serif";
      ctx.fillText(prompt.slice(0, 45), 256, 280);
      const dataUrl = canvas.toDataURL("image/png");
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      return { blob, url: URL.createObjectURL(blob), dataUrl, seed, inputs: { prompt, seed } };
    }
  };

  // uploadPlugin: Object URL creation
  root.uploadPlugin = async function (blob, opts = {}) {
    const url = URL.createObjectURL(blob);
    return { url, expires: opts.expires || Date.now() + 86400000 };
  };

  // commentsPlugin: feedback wall component
  root.commentsPlugin = function (opts = {}) {
    const div = document.createElement("div");
    div.className = "comments-widget";
    div.style.width = typeof opts.width === "number" ? opts.width + "px" : (opts.width || "100%");
    div.style.minHeight = typeof opts.height === "number" ? opts.height + "px" : (opts.height || "200px");
    div.style.padding = "14px";
    div.style.background = "rgba(255,255,255,0.03)";
    div.style.borderRadius = "8px";
    div.style.border = "1px solid rgba(255,255,255,0.08)";
    div.style.color = "inherit";
    div.innerHTML = `
      <div style="font-size:12px;opacity:0.75;margin-bottom:8px">💬 Feedback channel: <strong>${opts.channel || "general"}</strong></div>
      <div style="font-size:13px;line-height:1.5;opacity:0.9">
        Community feedback & stats stream are active.
      </div>
    `;
    div.toString = function () { return div.outerHTML; };
    if (opts.onLoad) setTimeout(() => { try { opts.onLoad([]); } catch {} }, 50);
    return div;
  };

  // Export convenience globals
  window.superFetch = root.superFetch;
  window.kv = root.kv;
})();
