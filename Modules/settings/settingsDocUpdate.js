const WRITABLE_OPERATORS = Object.freeze(['$set', '$push', '$pull']);

/* The settings collection holds every catalogue, so a write must name its own document and only edit its entries. */
const settingsDocUpdateProblem = (docName, queryFilter, queryObj) => {
    if (!queryFilter || typeof queryFilter !== 'object' || queryFilter.name !== docName) return `queryFilter must name the ${docName} document.`;
    if (Object.keys(queryFilter).some((key) => key.startsWith('$'))) return 'queryFilter cannot use operators.';
    const operators = queryObj && typeof queryObj === 'object' ? Object.keys(queryObj) : [];
    if (!operators.length || operators.some((op) => !WRITABLE_OPERATORS.includes(op))) return `queryObj may only use ${WRITABLE_OPERATORS.join(', ')}.`;
    return '';
};

module.exports = { settingsDocUpdateProblem };
