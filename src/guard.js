const MAGIC = [
  { ext: ["png"], mime: ["image/png"], head: [0x89, 0x50, 0x4E, 0x47] },
  { ext: ["jpg", "jpeg"], mime: ["image/jpeg"], head: [0xFF, 0xD8, 0xFF] },
  { ext: ["gif"], mime: ["image/gif"], head: [0x47, 0x49, 0x46, 0x38] },
  { ext: ["webp"], mime: ["image/webp"], head: [0x52, 0x49, 0x46, 0x46] },
  { ext: ["bmp"], mime: ["image/bmp"], head: [0x42, 0x4D] },
  { ext: ["mp4", "m4v", "mov"], mime: ["video/mp4", "video/quicktime"], head: [null, null, null, null, 0x66, 0x74, 0x79, 0x70] },
  { ext: ["webm", "mkv"], mime: ["video/webm", "video/x-matroska"], head: [0x1A, 0x45, 0xDF, 0xA3] },
  { ext: ["mp3"], mime: ["audio/mpeg"], head: [0x49, 0x44, 0x33] },
  { ext: ["wav"], mime: ["audio/wav", "audio/x-wav"], head: [0x52, 0x49, 0x46, 0x46] },
  { ext: ["ogg", "ogv"], mime: ["audio/ogg", "video/ogg"], head: [0x4F, 0x67, 0x67, 0x53] },
  { ext: ["pdf"], mime: ["application/pdf"], head: [0x25, 0x50, 0x44, 0x46] },
];

const NEVER = ["html", "htm", "svg", "xml", "js", "exe", "bat", "cmd", "msi", "scr", "com", "ps1", "sh", "jar", "apk"];

export async function scanFile(file, opts = {}) {
  const name = String(file?.name || "file");
  const ext = (name.split(".").pop() || "").toLowerCase().slice(0, 8);
  const maxMb = opts.maxMb || 100;
  if (!file || typeof file.size !== "number") return { ok: false, reason: "That file could not be read." };
  if (file.size <= 0) return { ok: false, reason: name + " is empty (0 bytes)." };
  if (file.size > maxMb * 1024 * 1024) return { ok: false, reason: name + " is over " + maxMb + " MB - try a smaller file." };
  if (NEVER.includes(ext)) return { ok: false, reason: name + " is a " + ext.toUpperCase() + " file, which this app never accepts (it can hide programs inside)." };
  const rule = MAGIC.find((r) => r.ext.includes(ext));
  if (!rule) return { ok: true, reason: "" };
  if (file.type && rule.mime.length && !rule.mime.includes(file.type) && !file.type.startsWith("application/octet-stream")) {
    return { ok: false, reason: name + " says it is ." + ext + " but arrived as " + file.type + " - renamed files are rejected." };
  }
  let head = new Uint8Array(0);
  try { head = new Uint8Array(await file.slice(0, 12).arrayBuffer()); } catch {}
  if (head.length >= 8) {
    const match = rule.head.every((b, i) => b == null || head[i] === b);
    if (!match) return { ok: false, reason: name + " does not look like a real ." + ext + " file inside - it may be renamed or damaged." };
  }
  return { ok: true, reason: "" };
}
