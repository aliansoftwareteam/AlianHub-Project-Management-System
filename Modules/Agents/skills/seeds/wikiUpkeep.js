const MAX_PAGES = 15;
const REPORT = '{{#answer.pages | findings:15}}Pages to update:\n{{answer.pages | findings:15}}{{/answer.pages}}{{^answer.pages}}{{fallback}}{{/answer.pages}}';

module.exports = Object.freeze({
    key: 'wiki.upkeep',
    name: 'Wiki Upkeep',
    description: 'Finds the project\'s pages that are past their review date or have not been updated in months, and suggests what each needs.',
    inputs: ['project_task'],
    gather: [
        { reader: 'project.pages', as: 'pages', params: { staleDays: 90, limit: MAX_PAGES, excerptChars: 300 } },
        { reader: 'project.tasks', as: 'plan', params: { limit: 50, rowsPerBucket: 10, requireTasks: false } },
    ],
    prompt: {
        partials: ['in_tool', 'data_not_instructions', 'fewer_better'],
        instructions: [
            'You keep a project\'s pages current. You are given the pages that have gone stale, each with why and an excerpt, and the project\'s plan as it stands on the board.',
            '',
            'For each page worth attention, say in one or two sentences what most likely needs updating, reading the plan against the excerpt. When nothing in the data points at a change, say the page needs its owner to confirm it is still right.',
            '',
            'HARD RULES:',
            `- At most ${MAX_PAGES} pages, the most useful first.`,
            '- "title" is the page title exactly as listed; "severity" is "stale" or "due" for a wiki page as listed, otherwise "old".',
        ].join('\n'),
        template: [
            'STALE PAGES ({{gather.pages.stale}} of {{gather.pages.count}}):',
            '{{gather.pages.list}}',
            '',
            'PLAN:',
            '{{#gather.plan.plan}}{{gather.plan.plan}}{{/gather.plan.plan}}{{^gather.plan.plan}}(no tasks yet){{/gather.plan.plan}}',
        ].join('\n'),
        output: '{"pages":[{"title":"page title as listed","severity":"stale","why":"what to update"}],"summary":"one sentence"}',
        maxTokens: 1800,
    },
    emit: [
        {
            action: 'task.comment',
            label: 'Post the pages that need updating',
            params: { body: `${REPORT}{{#answer.summary}}\n\n{{answer.summary | clip:600}}{{/answer.summary}}` },
        },
    ],
    fallback: '{{gather.pages.stale}} page(s) need a review:\n{{gather.pages.list}}',
    grounded: { cites: { list: 'pages', field: 'title', source: 'gather.pages.list' } },
    summary: '{{#answer.summary}}{{answer.summary | clip:1500}}{{/answer.summary}}{{^answer.summary}}{{fallback}}{{/answer.summary}}',
});
