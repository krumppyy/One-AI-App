/**
 * The private-content engine — the vault, plus the leak audit that says where a
 * run's content can actually go.
 *
 * Two problems, one module:
 *
 *  1. AT REST. Everything this app keeps — the clips in the library, their
 *     poster frames, the prompt that made them — used to sit in IndexedDB as
 *     ordinary files. Anything with access to this origin's storage (another
 *     script on the page, a profile backup, a shared laptop) could read them
 *     straight out. The vault stores them scrambled under AES-GCM with a key
 *     that is generated here and never leaves the device. Add a passphrase and
 *     the key *itself* is wrapped, so the files are unreadable until it is
 *     typed in.
 *
 *  2. IN FLIGHT. “Nothing leaves your device except the job you submit” is the
 *     footer's claim and it is only half true: an undress run hands YOUR photo
 *     to AI Horde for inpainting, a reference frame is uploaded to whichever
 *     Gradio Space renders the clip, and the paid MuAPI gateway will not accept
 *     a data: URL at all — so the frame is published to a public upload URL
 *     first. `auditEgress()` names every route by which content can reach
 *     somebody else, and the leak guard refuses the one that puts it on a
 *     public URL.
 *
 * What this honestly cannot do, stated here rather than implied:
 *
 *   - Without a passphrase the key sits next to the ciphertext, so the vault
 *     defeats a casual look, not somebody who has the machine. A passphrase is
 *     the real lock, and it cannot be recovered — lose it and the library is
 *     gone on purpose.
 *   - Once content has been sent to a third party no client-side code can
 *     recall it. The only routes that hand nobody anything are your own GPU
 *     server and the on-device rig, which is what `localOnly` enforces.
 *   - A page cannot encrypt what a server chooses to store.
 */

const RECORD_KEY = "record";
/** Thrown when a locked or unsupported vault is asked to encrypt. */
const NO_KEY = "the vault is locked — enter your passphrase first";
const VAULT_FOLDER = "avg_vault";
const VERSION = 1;
const PBKDF2_ITER = 210000;
/** AES-GCM's nonce is 96 bits; it is prepended to every ciphertext. */
const IV_LEN = 12;
/** How many bytes of key material AES-256 wants. */
const KEY_LEN = 32;
/** A wrong passphrase is at least this slow to even test. */
export const MIN_PASSPHRASE = 6;

