// The lines of "this is what will change". The server sends each line as data (Modules/Agents/intentPreview.js) and
// names only what the viewer may see; every entry here turns one kind of line into a label and a text, both drawn
// as text. A new kind of change is one more entry in LINE_KINDS and, for a new heading, one in HEADINGS.

import { AUTOMATION_HEADING, AUTOMATION_LINE_KINDS } from './automationLines';
import { FOLDER_HEADING, SPRINT_HEADING, LIST_SETUP_LINE_KINDS } from './listSetupLines';
import { PROJECT_COPY_HEADING, PROJECT_COPY_LINE_KINDS } from './projectCopyLines';
import { COMPUTED_LINE_KINDS } from './computedLines';
import { DASHBOARD_HEADING, DASHBOARD_LINE_KINDS } from './dashboardLines';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T/;
const PRIORITIES = Object.freeze(['urgent', 'high', 'medium', 'low']);

const textOf = (value) => (typeof value === 'string' ? value.trim() : '');
const countOf = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

const formatted = (locale, options, date) => {
    try {
        return new Intl.DateTimeFormat(locale, options).format(date);
    } catch (error) {
        return new Intl.DateTimeFormat(undefined, options).format(date);
    }
};

const dateText = (locale, value) => {
    const given = textOf(value);
    const isDay = DAY.test(given);
    if (!isDay && !DATE_TIME.test(given)) return given;
    const date = new Date(isDay ? `${given}T00:00:00` : given);
    if (Number.isNaN(date.getTime())) return given;
    return formatted(locale, isDay ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' }, date);
};

const dated = (labelKey) => (t, line, locale) => (textOf(line.date) ? { label: t(labelKey), text: dateText(locale, line.date) } : null);
const named = (labelKey, field) => (t, line) => (textOf(line[field]) ? { label: t(labelKey), text: textOf(line[field]) } : null);

const peopleText = (t, line) => {
    const shown = (Array.isArray(line.names) ? line.names : []).map(textOf).filter(Boolean).join(', ');
    const others = countOf(line.others);
    if (shown && others) return t('IntentPreview.people_and_more', { names: shown, n: others });
    return shown || (others ? t('IntentPreview.people_not_shown', { n: others }, others) : '');
};

const estimateText = (t, minutes) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h && m) return t('IntentPreview.estimate_hours_minutes', { h, m });
    return h ? t('IntentPreview.estimate_hours', { h }) : t('IntentPreview.estimate_minutes', { m });
};

/* What the server may name on a line (Modules/Agents/setupRequests.js); anything else has no words here and is left out. */
const FIELD_TYPES = Object.freeze(['text', 'textarea', 'number', 'money', 'date', 'dropdown', 'checkbox', 'email', 'phone', 'url', 'people', 'rating', 'progress']);
const LAYOUTS = Object.freeze(['list', 'board', 'table', 'calendar', 'workload']);
const GROUPS = Object.freeze(['status', 'assignee', 'priority', 'due_date']);
const SORTS = Object.freeze(['due', 'priority', 'created', 'updated', 'name', 'status', 'assignee', 'points', 'estimate']);
const DUE_SPANS = Object.freeze(['today', 'tomorrow', 'this_week', 'next_week', 'next_7_days', 'this_month', 'overdue']);

const textsOf = (list) => (Array.isArray(list) ? list : []).map(textOf).filter(Boolean);

/* A custom field by its name, a built-in choice in words. */
const chosenText = (t, line, known, prefix) => textOf(line.field) || (known.includes(line.by) ? t(`IntentPreview.${prefix}_${line.by}`) : '');

const tasksText = (t, n) => t('IntentPreview.batch_tasks', { n }, n);

/* What a batch changes, as the label of its line: a field of the task, or the kind of change. */
const BATCH_LABELS = Object.freeze({
    status: 'line_status', priority: 'line_priority', due: 'line_due', start: 'line_start', estimate: 'line_estimate', description: 'line_description',
    title: 'batch_what_title', assignees: 'batch_what_assignees', field: 'line_field', move: 'batch_what_move', archive: 'batch_what_archive',
    restore: 'batch_what_restore', task: 'new_task', subtask: 'new_subtask', comment: 'batch_what_comment', link: 'line_links', other: 'batch_what_other',
    relation_add: 'batch_what_relation_add', relation_remove: 'batch_what_relation_remove', list_add: 'batch_what_list_add', list_remove: 'batch_what_list_remove',
});
const batchLabel = (t, what) => t(`IntentPreview.${Object.hasOwn(BATCH_LABELS, what) ? BATCH_LABELS[what] : BATCH_LABELS.other}`);

