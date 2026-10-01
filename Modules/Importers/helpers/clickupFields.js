/* ClickUp custom-field columns as AlianHub fields: which type each becomes, which definition it lands on, and what each
 * cell is stored as. Pure, no I/O; the importer and its preview both plan with it. */
const crypto = require('crypto');
const { defaultCustomFields } = require('../../../utils/Tempates/customFields');
const { storedValueOf, isTaskFieldOf, optionsOf, optionLabel } = require('../../CustomField/helpers/fieldValueInput');
const { typeModuleOf } = require('../../CustomField/fieldTypes');
const { PAST, FUTURE } = require('../../CustomField/helpers/datePastFuture');
const { parseClickUpDate } = require('./clickupDetails');

/* ClickUp's type, as its export names it in "<field> (<type>)", to the field type here. A type that is not listed
 * becomes a text field holding the cell as written, and the import says so. */
const FIELD_TYPES = Object.freeze({
    short_text: 'text',
    text: 'textarea',
    long_text: 'textarea',
    number: 'number',
    currency: 'money',
    money: 'money',
    date: 'date',
    drop_down: 'dropdown',
    dropdown: 'dropdown',
    labels: 'dropdown',
    checkbox: 'checkbox',
    email: 'email',
    phone: 'phone',
    url: 'url',
    website: 'url',
    users: 'people',
    people: 'people',
    rating: 'rating',
    emoji: 'rating',
    manual_progress: 'progress',
    progress: 'progress',
});

const FALLBACK_TYPE = 'text';
const COMPATIBLE = Object.freeze({ text: ['text', 'textarea'], textarea: ['textarea', 'text'] });
const MAX_OPTIONS = 100;
const OPTION_COLORS = ['#2F3990', '#1E88E5', '#00897B', '#43A047', '#F4511E', '#8E24AA', '#D81B60', '#6D4C41'];
const RATING = Object.freeze({ least: 5, most: 10 });
const NO_PERMISSION = 'no_permission';
const MISFIT = Object.freeze({ error: true });

