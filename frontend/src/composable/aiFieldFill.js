import { reactive } from 'vue';
import { aiUsable } from '@/composable/aiAvailability';
import { applyAiFill, previewAiFill, readAiFillJob, startAiFillJob } from '@/views/Projects/composables/aiFields';

export const PREVIEW_SAMPLE = 3;
const POLL_MS = 1500;
const FINISHED = ['done', 'stopped', 'failed'];

export const PHASE = Object.freeze({
    IDLE: 'idle',
    OFF: 'off',
    PREVIEWING: 'previewing',
    PREVIEW: 'preview',
    APPLYING: 'applying',
    RUNNING: 'running',
    FINISHED: 'finished',
    ERROR: 'error'
});

const initial = () => ({ open: false, field: null, taskIds: [], phase: PHASE.IDLE, proposals: [], job: null, error: '', errorCode: '' });

/* One fill at a time for the whole app; List, Table, the bulk bar and the task panel all open this. */
export const aiFieldFill = reactive(initial());

let pollTimer = null;
let session = 0;

const failure = (error) => ({
    error: error?.response?.data?.message || error?.message || '',
    errorCode: error?.response?.data?.code || ''
});

function fail(run, error) {
    if (run !== session) return;
    Object.assign(aiFieldFill, { phase: PHASE.ERROR, ...failure(error) });
}

export const isBulkFill = () => aiFieldFill.taskIds.length > 1;

export async function openAiFill(field, taskIds) {
    closeAiFill();
    const run = session;
    Object.assign(aiFieldFill, { open: true, field, taskIds: [...new Set((taskIds || []).map(String))] });
    if (!aiUsable.value) {
        aiFieldFill.phase = PHASE.OFF;
        return;
    }
    aiFieldFill.phase = PHASE.PREVIEWING;
    try {
        const data = await previewAiFill(field._id, aiFieldFill.taskIds.slice(0, PREVIEW_SAMPLE));
        if (run !== session) return;
        Object.assign(aiFieldFill, { proposals: data?.proposals || [], phase: PHASE.PREVIEW });
    } catch (error) {
        fail(run, error);
    }
}

async function poll(run) {
    try {
        const job = await readAiFillJob(aiFieldFill.job._id);
        if (run !== session) return;
        aiFieldFill.job = job;
        if (FINISHED.includes(job?.status)) aiFieldFill.phase = PHASE.FINISHED;
        else pollTimer = setTimeout(() => poll(run), POLL_MS);
    } catch (error) {
        fail(run, error);
    }
}

export async function confirmAiFill() {
    const run = session;
    const proposalIds = aiFieldFill.proposals.map((proposal) => proposal.proposalId).filter(Boolean);
    try {
        if (!isBulkFill()) {
            aiFieldFill.phase = PHASE.APPLYING;
            const result = await applyAiFill(aiFieldFill.field._id, proposalIds);
            if (run !== session) return;
            if (result?.applied?.length) closeAiFill();
            else Object.assign(aiFieldFill, { phase: PHASE.ERROR, error: '', errorCode: result?.refused?.[0]?.reason || 'expired' });
            return;
        }
        aiFieldFill.phase = PHASE.RUNNING;
        const job = await startAiFillJob(aiFieldFill.field._id, aiFieldFill.taskIds, proposalIds);
        if (run !== session) return;
        aiFieldFill.job = job;
        pollTimer = setTimeout(() => poll(run), POLL_MS);
    } catch (error) {
        fail(run, error);
    }
}

/* A running job carries on on the server; closing only stops watching it. */
export function closeAiFill() {
    session += 1;
    clearTimeout(pollTimer);
    pollTimer = null;
    Object.assign(aiFieldFill, initial());
}
