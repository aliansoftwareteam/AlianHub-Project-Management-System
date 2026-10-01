const { isBlank, wholeNumberOf } = require('./shared');

const DEFAULT_MAX = 10;
const MAX_RANGE = Object.freeze({ min: 1, max: 20 });
const KINDS = Object.freeze(['any', 'images', 'documents']);
const NAME_MAX = 255;
const TYPE_MAX = 100;

/* SVG is left out of images on purpose: opened from the app's origin or a signed link it is a scripted document, not a picture. */
const EXTENSIONS = Object.freeze({
    images: Object.freeze(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']),
    documents: Object.freeze(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'md', 'rtf', 'odt', 'ods', 'odp']),
});

/* The folder a field's files are stored in names their project, task and field. The company is the bucket the key is read
   from, so a key that matches is a file of this company. The segment after Sprint/ is the task id, as for task attachments. */
const FIELD_FILE = /^Project\/([a-f0-9]{24})\/Sprint\/([a-f0-9]{24})\/Field\/([a-f0-9]{24})\/([^/]+)$/i;

const NOT_FILES = 'A files field holds a list of uploaded files.';

const fieldFileKey = (key) => {
    const match = typeof key === 'string' ? FIELD_FILE.exec(key) : null;
    if (!match || ['.', '..'].includes(match[4])) return null;
    return { projectId: match[1].toLowerCase(), taskId: match[2].toLowerCase(), fieldId: match[3].toLowerCase(), name: match[4] };
};

const fieldFilePath = ({ projectId, taskId, fieldId, name }) => `Project/${projectId}/Sprint/${taskId}/Field/${fieldId}/${name}`;

const extensionOf = (name) => {
    const dot = String(name || '').lastIndexOf('.');
    return dot === -1 ? '' : String(name).slice(dot + 1).toLowerCase();
};

const kindOf = (name) => Object.keys(EXTENSIONS).find((kind) => EXTENSIONS[kind].includes(extensionOf(name))) || 'other';

const maxOf = (definition) => {
    const max = wholeNumberOf(definition && definition.fieldFilesMax);
    return max !== null && max >= MAX_RANGE.min && max <= MAX_RANGE.max ? max : DEFAULT_MAX;
};

const kindsOf = (definition) => (definition && KINDS.includes(definition.fieldFilesKind) ? definition.fieldFilesKind : 'any');

function settings(definition) {
    const max = isBlank(definition.fieldFilesMax) ? DEFAULT_MAX : wholeNumberOf(definition.fieldFilesMax);
    if (max === null || max < MAX_RANGE.min || max > MAX_RANGE.max) return { error: `A files field holds at most a whole number of files from ${MAX_RANGE.min} to ${MAX_RANGE.max}.` };
    const kind = isBlank(definition.fieldFilesKind) ? 'any' : definition.fieldFilesKind;
    if (!KINDS.includes(kind)) return { error: `A files field allows ${KINDS.join(', ')}.` };
    return { settings: { fieldFilesMax: max, fieldFilesKind: kind } };
}

const isText = (value, max) => typeof value === 'string' && value.trim() !== '' && value.length <= max;

const stampOf = (entry) => ({
    ...(typeof entry.uploadedBy === 'string' && entry.uploadedBy ? { uploadedBy: entry.uploadedBy } : {}),
    ...(entry.uploadedAt ? { uploadedAt: entry.uploadedAt } : {}),
});

const fileOf = (entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
    if (!fieldFileKey(entry.key) || !isText(entry.name, NAME_MAX)) return null;
    if (typeof entry.size !== 'number' || !Number.isFinite(entry.size) || entry.size < 0) return null;
    const type = typeof entry.type === 'string' ? entry.type.slice(0, TYPE_MAX) : '';
    return { key: entry.key, name: entry.name.trim(), size: entry.size, type, ...stampOf(entry) };
};

/* Whether each key belongs to this task and this field is the server's to answer; this checks the shape, the cap and the kinds. */
function parse(value, definition) {
    if (isBlank(value)) return { value: [] };
    if (!Array.isArray(value)) return { error: NOT_FILES };
    const stored = value.map(fileOf);
    if (stored.includes(null) || new Set(stored.map((file) => file.key)).size !== stored.length) return { error: NOT_FILES };
    const max = maxOf(definition);
    if (stored.length > max) return { error: `This field holds at most ${max} files.` };
    const kind = kindsOf(definition);
    if (kind !== 'any' && stored.some((file) => kindOf(fieldFileKey(file.key).name) !== kind)) return { error: `This field holds ${kind} only.` };
    return { value: stored };
}

const filesOf = (value) => (Array.isArray(value) ? value.filter((file) => file && typeof file === 'object' && fieldFileKey(file.key)) : []);

const text = (value) => filesOf(value).map((file) => String(file.name || '')).filter(Boolean).join(', ');

const sortValue = () => null;

module.exports = {
    type: 'files', empty: Object.freeze([]), sortable: false, DEFAULT_MAX, MAX_RANGE, KINDS, EXTENSIONS,
    fieldFileKey, fieldFilePath, kindOf, maxOf, kindsOf, filesOf, settings, parse, text, sortValue,
};