const trimmed = (value) => (value === undefined || value === null ? '' : String(value).trim());
const lower = (value) => trimmed(value).toLowerCase();
const listOf = (raw) => trimmed(raw).replace(/^\[|\]$/g, '').split(/[,;]/).map((entry) => entry.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
const uniqueBy = (values, key) => values.filter((value, index) => values.findIndex((other) => key(other) === key(value)) === index);

const fieldTypeOf = (label) => {
    const clickUpType = lower(label).replace(/\s+/g, '_');
    const type = Object.hasOwn(FIELD_TYPES, clickUpType) ? FIELD_TYPES[clickUpType] : '';
    return { clickUpType, type: type || FALLBACK_TYPE, asText: !type };
};

const PLAIN_NUMBER = /^[-+]?\d+(\.\d+)?$/;
const GROUPED_NUMBER = /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/;

/* "1,200.50" and "$1200.5" are numbers; a comma that is not a thousands separator is not guessed at. */
const numberText = (raw) => {
    const text = trimmed(raw).replace(/\s/g, '').replace(/^[^\d+-]+|[^\d]+$/g, '');
    if (PLAIN_NUMBER.test(text)) return text;
    return GROUPED_NUMBER.test(text) ? text.replace(/,/g, '') : null;
};

const CHECKED = Object.freeze({ true: true, yes: true, 1: true, checked: true, false: false, no: false, 0: false, unchecked: false });
const PHONE = /^\+?[\d\s().-]+$/;
const isPhone = (text) => PHONE.test(text) && text.replace(/\D/g, '').length >= 6 && text.replace(/\D/g, '').length <= 15;

const labelsIn = (column, raw) => uniqueBy(column.clickUpType === 'labels' ? listOf(raw) : [trimmed(raw)].filter(Boolean), lower);

const optionIds = (definition) => new Map(optionsOf(definition).map((option) => [lower(optionLabel(option)), String(option.id)]));

const numberValue = (raw, definition) => {
    const text = numberText(raw);
    return text === null ? MISFIT : storedValueOf(definition, text);
};

const moduleValue = (input) => (raw, definition) => {
    const type = typeModuleOf(definition.fieldType);
    return type.parse(input(trimmed(raw), type), definition);
};

/* Each answers { value } as the field stores it, { value, cut: true } when only part of the cell could be kept, or
 * { error } when the cell does not fit. People are named by email and resolved among the people the import may name. */
const READERS = Object.freeze({
    text: (raw, definition) => storedValueOf(definition, trimmed(raw)),
    textarea: (raw, definition) => storedValueOf(definition, trimmed(raw)),
    number: numberValue,
    money: numberValue,
    email: (raw, definition) => storedValueOf(definition, trimmed(raw)),
    date: (raw) => {
        const date = parseClickUpDate(raw);
        return date ? { value: date.toISOString() } : MISFIT;
    },
    checkbox: (raw) => (Object.hasOwn(CHECKED, lower(raw)) ? { value: CHECKED[lower(raw)] } : MISFIT),
    phone: (raw) => (isPhone(trimmed(raw)) ? { value: trimmed(raw) } : MISFIT),
    dropdown: (raw, definition, { column }) => {
        const ids = optionIds(definition);
        const wanted = labelsIn(column, raw);
        const chosen = wanted.map((label) => ids.get(lower(label))).filter(Boolean);
        return chosen.length ? { value: [...new Set(chosen)], cut: chosen.length < wanted.length } : MISFIT;
    },
    url: moduleValue((text, type) => type.fromInput(text)),
    rating: moduleValue((text) => text),
    progress: moduleValue((text) => text.replace(/\s*%$/, '')),
    people: (raw, definition, { idByEmail }) => {
        const named = uniqueBy(listOf(raw), lower);
        const ids = [...new Set(named.map((entry) => idByEmail.get(lower(entry))).filter(Boolean))];
        const unmatched = named.filter((entry) => !idByEmail.has(lower(entry)));
        if (!ids.length) return { error: true, unmatched };
        const { value, error } = typeModuleOf('people').parse(ids, definition);
        return error ? { error: true, unmatched } : { value, cut: unmatched.length > 0, unmatched };
    },
});

const newOption = (label, index) => ({
    id: crypto.randomBytes(4).toString('hex'),
    color: OPTION_COLORS[index % OPTION_COLORS.length],
    value: label,
    label,
    selected: false,
});

const labelsOf = (column, cells) => uniqueBy(cells.flatMap((cell) => labelsIn(column, cell.raw)), lower);

const ratingMaxOf = (cells) => cells
    .map((cell) => Number(trimmed(cell.raw)))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= RATING.most)
    .reduce((most, value) => Math.max(most, value), RATING.least);

const draftOf = (column, cells) => ({
    fieldTitle: column.name,
    fieldType: column.type,
    ...(column.type === 'dropdown' ? { fieldOptions: labelsOf(column, cells).slice(0, MAX_OPTIONS).map(newOption) } : {}),
    ...(column.type === 'rating' ? { fieldRatingMax: ratingMaxOf(cells) } : {}),
    ...(column.type === 'people' ? { fieldMultiple: true } : {}),
});

const isCompatible = (held, wanted) => held === wanted || (COMPATIBLE[wanted] || []).includes(held);

const heldDefinition = (column, { definitions, projectId }) => definitions.find((definition) => isTaskFieldOf(definition, projectId)
    && lower(definition.fieldTitle) === lower(column.name)
    && isCompatible(definition.fieldType, column.type));

/* A field of the project takes the options the file adds; one shared by the whole company is left as it is. */
const withFileOptions = (column, definition, cells) => {
    if (column.type !== 'dropdown' || definition.global === true) return { definition, addedOptions: [] };
    const held = optionIds(definition);
    const room = Math.max(0, MAX_OPTIONS - held.size);
    const missing = labelsOf(column, cells).filter((label) => !held.has(lower(label))).slice(0, room);
    if (!missing.length) return { definition, addedOptions: [] };
    const options = optionsOf(definition);
    return { definition: { ...definition, fieldOptions: [...options, ...missing.map((label, index) => newOption(label, options.length + index))] }, addedOptions: missing };
};

