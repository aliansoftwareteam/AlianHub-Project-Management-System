import { reactive } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { readKept } from "./keptAiValues.js";

/* The ✦ SUMMARY column (handoff 13c). One entry per task. A row that scrolls into
 * view reads the summary the server keeps for it, which costs no model call; a
 * model is asked only by Generate on a row, by the column header, or by the bulk
 * bar, because each of those is a paid call.
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

function blank() {
    return { state: "idle", summary: "", updatedAt: "", commentCount: 0, stale: false, pinned: false, read: false };
}

function hydrate(taskId) {
    const id = String(taskId);
    if (entries[id]) return entries[id];
    const pinned = readPins()[id];
    entries[id] = pinned
        ? { ...blank(), state: "ready", summary: pinned.summary, updatedAt: pinned.updatedAt, commentCount: pinned.commentCount || 0, pinned: true }
        : blank();
    return entries[id];
}

function show(entry, data, stale) {
    entry.summary = data.summary || "";
    entry.commentCount = Number(data.commentCount) || 0;
    entry.updatedAt = data.updatedAt || "";
    entry.stale = stale;
    entry.state = entry.summary ? "ready" : "empty";
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
            show(entry, payload.data, false);
        } else if (payload.aiState) {
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

async function readOne(taskId) {
    const entry = hydrate(taskId);
    entry.read = true;
    entry.state = "reading";
    const kept = await readKept("summary", taskId);
    if (entry.state !== "reading") return entry;
    if (kept && kept.summary) show(entry, kept, kept.stale === true);
    else entry.state = "idle";
    return entry;
}

const needsValue = (entry) => entry.state === "idle" || entry.state === "error";

export function useTaskSummaries() {
    return {
        entries,
        get: (taskId) => hydrate(taskId),
        isUnavailable: () => unavailable,
        /* Called when a row becomes visible: reads the kept value once, and never asks a model. */
        ensure(taskId) {
            const entry = hydrate(taskId);
            return entry.state === "idle" && !entry.read ? readOne(taskId) : Promise.resolve(entry);
        },
        missing: (taskIds) => (taskIds || []).map(String).filter((id) => needsValue(hydrate(id))),
        generate: (taskId) => fetchOne(taskId, true),
        generateShown: (taskIds) => Promise.all((taskIds || []).map((id) => schedule(() => fetchOne(id, false)))),
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
