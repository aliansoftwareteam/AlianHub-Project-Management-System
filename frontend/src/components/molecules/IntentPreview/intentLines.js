// The lines of "this is what will change". The server sends each line as data (Modules/Agents/intentPreview.js) and
// names only what the viewer may see; every entry here turns one kind of line into a label and a text, both drawn
// as text. A new kind of change is one more entry in LINE_KINDS and, for a new heading, one in HEADINGS.

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

export const LINE_KINDS = {
    place: (t, line) => {
        const project = textOf(line.project);
        const list = textOf(line.list);
        if (!project) return null;
        return { label: t('IntentPreview.line_place'), text: list ? t('IntentPreview.place_in_list', { project, list }) : project };
    },
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
};

const HEADINGS = Object.freeze({
    task: { kind: 'IntentPreview.new_task', wants: 'IntentPreview.wants_task' },
    subtask: { kind: 'IntentPreview.new_subtask', wants: 'IntentPreview.wants_subtask' },
});

const headingOf = (preview) => (preview && Object.hasOwn(HEADINGS, preview.kind) ? HEADINGS[preview.kind] : null);

export const kindLabel = (t, preview) => (headingOf(preview) ? t(headingOf(preview).kind) : '');

export const linesOf = (t, locale, preview) => (Array.isArray(preview?.lines) ? preview.lines : [])
    .filter((line) => line && typeof line === 'object' && Object.hasOwn(LINE_KINDS, line.kind))
    .map((line) => ({ kind: line.kind, ...LINE_KINDS[line.kind](t, line, locale) }))
    .filter((line) => line.text);

/* "create the task “Fix the login bug”", to follow "<agent> wants to"; '' for a preview that cannot be put that way. */
export const intentTitle = (t, preview) => (headingOf(preview) && textOf(preview.title) ? t(headingOf(preview).wants, { title: textOf(preview.title) }) : '');

export const intentSummary = (t, preview) => (headingOf(preview) ? t('IntentPreview.summary', { kind: kindLabel(t, preview), title: textOf(preview.title) }) : '');
