// Guest-safe client view (handoff 19d). Pure — no I/O — so the exact payload a
// client or a public link receives can be asserted in tests.
//
// This builds a NEW object from an explicit allow-list. It never spreads,
// clones or deletes-from a source document: a filter that removes known-bad
// keys leaks the next field somebody adds to the schema, an allow-list cannot.
// A client must never see internal hours, estimates, cost or pay rates,
// margins, assignees, internal comments or agent activity — so none of those
// are read here, not even into a local variable.

const { fromMinor, bpToPercent } = require('./billingMath');

const MAX_MILESTONES = 40;
const MAX_SIGNOFFS = 20;
const MAX_UPDATES = 12;
const MAX_INVOICES = 30;
const MAX_TEXT = 400;

const text = (value, max = MAX_TEXT) => String(value === null || value === undefined ? '' : value).slice(0, max);

/* Dates cross the boundary as ISO day strings. A raw Date or epoch would tempt
 * a caller to render a time, and the hour somebody signed something off is
 * internal activity. */
const day = (value) => {
    if (value === null || value === undefined || value === '') return '';
    const d = value instanceof Date ? value : new Date(typeof value === 'number' ? value : String(value));
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
};

const MILESTONE_STATES = Object.freeze(['done', 'in_progress', 'upcoming']);
const INVOICE_STATES = Object.freeze(['paid', 'sent', 'draft']);

const milestoneState = (source = {}) => {
    if (source.signedOff === true) return 'done';
    const bp = Number(source.percentBp);
    if (Number.isFinite(bp) && bp > 0) return 'in_progress';
    return 'upcoming';
};

/* A milestone as the client sees it: a name, a due date, how far along it is.
 * `percentBp` is task completion — a count of done vs total tasks. It carries
 * no hours and no estimate, which is why it is the only progress number here. */
const projectMilestone = (source = {}) => {
    const state = milestoneState(source);
    const percent = state === 'done' ? 100 : bpToPercent(Number.isFinite(Number(source.percentBp)) ? Number(source.percentBp) : 0);
    return {
        id: text(source.id, 64),
        name: text(source.name, 160),
        dueDate: day(source.dueDate),
        completedDate: state === 'done' ? day(source.signedOffDate) : '',
        percent: percent === null ? 0 : percent,
        state,
    };
};

/* A sign-off request. The note is built here from allow-listed fields rather
 * than copied from an internal description, so a private task body can never
 * ride along. */
const projectSignOff = (source = {}) => ({
    id: text(source.id, 64),
    title: text(source.title, 160),
    milestone: text(source.milestoneName, 160),
    dueDate: day(source.dueDate),
    waitingSince: day(source.waitingSince),
    action: source.actionable === true ? 'review' : 'open',
});

const projectUpdate = (source = {}) => ({
    date: day(source.date),
    text: text(source.text, MAX_TEXT),
});

/* Invoices: number, what it covers, what it costs, whether it is payable.
 * Line items are deliberately absent — a line traces back to tasks and time
 * logs, which is exactly the internal detail this view exists to withhold. */
const projectInvoice = (source = {}) => {
    const status = INVOICE_STATES.includes(String(source.status)) ? String(source.status) : 'draft';
    return {
        number: text(source.number, 40),
        label: text(source.label, 160),
        status,
        issuedDate: day(source.issuedDate),
        dueDate: day(source.dueDate),
        amount: fromMinor(source.totalMinor),
        currency: text(source.currency, 8) || 'USD',
        payable: status === 'sent',
    };
};

/**
 * The whole guest payload.
 *
 * Every argument is read field by field. Passing a full mongo document is safe
 * precisely because nothing is spread out of it.
 */
const buildClientView = ({
    project = {},
    contract = {},
    milestones = [],
    signOffs = [],
    updates = [],
    invoices = [],
} = {}) => {
    const projected = (milestones || []).slice(0, MAX_MILESTONES).map(projectMilestone);
    const complete = projected.filter((m) => m.state === 'done').length;
    const payableInvoices = (invoices || []).slice(0, MAX_INVOICES).map(projectInvoice);
    const nextPayable = payableInvoices.find((i) => i.payable) || null;

    return {
        project: {
            name: text(project.name, 160),
            clientName: text(contract.clientName, 160),
            sharedBy: text(contract.vendorName, 160) || text(project.companyName, 160),
            currency: text(contract.currency, 8) || 'USD',
        },
        progress: {
            complete,
            total: projected.length,
            milestones: projected,
        },
        waitingOnYou: (signOffs || []).slice(0, MAX_SIGNOFFS).map(projectSignOff),
        updates: (updates || []).slice(0, MAX_UPDATES).map(projectUpdate).filter((u) => u.text),
        invoices: payableInvoices,
        payNext: nextPayable ? nextPayable.number : '',
        canMessage: contract.allowClientMessages !== false,
    };
};

module.exports = {
    MILESTONE_STATES,
    INVOICE_STATES,
    buildClientView,
    projectMilestone,
    projectSignOff,
    projectInvoice,
    projectUpdate,
};
