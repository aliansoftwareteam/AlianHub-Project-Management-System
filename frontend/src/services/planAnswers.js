const LOCKED_STATUS = 423;
const TOAST_GAP_MS = 4000;
export const SUSPENDED_ROUTE = "Suspended";
export const PLAN_CODES = ["seat_limit", "storage_full", "file_too_large", "workspace_limit", "tracker_disabled", "tracker_seat_limit", "mail_cap"];
const UPLOAD_CODES = ["storage_full", "file_too_large"];

let lastToastAt = 0;

export const lockOf = (error) => (error?.response?.status === LOCKED_STATUS ? (error.response.data?.code === "suspended" ? "suspended" : "read_only") : null);

const planCodeOf = (body) => (body && typeof body === "object" && body.status === false && PLAN_CODES.includes(body.code) ? body.code : null);

const bytes = async (value) => (await import("@/composable/planUsage")).formatPlanBytes(value);

const uploadName = (config) => {
    const data = config?.data;
    if (typeof FormData !== "undefined" && data instanceof FormData) {
        const file = data.get("file");
        if (file && file.name) return file.name;
    }
    return "";
};

/* The server answers in English; the page shows the same refusal in the reader's language. */
export async function planRefusalText(body, config) {
    const { i18n } = await import("@/locales/main");
    const t = i18n.global.t;
    const code = body.code;
    const sizeCodes = ["storage_full", "file_too_large"];
    const params = {
        limit: sizeCodes.includes(code) ? await bytes(body.limit) : body.limit,
        used: sizeCodes.includes(code) ? await bytes(body.used) : body.used,
        name: uploadName(config) || t("Plan.refused.this_file"),
    };
    if (code === "seat_limit" && body.guests) return t("Plan.refused.guest_limit", params);
    return t(`Plan.refused.${code}`, params);
}

const toastOnce = async (text) => {
    if (Date.now() - lastToastAt < TOAST_GAP_MS) return;
    lastToastAt = Date.now();
    const { useToast } = await import("vue-toast-notification");
    useToast().error(text, { position: "top-right" });
};

const rewrite = (holder, text) => {
    holder.data = { ...holder.data, status: false, statusText: text, message: text };
};

async function onLocked(error, code) {
    const { i18n } = await import("@/locales/main");
    const text = i18n.global.t(code === "suspended" ? "Plan.locked.suspended_toast" : "Plan.locked.read_only_toast");
    error.message = text;
    rewrite(error.response, text);
    if (code === "suspended") {
        const { default: router } = await import("@/router");
        if (router.currentRoute.value.name !== SUSPENDED_ROUTE) router.replace({ name: SUSPENDED_ROUTE });
        return;
    }
    await toastOnce(text);
}

/* 423 from a read-only or suspended hosted instance, and the plan's limit refusals (064). */
export function installPlanAnswers(instance) {
    instance.interceptors.response.use(async (response) => {
        if (planCodeOf(response?.data)) rewrite(response, await planRefusalText(response.data, response.config));
        return response;
    }, async (error) => {
        const locked = lockOf(error);
        if (locked) {
            await onLocked(error, locked);
            return Promise.reject(error);
        }
        const body = error?.response?.data;
        const code = planCodeOf(body);
        if (code) {
            const text = await planRefusalText(body, error.config);
            error.message = text;
            rewrite(error.response, text);
            if (UPLOAD_CODES.includes(code)) await toastOnce(text);
        }
        return Promise.reject(error);
    });
}
