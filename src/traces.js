/**
 * Leaving nothing behind.
 *
 * A generation touches a lot of machinery — a relay, a model's Space, a few
 * megabytes of clip — and the browser quietly keeps a record of most of it: a
 * cookie the endpoint set, a cache entry, a resource-timing row with the exact
 * URL, an IndexedDB record of "this model is on cooldown". None of that helps
 * the next run, and all of it is a trace of the last one.
 *
 * This module wipes those traces. It is deliberately *targeted*:
 *
 *   wiped    cookies this origin can see (and, where supported, the Cookie
 *            Store API), localStorage, sessionStorage, every CacheStorage
 *            bucket, resource-timing/marks/measures, and the app's own
 *            quota + cooldown records.
 *   kept     the generation library and the settings (IndexedDB via kv-plugin)
 *            — wiping those would destroy the user's own work, and they are
 *            local-only, never sent anywhere.
 *
 * What it honestly cannot do: delete a cookie that a *different* origin set
 * (huggingface.co, hf.space). Those live in the browser's jar for that domain
 * and no page on this origin may touch them. That is why every request the app
 * makes sets `credentials: "omit"` — no cookie is ever sent, and (for a
 * cross-origin fetch without credentials) no `Set-Cookie` is ever stored
 * because of us in the first place.
 */

import { clearCooldowns, clearHistory } from "./store.js";
import { resetRouteStats } from "./router.js";
import { clearZeroGpuBlock } from "./gradio.js";

const COOKIE_EPOCH = "Thu, 01 Jan 1970 00:00:00 GMT";

