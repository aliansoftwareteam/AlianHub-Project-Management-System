import { computed, inject, reactive, unref } from "vue";
import { routerKey } from "vue-router";
import { useStore } from "vuex";
import { apiRequest } from "@/services";
import { ROLE_GUEST } from "@/utils/roles";
import { listRequest } from "./goalRequest";

/* The goals this person can edit, for the "Count toward a goal…" entries on a task and on a list. They are
   read from the goals list, which answers `canEdit` by the server's own rule: the first time one of those
   menus is opened, and again each time the picker opens, since it sends a target's whole set of sources back.
   Someone who never opens such a menu never asks. */
export const linkableGoals = reactive({ companyId: "", status: "idle", goals: [], loadedAt: 0, linked: 0 });

/* The picker opens a moment after its menu did: a list read that recently is not read again. */
export const FRESH_FOR_MS = 10000;

const editable = (goal) => Boolean(goal) && goal.canEdit === true && goal.archived !== true;

let reading = null;

export function resetLinkableGoals() {
    reading = null;
    Object.assign(linkableGoals, { companyId: "", status: "idle", goals: [], loadedAt: 0, linked: 0 });
}

async function read(company) {
    try {
        const { method, path } = listRequest();
        const res = await apiRequest(method, path);
        if (!res?.data?.status) throw new Error(res?.data?.statusText || "Goals not read");
        if (linkableGoals.companyId !== company) return;
        linkableGoals.goals = (Array.isArray(res.data.data) ? res.data.data : []).filter(editable);
        linkableGoals.loadedAt = Date.now();
        linkableGoals.status = "ready";
    } catch (error) {
        if (linkableGoals.companyId === company) linkableGoals.status = "failed";
    }
}

/* `again` reads a list that was read before; a read under way is waited for, never doubled. */
export function loadLinkableGoals(companyId, { again = false } = {}) {
    const company = String(companyId || "");
    const sameCompany = linkableGoals.companyId === company;
    if (sameCompany && linkableGoals.status === "loading") return reading;
    if (sameCompany && linkableGoals.status !== "idle" && !again) return Promise.resolve();
    if (!sameCompany) linkableGoals.goals = [];
    linkableGoals.companyId = company;
    linkableGoals.status = "loading";
    reading = read(company);
    return reading;
}

export const linkableGoalsAreStale = () => linkableGoals.status !== "ready" || Date.now() - linkableGoals.loadedAt >= FRESH_FOR_MS;

/* The goal as the server answered the write, so the next link starts from the set it now holds. */
export function noteLinked(goal) {
    if (editable(goal)) linkableGoals.goals = [...linkableGoals.goals.filter((entry) => String(entry._id) !== String(goal._id)), goal];
    linkableGoals.linked += 1;
}

/* `offered`: the entry is shown to anyone who could own a goal, which a guest cannot, in a build that
   has the Goals page. `prefetch` is for the moment a menu holding the entry opens. The router is injected,
   not taken with useRouter, which warns where a menu is drawn outside one. */
export function useGoalLinking() {
    const store = useStore();
    const router = inject(routerKey, null);
    const companyId = inject("$companyId", null);
    const offered = computed(() => {
        const roleType = store.getters["settings/companyUserDetail"]?.roleType;
        return roleType !== undefined && roleType !== null && roleType !== ROLE_GUEST && Boolean(router?.hasRoute?.("Goals"));
    });
    const prefetch = () => { if (offered.value) loadLinkableGoals(unref(companyId)); };
    return { offered, prefetch };
}
