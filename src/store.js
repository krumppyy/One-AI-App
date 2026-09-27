import { decryptBlob, decryptString, encryptBlob, encryptString, ensureVault, isEncrypted, vaultReady } from "./vault.js";

const SETTINGS_KEY = "settings";
const HISTORY_FOLDER = "avg_history";
const COOLDOWN_FOLDER = "avg_cooldowns";
// Finals are the finished clips (one per run). Takes are every intermediate
// segment the engine renders along the way, auto-saved to the sandbox the
// moment each one arrives. The two pools are capped independently so a long
// run's takes can never push a finished clip out: takes only ever evict the
// oldest take, finals only the oldest final. Anything else stays until the
// user deletes it by hand in the Library.
const MAX_FINALS = 24;
const MAX_TAKES = 60;
// Generated stills share the library with clips, in their own pools so a big
// image batch can never push a finished clip out (and vice versa): a lone
// image lands in Finals as kind "image", every variation of a multi-image
// batch lands in the Sandbox as kind "image-take" — the same split as clips.
const MAX_IMAGE_FINALS = 24;
const MAX_IMAGE_TAKES = 60;
const MAX_VOICE = 24;
const MAX_READER = 24;
const MAX_IMPORTS = 60;

export const DEFAULT_SETTINGS = {
  // Where the compute comes from.
  //   auto    = your own GPU server first (if configured), then the free public pool,
  //             then the on-device offline renderer as a last resort
  //   server  = only your own server  (no third party is even contacted)
  //   offline = only this device      (works with the internet unplugged)
  //   pool    = only the free public pool
  computeMode: "auto",
  serverUrl: "",
  serverToken: "",
  serverModels: [],
  poolEnabled: true,
  offlineFallback: true,
  hfToken: "",
  replicateToken: "",
  falKey: "",
  runwayKey: "",
  // MuAPI (muapi.ai) — one key for the whole catalogue in src/muapi-models.js.
  // Paid per generation; every MuAPI call is relayed through Perchance's fetch
  // proxy (the vendor sends no CORS headers), and the reference frame is
  // published to a public URL first because the API rejects data: URLs.
  muapiKey: "",
  // The old single model pick. Kept only so a saved setting from before the two
  // generators existed still means something; the two rows below own the choice
  // now, and `settings.provider` is ignored once a run supplies `generators`.
  provider: "auto",
  // Two generators, each with its own on/off switch and its own Auto /
  // pick-a-model mode (see the Studio panel and `rebuildGenSelects()` in
  // src/app.js). They are independent, so "only NSFW", "only standard" and
  // "both" are all expressible:
  //   standard  the general-purpose models — free pool, your server, keyed
  //             vendors, the non-uncensored MuAPI sections, the on-device rig
  //   nsfw      the uncensored models plus the whole NSFW pipeline (explicit
  //             starting frame, hidden storyboard, undress timeline)
  // `mode` is "auto" (let the engine walk that row's own pool) or "selected"
  // (`pick` names one model from that row's list).
  genStandard: { on: true, mode: "auto", pick: "" },
  genNsfw: { on: false, mode: "auto", pick: "" },
  aspect: "16:9",
  quality: "480p",
  imgFormat: "jpeg",
  imgScale: "1",
  imgUpscaleMode: "fast",
  vidFormat: "match",
  vidScale: "1",
  vidUpscaleMode: "fast",
  style: "cinematic",
  steps: 0,
  guidance: 0,
  seed: "",
  // Reuse the exact seed a render actually used (see handleResult). Off = the
  // seed field stays as typed and blank still means a fresh random roll.
  lockSeed: false,
  nsfw: false,
  // Output frame rate. 0 = whatever the model itself renders at (16 fps for
  // Wan, 24 for LTX, 7 for SVD...). Pick a number to force it: the on-device
  // renderer encodes exactly that rate, the GPU server interpolates up to it,
  // and a clip that came back from a free/commercial model at its own rate is
  // re-timed here (see retimeClip in src/video.js) so the file you keep really
  // plays at the rate you asked for.
  fps: 0,
  // NSFW undressing. When on (and NSFW is on), a multi-second run is planned as
  // a *chain of stages* — hands over the body, top comes off, bra, bottoms,
  // fully nude — instead of one flat prompt, so the clip actually changes what
  // the person is wearing over its length rather than holding the first frame.
  undress: false,
  // What the *first frame* of an NSFW run should be. A video model animates the
  // frame it is given, so this is where "undress" actually has to happen:
  //   auto    with a reference picture: repaint that picture with AI Horde
  //           inpainting (keeps your own person); the run stops with the
  //           reason if AI Horde cannot, rather than animating someone else.
  //           With no picture: draw one.
  //   draw    always draw a new explicit frame (free, instant, new subject)
  //   undress kept only for old saved settings — it means the same as auto now
  //   image   keep your picture exactly as it is (a real GPU model may still
  //           change it, but nothing here invents the undress)
  nsfwFrame: "auto",
  // Optional free AI Horde key (aihorde.net → register → API key). Anonymous
  // callers sit at the back of the queue; a key moves the undress step up, and
  // contributing GPU moves it up more.
  hordeKey: "",
  crossfade: 0.35,
  autoEnhance: true,
  keepAudio: false,
  customSpaces: [],
  keyModels: {},
  allowPaidOnAuto: false,
  // Privacy: which address the model sees, and how it changes.
  //   off         = every request leaves from this connection
  //   generation  = step to the next relay once per run
  //   request     = step inside every single request (each segment and retry)
  // With no relay configured this changes nothing — requests go direct.
  relayMode: "generation",
  relayIndex: 0,
  relays: [],
  extraServers: [],
  relayRetries: 3,
  relayTimeoutMs: 45000,
  vpnNote: "",
  untrace: true,
  usePublicRelays: false,
  usePerchanceRelay: true,
  // Never contact a model from this browser directly. Every request — the
  // parameter list, the upload, the job, its progress stream and the finished
  // clip — goes out through a relay, so the only address a model can see is the
  // relay's. Default on: with a relay of your own it also stretches the free
  // per-address GPU allowance, and with none at all the built-in proxy carries
  // it, so it costs nothing to leave on.
  strictPrivacy: true,
  // Start every run from a clean slate: forget the models the app had benched
  // and step to the next address, so a spent allowance on one address is not
  // inherited by the next run. Default on — without it a single refusal can
  // bench the whole free pool for five minutes and the second run quits before
  // it tries anything.
  freshRun: true,
  // Forget the run afterwards: cookies this origin can see, web storage,
  // caches, resource timings, and the quota records. See src/traces.js for
  // exactly what is (and is not) removable.
  wipeTraces: true,
  // The one-click **Reset** (the button in the Studio header). When a run is
  // blocked — the free allowance spent, every route refused — do the clean
  // slate automatically before giving up: wipe the traces, forget the bench and
  // the router's records, and step to the next address, so pressing Generate
  // again starts from somewhere new instead of inheriting the last refusal.
  // It never deletes the saved library. The button run by hand can.
  autoReset: true,
  // Which routes an explicit run may be sent to. `strict` (default) never
  // submits explicit content to a model whose checker would see it — only to
  // the uncensored builds, a Space's own disabled switch, a paid vendor that
  // permits it, your own server and this device. `widen` tries every enabled
  // model, which is more routes but means each refusal is a submission. See
  // src/router.js.
  nsfwRouting: "strict",
  // Never publish content to a *public URL*. This is what keeps MuAPI (whose
  // API rejects data: URLs, so the reference frame has to be published first)
  // out of a run. See src/vault.js.
  leakGuard: true,
  // Nothing leaves this device at all: only your own GPU server and the
  // on-device renderer are reachable, and any step that would hand your picture
  // to a third party (the free inpainting that makes a photo explicit) is
  // refused with an explanation instead. The strongest setting there is; off by
  // default because it also gives up the free pool.
  localOnly: false,
  communityOptIn: false,
  communityShare: 25,
  // Keep the library encrypted at rest under a key generated on this device.
  // Add a passphrase (Settings → Privacy) to make it a real lock rather than
  // scrambling. See src/vault.js for the honest limits.
  vault: true,
};

