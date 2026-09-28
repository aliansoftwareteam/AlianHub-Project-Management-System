const WRITABLE_OPERATORS = Object.freeze(['$set', '$push', '$pull']);

/* The settings collection holds every catalogue, so a write must name its own document and only edit its entries. */
const settingsDocUpdateProblem = (docName, queryFilter, queryObj) => {
    if (!queryFilter || typeof queryFilter !== 'object' || queryFilter.name !== docName) return `queryFilter must name the ${docName} document.`;
    if (Object.keys(queryFilter).some((key) => key.startsWith('$'))) return 'queryFilter cannot use operators.';
    const operators = queryObj && typeof queryObj === 'object' ? Object.keys(queryObj) : [];
    if (!operators.length || operators.some((op) => !WRITABLE_OPERATORS.includes(op))) return `queryObj may only use ${WRITABLE_OPERATORS.join(', ')}.`;
    return '';
};

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/* Stored as given: a `$` key would be read as an operator or a query condition, so none is accepted. */
const isPlainData = (value) => {
    if (Array.isArray(value)) return value.every(isPlainData);
    if (!isPlainObject(value)) return typeof value !== 'function';
    return Object.keys(value).every((key) => !key.startsWith('$') && isPlainData(value[key]));
};

const isEntry = (value) => isPlainObject(value) && isPlainData(value);
const isEntryList = (value) => Array.isArray(value) && value.every(isEntry);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;

const ENTRY_EDITS = Object.freeze({ $push: { settings: isEntry }, $pull: { settings: isEntry } });

/* What each settings screen sends: one operator over the fields listed, each value passing its check. */
const SETTINGS_UPDATES = Object.freeze({
    rule: { $set: { roles: isEntryList } },
    templateName: { $set: { TemplateName: isText } },
    dateFormat: { $set: { settings: isEntryList } },
    catalogue: ENTRY_EDITS,
    milestoneStatus: { ...ENTRY_EDITS, $set: { 'settings.$[elementIndex]': isEntry } },
});

const settingsUpdateProblem = (allowed, key, updateObject) => {
    const fields = typeof key === 'string' && hasOwn(allowed, key) ? allowed[key] : null;
    if (!fields) return `key must be one of ${Object.keys(allowed).join(', ')}.`;
    if (!isPlainObject(updateObject) || !Object.keys(updateObject).length) return 'updateObject must be an object of fields.';
    const refused = Object.keys(updateObject).filter((field) => !hasOwn(fields, field) || !fields[field](updateObject[field]));
    return refused.length ? `${key} may only change ${Object.keys(fields).join(', ')} with values of their kind; refused: ${refused.join(', ')}.` : '';
};

/* The milestone editor finds the entry it edits by its value. */
const milestoneArrayFiltersProblem = (key, arrayFilters) => {
    if (arrayFilters === undefined || arrayFilters === null) return '';
    const valid = key === '$set' && Array.isArray(arrayFilters) && arrayFilters.length === 1
        && isPlainObject(arrayFilters[0])
        && Object.keys(arrayFilters[0]).length === 1
        && isText(arrayFilters[0]['elementIndex.value']);
    return valid ? '' : "arrayFilters may only pick one entry by value, as [{ 'elementIndex.value': <value> }] with $set.";
};

module.exports = { settingsDocUpdateProblem, settingsUpdateProblem, milestoneArrayFiltersProblem, SETTINGS_UPDATES };