const BATCH_VALUES = Object.freeze({
    priority: (t, value) => (PRIORITIES.includes(value.toLowerCase()) ? t(`IntentPreview.priority_${value.toLowerCase()}`) : value),
    due: (t, value, locale) => dateText(locale, value),
    start: (t, value, locale) => dateText(locale, value),
    estimate: (t, value) => (countOf(Number(value)) ? estimateText(t, countOf(Number(value))) : ''),
});

const batchValue = (t, line, locale) => {
    const given = typeof line.value === 'number' ? String(line.value) : textOf(line.value);
    if (!given) return '';
    return Object.hasOwn(BATCH_VALUES, line.what) ? BATCH_VALUES[line.what](t, given, locale) : given;
};

const placeText = (t, line) => {
    const project = textOf(line.project);
    const list = textOf(line.list);
    if (!project) return '';
    return list ? t('IntentPreview.place_in_list', { project, list }) : project;
};

const cutText = (t, line) => {
    const text = textOf(line.value);
    return text && line.more ? t('IntentPreview.description_more', { text }) : text;
};

const ASSIGN_MODES = Object.freeze(['set', 'add', 'remove']);

/* What one change of a batch sets, where it is more than a plain value: people, a place, or a text that may be cut. */
const BATCH_ITEM_VALUES = Object.freeze({
    assignees: (t, line) => {
        const people = peopleText(t, line);
        if (!people) return line.mode === 'set' ? t('IntentPreview.batch_assign_none') : '';
        return ASSIGN_MODES.includes(line.mode) ? t(`IntentPreview.batch_assign_${line.mode}`, { people }) : people;
    },
    move: placeText,
    list_add: placeText,
    list_remove: placeText,
    description: cutText,
    comment: cutText,
});

