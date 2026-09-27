/**
 * Egress relays.
 *
 * Every request the app makes to a public model normally leaves from *your* IP
 * address. That is fine for a couple of runs and bad afterwards: the free GPU
 * pool counts what you use per address, and the address is trivially traceable
 * back to you.
 *
 * A relay is anything that will fetch a URL on your behalf and hand the answer
 * back, so the model sees the relay's address instead. The app can use three
 * kinds:
 *
 *   server   your own AIVideoGen server (src/server/server.py, /api/relay).
 *            Works for GET and POST, keeps your HF token private to you, and a
 *            second Colab/Kaggle session is a second address for free.
 *   worker   a relay you deploy yourself (the one-click Cloudflare Worker in
 *            the Settings help dialog). GET + POST, no quota, permanent URL.
 *   public   a public CORS proxy. GET only in practice, so it is only useful
 *            for the small look-ups — never for the actual job.
 *
 * Relays are *rotated*: each generation can go out through a different one, and
 * a retry after a failure always tries a new address before reusing an old one.
 */

const CACHE_BUST = () => Math.random().toString(36).slice(2, 10);

let _diag = null;
export function setDiagHook(fn) {
  _diag = typeof fn === "function" ? fn : null;
}
function dlog(kind, msg, data) {
  try {
    _diag?.(kind, msg, data);
  } catch {}
  try {
    if (typeof window !== "undefined" && window.__diag?.log) window.__diag.log(kind, msg, data);
  } catch {}
}
function maskHost(url) {
  try {
    const u = new URL(String(url));
    return u.host;
  } catch {
    return String(url || "").slice(0, 60);
  }
}

export const RELAY_MODES = [
  { id: "off", label: "Keep one address for the whole run" },
  { id: "generation", label: "Change address after every generation" },
  { id: "request", label: "Change address on every request (each segment and retry)" },
];

/**
 * Public relays. These are only useful for plain GETs — none of them can
 * forward a POST body or a stream, so they can never carry an actual
 * generation request. They are kept for the address check and small look-ups.
 */
export const PUBLIC_RELAYS = [
  { id: "pub:allorigins", label: "allorigins.win", kind: "public", template: "https://api.allorigins.win/raw?url={enc}", unwrap: null, get: true, post: false, upload: false, stream: false, fallbackOnly: true },
  { id: "pub:allorigins-json", label: "allorigins.win (JSON wrap)", kind: "public", template: "https://api.allorigins.win/get?url={enc}", unwrap: "contents", get: true, post: false, upload: false, stream: false, fallbackOnly: true },
];

/**
 * The relay that needs no setup at all: Perchance's own fetch proxy, which the
 * page already has as `superFetch`. It is a real second address (a Cloudflare
 * address belonging to Perchance, not to you), so a job sent through it is
 * metered against *that* address rather than against yours — and, more to the
 * point here, the model never learns your address at all.
 *
 * Measured behaviour of that proxy (all of this was tested, not assumed):
 *   upload   multipart bodies survive it — 6 MB took 5 s. So the reference
 *            frame goes out through it too; nothing about the run is direct.
 *   stream   a `text/event-stream` response is passed through *live* — it
 *            stayed open past 120 s. That is exactly what the model's progress
 *            stream is, so the stream is relayed as well.
 *   buffered anything else is read to the end first and capped at ~60 s. Every
 *            other request is short (a job takes ~1 s to accept, a finished
 *            clip is a couple of MB), so this only matters for the stream —
 *            which takes the streaming path above.
 *   jwt      it is shared with everyone else using Perchance, so the anonymous
 *            allowance for its address may already be spent. Keeping the
 *            `X-IP-Token` would bill the job back to *your* address and defeat
 *            the point, so requests through it are sent without one.
 */
export const PERCHANCE_RELAY = {
  id: "perchance",
  label: "Perchance's own proxy",
  kind: "perchance",
  get: true,
  post: true,
  upload: true,
  stream: true,
  jwt: false,
  fallbackOnly: true,
  maxBody: 8000000,
};


/** Does `url` look like a relay on someone else's domain? Used for the warning. */
export function relayHost(relay) {
  if (!relay) return "";
  const raw = relay.base || relay.template || "";
  try {
    return new URL(raw).host;
  } catch {
    return "";
  }
}

const IP_ECHOES = [
  "https://api.ipify.org?format=json",
  "https://ifconfig.me/all.json",
  "https://www.cloudflare.com/cdn-cgi/trace",
];


