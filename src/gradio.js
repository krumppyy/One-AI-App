import { VIDEO_EXT, fileArg } from "./providers.js";
import {
  RelayError,
  fallbackRelays,
  formDataContentType,
  primaryRelays,
  privacyStrict,
  relayCapable,
  relayFetch,
  requiredRelay,
  untraceInit,
} from "./relay.js";

const infoCache = new Map();
const paramsCache = new Map();
const jwtCache = new Map();
const repoCache = new Map();

/** `https://owner-name.hf.space` -> every `owner/name` split the host allows. */
export function spaceCandidates(base) {
  const m = String(base || "").match(/^https?:\/\/([^./]+)\.hf\.space/i);
  if (!m) return [];
  const host = m[1];
  const out = [];
  for (let i = 1; i < host.length - 1; i++) {
    if (host[i] === "-") out.push(`${host.slice(0, i)}/${host.slice(i + 1)}`);
  }
  return out;
}

/** Best guess at the `owner/name` for a space the user typed in. */
export function repoFromInput(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  const m = s.match(/^https?:\/\/huggingface\.co\/spaces\/([^/]+)\/([^/?#]+)/i);
  if (m) return `${m[1]}/${m[2]}`;
  if (!/^https?:/i.test(s) && /^[^/\s]+\/[^/\s]+$/.test(s)) return s;
  return null;
}

function jwtExpiry(token) {
  try {
    const part = token.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4);
    const claims = JSON.parse(decodeURIComponent(escape(atob(b64))));
    return claims.exp ? claims.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

async function fetchJwt(repo, token, relay, untrace) {
  const key = `${repo}::${token ? "t" : "a"}`;
  const hit = jwtCache.get(key);
  if (hit && hit.exp > Date.now() + 60000) return hit;
  const url = `https://huggingface.co/api/spaces/${repo}/jwt`;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  try {
    const r = await relayFetch(relay, url, { method: "GET", headers }, { untrace, timeoutMs: 8000 });
    if (r.status < 200 || r.status >= 300) return null;
    const tok = JSON.parse(r.text)?.token;
    if (!tok || typeof tok !== "string") return null;
    const rec = { token: tok, exp: jwtExpiry(tok) || Date.now() + 20 * 60 * 1000 };
    jwtCache.set(key, rec);
    return rec;
  } catch {
    return null;
  }
}

async function resolveRepo(base, { repo, relay, untrace, token }) {
  if (repo) return repo;
  if (repoCache.has(base)) return repoCache.get(base);
  const candidates = spaceCandidates(base).slice(0, 5);
  for (const cand of candidates) {
    if (await fetchJwt(cand, token, relay, untrace)) {
      repoCache.set(base, cand);
      return cand;
    }
  }
  return null;
}

/**
 * The per-request `X-IP-Token` that Hugging Face hands out for a Space. Spaces
 * running on ZeroGPU — which is nearly all of the free video ones — use it to
 * decide *whose* free GPU allowance a job spends; without it a joiner looks like
 * an anonymous browser and gets the smallest possible slice.
 *
 * The token is minted through the same relay that will carry the job, so the
 * address it is issued for and the address the job arrives from agree.
 */
export async function hfJwt(base, token, opts = {}) {
  const { relay = null, untrace = true, repo = null } = opts;
  const found = await resolveRepo(base, { repo, relay, untrace, token });
  if (!found) return null;
  const rec = await fetchJwt(found, token, relay, untrace);
  return rec ? rec.token : null;
}

export function spaceToHost(space) {
  let s = String(space || "").trim();
  if (!s) return "";
  if (s.startsWith("http")) {
    s = s.replace(/\/+$/, "");
    const m = s.match(/^https?:\/\/huggingface\.co\/spaces\/([^/]+)\/([^/?#]+)/i);
    if (m) return `https://${m[1]}-${m[2]}.hf.space`;
    return s;
  }
  if (s.includes("/")) {
    const [owner, name] = s.split("/");
    return `https://${owner}-${name}.hf.space`;
  }
  if (s.includes(".")) return `https://${s.replace(/\/+$/, "")}`;
  return `https://${s}.hf.space`;
}

function authHeaders(token) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export async function fetchInfo(base, token, o = {}) {
  const { relay = null, untrace = true } = o;
  const key = `${base}::${token ? "t" : "a"}::${relay ? relay.id : "direct"}`;
  if (infoCache.has(key)) return infoCache.get(key);
  const bases = [`${base}/gradio_api/info`, `${base}/info`];
  let lastErr;
  for (const u of bases) {
    try {
      const r = relay
        ? await relayFetch(relay, u, { method: "GET", headers: authHeaders(token) }, { untrace, timeoutMs: 30000 })
        : await fetch(u, untraceInit({ headers: authHeaders(token) }, untrace));
      if (!r.ok) {
        lastErr = new Error(`Info request failed (${r.status})`);
        continue;
      }
      // A relayed answer is `{status, text}`; a direct one is a `Response`.
      const text = typeof r.text === "function" ? await r.text() : r.text;
      let j;
      try {
        j = JSON.parse(text);
      } catch {
        lastErr = new Error("Space did not return Gradio API info (is it a Gradio app?)");
        continue;
      }
      if (!j || !j.named_endpoints) {
        lastErr = new Error("Space has no public API endpoints");
        continue;
      }
      infoCache.set(key, j);
      return j;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Could not reach space");
}

/**
 * The *live* parameter list of a Space endpoint, fetched once per session.
 *
 * Spaces get edited: new sliders appear, old ones are renamed, and a positional
 * request that used to fit suddenly gets refused with "didn't receive enough
 * input values". Asking the Space what its signature is right now is the only
 * way an adapter can survive that, so adapters may name their values instead of
 * relying on their order.
 */
export async function spaceParams(base, endpoint, { relay = null, untrace = true, token = "" } = {}) {
  const key = `${base}|${endpoint}`;
  if (paramsCache.has(key)) return paramsCache.get(key);
  let params = null;
  try {
    const j = relay
      ? JSON.parse((await relayFetch(relay, `${base}/gradio_api/info`, { method: "GET" }, { untrace, timeoutMs: 30000 })).text)
      : await fetchInfo(base, token);
    const ep = j?.named_endpoints?.[`/${endpoint}`];
    if (ep?.parameters?.length) {
      params = ep.parameters.map((p) => ({ name: p.parameter_name, def: p.parameter_default ?? null }));
    }
  } catch {
    // Fall back to the adapter's own order; the call will tell us if it drifted.
  }
  if (params) paramsCache.set(key, params);
  return params;
}

/** Lay a `{parameter_name: value}` map out in the order the Space expects. */
export function alignData(params, named) {
  return params.map((p) => (Object.prototype.hasOwnProperty.call(named, p.name) ? named[p.name] : p.def));
}

export async function uploadBlob(base, blob, name, token, o = {}) {
  const { relay = null, untrace = true } = o;
  const bases = [`${base}/gradio_api/upload`, `${base}/upload`];
  let lastErr;
  const fd = new FormData();
  fd.append("files", blob, name || "input.png");
  const headers = authHeaders(token);
  let body = fd;
  if (relay) {
    // A relay re-sends the exact bytes it is handed, so the multipart body and
    // the boundary in `content-type` must come from ONE serialisation. The
    // browser invents a fresh random boundary each time it encodes a FormData,
    // so they cannot be derived separately — a `Request` gives both, together,
    // and its `blob()` is exactly the bytes that header describes.
    const req = new Request("https://relay.invalid/", { method: "POST", body: fd });
    const ct = req.headers.get("content-type") || formDataContentType(fd);
    body = await req.blob();
    if (ct) headers["Content-Type"] = ct;
  }
  for (const u of bases) {
    try {
      let status;
      let text;
      if (relay) {
        const r = await relayFetch(relay, u, { method: "POST", headers, body }, { untrace, timeoutMs: 120000 });
        status = r.status;
        text = r.text;
      } else {
        const r = await fetch(u, { method: "POST", body: fd, headers });
        status = r.status;
        text = await r.text();
      }
      if (status < 200 || status >= 300) {
        lastErr = new Error(`Upload failed (${status})`);
        continue;
      }
      let j = null;
      try {
        j = JSON.parse(text);
      } catch {}
      const path = Array.isArray(j) ? j[0] : j?.files?.[0] || j?.path;
      if (!path) {
        lastErr = new Error("Upload returned no file path");
        continue;
      }
      return { path, meta: { _type: "gradio.FileData" }, orig_name: name || "input.png" };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Upload failed");
}

export class SpaceError extends Error {
  constructor(message, kind, detail, hint) {
    super(message);
    this.kind = kind || "error";
    this.detail = detail || "";
    this.hint = hint || "";
  }
}

function errorText(raw) {
  if (!raw) return "";
  if (typeof raw === "object") return raw.error || raw.message || raw.detail || JSON.stringify(raw);
  const s = String(raw);
  try {
    const j = JSON.parse(s);
    if (j && typeof j === "object") return String(j.error || j.message || j.detail || s);
  } catch {}
  return s;
}

function classifyError(raw) {
  const s = errorText(raw);
  // A signature mismatch is not a content refusal, even though the parameter
  // list it prints contains words like `enable_safety_checker`. Check it first.
  if (/didn'?t receive enough input values|received too many input values|unexpected keyword argument|missing \d+ required positional|is not a valid keyword argument/i.test(s))
    return new SpaceError(
      "This model's settings changed and the app has not caught up.",
      "error",
      s.slice(0, 400),
      "Pick another model from the list — the rest are unaffected. (The app now asks each model for its current parameters, so this should become rarer, not more common.)"
    );
  if (/quota/i.test(s) && /(exceed|limit|used up)/i.test(s))
    return new SpaceError(
      "Free GPU runs for this model are used up for now.",
      "quota",
      s,
      "The allowance is small and a clip's cost is subtracted from it, so a shorter clip or a lighter model often still goes through. A free Hugging Face token raises the account's part of it, and address rotation (Settings → Privacy & IP rotation) brings a fresh per-address allowance."
    );
  if (/authenticate with a hugging ?face token/i.test(s))
    return new SpaceError(
      "This model needs a Hugging Face token.",
      "quota",
      s,
      "Create a free read token at huggingface.co/settings/tokens and paste it in Settings — it raises your GPU quota a lot."
    );
  if (/GPU task aborted|out of memory|CUDA out of memory/i.test(s))
    return new SpaceError("The model ran out of GPU memory for this request.", "oom", s);
  if (/paused|maintainer to restart/i.test(s))
    return new SpaceError("This space is paused by its maintainer.", "paused", s);
  if (/is currently loading|starting|sleeping|too many requests|queue full|503|502/i.test(s))
    return new SpaceError("Model is waking up or the queue is full.", "busy", s);
  // A refusal, not merely a mention: the old `/safety/i` test matched a Space's
  // own `enable_safety_checker` parameter when it appeared in an unrelated
  // error, so "the model changed" was reported as "the model refused this".
  if (
    /(nsfw|safety|moderation|inappropriat|prohibit|blocked|flagged|refused)/i.test(s) &&
    /(content|prompt|image|input|request|output|detect|flag|block|refus|violat|policy|filter|not allowed|reject)/i.test(s) &&
    !/enable_safety_checker|safe_mode\b/i.test(s)
  )
    return new SpaceError("The model refused this content (safety filter).", "safety", s);
  if (/input image|image is required|No image/i.test(s))
    return new SpaceError("This model needs a reference image.", "input", s);
  return new SpaceError("Generation failed on the remote model.", "error", s.slice(0, 600));
}

export function findMedia(value, exts = VIDEO_EXT, out = []) {
  if (!value) return out;
  if (typeof value === "string") {
    if (/^https?:\/\//.test(value) && exts.some((e) => value.toLowerCase().includes("." + e))) out.push({ url: value, path: value });
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) findMedia(v, exts, out);
    return out;
  }
  if (typeof value === "object") {
    const url = value.url || value.path;
    if (typeof url === "string" && (/^https?:\/\//.test(url) || url.startsWith("/")) && exts.some((e) => url.toLowerCase().includes("." + e))) {
      out.push({ url: value.url, path: value.path, orig_name: value.orig_name });
      return out;
    }
    for (const v of Object.values(value)) findMedia(v, exts, out);
  }
  return out;
}

function parseSseChunk(block) {
  const lines = block.split(/\r?\n/);
  let event = "message";
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  return { event, data: dataLines.join("\n") };
}

const RETRYABLE = new Set(["quota", "busy", "timeout", "error", "empty", "oom"]);

/**
 * The free pool is ZeroGPU, and its allowance is metered **per identity**:
 * against the Hugging Face account a token belongs to, against the address
 * otherwise. It is spent in GPU-seconds, so a couple of clips can exhaust a
 * whole day of it — and when it is gone, every free Space refuses *instantly*
 * with an empty error.
 *
 * Two things follow from that, and neither is visible in a single refusal:
 *
 *   1. It is not the model. The whole free pool goes out at once, so walking to
 *      the next Space only spends the next thirty seconds learning nothing.
 *   2. With a token, the address is irrelevant: the allowance belongs to the
 *      account, and no relay or VPN brings it back before the day rolls over.
 *      (Without a token it *is* per address, so rotation does help — see
 *      Settings → Privacy & IP rotation.)
 *
 * So the refusal is remembered here. `generate()` reads it to stop before the
 * expensive half of an NSFW run — the picture steps, which can sit in a free
 * image queue for minutes and only exist to feed a video model — instead of
 * paying for them and then handing back a camera move over the still.
 */
let zeroGpuBlock = null;
const GPU_FOLDER = "avg_gpu";
const GPU_KEY = "zeroGpu";

function kvRef() {
  try {
    return typeof root !== "undefined" ? root.kv : null;
  } catch {
    return null;
  }
}

/**
 * Remember an instant ZeroGPU refusal. It is kept in the page's storage as well
 * as in memory, because the waste this prevents is minutes long: the editor
 * reloads the page whenever the generator is edited or saved, and a refusal
 * that is forgotten on reload would be paid for again by the next run. The
 * record carries its own timestamp and is only honoured for a short window
 * (see `generate()`), so a transient "every shared GPU is busy" never becomes a
 * lockout and a fresh day is never blocked by a stale one.
 */
export function noteZeroGpuBlock(withToken) {
  zeroGpuBlock = { at: Date.now(), withToken: !!withToken };
  try {
    kvRef()?.[GPU_FOLDER]?.set(GPU_KEY, zeroGpuBlock)?.catch?.(() => {});
  } catch {}
}

/** A call that actually reached a model means the pool is answering again. */
export function clearZeroGpuBlock() {
  zeroGpuBlock = null;
  try {
    kvRef()?.[GPU_FOLDER]?.delete(GPU_KEY)?.catch?.(() => {});
  } catch {}
}

/** `{ at, withToken }` of the last instant ZeroGPU refusal, or `null`. */
export function zeroGpuBlockInfo() {
  return zeroGpuBlock;
}

/**
 * The refusal this page has seen, or the one the last page saw (storage).
 * Never rejects — a missing store just means "no memory".
 */
export async function loadZeroGpuBlock() {
  if (zeroGpuBlock) return zeroGpuBlock;
  try {
    const v = await kvRef()?.[GPU_FOLDER]?.get(GPU_KEY);
    if (v && typeof v === "object" && Number.isFinite(Number(v.at))) {
      zeroGpuBlock = { at: Number(v.at), withToken: !!v.withToken };
    }
  } catch {}
  return zeroGpuBlock;
}

/**
 * One attempt at a Gradio call. `relay` (or null for a direct request) decides
 * the address the job leaves from; the `X-IP-Token` is minted through the same
 * path so the allowance and the request agree on who is asking.
 */
async function callOnce(base, endpoint, data, o) {
  const { token, signal, onStage, timeoutMs = 900000, controller, relay = null, untrace = true, repo = null, settings = null } = o;
  const url = `${base}/gradio_api/call/${endpoint}`;
  const startedAt = Date.now();
  const hardStop = setTimeout(() => {
    try {
      controller?.abort(new Error("timeout"));
    } catch {}
  }, timeoutMs);

  let jwt = null;
  try {
    if (relay?.jwt !== false) jwt = await hfJwt(base, token, { relay, untrace, repo });
  } catch {}
  const withIp = (h) => {
    const out = { ...h };
    if (jwt) out["X-IP-Token"] = jwt;
    return out;
  };

  let eventId;
  try {
    let status;
    let text;
    if (relay) {
      const r = await relayFetch(
        relay,
        url,
        { method: "POST", headers: withIp({ "Content-Type": "application/json", ...authHeaders(token) }), body: JSON.stringify({ data }) },
        { untrace, timeoutMs: Math.min(timeoutMs, 60000) }
      );
      status = r.status;
      text = r.text;
    } else {
      const r = await fetch(url, {
        method: "POST",
        headers: withIp({ "Content-Type": "application/json", ...authHeaders(token) }),
        body: JSON.stringify({ data }),
        signal,
      });
      status = r.status;
      text = await r.text();
    }
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      throw classifyError(text.slice(0, 400) || `Request rejected (${status})`);
    }
    if (status < 200 || status >= 300) {
      const msg = Array.isArray(j?.detail) ? j.detail.map((d) => d.msg).join("; ") : j?.detail || j?.error || `HTTP ${status}`;
      throw classifyError(msg);
    }
    eventId = j.event_id;
    if (!eventId) throw classifyError(j?.error || "Model did not accept the request");
  } catch (e) {
    if (e?.name === "AbortError") throw new SpaceError("Cancelled", "cancelled");
    if (e instanceof SpaceError) throw e;
    if (e instanceof RelayError) {
      throw new SpaceError(
        `The relay ${e.message}`,
        "error",
        e.message,
        "The job never reached the model. Retrying through another address; if this keeps happening, remove that relay in Settings → Privacy & IP rotation."
      );
    }
    throw classifyError(e?.message || String(e));
  } finally {
    clearTimeout(hardStop);
  }

  onStage?.("running", { eventId, relay });
  const streamUrl = `${base}/gradio_api/call/${endpoint}/${eventId}`;
  // The progress stream is a long-lived GET, so it needs a relay that can carry
  // one. It normally travels through the very same relay the job went through,
  // so the model sees one consistent client. The `X-IP-Token` is deliberately
  // *not* sent here: it only decides quota on the job request, and repeating it
  // would just be one more thing tying the two requests together.
  const streamRelay =
    relay && relayCapable(relay, { get: true, stream: true })
      ? relay
      : relay
      ? requiredRelay(settings || {}, { get: true, stream: true }, "the model's progress stream")
      : null;
  const ac2 = new AbortController();
  const onAbort = () => ac2.abort();
  if (signal) signal.addEventListener("abort", onAbort);
  const kill = setTimeout(() => ac2.abort(), timeoutMs);

  let buffer = "";
  let finalData = null;
  let sawError = null;
  let sawProgress = false;
  let lastEvent = "running";
  let streamCleanup = null;
  try {
    let body;
    if (streamRelay) {
      const res = await relayFetch(
        streamRelay,
        streamUrl,
        { method: "GET", headers: authHeaders(token), signal: ac2.signal },
        { untrace, timeoutMs, stream: true }
      );
      streamCleanup = res.cleanup;
      if (res.status < 200 || res.status >= 300) throw classifyError(`${streamRelay.label} answered ${res.status}`);
      body = res.body;
    } else {
      const r = await fetch(streamUrl, untraceInit({ headers: authHeaders(token), signal: ac2.signal }, untrace));
      if (!r.ok || !r.body) {
        const t = await r.text().catch(() => "");
        throw classifyError(t.slice(0, 300) || `Stream failed (${r.status})`);
      }
      body = r.body;
    }
    if (!body) throw classifyError("The model's progress stream came back empty");
    const reader = body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const { event, data: d } = parseSseChunk(block);
        if (!event || event === "heartbeat") {
          onStage?.("running", { elapsed: Date.now() - startedAt });
          continue;
        }
        if (event === "complete") {
          finalData = d;
        } else if (event === "error") {
          sawError = d && d !== "null" && d !== "" ? d : "__empty__";
        } else if (event === "progress" || event === "generating" || event === "estimation" || event === "status") {
          sawProgress = true;
          let info = null;
          try {
            info = JSON.parse(d);
          } catch {}
          const prog = typeof info?.progress === "number" ? info.progress : null;
          onStage?.("running", { elapsed: Date.now() - startedAt, progress: prog, info });
          lastEvent = event;
        } else {
          onStage?.("running", { elapsed: Date.now() - startedAt });
        }
        if (finalData || sawError) break;
      }
      if (finalData || sawError) break;
    }
  } catch (e) {
    if (e?.name === "AbortError") {
      if (signal?.aborted) throw new SpaceError("Cancelled", "cancelled");
      throw new SpaceError("The model took too long and the request was stopped.", "timeout");
    }
    if (e instanceof SpaceError) throw e;
    if (e instanceof RelayError) {
      throw new SpaceError(
        `The relay ${e.message}`,
        "error",
        e.message,
        "The job was accepted, but its result could not be read back through that address. It will retry through another relay — if this keeps happening, remove that relay in Settings → Privacy."
      );
    }
    throw classifyError(e?.message || String(e));
  } finally {
    clearTimeout(kill);
    if (signal) signal.removeEventListener("abort", onAbort);
    if (streamCleanup) streamCleanup();
  }

  if (sawError) {
    if (sawError === "__empty__") {
      const quick = Date.now() - startedAt < 25000;
      if (quick && !sawProgress) {
        const withToken = !!o?.token;
        noteZeroGpuBlock(withToken);
        throw new SpaceError(
          withToken
            ? "The free GPU pool is out of allowance for your Hugging Face account."
            : "The free GPU pool is out of allowance for this address.",
          "quota",
          "the space rejected the job instantly with an empty error — ZeroGPU's daily allowance is spent (5 minutes a day on a free account, 2 minutes a day per address otherwise), or every shared GPU is busy",
          withToken
            ? "A token bills the whole daily allowance to your Hugging Face account, and it does not come back — from any address — until the day rolls over. Ways out, best first: run the free GPU server (Settings → Where the rendering happens → free Colab T4), which has no allowance at all and is the one free route that can render an uncensored clip; or clear the HF token and turn strict privacy off, so the request is metered to your own address's 2-minute anonymous share instead of the relay's spent one; or wait for the daily reset."
            : "Without a token the allowance is per address, so address rotation (Settings → Privacy & IP rotation — add a Cloudflare Worker relay, or switch your VPN) earns a fresh 2 minutes each time. Your own GPU server has no allowance at all. Note that while strict privacy is on, anonymous calls leave from the relay's shared address, which is usually already spent — your own address is only used when strict privacy is off."
        );
      }
      throw new SpaceError("The model finished without returning a result.", "empty");
    }
    throw classifyError(sawError);
  }
  if (!finalData) throw new SpaceError("The model finished without returning a result.", "empty");
  let parsed;
  try {
    parsed = JSON.parse(finalData);
  } catch {
    parsed = finalData;
  }
  if (typeof parsed === "string" && /quota|error|failed/i.test(parsed)) throw classifyError(parsed);
  const videos = findMedia(parsed, VIDEO_EXT);
  if (!videos.length) {
    const imgs = findMedia(parsed, ["png", "jpg", "jpeg", "webp"]);
    if (imgs.length) {
      throw new SpaceError("Model returned an image instead of a video.", "empty", JSON.stringify(parsed).slice(0, 300));
    }
    throw new SpaceError("The model returned no video.", "empty", JSON.stringify(parsed).slice(0, 400));
  }
  const pick = videos.find((v) => v.url) || videos[0];
  // A clip came back, so the pool is answering again — forget the refusal.
  clearZeroGpuBlock();
  return {
    url: pick.url,
    path: pick.path,
    seed: Array.isArray(parsed) ? parsed.find((x) => typeof x === "number") : null,
    raw: parsed,
    relay: relay || null,
  };
}

/**
 * Call a Gradio endpoint, rotating the egress address between attempts.
 *
 * The shared free GPU pool meters itself per *account* for signed-in callers
 * (5 minutes a day on a free account) and per *address* for everyone else
 * (2 minutes a day). So a refusal has two quite different cures:
 *
 *   - a fresh address brings its own anonymous allowance, and
 *   - asking anonymously is what makes that allowance the address's rather than
 *     the (already spent) account's.
 *
 * Hence: the first attempt uses your token if you have one, and a retry after a
 * refusal drops it and goes out through the next relay. With rotation off this
 * is simply one plain request.
 *
 * The attempt list always ends with a plain direct request, so a dead or
 * refusing relay can never leave a run with no video at all.
 */
/**
 * The ordered list of addresses one request will try.
 *
 * The stored pointer (`settings.relayIndex`) is read here and only moved when
 * `advance` is passed — the caller decides the cadence: the app moves it once
 * per run in "generation" mode, and `callEndpoint` passes `advance` for every
 * request in "request" mode. Retries walk on from the pointer without touching
 * it, so a run cannot fast-forward the next run's rotation.
 *
 * With strict privacy on there is no direct entry anywhere in the plan — a busy
 * or refusing relay means trying *another relay*, never "just this once from
 * your own address". Beyond the retries the remaining relays are tried, and in
 * relaxed mode the plan always ends with a plain direct request so a dead relay
 * can never leave a run with no video at all.
 *
 * An empty plan means strict privacy is on and every relay has been switched
 * off — `callEndpoint` turns that into a refusal rather than a leak.
 */
export function attemptPlan(settings, { advance = false } = {}) {
  const mode = settings?.relayMode || "off";
  const strict = privacyStrict(settings);
  if (mode === "off" && !strict) return [null];
  const primary = primaryRelays(settings);
  const fallback = fallbackRelays(settings).filter((r) => r.post);
  if (!primary.length && !fallback.length) return strict ? [] : [null];
  const retries = Math.max(0, Math.min(3, (Number(settings?.relayRetries) || 3) - 1));
  // The rotation cycle, in the order addresses should be used:
  //   your own relays → (this connection, when privacy allows it) → the shared
  //   fallbacks. Everything rotatable is in here, which is what makes a
  //   `relayIndex` step actually change the address — the cycle used to be
  //   built from the primary relays alone, so one relay of your own plus the
  //   built-in proxy always left from the same place no matter what the index
  //   said.
  const cycle = [...primary];
  if (!strict) cycle.push(null);
  for (const r of fallback) cycle.push(r);
  if (!cycle.length) cycle.push(null);
  const span = cycle.length || 1;
  let start = Math.abs(Number(settings?.relayIndex) || 0);
  if (advance && settings) {
    // Randomise the jump so consecutive generations don't share an address. The
    // step is drawn from 1..(n-1), which *never* lands on the address just used:
    // with two addresses it is a strict alternation, with more it is random.
    const step = span > 1 ? 1 + Math.floor(Math.random() * (span - 1)) : 1;
    start += step;
    settings.relayIndex = start;
  }
  // Walk the cycle from `start`, then make sure every other address is in the
  // plan as a retry, so a refusal always has somewhere else to go.
  const at = (i) => cycle[((i % span) + span) % span];
  const key = (r) => (r ? "id:" + r.id : "direct");
  const plan = [];
  const seen = new Set();
  const push = (relay, once = false) => {
    const k = key(relay);
    if (once && seen.has(k)) return; // this address is already in the plan
    if (!once && plan.length && key(plan[plan.length - 1]) === k) return; // no immediate repeat
    plan.push(relay);
    seen.add(k);
  };
  for (let i = 0; i <= retries; i++) push(at(start + i));
  for (const r of cycle) push(r, true);
  return plan;
}

export async function callEndpoint(base, endpoint, data, opts = {}) {
  const { token, signal, onStage, timeoutMs = 900000, controller, settings = null, repo = null } = opts;
  const untrace = settings?.untrace !== false;
  const plan = attemptPlan(settings, { advance: (settings?.relayMode || "off") === "request" });
  let anonymous = false;
  let lastErr = null;

  if (!plan.length) {
    throw new SpaceError(
      "A relay is needed, and none is switched on",
      "privacy",
      "strict privacy is on, but every relay is switched off — so this request could only leave from your own address",
      "Turn “Perchance's built-in proxy” back on, or add a relay you control, in Settings → Privacy."
    );
  }

  for (let attempt = 0; attempt < plan.length; attempt++) {
    const relay = plan[attempt] || null;
    try {
      return await callOnce(base, endpoint, data, {
        token: anonymous ? "" : token,
        signal,
        onStage,
        timeoutMs,
        controller,
        relay,
        untrace,
        repo,
        settings,
      });
    } catch (e) {
      lastErr = e;
      if (signal?.aborted) throw e;
      if (!RETRYABLE.has(e?.kind)) throw e;
      // A spent allowance has two cures, and they are not the same one. A
      // *token* bills the job to the account (5 minutes a day) and an
      // anonymous request bills the address it leaves from (2 minutes a
      // day) — so with the account spent, the very same address still has
      // its own share left. That retry has to happen *before* walking to the
      // next relay, and it has to happen even when there is no next relay:
      // with strict privacy on and only the built-in proxy configured the
      // plan is one entry long, so the old "walk on" retry never ran at all
      // and every free route refused forever on an allowance that a dropped
      // token would have cured.
      if (e?.kind === "quota" && token && !anonymous) {
        anonymous = true;
        onStage?.("relaying", {
          attempt: attempt + 2,
          of: plan.length + 1,
          relay,
          anonymous: true,
          reason: e.message,
        });
        await new Promise((r) => setTimeout(r, 900));
        if (signal?.aborted) throw new SpaceError("Cancelled", "cancelled");
        attempt--; // retry this same address, now anonymously
        continue;
      }
      const next = plan[attempt + 1];
      if (next === undefined) throw e;
      onStage?.("relaying", {
        attempt: attempt + 2,
        of: plan.length,
        relay: next,
        anonymous,
        reason: e.message,
      });
      await new Promise((r) => setTimeout(r, 900));
      if (signal?.aborted) throw new SpaceError("Cancelled", "cancelled");
    }
  }
  throw lastErr || new SpaceError("Generation failed.", "error");
}

export function pickEndpoints(info) {
  const names = Object.keys(info.named_endpoints || {});
  const score = (n) => {
    let s = 0;
    if (/generate_video|image_to_video|generate|video/i.test(n)) s += 10;
    if (/generate_video$/i.test(n)) s += 6;
    if (/image_to_video$/i.test(n)) s += 5;
    if (/preview|upload|dims|random|lambda|update|load|info/i.test(n)) s -= 40;
    return s;
  };
  return names
    .map((n) => ({ n, s: score(n) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.n);
}

const IMG_WORDS = /image|img|frame|photo|picture|start|reference|source/i;
const PROMPT_WORDS = /^(prompt|text|instruction|caption)$/i;
const NEG_WORDS = /negative|n_prompt|neg_prompt/i;
const DUR_WORDS = /duration|length|seconds|num_frames|frames|video_length/i;
const SEED_WORDS = /seed/i;
const GUID_WORDS = /guidance|cfg|scale|strength/i;
const STEP_WORDS = /step/i;

export async function autoAdapter(space, token, opts = {}) {
  const base = spaceToHost(space);
  const info = await fetchInfo(base, token, { relay: opts.relay || null, untrace: opts.untrace !== false });
  const candidates = pickEndpoints(info);
  if (!candidates.length) throw new SpaceError("No usable video endpoint found in that space.", "input");
  const endpoint = candidates[0];
  const ep = info.named_endpoints[endpoint];
  const params = ep.parameters || [];
  const videoParamNames = new Set();

  const desc = (p) => `${p.parameter_name} ${p.label || ""} ${p.type?.description || ""}`;

  let imageParam = params.find((p) => IMG_WORDS.test(desc(p)) && (p.component === "Image" || /image/i.test(p.type?.type || "")));
  const hasPrompt = params.some((p) => PROMPT_WORDS.test(p.parameter_name));
  const hasNeg = params.some((p) => NEG_WORDS.test(p.parameter_name));
  const hasDur = params.find((p) => DUR_WORDS.test(p.parameter_name));
  const durDesc = hasDur ? hasDur.type?.description || "" : "";
  const durRange = durDesc.match(/between\s+([\d.]+)\s+and\s+([\d.]+)/i);
  const secondsNamed = hasDur && /second|duration|video_length|length/i.test(hasDur.parameter_name) && !/frame/i.test(hasDur.parameter_name);
  const fpsGuess = 24;

  const provider = {
    id: "custom:" + base,
    kind: "gradio",
    custom: true,
    label: opts.label || base.replace(/^https?:\/\//, "").replace(/\.hf\.space$/, ""),
    vendor: "Custom space",
    tier: "free",
    space: base,
    repo: repoFromInput(space),
    endpoint,
    minSec: durRange ? Number(durRange[1]) : 1,
    maxSec: durRange ? Number(durRange[2]) : 5,
    nativeSeconds: secondsNamed,
    fpsGuess,
    estSecs: 80,
    quality: 3,
    caps: {
      i2v: !!imageParam,
      t2v: !imageParam,
      endFrame: params.filter((p) => IMG_WORDS.test(desc(p)) && p.component === "Image").length > 1,
      camera: false,
      nsfw: false,
      resolution: params.some((p) => /height|width|\bh\b|\bw\b/i.test(p.parameter_name)),
    },
    note: opts.note || "User-added space (auto-detected).",
    async build(ctx) {
      const data = [];
      const uploads = new Map();
      for (const p of params) {
        const d = desc(p);
        const val = p.parameter_default;
        if (p.component === "Image" && IMG_WORDS.test(d)) {
          let blob = ctx.image;
          if (/end|last/i.test(p.parameter_name)) blob = ctx.endImage || null;
          if (blob && !uploads.has(p.parameter_name)) uploads.set(p.parameter_name, await fileArg(ctx, blob, p.parameter_name + ".png"));
          data.push(blob ? uploads.get(p.parameter_name) : null);
        } else if (PROMPT_WORDS.test(p.parameter_name)) {
          data.push(ctx.prompt);
        } else if (NEG_WORDS.test(p.parameter_name)) {
          data.push(ctx.negative);
        } else if (DUR_WORDS.test(p.parameter_name)) {
          if (secondsNamed) data.push(Math.max(Number(p.type?.minimum ?? 0.5), Math.min(Number(p.type?.maximum ?? 10), ctx.duration)));
          else {
            const maxF = Number(p.type?.maximum ?? 145);
            const minF = Number(p.type?.minimum ?? 9);
            data.push(Math.round(Math.max(minF, Math.min(maxF, ctx.duration * (opts.fps || 16)))));
          }
        } else if (SEED_WORDS.test(p.parameter_name) && p.component !== "Checkbox") {
          data.push(ctx.seed);
        } else if (p.component === "Checkbox" && /random/i.test(p.parameter_name)) {
          data.push(false);
        } else if (GUID_WORDS.test(p.parameter_name) && typeof val === "number") {
          data.push(val);
        } else if (STEP_WORDS.test(p.parameter_name) && typeof val === "number") {
          data.push(val);
        } else if (p.component === "Slider" && /height|width|\bh\b|\bw\b/i.test(p.parameter_name)) {
          data.push(/width|\bw\b/i.test(p.parameter_name) ? ctx.size?.[0] ?? val : ctx.size?.[1] ?? val);
        } else if (p.component === "Dropdown") {
          data.push(val ?? p.type?.enum?.[0]);
        } else {
          data.push(val ?? null);
        }
      }
      return { data };
    },
  };
  provider.detected = {
    endpoint,
    params: params.map((p) => `${p.parameter_name}:${p.component}`),
    hasPrompt,
    hasNeg,
    hasDuration: !!hasDur,
  };
  return provider;
}
