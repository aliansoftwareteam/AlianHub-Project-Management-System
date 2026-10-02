import { reactive } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { readKept } from "./keptAiValues.js";

/* The ✦ AREA column (handoff 13c). Same contract as useTaskSummaries: one entry
 * per task, read from what the server keeps when a row scrolls into view, asked
 * of a model only on request, and frozen once pinned.
 *
 * The label always comes from the project's own vocabulary, so the entry also
 * carries where that vocabulary came from — the chip says so on hover. */

const PIN_KEY = "ah.aifields.pinnedCategory";
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
    return { state: "idle", category: "", source: "", sourceName: "", reason: "", updatedAt: "", stale: false, pinned: false, read: false };
}

function hydrate(taskId) {
    const id = String(taskId);
    if (entries[id]) return entries[id];
    const pinned = readPins()[id];
    entries[id] = pinned
        ? { ...blank(), state: "ready", category: pinned.category, source: pinned.source || "", sourceName: pinned.sourceName || "", updatedAt: pinned.updatedAt || "", pinned: true }
        : blank();
    return entries[id];
}

function show(entry, data, stale) {
    entry.source = data.source || "";
    entry.sourceName = data.sourceName || "";
    entry.updatedAt = data.updatedAt || "";
    entry.stale = stale;
    if (data.category) {
        entry.category = data.category;
        entry.reason = "";
        entry.state = "ready";
    } else {
        entry.category = "";
        entry.reason = data.reason || "no-fit";
        entry.state = "empty";
    }
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
        const response = await apiRequest("post", env.AI_TASK_CATEGORY, { taskId: id, force: force === true });
        const payload = response?.data || {};
        const data = payload.data || {};
        if (payload.status !== true) {
            entry.state = "error";
        } else if (data.configured === false) {
            unavailable = true;
            entry.state = "unavailable";
        } else {
            show(entry, data, false);
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
    const kept = await readKept("category", taskId);
    if (entry.state !== "reading") return entry;
    if (kept) show(entry, kept, kept.stale === true);
    else entry.state = "idle";
    return entry;
}

const needsValue = (entry) => entry.state === "idle" || entry.state === "error";

export function useTaskCategories() {
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
        pin(taskId) {
            const id = String(taskId);
            const entry = hydrate(id);
            if (!entry.category) return;
            entry.pinned = true;
            const pins = readPins();
            pins[id] = { category: entry.category, source: entry.source, sourceName: entry.sourceName, updatedAt: entry.updatedAt };
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
