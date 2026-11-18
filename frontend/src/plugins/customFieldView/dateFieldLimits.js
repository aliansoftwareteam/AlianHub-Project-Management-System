import { PAST, FUTURE, pastFutureOf } from '@datePastFuture';

const startOfToday = () => new Date(new Date().setHours(0, 0, 0, 0));
const endOfToday = () => new Date(new Date().setHours(23, 59, 59, 999));

/*
 * No stored list allows both: a field saved through the API or an import never had one.
 * An empty list is the form's "neither". A list of words nobody can read is not that choice, so it allows both too.
 */
export function storedPastFuture(field) {
    const stored = field?.fieldPastFuture;
    if (!Array.isArray(stored)) return [PAST, FUTURE];
    const read = stored.map(pastFutureOf);
    const allowed = [PAST, FUTURE].filter((word) => read.includes(word));
    return stored.length && !allowed.length ? [PAST, FUTURE] : allowed;
}

export const holdsTime = (field) => Boolean(field?.fieldTimeFormate);

/*
 * The picker hands back the picked day at the current time of day. A field without a time keeps the start
 * of that day instead, the instant the List cell stores, so every place that shows or groups it reads one day.
 */
export function pickedDateValue(field, picked) {
    if (!picked || holdsTime(field)) return picked;
    const day = new Date(picked);
    if (Number.isNaN(day.getTime())) return picked;
    day.setHours(0, 0, 0, 0);
    return day;
}

export function dateFieldLimits(field) {
    const allowed = storedPastFuture(field);
    return {
        minDate: allowed.includes(PAST) ? '' : startOfToday(),
        maxDate: allowed.includes(FUTURE) ? '' : endOfToday()
    };
}
