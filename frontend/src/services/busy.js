const BUSY_STATUS = 429;
const BUSY_CODE = "server_busy";
export const RETRY_WAIT_CAP_MS = 10000;
export const MAX_WAITING_READS = 6;

let waitingReads = 0;

const headerOf = (error, name) => {
    const headers = error?.response?.headers;
    if (!headers) return undefined;
    return typeof headers.get === "function" ? headers.get(name) : headers[name];
};

export const isBusy = (error) => error?.response?.status === BUSY_STATUS;

export const retryAfterMs = (error) => {
    const raw = headerOf(error, "retry-after");
    if (raw === undefined || raw === null || raw === "") return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const at = Date.parse(raw);
    return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
};

/* The app's i18n instance is looked up only when a 429 has to be worded: a static import would
 * create it for everything that imports the request layer. */
const busyMessage = async (error) => {
    const { i18n } = await import("@/locales/main");
    const seconds = Math.ceil((retryAfterMs(error) || 0) / 1000);
    return seconds > 0
        ? i18n.global.t("Common.server_busy_retry_in", { n: seconds }, seconds)
        : i18n.global.t("Common.server_busy");
};

/* The global limiter (or a proxy in front of it) answers in English or plain text; a route with a
 * limit of its own says why in its body, and the page that called it reads that reason. */
const describe = async (error) => {
    const text = await busyMessage(error);
    const body = error.response.data;
    const ownReason = body && typeof body === "object" && body.code !== BUSY_CODE && (body.statusText || body.message);
    if (ownReason) {
        error.message = body.statusText || text;
        return error;
    }
    error.message = text;
    error.response.data = { ...(body && typeof body === "object" ? body : {}), status: false, statusText: text, message: text };
    return error;
};

const mayRetry = (config, wait) => String(config.method || "").toLowerCase() === "get"
    && !config.background
    && !config.busyRetried
    && wait !== null
    && wait <= RETRY_WAIT_CAP_MS
    && waitingReads < MAX_WAITING_READS;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/* A read is asked once more when the server says when; a write is never sent twice, and a
 * background refresh (config.background) backs off by itself instead of queueing here. */
export const installBusyHandling = (instance) => {
    instance.interceptors.response.use(undefined, async (error) => {
        if (!isBusy(error)) throw error;
        const config = error.config || {};
        const wait = retryAfterMs(error);
        if (!mayRetry(config, wait)) throw await describe(error);
        waitingReads += 1;
        try {
            await sleep(wait);
        } finally {
            waitingReads -= 1;
        }
        return instance.request({ ...config, busyRetried: true });
    });
};
