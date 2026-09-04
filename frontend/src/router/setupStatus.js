import { apiRequestWithoutSecure } from "@/services";
import * as env from "@/config/env";

let cached = null;
let inflight = null;

/* Asked on every navigation, so the answer is kept once it says installed: that
 * never flips back within a page load. A failed request is not cached, so a
 * server that was briefly down is asked again. */
export async function readSetupStatus({ force = false } = {}) {
    if (!force && cached?.installed) return cached;
    if (inflight) return inflight;
    inflight = apiRequestWithoutSecure("get", env.SETUP_STATUS)
        .then((res) => { cached = res?.data?.data || null; return cached; })
        .catch(() => null)
        .finally(() => { inflight = null; });
    return inflight;
}

export function markInstalled() {
    cached = { ...(cached || {}), installed: true, dbOk: true, dbError: null };
}

export function isKnownInstalled() {
    return Boolean(cached?.installed);
}
