// The lines of a waiting folder and of a list waiting to become a sprint (Modules/Agents/listSetupPreview.js).
// A sprint's days arrive as days when they are asked for and as moments when the list already has them; both are
// shown as days where the viewer is.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MEDIUM = Object.freeze({ dateStyle: 'medium' });

const textOf = (value) => (typeof value === 'string' ? value.trim() : '');
const countOf = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
const named = (labelKey) => (t, line) => (textOf(line.name) ? { label: t(labelKey), text: textOf(line.name) } : null);

const dayText = (locale, value) => {
    const given = textOf(value);
    const date = new Date(DAY.test(given) ? `${given}T00:00:00` : given);
    if (!given || Number.isNaN(date.getTime())) return '';
    try {
        return new Intl.DateTimeFormat(locale, MEDIUM).format(date);
    } catch (error) {
        return new Intl.DateTimeFormat(undefined, MEDIUM).format(date);
    }
};

const days = (labelKey) => (t, line, locale) => {
    const [from, to] = [dayText(locale, line.from), dayText(locale, line.to)];
    return from && to ? { label: t(labelKey), text: t('IntentPreview.due_range', { from, to }) } : null;
};

export const FOLDER_HEADING = Object.freeze({ kind: 'IntentPreview.new_folder', wants: 'IntentPreview.wants_folder' });
export const SPRINT_HEADING = Object.freeze({ kind: 'Scrum.preview_kind', wants: 'Scrum.preview_wants' });

export const LIST_SETUP_LINE_KINDS = {
    inFolder: named('IntentPreview.line_inside'),
    subfolder: named('IntentPreview.line_subfolder'),
    movedLists: (t, line) => {
        const shown = (Array.isArray(line.names) ? line.names : []).map(textOf).filter(Boolean).join(', ');
        const others = countOf(line.others);
        const hidden = others ? t('IntentPreview.lists_not_shown', { n: others }, others) : '';
        const text = shown && hidden ? t('IntentPreview.lists_and_hidden', { names: shown, hidden }) : shown || hidden;
        return text ? { label: t('IntentPreview.line_moved_lists'), text } : null;
    },
    sprintDays: days('Scrum.preview_days'),
    sprintDaysNow: days('Scrum.preview_days_now'),
};
