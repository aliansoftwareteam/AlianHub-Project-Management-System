import { reactive, watch } from "vue";
import { apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";

const PRESENCE_KEY = "ah.presence";
const PLANNER_KEY = "ah.home.planner";
const FOCUS_KEY = "ah.planner.focus";

function readJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

export const homeState = reactive({
    sidebarOpen: false,
    plannerOpen: localStorage.getItem(PLANNER_KEY) !== "0",
    presence: readJson(PRESENCE_KEY, { dnd: false, until: null }),
    focusBlocks: readJson(FOCUS_KEY, []),
    refreshKey: 0
});

watch(() => homeState.plannerOpen, (open) => localStorage.setItem(PLANNER_KEY, open ? "1" : "0"));
watch(() => homeState.focusBlocks, (blocks) => localStorage.setItem(FOCUS_KEY, JSON.stringify(blocks)), { deep: true });

export function isDnd() {
    const p = homeState.presence;
    if (!p.dnd) return false;
    if (p.until && new Date(p.until).getTime() < Date.now()) {
        homeState.presence = { dnd: false, until: null };
        return false;
    }
    return true;
}

export function setPresence(userId, presence) {
    homeState.presence = presence;
    localStorage.setItem(PRESENCE_KEY, JSON.stringify(presence));
    if (!userId) return;
    apiRequestWithoutCompnay("put", env.USER_UPATE, {
        userId,
        updateObject: { $set: { presence } }
    }).catch((error) => console.error("presence update failed", error));
}

export function requestRefresh() {
    homeState.refreshKey += 1;
}