const planColumn = (column, cells, context) => {
    const base = { ...column, reason: '', definition: null, addedOptions: [], set: 0, dropped: 0 };
    if (!cells.length) return { planned: { ...base, action: 'empty' }, kept: [], unmatched: [] };
    if (!context.allowed) return { planned: { ...base, action: 'skipped', reason: NO_PERMISSION }, kept: [], unmatched: [] };

    const held = heldDefinition(column, context);
    const { definition, addedOptions } = held ? withFileOptions(column, held, cells) : { definition: draftOf(column, cells), addedOptions: [] };
    const planned = { ...base, action: held ? 'reuse' : 'create', definition, addedOptions };
    const kept = [];
    const unmatched = [];
    cells.forEach(({ task, raw }) => {
        const read = READERS[definition.fieldType](raw, definition, { column, idByEmail: context.idByEmail });
        unmatched.push(...(read.unmatched || []));
        const fits = !read.error && read.value !== undefined;
        if (fits) kept.push({ task, entry: { column: planned, detail: { fieldValue: read.value } } });
        if (fits) planned.set += 1;
        if (!fits || read.cut) planned.dropped += 1;
    });
    return { planned, kept, unmatched };
};

/* `columns` are the file's field columns and each task holds its cells in `fieldCells`. Answers every column with the
 * definition it reuses or would create, the values to set per task, and the people a people field names that the
 * import may not name. Nothing is written: a planned definition has no id until the importer saves it. */
const planFields = ({ columns, tasks, definitions = [], projectId = '', idByEmail = new Map(), allowed = true }) => {
    const values = new Map();
    const unmatchedPeople = [];
    const planned = columns.map((column) => {
        const cells = tasks
            .map((task) => ({ task, raw: trimmed(task.fieldCells && task.fieldCells[column.column]) }))
            .filter((cell) => cell.raw);
        const out = planColumn(column, cells, { definitions, projectId, idByEmail, allowed });
        out.kept.forEach(({ task, entry }) => values.set(task, [...(values.get(task) || []), entry]));
        unmatchedPeople.push(...out.unmatched);
        return out.planned;
    });
    return { columns: planned, values, unmatchedPeople: uniqueBy(unmatchedPeople, lower) };
};

const US = Object.freeze({ en: 'United States', flag: '🇺🇸', code: 'US', dialCode: '+1', mask: '(999) 999-9999', maskWithDialCode: '(###) ###-####' });

const TYPE_SETTINGS = Object.freeze({
    money: () => ({ fieldMoneyCode: '', fieldMoneyName: '', fieldMoneySymbol: '' }),
    date: () => ({ fieldSeparator: '-', fieldDateFormate: 'MM-DD-YYYY', fieldLiteMode: ['Lite Mode'], fieldTimeFormate: '24 Hour', fieldPastFuture: [PAST, FUTURE], fieldDaysDisable: [] }),
    phone: () => ({ fieldCountryCode: US.dialCode, fieldCountryObject: { ...US }, fieldCountrySelect: ['Country Code'] }),
});

/* A planned definition as the field form in the web app would save it, for one project. */
const fieldDefinitionFrom = (draft, { projectId, userId }) => {
    const tile = defaultCustomFields.find((entry) => entry.cfType === draft.fieldType) || {};
    return {
        fieldPlaceholder: '',
        fieldDescription: 'Imported from ClickUp.',
        fieldImage: tile.cfIcon || '',
        fieldImageGrey: tile.cfIconGrey || '',
        fieldPrimaryColor: tile.cfPrimaryColor || '',
        fieldBackgroundColor: tile.cfBackgroundColor || '',
        global: false,
        projectId: [String(projectId)],
        type: 'task',
        isDelete: true,
        userId: String(userId),
        fieldRequired: [],
        fieldMinimum: '',
        fieldMaximum: '',
        fieldHide: [],
        fieldValidation: '',
        fieldEntryLimits: [],
        ...(TYPE_SETTINGS[draft.fieldType] ? TYPE_SETTINGS[draft.fieldType]() : {}),
        ...draft,
    };
};

module.exports = { FIELD_TYPES, NO_PERMISSION, fieldTypeOf, planFields, fieldDefinitionFrom };
