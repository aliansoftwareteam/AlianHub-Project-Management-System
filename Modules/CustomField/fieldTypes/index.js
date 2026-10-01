/* One module per field type, read by the API and, through the @fieldTypes alias, by the web app, so both agree on what a value is.
 *
 * Each module exports:
 *   type                                    the fieldType it handles
 *   empty                                   what a cleared value is stored as
 *   settings(definition)                    { settings }: the definition properties the type owns, cleaned and defaulted, or { error }
 *   parse(value, definition)                { value } in its stored form, or { error }
 *   text(value, definition, context)        the value as one line of text, '' for nothing
 *   sortValue(value, definition, context)   a number or a string to order by, null for nothing
 *   fromInput(typed)                        optional: what a person typed, as the value to parse
 *   sortable                                optional: false for a type no view sorts by
 *   sideStored                              optional: true when the value is kept beside the task (helpers/fieldLinks.js) and read per viewer
 *   castOnly                                optional: true when no caller writes the value; each person adds or withdraws their own part
 */
const people = require('./people');
const url = require('./url');
const rating = require('./rating');
const progress = require('./progress');
const files = require('./files');
const relationship = require('./relationship');
const voting = require('./voting');

const MODULES = Object.freeze({ people, url, rating, progress, files, relationship, voting });
const MODULE_FIELD_TYPES = Object.freeze(Object.keys(MODULES));

const typeModuleOf = (fieldType) => (MODULE_FIELD_TYPES.includes(fieldType) ? MODULES[fieldType] : null);

module.exports = { MODULE_FIELD_TYPES, typeModuleOf };
