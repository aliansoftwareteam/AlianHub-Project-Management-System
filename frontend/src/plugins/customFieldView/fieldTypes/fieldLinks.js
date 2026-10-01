/* A relationship or a voting field keeps its value beside the task, and the server answers what this viewer may see of it.
   The answers are kept here by task, asked for in one request for every task read in the same tick, and asked for again
   when the marker a task carries for the field ({ revision }) has moved since. */
import { reactive } from 'vue';

const RESOLVE = '/api/v2/custom-fields/links/resolve';
const BATCH = 200;
const NOTHING = Object.freeze([]);

const answers = reactive({});
const queued = new Map();
const flying = new Set();
let sending = null;

/* A revision only grows, so two copies of one task on screen (a row and the open panel) never ask in turns: the answer
   read for the later marker serves both. */
const rank = (revision) => (typeof revision === 'number' ? revision : 0);

const revisionsOf = (task) => Object.fromEntries(Object.entries(task?.customField || {})
    .map(([fieldId, entry]) => [fieldId, rank(entry?.revision)]));

const revisionOf = (task, fieldId) => rank(task?.customField?.[fieldId]?.revision);

const latest = (known = {}, read = {}) => Object.fromEntries([...Object.keys(known), ...Object.keys(read)]
    .map((fieldId) => [fieldId, Math.max(rank(known[fieldId]), rank(read[fieldId]))]));

async function send() {
    const batch = [...queued].slice(0, BATCH);
    batch.forEach(([taskId]) => {
        queued.delete(taskId);
        flying.add(taskId);
    });
    let resolved = null;
    try {
        /* The query helpers read this file, and they are loaded where the API client is not: it is fetched when first needed. */
        const { apiRequest } = await import('@/services');
        const response = await apiRequest('post', RESOLVE, { taskIds: batch.map(([taskId]) => taskId) });
        if (response?.data?.status === true) resolved = response.data.data || {};
    } catch (error) {
        console.error('ERROR in resolving field links: ', error);
    }
    /* A request that failed keeps what was known and is not repeated until the marker moves again. */
    batch.forEach(([taskId, revisions]) => {
        flying.delete(taskId);
        answers[taskId] = {
            revisions: latest(answers[taskId]?.revisions, revisions),
            fields: resolved ? (resolved[taskId] || {}) : (answers[taskId]?.fields || {})
        };
    });
    sending = queued.size ? send() : null;
}

function ask(task) {
    queued.set(String(task._id), revisionsOf(task));
    if (!sending) sending = Promise.resolve().then(send);
}

const taskIdOf = (task) => (task?._id ? String(task._id) : '');

/* Whether what was answered for the field is as new as the marker this copy of the task carries. */
export function linkIsCurrent(task, fieldId) {
    const answer = answers[taskIdOf(task)];
    return Boolean(answer) && rank(answer.revisions[fieldId]) >= revisionOf(task, fieldId);
}

/* What this viewer was given for the field on the task: the linked tasks, or the tally of a vote. null until the first
   answer; reading it is what asks. */
export function linkedValue(task, fieldId) {
    const taskId = taskIdOf(task);
    if (!taskId) return null;
    if (!linkIsCurrent(task, fieldId) && !queued.has(taskId) && !flying.has(taskId)) ask(task);
    const answer = answers[taskId];
    return answer ? (answer.fields[fieldId] ?? NOTHING) : null;
}

export function reloadLinks(task) {
    if (taskIdOf(task)) ask(task);
}

/* What this person just changed themselves, shown at once; the server's answer replaces it when the marker moves. */
export function patchLinkedValue(task, fieldId, value) {
    const taskId = taskIdOf(task);
    if (!taskId) return;
    const answer = answers[taskId] || { revisions: {}, fields: {} };
    answers[taskId] = { revisions: answer.revisions, fields: { ...answer.fields, [fieldId]: value } };
}

export function resetFieldLinks() {
    Object.keys(answers).forEach((taskId) => delete answers[taskId]);
    queued.clear();
    flying.clear();
    sending = null;
}
