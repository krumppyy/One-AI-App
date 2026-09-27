/**
 * MuAPI — a paid, bring-your-own-key gateway in front of the commercial video
 * models (Kling, Veo, Sora, Seedance, Wan, Hailuo, Vidu, LTX, PixVerse…).
 *
 * The catalogue and the per-model request facts live in src/muapi-models.js; the
 * provider entries the engine sees are built from it in src/providers.js. This
 * file is the wire protocol:
 *
 *   POST /api/v1/<endpoint>            { ...payload }      → { request_id }
 *   GET  /api/v1/predictions/<id>/result                   → { status, outputs }
 *
 * Two things are unusual about this vendor and both are load-bearing here:
 *
 *  1. It does NOT send CORS headers, so a plain fetch() from this origin fails
 *     with "TypeError: Failed to fetch". Every call therefore goes through
 *     Perchance's own proxy (`root.superFetch`), which the visitor already has
 *     and which is also a different address — so the model never sees the
 *     visitor's connection. (Verified live: a POST with x-api-key through
 *     superFetch reaches the API and returns its real JSON.)
 *  2. It takes reference images by PUBLIC URL — a data: URL is rejected — so the
 *     starting frame is uploaded once per segment before the job is submitted
 *     (see `ctx.publicUpload`, wired in src/app.js to the upload plugin).
 */

import { SpaceError } from "./gradio.js";
import { MUAPI_BASE } from "./muapi-models.js";
import { ASPECTS } from "./providers.js";

const SUCCESS = new Set(["completed", "succeeded", "success", "done"]);
const FAIL = new Set(["failed", "error", "cancelled", "canceled"]);
const POLL_MS = 2500;
/** How long a submitted job may sit without a status change before we give up. */
const DEADLINE_MS = 20 * 60 * 1000;

const RES_RANK = ["360p", "480p", "720p", "768p", "1080p", "2k", "2K", "4k", "4K"];

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function ratioOf(label) {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(label || "").trim());
  if (!m) return null;
  return Number(m[1]) / Number(m[2]);
}

function messageFrom(text) {
  const j = parseJson(text);
  if (j) {
    if (typeof j.detail === "string") return j.detail;
    if (typeof j.error === "string") return j.error;
    if (typeof j.message === "string") return j.message;
    if (Array.isArray(j.detail)) {
      const first = j.detail[0];
      if (first?.msg) return `${first.loc?.slice(-1)[0] || "input"}: ${first.msg}`;
    }
    return JSON.stringify(j).slice(0, 300);
  }
  return String(text || "").slice(0, 300);
}

/**
 * Turn a failed response into the error kind the engine already knows how to
 * deal with, so a MuAPI failure walks the same ladder (next model → on-device)
 * as every other provider's.
 */
function failure(status, text, what) {
  const detail = messageFrom(text);
  const low = detail.toLowerCase();
  if (status === 401 || status === 403 || /invalid credentials|not authorized|unauthor|api key/i.test(low))
    return new SpaceError(
      "MuAPI rejected the API key.",
      "auth",
      detail,
      "Open Settings → MuAPI and paste a key from muapi.ai/access-keys. (Keys are free to create; you top up credits to run jobs.)"
    );
  if (status === 402 || /insufficient|not enough (credits|balance)|no credits|balance too low|top ?up/i.test(low))
    return new SpaceError(
      "MuAPI says the account is out of credits.",
      "quota",
      detail,
      "Top up at muapi.ai, or pick a free model from another section of the list."
    );
  if (status === 429 || /rate ?limit|too many requests|concurren/i.test(low))
    return new SpaceError(`${what} was rate-limited.`, "busy", detail);
  if (status === 404) return new SpaceError(`MuAPI has no endpoint called “${what}”.`, "error", detail);
  if (/safety|moderation|content policy|violat|censor|blocked|nsfw/i.test(low))
    return new SpaceError(`MuAPI refused the content: ${detail}`, "safety", detail);
  return new SpaceError(`MuAPI error (${status}): ${detail}`, status >= 500 ? "busy" : "error", detail);
}

