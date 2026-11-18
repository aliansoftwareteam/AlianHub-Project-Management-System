const { PAST, FUTURE } = require('./datePastFuture');

/* The task panel and the List read these settings on every render, and only the field form in the web app sends them. */
const TYPE_DEFAULTS = new Map([
    ['date', () => ({ fieldPastFuture: [PAST, FUTURE], fieldDaysDisable: [] })],
    ['dropdown', () => ({ fieldOptions: [] })],
]);

const withFieldDefaults = (field) => {
    const defaults = TYPE_DEFAULTS.get(field && field.fieldType);
    if (!defaults) return field;
    const missing = Object.entries(defaults()).filter(([name]) => field[name] === undefined || field[name] === null);
    return { ...field, ...Object.fromEntries(missing) };
};

module.exports = { withFieldDefaults };
