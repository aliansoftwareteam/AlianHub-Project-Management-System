import { computed, ref, unref } from "vue";
import moment from "moment";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

export const NEXT = Object.freeze({
    APPROVALS: "approvals",
    WAITING: "waiting",
    OVERDUE: "overdue",
    TODAY: "today",
    SOON: "soon",
    START_PROJECT: "start_project",
    START_TASK: "start_task",
    CLEAR: "clear"
});

const step = (kind, count = 0) => ({ kind, count });
const SOON_DAYS = 7;

const dueSoon = (tasks) => {
    const until = moment().startOf("day").add(SOON_DAYS + 1, "day");
    return (tasks || []).filter((task) => task.DueDate && moment(task.DueDate).isBefore(until)).length;
};

/* `empty` is a workspace with no project and no task of the person's own, so the sample project's tasks do not count as work to do.
 * The person's own work due soon comes before approvals, which may be other people's agents asking. */
export function whatNext({ approvals = 0, waiting = 0, overdue = 0, today = 0, soon = 0, empty = false, canCreateProject = false } = {}) {
    if (!empty) {
        if (overdue > 0) return step(NEXT.OVERDUE, overdue);
        if (today > 0) return step(NEXT.TODAY, today);
        if (soon > 0) return step(NEXT.SOON, soon);
    }
    if (approvals > 0) return step(NEXT.APPROVALS, approvals);
    if (waiting > 0) return step(NEXT.WAITING, waiting);
    if (empty) return step(canCreateProject ? NEXT.START_PROJECT : NEXT.START_TASK);
    return step(NEXT.CLEAR);
}

/* Every number comes from a read the linked screen makes itself: the Inbox's count for its approval tab,
 * the rows My work lists, the rows the Waiting on you card holds. Nothing is counted here. */
export function useWhatNext({ work, waiting, empty, canCreateProject, canOpenInbox }) {
    const approvals = ref(0);
    const counted = ref(false);

    async function load() {
        if (!unref(canOpenInbox)) {
            counted.value = true;
            return;
        }
        try {
            const res = await apiRequest("get", `${env.INBOX}/counts`);
            approvals.value = res?.data?.status ? Number(res.data.data?.approval) || 0 : 0;
        } catch (error) {
            approvals.value = 0;
        } finally {
            counted.value = true;
        }
    }

    const next = computed(() => {
        if (!counted.value || !work.loaded.value) return null;
        const groups = work.groups.value;
        return whatNext({
            approvals: approvals.value,
            waiting: unref(waiting),
            overdue: groups.overdue.length,
            today: groups.today.length,
            soon: dueSoon(groups.next),
            empty: unref(empty),
            canCreateProject: unref(canCreateProject)
        });
    });

    return { next, load };
}
