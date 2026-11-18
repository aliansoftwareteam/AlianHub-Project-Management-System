import * as env from "@/config/env";

export const FEEDBACK_REASONS = Object.freeze(["wrong", "missing_sources", "too_long", "not_asked", "other"]);

const BATCH = 50;

/* Imported late so a screen that only shows the thumbs does not pull the API client in with it. */
const request = async (...args) => (await import("@/services")).apiRequest(...args);

const dataOf = (res) => {
    if (res?.data?.status !== true) throw new Error(res?.data?.statusText || "");
    return res.data.data;
};

export const newItemId = () => `pv-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export const saveFeedback = async (body) => dataOf(await request("put", env.AI_FEEDBACK, body));

export const removeFeedback = async (id) => dataOf(await request("delete", `${env.AI_FEEDBACK}/${encodeURIComponent(id)}`));

let pending = null;

const fetchMine = async (ids) => {
    const items = {};
    for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH);
        const data = dataOf(await request("get", `${env.AI_FEEDBACK}/mine?items=${chunk.map(encodeURIComponent).join(",")}`));
        Object.assign(items, data?.items || {});
    }
    return items;
};

/* Every answer on screen asks for its own rating; the asks made in one tick share one request. */
export function loadMine(itemId) {
    if (!pending) {
        const batch = { ids: new Set() };
        batch.promise = Promise.resolve().then(() => {
            pending = null;
            return fetchMine([...batch.ids]);
        });
        pending = batch;
    }
    pending.ids.add(itemId);
    return pending.promise.then((items) => items[itemId] || null);
}