export function normalizeRelayUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : "https://" + s;
}

/** A relay you typed in: a server URL, a `{enc}` template, or a worker URL. */
export function customRelay(url, label) {
  const u = normalizeRelayUrl(url);
  if (!u) return null;
  const isTemplate = u.includes("{enc}") || /\{url\}/.test(u);
  const looksLikeWorker = /\.(workers\.dev|pages\.dev|deno\.dev|vercel\.app|netlify\.app|glitch\.me)(\/|$)/i.test(u);
  if (!isTemplate && !looksLikeWorker && /^https?:\/\/[^/?#]+(\/[^?#]*)?(\?[^#]*)?$/i.test(u)) {
    let key = "";
    let bare = u;
    try {
      const parsed = new URL(u);
      key = parsed.searchParams.get("key") || "";
      parsed.searchParams.delete("key");
      bare = parsed.toString().replace(/\/+$/, "");
    } catch {}
    return serverRelay(bare, label, key);
  }
  const template = /\{enc\}|\{url\}/.test(u) ? u : u + (u.includes("?") ? "&url={enc}" : "?url={enc}");
  return {
    id: "custom:" + u,
    label: label || u.replace(/^https?:\/\//, "").slice(0, 34),
    kind: "worker",
    template,
    unwrap: null,
    get: true,
    post: true,
    upload: true,
    stream: true,
  };
}

export function serverRelay(base, label, token) {
  const b = normalizeRelayUrl(base).replace(/\/+$/, "");
  if (!b) return null;
  return {
    id: "server:" + b,
    label: label || b.replace(/^https?:\/\//, "").slice(0, 34),
    kind: "server",
    base: b,
    token: token || "",
    get: true,
    post: true,
    upload: true,
    stream: true,
  };
}

/** The rotation pool, in the order it should be used. */
export function relayPool(settings) {
  const out = [];
  const server = serverRelay(settings?.serverUrl, null, settings?.serverToken);
  if (server) out.push(server);
  for (const extra of settings?.extraServers || []) {
    const s = serverRelay(extra?.url || extra, extra?.label, extra?.token || settings?.serverToken);
    if (s && !out.some((r) => r.id === s.id)) out.push(s);
  }
  for (const r of settings?.relays || []) {
    const relay = customRelay(r?.url || r, r?.label);
    if (relay && !out.some((x) => x.id === relay.id)) out.push(relay);
  }
  if (settings?.usePerchanceRelay !== false) out.push(PERCHANCE_RELAY);
  if (settings?.usePublicRelays !== false) {
    for (const p of PUBLIC_RELAYS) if (!out.some((x) => x.id === p.id)) out.push(p);
  }
  return out;
}

/**
 * Strict privacy: "never contact a model directly".
 *
 * When this is on, *every* request the app makes towards a model — the model's
 * parameter list, the `X-IP-Token`, the reference-frame upload, the job itself,
 * the progress stream and the finished clip's download — goes out through a
 * relay, so the only address the model ever sees is the relay's. There is no
 * silent direct fallback: if no relay can carry a request, the request is
 * refused with an explanation rather than sent from your address.
 *
 * Default on. The built-in Perchance proxy is always part of the pool, so this
 * needs no setup at all; it simply means requests are metered against a shared
 * Perchance address rather than yours.
 */
export function privacyStrict(settings) {
  return settings?.strictPrivacy !== false;
}

/** Can this relay carry a request with these requirements? */
export function relayCapable(relay, caps = {}) {
  if (!relay) return false;
  if (caps.post && !relay.post) return false;
  if (caps.get && !relay.get) return false;
  if (caps.stream && relay.stream === false) return false;
  if (caps.upload && relay.upload === false) return false;
  return true;
}

/**
 * The relay that must carry a request. Returns `null` only when relaying is
 * genuinely optional (strict privacy off *and* rotation off).
 *
 * In strict-privacy mode this never returns null: the built-in proxy is the
 * guaranteed last resort, and if every relay has been switched off it throws
 * instead of leaking your address.
 */
export function requiredRelay(settings, caps = {}, why = "this request") {
  const strict = privacyStrict(settings);
  if (!strict && (settings?.relayMode || "off") === "off") return null;
  const pool = relayPool(settings).filter((r) => relayCapable(r, caps));
  if (pool.length) {
    const idx = Math.abs(Number(settings?.relayIndex) || 0);
    return pool[idx % pool.length];
  }
  if (strict) {
    throw new RelayError(
      `Stopped: ${why} needs a relay, and every relay is switched off — so it could only leave from your own address, which the model would see. ` +
        `Turn “Perchance's built-in proxy” back on, or add a relay you control, in Settings → Privacy.`,
      null,
      0
    );
  }
  return null;
}

/** Relays that can carry a file upload (a multipart body). */
export function uploadRelays(settings) {
  return relayPool(settings).filter((r) => relayCapable(r, { post: true, upload: true }));
}

/** The relay to send a reference-frame upload through (null = direct). */
export function pickUploadRelay(settings) {
  const strict = privacyStrict(settings);
  if (!strict && (settings?.relayMode || "off") === "off") return null;
  const pool = uploadRelays(settings);
  if (!pool.length) return strict ? requiredRelay(settings, { post: true, upload: true }, "the reference-frame upload") : null;
  const idx = Math.abs(Number(settings?.relayIndex) || 0);
  return pool[idx % pool.length];
}

/** Relays that can carry the model's live progress stream (a long SSE GET). */
export function streamRelays(settings) {
  return relayPool(settings).filter((r) => relayCapable(r, { get: true, stream: true }));
}

/** Relays a finished clip can be pulled through. */
export function downloadRelays(settings) {
  return relayPool(settings).filter((r) => relayCapable(r, { get: true }));
}

/**
 * Which relay to use *this* time. `advance` moves the pointer on (so the next
 * generation / the next retry leaves through a different address).
 *
 * Relays flagged `fallbackOnly` (the built-in Perchance proxy, the public
 * GET-only ones) are skipped unless `includeFallback` — a first attempt should
 * use a relay you control or your own connection, and the shared fallbacks are
 * there for retries only.
 */
export function pickRelay(settings, { advance = false, needPost = false, includeFallback = false } = {}) {
  const mode = settings?.relayMode || "off";
  const pool = relayPool(settings).filter(
    (r) => (!needPost || r.post) && (includeFallback || !r.fallbackOnly)
  );
  if (mode === "off" || !pool.length) return null;
  const idx = Math.abs(Number(settings.relayIndex) || 0);
  if (advance && settings) settings.relayIndex = idx + 1;
  return pool[idx % pool.length];
}

/** The relays a *first* attempt may use — the ones you control. */
export function primaryRelays(settings) {
  return relayPool(settings).filter((r) => r.post && !r.fallbackOnly);
}

/** Relays that can carry a job but are shared fallbacks (Perchance's proxy). */
export function fallbackRelays(settings) {
  return relayPool(settings).filter((r) => r.post && r.fallbackOnly);
}

/** How many distinct addresses this configuration can actually rotate between. */
export function rotatableCount(settings) {
  return primaryRelays(settings).length + fallbackRelays(settings).length;
}

export function relayTarget(relay, url) {
  if (!relay) return url;
  if (relay.kind === "server") return `${relay.base}/api/relay`;
  const enc = encodeURIComponent(url);
  const raw = url;
  return relay.template
    .replace(/\{enc\}/g, enc)
    .replace(/\{raw\}/g, raw)
    .replace(/\{url\}/g, enc);
}

/**
 * Header hygiene: nothing about the page or the visitor should travel along.
 * Note the deliberate absence of `Cache-Control`/`Pragma` *request* headers —
 * a custom header forces a CORS preflight, which plenty of endpoints (and some
 * Spaces) do not answer. `cache: "no-store"` does the same job without it.
 */
export function untraceInit(init = {}, untrace = true) {
  const next = { ...init };
  next.credentials = "omit";
  next.referrerPolicy = "no-referrer";
  next.cache = "no-store";
  if (untrace) next.redirect = "follow";
  return next;
}

function unwrapBody(relay, text) {
  if (!relay?.unwrap) return text;
  try {
    const j = JSON.parse(text);
    const v = j?.[relay.unwrap];
    if (typeof v === "string") return v;
  } catch {}
  return text;
}

export class RelayError extends Error {
  constructor(message, relay, status) {
    super(message);
    this.name = "RelayError";
    this.relay = relay;
    this.status = status || 0;
  }
}

/**
 * The `content-type` (with its multipart boundary) the browser will use for
 * this FormData. Needed when a multipart body has to be re-sent by a relay:
 * the relay has to reuse the exact same header or the target cannot parse it.
 */
export function formDataContentType(fd) {
  try {
    return new Request("https://x.invalid/", { method: "POST", body: fd }).headers.get("content-type") || "";
  } catch {
    return "";
  }
}

/** How many bytes will go on the wire for this body? */
export function bodySize(body) {
  if (body == null) return 0;
  if (typeof body === "string") return body.length;
  if (body instanceof FormData) {
    let n = 0;
    for (const [, v] of body.entries()) n += typeof v === "string" ? v.length : v?.size || 0;
    return n + 512;
  }
  if (body instanceof Blob) return body.size + 512;
  if (body instanceof ArrayBuffer) return body.byteLength;
  return 0;
}

/**
 * A multipart (or other binary) body cannot travel through the JSON relay
 * protocol as text, so it is re-encoded — via `new Response(body)`, which
 * produces exactly the multipart bytes the browser would have sent, boundary
 * and all — and the exact content-type travels with it.
 */
async function bodyToBase64(body) {
  const blob = body instanceof FormData ? await new Response(body).blob() : body;
  return await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",", 2)[1] || "");
    r.onerror = () => rej(new RelayError("could not encode the request body for the relay", null, 0));
    r.readAsDataURL(blob);
  });
}

