import { reactive } from "vue";
import { apiRequest } from "@/services";
import { listRequest } from "./goalRequest";

/* The goals this person can edit, for the "Count toward a goal…" entries on a task and on a list. They are
   read once for the workspace from the goals list, which answers `canEdit` by the server's own rule, and
   again each time the picker opens, since it sends a target's whole set of sources back. */
export const linkableGoals = reactive({ companyId: "", status: "idle", goals: [], linked: 0 });

const editable = (goal) => Boolean(goal) && goal.canEdit === true && goal.archived !== true;

export const canCountTowardGoal = () => linkableGoals.goals.length > 0;

export function resetLinkableGoals() {
    Object.assign(linkableGoals, { companyId: "", status: "idle", goals: [], linked: 0 });
}

export async function loadLinkableGoals(companyId, { again = false } = {}) {
    const company = String(companyId || "");
    const sameCompany = linkableGoals.companyId === company;
    if (sameCompany && (linkableGoals.status === "loading" || (linkableGoals.status !== "idle" && !again))) return;
    if (!sameCompany) linkableGoals.goals = [];
    linkableGoals.companyId = company;
    linkableGoals.status = "loading";
    try {
        const { method, path } = listRequest();
        const res = await apiRequest(method, path);
        if (!res?.data?.status) throw new Error(res?.data?.statusText || "Goals not read");
        if (linkableGoals.companyId !== company) return;
        linkableGoals.goals = (Array.isArray(res.data.data) ? res.data.data : []).filter(editable);
        linkableGoals.status = "ready";
    } catch (error) {
        if (linkableGoals.companyId === company) linkableGoals.status = "failed";
    }
}

/* The goal as the server answered the write, so the next link starts from the set it now holds. */
export function noteLinked(goal) {
    if (editable(goal)) linkableGoals.goals = [...linkableGoals.goals.filter((entry) => String(entry._id) !== String(goal._id)), goal];
    linkableGoals.linked += 1;
}
