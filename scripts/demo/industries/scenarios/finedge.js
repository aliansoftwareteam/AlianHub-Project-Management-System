module.exports = {
    key: 'finedge',
    industry: 'finance',
    company: { name: 'Finance & Accounting · FinEdge', domain: 'finedge' },
    owner: { title: 'Finance Controller' },
    people: [
        { key: 'maya', firstName: 'Maya', lastName: 'Chen', title: 'Accounts Payable Lead', role: 'admin', designations: ['Manager'] },
        { key: 'daniel', firstName: 'Daniel', lastName: 'Okafor', title: 'AP Specialist', role: 'member', designations: ['Accountant'] },
        { key: 'priya', firstName: 'Priya', lastName: 'Raman', title: 'Senior Accountant, Close', role: 'member', designations: ['Accountant'] },
        { key: 'tom', firstName: 'Tom', lastName: 'Becker', title: 'Billing Analyst', role: 'member', designations: ['Accountant'] },
        { key: 'elena', firstName: 'Elena', lastName: 'Vasquez', title: 'Chief Financial Officer', role: 'admin', designations: ['Director', 'Manager'] },
        { key: 'sam', firstName: 'Sam', lastName: 'Whitfield', title: 'External Auditor', role: 'guest', designations: ['Consultant'] },
    ],
    projects: [
        {
            key: 'ap',
            name: 'Accounts Payable',
            code: 'AP',
            color: '#0F766E',
            lead: 'maya',
            members: ['maya', 'daniel', 'elena'],
            views: ['board', 'list', 'table', 'dashboard', 'docs'],
            summary: [
                'Every supplier invoice from receipt to payment. Each invoice is matched against its purchase order and goods receipt (three-way match) before it can be approved and paid.',
                '',
                '- Invoices within 2% of the PO match automatically; anything else is an **Exception** for the AP team.',
                '- Invoices above $25,000 wait for the CFO\'s approval.',
                '- The Reconciliation Checker agent looks for duplicates and explains variances; people decide.',
            ].join('\n'),
            stages: [
                { name: 'Received', goal: 'Invoice captured with vendor, amount, PO and terms.' },
                { name: 'Matching', goal: 'Invoice, PO and goods receipt agree within tolerance.' },
                { name: 'Exception', goal: 'Variance explained and a credit note, corrected invoice or retrospective PO requested.' },
                { name: 'Awaiting approval', goal: 'Budget owner or CFO approves.' },
                { name: 'Scheduled for payment', goal: 'In the next payment run, taking any early-payment discount.' },
                { name: 'Paid', goal: 'Payment sent and remittance advice issued.' },
            ],
            essentials: ['Same vendor, amount and PO as a paid invoice', 'Variance above 2% of the PO', 'Invoice with no PO from a new vendor'],
            escalations: ['Any invoice above $25,000', 'A vendor disputes a deduction'],
            statuses: [
                { name: 'Received', type: 'default_active', color: '#64748B' },
                { name: 'Matching', type: 'active', color: '#2563EB' },
                { name: 'Exception', type: 'active', color: '#DC2626' },
                { name: 'Awaiting approval', type: 'active', color: '#D97706' },
                { name: 'Scheduled for payment', type: 'done', color: '#7C3AED' },
                { name: 'Paid', type: 'close', color: '#16A34A' },
            ],
            types: [
                { name: 'Invoice', icon: 'receipt', color: '#0F766E' },
                { name: 'Vendor query', icon: 'email-alert', color: '#D97706' },
            ],
            fields: [
                { key: 'amount', title: 'Amount', type: 'money', currency: 'USD' },
                { key: 'vendor', title: 'Vendor', type: 'text' },
                { key: 'po', title: 'PO number', type: 'text' },
                { key: 'match', title: 'Match result', type: 'dropdown', options: ['Matched', 'Price variance', 'Quantity variance', 'Missing PO', 'Duplicate suspected'] },
                { key: 'terms', title: 'Payment terms', type: 'dropdown', options: ['Net 15', 'Net 30', 'Net 45', '2/10 Net 30'] },
            ],
            tags: [
                { name: 'early-pay-discount', color: '#16A34A' },
                { name: 'duplicate-risk', color: '#DC2626' },
                { name: 'new-vendor', color: '#2563EB' },
            ],
            tasks: [
                {
                    key: 'inv-4471', name: 'INV-4471 · Northwind Office Supply · $3,240.00', type: 'Invoice', status: 'Paid', priority: 'LOW', assignees: ['daniel'], due: -3,
                    fields: { amount: 3240, vendor: 'Northwind Office Supply', po: 'PO-2291', match: 'Matched', terms: 'Net 30' },
                    description: 'Printer paper, toner and desk supplies for the monthly restock. Matched to PO-2291 and goods receipt GR-1162. Paid in last week\'s payment run.',
                },
                {
                    key: 'inv-4502', name: 'INV-4502 · Globex Logistics · $18,950.00', type: 'Invoice', status: 'Scheduled for payment', priority: 'MEDIUM', assignees: ['daniel'], due: 2,
                    fields: { amount: 18950, vendor: 'Globex Logistics', po: 'PO-2304', match: 'Matched', terms: '2/10 Net 30' }, tags: ['early-pay-discount'],
                    description: 'Inbound freight for last month. Paying within 10 days takes the 2% early-payment discount ($379.00).',
                },
                {
                    key: 'inv-4518', name: 'INV-4518 · Initech Software · $42,000.00', type: 'Invoice', status: 'Matching', priority: 'MEDIUM', assignees: ['daniel'], due: 4,
                    fields: { amount: 42000, vendor: 'Initech Software', po: 'PO-2310', match: 'Matched', terms: 'Net 45' },
                    description: 'Annual licence renewal for the finance system, 120 seats. Above the $25,000 threshold, so the CFO approves before it is paid.',
                },
                {
                    key: 'inv-4523', name: 'INV-4523 · Acme Industrial Parts · $7,818.00', type: 'Invoice', status: 'Matching', priority: 'MEDIUM', assignees: ['daniel'], due: 1,
                    fields: { amount: 7818, vendor: 'Acme Industrial Parts', po: 'PO-2297', match: 'Price variance', terms: 'Net 30' },
                    description: 'Invoice bills 600 hinges at $13.03. PO-2297 agreed $11.85. Goods receipt GR-1180 confirms 600 units.',
                    checklist: [
                        { text: 'Compare the invoice lines with PO-2297', done: true },
                        { text: 'Check goods receipt GR-1180', done: true },
                        { text: 'Ask Acme for a credit note or corrected invoice' },
                        { text: 'Re-match once the correction arrives' },
                    ],
                },
                {
                    key: 'inv-4529', name: 'INV-4529 · Umbrella Facilities · $2,150.00', type: 'Invoice', status: 'Matching', priority: 'MEDIUM', assignees: ['daniel'], due: 3,
                    fields: { amount: 2150, vendor: 'Umbrella Facilities', match: 'Missing PO', terms: 'Net 15' }, tags: ['new-vendor'],
                    description: 'Office cleaning for this month. No purchase order is quoted and Umbrella is not yet set up as a vendor.',
                },
                {
                    key: 'inv-4531', name: 'INV-4531 · Northwind Office Supply · $3,240.00', type: 'Invoice', status: 'Matching', priority: 'MEDIUM', assignees: ['daniel'], due: 5,
                    fields: { amount: 3240, vendor: 'Northwind Office Supply', po: 'PO-2291', match: 'Duplicate suspected', terms: 'Net 30' }, tags: ['duplicate-risk'],
                    description: 'Arrived by email yesterday. Same vendor, amount and PO as INV-4471.',
                },
                {
                    key: 'inv-4536', name: 'INV-4536 · Stark Electrical · $11,480.00', type: 'Invoice', status: 'Matching', priority: 'MEDIUM', assignees: ['daniel'], due: 9,
                    fields: { amount: 11480, vendor: 'Stark Electrical', po: 'PO-2318', match: 'Quantity variance', terms: 'Net 30' },
                    description: 'Warehouse lighting upgrade. The invoice bills 80 fittings; goods receipt GR-1191 shows 72 so far.',
                },
                {
                    key: 'inv-4540', name: 'INV-4540 · Wayne Packaging · $5,620.00', type: 'Invoice', status: 'Received', priority: 'LOW', assignees: ['daniel'], due: 12,
                    fields: { amount: 5620, vendor: 'Wayne Packaging', po: 'PO-2321', terms: 'Net 30' },
                },
                {
                    key: 'inv-4541', name: 'INV-4541 · Cyberdyne Cloud Services · $9,300.00', type: 'Invoice', status: 'Received', priority: 'MEDIUM', assignees: ['daniel'], due: 6,
                    fields: { amount: 9300, vendor: 'Cyberdyne Cloud Services', po: 'PO-2290', terms: 'Net 15' },
                },
                {
                    key: 'vq-0412', name: 'Vendor query: Globex asks for remittance advice on INV-4417', type: 'Vendor query', status: 'Received', priority: 'MEDIUM', assignees: ['maya'], due: 1,
                    description: 'Globex cannot match a payment of $12,300.00 from the last payment run. Send the remittance advice from the payment run.',
                },
            ],
        },
        {
            key: 'close',
            name: 'Month-End Close',
            code: 'CLOSE',
            color: '#1D4ED8',
            lead: 'priya',
            members: ['priya', 'tom', 'elena', 'maya', 'sam'],
            views: ['board', 'list', 'gantt', 'dashboard'],
            summary: [
                'This month\'s close, run against a five-business-day calendar. Each task is a reconciliation, a journal entry or a report, tagged with its close day.',
                '',
                '- A preparer finishes the work, a reviewer signs it off, and the controller closes it.',
                '- Blocked items alert the controller at once, because one late reconciliation moves the board pack.',
                '- The Deadline Watch and Review Checklist agents watch the calendar and the evidence; the Finance Daily Digest reports progress.',
            ].join('\n'),
            stages: [
                { name: 'Not started', goal: 'Scheduled on its close day with an owner.' },
                { name: 'In progress', goal: 'Preparer working, support attached.' },
                { name: 'Blocked', goal: 'Waiting on someone outside the team, with the date they promised.' },
                { name: 'Ready for review', goal: 'Reconciled to zero or explained, evidence attached.' },
                { name: 'Reviewed', goal: 'Reviewer signed off.' },
                { name: 'Closed', goal: 'Posted and locked for the period.' },
            ],
            essentials: ['Unreconciled difference above $0', 'Any task past its close day'],
            escalations: ['A blocked item that feeds the board pack', 'A journal above $50,000'],
            statuses: [
                { name: 'Not started', type: 'default_active', color: '#64748B' },
                { name: 'In progress', type: 'active', color: '#2563EB' },
                { name: 'Blocked', type: 'active', color: '#DC2626' },
                { name: 'Ready for review', type: 'active', color: '#D97706' },
                { name: 'Reviewed', type: 'done', color: '#7C3AED' },
                { name: 'Closed', type: 'close', color: '#16A34A' },
            ],
            types: [
                { name: 'Reconciliation', icon: 'scale-balance', color: '#1D4ED8' },
                { name: 'Journal entry', icon: 'notebook', color: '#0D9488' },
                { name: 'Report', icon: 'file-chart', color: '#2563EB' },
            ],
            fields: [
                { key: 'area', title: 'Area', type: 'dropdown', options: ['Cash', 'Receivables', 'Payables', 'Accruals', 'Revenue', 'Reporting'] },
                { key: 'difference', title: 'Unreconciled difference', type: 'money', currency: 'USD' },
                { key: 'day', title: 'Close day', type: 'number' },
            ],
            tags: [
                { name: 'audit-sample', color: '#7C3AED' },
                { name: 'sox-control', color: '#0F766E' },
            ],
            tasks: [
                {
                    key: 'bank-rec', name: 'Bank reconciliation · Operating account ••4821', type: 'Reconciliation', status: 'Closed', priority: 'HIGH', assignees: ['priya'], due: -2,
                    fields: { area: 'Cash', difference: 0, day: 1 }, tags: ['sox-control'],
                    description: 'Statement balance $1,284,906.12 agrees to the GL after two outstanding checks and one deposit in transit.',
                },
                {
                    key: 'ar-rec', name: 'AR sub-ledger to GL reconciliation', type: 'Reconciliation', status: 'Reviewed', priority: 'MEDIUM', assignees: ['priya'], due: -1,
                    fields: { area: 'Receivables', difference: 0, day: 2 },
                },
                {
                    key: 'ap-accrual', name: 'Accrue goods received but not invoiced', type: 'Journal entry', status: 'Ready for review', priority: 'HIGH', assignees: ['priya'], due: 0,
                    fields: { area: 'Accruals', difference: 0, day: 2 }, tags: ['sox-control'],
                    description: 'The GR/IR report shows $64,210.00 received but not invoiced across 14 purchase orders. Accrual posted as JE-1047; it reverses on the first day of next month.',
                },
                {
                    key: 'payroll-accrual', name: 'Payroll accrual · 9 working days', type: 'Journal entry', status: 'In progress', priority: 'MEDIUM', assignees: ['priya'], due: 1,
                    fields: { area: 'Accruals', day: 3 },
                },
                {
                    key: 'revenue-cutoff', name: 'Revenue cut-off test · last 5 shipping days', type: 'Reconciliation', status: 'In progress', priority: 'HIGH', assignees: ['tom'], due: 1,
                    fields: { area: 'Revenue', day: 3 }, tags: ['audit-sample'],
                    description: 'Trace 25 shipments from the last five shipping days of the month to invoices and confirm each is in the right period.',
                },
                {
                    key: 'intercompany', name: 'Intercompany reconciliation · FinEdge UK', type: 'Reconciliation', status: 'In progress', priority: 'HIGH', assignees: ['priya'], due: -1, overdue: true,
                    fields: { area: 'Payables', difference: 12480, day: 3 },
                    description: 'FinEdge UK has booked a $12,480.00 management fee that is not yet in the US books. Waiting for the UK controller\'s invoice.',
                },
                {
                    key: 'fx-reval', name: 'FX revaluation · EUR and GBP balances', type: 'Journal entry', status: 'Not started', priority: 'MEDIUM', assignees: ['priya'], due: 2,
                    fields: { area: 'Cash', day: 3 },
                },
                {
                    key: 'fixed-assets', name: 'Fixed asset additions and depreciation run', type: 'Journal entry', status: 'Not started', priority: 'MEDIUM', assignees: ['priya'], due: 3,
                    fields: { area: 'Accruals', day: 4 },
                },
                {
                    key: 'flux', name: 'Balance sheet flux review (over 10% and $25k)', type: 'Report', status: 'Not started', priority: 'HIGH', assignees: ['you'], due: 3,
                    fields: { area: 'Reporting', day: 4 }, blockedBy: ['intercompany', 'ap-accrual'],
                    description: 'Explain every balance sheet line that moved more than 10% and more than $25,000 against last month.',
                },
                {
                    key: 'board-pack', name: 'Management reporting pack for the board', type: 'Report', status: 'Not started', priority: 'HIGH', assignees: ['elena'], lead: 'elena', due: 4,
                    fields: { area: 'Reporting', day: 5 }, blockedBy: ['flux'],
                    checklist: ['P&L against budget and forecast', 'Cash flow and 13-week cash forecast', 'KPI page: DSO, DPO, close days', 'CFO commentary'],
                },
                {
                    key: 'digest', name: 'Daily close digest', type: 'Report', status: 'In progress', priority: 'LOW', assignees: ['you'], due: 4,
                    fields: { area: 'Reporting' },
                    description: 'Where the Finance Daily Digest agent posts its board summary. Run it from AI, Agents, Run now, and pick this task.',
                },
            ],
        },
        {
            key: 'bill',
            name: 'Client Billing',
            code: 'BILL',
            color: '#9333EA',
            lead: 'tom',
            members: ['tom', 'elena', 'maya'],
            views: ['board', 'table', 'list'],
            summary: [
                'Monthly billing for FinEdge\'s advisory clients, from recorded time to cash. Time is checked before anything is drafted, and every write-off is a partner\'s decision.',
                '',
                '- The Timesheet Checker finds entries that cannot be billed as they stand.',
                '- The Invoice Preparer drafts the invoice and the write-off list; a partner approves before anything is sent.',
            ].join('\n'),
            stages: [
                { name: 'Time capture', goal: 'All time for the month recorded against the right matter.' },
                { name: 'Timesheet review', goal: 'Entries described, on the right matter, nothing missing.' },
                { name: 'Draft invoice', goal: 'Lines match the engagement letter.' },
                { name: 'Partner approval', goal: 'Partner approves the invoice and any write-off.' },
                { name: 'Sent', goal: 'Invoice issued from the accounting system.' },
                { name: 'Paid', goal: 'Cash received and matched.' },
            ],
            statuses: [
                { name: 'Time capture', type: 'default_active', color: '#64748B' },
                { name: 'Timesheet review', type: 'active', color: '#2563EB' },
                { name: 'Draft invoice', type: 'active', color: '#D97706' },
                { name: 'Partner approval', type: 'active', color: '#9333EA' },
                { name: 'Sent', type: 'done', color: '#0891B2' },
                { name: 'Paid', type: 'close', color: '#16A34A' },
            ],
            types: [
                { name: 'Billing run', icon: 'file-document-edit', color: '#9333EA' },
                { name: 'Write-off request', icon: 'cash-minus', color: '#DC2626' },
            ],
            fields: [
                { key: 'client', title: 'Client', type: 'text' },
                { key: 'hours', title: 'Billable hours', type: 'number' },
                { key: 'amount', title: 'Invoice amount', type: 'money', currency: 'USD' },
                { key: 'writeoff', title: 'Write-off', type: 'money', currency: 'USD' },
            ],
            tags: [
                { name: 'retainer', color: '#0891B2' },
                { name: 'over-budget', color: '#DC2626' },
            ],
            tasks: [
                {
                    key: 'harbor', name: 'Monthly billing · Harbor Dental Group', type: 'Billing run', status: 'Paid', priority: 'LOW', assignees: ['tom'], due: -5,
                    fields: { client: 'Harbor Dental Group', hours: 40, amount: 6000 }, tags: ['retainer'],
                },
                {
                    key: 'lumen', name: 'Monthly billing · Lumen Robotics', type: 'Billing run', status: 'Sent', priority: 'MEDIUM', assignees: ['tom'], due: 26,
                    fields: { client: 'Lumen Robotics', hours: 62.5, amount: 11250 },
                },
                {
                    key: 'orchid', name: 'Monthly billing · Orchid Hotels', type: 'Billing run', status: 'Partner approval', priority: 'HIGH', assignees: ['elena'], lead: 'tom', due: 2,
                    fields: { client: 'Orchid Hotels', hours: 118, amount: 19440, writeoff: 1800 }, tags: ['over-budget'],
                    description: 'Fixed-fee audit support estimated at 100 hours; 118 recorded. The client approved 8 extra hours in writing. The other 10 hours ($1,800.00) are proposed as a write-off.',
                },
                {
                    key: 'orchid-wo', name: 'Write-off request · Orchid Hotels · 10 hours', type: 'Write-off request', status: 'Partner approval', priority: 'MEDIUM', assignees: ['elena'], lead: 'tom', due: 2,
                    fields: { client: 'Orchid Hotels', hours: 10, writeoff: 1800 },
                },
                {
                    key: 'vertex', name: 'Monthly billing · Vertex Labs', type: 'Billing run', status: 'Draft invoice', priority: 'MEDIUM', assignees: ['tom'], due: 3,
                    fields: { client: 'Vertex Labs', hours: 34, amount: 6120 },
                },
                {
                    key: 'kestrel', name: 'Monthly billing · Kestrel Foods', type: 'Billing run', status: 'Time capture', priority: 'MEDIUM', assignees: ['tom'], due: 2,
                    fields: { client: 'Kestrel Foods', hours: 51 },
                },
                { key: 'pinecrest', name: 'Monthly billing · Pinecrest Schools', type: 'Billing run', status: 'Time capture', priority: 'LOW', assignees: ['tom'], due: 5, fields: { client: 'Pinecrest Schools' } },
                { key: 'novak', name: 'Monthly billing · Novak Architects', type: 'Billing run', status: 'Time capture', priority: 'LOW', assignees: ['tom'], due: 5, fields: { client: 'Novak Architects' }, tags: ['retainer'] },
            ],
        },
    ],
    agents: [
        { key: 'recon', role: 'ecommerce/reconciliation-checker', projects: ['ap'], does: 'Matches invoices to POs and receipts, explains variances and flags likely duplicates.' },
        { key: 'deadline', role: 'professional-services/deadline-watch', projects: ['close'], does: 'Watches the close calendar and warns when a late item puts the board pack at risk.' },
        { key: 'review', role: 'professional-services/review-checklist', projects: ['close'], does: 'Runs the review checklist on reconciliations and journals before sign-off.' },
        { key: 'timesheets', role: 'professional-services/proserv-timesheet-checker', projects: ['bill'], does: 'Finds time entries that cannot be billed as they stand.' },
        { key: 'invoices', role: 'professional-services/proserv-invoice-preparer', projects: ['bill'], does: 'Drafts client invoices and the write-off list for the partner.' },
        { key: 'digest', skill: 'digest.ceo', name: 'Finance Daily Digest', description: 'Posts a short digest of the close: what moved, what is blocked, what is late.', projects: ['close'], does: 'Counts the close board and posts what moved, what is blocked and what is late.' },
    ],
    automations: [
        {
            name: 'Route invoice exceptions to the AP lead',
            project: 'ap',
            when: { statusTo: 'Exception' },
            then: [
                { priority: 'HIGH' },
                { assign: ['maya'] },
                { comment: 'Exception logged by automation. Next: confirm the variance against the PO and goods receipt, ask the vendor for a credit note, corrected invoice or retrospective PO, and re-match within 2 working days.' },
            ],
        },
        {
            name: 'Invoices awaiting approval go to the CFO',
            project: 'ap',
            when: { statusTo: 'Awaiting approval' },
            then: [
                { assign: ['elena'] },
                { notify: { people: ['elena'], message: 'An invoice is waiting for your approval in Accounts Payable.' } },
            ],
        },
        {
            name: 'A blocked close task alerts the controller',
            project: 'close',
            when: { statusTo: 'Blocked' },
            then: [
                { priority: 'HIGH' },
                { notify: { people: ['you', 'elena'], message: 'A close task is blocked and may move the close date.' } },
                { comment: 'Blocked: the controller and CFO were notified. Note what is needed to unblock it, who owes it and by when.' },
            ],
        },
    ],
    story: [
        { comment: 'ap.inv-4523', by: 'daniel', text: 'Line 1 is billed at $13.03 against $11.85 on PO-2297. GR-1180 confirms all 600 units arrived, so this is a price issue, not quantity.' },
        { move: 'ap.inv-4523', to: 'Exception', by: 'daniel' },
        { move: 'ap.inv-4529', to: 'Exception', by: 'daniel' },
        { comment: 'ap.inv-4529', by: 'maya', text: 'Facilities confirmed the cleaning contract. I have asked procurement for a retrospective PO and sent Umbrella the vendor set-up form.' },
        {
            agentRun: 'recon', task: 'ap.inv-4523', summary: 'Calculated the price variance on INV-4523 and suggested a credit note.',
            text: 'Price variance on INV-4523: 600 units at $13.03 invoiced against $11.85 on PO-2297, a difference of $708.00 (9.96%), above the 2% tolerance. The quantity agrees with goods receipt GR-1180. Suggested next step: ask Acme for a credit note of $708.00.',
        },
        {
            agentRun: 'recon', task: 'ap.inv-4531', summary: 'Found that INV-4531 repeats INV-4471.',
            text: 'Possible duplicate: INV-4531 matches INV-4471 on vendor (Northwind Office Supply), amount ($3,240.00) and PO-2291. INV-4471 was paid three days ago. Vendors often re-send an invoice with a new number when a remittance goes astray.',
        },
        {
            proposal: 'recon', task: 'ap.inv-4531', summary: 'Asked to hold INV-4531 until Northwind confirms it is not a duplicate.',
            what: 'Hold INV-4531 as a likely duplicate of INV-4471',
            why: 'Same vendor, amount and PO as INV-4471, which was paid three days ago. Paying it would overpay Northwind by $3,240.00.',
            changes: [
                { priority: 'HIGH' },
                { comment: 'On hold as a likely duplicate of INV-4471 (same vendor, amount and PO-2291). Release it only after Northwind confirms in writing that it is a separate delivery.' },
            ],
            priority: 'high',
        },
        { move: 'ap.inv-4518', to: 'Awaiting approval', by: 'maya' },
        { comment: 'ap.inv-4518', by: 'elena', text: 'Within budget (line 6420). I will approve once IT confirms we still need 120 seats; we retired the old reporting team last month.' },
        { move: 'close.intercompany', to: 'Blocked', by: 'priya' },
        { comment: 'close.intercompany', by: 'priya', text: 'The UK controller says the invoice goes out on Monday. If it slips I will book an accrual for $12,480 and reverse it next month.' },
        {
            agentRun: 'deadline', task: 'close.board-pack', summary: 'Checked the close calendar and found the board pack at risk.',
            text: 'Close calendar, business day 3: 2 of 11 tasks are done. The flux review (BD4) is waiting on two items: the intercompany reconciliation, blocked and one day late, and the GRNI accrual, ready for review. If the intercompany item is not cleared by tomorrow, the board pack (BD5) is at risk.',
        },
        {
            proposal: 'review', task: 'close.ap-accrual', summary: 'Ran the review checklist on JE-1047 and found three lines without cut-off evidence.',
            what: 'Add the missing cut-off evidence to the GRNI accrual before sign-off',
            why: '11 of the 14 accrual lines tie to goods receipts dated on or before month end. Three receipts (PO-2310, PO-2318, PO-2321) were posted after month end, and the checklist needs cut-off evidence before review.',
            changes: [
                { subtask: { title: 'Attach the delivery dates for PO-2310, PO-2318 and PO-2321', description: 'Delivery notes or carrier confirmations showing the goods arrived by month end.' } },
                { comment: 'Review checklist: 11 of 14 lines tie to goods receipts dated on or before month end. Three need cut-off evidence before sign-off.' },
            ],
        },
        { move: 'bill.kestrel', to: 'Timesheet review', by: 'tom' },
        {
            agentRun: 'timesheets', task: 'bill.kestrel', summary: 'Found four entries to fix before Kestrel Foods can be billed.',
            text: 'Before billing Kestrel Foods: 3 entries (4.5 h) have no description; 6.5 h on the 14th look like they belong to Kestrel\'s tax matter, not advisory; one 11-hour day on the 22nd needs a check. The other 39 hours are ready to bill.',
        },
        {
            proposal: 'invoices', task: 'bill.orchid', summary: 'Drafted the Orchid Hotels invoice with a 10-hour write-off for the partner.',
            what: 'Post the draft Orchid Hotels invoice for partner approval',
            why: '118 hours are recorded against a 100-hour fixed fee. The client approved 8 extra hours in writing; the remaining 10 hours are outside the engagement letter.',
            changes: [
                { comment: 'Draft invoice for Orchid Hotels, this month: fixed fee $18,000.00 + approved extras 8 h × $180 = $1,440.00, total $19,440.00. Proposed write-off: 10 h ($1,800.00), outside the engagement letter. Needs partner approval before it is issued.' },
            ],
        },
        { comment: 'bill.vertex', by: 'tom', text: 'Draft is ready. Vertex asked for every invoice to quote their PO 7781.' },
    ],
    routing: {
        ap: [
            { agent: 'recon', types: ['Invoice'] },
        ],
        close: [
            { agent: 'review', types: ['Reconciliation', 'Journal entry'] },
            { agent: 'deadline', types: ['Report'] },
        ],
        bill: [
            { agent: 'timesheets', statuses: ['Time capture', 'Timesheet review'] },
            { agent: 'invoices', statuses: ['Draft invoice'] },
            { agent: 'invoices', types: ['Write-off request'] },
        ],
    },
    handOvers: [
        { task: 'ap.inv-4529', by: 'maya' },
        { task: 'close.revenue-cutoff', by: 'priya' },
        { task: 'bill.vertex', by: 'tom' },
    ],
    workflows: {
        own: {
            key: 'invoice-exception',
            name: 'Accounts payable: an invoice exception',
            description: 'The Reconciliation Checker explains the variance and how to settle it, the Finance Controller approves the settlement, and the checker matches the credit note and releases the invoice to the payment run.',
            steps: [
                { id: 'sExplain', agent: 'recon' },
                {
                    id: 'sSettleOk',
                    approval: {
                        title: 'Approve how the exception is settled',
                        prompt: 'The variance against the purchase order and the goods receipt is explained on the invoice, with a credit note or a corrected invoice to ask for. Approve to settle it that way, or reject to keep the invoice on hold.',
                        owner: 'you',
                    },
                },
                { id: 'sRelease', agent: 'recon' },
            ],
            run: { task: 'ap.inv-4523', by: 'maya' },
        },
    },
    goals: [
        {
            name: 'Close the month in five business days',
            description: 'Every close task reviewed and closed by business day 5.',
            color: '#1D4ED8',
            targets: [{ name: 'Close tasks finished', kind: 'tasks', lists: ['close'] }],
        },
        {
            name: 'Pay suppliers on time, and never twice',
            description: 'This month\'s invoices through the pipeline with no duplicate payments.',
            color: '#0F766E',
            targets: [
                { name: 'This month\'s invoices processed', kind: 'tasks', tasks: ['ap.inv-4471', 'ap.inv-4502', 'ap.inv-4518', 'ap.inv-4523', 'ap.inv-4529', 'ap.inv-4531', 'ap.inv-4536'] },
                { name: 'No duplicate payments this quarter', kind: 'boolean', done: true },
            ],
        },
    ],
    dashboard: { name: 'Finance operations', project: 'ap', cards: ['tasks_by_status', 'at_risk', 'due_soon', 'project_pulse'] },
    guide: {
        project: 'ap',
        intro: [
            'FinEdge runs its own finance operations and bills advisory clients in AlianHub. You are signed in as the **Finance Controller**. Three processes run side by side: **Accounts Payable** (supplier invoices with three-way matching), the **Month-End Close** (a five-day close calendar) and **Client Billing** (time to invoice). Role agents prepare and check; people approve.',
        ].join('\n'),
        tryThis: [
            'Open **Accounts Payable** on the Board. INV-4523 and INV-4529 sit in **Exception**: when Daniel moved them there, the automation set them to High, assigned Maya and left the next-steps comment.',
            'Move **INV-4536** (a quantity variance) to **Exception** yourself and open it. The same automation fires within a few seconds. Every run is listed under **Automations** in the AI section.',
            'Open **Inbox → Approvals**. The Reconciliation Checker asks to hold INV-4531 as a likely duplicate. Approve it: the priority and the comment are applied for real, and Undo stays available for 15 minutes.',
            'In **Month-End Close**, the intercompany reconciliation is **Blocked**. Open the flux review assigned to you: it is blocked by that item and by the accrual waiting for review, which is why the board pack is at risk.',
            'Approve or decline the Review Checklist\'s proposal on the GRNI accrual, and the Invoice Preparer\'s draft on **Orchid Hotels** in **Client Billing**.',
            'In **AI → Agents**, click **Run now** on the **Finance Daily Digest** and pick **Daily close digest**. It runs for real, with no AI model, and posts a digest counted from the board on that task.',
            'Open **Goals** and the **Finance operations** dashboard: both are counted from the tasks above, so they change as you move work.',
        ],
    },
};
