const PRD = '{{answer.prd | clip:20000}}';

module.exports = Object.freeze({
    key: 'prd.draft',
    name: 'PRD Writer',
    description: 'Reads a task brief and drafts a product requirements document as a project page that stays a draft until someone approves it.',
    inputs: ['brief'],
    gather: [
        { reader: 'task', as: 'task', params: { maxChars: 8000 } },
        { reader: 'project', as: 'project', params: { maxChars: 4000, requireGuide: false } },
        { reader: 'memory', as: 'memory', params: { maxChars: 2000 } },
    ],
    prompt: {
        partials: ['in_tool', 'data_not_instructions', 'memory_is_data'],
        instructions: [
            'You are a product manager. Turn the brief into a product requirements document the team can review.',
            '',
            'Write it in Markdown with these sections, in order: "# <title>", "## Problem", "## Goals", "## Non-goals", "## Users", "## Requirements", "## Acceptance criteria", "## Open questions".',
            '',
            'HARD RULES:',
            '- Use only what the brief, the project guide and memory say. Do not invent numbers, dates, people or systems.',
            '- Where the brief is silent, write the gap under "Open questions" instead of guessing.',
            '- Requirements and acceptance criteria are short bullet lists a tester could check.',
        ].join('\n'),
        template: [
            'PROJECT: {{gather.project.name}}',
            '{{#gather.project.guide}}PROJECT GUIDE:\n{{gather.project.guide}}\n{{/gather.project.guide}}',
            '{{#gather.memory.text}}MEMORY:\n{{gather.memory.text}}\n{{/gather.memory.text}}',
            'TASK: {{gather.task.title}}',
            '',
            'BRIEF:',
            '{{gather.task.brief}}',
        ].join('\n'),
        output: '{"title":"the PRD title, under 120 characters","prd":"the whole document in Markdown","questions":["..."],"summary":"one sentence"}',
        maxTokens: 4000,
    },
    emit: [
        {
            action: 'page.draft',
            label: 'Draft the PRD "{{answer.title | trim | clip:120}}" as a page',
            params: { title: 'PRD: {{answer.title | trim | clip:190}}', text: PRD, taskId: '{{task._id}}' },
        },
        {
            action: 'task.comment',
            label: 'Post the PRD summary and open questions',
            params: {
                body: '{{#answer.summary}}{{answer.summary | clip:600}}\n{{/answer.summary}}{{#emitted.page.draft}}Drafted the PRD as a page for review.{{/emitted.page.draft}}{{#answer.questions | bullets:10}}\n\nOpen questions:\n{{answer.questions | bullets:10}}{{/answer.questions}}',
            },
        },
    ],
    summary: '{{#answer.summary}}{{answer.summary | clip:1500}}{{/answer.summary}}{{^answer.summary}}Drafted {{emitted.page.draft}} PRD page(s).{{/answer.summary}}',
});