/** Every cookie name this origin can see, from `document.cookie`. */
function cookieNames() {
  try {
    return document.cookie
      .split(";")
      .map((c) => c.split("=")[0].trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Expire every cookie visible to this origin. Each one is expired on a handful
 * of paths, because a cookie set for `/api` is invisible to a read of `/` but
 * still stored — the delete has to name the same path (and domain) it was set
 * with, which is why this loops rather than doing it once.
 */
async function wipeCookies() {
  const names = cookieNames();
  const paths = ["/", "/api", location.pathname.replace(/[^/]*$/, "") || "/"];
  for (const name of names) {
    for (const path of paths) {
      document.cookie = `${name}=; expires=${COOKIE_EPOCH}; path=${path}; SameSite=Lax`;
      document.cookie = `${name}=; expires=${COOKIE_EPOCH}; path=${path}; SameSite=None; Secure`;
    }
  }
  let storeDeleted = 0;
  try {
    if (self.cookieStore?.getAll) {
      for (const c of await self.cookieStore.getAll()) {
        try {
          await self.cookieStore.delete({ name: c.name, path: c.path, domain: c.domain });
          storeDeleted += 1;
        } catch {
          try {
            await self.cookieStore.delete(c.name);
            storeDeleted += 1;
          } catch {}
        }
      }
    }
  } catch {}
  return names.length + storeDeleted;
}

function wipeWebStorage() {
  let n = 0;
  for (const store of ["localStorage", "sessionStorage"]) {
    try {
      const s = self[store];
      n += s.length;
      s.clear();
    } catch {}
  }
  return n;
}

async function wipeCaches() {
  let n = 0;
  try {
    if (self.caches?.keys) {
      for (const key of await self.caches.keys()) {
        // Never touch a cache that the editor/preview machinery might own: while
        // a generator is unsaved, its src/ files are served through a service
        // worker, and deleting that bucket would make the user's own edits look
        // like they vanished. Those buckets are not part of a generation anyway.
        if (/perchance|preview|editor|generator|workbox/i.test(key)) continue;
        if (await self.caches.delete(key)) n += 1;
      }
    }
  } catch {}
  return n;
}

/**
 * Drop the browser's own record of which URLs this page contacted. Resource
 * timings are per-document and vanish on reload, but a run can be long and a
 * "what did this page talk to" read-out is exactly the trace we are removing.
 */
function wipeTiming() {
  let n = 0;
  try {
    n += performance.getEntriesByType?.("resource")?.length || 0;
    performance.clearResourceTimings?.();
    performance.clearMarks?.();
    performance.clearMeasures?.();
  } catch {}
  return n;
}

/**
 * Wipe every trace a run can leave, and report what was actually removed so
 * the UI can say something true rather than "done".
 *
 * `quota: false` skips the cooldown records — used when the caller wants to
 * reset the *allowance* but keep the traces, or the other way round.
 */
export async function wipeTraces({ cookies = true, storage = true, caches = true, timing = true, quota = true } = {}) {
  const report = {
    cookies: cookies ? await wipeCookies() : 0,
    storage: storage ? wipeWebStorage() : 0,
    caches: caches ? await wipeCaches() : 0,
    timing: timing ? wipeTiming() : 0,
    quota: 0,
  };
  if (quota) report.quota = await clearCooldowns();
  return report;
}

/**
 * "Reset the allowance": forget every model the app had benched and every
 * record of a spent allocation.
 *
 * The platform's own limit is per *address*, so this on its own cannot bring an
 * allowance back — but it clears the app's own five-minute bench (which is what
 * makes a second run quit before it even tries), and it is the precondition for
 * the real cure, which is leaving from a different address.
 */
export async function resetAllowance() {
  const cleared = await clearCooldowns();
  return { cleared };
}

/**
 * A human sentence about what the last wipe removed, for the log line.
 */
export function describeWipe(report) {
  const bits = wipeBits(report);
  return bits.length ? bits.join(", ") : "nothing left to wipe";
}

function wipeBits(report) {
  const bits = [];
  if (report.cookies) bits.push(`${report.cookies} cookie${report.cookies === 1 ? "" : "s"}`);
  if (report.storage) bits.push(`${report.storage} storage key${report.storage === 1 ? "" : "s"}`);
  if (report.caches) bits.push(`${report.caches} cache${report.caches === 1 ? "" : "s"}`);
  if (report.timing) bits.push(`${report.timing} timing entr${report.timing === 1 ? "y" : "ies"}`);
  if (report.quota) bits.push(`${report.quota} quota record${report.quota === 1 ? "" : "s"}`);
  return bits;
}

/**
 * The **full reset** — one button, nothing left behind.
 *
 * `wipeTraces` clears what the *browser* kept; this adds what the *app* kept
 * about this browser's history with the pool, and optionally the saved clips:
 *
 *   routes   the router's memory that a given model refused content here. It is
 *            earned, useful knowledge — but on a "start from scratch" reset it
 *            is exactly the kind of record the user is asking to forget.
 *   history  the saved clip library (opt-in: it is the user's own work, so it
 *            is only deleted when the caller explicitly says so).
 *
 * What it honestly cannot do is change the address the pool counts against:
 * cookies, caches and timings are the browser's record, not the network's. The
 * allowance is metered per *address*, so the half of "reset" that actually buys
 * a fresh allowance is leaving from a different one — a relay (built in, one
 * click) or a VPN/proxy, which the app has no control over. The Reset dialog in
 * src/app.js does both: it wipes here, then rotates to the next address.
 */
export async function fullReset({ traces = true, quota = true, history = false, forgetGpuBlock = true } = {}) {
  const report = await wipeTraces({ cookies: traces, storage: traces, caches: traces, timing: traces, quota });
  report.routes = 0;
  report.history = 0;
  try {
    report.routes = await resetRouteStats();
  } catch {}
  // And the remembered ZeroGPU refusal (`src/gradio.js`). It is not a trace, it
  // is working state — but "start from scratch" has to mean the *next* run is
  // allowed to try, or pressing Reset would leave the app refusing for the next
  // twenty minutes with no way to ask it not to. The *automatic* reset passes
  // `forgetGpuBlock: false`: it fires precisely because of that refusal, and
  // forgetting it there would just make the next run pay for it again.
  if (forgetGpuBlock) clearZeroGpuBlock();
  if (history) {
    try {
      report.history = await clearHistory();
    } catch {}
  }
  return report;
}

/** A sentence about a full reset, for the log line and the toast. */
export function describeFullReset(report) {
  const bits = wipeBits(report);
  if (report.routes) bits.push(`${report.routes} route record${report.routes === 1 ? "" : "s"}`);
  if (report.history) bits.push(`${report.history} saved clip${report.history === 1 ? "" : "s"}`);
  return bits.length ? bits.join(", ") : "nothing left to wipe";
}
