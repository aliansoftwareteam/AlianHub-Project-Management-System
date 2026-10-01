const startOfToday = () => new Date(new Date().setHours(0, 0, 0, 0));
const endOfToday = () => new Date(new Date().setHours(23, 59, 59, 999));

/* A field saved through the API or an import has no fieldPastFuture, which means no limit; an empty list is the form's "neither", so today only. */
export function dateFieldLimits(field) {
    const allowed = field?.fieldPastFuture;
    if (!Array.isArray(allowed)) return { minDate: '', maxDate: '' };
    return {
        minDate: allowed.includes('Past') ? '' : startOfToday(),
        maxDate: allowed.includes('Future') ? '' : endOfToday()
    };
}
