const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const CHIPS = ['all', 'tasks', 'projects', 'docs', 'people'];
export const RECORD_CHIPS = ['tasks', 'projects', 'docs'];

const KIND_OF_CHIP = { tasks: 'task', projects: 'project', docs: 'page', people: 'person' };

/* Which rows a chip keeps. "ask" stays under every chip so the query can always go to AI. */
export function chipAllows(chip, kind) {
    if (chip === 'all' || kind === 'ask') return true;
    return KIND_OF_CHIP[chip] === kind;
}

const COMMAND_LEAD_MIN = 3;

/* Commands go first when the query starts one of their labels, so "new task" + Enter runs
 * the command rather than a record search or Ask AI. */
export function commandLeads(query, labels) {
    const q = String(query || '').trim().toLowerCase();
    if (q.length < COMMAND_LEAD_MIN) return false;
    return (labels || []).some((label) => String(label || '').toLowerCase().startsWith(q)) || Boolean(commandArgument(query, labels));
}

export function commandArgument(query, labels) {
    const q = String(query || '').trim();
    const lower = q.toLowerCase();
    const label = (labels || []).map((l) => String(l || '').toLowerCase()).find((l) => l && lower.startsWith(`${l} `));
    return label ? q.slice(label.length).trim() : '';
}

export function relativeAge(value, t, now = Date.now()) {
    if (!value) return '';
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) return '';
    const diff = Math.max(0, now - time);
    if (diff < MINUTE) return t('Palette.age_now');
    if (diff < HOUR) return t('Palette.age_minutes', { n: Math.floor(diff / MINUTE) });
    if (diff < DAY) return t('Palette.age_hours', { n: Math.floor(diff / HOUR) });
    if (diff < 30 * DAY) return t('Palette.age_days', { n: Math.floor(diff / DAY) });
    if (diff < 365 * DAY) return t('Palette.age_months', { n: Math.floor(diff / (30 * DAY)) });
    return t('Palette.age_years', { n: Math.floor(diff / (365 * DAY)) });
}

export function taskLocation(task, projectName) {
    const sprint = (task && task.sprintArray) || {};
    return [projectName, sprint.folderName || (task && task.folderName), sprint.name || (task && task.sprintName)]
        .filter(Boolean)
        .join(' / ');
}

export function taskPath(cid, task) {
    const base = `/${cid}/project/${task.ProjectID}`;
    return task.folderObjId ? `${base}/fs/${task.folderObjId}/${task.sprintId}/${task._id}` : `${base}/s/${task.sprintId}/${task._id}`;
}

export function projectPath(cid, project) {
    const base = `/${cid}/project/${project._id}`;
    if (!project.sprintId) return `${base}/p?tab=ProjectListView`;
    return project.folderId ? `${base}/fs/${project.folderId}/${project.sprintId}?tab=ProjectListView` : `${base}/s/${project.sprintId}?tab=ProjectListView`;
}