/** One request whose *body* is handed back as a live stream (SSE, a big file). */
async function fetchStream(relay, target, opts, { timeoutMs = 45000 } = {}) {
  const ac = new AbortController();
  const kill = setTimeout(() => ac.abort(), timeoutMs);
  const outer = opts.signal;
  const onAbort = () => ac.abort();
  if (outer) outer.addEventListener("abort", onAbort);
  const cleanup = () => {
    clearTimeout(kill);
    if (outer) outer.removeEventListener("abort", onAbort);
  };
  try {
    const r = await fetch(target, { ...opts, signal: ac.signal });
    return { status: r.status, body: r.body, headers: r.headers, relay, cleanup };
  } catch (e) {
    cleanup();
    const who = relay ? relay.label : "the connection";
    if (e?.name === "AbortError") throw new RelayError(`${who} timed out.`, relay, 0);
    throw new RelayError(`${who} could not be reached.`, relay, 0);
  }
}

/**
 * Fetch `url` through `relay` (or directly when relay is null) and return the
 * response text plus its status. Streaming is not supported on purpose: keep
 * the SSE stream on the direct connection, relay only the request that decides
 * who gets billed for the work.
 */
export async function relayFetch(relay, url, init = {}, { untrace = true, timeoutMs = 45000, stream = false } = {}) {
  const opts = untraceInit(init, untrace);
  const method = (opts.method || "GET").toUpperCase();
  opts.method = method;
  const via = relay ? `${relay.kind}:${relay.label || relay.id}` : "direct";
  const t0 = Date.now();
  dlog("relay-try", `${method} ${maskHost(url)} via ${via}${stream ? " (stream)" : ""}`);
  if (method === "GET") {
    const sep = url.includes("?") ? "&" : "?";
    url = url + sep + "_r=" + CACHE_BUST();
  }
  let target = url;
  let body = opts.body;

  // Perchance's own proxy. Handled first: it does not take a URL template, it
  // is simply the page's `superFetch`. Everything that leaves through it leaves
  // from Perchance's address, and nothing about this page or this visitor —
  // no referrer, no cookie, no cache — travels with the request.
  if (relay?.kind === "perchance") {
    const sf = typeof root !== "undefined" ? root.superFetch : null;
    if (!sf) throw new RelayError("Perchance's proxy is not available on this page.", relay, 0);
    if (bodySize(opts.body) > (relay.maxBody || 8000000)) {
      throw new RelayError("this request is too big for Perchance's proxy", relay, 0);
    }
    const ac0 = new AbortController();
    const kill0 = setTimeout(() => ac0.abort(), timeoutMs);
    const outer0 = opts.signal;
    const onAbort0 = () => ac0.abort();
    if (outer0) outer0.addEventListener("abort", onAbort0);
    const cleanup0 = () => {
      clearTimeout(kill0);
      if (outer0) outer0.removeEventListener("abort", onAbort0);
    };
    let r;
    try {
      r = await sf(url, {
        method,
        headers: opts.headers,
        body: method === "GET" || method === "HEAD" ? undefined : opts.body,
        signal: ac0.signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
      });
    } catch (e) {
      cleanup0();
      if (e?.name === "AbortError") throw new RelayError(`${relay.label} timed out.`, relay, 0);
      dlog("relay-fail", `${maskHost(url)} via ${via} unreachable (${Date.now() - t0}ms)`);
      throw new RelayError(`${relay.label} could not be reached.`, relay, 0);
    }
    if (stream) return { status: r.status, body: r.body, headers: r.headers, relay, cleanup: cleanup0 };
    let text;
    try {
      text = await r.text();
    } catch (e) {
      cleanup0();
      throw new RelayError(`${relay.label} cut the response short.`, relay, 0);
    }
    cleanup0();
    dlog(r.status >= 200 && r.status < 300 ? "relay-ok" : "relay-fail", `${method} ${maskHost(url)} via ${via} → ${r.status} (${Date.now() - t0}ms)`);
    return { status: r.status, ok: r.status >= 200 && r.status < 300, text, headers: r.headers, relay };
  }

  if (relay?.kind === "server") {
    if (stream) {
      // A stream has to keep flowing, so the relay hands its body straight back
      // instead of wrapping it in JSON.
      const q = `url=${encodeURIComponent(url)}`;
      target = `${relay.base}/api/relay/raw?${q}`;
      // The server key rides a header, never the URL (tunnel and server logs
      // keep URLs; fetch — unlike EventSource — can set headers).
      const sh = relay.token ? { "X-API-Key": relay.token } : {};
      return await fetchStream(relay, target, { ...opts, headers: { ...(opts.headers || {}), ...sh }, method: "GET", body: undefined }, { timeoutMs });
    }
    const payload = { url, method, headers: opts.headers || {} };
    if (typeof opts.body === "string") payload.body = opts.body;
    else if (opts.body != null) {
      payload.bodyB64 = await bodyToBase64(opts.body);
      payload.contentType = opts.headers?.["Content-Type"] || opts.headers?.["content-type"] || "";
    }
    body = JSON.stringify(payload);
    // The relay POST needs the key too — without it a --key server answers
    // 401 here while every other endpoint works, which used to look like a
    // broken relay instead of a missing key.
    opts.headers = { "Content-Type": "application/json", ...(relay.token ? { "X-API-Key": relay.token } : {}) };
    opts.method = "POST";
  } else if (relay) {
    if (method !== "GET" && !relay.post) {
      // Template relays only ever proxy GET; refuse rather than silently
      // turning a job request into an empty GET.
      throw new RelayError(`${relay.label} can only fetch pages, not send jobs.`, relay, 0);
    }
    target = relayTarget(relay, url);
    if (method !== "GET") {
      const forward = { ...(opts.headers || {}) };
      delete forward["X-Relay-Method"];
      delete forward["X-Relay-Headers"];
      opts.headers = {
        ...opts.headers,
        "X-Relay-Method": method,
        "X-Relay-Headers": JSON.stringify(forward),
      };
    }
    if (stream) return await fetchStream(relay, target, opts, { timeoutMs });
  } else {
    delete opts.body;
    if (stream) return await fetchStream(null, target, opts, { timeoutMs });
  }

  const ac = new AbortController();
  const kill = setTimeout(() => ac.abort(), timeoutMs);
  const outer = opts.signal;
  const onAbort = () => ac.abort();
  if (outer) outer.addEventListener("abort", onAbort);
  try {
    const r = await fetch(target, { ...opts, signal: ac.signal });
    const text = await r.text();
    const ok = r.status >= 200 && r.status < 300;
    if (!relay) return { status: r.status, ok, text, headers: r.headers, direct: true };
    if (relay.kind === "server") {
      let j = null;
      try {
        j = JSON.parse(text);
      } catch {}
      if (!j || (typeof j.status !== "number" && !j.error)) {
        throw new RelayError(`Your server did not answer as a relay (${r.status}) — it may be an older copy without /api/relay.`, relay, r.status);
      }
      if (j.error) throw new RelayError(String(j.error).slice(0, 200), relay, j.status || r.status);
      return {
        status: j.status,
        ok: j.status >= 200 && j.status < 300,
        text: String(j.body ?? ""),
        headers: new Headers(j.headers || {}),
        relay,
      };
    }
    if (!r.ok) throw new RelayError(`${relay.label} answered ${r.status}.`, relay, r.status);
    dlog(r.status >= 200 && r.status < 300 ? "relay-ok" : "relay-fail", `${method} ${maskHost(url)} via ${via} → ${r.status} (${Date.now() - t0}ms)`);
    return { status: r.status, ok, text: unwrapBody(relay, text), headers: r.headers, relay };
  } catch (e) {
    if (e instanceof RelayError) {
      dlog("relay-fail", `${method} ${maskHost(url)} via ${via}: ${String(e.message).slice(0, 110)}`);
      throw e;
    }
    const who = relay ? relay.label : "the connection";
    if (e?.name === "AbortError") throw new RelayError(`${who} timed out.`, relay, 0);
    throw new RelayError(`${who} could not be reached.`, relay, 0);
  } finally {
    clearTimeout(kill);
    if (outer) outer.removeEventListener("abort", onAbort);
  }
}