async function muapiFetch(ctx, path, init = {}, what = "the request") {
  // The engine hands the proxy down in `ctx`; the settings-panel helpers call
  // this with nothing but a settings object, so fall back to the page's own.
  const sf = ctx.superFetch || (typeof root !== "undefined" ? root.superFetch : null);
  if (typeof sf !== "function")
    throw new SpaceError(
      "MuAPI can only be reached through Perchance's proxy, which this page has not got.",
      "error",
      "root.superFetch is unavailable",
      "Reload the page. If it keeps happening, use a model from another section."
    );
  let res;
  try {
    res = await sf(MUAPI_BASE + path, { ...init, signal: ctx.signal });
  } catch (e) {
    if (ctx.signal?.aborted) throw new SpaceError("Cancelled", "cancelled");
    throw new SpaceError(
      "Could not reach MuAPI.",
      "error",
      e?.message || String(e),
      "The proxy did not answer. Check the connection, then try again."
    );
  }
  const ok = typeof res.ok === "boolean" ? res.ok : res.status >= 200 && res.status < 300;
  let text = "";
  try {
    text = await res.text();
  } catch {}
  if (!ok) throw failure(res.status, text, what);
  return parseJson(text);
}

/* ------------------------------------------------------------------ payload */

/**
 * Snap the aspect the visitor picked onto the ones this endpoint actually
 * accepts, by log-ratio distance. “adaptive” (the model reads the shape off the
 * reference image) is preferred when nothing is close enough — which is what
 * makes 21:9 land correctly on a model whose widest option is 16:9.
 */
export function pickAspect(requested, list) {
  if (!list?.length) return null;
  if (list.includes(requested)) return requested;
  const want = ASPECTS[requested]?.ratio || ratioOf(requested);
  let best = null;
  let bestErr = Infinity;
  for (const a of list) {
    const r = ratioOf(a);
    if (!r || !want) continue;
    const err = Math.abs(Math.log(r / want));
    if (err < bestErr) {
      bestErr = err;
      best = a;
    }
  }
  if (list.includes("adaptive") && (!best || bestErr > 0.15)) return "adaptive";
  return best || list[0];
}

/** The closest resolution this endpoint offers to the one that was asked for. */
export function pickRes(requested, list) {
  if (!list?.length) return null;
  if (list.includes(requested)) return requested;
  const want = RES_RANK.indexOf(requested);
  const t = want < 0 ? 1 : want;
  let best = null;
  let bestErr = Infinity;
  for (const r of list) {
    const i = RES_RANK.indexOf(r);
    if (i < 0) continue;
    const err = Math.abs(i - t);
    if (err < bestErr) {
      bestErr = err;
      best = r;
    }
  }
  return best || list[0];
}

/** The closest allowed duration (endpoints with a fixed menu of clip lengths). */
export function pickDuration(seconds, list, min, max) {
  const s = Math.max(0.5, Number(seconds) || 5);
  if (list?.length) {
    let best = list[0];
    for (const v of list) if (Math.abs(v - s) < Math.abs(best - s)) best = v;
    return best;
  }
  const lo = Number.isFinite(min) ? min : 1;
  const hi = Number.isFinite(max) ? max : 10;
  return Math.round(Math.min(hi, Math.max(lo, s)) * 10) / 10;
}

/**
 * Map this app's controls onto the field names this particular endpoint
 * declares. Nothing is invented: a value is only sent when the model's own
 * schema has a field for it, which is what keeps one adapter serving 51
 * models whose payloads share little more than `prompt`.
 */
export function buildMuapiPayload(model, values) {
  const p = {};
  const prompt = (values.prompt || "").trim();
  if (prompt) p.prompt = prompt;
  if (values.startUrl) {
    if (model.media === "images_list") p.images_list = [values.startUrl, ...((values.extraUrls || []).filter(Boolean))].slice(0, 9);
    else if (model.media) p[model.media] = values.startUrl;
  } else if (model.media === "images_list" && (values.extraUrls || []).length) {
    p.images_list = values.extraUrls.filter(Boolean).slice(0, 9);
  }
  if (values.endUrl && model.end) {
    if (model.end === "images_list") p.images_list = [...(p.images_list || []), values.endUrl];
    else p[model.end] = values.endUrl;
  }
  const aspect = pickAspect(values.aspect, model.aspect);
  if (aspect) p.aspect_ratio = aspect;
  const res = pickRes(values.quality, model.res);
  if (res) p.resolution = res;
  if (model.q?.length) {
    const want = values.quality === "720p" ? "high" : "basic";
    p.quality = model.q.includes(want) ? want : model.q[0];
  }
  if (values.duration != null) p.duration = pickDuration(values.duration, model.durEnum, model.dur?.[0], model.dur?.[1]);
  if (model.seed && Number.isFinite(Number(values.seed))) p.seed = Math.floor(Number(values.seed));
  if (model.neg && (values.negative || "").trim()) p.negative_prompt = values.negative.trim();
  return p;
}

/* --------------------------------------------------------------- transport */

