export function taskPoints(task) {
    const raw = task?.points;
    if (raw === undefined || raw === null || raw === '') return null;
    const points = Number(raw);
    return Number.isFinite(points) ? points : null;
}

/* "1h 30m", "90m", "2h" and a bare "1.5" (hours) all read as minutes; null is not a duration. */
export function parseEstimate(text) {
    const value = String(text ?? '').trim().toLowerCase();
    if (!value) return 0;
    if (/^\d+(\.\d+)?$/.test(value)) return Math.round(parseFloat(value) * 60);
    const match = value.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/);
    if (!match || (match[1] === undefined && match[2] === undefined)) return null;
    return Math.round(parseFloat(match[1] || 0) * 60) + parseInt(match[2] || 0, 10);
}

/* Parent rows only: a subtask's points are already part of the story its parent sizes. */
export function pointsTotal(tasks) {
    const total = (tasks || []).reduce((sum, task) => sum + (task?.isParentTask === false ? 0 : (taskPoints(task) || 0)), 0);
    return Math.round(total * 100) / 100;
}