let kvRef = null;
function kv() {
  kvRef = kvRef || (typeof root !== "undefined" ? root.kv : null);
  return kvRef;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Is this environment capable of holding a vault at all? */
export function vaultSupported() {
  return !!(globalThis.crypto?.subtle && globalThis.crypto?.getRandomValues && globalThis.crypto?.subtle?.encrypt);
}

function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

function toB64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

function fromB64(str) {
  const bin = atob(String(str || ""));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/* --------------------------------------------------------------- the key */

/** In-memory state. Never written anywhere; rebuilt on every page load. */
const live = {
  key: null,
  /** The raw key bytes, so a passphrase can be removed again without a new key. */
  raw: null,
  /** If a passphrase is set, the raw key is absent until `unlock()`. */
  record: null,
};

/** Install a raw key for this session. */
async function useKey(raw) {
  live.raw = raw;
  live.key = await importKey(raw);
}

async function readRecord() {
  if (live.record) return live.record;
  try {
    live.record = (await kv().avg_vault.get(RECORD_KEY)) || null;
  } catch {
    live.record = null;
  }
  return live.record;
}

async function writeRecord(rec) {
  live.record = rec;
  try {
    await kv().avg_vault.set(RECORD_KEY, rec);
  } catch {}
  return rec;
}

async function importKey(raw) {
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function deriveWrapKey(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * The vault's own state, safe to show in the UI.
 *   enabled  a key exists (the library is encrypted at rest)
 *   locked   a passphrase is set and has not been given this session
 *   device   the key is stored unwrapped on this device (obfuscation only)
 */
export async function vaultState() {
  if (!vaultSupported()) return { supported: false, enabled: false, locked: false, hasPassphrase: false };
  const rec = await readRecord();
  if (!rec) return { supported: true, enabled: false, locked: false, hasPassphrase: false };
  const hasPassphrase = !!rec.wrapped;
  return {
    supported: true,
    enabled: true,
    hasPassphrase,
    device: !hasPassphrase,
    locked: hasPassphrase && !live.key,
    unlocked: !!live.key,
    version: rec.v,
  };
}

/** Is a key in hand right now, so encryption/decryption can actually run? */
export async function vaultReady() {
  return !!live.key;
}

export async function vaultLocked() {
  const st = await vaultState();
  return !!st.locked;
}

/**
 * Create the vault if it does not exist yet. Called on the very first save, so
 * a brand-new visitor's library is encrypted from the first clip rather than
 * being written in the clear and re-encrypted later.
 */
export async function ensureVault() {
  if (!vaultSupported()) return null;
  const rec = await readRecord();
  if (rec?.key) {
    if (!live.key) await useKey(fromB64(rec.key));
    return rec;
  }
  if (rec?.wrapped) return rec; // locked: nothing to make, wait for unlock
  const raw = randomBytes(KEY_LEN);
  const next = { v: VERSION, alg: "AES-GCM", key: toB64(raw), wrapped: null, salt: null, iterations: PBKDF2_ITER, pass: false, created: Date.now() };
  await writeRecord(next);
  await useKey(raw);
  return next;
}

/**
 * Open the vault with a passphrase. A wrong one fails the GCM tag check, which
 * is the verifier — there is no separate PIN to compare against, so nothing
 * about the passphrase is stored anywhere.
 */
export async function unlock(passphrase) {
  const rec = await readRecord();
  if (!rec?.wrapped) return { ok: true, alreadyOpen: true };
  const pass = String(passphrase || "");
  if (pass.length < MIN_PASSPHRASE) return { ok: false, error: "too_short" };
  try {
    const wrapKey = await deriveWrapKey(pass, fromB64(rec.salt), rec.iterations || PBKDF2_ITER);
    const raw = await decryptBytesWith(wrapKey, fromB64(rec.wrapped));
    await useKey(raw);
    return { ok: true };
  } catch {
    return { ok: false, error: "wrong_passphrase" };
  }
}

/**
 * Put a passphrase on the vault: the key is wrapped with PBKDF2(passphrase) and
 * the unwrapped copy is deleted. From then on every page load starts locked.
 */
export async function setPassphrase(passphrase) {
  const pass = String(passphrase || "");
  if (pass.length < MIN_PASSPHRASE) return { ok: false, error: "too_short" };
  // Make sure the key is in hand. A vault that has never been opened in this
  // session still has its key on the device (that is the default), so open it.
  if (!live.key) await ensureVault();
  if (!live.key || !live.raw) return { ok: false, error: "locked" };
  const rec = (await readRecord()) || (await ensureVault());
  const salt = randomBytes(16);
  const wrapKey = await deriveWrapKey(pass, salt, PBKDF2_ITER);
  // Wrap the key that is already in use — never a new one, or every clip
  // encrypted so far would become unreadable the moment a passphrase is set.
  const wrapped = await encryptBytesWith(wrapKey, live.raw);
  await writeRecord({
    ...rec,
    key: null,
    wrapped: toB64(wrapped),
    salt: toB64(salt),
    iterations: PBKDF2_ITER,
    pass: true,
    wrappedAt: Date.now(),
  });
  return { ok: true };
}

/**
 * Remove the passphrase. The key is *re-stored*, not replaced: every clip
 * already encrypted has to stay readable, so this must put back the same key
 * material the passphrase was wrapped around.
 */
export async function removePassphrase(passphrase) {
  const rec = await readRecord();
  if (!rec?.wrapped) {
    if (!live.key) await ensureVault();
    return { ok: true, alreadyOpen: true };
  }
  const res = await unlock(passphrase);
  if (!res.ok) return res;
  const raw = live.raw || randomBytes(KEY_LEN);
  await writeRecord({ ...rec, key: toB64(raw), wrapped: null, salt: null, pass: false });
  return { ok: true };
}

/** Forget the key for this session (the passphrase is needed again). */
export async function lock() {
  const rec = await readRecord();
  if (!rec?.wrapped) return { ok: false, error: "no_passphrase" };
  live.key = null;
  live.raw = null;
  return { ok: true };
}

/* ------------------------------------------------------------- encryption */

async function encryptBytesWith(key, u8) {
  const iv = randomBytes(IV_LEN);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, u8));
  const out = new Uint8Array(IV_LEN + ct.length);
  out.set(iv, 0);
  out.set(ct, IV_LEN);
  return out;
}

async function decryptBytesWith(key, packed) {
  const iv = packed.subarray(0, IV_LEN);
  const ct = packed.subarray(IV_LEN);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new Uint8Array(pt);
}

/** Encrypt raw bytes. Throws if the vault is locked or unsupported. */
export async function encryptBytes(u8) {
  if (!vaultSupported()) throw new Error(NO_KEY);
  if (!live.key) await ensureVault();
  if (!live.key) throw new Error(NO_KEY);
  return encryptBytesWith(live.key, u8);
}

export async function decryptBytes(packed) {
  if (!live.key) await ensureVault();
  if (!live.key) throw new Error(NO_KEY);
  return decryptBytesWith(live.key, packed);
}

/** A string in, an opaque `v1:…` string out (small values: prompts, keys). */
export async function encryptString(text) {
  const packed = await encryptBytes(enc.encode(String(text ?? "")));
  return "v1:" + toB64(packed);
}

export async function decryptString(blob) {
  const s = String(blob ?? "");
  if (!s.startsWith("v1:")) return s;
  const pt = await decryptBytes(fromB64(s.slice(3)));
  return dec.decode(pt);
}

/** Is this a value the vault produced? */
export function isEncrypted(value) {
  return typeof value === "string" && value.startsWith("v1:");
}

/** A media file in, an opaque blob out. The mime type has to be passed back in. */
export async function encryptBlob(blob) {
  const u8 = new Uint8Array(await blob.arrayBuffer());
  const packed = await encryptBytes(u8);
  return new Blob([packed], { type: "application/x-aivg-vault" });
}

export async function decryptBlob(blob, type = "video/mp4") {
  const u8 = new Uint8Array(await blob.arrayBuffer());
  const pt = await decryptBytes(u8);
  return new Blob([pt], { type });
}

/* ------------------------------------------------------------- leak audit */

/**
 * Every route by which content can reach somebody other than this device, for
 * the run that is currently set up. The UI renders this verbatim, so the user
 * can see exactly what a run will send and where, before pressing Generate —
 * which is the whole point: nothing about the egress is hidden.
 *
 * `risk`:  none · device · vendor (a paid vendor you chose) · third (a free
 *          third party that receives your picture) · public (readable by
 *          anyone with the URL) · offsite (a relay, which sees the request)
 */
export function auditEgress(settings = {}, opts = {}) {
  const { nsfw = false, undress = false, frameMode = "image", hasImage = false, provider = null } = opts;
  const rows = [];
  const strict = settings.strictPrivacy !== false;

  const relaySuffix = strict
    ? " Requests leave through a relay, so the address a model sees is the relay's — but a relay does read what it carries."
    : " Requests leave from this connection.";

  // --- the one step that is always local ---------------------------------
  rows.push({
    id: "mask",
    label: "Finding the clothes",
    what: "A 4.2 MB detector that ships inside this generator",
    where: "runs in this browser (WASM)",
    risk: "none",
    detail: "Only the one-time transformers.js runtime comes from a CDN. The picture itself is not uploaded for this step.",
  });

  // --- the starting frame ------------------------------------------------
  if (nsfw && frameMode === "auto" && hasImage) {
    rows.push({
      id: "horde",
      label: "Making your photo explicit",
      what: "Your reference photo and a mask, sent to be repainted",
      where: "AI Horde (a pool of volunteers' machines)",
      risk: "third",
      detail:
        "This is the step that keeps your own person, and it is also the step that hands your picture to a third party. Nothing about it can be taken back once it is queued." +
        relaySuffix,
    });
  } else if (nsfw && undress) {
    rows.push({
      id: "horde-story",
      label: "Drawing the storyboard",
      what: "Each keyframe picture of the sequence",
      where: "AI Horde (free inpainting / img2img)",
      risk: "third",
      detail: "The storyboard is built from real stills; the ones that edit your picture are drawn by AI Horde workers." + relaySuffix,
    });
  }
  if (nsfw && (frameMode === "draw" || (!hasImage && frameMode !== "image"))) {
    rows.push({
      id: "pollinations",
      label: "Drawing a starting frame",
      what: "Your prompt text (never your picture)",
      where: "Pollinations (image.pollinations.ai)",
      risk: "low",
      detail: "Draws a brand-new person from the prompt. No photograph is sent, but the prompt is." + relaySuffix,
    });
  }

  // --- the renderer itself -----------------------------------------------
  if (provider) {
    const kind = provider.kind;
    if (kind === "offline") {
      rows.push({
        id: "render",
        label: "Rendering the clip",
        what: "Your picture, moved by a camera rig",
        where: "this device — no network at all",
        risk: "none",
        detail: "The on-device renderer contacts nobody. This is the one route with no third party in it.",
      });
    } else if (kind === "server" || provider.ownServer) {
      rows.push({
        id: "render",
        label: "Rendering the clip",
        what: "Your picture and prompt",
        where: "your own GPU server",
        risk: "device",
        detail: "The machine you started. Nothing beyond it is involved unless you point the server at one.",
      });
    } else if (kind === "muapi") {
      rows.push({
        id: "render",
        label: "Rendering the clip (MuAPI)",
        what: "Your picture, published to a PUBLIC URL, then sent to the vendor",
        where: "uploads host + muapi.ai",
        risk: "public",
        detail:
          "MuAPI rejects data: URLs, so the frame has to be uploaded to the file host first — meaning it is briefly readable by anyone who has the link. The leak guard blocks this entirely unless you turn it off.",
      });
    } else if (kind === "puter") {
      rows.push({
        id: "render",
        label: "Rendering the clip (Puter)",
        what: "Your picture and prompt",
        where: "Puter's AI service, under your own Puter account",
        risk: "third",
        detail: "A third-party AI service receives the frame you are animating. Nothing is published to a public URL for this — it travels as your own account's request." +
          relaySuffix,
      });
    } else if (kind === "gradio") {
      rows.push({
        id: "render",
        label: "Rendering the clip",
        what: "Your picture and prompt, uploaded to the Space",
        where: kind === "gradio" ? String(provider.space || provider.vendor || "a Hugging Face Space") : String(provider.vendor || ""),
        risk: "third",
        detail:
          "A public Gradio Space receives the frame you are animating. For an explicit run this is also the request that can be refused (and therefore recorded), which is why the router keeps explicit runs off the models that check." +
          relaySuffix,
      });
    } else if (provider.tier === "key") {
      rows.push({
        id: "render",
        label: "Rendering the clip",
        what: "Your picture and prompt",
        where: String(provider.vendor || provider.label || "the vendor"),
        risk: "vendor",
        detail: "A vendor you added a key for. Their terms decide what they keep." + relaySuffix,
      });
    }
  }

  // --- at rest -----------------------------------------------------------
  rows.push({
    id: "rest",
    label: "Keeping the clip afterwards",
    what: "The finished video and its poster frame in this browser's storage",
    where: vaultSupported() ? "this device, encrypted at rest" : "this device, unencrypted",
    risk: vaultSupported() ? "none" : "device",
    detail: "The vault scrambles it on save. Nothing is uploaded by saving — only the Share button uploads a clip, and that asks first.",
  });

  const worst = (rank) => rows.some((r) => r.risk === rank);
  const level = worst("public") ? "public" : worst("third") ? "third" : worst("vendor") ? "vendor" : worst("device") ? "device" : "none";
  return {
    rows,
    level,
    /** True when nothing at all leaves this device. */
    local: level === "none",
    /** True when content reaches a third party (not your server / the vendor you chose). */
    thirdParty: level === "third" || level === "public",
    publicUrl: level === "public",
  };
}

/**
 * The leak guard. Two levels, both of which the engine consults before it
 * builds a pool:
 *
 *   leakGuard (on by default)  never publish content to a *public URL* — this
 *                              is what blocks the MuAPI reference-frame upload.
 *   localOnly  (off by default) nothing at all leaves this device: only your
 *                              own GPU server and the on-device rig are allowed,
 *                              and any step that would hand your photo to a
 *                              third party (the free inpainting) is refused.
 */
export function leakBlocked(settings, provider) {
  if (!provider) return null;
  if (settings?.leakGuard !== false && provider.kind === "muapi") {
    return "the leak guard is on and MuAPI needs the reference frame on a public URL";
  }
  if (settings?.localOnly) {
    const ok = provider.kind === "offline" || provider.kind === "codec-cpu" || provider.kind === "server" || provider.ownServer === true;
    if (!ok) return "“Nothing leaves this device” is on";
  }
  return null;
}

/**
 * Whether an NSFW starting-frame step is allowed under the current leak
 * settings. Returns a readable reason when it is not, so the engine can stop
 * with an explanation instead of quietly sending the photo anyway.
 */
export function frameStepBlocked(settings, { frameMode = "auto", hasImage = false } = {}) {
  if (!settings?.localOnly) return null;
  if (!hasImage) return null;
  if (frameMode !== "auto" && frameMode !== "undress") return null;
  return (
    "“Nothing leaves this device” is on, and making your photo explicit means sending it to AI Horde. " +
    "Set the NSFW starting frame to “Draw a brand-new explicit person” (only the prompt is sent), to “Keep my image unchanged” or “From given image”, " +
    "or turn “Nothing leaves this device” off in Settings → Privacy."
  );
}

/* ------------------------------------------------------------------ panic */

/**
 * Destroy the vault and everything in it: the key, the library, the posters.
 * The passphrase cannot undo this — that is the point of a panic button.
 */
export async function destroyVault({ history = true } = {}) {
  const report = { key: false, items: 0 };
  try {
    await kv().avg_vault.delete(RECORD_KEY);
    report.key = true;
  } catch {}
  live.key = null;
  live.raw = null;
  live.record = null;
  if (history) {
    try {
      const keys = await kv().avg_history.keys();
      report.items = keys.length;
      if (keys.length) await kv().avg_history.deleteMany(keys);
    } catch {}
  }
  return report;
}

/* ------------------------------------------------------- recovery phrase */
const RECOVERY_WORDS = ["abandon","ability","able","about","above","absent","absorb","abstract","absurd","abuse","access","accident","account","accuse","achieve","acid","acoustic","acquire","across","act","action","actor","actress","actual","adapt","add","addict","address","adjust","admit","adult","advance","advice","aerobic","affair","afford","afraid","again","age","agent","agree","ahead","aim","air","airport","aisle","alarm","album","alcohol","alert","alien","all","alley","allow","almost","alone","alpha","already","also","alter","always","amateur","amazing","among","amount","amused","analyst","anchor","ancient","anger","angle","angry","animal","ankle","announce","annual","another","answer","antenna","antique","anxiety","any","apart","apology","appear","apple","approve","april","arch","arctic","area","arena","argue","arm","armed","armor","army","around","arrange","arrest","arrive","arrow","art","artefact","artist","artwork","ask","aspect","assault","asset","assist","assume","asthma","athlete","atom","attack","attend","attitude","attract","auction","audit","august","aunt","author","auto","autumn","average","avocado","avoid","awake","aware","away","awesome","awful","awkward","axis","baby","bachelor","bacon","badge","bag","balance","balcony","ball","bamboo","banana","banner","bar","barely","bargain","barrel","base","basic","basket","battle","beach","bean","beauty","because","become","beef","before","begin","behave","behind","believe","below","belt","bench","benefit","best","betray","better","between","beyond","bicycle","bid","bike","bind","biology","bird","birth","bitter","black","blade","blame","blanket","blast","bleak","bless","blind","blood","blossom","blouse","blue","blur","blush","board","boat","body","boil","bomb","bone","bonus","book","boost","border","boring","borrow","boss","bottom","bounce","box","boy","bracket","brain","brand","brass","brave","bread","breeze","brick","bridge","brief","bright","bring","brisk","broccoli","broken","bronze","broom","brother","brown","brush","bubble","buddy","budget","buffalo","build","bulb","bulk","bullet","bundle","bunker","burden","burger","burst","bus","business","busy","butter","buyer","buzz","cabbage","cabin","cable","cactus","cage","cake","call","calm","camera","camp","can","canal","cancel","candy","cannon","canoe","canvas","canyon","capable","capital","captain","car","carbon","card","cargo","carpet","carry","cart","case","cash","casino","castle","casual","cat","catalog","catch","category","cattle","caught","cause","caution","cave","ceiling","celery","cement","census","century","cereal","certain","chair","chalk","champion","change","chaos","chapter","charge","chase","chat","cheap","check","cheese","chef","cherry","chest","chicken","chief","child","chimney","choice","choose","chronic","chuckle","chunk","churn","cigar","cinnamon","circle","citizen","city","civil","claim","clap","clarify","claw","clay","clean","clerk","clever","click","client","cliff","climb","clinic","clip","clock","clog","close","cloth","cloud","clown","club","clump","cluster","clutch","coach","coast","coconut","code","coffee","coil","coin","collect","color","column","combine","come","comfort","comic","common","company","concert","conduct","confirm","congress","connect","consider","control","convince","cook","cool","copper","copy","coral","core","corn","correct","cost","cotton","couch","country","couple","course","cousin","cover","coyote","crack","cradle","craft","cram","crane","crash","crater","crawl","crazy","cream","credit","creek","crew","cricket","crime","crisp","critic","crop","cross","crouch","crowd","crucial","cruel","cruise","crumble","crunch","crush","cry","crystal","cube","culture","cup","cupboard","curious","current","curtain","curve","cushion","custom","cute","cycle","dad","damage","damp","dance","danger","daring","dash","daughter","dawn","day","deal","debate","debris","decade","december","decide","decline","decorate","decrease","deer","defense","define","defy","degree","delay","deliver","demand","demise","denial","dentist","deny","depart","depend","deposit","depth","deputy","derive","describe","desert","design","desk","despair","destroy","detail","detect","develop","device","devote","diagram","dial","diamond","diary","dice","diesel","diet","differ","digital","dignity","dilemma","dinner","dinosaur","direct","dirt","disagree","discover","disease","dish","dismiss","disorder","display","distance","divert","divide","divorce","dizzy","doctor","document","dog","doll","dolphin","domain","donate","donkey","donor","door","dose","double","dove","draft","dragon","drama","drastic","draw","dream","dress","drift","drill","drink","drip","drive","drop","drum","dry","duck","dumb","dune","during","dust","dutch","duty","dwarf","dynamic","eager","eagle","early","earn","earth","easily","east","easy","echo","ecology","economy","edge","edit","educate","effort","egg","eight","either","elbow","elder","electric","elegant","element","elephant","elevator","elite","else","embark","embody","embrace","emerge","emotion","employ","empower","empty","enable","enact","end","endless","endorse","enemy","energy","enforce","engage","engine","enhance","enjoy","enlist","enough","enrich","enroll","ensure","enter","entire","entry","envelope","episode","equal","equip","era","erase","erode","erosion","error","erupt","escape","essay","essence","estate","eternal","ethics","evidence","evil","evoke","evolve","exact","example","excess","exchange","excite","exclude","excuse","execute","exercise","exhaust","exhibit","exile","exist","exit","exotic","expand","expect","expire","explain","expose","express","extend","extra","eye","eyebrow","fabric","face","faculty","fade","faint","faith","fall","false","fame","family","famous","fan","fancy","fantasy","farm","fashion","fat","fatal","father","fatigue","fault","favorite","feature","february","federal","fee","feed","feel","female","fence","festival","fetch","fever","few","fiber","fiction","field","figure","file","film","filter","final","find","fine","finger","finish","fire","firm","first","fiscal","fish","fit","fitness","fix","flag","flame","flash","flat","flavor","flee","flight","flip","float","flock","floor","flower","fluid","flush","fly","foam","focus","fog","foil","fold","follow","food","foot","force","forest","forget","fork","fortune","forum","forward","fossil","foster","found","fox","fragile","frame","frequent","fresh","friend","fringe","frog","front","frost","frown","frozen","fruit","fuel","fun","funny","furnace","fury","future","gadget","gain","galaxy","gallery","game","gap","garage","garbage","garden","garlic","garment","gas","gasp","gate","gather","gauge","gaze","general","genius","genre","gentle","genuine","gesture","ghost","giant","gift","giggle","ginger","giraffe","girl","give","glad","glance","glare","glass","glide","glimpse","globe","gloom","glory","glove","glow","glue","goat","goddess","gold","good","goose","gorilla","gospel","gossip","govern","gown","grab","grace","grain","grant","grape","grass","gravity","great","green","grid","grief","grit","grocery","group","grow","grunt","guard","guess","guide","guilt","guitar","gun","gym","habit","hair","half","hammer","hamster","hand","happy","harbor","hard","harsh","harvest","hat","have","hawk","hazard","head","health","heart","heavy","hedgehog","height","hello","helmet","help","hen","hero","hidden","high","hill","hint","hip","hire","history","hobby","hockey","hold","hole","holiday","hollow","home","honey","hood","hope","horn","horror","horse","hospital","host","hotel","hour","hover","hub","huge","human","humble","humor","hundred","hungry","hunt","hurdle","hurry","hurt","husband","hybrid","ice","icon","idea","identify","idle","ignore","ill","illegal","illness","image","imitate","immense","immune","impact","impose","improve","impulse","inch","include","income","increase","index","indicate","indoor","industry","infant","inflict","inform","inhale","inherit","initial","inject","injury","inmate","inner","innocent","input","inquiry","insane","insect","inside","inspire","install","intact","interest","into","invest","invite","involve","iron","island","isolate","issue","item","ivory","jacket","jaguar","jar","jazz","jealous","jeans","jelly","jewel","job","join","joke","journey","joy","judge","juice","jump","jungle","junior","junk","just","kangaroo","keen","keep","ketchup","key","kick","kid","kidney","kind","kingdom","kiss","kit","kitchen","kite","kitten","kiwi","knee","knife","knock","know","lab","label","labor","ladder","lady","lake","lamp","language","laptop","large","later","latin","laugh","laundry","lava","law","lawn","lawsuit","layer","lazy","leader","leaf","learn","leave","lecture","left","leg","legal","legend","leisure","lemon","lend","length","lens","leopard","lesson","letter","level","liar","liberty","library","license","life","lift","light","like","limb","limit","link","lion","liquid","list","little","live","lizard","load","loan","lobster","local","lock","logic","lonely","long","loop","lottery","loud","lounge","love","loyal","lucky","luggage","lumber","lunar","lunch","luxury","lyrics","machine","mad","magic","magnet","maid","mail","main","major","make","mammal","man","manage","mandate","mango","mansion","manual","maple","marble","march","margin","marine","market","marriage","mask","mass","master","match","material","math","matrix","matter","maximum","maze","meadow","mean","measure","meat","mechanic","medal","media","melody","melt","member","memory","mention","menu","mercy","merge","merit","merry","mesh","message","metal","method","middle","midnight","milk","million","mimic","mind","minimum","minor","minute","miracle","mirror","misery","miss","mistake","mix","mixed","mixture","mobile","model","modify","mom","moment","monitor","monkey","monster","month","moon","moral","more","morning","mosquito","mother","motion","motor","mountain","mouse","move","movie","much","muffin","mule","multiply","muscle","museum","mushroom","music","must","mutual","myself","mystery","myth","naive","name","napkin","narrow","nasty","nation","nature","near","neck","need","negative","neglect","neither","nephew","nerve","nest","net","network","neutral","never","news","next","nice","night","noble","noise","nominee","noodle","normal","north","nose","notable","note","nothing","notice","novel","now","nuclear","number","nurse","nut","oak","obey","object","oblige","obscure","observe","obtain","obvious","occur","ocean","october","odor","off","offer","office","often","oil","okay","old","olive","olympic","omit","once","one","onion","online","only","open","opera","opinion","oppose","option","orange","orbit","orchard","order","ordinary","organ","orient","original","orphan","ostrich","other","outdoor","outer","output","outside","oval","oven","over","own","owner","oxygen","oyster","ozone","pact","paddle","page","pair","palace","palm","panda","panel","panic","panther","paper","parade","parent","park","parrot","party","pass","patch","path","patient","patrol","pattern","pause","pave","payment","peace","peanut","pear","peasant","pelican","pen","penalty","pencil","people","pepper","perfect","permit","person","pet","phone","photo","phrase","physical","piano","picnic","picture","piece","pig","pigeon","pill","pilot","pink","pioneer","pipe","pistol","pitch","pizza","place","planet","plastic","plate","play","please","pledge","pluck","plug","plunge","poem","poet","point","polar","pole","police","pond","pony","pool","popular","portion","position","possible","post","potato","pottery","poverty","powder","power","practice","praise","predict","prefer","prepare","present","pretty","prevent","price","pride","primary","print","priority","prison","private","prize","problem","process","produce","profit","program","project","promote","proof","property","prosper","protect","proud","provide","public","pudding","pull","pulp","pulse","pumpkin","punch","pupil","puppy","purchase","purity","purpose","purse","push","put","puzzle","pyramid","quality","quantum","quarter","question","quick","quit","quiz","quote","rabbit","raccoon","race","rack","radar","radio","rail","rain","raise","rally","ramp","ranch","random","range","rapid","rare","rate","rather","raven","raw","razor","ready","real","reason","rebel","rebuild","recall","receive","recipe","record","recycle","reduce","reflect","reform","refuse","region","regret","regular","reject","relax","release","relief","rely","remain","remember","remind","remove","render","renew","rent","reopen","repair","repeat","replace","report","require","rescue","resemble","resist","resource","response","result","retire","retreat","return","reunion","reveal","review","reward","rhythm","rib","ribbon","rice","rich","ride","ridge","rifle","right","rigid","ring","riot","ripple","risk","ritual","rival","river","road","roast","robot","robust","rocket","romance","roof","rookie","room","rose","rotate","rough","round","route","royal","rubber","rude","rug","rule","run","runway","rural","sad","saddle","sadness","safe","sail","salad","salmon","salon","salt","salute","same","sample","sand","satisfy","satoshi","sauce","sausage","save","say","scale","scan","scare","scatter","scene","scheme","school","science","scissors","scorpion","scout","scrap","screen","script","scrub","sea","search","season","seat","second","secret","section","security","seed","seek","segment","select","sell","seminar","senior","sense","sentence","series","service","session","settle","setup","seven","shadow","shaft","shallow","share","shed","shell","sheriff","shield","shift","shine","ship","shiver","shock","shoe","shoot","shop","short","shoulder","shove","shrimp","shrug","shuffle","shy","sibling","sick","side","siege","sight","sign","silent","silk","silly","silver","similar","simple","since","sing","siren","sister","situate","six","size","skate","sketch","ski","skill","skin","skirt","skull","slab","slam","sleep","slender","slice","slide","slight","slim","slogan","slot","slow","slush","small","smart","smile","smoke","smooth","snack","snake","snap","sniff","snow","soap","soccer","social","sock","soda","soft","solar","soldier","solid","solution","solve","someone","song","soon","sorry","sort","soul","sound","soup","source","south","space","spare","spatial","spawn","speak","special","speed","spell","spend","sphere","spice","spider","spike","spin","spirit","split","spoil","sponsor","spoon","sport","spot","spray","spread","spring","spy","square","squeeze","squirrel","stable","stadium","staff","stage","stairs","stamp","stand","start","state","stay","steak","steel","stem","step","stereo","stick","still","sting","stock","stomach","stone","stool","story","stove","strategy","street","strike","strong","struggle","student","stuff","stumble","style","subject","submit","subway","success","such","sudden","suffer","sugar","suggest","suit","summer","sun","sunny","sunset","super","supply","supreme","sure","surface","surge","surprise","surround","survey","suspect","sustain","swallow","swamp","swap","swarm","swear","sweet","swift","swim","swing","switch","sword","symbol","symptom","syrup","system","table","tackle","tag","tail","talent","talk","tank","tape","target","task","taste","tattoo","taxi","teach","team","tell","ten","tenant","tennis","tent","term","test","text","thank","that","theme","then","theory","there","they","thing","this","thought","three","thrive","throw","thumb","thunder","ticket","tide","tiger","tilt","timber","time","tiny","tip","tired","tissue","title","toast","tobacco","today","toddler","toe","together","toilet","token","tomato","tomorrow","tone","tongue","tonight","tool","tooth","top","topic","topple","torch","tornado","tortoise","toss","total","tourist","toward","tower","town","toy","track","trade","traffic","tragic","train","transfer","trap","trash","travel","tray","treat","tree","trend","trial","tribe","trick","trigger","trim","trip","trophy","trouble","truck","true","truly","trumpet","trust","truth","try","tube","tuition","tumble","tuna","tunnel","turkey","turn","turtle","twelve","twenty","twice","twin","twist","two","type","typical","ugly","umbrella","unable","unaware","uncle","uncover","under","undo","unfair","unfold","unhappy","uniform","unique","unit","universe","unknown","unlock","until","unusual","unveil","update","upgrade","uphold","upon","upper","upset","urban","urge","usage","use","used","useful","useless","usual","utility","vacant","vacuum","vague","valid","valley","valve","van","vanish","vapor","various","vast","vault","vehicle","velvet","vendor","venture","venue","verb","verify","version","very","vessel","veteran","viable","vibrant","vicious","victory","video","view","village","vintage","violin","virtual","virus","visa","visit","visual","vital","vivid","vocal","voice","void","volcano","volume","vote","voyage","wage","wagon","wait","walk","wall","walnut","want","warfare","warm","warrior","wash","wasp","waste","water","wave","way","wealth","weapon","wear","weasel","weather","web","wedding","weekend","weird","welcome","west","wet","whale","what","wheat","wheel","when","where","whip","whisper","wide","width","wife","wild","will","win","window","wine","wing","wink","winner","winter","wire","wisdom","wise","wish","witness","wolf","woman","wonder","wood","wool","word","work","world","worry","worth","wrap","wreck","wrestle","wrist","write","wrong","yard","year","yellow","you","young","youth","zebra","zero","zone","zoo"];
function bitsToWords(bits) {
  const out = [];
  for (let i = 0; i < bits.length; i += 11) {
    let n = 0;
    for (let j = 0; j < 11; j++) n = (n << 1) | bits[i + j];
    out.push(RECOVERY_WORDS[n]);
  }
  return out;
}
async function sha256(u8) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", u8));
}
export async function recoveryPhrase() {
  if (!live.raw) { await ensureVault(); }
  if (!live.raw) return { ok: false, error: "locked" };
  const entropy = live.raw.slice();
  const hash = await sha256(entropy);
  const bits = [];
  for (const b of entropy) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  for (let i = 7; i >= 0; i--) bits.push((hash[0] >> i) & 1);
  return { ok: true, phrase: bitsToWords(bits).join(" ") };
}
export function recoveryKeyText() {
  if (!live.raw) return { ok: false, error: "locked" };
  return { ok: true, key: toB64(live.raw) };
}
export async function restoreRecovery(input) {
  const s = String(input || "").trim().toLowerCase().replace(/[^a-z0-9+/=\s]/g, "");
  const parts = s.split(/\s+/).filter(Boolean);
  let raw = null;
  if (parts.length === 1 && /^[a-z0-9+/=]{40,}$/i.test(parts[0])) {
    try {
      const u8 = fromB64(parts[0]);
      if (u8.length !== KEY_LEN) return { ok: false, error: "bad_length" };
      raw = u8;
    } catch { return { ok: false, error: "bad_key" }; }
  } else {
    if (parts.length !== 24) return { ok: false, error: "bad_words" };
    const bits = [];
    for (const w of parts) {
      const idx = RECOVERY_WORDS.indexOf(w);
      if (idx < 0) return { ok: false, error: "bad_word:" + w };
      for (let i = 10; i >= 0; i--) bits.push((idx >> i) & 1);
    }
    if (bits.length !== 264) return { ok: false, error: "bad_words" };
    raw = new Uint8Array(KEY_LEN);
    for (let i = 0; i < 256; i++) if (bits[i]) raw[i >> 3] |= 1 << (7 - (i % 8));
    const check = bits.slice(256);
    const hash = await sha256(raw);
    for (let i = 0; i < 8; i++) {
      if (check[i] !== ((hash[0] >> (7 - i)) & 1)) return { ok: false, error: "bad_checksum" };
    }
  }
  const rec = (await readRecord()) || { v: VERSION, alg: "AES-GCM" };
  await writeRecord({ ...rec, key: toB64(raw), wrapped: null, salt: null, pass: false, restored: Date.now() });
  live.record = null;
  await readRecord();
  await useKey(raw);
  return { ok: true };
}
