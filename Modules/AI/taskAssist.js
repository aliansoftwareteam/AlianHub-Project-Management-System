'use strict';

const { FEATURES } = require('../AICore/features');
const { taskContext, statusName, clip } = require('./taskContext');
const { askJson, cleanLines, failure } = require('./assistCall');

const STEP_MIN = 3;
const STEP_MAX = 7;
const STEP_LENGTH = 140;

const SYSTEM = [
    'You suggest the next concrete steps for one project-management task.',
    `Return ${STEP_MIN} to ${STEP_MAX} steps, in the order they should be done.`,
    'Each step is one short imperative line a teammate could tick off (under 100 characters), specific to this task, not generic advice.',
    'Leave out steps the task, its checklist or its subtasks already cover.',
    'Return a single JSON object: {"steps": ["<step>", ...]}.',
].join(' ');

const describe = ({ task, subtasks, docs, comments }) => [
    `Task: ${clip(task.TaskName, 300)}`,
    `Status: ${statusName(task) || 'unknown'}${task.Task_Priority ? ` · priority ${task.Task_Priority}` : ''}`,
    task.rawDescription ? `Description: ${clip(task.rawDescription, 2000)}` : null,
    (task.checklistArray || []).length ? `Checklist: ${(task.checklistArray || []).map((i) => i && i.name).filter(Boolean).slice(0, 30).join('; ')}` : null,
    subtasks.length ? `Subtasks: ${subtasks.map((s) => `${clip(s.TaskName, 120)} (${statusName(s)})`).join('; ')}` : null,
    docs.length ? `Linked docs: ${docs.map((d) => `${clip(d.title, 120)}: ${clip(d.rawText, 400)}`).join(' | ')}` : null,
    comments.length ? `Recent comments:\n${comments.slice(-12).map((c) => `- ${c.who}: ${clip(c.message, 300)}`).join('\n')}` : null,
].filter(Boolean).join('\n');

/* Suggestions only: nothing is written here. The person applies them as a checklist or as
 * subtasks through the task's own write paths. */
async function suggestNextSteps({ companyId, uid, taskId }) {
    const ctx = await taskContext({ companyId, uid, taskId });
    if (!ctx) return { status: false, notFound: true, code: 'task_not_found', reason: 'Task not found.' };
    const outcome = await askJson({
        system: SYSTEM,
        data: describe(ctx),
        maxTokens: 600,
        spend: { feature: FEATURES.TASK_ASSIST, companyId, userId: uid },
    });
    if (!outcome.ok) return failure(outcome);
    const steps = cleanLines(outcome.value.steps, { max: STEP_MAX, maxLength: STEP_LENGTH });
    if (steps.length < STEP_MIN) return { status: false, code: 'no_steps', reason: 'The model did not suggest enough steps.' };
    return { status: true, data: { steps } };
}

module.exports = { suggestNextSteps, describe, STEP_MIN, STEP_MAX };