export const LINE_KINDS = {
    members: (t, line) => (line.only === 'approver' ? { label: t('IntentPreview.line_members'), text: t('IntentPreview.members_only_approver') } : null),
    place: (t, line) => (placeText(t, line) ? { label: t('IntentPreview.line_place'), text: placeText(t, line) } : null),
    parent: named('IntentPreview.line_parent', 'task'),
    assignees: (t, line) => {
        const text = peopleText(t, line);
        return text ? { label: t('IntentPreview.line_assignees'), text } : null;
    },
    due: dated('IntentPreview.line_due'),
    start: dated('IntentPreview.line_start'),
    priority: (t, line) => {
        const value = textOf(line.value);
        if (!value) return null;
        const known = PRIORITIES.includes(value.toLowerCase());
        return { label: t('IntentPreview.line_priority'), text: known ? t(`IntentPreview.priority_${value.toLowerCase()}`) : value };
    },
    status: named('IntentPreview.line_status', 'name'),
    type: named('IntentPreview.line_type', 'name'),
    estimate: (t, line) => (countOf(line.minutes) ? { label: t('IntentPreview.line_estimate'), text: estimateText(t, countOf(line.minutes)) } : null),
    description: (t, line) => {
        const text = textOf(line.text);
        if (!text) return null;
        return { label: t('IntentPreview.line_description'), text: line.more ? t('IntentPreview.description_more', { text }) : text };
    },
    links: (t, line) => (countOf(line.count) ? { label: t('IntentPreview.line_links'), text: t('IntentPreview.links_count', { n: countOf(line.count) }, countOf(line.count)) } : null),
    field: (t, line) => {
        const name = textOf(line.name);
        if (!name) return null;
        const type = FIELD_TYPES.includes(line.type) ? t(`IntentPreview.field_type_${line.type}`) : '';
        const options = textsOf(line.options).join(', ');
        if (!type) return { label: t('IntentPreview.line_field'), text: name };
        return { label: t('IntentPreview.line_field'), text: options ? t('IntentPreview.field_with_options', { name, type, options }) : t('IntentPreview.field_named', { name, type }) };
    },
    ...COMPUTED_LINE_KINDS,
    fieldValue: (t, line) => {
        const [field, task] = [textOf(line.field), textOf(line.task)];
        if (!field || !task) return null;
        const flag = typeof line.checked === 'boolean' ? t(line.checked ? 'IntentPreview.value_yes' : 'IntentPreview.value_no') : '';
        const value = flag || peopleText(t, { names: [line.value], others: line.others }) || t('IntentPreview.value_empty');
        return { label: t('IntentPreview.line_value'), text: t('IntentPreview.value_on_task', { field, task, value }) };
    },
    fieldValuesHidden: (t, line) => (countOf(line.count) ? { label: t('IntentPreview.line_value'), text: t('IntentPreview.values_hidden', { n: countOf(line.count) }, countOf(line.count)) } : null),
    layout: (t, line) => (LAYOUTS.includes(line.value) ? { label: t('IntentPreview.line_layout'), text: t(`IntentPreview.layout_${line.value}`) } : null),
    group: (t, line) => {
        const text = chosenText(t, line, GROUPS, 'group');
        return text ? { label: t('IntentPreview.line_group'), text } : null;
    },
    sort: (t, line) => {
        const by = chosenText(t, line, SORTS, 'sort');
        return by ? { label: t('IntentPreview.line_sort'), text: t(line.descending ? 'IntentPreview.sort_descending' : 'IntentPreview.sort_ascending', { by }) } : null;
    },
    mine: (t) => ({ label: t('IntentPreview.line_shows'), text: t('IntentPreview.shows_mine') }),
    statuses: (t, line) => (textsOf(line.names).length ? { label: t('IntentPreview.line_status'), text: textsOf(line.names).join(', ') } : null),
    priorities: (t, line) => {
        const known = textsOf(line.values).filter((value) => PRIORITIES.includes(value.toLowerCase())).map((value) => t(`IntentPreview.priority_${value.toLowerCase()}`));
        return known.length ? { label: t('IntentPreview.line_priority'), text: known.join(', ') } : null;
    },
    dueFilter: (t, line, locale) => {
        if (DUE_SPANS.includes(line.when)) return { label: t('IntentPreview.line_due'), text: t(`IntentPreview.due_${line.when}`) };
        const [from, to] = [textOf(line.from), textOf(line.to)];
        if (!DAY.test(from) || !DAY.test(to)) return null;
        return { label: t('IntentPreview.line_due'), text: t('IntentPreview.due_range', { from: dateText(locale, from), to: dateText(locale, to) }) };
    },
    search: (t, line) => (textOf(line.text) ? { label: t('IntentPreview.line_search'), text: textOf(line.text) } : null),
    newStatuses: (t, line) => (textsOf(line.names).length ? { label: t('IntentPreview.line_new_statuses'), text: textsOf(line.names).join(', ') } : null),
    newLists: (t, line) => (textsOf(line.names).length ? { label: t('IntentPreview.line_new_lists'), text: textsOf(line.names).join(', ') } : null),
    planView: (t, line) => {
        const name = textOf(line.name);
        if (!name) return null;
        return { label: t('IntentPreview.line_view'), text: LAYOUTS.includes(line.layout) ? t('IntentPreview.view_named', { name, layout: t(`IntentPreview.layout_${line.layout}`) }) : name };
    },
    /* An automation of a plan, in the sentence the Automations page says it in, or why it is not one that can be made. */
    planRule: (t, line) => {
        const problem = textOf(line.problem);
        if (problem) return { label: t('IntentPreview.line_rule'), text: t('IntentPreview.rule_problem', { problem }) };
        return textOf(line.text) ? { label: t('IntentPreview.line_rule'), text: t('IntentPreview.rule_starts_off', { rule: textOf(line.text) }) } : null;
    },
    planTask: (t, line, locale) => {
        const name = textOf(line.name);
        if (!name) return null;
        const person = textOf(line.assignee) || (countOf(line.hidden) ? t('IntentPreview.people_not_shown', { n: 1 }, 1) : '');
        const details = [
            textOf(line.list) && t('IntentPreview.task_in_list', { list: textOf(line.list) }),
            textOf(line.status) && t('IntentPreview.task_in_status', { status: textOf(line.status) }),
            person && t('IntentPreview.task_for', { person }),
            textOf(line.due) && t('IntentPreview.task_due', { date: dateText(locale, line.due) }),
        ].filter(Boolean);
        return { label: t('IntentPreview.line_first_task'), text: details.length ? t('IntentPreview.task_with', { name, details: details.join(', ') }) : name };
    },
    columns: (t, line) => {
        const shown = textsOf(line.names).join(', ');
        const others = countOf(line.others);
        if (shown && others) return { label: t('IntentPreview.line_columns'), text: t('IntentPreview.people_and_more', { names: shown, n: others }) };
        const text = shown || (others ? t('IntentPreview.fields_not_shown', { n: others }, others) : '');
        return text ? { label: t('IntentPreview.line_columns'), text } : null;
    },
    batchChange: (t, line, locale) => {
        const n = countOf(line.count);
        if (!n) return null;
        const label = batchLabel(t, line.what);
        const tasks = tasksText(t, n);
        if (line.mixed) return { label, text: t('IntentPreview.batch_mixed_on', { tasks }) };
        const value = batchValue(t, line, locale);
        return { label, text: value ? t('IntentPreview.batch_value_on', { value, tasks }) : tasks };
    },
    /* One change of a batch that the lines above it do not say in full: what it sets, and the task it sets it on. */
    batchItem: (t, line, locale) => {
        const value = Object.hasOwn(BATCH_ITEM_VALUES, line.what) ? BATCH_ITEM_VALUES[line.what](t, line) : batchValue(t, line, locale);
        const task = textOf(line.task);
        if (!value && !task) return null;
        return { label: batchLabel(t, line.what), text: value && task ? t('IntentPreview.batch_item_on', { value, task }) : value || task };
    },
    /* The tasks a batch names. `open` are the ones the viewer can open, each drawn as a button; `text` is the rest, as a count. */
    batchTasks: (t, line) => {
        const open = (Array.isArray(line.tasks) ? line.tasks : []).filter((task) => task && textOf(task.name) && textOf(task.taskId));
        const others = countOf(line.others);
        if (!open.length) return others ? { label: t('IntentPreview.line_batch_tasks'), text: t('IntentPreview.tasks_not_shown', { n: others }, others) } : null;
        return { label: t('IntentPreview.line_batch_tasks'), open, text: others ? t('IntentPreview.tasks_and_more', { n: others }) : '' };
    },
    ...AUTOMATION_LINE_KINDS,
    ...LIST_SETUP_LINE_KINDS,
    ...PROJECT_COPY_LINE_KINDS,
    ...DASHBOARD_LINE_KINDS,
};

