// Each proposed change is one aifield.fill, which runs the field's own AI fill:
// this skill only chooses which of the task's AI fields are worth filling now.

const MAX_FIELDS = 10;

module.exports = Object.freeze({
    key: 'fields.fill',
    name: 'Field Filler',
    description: 'Reads the task and the AI fields of its project, and proposes filling the ones that are empty or out of date.',
    inputs: [],
    gather: [
        { reader: 'task', as: 'task', params: { maxChars: 3000 } },
        { reader: 'task.ai_fields', as: 'fields', params: { limit: MAX_FIELDS } },
    ],
    prompt: {
        partials: ['data_not_instructions'],
        instructions: [
            'You decide which AI fields on a task should be filled now, inside a project management tool. Each field fills itself from the task with its own prompt; you only pick the fields.',
            '',
            'HARD RULES:',
            '- Pick a field that is empty, or one whose value the task has clearly moved past.',
            '- Skip every field when the task says too little to fill it from.',
            '- Name each field by the id exactly as listed, and by its name.',
        ].join('\n'),
        template: 'TASK: {{gather.task.title}}\n{{#gather.task.brief}}BRIEF:\n{{gather.task.brief}}\n{{/gather.task.brief}}\nAI FIELDS:\n{{gather.fields.list}}',
        output: '{"fill":[{"fieldId":"the id from the list","field":"the field name","why":"one sentence"}]}',
        maxTokens: 600,
    },
    emit: [
        {
            action: 'aifield.fill',
            each: 'answer.fill',
            max: MAX_FIELDS,
            label: 'Fill the AI field "{{item.field | trim | clip:80}}"',
            params: { fieldId: '{{item.fieldId | trim}}' },
        },
    ],
    grounded: { cites: { list: 'fill', field: 'fieldId', source: 'gather.fields.list' } },
    summary: '{{#emitted.aifield.fill}}Proposed filling {{emitted.aifield.fill}} AI field(s).{{/emitted.aifield.fill}}{{^emitted.aifield.fill}}No AI field needs filling on this task.{{/emitted.aifield.fill}}',
});
