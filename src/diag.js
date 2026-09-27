const RING = [];
const MAX = 200;

export function maskIp(ip) {
  const s = String(ip || "");
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) return `${m[1]}.${m[2]}.x.x`;
  if (s.includes(":")) {
    const parts = s.split(":");
    return parts.slice(0, 2).join(":") + ":xxxx::xxxx";
  }
  return s ? "***" : "—";
}

export function maskUrl(url) {
  try {
    const u = new URL(String(url));
    return `${u.protocol}//${u.host}${u.pathname || "/"}`;
  } catch {
    return String(url || "").split("?")[0].slice(0, 80);
  }
}

export function diag(kind, msg, data) {
  const rec = { t: new Date().toISOString(), kind: String(kind || "info"), msg: String(msg || ""), data: data || null };
  RING.push(rec);
  if (RING.length > MAX) RING.splice(0, RING.length - MAX);
  try {
    if (data !== undefined) console.debug("[diag:" + rec.kind + "]", rec.msg, data);
    else console.debug("[diag:" + rec.kind + "]", rec.msg);
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent("app-diag", { detail: rec }));
  } catch {}
  return rec;
}

export function diagList() {
  return RING.slice();
}

export function diagClear() {
  RING.length = 0;
}

export function diagText() {
  return RING.map((r) => `${r.t} [${r.kind}] ${r.msg}`).join("\n");
}

try {
  window.__diag = { list: diagList, text: diagText, clear: diagClear, log: diag, maskIp, maskUrl };
} catch {}
