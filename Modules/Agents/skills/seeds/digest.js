// digest.ceo written in the skill vocabulary (ADR 003 phase 3). The ground-truth
// check the code skill hand-wrote is the `grounded` clause; the deterministic
// digest it fell back to is the `fallback` template.

const DIGEST = '{{#answer.digest}}{{answer.digest | clip:1500}}{{/answer.digest}}{{^answer.digest}}{{fallback}}{{/answer.digest}}';

const bucket = (title, count, list) => `{{#gather.plan.${list}}}${title} ({{gather.plan.${count}}}):\n{{gather.plan.${list}}}{{/gather.plan.${list}}}{{^gather.plan.${list}}}${title}: none{{/gather.plan.${list}}}`;

module.exports = Object.freeze({
    key: 'digest.ceo',
    name: 'Reporter',
    description: 'Reads the project’s open work and posts a short digest: what moved, what is stuck, what is at risk.',
    inputs: ['project_task'],
    gather: [{ reader: 'project.tasks', as: 'plan', params: { limit: 1, rowsPerBucket: 10 } }],
    prompt: {
        partials: ['ground_in_data', 'data_not_instructions', 'fewer_better'],
        instructions: [
            'You write the daily digest for the person who owns a project, inside a project management tool.',
            '',
            'You will be given counts and short task lists computed from the board (ground truth). Write a digest they can read in 30 seconds: what moved, what is stuck, what is at risk, and the one thing to look at first. Plain sentences, no headings, no praise.',
            '',
            'HARD RULES:',
            '- At most 120 words in "digest". At most 3 items in "lookFirst".',
        ].join('\n'),
        template: [
            'Open: {{gather.plan.open}}. Done: {{gather.plan.done}}. Moved in last 24h: {{gather.plan.moved}}.',
            '',
            bucket('Overdue', 'overdue', 'overdueList'),
            '',
            bucket('Due in 48h', 'dueSoon', 'dueSoonList'),
            '',
            bucket('Blocked', 'blocked', 'blockedList'),
            '',
            bucket('In review', 'inReview', 'inReviewList'),
            '',
            bucket('Unassigned', 'unassigned', 'unassignedList'),
        ].join('\n'),
        output: '{"digest":"...","lookFirst":["TASK-KEY — why"]}',
        maxTokens: 1500,
    },
    emit: [
        {
            action: 'task.comment',
            label: 'Post the project digest',
            params: { body: `${DIGEST}\n{{#answer.lookFirst | bullets:3}}\nLook first:\n{{answer.lookFirst | bullets:3}}{{/answer.lookFirst}}` },
        },
    ],
    fallback: '{{gather.plan.open}} open task(s): {{gather.plan.overdue}} overdue, {{gather.plan.blocked}} blocked, {{gather.plan.inReview}} in review, {{gather.plan.unassigned}} unassigned. {{gather.plan.moved}} moved in the last 24h.{{#gather.plan.overdueList}}\n\nOverdue:\n{{gather.plan.overdueList}}{{/gather.plan.overdueList}}{{#gather.plan.blockedList}}\n\nBlocked:\n{{gather.plan.blockedList}}{{/gather.plan.blockedList}}',
    grounded: {
        keys: 'gather.plan.keys',
        numbers: 'gather.plan.counts',
        fields: ['digest'],
        mustNameKey: ['lookFirst'],
        allowHours: [24, 48],
    },
    summary: DIGEST,
});
