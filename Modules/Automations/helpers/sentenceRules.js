const registry = require('../engine/registry');
const { PRIORITIES } = require('./automationRules');

// Natural-language automations (handoff 13d) — a deterministic parser, not a
// model call.
//
// The screen's whole claim is "nothing is a black box": the sentence and the
// compiled rule sit side by side and either can be edited. That only holds if
// the same sentence always compiles to the same rule, offline, with no key and
// no latency. So the grammar is a small closed vocabulary, and anything outside
// it comes back as a named error the sentence field can point at — never a
// guess. Pure: no IO, no DB, no network.

const CANON_TRIGGERS = [
    { event: 'task.status_changed', phrase: 'a task status changes', re: /^a task('s)? status changes$/i },
    { event: 'task.status_changed', phrase: 'a task status changes', re: /^a task is moved$/i },
    { event: 'task.priority_changed', phrase: 'a task priority changes', re: /^a task('s)? priority changes$/i },
    { event: 'task.assignee_changed', phrase: 'a task assignee changes', re: /^a task('s)? assignee changes$/i },
    { event: 'task.assignee_changed', phrase: 'a task assignee changes', re: /^a task is (re)?assigned$/i },
    { event: 'task.lead_changed', phrase: 'a task lead changes', re: /^a task('s)? lead changes$/i },
    { event: 'task.due_date_changed', phrase: 'a task due date changes', re: /^a task('s)? due date changes$/i },
    { event: 'task.sprint_changed', phrase: 'a task moves sprint', re: /^a task (moves sprint|changes sprint)$/i },
    { event: 'task.renamed', phrase: 'a task is renamed', re: /^a task is renamed$/i },
    { event: 'task.created', phrase: 'a task is created', re: /^a task is created$/i },
    { event: 'task.updated', phrase: 'a task is updated', re: /^a task is (updated|edited)$/i },
    { event: 'form.submitted', phrase: 'a form is submitted', re: /^a form is submitted$/i },
];

// "a task is marked X" / "a task status changes to X" also carry a condition, so
// they are matched separately from the bare trigger phrases above.
const MARKED = /^a task (?:is marked|status changes to|is moved to)\s+(.+)$/i;

const COND_PATTERNS = [
    { re: /^(?:the )?priority is not\s+(.+)$/i, build: (m) => ({ op: 'neq', field: 'Task_Priority', value: normPriority(m[1]) }) },
    { re: /^(?:the )?priority is\s+(.+)$/i, build: (m) => ({ op: 'eq', field: 'Task_Priority', value: normPriority(m[1]) }) },
    { re: /^(?:the )?status is not\s+(.+)$/i, build: (m) => ({ op: 'neq', field: 'statusType', value: trim(m[1]) }) },
    { re: /^(?:the )?status is\s+(.+)$/i, build: (m) => ({ op: 'eq', field: 'statusType', value: trim(m[1]) }) },
    { re: /^(?:the )?title contains\s+(.+)$/i, build: (m) => ({ op: 'contains', field: 'TaskName', value: unquote(m[1]) }) },
    { re: /^(?:it |the task )?has no assignee$/i, build: () => ({ op: 'empty', field: 'AssigneeUserId' }) },
    { re: /^(?:it |the task )?has an assignee$/i, build: () => ({ op: 'notEmpty', field: 'AssigneeUserId' }) },
    { re: /^(?:it |the task )?has no lead$/i, build: () => ({ op: 'empty', field: 'Task_Leader' }) },
    { re: /^(?:it |the task )?is a parent task$/i, build: () => ({ op: 'eq', field: 'isParentTask', value: true }) },
];

const ACTION_PATTERNS = [
    { re: /^set the status to\s+(.+)$/i, build: (m) => ({ action: 'set_status', config: { status: unquote(m[1]) } }) },
    { re: /^set the priority to\s+(.+)$/i, build: (m) => ({ action: 'set_priority', config: { priority: normPriority(m[1]) } }) },
    { re: /^post a comment saying\s+(.+)$/i, build: (m) => ({ action: 'add_comment', config: { body: unquote(m[1]) } }) },
    { re: /^create a subtask called\s+(.+)$/i, build: (m) => ({ action: 'create_subtask', config: { title: unquote(m[1]) } }) },
    { re: /^run the\s+([a-z0-9.-]+)\s+agent(?:\s+as\s+(.+))?$/i, build: (m) => ({ action: 'run_agent', config: m[2] ? { skill: m[1], agent: unquote(m[2]) } : { skill: m[1] } }) },
];

const trim = (s) => String(s == null ? '' : s).trim();
const unquote = (s) => trim(s).replace(/^["“”'‘’]+/, '').replace(/["“”'‘’]+$/, '').trim();
const normPriority = (s) => {
    const v = unquote(s).toUpperCase();
    return PRIORITIES.includes(v) ? v : unquote(s);
};
const phrase = (s) => trim(s).replace(/\s+/g, ' ').replace(/[.!]+$/, '');

/* Split on " and " / ", and " / "," but never inside a quoted run, so a comment
 * body may contain the word "and" without becoming a second action. */
const splitClauses = (text) => {
    const parts = [];
    let buf = '';
    let quote = '';
    const src = String(text || '');
    for (let i = 0; i < src.length; i += 1) {
        const ch = src[i];
        if (quote) {
            buf += ch;
            if (ch === quote || (quote === '“' && ch === '”') || (quote === '‘' && ch === '’')) quote = '';
            continue;
        }
        if (ch === '"' || ch === '“' || ch === "'" || ch === '‘') { quote = ch; buf += ch; continue; }
        const rest = src.slice(i);
        const joiner = /^(\s*,\s*and\s+|\s+and\s+|\s*,\s*)/.exec(rest);
        if (joiner) { parts.push(buf); buf = ''; i += joiner[0].length - 1; continue; }
        buf += ch;
    }
    parts.push(buf);
    return parts.map(trim).filter(Boolean);
};

const matchTrigger = (text) => CANON_TRIGGERS.find((t) => t.re.test(text)) || null;

const foldConditions = (list) => {
    if (!list.length) return {};
    return list.length === 1 ? list[0] : { op: 'and', args: list };
};

const unfoldConditions = (node) => {
    if (!node || !node.op) return [];
    if (node.op === 'and' && Array.isArray(node.args)) return node.args.filter(Boolean);
    return [node];
};

/* The whole sentence, split into its three parts. "When …, if …, then …" — the
 * "if" and "then" keywords are optional so both the terse and the explicit form
 * parse to the same rule. */
const sections = (sentence) => {
    const text = trim(sentence).replace(/\s+/g, ' ').replace(/[.]+$/, '');
    const whenMatch = /^when\s+(.+)$/i.exec(text);
    if (!whenMatch) return { error: 'A rule has to start with "When".' };
    const body = whenMatch[1];

    const thenAt = body.search(/,\s*then\s+/i);
    const commaAt = body.indexOf(',');
    if (thenAt === -1 && commaAt === -1) return { error: 'Put a comma between what happens and what to do about it.' };

    let whenPart;
    let restPart;
    if (thenAt !== -1) {
        whenPart = body.slice(0, thenAt);
        restPart = body.slice(thenAt).replace(/^,\s*then\s+/i, '');
    } else {
        whenPart = body.slice(0, commaAt);
        restPart = body.slice(commaAt + 1);
    }

    let ifPart = '';
    const ifMatch = /^if\s+(.+?),\s*(.+)$/i.exec(trim(restPart));
    if (ifMatch) { ifPart = ifMatch[1]; restPart = ifMatch[2]; }

    // "When a task is created and the priority is HIGH, …" — the trailing clause
    // belongs to the conditions, not the trigger.
    const whenClauses = splitClauses(whenPart);
    const triggerText = whenClauses.shift() || '';
    return { triggerText, conditionTexts: whenClauses.concat(ifPart ? splitClauses(ifPart) : []), actionText: trim(restPart) };
};

/* sentence → v2 rule. Returns every problem it found rather than the first, so
 * the builder can underline each slot it could not read. */
const parseSentence = (sentence, { name } = {}) => {
    const errors = [];
    const ambiguities = [];
    const parts = sections(sentence);
    if (parts.error) return { ok: false, errors: [parts.error], ambiguities, rule: null };

    const triggerPhrase = phrase(parts.triggerText);
    const conditions = [];
    let trigger = matchTrigger(triggerPhrase);

    if (!trigger) {
        const marked = MARKED.exec(triggerPhrase);
        if (marked) {
            const value = unquote(marked[1]);
            trigger = CANON_TRIGGERS.find((t) => t.event === 'task.status_changed');
            conditions.push({ op: 'changedTo', field: 'statusType', value });
            // "marked High" reads as a priority to a human and as a status to the
            // engine. Guessing either way would put a rule in production that does
            // not do what its own sentence says.
            if (PRIORITIES.includes(value.toUpperCase())) {
                ambiguities.push({
                    at: 'trigger',
                    text: value,
                    question: `"${value}" is both a status name and a priority. Which did you mean?`,
                    options: [
                        { label: `status changes to ${value}`, sentence: `a task status changes to ${value}` },
                        { label: `priority changes to ${value}`, sentence: `a task priority changes to ${value}` },
                    ],
                });
            }
        }
    }

    const priorityTo = /^a task priority changes to\s+(.+)$/i.exec(triggerPhrase);
    if (!trigger && priorityTo) {
        trigger = CANON_TRIGGERS.find((t) => t.event === 'task.priority_changed');
        conditions.push({ op: 'changedTo', field: 'Task_Priority', value: normPriority(priorityTo[1]) });
    }

    if (!trigger) errors.push(`I do not know the event "${trim(parts.triggerText)}".`);

    parts.conditionTexts.forEach((raw) => {
        const text = phrase(raw);
        const pattern = COND_PATTERNS.find((p) => p.re.test(text));
        if (!pattern) { errors.push(`I do not know the condition "${trim(raw)}".`); return; }
        conditions.push(pattern.build(pattern.re.exec(text)));
    });

    const steps = [];
    const actionTexts = splitClauses(parts.actionText);
    if (!actionTexts.length) errors.push('The rule does not say what to do.');
    actionTexts.forEach((raw, i) => {
        const text = phrase(raw).replace(/^then\s+/i, '');
        const pattern = ACTION_PATTERNS.find((p) => p.re.test(text));
        if (!pattern) { errors.push(`I do not know the action "${trim(raw)}".`); return; }
        const built = pattern.build(pattern.re.exec(text));
        if (!registry.getAction(built.action)) { errors.push(`This workspace has no "${built.action}" action.`); return; }
        steps.push({ id: `s${i + 1}`, type: 'action', ...built });
    });

    if (errors.length) return { ok: false, errors, ambiguities, rule: null };

    const rule = {
        name: trim(name) || trim(sentence).slice(0, 120),
        version: 2,
        trigger: { type: 'event', event: trigger.event },
        scope: { allProjects: true, projectIds: [] },
        conditions: foldConditions(conditions),
        steps,
    };
    return { ok: true, errors: [], ambiguities, rule };
};

const CHANGE_FIELD_PHRASE = {
    statusType: 'a task status changes to',
    Task_Priority: 'a task priority changes to',
};

const conditionSentence = (node) => {
    if (!node || !node.op) return '';
    const value = node.value;
    switch (`${node.field}:${node.op}`) {
        case 'Task_Priority:eq': return `the priority is ${value}`;
        case 'Task_Priority:neq': return `the priority is not ${value}`;
        case 'statusType:eq': return `the status is ${value}`;
        case 'statusType:neq': return `the status is not ${value}`;
        case 'TaskName:contains': return `the title contains "${value}"`;
        case 'AssigneeUserId:empty': return 'it has no assignee';
        case 'AssigneeUserId:notEmpty': return 'it has an assignee';
        case 'Task_Leader:empty': return 'it has no lead';
        case 'isParentTask:eq': return 'it is a parent task';
        default: return '';
    }
};

const actionSentence = (step) => {
    const config = step.config || {};
    switch (step.action) {
        case 'set_status': return `set the status to ${config.status}`;
        case 'set_priority': return `set the priority to ${config.priority}`;
        case 'add_comment': return `post a comment saying "${config.body}"`;
        case 'create_subtask': return `create a subtask called "${config.title}"`;
        case 'run_agent': return `run the ${config.skill} agent${config.agent ? ` as "${config.agent}"` : ''}`;
        default: return registry.getAction(step.action)?.label || step.action;
    }
};

/* rule → sentence. The output is always in the canonical form parseSentence
 * accepts, so sentence → rule → sentence is a fixed point. */
const describeRule = (rule = {}) => {
    const nodes = unfoldConditions(rule.conditions);
    const changeNode = nodes.find((n) => n && n.op === 'changedTo' && CHANGE_FIELD_PHRASE[n.field]);
    const rest = nodes.filter((n) => n !== changeNode);

    let when = (CANON_TRIGGERS.find((t) => t.event === rule.trigger?.event) || {}).phrase || rule.trigger?.event || 'something happens';
    if (changeNode) when = `${CHANGE_FIELD_PHRASE[changeNode.field]} ${changeNode.value}`;

    const conditionText = rest.map(conditionSentence).filter(Boolean).join(' and ');
    const actionText = (rule.steps || []).filter((s) => s.type === 'action').map(actionSentence).filter(Boolean).join(' and ');
    const head = conditionText ? `When ${when}, if ${conditionText},` : `When ${when},`;
    return `${head} ${actionText || 'do nothing'}.`;
};

/* What the builder needs to render its own vocabulary: every phrase the parser
 * accepts, so the help text can never drift from the grammar. */
const grammar = () => ({
    triggers: [...new Set(CANON_TRIGGERS.map((t) => t.phrase))],
    triggerValues: ['a task status changes to <status>', 'a task priority changes to <priority>'],
    conditions: [
        'the priority is <priority>', 'the priority is not <priority>',
        'the status is <status>', 'the status is not <status>',
        'the title contains "<text>"', 'it has no assignee', 'it has an assignee',
        'it has no lead', 'it is a parent task',
    ],
    actions: [
        'set the status to <status>', 'set the priority to <priority>',
        'post a comment saying "<text>"', 'create a subtask called "<text>"',
        'run the <skill> agent as "<agent name>"',
    ],
    shape: 'When <event>, if <condition> and <condition>, <action> and <action>.',
});

module.exports = { parseSentence, describeRule, grammar, splitClauses, CANON_TRIGGERS };