let kvRef = null;
function kv() {
  kvRef = kvRef || (typeof root !== "undefined" ? root.kv : null);
  return kvRef;
}

let cache = null;

export async function loadSettings() {
  if (cache) return cache;
  let stored = {};
  try {
    stored = (await kv().avg_settings.get(SETTINGS_KEY)) || {};
  } catch {
    stored = {};
  }
  cache = { ...DEFAULT_SETTINGS, ...stored };
  // Nested objects are replaced wholesale by the spread above, so a stored
  // generator entry from an older build (or one missing a field) is patched up
  // against the defaults rather than trusted as-is.
  cache.genStandard = { ...DEFAULT_SETTINGS.genStandard, ...(stored.genStandard || cache.genStandard) };
  cache.genNsfw = { ...DEFAULT_SETTINGS.genNsfw, ...(stored.genNsfw || cache.genNsfw) };
  try {
    if (localStorage.getItem("amt_safe") === "1") {
      cache.computeMode = "offline";
      cache.poolEnabled = false;
      cache.offlineFallback = true;
    }
  } catch {}
  return cache;
}

export function settingsSync() {
  return cache || { ...DEFAULT_SETTINGS };
}

export async function saveSettings(patch) {
  cache = { ...(cache || DEFAULT_SETTINGS), ...patch };
  try {
    await kv().avg_settings.set(SETTINGS_KEY, cache);
  } catch {}
  return cache;
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function localPower() {
  let cores = 4;
  try { cores = navigator.hardwareConcurrency || 4; } catch {}
  let memGb = 0;
  try { memGb = navigator.deviceMemory || 0; } catch {}
  let webgl = false;
  try { webgl = !!document.createElement("canvas").getContext("webgl"); } catch {}
  return { cores, memGb, webgl };
}

export function poolStatus(settings) {
  const optedIn = settings?.communityOptIn === true;
  const p = localPower();
  const share = Math.max(5, Math.min(100, Number(settings?.communityShare) || 25));
  if (!optedIn) return { optedIn: false, devices: 0, needed: 5, text: "Own pool: off (opt in from Settings to contribute this device)." };
  const text = "Own pool: on · 1 device online (this one) · " + p.cores + " CPU cores · " + (p.webgl ? "WebGL yes" : "WebGL no") + " · share " + share + "% · small tasks run here, larger models need 5+ devices";
  return { optedIn: true, devices: 1, needed: 5, cores: p.cores, memGb: p.memGb, webgl: p.webgl, share, text };
}

export function poolDecide(settings, task) {
  const st = poolStatus(settings);
  if (!st.optedIn) return { ok: false, code: "off", reason: "Own pool is off — turn on Own pool (opt-in) in Settings → Where the rendering happens to count this device in.", status: st };
  if (task === "large") return { ok: false, code: "small-pool", reason: "Own pool failed — not enough free devices online (1 online, need 5+ for larger models). Small tasks still run on this device; larger models need your GPU server or the free pool.", status: st };
  return { ok: true, code: "local", reason: st.text, status: st };
}

export function poolFailMessage(settings) {
  const st = poolStatus(settings);
  if (!st.optedIn) return "";
  return "Own pool failed — not enough free devices online (1 online, need 5+ for larger models).";
}

/** The secret payload of a library record: the media and the words. */
const SEALED_TEXT = ["prompt", "userPrompt", "negative"];

function vaultOn() {
  return cache?.vault !== false;
}

/**
 * Scramble a library record on its way to storage. The technical facts (when,
 * how long, which model) stay readable so the library can still be listed and
 * sorted; the clip, its poster and the prompt are encrypted. Failing this must
 * never lose the clip, so any error stores the record as it was.
 */
async function sealRecord(rec) {
  if (!rec || !vaultOn() || rec.enc) return rec;
  try {
    await ensureVault();
    // A record with a clip in it must not fall through to plain storage when
    // the vault is locked — that would quietly write the file in the clear,
    // which is the exact thing this module exists to prevent. Say so instead.
    if (!(await vaultReady())) throw Object.assign(new Error("The vault is locked."), { code: "locked" });
    const out = { ...rec };
    if (out.video instanceof Blob) out.video = await encryptBlob(out.video);
    if (typeof out.poster === "string" && out.poster && !isEncrypted(out.poster)) {
      out.poster = await encryptString(out.poster);
    }
    for (const f of SEALED_TEXT) {
      if (typeof out[f] === "string" && out[f] && !isEncrypted(out[f])) out[f] = await encryptString(out[f]);
    }
    out.enc = true;
    return out;
  } catch (e) {
    if (e?.code === "locked") throw e;
    return rec;
  }
}

/**
 * Undo `sealRecord`. `media: false` skips the video (the library list only needs
 * the poster and the prompt, and decrypting megabytes per thumbnail for no
 * reason would make the list crawl).
 */
async function openRecord(rec, { media = true } = {}) {
  if (!rec || !rec.enc) return rec;
  const out = { ...rec };
  try {
    if (media && out.video instanceof Blob) out.video = await decryptBlob(out.video, rec.mime || "video/mp4");
    if (isEncrypted(out.poster)) out.poster = await decryptString(out.poster);
    for (const f of SEALED_TEXT) if (isEncrypted(out[f])) out[f] = await decryptString(out[f]);
    out.decrypted = true;
  } catch {
    // A locked vault (or a record from another key) is not corruption — say so
    // rather than showing a blank card.
    out.locked = true;
    delete out.video;
    if (isEncrypted(out.poster)) out.poster = "";
  }
  return out;
}

export async function addHistory(record) {
  let sealed;
  try {
    sealed = await sealRecord(record);
  } catch (e) {
    if (e?.code === "locked") return { ok: false, locked: true };
    sealed = record;
  }
  try {
    await kv()[HISTORY_FOLDER].set(record.id, sealed);
    const kind = record.kind || "";
    const isImageTake = kind === "image-take";
    const isImageFinal = kind === "image";
    const isTake = kind === "take" || isImageTake;
    const isVoice = kind === "voice";
    const isReader = kind === "reader";
    const isImport = kind === "import";
    const cap = isImageTake ? MAX_IMAGE_TAKES : isImageFinal ? MAX_IMAGE_FINALS : isVoice ? MAX_VOICE : isReader ? MAX_READER : isImport ? MAX_IMPORTS : isTake ? MAX_TAKES : MAX_FINALS;
    const entries = await kv()[HISTORY_FOLDER].entries();
    const sameKind = entries.filter(([, v]) => {
      const k = v?.kind || "";
      if (isImageTake) return k === "image-take";
      if (isImageFinal) return k === "image";
      if (isVoice) return k === "voice";
      if (isReader) return k === "reader";
      if (isImport) return k === "import";
      return (k === "take") === isTake;
    });
    if (sameKind.length > cap) {
      const sorted = sameKind.sort((a, b) => (a[1]?.ts || 0) - (b[1]?.ts || 0));
      for (const [k] of sorted.slice(0, sameKind.length - cap)) {
        await kv()[HISTORY_FOLDER].delete(k);
      }
    }
    return { ok: true, encrypted: !!sealed.enc };
  } catch {
    return { ok: false };
  }
}

export async function listHistory() {
  try {
    const entries = await kv()[HISTORY_FOLDER].entries();
    const rows = entries
      .map(([k, v]) => ({ key: k, ...v }))
      .filter((r) => r && r.ts)
      .sort((a, b) => b.ts - a.ts);
    return await Promise.all(rows.map((r) => openRecord(r, { media: false })));
  } catch {
    return [];
  }
}

export async function getHistory(key) {
  try {
    return await openRecord(await kv()[HISTORY_FOLDER].get(key));
  } catch {
    return null;
  }
}

export async function updateHistory(key, patch) {
  try {
    const cur = await kv()[HISTORY_FOLDER].get(key);
    if (!cur) return null;
    const sealed = cur.enc ? await sealRecord({ ...patch }) : patch;
    const next = { ...cur, ...sealed };
    await kv()[HISTORY_FOLDER].set(key, next);
    return next;
  } catch {
    return null;
  }
}

export async function deleteHistory(key) {
  try {
    await kv()[HISTORY_FOLDER].delete(key);
  } catch {}
}

export async function clearHistory() {
  try {
    const keys = await kv()[HISTORY_FOLDER].keys();
    if (keys.length) await kv()[HISTORY_FOLDER].deleteMany(keys);
    return keys.length;
  } catch {
    return 0;
  }
}

/**
 * Seal the library records that predate the vault. Turning encryption on only
 * protected *new* clips, so anything saved before it stayed a plain file in
 * IndexedDB — which is not what "the library is encrypted" should mean. This
 * walks the folder once and encrypts whatever is not yet sealed. It is a no-op
 * while the vault is locked, and it never rewrites a record it could not seal.
 * Returns how many it converted, for the one log line at startup.
 */
export async function sealLegacyHistory() {
  if (!vaultOn()) return { sealed: 0, failed: 0 };
  try {
    await ensureVault();
    if (!(await vaultReady())) return { sealed: 0, failed: 0, locked: true };
    const entries = await kv()[HISTORY_FOLDER].entries();
    let sealed = 0;
    let failed = 0;
    for (const [k, v] of entries) {
      if (!v || v.enc) continue;
      try {
        const next = await sealRecord(v);
        if (next?.enc) {
          await kv()[HISTORY_FOLDER].set(k, next);
          sealed += 1;
        } else failed += 1;
      } catch {
        failed += 1;
      }
    }
    return { sealed, failed };
  } catch {
    return { sealed: 0, failed: 0 };
  }
}

export async function markCooldown(providerId, seconds, reason) {
  try {
    await kv()[COOLDOWN_FOLDER].set(providerId, { until: Date.now() + seconds * 1000, reason });
  } catch {}
}

/**
 * Forget every bench. Returns how many records there were, so a "reset" button
 * can report something real instead of claiming success unconditionally.
 */
export async function clearCooldowns() {
  try {
    const keys = await kv()[COOLDOWN_FOLDER].keys();
    if (keys.length) await kv()[COOLDOWN_FOLDER].deleteMany(keys);
    return keys.length;
  } catch {
    return 0;
  }
}

export async function getCooldowns() {
  try {
    const entries = await kv()[COOLDOWN_FOLDER].entries();
    const now = Date.now();
    const out = {};
    for (const [k, v] of entries) {
      if (v && v.until > now) out[k] = v;
      else await kv()[COOLDOWN_FOLDER].delete(k);
    }
    return out;
  } catch {
    return {};
  }
}
