const DAY_MS = 24 * 60 * 60 * 1000;
const dayOf = (value) => Math.floor(new Date(value).getTime() / DAY_MS);

export function snappedBack(task, dragged) {
    return dayOf(task.startDate) === dayOf(dragged.start_date) && dayOf(task.DueDate) === dayOf(dragged.end_date);
}
