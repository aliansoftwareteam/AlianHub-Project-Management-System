import { computed, ref, unref } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

export const NEXT = Object.freeze({
    APPROVALS: "approvals",
    WAITING: "waiting",
    OVERDUE: "overdue",
    TODAY: "today",
    START_PROJECT: "start_project",
    START_TASK: "start_task",
    CLEAR: "clear",
    TEAM: "team"
});

const step = (kind, count = 0) => ({ kind, count });

/* `empty` is a workspace with no project and no task of the person's own, so the sample project's tasks do not count as work to do. */
export function whatNext({ approvals = 0, waiting = 0, overdue = 0, today = 0, empty = false, canCreateProject = false } = {}) {
    if (approvals > 0) return step(NEXT.APPROVALS, approvals);
    if (waiting > 0) return step(NEXT.WAITING, waiting);
    if (empty) return step(canCreateProject ? NEXT.START_PROJECT : NEXT.START_TASK);
    if (overdue > 0) return step(NEXT.OVERDUE, overdue);
    if (today > 0) return step(NEXT.TODAY, today);
    return step(NEXT.CLEAR);
}

/* Every number comes from a read the linked screen makes itself: the Inbox's counts for its approval tab,
 * the rows My work lists, the rows the Waiting on you card holds. Nothing is counted here. Only what was filed
 * for the person asks for their approval; what waits for the rest of the team is a quieter link. */
export function useWhatNext({ work, waiting, empty, canCreateProject, canOpenInbox }) {
    const approvals = ref(0);
    const team = ref(0);
    const counted = ref(false);

    async function load() {
        if (!unref(canOpenInbox)) {
            counted.value = true;
            return;
        }
        try {
            const res = await apiRequest("get", `${env.INBOX}/counts`);
            const counts = res?.data?.status ? res.data.data || {} : {};
            approvals.value = Number(counts.approvalOwn) || 0;
            team.value = Number(counts.approvalTeam) || 0;
        } catch (error) {
            approvals.value = 0;
            team.value = 0;
        } finally {
            counted.value = true;
        }
    }

    const next = computed(() => {
        if (!counted.value || !work.loaded.value) return null;
        const groups = work.groups.value;
        return whatNext({
            approvals: approvals.value,
            // The Waiting on you card lists the team's proposals too; those are the quieter link, not a step.
            waiting: Math.max(0, (Number(unref(waiting)) || 0) - team.value),
            overdue: groups.overdue.length,
            today: groups.today.length,
            empty: unref(empty),
            canCreateProject: unref(canCreateProject)
        });
    });

    return { next, team, load };
}
