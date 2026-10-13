/* Companies this process is deleting, or has deleted, since it started. Kept after the drop:
 * a deleted company's id comes back only through a restore, which clears the set. */
const retiring = new Set();

exports.markRetiring = (db) => retiring.add(String(db));
exports.clearRetiring = (db) => retiring.delete(String(db));
exports.isRetiring = (db) => retiring.has(String(db));
exports.clearAllRetiring = () => retiring.clear();

exports.retiringRefusal = () => ({ status: false, statusCode: 404, statusText: 'This company is being deleted.' });