/**
 * Pull a file (the finished clip, a starting-frame image) through a relay.
 * Binary-safe: the relay's body is taken as bytes, never as text, so an mp4
 * survives intact.
 */
export async function relayBlob(relay, url, { untrace = true, timeoutMs = 300000, signal = null } = {}) {
  if (!relay) throw new RelayError("no relay is available for this download", null, 0);
  const opts = untraceInit({ method: "GET" }, untrace);
  const ac = new AbortController();
  const kill = setTimeout(() => ac.abort(), timeoutMs);
  const onAbort = () => ac.abort();
  if (signal) signal.addEventListener("abort", onAbort);
  try {
    let r;
    if (relay.kind === "perchance") {
      const sf = typeof root !== "undefined" ? root.superFetch : null;
      if (!sf) throw new RelayError("Perchance's proxy is not available on this page.", relay, 0);
      r = await sf(url, { method: "GET", signal: ac.signal, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
    } else if (relay.kind === "server") {
      const q = `url=${encodeURIComponent(url)}`;
      const target = `${relay.base}/api/relay/raw?${q}`;
      const kh = relay.token ? { "X-API-Key": relay.token } : {};
      r = await fetch(target, { ...opts, headers: { ...(opts.headers || {}), ...kh }, signal: ac.signal });
    } else {
      r = await fetch(relayTarget(relay, url), { ...opts, signal: ac.signal });
    }
    if (!r || r.ok === false || (typeof r.status === "number" && (r.status < 200 || r.status >= 300))) {
      throw new RelayError(`${relay.label} answered ${r?.status ?? "nothing"}.`, relay, r?.status || 0);
    }
    const blob = await r.blob();
    if (!blob.size) throw new RelayError(`${relay.label} returned an empty file.`, relay, 0);
    return blob;
  } catch (e) {
    if (e instanceof RelayError) throw e;
    if (e?.name === "AbortError") throw new RelayError(`${relay.label} timed out.`, relay, 0);
    throw new RelayError(`${relay.label} could not be reached.`, relay, 0);
  } finally {
    clearTimeout(kill);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

export function parseIp(text) {
  if (!text) return null;
  try {
    const j = JSON.parse(text);
    const v = j.ip || j.ip_addr || j.query;
    if (v) return String(v);
  } catch {}
  const m = String(text).match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
  return m ? m[1] : null;
}

/** What address does this relay go out from? */
export async function egressIp(relay, { untrace = true } = {}) {
  let last = null;
  for (const url of IP_ECHOES) {
    try {
      const r = await relayFetch(relay, url, { method: "GET" }, { untrace, timeoutMs: 12000 });
      if (r.status >= 200 && r.status < 300) {
        const ip = parseIp(r.text);
        if (ip) return ip;
      }
    } catch (e) {
      last = e;
    }
  }
  if (last) throw last;
  return null;
}

/**
 * Test the whole pool in one go — used by the Settings "Check addresses"
 * button. Every address is probed at the same time, so a slow relay cannot
 * make the whole check crawl; each answer is handed to `onEach` the moment it
 * arrives so the list fills in live.
 */
export async function checkRelays(settings, { untrace = true, onEach } = {}) {
  const pool = [{ id: "direct", label: "Direct (your connection)", kind: "direct" }, ...relayPool(settings)];
  dlog("diag", `checking ${pool.length} egress path(s)…`);
  return Promise.all(
    pool.map(async (relay) => {
      const t0 = Date.now();
      const rec = { id: relay.id, label: relay.label, kind: relay.kind };
      try {
        rec.ip = await egressIp(relay.kind === "direct" ? null : relay, { untrace });
        rec.ms = Date.now() - t0;
        if (!rec.ip) rec.error = "no address returned";
        dlog(rec.error ? "diag-fail" : "diag-ok", `${relay.label}: ${rec.error || "egress verified"} (${rec.ms}ms)`);
      } catch (e) {
        rec.error = String(e.message || e).slice(0, 90);
        rec.ms = Date.now() - t0;
        dlog("diag-fail", `${relay.label}: ${rec.error}`);
      }
      onEach?.(rec);
      return rec;
    })
  );
}
