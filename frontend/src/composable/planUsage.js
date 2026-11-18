import { reactive, watch } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { isManagedHosting, publicConfig } from "@/config/publicConfig";

export const PLAN_EVENT = "PLAN_UPDATED";
export const LIFECYCLE_EVENT = "INSTANCE_LIFECYCLE_CHANGED";

const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatPlanBytes(bytes) {
    let value = Math.max(0, Number(bytes) || 0);
    let unit = 0;
    while (value >= 1024 && unit < UNITS.length - 1) {
        value /= 1024;
        unit += 1;
    }
    const rounded = unit === 0 || value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
    return `${rounded} ${UNITS[unit]}`;
}

export const isUnlimited = (limit) => limit === null || limit === undefined;

export const percentOf = (used, limit) => (isUnlimited(limit) || Number(limit) <= 0 ? 0 : Math.min(100, Math.round((Number(used) / Number(limit)) * 100)));

/* One copy for the page and the banner, refreshed when the plan or the lifecycle changes. */
export const planState = reactive({ loading: false, loaded: false, failed: false, data: null });

let pending = null;

export function loadPlanUsage() {
    if (!isManagedHosting()) {
        Object.assign(planState, { loading: false, loaded: true, failed: false, data: null });
        return Promise.resolve(null);
    }
    if (pending) return pending;
    planState.loading = true;
    pending = apiRequest("get", env.PLAN_USAGE)
        .then((res) => {
            const data = res?.data?.data || null;
            Object.assign(planState, { loaded: true, failed: !res?.data?.status, data: data && data.managed ? data : null });
            return planState.data;
        })
        .catch(() => {
            Object.assign(planState, { loaded: true, failed: true });
            return null;
        })
        .finally(() => {
            planState.loading = false;
            pending = null;
        });
    return pending;
}

const onLifecycle = (payload) => {
    if (payload?.state && publicConfig.hosting) publicConfig.hosting.lifecycle = payload.state;
    if (payload && "graceUntil" in payload && publicConfig.hosting) publicConfig.hosting.graceUntil = payload.graceUntil;
    loadPlanUsage();
};

let listening = null;

/* Called by whoever is mounted first; the socket can be replaced on a workspace switch. */
export function followPlan(store) {
    watch(() => store.getters["settings/getSocketInstance"], (socket) => {
        if (listening) {
            listening.off(PLAN_EVENT, loadPlanUsage);
            listening.off(LIFECYCLE_EVENT, onLifecycle);
        }
        listening = socket && typeof socket.on === "function" ? socket : null;
        if (listening) {
            listening.on(PLAN_EVENT, loadPlanUsage);
            listening.on(LIFECYCLE_EVENT, onLifecycle);
        }
    }, { immediate: true });
}

export function openPortal(url = planState.data?.portalUrl || publicConfig.hosting?.portalUrl) {
    if (url) window.open(url, "_blank", "noopener");
}
