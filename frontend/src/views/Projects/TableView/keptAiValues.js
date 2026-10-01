import { apiRequest } from "@/services";
import * as env from "@/config/env";

/* What the AI columns show without asking a model: the value the server keeps for a task.
 * Rows come into view in bursts and each asks for its own, so the asks of one burst travel as one read. */

const BURST_MS = 30;
const MAX_PER_READ = 100;

const waiting = new Map();
let timer = null;

async function readPart(part) {
    const kinds = [...new Set(part.flatMap(([, asks]) => asks.map((ask) => ask.kind)))];
    let values = null;
    try {
        const response = await apiRequest("post", env.AI_TASK_VALUES, { taskIds: part.map(([taskId]) => taskId), kinds });
        if (response?.data?.status === true) values = response.data.data?.values || {};
    } catch (_error) {
        values = null;
    }
    part.forEach(([taskId, asks]) => asks.forEach(({ kind, resolve }) => resolve(values ? (values[taskId] || {})[kind] || null : undefined)));
}

async function flush() {
    timer = null;
    const burst = [...waiting.entries()];
    waiting.clear();
    for (let at = 0; at < burst.length; at += MAX_PER_READ) await readPart(burst.slice(at, at + MAX_PER_READ));
}

/* The kept value of `kind` for the task: null when none is kept, undefined when the read failed. */
export function readKept(kind, taskId) {
    return new Promise((resolve) => {
        const id = String(taskId);
        waiting.set(id, [...(waiting.get(id) || []), { kind, resolve }]);
        if (!timer) timer = setTimeout(flush, BURST_MS);
    });
}
