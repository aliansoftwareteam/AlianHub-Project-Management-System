/**
 * Client View Projection Test Suite
 * AlianHub Project Management System
 *
 * Unit tests for Modules/Milestone/helpers/clientProjection.js. Pure — no DB.
 *
 * The point of this suite is the negative case: the source documents below are
 * deliberately stuffed with internal hours, estimates, pay rates, salaries,
 * margins, internal comments and agent activity, and the projection must carry
 * NONE of it — not under the same key, not under a renamed one, not as a value
 * buried in a string.
 */

const { buildClientView } = require('../Modules/Milestone/helpers/clientProjection');

// Every one of these appears in the source documents below.
const FORBIDDEN_KEYS = [
    'loggedMinutes', 'loggedHours', 'hours', 'minutes', 'totalEstimatedTime', 'estimate',
    'estimateHours', 'remainingHours', 'blendedCostRateMinor', 'costMinor', 'marginMinor',
    'marginBp', 'burnBp', 'rate', 'rateMinor', 'salary', 'payRate', 'comments', 'internalNote',
    'agentRuns', 'agentActivity', 'assignees', 'AssigneeUserId', 'timelogIds', 'taskIds',
    'billingRates', 'lines', 'subtotalMinor', 'profitability',
];

// Values that must not survive anywhere in the payload, at any depth.
const FORBIDDEN_VALUES = [
    '23640',            // logged minutes
    '394',              // logged hours
    '5800',             // blended cost rate in cents
    '92000',            // a salary
    'Ken is way over on this one',   // an internal comment
    'agent-run-7781',                // agent activity
    'Priya Sharma',                  // an internal assignee
];

const SOURCE = {
    project: {
        _id: 'p1',
        name: 'Website Revamp',
        companyName: 'Acme Studio',
        loggedMinutes: 23640,
        totalEstimatedTime: 48000,
        assignees: ['Priya Sharma', 'Ken Ito'],
        internalNote: 'Ken is way over on this one',
        agentRuns: ['agent-run-7781'],
    },
    contract: {
        clientName: 'Northwind Ltd',
        vendorName: 'Acme Studio',
        currency: 'USD',
        blendedCostRateMinor: 5800,
        billingRates: [{ userId: 'u1', rateMinor: 12000, salary: 92000 }],
        allowClientMessages: true,
    },
    milestones: [
        {
            id: 'm1',
            name: 'Discovery & IA',
            dueDate: '2026-07-18',
            signedOff: true,
            signedOffDate: '2026-07-18T14:22:00.000Z',
            percentBp: 10000,
            loggedMinutes: 2880,
            taskIds: ['t1', 't2'],
            costMinor: 167040,
            marginBp: 4287,
        },
        {
            id: 'm3',
            name: 'Build & integrate',
            dueDate: '2026-10-10',
            percentBp: 6800,
            loggedMinutes: 12840,
            burnBp: 7800,
            assignees: ['Priya Sharma'],
            comments: [{ message: 'Ken is way over on this one' }],
        },
        {
            id: 'm4',
            name: 'Launch & handover',
            dueDate: '2026-10-31',
            percentBp: 0,
            remainingHours: 120,
        },
    ],
    signOffs: [
        {
            id: 's1',
            title: 'Approve the payment provider choice',
            milestoneName: 'Build & integrate',
            waitingSince: '2026-08-29',
            dueDate: '2026-10-01',
            actionable: true,
            estimateHours: 3,
            assignees: ['Priya Sharma'],
            internalNote: 'Ken is way over on this one',
        },
    ],
    updates: [
        { date: '2026-09-02', text: 'Design system signed off; build started on the checkout flow.', agentActivity: ['agent-run-7781'] },
        { date: '2026-08-28', text: 'Extra locale support agreed as CR-04, billed separately.' },
        { date: '2026-08-01', text: '' },
    ],
    invoices: [
        {
            number: 'INV-2026-009', label: 'Milestone 1', status: 'paid', totalMinor: 1200000,
            issuedDate: '2026-07-01', dueDate: '2026-07-31', currency: 'USD',
            lines: [{ taskIds: ['t1'], timelogIds: ['l1'], loggedMinutes: 2880 }],
            subtotalMinor: 1200000,
        },
        {
            number: 'INV-2026-014', label: 'Milestone 2 + CR-04', status: 'sent', totalMinor: 3750000,
            issuedDate: '2026-09-03', dueDate: '2026-10-03', currency: 'USD',
        },
        { number: 'INV-2026-020', label: 'Milestone 4', status: 'draft', totalMinor: 1800000 },
    ],
};

const collectKeys = (value, out = new Set()) => {
    if (Array.isArray(value)) { value.forEach((v) => collectKeys(v, out)); return out; }
    if (value && typeof value === 'object') {
        Object.keys(value).forEach((k) => { out.add(k); collectKeys(value[k], out); });
    }
    return out;
};

