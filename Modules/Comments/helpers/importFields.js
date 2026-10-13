/* Where a comment was imported from, the import job that saved it and what tells it from the other comments of its
 * task in the file are written by the importers (Modules/Importers) alone; a client posting or editing a comment never
 * carries them. */
const IMPORT_FIELDS = ['importedFrom', 'importJobId', 'importKey'];

const withoutImportFields = (data) => {
    if (!data || typeof data !== 'object') return data;
    const kept = { ...data };
    IMPORT_FIELDS.forEach((field) => { delete kept[field]; });
    return kept;
};

module.exports = { IMPORT_FIELDS, withoutImportFields };
