// The lines of a waiting copy of a project (Modules/Agents/projectDuplicatePreview.js). The number of tasks is the
// number the person looking would copy by approving it; `limit` is set when that is more than such a copy takes.

const textOf = (value) => (typeof value === 'string' ? value.trim() : '');
const countOf = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

const tasksText = (t, line) => {
    if (line.asked !== true) return t('IntentPreview.copy_tasks_none');
    const n = countOf(line.count);
    if (!n) return t('IntentPreview.copy_tasks_zero');
    return countOf(line.limit) ? t('IntentPreview.copy_tasks_too_many', { n, limit: countOf(line.limit) }) : t('IntentPreview.copy_tasks_count', { n }, n);
};

export const PROJECT_COPY_HEADING = Object.freeze({ kind: 'IntentPreview.new_project_copy', wants: 'IntentPreview.wants_project_copy' });

export const PROJECT_COPY_LINE_KINDS = {
    copyOf: (t, line) => (textOf(line.project) ? { label: t('IntentPreview.line_copy_of'), text: textOf(line.project) } : null),
    copyParts: (t) => ({ label: t('IntentPreview.line_copy_parts'), text: t('IntentPreview.copy_parts') }),
    copyTasks: (t, line) => ({ label: t('IntentPreview.line_copy_tasks'), text: tasksText(t, line) }),
    copyDates: (t) => ({ label: t('IntentPreview.line_copy_dates'), text: t('IntentPreview.copy_dates_kept') }),
};
