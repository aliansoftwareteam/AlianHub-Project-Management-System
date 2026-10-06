// The question catalogue: one table read by the builder menu, the public
// renderer and the submission mapper, so a new type is added in a single place.
//
// Forms own these definitions outright. A form question is NOT a custom field
// and nothing here touches the custom-fields module: custom fields are read
// across tasks, views, filters and templates, and bending them to serve forms
// would put that subsystem at risk. The consequence is that an answer lands
// either on a task column the question maps to, or in the description
// transcript, and nowhere else.

const PRIORITIES = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

/* Menu groups, in the order the builder shows them. `taskProperty` is the group
 * that binds to a column of the task instead of standing on its own. */
const GROUPS = Object.freeze([
    { key: 'task_property', title: 'Task property' },
    { key: 'short_text', title: 'Short text' },
    { key: 'long_text', title: 'Long text' },
    { key: 'dates', title: 'Dates' },
    { key: 'single_select', title: 'Single-select' },
    { key: 'multi_select', title: 'Multi-select' },
    { key: 'contact_info', title: 'Contact info' },
    { key: 'number', title: 'Number' },
    { key: 'uploads', title: 'Uploads' },
    { key: 'layout', title: 'Layout' },
]);

/* `widget` is the only thing the renderer switches on, so two types that look
 * the same to a submitter share one branch. `options` means the builder must
 * collect a choice list; `multi` means the answer is a list, not a scalar. */
const TYPES = Object.freeze({
    short_text: { group: 'short_text', title: 'Text', widget: 'text' },
    long_text: { group: 'long_text', title: 'Text area (Long Text)', widget: 'textarea' },
    date: { group: 'dates', title: 'Date', widget: 'date' },
    dropdown: { group: 'single_select', title: 'Dropdown', widget: 'select', options: true },
    checkbox: { group: 'single_select', title: 'Checkbox', widget: 'radio', options: true },
    progress: { group: 'single_select', title: 'Progress (Manual)', widget: 'range' },
    rating: { group: 'single_select', title: 'Rating', widget: 'rating', scale: true },
    voting: { group: 'single_select', title: 'Voting', widget: 'radio', options: true },
    labels: { group: 'multi_select', title: 'Labels', widget: 'checkboxes', options: true, multi: true },
    email: { group: 'contact_info', title: 'Email', widget: 'email' },
    website: { group: 'contact_info', title: 'Website', widget: 'url' },
    phone: { group: 'contact_info', title: 'Phone', widget: 'tel' },
    location: { group: 'contact_info', title: 'Location', widget: 'text' },
    money: { group: 'number', title: 'Money', widget: 'money' },
    number: { group: 'number', title: 'Number', widget: 'number' },
    files: { group: 'uploads', title: 'Files', widget: 'file' },
    info_block: { group: 'layout', title: 'Information Block', widget: 'info', input: false },
});

/* Task columns a question may fill.
 *
 * An ALLOW-LIST, not a convenience: the mapping arrives from the browser and a
 * public submission writes it onto a task, so anything absent here — assignees,
 * watchers, the project id, the status of a task elsewhere — stays unreachable
 * by editing a form. `field` is the real column name; getting it wrong loses the
 * answer silently, because the task schema is strict. */
const TASK_PROPERTIES = Object.freeze({
    TaskName: { title: 'Task Name', field: 'TaskName', type: 'short_text', cap: 200, kind: 'string' },
    description: { title: 'Description', field: 'rawDescription', type: 'long_text', kind: 'string' },
    Task_Priority: { title: 'Priority', field: 'Task_Priority', type: 'dropdown', kind: 'enum', values: PRIORITIES },
    startDate: { title: 'Start Date', field: 'startDate', type: 'date', kind: 'date' },
    DueDate: { title: 'Due Date', field: 'DueDate', type: 'date', kind: 'date' },
});

/* How wide a question sits, in twelfths. Twelve divides by 2, 3 and 4, so a row
 * can hold halves, thirds or quarters and still come out even. */
const GRID_COLUMNS = 12;
const SPANS = Object.freeze([3, 4, 6, 12]);

const isType = (key) => Object.prototype.hasOwnProperty.call(TYPES, String(key || ''));
const isTaskProperty = (key) => Object.prototype.hasOwnProperty.call(TASK_PROPERTIES, String(key || ''));

const typeOf = (key) => (isType(key) ? TYPES[key] : null);
const wantsOptions = (key) => Boolean(isType(key) && TYPES[key].options);
const isMulti = (key) => Boolean(isType(key) && TYPES[key].multi);
const isInput = (key) => !(isType(key) && TYPES[key].input === false);

/* A mapped question's type is dictated by the column it fills — a Due Date
 * question cannot be a dropdown — so the builder never has to keep the two in
 * step and a stale pairing cannot survive a save. */
const typeForProperty = (key) => (isTaskProperty(key) ? TASK_PROPERTIES[key].type : '');

/* What the builder's two-level menu renders. Sent to the client so the menu and
 * the validator can never disagree about what exists. */
const menu = () => GROUPS.map((g) => ({
    key: g.key,
    title: g.title,
    create: Object.keys(TYPES)
        .filter((k) => TYPES[k].group === g.key)
        .map((k) => ({ type: k, title: TYPES[k].title })),
    mapTo: Object.keys(TASK_PROPERTIES)
        .filter((k) => (g.key === 'task_property'
            ? true
            : TASK_PROPERTIES[k].type && TYPES[TASK_PROPERTIES[k].type].group === g.key))
        .map((k) => ({ property: k, title: TASK_PROPERTIES[k].title, type: TASK_PROPERTIES[k].type })),
}));

/* The width a question actually renders at.
 *
 * ONE definition, used by the public renderer and handed to the builder in the
 * API response, so the two cannot drift. A question saved before widths existed
 * has no span, and falls back to what the form-wide layout used to give it —
 * which is why an existing form looks identical until someone changes it. */
const resolveSpan = (question, layout) => {
    const given = Number(question && question.span);
    if (SPANS.includes(given)) return given;
    const meta = typeOf(question && question.type);
    // Long text and an information block read badly in a narrow column.
    if (meta && ['textarea', 'info', 'file'].includes(meta.widget)) return GRID_COLUMNS;
    return layout === 'two' ? 6 : GRID_COLUMNS;
};

module.exports = {
    PRIORITIES,
    GRID_COLUMNS,
    SPANS,
    resolveSpan,
    GROUPS,
    TYPES,
    TASK_PROPERTIES,
    isType,
    isTaskProperty,
    typeOf,
    typeForProperty,
    wantsOptions,
    isMulti,
    isInput,
    menu,
};
