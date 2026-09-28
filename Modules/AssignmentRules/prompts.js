const OBJECT_ID = /^[a-f0-9]{24}$/i;
const REASON_CAP = 200;
const WHEN_CAP = 300;
const DESCRIPTION_CAP = 2000;
const TITLE_CAP = 300;

const DECIDE = Object.freeze({
    maxTokens: 200,
    systemPrompt: [
        'You route one project task to the right person using the team\'s own assignment rules.',
        'Each candidate has an id, a name and a plain sentence saying when they should get a task.',
        'Pick the one candidate whose sentence best fits the task, or nobody when no sentence fits.',
        'Never pick anyone who is not in the candidate list, and never invent or alter an id.',
        'Return exactly one JSON object: {"userId": "<a candidate id>" or null, "reason": "<one line of at most 15 words naming the rule that matched, for example: matched her rule: frontend bugs>"}.',
    ].join(' '),
});

const DRAFT = Object.freeze({
    maxTokens: 800,
    systemPrompt: [
        'You help a project lead write assignment rules.',
        'For each person you get the titles, types and tags of tasks they recently worked on in this project.',
        'Write one plain sentence of at most 20 words per person saying which new tasks should go to them, based only on that work.',
        'Describe kinds of work, not individual tasks. When a person has no tasks listed, describe nothing and leave them out.',
        'Return exactly one JSON object: {"rules": [{"userId": "<the person\'s id>", "when": "<sentence>"}]}.',
    ].join(' '),
});

const oneLine = (value, cap) => {
    const text = String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > cap ? `${text.slice(0, cap - 1)}…` : text;
};

const taskBlock = (input) => [
    'Task',
    `Title: ${oneLine(input.title, TITLE_CAP) || '(untitled)'}`,
    input.type ? `Type: ${input.type}` : null,
    input.tags.length ? `Tags: ${input.tags.join(', ')}` : null,
    input.description ? `Description: ${oneLine(input.description, DESCRIPTION_CAP)}` : null,
].filter(Boolean).join('\n');

const decisionPrompt = (input, candidates) => [
    taskBlock(input),
    '',
    'Candidates',
    ...candidates.map((c) => `- id: ${c.userId} | name: ${oneLine(c.name, 80)} | when: ${oneLine(c.when, WHEN_CAP)}`),
].join('\n');

/* The id is only a claim until the caller checks it against the candidates it sent. */
const readPick = (raw) => {
    const value = raw && typeof raw === 'object' ? raw : {};
    const id = String(value.userId === undefined || value.userId === null ? '' : value.userId).trim().toLowerCase();
    return { userId: OBJECT_ID.test(id) ? id : null, claimed: id && id !== 'null' && id !== 'none' ? id : null, reason: oneLine(value.reason, REASON_CAP) };
};

const draftPrompt = (people) => people.map((person) => [
    `Person id: ${person.userId} | name: ${oneLine(person.name, 80)}`,
    ...(person.tasks.length
        ? person.tasks.map((task) => `- ${oneLine(task.title, TITLE_CAP)}${task.type ? ` [${task.type}]` : ''}${task.tags.length ? ` (${task.tags.join(', ')})` : ''}`)
        : ['- (no recent tasks)']),
].join('\n')).join('\n\n');

const readDrafts = (raw, allowed) => {
    const rows = raw && Array.isArray(raw.rules) ? raw.rules : [];
    const byId = new Map();
    rows.forEach((row) => {
        const userId = String((row && row.userId) || '').trim().toLowerCase();
        const when = oneLine(row && row.when, WHEN_CAP);
        if (allowed.includes(userId) && when && !byId.has(userId)) byId.set(userId, when);
    });
    return allowed.filter((id) => byId.has(id)).map((userId) => ({ userId, when: byId.get(userId) }));
};

module.exports = { DECIDE, DRAFT, oneLine, decisionPrompt, readPick, draftPrompt, readDrafts };
