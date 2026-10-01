/* Where a comment was imported from is written by the importers (Modules/Importers) alone; a client posting or
 * editing a comment never carries it. */
const IMPORT_FIELDS = ['importedFrom'];

const withoutImportFields = (data) => {
    if (!data || typeof data !== 'object') return data;
    const kept = { ...data };
    IMPORT_FIELDS.forEach((field) => { delete kept[field]; });
    return kept;
};

module.exports = { IMPORT_FIELDS, withoutImportFields };
