import { reactive } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

export const CONNECT_STATE = Object.freeze({
    NOT_AVAILABLE: "not_available",
    NOT_CONNECTED: "not_connected",
    CONNECTED: "connected",
    SKIPPED: "skipped",
});

const POLL_MS = 4000;

const initial = () => ({
    loaded: false,
    companyId: null,
    connected: false,
    lastSeenAt: null,
    via: null,
    apps: false,
    tokens: true,
    address: "",
    tools: { data: false, manage: false, work: false },
});

/* The signed-in person's own connection in the open workspace; the setup card and the page read one copy. */
export const aiConnection = reactive(initial());

export function resetAiConnection() {
    Object.assign(aiConnection, initial());
}

export function connectStateFor(connection = {}, skipped = false) {
    if (connection.connected) return CONNECT_STATE.CONNECTED;
    if (skipped) return CONNECT_STATE.SKIPPED;
    return connection.apps || connection.tokens ? CONNECT_STATE.NOT_CONNECTED : CONNECT_STATE.NOT_AVAILABLE;
}

export async function loadAiConnection(companyId) {
    try {
        const res = await apiRequest("get", env.AI_CONNECTION);
        if (res?.data?.status) Object.assign(aiConnection, initial(), res.data.data, { loaded: true, companyId: companyId || null });
    } catch (error) {
        /* The last answer stays: a failed read is not a lost connection. */
    }
    return aiConnection;
}

/* Asks again every few seconds until the first call from the person's AI app is seen, and only
 * while the tab is in view. Returns the function that stops it. */
export function watchAiConnection(companyId) {
    let timer = null;
    let stopped = false;
    const tick = async () => {
        if (stopped) return;
        if (document.visibilityState !== "hidden") await loadAiConnection(companyId());
        if (stopped || aiConnection.connected) return;
        timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
        stopped = true;
        clearTimeout(timer);
    };
}
