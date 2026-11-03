import * as env from "@/config/env";

const RESTART_TIMEOUT_MS = 90000;
const POLL_MS = 2000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readHealth = () => fetch(`${env.API_URI}${env.HEALTH}`, { cache: "no-store" }).then((res) => res.json());

/* The old process keeps answering while it drains, so "healthy" only counts once the
 * process answering started after the click. */
export const bootedAfter = (body, clickedAt, now) => Boolean(body) && body.status === "ok" && Number.isFinite(body.uptimeSeconds) && body.uptimeSeconds * 1000 < now - clickedAt;

export async function restartAndWait({ post, companyId, fetchHealth = readHealth, wait = sleep, now = Date.now, timeoutMs = RESTART_TIMEOUT_MS, intervalMs = POLL_MS }) {
    const clickedAt = now();
    await post(env.INSTANCE_RESTART, { companyId });
    while (now() - clickedAt < timeoutMs) {
        await wait(intervalMs);
        const body = await fetchHealth().catch(() => null);
        if (bootedAfter(body, clickedAt, now())) return true;
    }
    throw new Error("restart_timeout");
}
