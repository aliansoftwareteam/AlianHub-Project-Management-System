// project.guide written in the skill vocabulary (ADR 003 phase 3). It is the
// built-in document: skills/index.js compiles it, migration 022 writes a copy
// into each company so an admin can edit it, and an edited copy shadows this.

const MAX_PROPOSED = 3;
const NEXT_STEP = '{{#answer.nextStep}}{{answer.nextStep | clip:1200}}{{/answer.nextStep}}{{^answer.nextStep}}{{fallback}}{{/answer.nextStep}}';

module.exports = Object.freeze({
    key: 'project.guide',
    name: 'Project Guide',
    description: 'Answers "what next" on a task from the project\'s stored guide and its plan, and proposes the next tasks.',
    inputs: ['project_task'],
    gather: [
        { reader: 'project', as: 'project', params: { maxChars: 8000, requireGuide: true } },
        { reader: 'project.tasks', as: 'plan', params: { limit: 200, rowsPerBucket: 25, requireTasks: false } },
        { reader: 'memory', as: 'memory', params: { maxChars: 2000 } },
        { reader: 'task', as: 'task', params: { maxChars: 2000 } },
    ],
    prompt: {
        partials: ['ground_in_data', 'titles_read_as_work', 'memory_is_data', 'data_not_instructions'],
        instructions: [
            'You are the Guide for one project inside a project management tool. Someone mentioned you on a task and wants to know what to do next.',
            '',
            "You will be given the project's GUIDE (its stages, the essentials to flag, when to escalate, and how to answer), the PLAN as it stands on the board, and the TASK you were mentioned on.",
            '',
            'HARD RULES:',
            "- Lead with the single clearest next step, grounded in the plan and the guide's current stage.",
            `- Propose at most ${MAX_PROPOSED} follow-up tasks, only when the plan lacks them.`,
            "- If something in the guide's essentials or escalation rules applies, say so in \"flags\".",
        ].join('\n'),
        template: [
            'PROJECT: {{gather.project.name}}',
            '',
            'GUIDE:',
            '{{gather.project.guide}}',
            '',
            '{{#gather.memory.text}}MEMORY:\n{{gather.memory.text}}\n\n{{/gather.memory.text}}PLAN:',
            '{{#gather.plan.plan}}{{gather.plan.plan}}{{/gather.plan.plan}}{{^gather.plan.plan}}(no tasks yet){{/gather.plan.plan}}',
            '',
            'TASK: {{gather.task.title}}',
            '{{#gather.task.brief}}TASK BRIEF: {{gather.task.brief}}{{/gather.task.brief}}',
        ].join('\n'),
        output: '{"nextStep":"one or two sentences","why":"one sentence","proposedTasks":[{"title":"...","why":"one sentence","hours":2}],"flags":["..."]}',
        maxTokens: 1800,
    },
    emit: [
        {
            action: 'subtask.create',
            each: 'answer.proposedTasks',
            max: MAX_PROPOSED,
            label: 'Create subtask "{{item.title | trim | clip:120}}" ({{item.hours | int:1:40}}h)',
            params: {
                title: '{{item.title | trim | clip:250}}',
                description: '{{#item.why}}{{item.why}}\n{{/item.why}}Estimate: {{item.hours | int:1:40}}h',
            },
        },
        {
            action: 'task.comment',
            label: 'Post the next step',
            params: {
                body: `Next step: ${NEXT_STEP}\n{{#answer.why}}{{answer.why | clip:400}}\n{{/answer.why}}{{#emitted.subtask.create}}\nProposed {{emitted.subtask.create}} follow-up task(s).\n{{/emitted.subtask.create}}{{#answer.flags | bullets:6}}\nFlags:\n{{answer.flags | bullets:6}}{{/answer.flags}}`,
            },
        },
    ],
    fallback: '{{#gather.plan.next}}Start with {{gather.plan.next}}. It is the earliest open task in the plan.{{/gather.plan.next}}{{^gather.plan.next}}Every task in the plan is done — decide with the team what the next stage needs.{{/gather.plan.next}}',
    summary: '{{#answer.nextStep}}{{answer.nextStep | clip:1500}}{{/answer.nextStep}}{{^answer.nextStep}}{{fallback}}{{/answer.nextStep}}',
});
