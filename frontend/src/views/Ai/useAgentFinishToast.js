import { ref } from "vue";

// 28b surface 5 — the finish toast. One run ending produces one toast: the
// outcome and two actions, bottom-right, gone on its own. It never blocks the
// board, so there is no modal and no queue: a newer finish replaces an older one.

const ACTIVE = ["queued", "running"];
const FINISHED = ["done", "failed", "stopped", "waiting_approval"];
const DISMISS_MS = 9000;

const toast = ref(null);
const lastStatus = new Map();
let primed = false;
let timer = null;

const outcomeOf = (run) => {
    if (run.status === "waiting_approval") return { text: run.outcome || "", primary: "review" };
    if (run.status === "failed") return { text: run.error || run.outcome || "", primary: "task" };
    if (run.status === "stopped") return { text: run.outcome || "", primary: "task" };
    return { text: run.outcome || "", primary: (run.proposals || []).length ? "review" : "task" };
};

export function useAgentFinishToast() {
    const dismiss = () => {
        toast.value = null;
        if (timer) clearTimeout(timer);
        timer = null;
    };

    const show = (run) => {
        const outcome = outcomeOf(run);
        toast.value = {
            runId: String(run._id),
            agentName: run.agentName || "",
            taskId: run.taskId ? String(run.taskId) : "",
            status: run.status,
            outcome: outcome.text,
            primary: outcome.primary,
            hasProposal: Boolean((run.proposals || []).length) || run.status === "waiting_approval"
        };
        if (timer) clearTimeout(timer);
        timer = setTimeout(dismiss, DISMISS_MS);
    };

    /* Feed this the run list on every poll. The first call only records where
     * each run stood, so opening a page never replays finishes from before. */
    const observe = (runs) => {
        const rows = Array.isArray(runs) ? runs : [];
        let finished = null;
        rows.forEach((run) => {
            const id = String(run._id);
            const was = lastStatus.get(id);
            lastStatus.set(id, run.status);
            if (!primed || !was || was === run.status) return;
            if (!ACTIVE.includes(was) || !FINISHED.includes(run.status)) return;
            if (!finished || new Date(run.finishedAt || 0) > new Date(finished.finishedAt || 0)) finished = run;
        });
        primed = true;
        if (finished) show(finished);
    };

    const reset = () => {
        lastStatus.clear();
        primed = false;
        dismiss();
    };

    return { toast, observe, dismiss, reset, DISMISS_MS };
}
