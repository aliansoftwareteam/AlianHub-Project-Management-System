const mongoose = require('mongoose');

const VIEW_ID_LENGTH = 24;

const idText = (value) => (value === undefined || value === null ? '' : String(value));

const catalogueIdFor = (entry, catalogue) => {
    const rows = Array.isArray(catalogue) ? catalogue : [];
    // keyName first: `name` is the label an owner can rename in the view catalogue.
    const row = (entry.keyName && rows.find((item) => item && item.keyName === entry.keyName))
        || (entry.name && rows.find((item) => item && item.name === entry.name));
    const id = row ? idText(row.id || row._id) : '';
    return id.length === VIEW_ID_LENGTH ? id : '';
};

/* A view entry's `_id` is the company's project_tab_components row id, as a string. The
 * project view bar reads its length to tell a view (24) from an embed (6), and a rename,
 * pin or delete matches it with `===` against an id the browser sends as a string.
 *
 * A template view the company's catalogue does not carry matched no row and was stored
 * with no `_id` at all, which is neither, so the view bar threw on it. Such an entry gets
 * a fresh id here; an entry that already has one is never renumbered, because the ids
 * already stored are what those later writes match on. */
const withViewId = (entry, catalogue) => {
    if (!entry || typeof entry !== 'object') return entry;
    if (idText(entry._id)) return entry;
    return { ...entry, _id: catalogueIdFor(entry, catalogue) || new mongoose.Types.ObjectId().toString() };
};

const withViewIds = (entries, catalogue) => (Array.isArray(entries) ? entries.map((entry) => withViewId(entry, catalogue)) : entries);

const isMissingViewId = (entry) => !(entry && typeof entry === 'object' && idText(entry._id));

module.exports = { VIEW_ID_LENGTH, withViewId, withViewIds, isMissingViewId };
