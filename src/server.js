import { SpaceError } from "./gradio.js";

/* ------------------------------------------------------------------ *
 *  Client for AIVideoGen Server — the user's own GPU (Colab, laptop,
 *  desktop, any box).  Speaks JSON + Server-Sent Events, so it needs no
 *  Hugging Face account, no token and no third-party relay.
 * ------------------------------------------------------------------ */

export function normalizeServerUrl(input) {
  let s = String(input || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  s = s.replace(/\/+$/, "");
  s = s.replace(/\/api\/(health|generate)$/i, "");
  s = s.replace(/\/(index\.html?|ui)$/i, "");
  return s;
}

export const isLocalhost = (u) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/i.test(u);

// The server key travels in the X-API-Key header, never in the URL — URLs end
// up in tunnel/server access logs and browser history, headers do not. The
// one exception is the EventSource status stream (it cannot set headers),
// which keeps a query key via sseUrl() below.
function urls(base, path) {
  return `${base}${path}`;
}

function sseUrl(base, path, token) {
  const u = `${base}${path}`;
  if (!token) return u;
  return `${u}${u.includes("?") ? "&" : "?"}key=${encodeURIComponent(token)}`;
}

function headers(token) {
  const h = {};
  if (token) h["X-API-Key"] = token;
  return h;
}

function netError(base, e) {
  const local = isLocalhost(base);
  return new SpaceError(
    `Could not reach your GPU server at ${base}.`,
    "offline",
    e?.message || String(e),
    local
      ? "Is the server still running? Start it with `python server.py`, and remember that a Colab session dies after a while — re-run the notebook cell to get a fresh address."
      : "Check that the address is right and the server is still running (Colab sessions and free tunnels expire)."
  );
}

export async function serverHealth(base, token, signal) {
  let r;
  try {
    r = await fetch(urls(base, "/api/health", token), { headers: headers(token), signal });
  } catch (e) {
    throw netError(base, e);
  }
  if (!r.ok) {
    throw new SpaceError(
      `The server answered with HTTP ${r.status}.`,
      r.status === 401 || r.status === 403 ? "auth" : "error",
      "",
      r.status === 401 || r.status === 403 ? "This server wants a key — put it in Settings → My GPU server." : ""
    );
  }
  const j = await r.json().catch(() => null);
  if (!j || !j.ok) throw new SpaceError("That address is reachable but is not an AIVideoGen server.", "input");
  return j;
}

export function providersFromHealth(base, health) {
  const list = Array.isArray(health?.models) ? health.models : [];
  return list.map((m) => ({
    id: `server:${base}:${m.id}`,
    kind: "server",
    serverModel: m.id,
    serverBase: base,
    label: m.label,
    vendor: health?.gpu ? `${health.gpu}${health.vramGb ? ` · ${health.vramGb}GB` : ""}` : "your server",
    tier: "own",
    minSec: m.minSec ?? 1,
    maxSec: m.maxSec ?? 5,
    fps: m.fps ?? null,
    estSecs: m.fps >= 24 ? 60 : 90,
    quality: 6,
    caps: { camera: false, ...(m.caps || {}), resolution: m.caps?.resolution ?? true },
    note: m.note || `Runs on your own GPU (${health?.device || "?"}).`,
    ownServer: true,
    sizeGb: m.sizeGb ?? null,
    native: m.native ?? null,
    cached: m.cached !== false,
    cachedGb: m.cachedGb ?? null,
    lora: m.lora || null,
    family: m.family || null,
    weightsSource: m.source || null,
  }));
}

export async function serverGenerate(base, provider, ctx, onEvent, signal, token) {
  const body = {
    model: provider.serverModel,
    prompt: ctx.prompt || "",
    negative: ctx.negative || "",
    image: ctx.imageDataUrl || null,
    // The other end of the beat, for the server's first/last-frame models —
    // this is what turns an undress storyboard into directed motion instead of
    // a model inventing the movement between two keyframes on its own.
    lastImage: ctx.endImageDataUrl || null,
    width: ctx.size?.[0],
    height: ctx.size?.[1],
    duration: ctx.duration,
    seed: ctx.seed,
    steps: ctx.steps || 0,
    guidance: ctx.guidance || 0,
    motion: ctx.motionScale ?? 1,
    nsfw: !!ctx.nsfw,
    fps: ctx.fps || 0,
  };
  // The LoRA catalogue is what makes an explicit request actually explicit: the
  // Wan base models have never seen adult video, and a prompt alone will not
  // conjure it. The motion adapter answers the other half of the same problem
  // (a shot where nobody moves). Both are Wan 2.2 adapters, so they are only
  // asked for on a Wan model, and the server falls back to the base model if it
  // cannot fetch or attach them.
  if (ctx.nsfw && /^wan/.test(provider.family || "")) body.loras = ["nsfw", "motion"];
  if (!provider.caps?.prompt) {
    body.prompt = "";
  }
  if (!provider.caps?.i2v) body.image = null;

  let r;
  try {
    r = await fetch(urls(base, "/api/generate", token), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers(token) },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e?.name === "AbortError") throw new SpaceError("Cancelled", "cancelled");
    throw netError(base, e);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 409) throw new SpaceError("Your GPU server is busy with another job.", "busy", "", "Wait for the current render to finish and try again.");
    throw new SpaceError(j?.error || `Server error (${r.status})`, "error", j?.detail || "");
  }
  const jobId = j.job;
  if (!jobId) throw new SpaceError("The server did not return a job id.", "error");

  const started = Date.now();
  const final = await streamStatus(base, jobId, onEvent, signal, token, started);
  if (final.state === "cancelled") throw new SpaceError("Cancelled", "cancelled");
  if (final.state !== "done") {
    throw new SpaceError(final.error || "Your server could not render this clip.", "error", final.detail || "");
  }

  onEvent({ type: "stage", stage: "downloading", message: "Downloading from your GPU…" });
  let vr;
  try {
    vr = await fetch(urls(base, `/api/result/${jobId}`, token), { headers: headers(token), signal });
  } catch (e) {
    throw netError(base, e);
  }
  if (!vr.ok) throw new SpaceError("The server finished but the video could not be downloaded.", "empty");
  const blob = await vr.blob();
  if (blob.size < 2048) throw new SpaceError("The server returned an empty video.", "empty");
  return { blob, seed: final.seed, meta: final, provider };
}