async function submit(ctx, model, payload) {
  const key = (ctx.settings?.muapiKey || "").trim();
  if (!key) throw new SpaceError("MuAPI needs an API key — open Settings → MuAPI.", "auth");
  const j = await muapiFetch(
    ctx,
    `/api/v1/${model.id}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify(payload),
    },
    model.id
  );
  return j || {};
}

function resultUrl(j) {
  const out = j?.outputs ?? j?.output;
  if (Array.isArray(out)) {
    const first = out[0];
    return typeof first === "string" ? first : first?.url || first?.video?.url || null;
  }
  if (typeof out === "string") return out;
  return out?.url || out?.video?.url || j?.url || j?.video_url || null;
}

/**
 * Poll until the job finishes. MuAPI's status endpoint reports only the state,
 * so the progress figure shown in the UI is elapsed time against the model's
 * own estimate — honest, and enough to tell "still working" from "wedged".
 */
async function poll(ctx, requestId, onEvent, model, t0) {
  const key = (ctx.settings?.muapiKey || "").trim();
  const est = Math.max(20, Number(ctx.estSecs) || 60) * 1000;
  let fails = 0;
  while (Date.now() - t0 < DEADLINE_MS) {
    if (ctx.signal?.aborted) throw new SpaceError("Cancelled", "cancelled");
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (ctx.signal?.aborted) throw new SpaceError("Cancelled", "cancelled");
    let j;
    try {
      j = await muapiFetch(
        ctx,
        `/api/v1/predictions/${encodeURIComponent(requestId)}/result`,
        { headers: { "x-api-key": key } },
        `${model.label} (status)`
      );
      fails = 0;
    } catch (e) {
      // A proxy hiccup or a 5xx is not a failed render — keep polling a few
      // times before believing it. A real refusal is rethrown by muapiFetch.
      if (e?.kind === "busy" && fails < 4) {
        fails += 1;
        continue;
      }
      throw e;
    }
    const status = String(j?.status || "").toLowerCase();
    const elapsed = Date.now() - t0;
    if (SUCCESS.has(status)) return j;
    if (FAIL.has(status)) {
      const cost = j?.cost;
      const refund = cost?.refunded ? ` (refunded ${cost.amount_credits ?? "the"} credits)` : "";
      throw new SpaceError(
        `MuAPI run failed: ${messageFrom(JSON.stringify(j))}${refund}`,
        "error",
        JSON.stringify(j).slice(0, 300)
      );
    }
    if (status) {
      onEvent({
        type: "tick",
        elapsed,
        progress: Math.min(0.94, elapsed / est),
        message: `${model.label}: ${status}…`,
      });
    } else {
      onEvent({
        type: "tick",
        elapsed,
        progress: Math.min(0.94, elapsed / est),
        message: `${model.label}: rendering…`,
      });
    }
  }
  throw new SpaceError(
    `${model.label} did not finish within 20 minutes.`,
    "timeout",
    `request ${requestId}`,
    "MuAPI holds the job server-side, so it may still complete on your account — check muapi.ai history."
  );
}

/* -------------------------------------------------------------------- run */

/**
 * One segment on MuAPI. Returns the finished clip's URL — the engine downloads
 * it, because that is where the privacy rules for pulling a file live.
 */
export async function muapiRun(model, ctx, onEvent) {
  const t0 = Date.now();
  const key = (ctx.settings?.muapiKey || "").trim();
  if (!key) {
    throw new SpaceError(
      "MuAPI needs an API key.",
      "auth",
      "",
      "Open Settings → MuAPI and paste a key from muapi.ai/access-keys — generations are billed to that account."
    );
  }
  let startUrl = ctx.imageUrl || null;
  if (model.media && !startUrl) {
    if (!ctx.imageBlob) throw new SpaceError(`${model.label} needs a reference image.`, "input");
    if (typeof ctx.publicUpload !== "function")
      throw new SpaceError(
        "Could not publish the reference frame for MuAPI.",
        "error",
        "ctx.publicUpload is missing"
      );
    onEvent({ type: "stage", stage: "uploading", message: "Publishing the reference frame (MuAPI needs a public URL)…" });
    startUrl = await ctx.publicUpload(ctx.imageBlob);
    if (!startUrl) throw new SpaceError("The reference frame could not be published.", "empty");
  }
  let endUrl = null;
  if (model.end && ctx.endImage) {
    endUrl = typeof ctx.publicUpload === "function" ? await ctx.publicUpload(ctx.endImage) : null;
  }

  let extraUrls = Array.isArray(ctx.extraUrls) && ctx.extraUrls.length ? ctx.extraUrls.filter(Boolean) : [];
  const extraBlobs = Array.isArray(ctx.extraBlobs) ? ctx.extraBlobs.filter(Boolean) : [];
  if (!extraUrls.length && extraBlobs.length && typeof ctx.publicUpload === "function") {
    if (model.media === "images_list") {
      onEvent({ type: "stage", stage: "uploading", message: `Publishing ${extraBlobs.length} reference image${extraBlobs.length === 1 ? "" : "s"}…` });
      extraUrls = [];
      for (const b of extraBlobs.slice(0, 8)) {
        try {
          const u = await ctx.publicUpload(b);
          if (u) extraUrls.push(u);
        } catch {}
      }
    } else {
      onEvent({
        type: "log",
        level: "warn",
        text: `${model.label} takes one start image, so the ${extraBlobs.length} extra reference${extraBlobs.length === 1 ? "" : "s"} ride in the prompt as look guidance only — pick a multi-ref model (Seedance, Pixverse, Veo Fast) to send them as images.`,
      });
    }
  }

  const payload = buildMuapiPayload(model, {
    prompt: ctx.prompt,
    negative: ctx.negative,
    duration: ctx.duration,
    aspect: ctx.aspect,
    quality: ctx.quality,
    seed: ctx.seed,
    startUrl,
    endUrl,
    extraUrls,
  });

  onEvent({ type: "log", text: `MuAPI → ${model.id} ${JSON.stringify(payload).slice(0, 260)}` });
  onEvent({ type: "stage", stage: "queued", message: `${model.label}: submitting to MuAPI…` });
  const submitted = await submit(ctx, model, payload);
  const requestId = submitted.request_id || submitted.id || null;

  let j = submitted;
  if (requestId) {
    onEvent({ type: "tick", elapsed: 0, progress: 0.03, message: `${model.label}: queued…` });
    j = await poll(ctx, requestId, onEvent, model, t0);
  }
  const url = resultUrl(j);
  if (!url)
    throw new SpaceError(
      `${model.label} finished without a video.`,
      "empty",
      JSON.stringify(j).slice(0, 300)
    );
  if (j?.cost?.amount_credits != null)
    onEvent({ type: "log", text: `MuAPI charged ${j.cost.amount_credits} credits` });
  return { url, seed: ctx.seed, meta: { width: j?.width, height: j?.height, duration: j?.duration }, requestId };
}

/* ------------------------------------------------------- account helpers */

/**
 * The wallet balance, normalized. The endpoint's response shape is undocumented,
 * so the common keys are tried and the raw body is kept for the UI to show if
 * none of them match.
 */
export async function muapiBalance(ctx) {
  const key = (ctx.settings?.muapiKey || ctx.muapiKey || "").trim();
  if (!key) throw new SpaceError("Add a MuAPI key first.", "auth");
  const j = await muapiFetch(ctx, "/api/v1/account/balance", { headers: { "x-api-key": key } }, "the balance check");
  const bag = [j, j?.data, j?.wallet, j?.account, j?.credits].filter(Boolean);
  for (const b of bag) {
    for (const k of ["balance", "credits", "credit_balance", "remaining", "available", "amount"]) {
      const v = b?.[k];
      if (Number.isFinite(Number(v))) return { credits: Number(v), currency: b?.currency || null, raw: j };
    }
  }
  return { credits: null, currency: null, raw: j };
}

/**
 * The exact price of a run before you press Generate — MuAPI runs the same cost
 * function the billing system uses, so the quote is what you are charged. The
 * endpoint is public (verified: it answers 200 with a bogus key and returns
 * `{cost, currency, dynamic_pricing}`), so a quote needs no account at all.
 */
export async function muapiEstimate(model, ctx) {
  const key = (ctx.settings?.muapiKey || "").trim();
  const payload = buildMuapiPayload(model, {
    prompt: ctx.prompt || "a cat",
    negative: ctx.negative,
    duration: ctx.duration,
    aspect: ctx.aspect,
    quality: ctx.quality,
    seed: ctx.seed,
    startUrl: ctx.imageUrl || "https://example.com/frame.png",
  });
  const j = await muapiFetch(
    ctx,
    `/api/v1/models/${encodeURIComponent(model.id)}/estimate-cost`,
    {
      method: "POST",
      headers: key ? { "content-type": "application/json", "x-api-key": key } : { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
    `${model.label} (quote)`
  );
  const bag = [j, j?.data, j?.cost];
  for (const b of bag) {
    for (const k of ["cost", "cost_usd", "usd", "price", "amount", "amount_usd", "total"]) {
      const v = b?.[k];
      if (Number.isFinite(Number(v))) return { usd: Number(v), credits: b?.amount_credits ?? null, raw: j };
    }
  }
  return { usd: null, credits: j?.amount_credits ?? null, raw: j };
}
