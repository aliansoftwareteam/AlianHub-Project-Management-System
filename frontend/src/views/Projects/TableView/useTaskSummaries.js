import { reactive } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

/* The ✦ SUMMARY column (handoff 13c). One entry per task, fetched lazily when a
 * row scrolls into view and kept for the session, because the endpoint itself is
 * cached per task + comment count and costs a model call on a miss.
 *
 * A pinned value is frozen: it is stored locally and never replaced by a later
 * refresh until it is unpinned. */

const PIN_KEY = "ah.aifields.pinned";
const MAX_BATCH = 10;
const MAX_IN_FLIGHT = 3;

const entries = reactive({});
let unavailable = false;
let inFlight = 0;
const queue = [];
const pending = new Set();

function drain() {
    while (inFlight < MAX_IN_FLIGHT && queue.length) {
        const job = queue.shift();
        inFlight += 1;
        job().finally(() => {
            inFlight -= 1;
            drain();
        });
    }
}

/* Rows come into view in bursts; a burst must not turn into a burst of model
 * calls, so visible-row fetches go through a small queue. */
function schedule(job) {
    return new Promise((resolve) => {
        queue.push(() => job().then(resolve));
        drain();
    });
}

function readPins() {
    try {
        return JSON.parse(localStorage.getItem(PIN_KEY) || "{}");
    } catch (_error) {
        return {};
    }
}

function writePins(pins) {
    try {
        localStorage.setItem(PIN_KEY, JSON.stringify(pins));
    } catch (_error) { /* storage unavailable */ }
}

function hydrate(taskId) {
    const id = String(taskId);
    if (entries[id]) return entries[id];
    const pinned = readPins()[id];
    entries[id] = pinned
        ? { state: "ready", summary: pinned.summary, updatedAt: pinned.updatedAt, commentCount: pinned.commentCount || 0, pinned: true }
        : { state: "idle", summary: "", updatedAt: "", commentCount: 0, pinned: false };
    return entries[id];
}

async function fetchOne(taskId, force) {
    const id = String(taskId);
    const entry = hydrate(id);
    if (entry.pinned || pending.has(id)) return entry;
    pending.add(id);
    if (unavailable) {
        entry.state = "unavailable";
        pending.delete(id);
        return entry;
    }
    entry.state = "loading";
    try {
        const response = await apiRequest("post", env.AI_TASK_SUMMARY, { taskId: id, force: force === true });
        const payload = response?.data || {};
        if (payload.status === true && payload.data) {
            entry.summary = payload.data.summary || "";
            entry.commentCount = Number(payload.data.commentCount) || 0;
            entry.updatedAt = payload.data.updatedAt || "";
            entry.state = entry.summary ? "ready" : "empty";
        } else if (/no LLM provider/i.test(payload.statusText || "")) {
            unavailable = true;
            entry.state = "unavailable";
        } else {
            entry.state = "error";
        }
    } catch (_error) {
        entry.state = "error";
    }
    pending.delete(id);
    return entry;
}

export function useTaskSummaries() {
    return {
        entries,
        get: (taskId) => hydrate(taskId),
        isUnavailable: () => unavailable,
        /* Called when a row becomes visible — never refetches a value it has. */
        ensure(taskId) {
            const entry = hydrate(taskId);
            if (entry.state !== "idle") return Promise.resolve(entry);
            entry.state = "loading";
            return schedule(() => fetchOne(taskId, false));
        },
        generate: (taskId) => fetchOne(taskId, true),
        async generateMany(taskIds) {
            const ids = (taskIds || []).slice(0, MAX_BATCH);
            let done = 0;
            let failed = 0;
            for (const id of ids) {
                const entry = await fetchOne(id, false);
                if (entry.state === "ready" || entry.state === "empty") done += 1;
                else failed += 1;
            }
            return { done, failed, skipped: Math.max(0, (taskIds || []).length - ids.length) };
        },
        pin(taskId) {
            const id = String(taskId);
            const entry = hydrate(id);
            if (!entry.summary) return;
            entry.pinned = true;
            const pins = readPins();
            pins[id] = { summary: entry.summary, updatedAt: entry.updatedAt, commentCount: entry.commentCount };
            writePins(pins);
        },
        unpin(taskId) {
            const id = String(taskId);
            const entry = hydrate(id);
            entry.pinned = false;
            const pins = readPins();
            delete pins[id];
            writePins(pins);
        }
    };
}