const HEADINGS = Object.freeze({
    task: { kind: 'IntentPreview.new_task', wants: 'IntentPreview.wants_task' },
    subtask: { kind: 'IntentPreview.new_subtask', wants: 'IntentPreview.wants_subtask' },
    fields: { kind: 'IntentPreview.new_fields', wants: 'IntentPreview.wants_fields' },
    view: { kind: 'IntentPreview.new_view', wants: 'IntentPreview.wants_view' },
    setup: { kind: 'IntentPreview.new_setup', wants: 'IntentPreview.wants_setup' },
    project: { kind: 'IntentPreview.new_project', wants: 'IntentPreview.wants_project' },
    projectCopy: PROJECT_COPY_HEADING,
    batch: { kind: 'IntentPreview.batch_kind' },
    automation: AUTOMATION_HEADING,
    folder: FOLDER_HEADING,
    sprint: SPRINT_HEADING,
    dashboardCard: DASHBOARD_HEADING,
});

const isBatch = (preview) => Boolean(preview) && preview.kind === 'batch';
const batchCount = (preview) => countOf(preview.tasks) || countOf(preview.changes);
const batchWord = (preview) => (countOf(preview.tasks) ? 'tasks' : 'changes');

/* A card's own title: the name of what is created, or for a batch how much it changes. */
export const titleOf = (t, preview) => {
    if (isBatch(preview)) return t(`IntentPreview.batch_${batchWord(preview)}`, { n: batchCount(preview) }, batchCount(preview));
    return textOf(preview?.title);
};

const headingOf = (preview) => (preview && Object.hasOwn(HEADINGS, preview.kind) ? HEADINGS[preview.kind] : null);

export const kindLabel = (t, preview) => {
    if (isBatch(preview) && countOf(preview.changes) === 1) return t('IntentPreview.batch_kind_one');
    return headingOf(preview) ? t(headingOf(preview).kind) : '';
};

/* Which part of a plan a line stands for, or belongs under, so it can be left out (./planPicks.js). */
const pickOf = (line) => ({
    ...(typeof line.pick === 'string' ? { pick: line.pick } : {}),
    ...(typeof line.under === 'string' ? { under: line.under } : {}),
    ...(Array.isArray(line.picks) ? { picks: line.picks.map((key, at) => ({ key, name: textOf((Array.isArray(line.names) ? line.names : [])[at]) })).filter((pick) => typeof pick.key === 'string' && pick.name) } : {}),
});

export const linesOf = (t, locale, preview) => (Array.isArray(preview?.lines) ? preview.lines : [])
    .filter((line) => line && typeof line === 'object' && Object.hasOwn(LINE_KINDS, line.kind))
    .map((line) => ({ kind: line.kind, ...LINE_KINDS[line.kind](t, line, locale), ...pickOf(line) }))
    .filter((line) => line.text || line.open);

/* "create the task “Fix the login bug”", to follow "<agent> wants to"; '' for a preview that cannot be put that way. */
export const intentTitle = (t, preview) => {
    if (isBatch(preview)) return batchCount(preview) ? t(`IntentPreview.wants_batch_${batchWord(preview)}`, { n: batchCount(preview) }, batchCount(preview)) : '';
    return headingOf(preview) && textOf(preview.title) ? t(headingOf(preview).wants, { title: textOf(preview.title) }) : '';
};

export const intentSummary = (t, preview) => (headingOf(preview) ? t('IntentPreview.summary', { kind: kindLabel(t, preview), title: titleOf(t, preview) }) : '');
