// The lines of a timesheet week an agent asks to send for approval (Modules/Agents/timesheetWeek.js). The server sends
// the week's first and last day as YYYY-MM-DD, and the note as the proposal's own text.

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const textOf = (value) => (typeof value === 'string' ? value.trim() : '');

const dayText = (locale, value) => {
    const given = textOf(value);
    if (!DAY.test(given)) return '';
    const date = new Date(`${given}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    try {
        return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
    } catch (error) {
        return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
    }
};

export const TIMESHEET_HEADING = Object.freeze({ kind: 'IntentPreview.new_timesheet_week', wants: 'IntentPreview.wants_timesheet_week' });

export const TIMESHEET_LINE_KINDS = {
    timesheetWeek: (t, line, locale) => {
        const from = dayText(locale, line.from);
        const to = dayText(locale, line.to);
        return from && to ? { label: t('IntentPreview.line_timesheet_week'), text: t('IntentPreview.timesheet_week_span', { from, to }) } : null;
    },
    timesheetNote: (t, line) => (textOf(line.text) ? { label: t('IntentPreview.line_timesheet_note'), text: textOf(line.text) } : null),
};