describe('🔒 CLIENT VIEW - guest-safe projection', () => {

    const view = buildClientView(SOURCE);
    const serialised = JSON.stringify(view);

    describe('leak resistance', () => {

        test('no internal key survives the projection', () => {
            const keys = collectKeys(view);
            const leaked = FORBIDDEN_KEYS.filter((k) => keys.has(k));
            expect(leaked).toEqual([]);
        });

        test('no internal value survives the projection', () => {
            const leaked = FORBIDDEN_VALUES.filter((v) => serialised.includes(v));
            expect(leaked).toEqual([]);
        });

        test('the payload matches no hour/estimate/salary/comment word at all', () => {
            expect(serialised).not.toMatch(/hour|minute|estimate|salary|wage|comment|margin|cost|agent|assignee/i);
        });

        test('a field invented on the source tomorrow is not carried through', () => {
            const withNewField = buildClientView({
                ...SOURCE,
                milestones: [{ id: 'm9', name: 'New', percentBp: 0, someFutureInternalField: 'secret-42' }],
            });
            expect(JSON.stringify(withNewField)).not.toContain('secret-42');
            expect(JSON.stringify(withNewField)).not.toContain('someFutureInternalField');
        });

        test('every top-level key is one of the six the client view declares', () => {
            expect(Object.keys(view).sort()).toEqual(
                ['canMessage', 'invoices', 'payNext', 'progress', 'project', 'updates', 'waitingOnYou'].sort(),
            );
        });
    });

    describe('what the client does get', () => {

        test('project identity', () => {
            expect(view.project).toEqual({
                name: 'Website Revamp',
                clientName: 'Northwind Ltd',
                sharedBy: 'Acme Studio',
                currency: 'USD',
            });
        });

        test('milestone progress, as completion percent only', () => {
            expect(view.progress.total).toBe(3);
            expect(view.progress.complete).toBe(1);
            expect(view.progress.milestones[0]).toEqual({
                id: 'm1', name: 'Discovery & IA', dueDate: '2026-07-18',
                completedDate: '2026-07-18', percent: 100, state: 'done',
            });
            expect(view.progress.milestones[1]).toMatchObject({ percent: 68, state: 'in_progress' });
            expect(view.progress.milestones[2]).toMatchObject({ percent: 0, state: 'upcoming' });
        });

        test('sign-off requests carry a title and dates, never a task body', () => {
            expect(view.waitingOnYou).toEqual([{
                id: 's1',
                title: 'Approve the payment provider choice',
                milestone: 'Build & integrate',
                dueDate: '2026-10-01',
                waitingSince: '2026-08-29',
                action: 'review',
            }]);
        });

        test('dated updates, empty ones dropped', () => {
            expect(view.updates).toHaveLength(2);
            expect(view.updates[0]).toEqual({ date: '2026-09-02', text: 'Design system signed off; build started on the checkout flow.' });
        });

        test('invoices are totals only, with exactly one payable', () => {
            expect(view.invoices.map((i) => i.number)).toEqual(['INV-2026-009', 'INV-2026-014', 'INV-2026-020']);
            expect(view.invoices[0]).toEqual({
                number: 'INV-2026-009', label: 'Milestone 1', status: 'paid',
                issuedDate: '2026-07-01', dueDate: '2026-07-31',
                amount: 12000, currency: 'USD', payable: false,
            });
            expect(view.invoices.filter((i) => i.payable).map((i) => i.number)).toEqual(['INV-2026-014']);
            expect(view.payNext).toBe('INV-2026-014');
        });
    });

    describe('hostile and empty input', () => {

        test('an unknown invoice status degrades to draft, never to payable', () => {
            const v = buildClientView({ invoices: [{ number: 'X', status: 'paid_in_full_trust_me', totalMinor: 100 }] });
            expect(v.invoices[0].status).toBe('draft');
            expect(v.invoices[0].payable).toBe(false);
            expect(v.payNext).toBe('');
        });

        test('long strings are bounded', () => {
            const v = buildClientView({ project: { name: 'x'.repeat(1000) }, updates: [{ date: '2026-01-01', text: 'y'.repeat(2000) }] });
            expect(v.project.name).toHaveLength(160);
            expect(v.updates[0].text).toHaveLength(400);
        });

        test('an unparseable date becomes an empty string, not "Invalid Date"', () => {
            const v = buildClientView({ milestones: [{ id: 'm1', name: 'M', dueDate: 'not a date' }] });
            expect(v.progress.milestones[0].dueDate).toBe('');
        });

        test('no arguments produces an empty but well-formed view', () => {
            const v = buildClientView();
            expect(v.progress).toEqual({ complete: 0, total: 0, milestones: [] });
            expect(v.invoices).toEqual([]);
            expect(v.waitingOnYou).toEqual([]);
        });
    });
});