function streamStatus(base, jobId, onEvent, signal, token, started) {
  return new Promise((resolve, reject) => {
    const url = sseUrl(base, `/api/status/${jobId}`, token);
    let es;
    try {
      es = new EventSource(url);
    } catch (e) {
      reject(netError(base, e));
      return;
    }
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      try {
        es.close();
      } catch {}
      signal?.removeEventListener("abort", onAbort);
      clearTimeout(guard);
      clearTimeout(hard);
      fn(arg);
    };
    const onAbort = () => {
      fetch(urls(base, `/api/cancel/${jobId}`, token), { method: "POST", headers: headers(token) }).catch(() => {});
      finish(reject, new SpaceError("Cancelled", "cancelled"));
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort);
    }
    // A first run can spend an hour fetching 90 GB of weights, so the guard is
    // an INACTIVITY timeout (the server emits a tick every few seconds while it
    // works) rather than a wall-clock one, with a generous absolute ceiling.
    let guard = null;
    let hard = null;
    const arm = () => {
      clearTimeout(guard);
      guard = setTimeout(
        () => finish(reject, new SpaceError("Your server stopped responding.", "timeout")),
        20 * 60 * 1000
      );
    };
    arm();
    hard = setTimeout(
      () => finish(reject, new SpaceError("That job has been running for six hours — giving up.", "timeout")),
      6 * 60 * 60 * 1000
    );

    es.addEventListener("state", (ev) => {
      let d;
      try {
        d = JSON.parse(ev.data);
      } catch {
        return;
      }
      arm();
      const elapsed = Date.now() - started;
      onEvent({
        type: "tick",
        elapsed,
        progress: typeof d.progress === "number" ? d.progress : null,
        message: d.message || "",
      });
      if (d.state === "done" || d.state === "error" || d.state === "cancelled") finish(resolve, d);
    });
    es.addEventListener("end", () => finish(resolve, { state: "error", error: "The server closed the connection early." }));
    es.onerror = () => {
      if (settled) return;
      setTimeout(() => {
        if (!settled && es.readyState === 2) {
          finish(reject, netError(base, new Error("event stream closed")));
        }
      }, 1500);
    };
  });
}

export async function serverWeights(base, token, signal) {
  let r;
  try {
    r = await fetch(urls(base, "/api/weights", token), { headers: headers(token), signal });
  } catch (e) {
    throw netError(base, e);
  }
  if (!r.ok) {
    throw new SpaceError(
      `The server answered with HTTP ${r.status}.`,
      r.status === 401 || r.status === 403 ? "auth" : "error",
      "",
      r.status === 401 || r.status === 403 ? "This server wants a key — put it in Settings → My GPU server." : ""
    );
  }
  const j = await r.json().catch(() => null);
  if (!j || !j.ok) throw new SpaceError("That address is reachable but is not an AIVideoGen server.", "input");
  return j;
}

export async function serverDownloadWeights(base, model, token, onEvent, signal) {
  let r;
  try {
    r = await fetch(urls(base, "/api/weights/download", token), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers(token) },
      body: JSON.stringify({ model }),
      signal,
    });
  } catch (e) {
    if (e?.name === "AbortError") throw new SpaceError("Cancelled", "cancelled");
    throw netError(base, e);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 409)
      throw new SpaceError("Your GPU server is busy with another job.", "busy", "", "Wait for it to finish, then try again.");
    throw new SpaceError(j?.error || `Server error (${r.status})`, "error", j?.detail || "");
  }
  if (!j.job) throw new SpaceError("The server did not return a job id.", "error");
  const final = await streamStatus(base, j.job, onEvent, signal, token, Date.now());
  if (final.state === "cancelled") throw new SpaceError("Cancelled", "cancelled");
  if (final.state !== "done")
    throw new SpaceError(final.error || "The download did not finish.", "error", final.detail || "");
  return final;
}

export async function serverRemoveWeights(base, model, token) {
  let r;
  try {
    r = await fetch(urls(base, "/api/weights/remove", token), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers(token) },
      body: JSON.stringify({ model, confirm: "remove" }),
    });
  } catch (e) {
    throw netError(base, e);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new SpaceError(j?.error || `Server error (${r.status})`, "error");
  return j;
}

export async function serverCancel(base, jobId, token) {
  try {
    await fetch(urls(base, `/api/cancel/${jobId}`, token), { method: "POST", headers: headers(token) });
  } catch {}
}
