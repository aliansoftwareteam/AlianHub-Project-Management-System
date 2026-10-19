module.exports = {
    key: 'technova',
    industry: 'it',
    company: { name: 'IT & Software · TechNova', domain: 'technova' },
    owner: { title: 'VP of Engineering' },
    people: [
        { key: 'aisha', firstName: 'Aisha', lastName: 'Rahman', title: 'Support Lead', role: 'admin', designations: ['Manager'] },
        { key: 'leo', firstName: 'Leo', lastName: 'Martins', title: 'Support Engineer', role: 'member', designations: ['Support Engineer', 'Software Engineer'] },
        { key: 'grace', firstName: 'Grace', lastName: 'Kim', title: 'Engineering Manager', role: 'admin', designations: ['Engineering Manager', 'Manager'] },
        { key: 'omar', firstName: 'Omar', lastName: 'Haddad', title: 'Backend Engineer', role: 'member', designations: ['Backend Developer', 'Software Engineer'] },
        { key: 'nina', firstName: 'Nina', lastName: 'Petrova', title: 'Frontend Engineer', role: 'member', designations: ['Frontend Developer', 'Software Engineer'] },
        { key: 'raj', firstName: 'Raj', lastName: 'Iyer', title: 'Site Reliability Engineer', role: 'member', designations: ['DevOps Engineer', 'Software Engineer'] },
        { key: 'chloe', firstName: 'Chloe', lastName: 'Dubois', title: 'QA Engineer', role: 'member', designations: ['QA Engineer', 'Software Engineer'] },
    ],
    projects: [
        {
            key: 'sup',
            name: 'Customer Support',
            code: 'SUP',
            color: '#0891B2',
            lead: 'aisha',
            members: ['aisha', 'leo', 'grace'],
            views: ['board', 'list', 'table', 'dashboard', 'docs'],
            summary: [
                'Every customer request for the TechNova platform, from first message to closed. Requests are sorted by plan and SLA; bugs go to engineering with steps to reproduce.',
                '',
                '- The Support Agent sorts new requests and drafts replies; a person always presses send.',
                '- The Bug Triager turns customer bug reports into engineering-ready bugs.',
                '- Escalating a request to engineering pages the engineering manager automatically.',
            ].join('\n'),
            stages: [
                { name: 'New', goal: 'Request received with customer, plan and channel.' },
                { name: 'Triaged', goal: 'Kind, urgency and owner set; first reply sent within the SLA.' },
                { name: 'Waiting on customer', goal: 'Asked for what is missing; the clock is paused.' },
                { name: 'Escalated to engineering', goal: 'A bug with steps to reproduce, linked to an engineering task.' },
                { name: 'Resolved', goal: 'Answer or fix delivered and confirmed.' },
                { name: 'Closed', goal: 'Customer confirmed or seven days without reply.' },
            ],
            essentials: ['Enterprise customer on a P1 or P2', 'A request that mentions cancelling'],
            escalations: ['Data loss or a security concern', 'The same bug from three customers'],
            statuses: [
                { name: 'New', type: 'default_active', color: '#64748B' },
                { name: 'Triaged', type: 'active', color: '#2563EB' },
                { name: 'Waiting on customer', type: 'active', color: '#D97706' },
                { name: 'Escalated to engineering', type: 'active', color: '#DC2626' },
                { name: 'Resolved', type: 'done', color: '#0D9488' },
                { name: 'Closed', type: 'close', color: '#16A34A' },
            ],
            types: [
                { name: 'Ticket', icon: 'lifebuoy', color: '#0891B2' },
                { name: 'Bug report', icon: 'bug', color: '#DC2626' },
                { name: 'Feature request', icon: 'lightbulb-on', color: '#F59E0B' },
            ],
            fields: [
                { key: 'customer', title: 'Customer', type: 'text' },
                { key: 'plan', title: 'Plan', type: 'dropdown', options: ['Starter', 'Growth', 'Enterprise'] },
                { key: 'sla', title: 'SLA', type: 'dropdown', options: ['P1 · 1 hour', 'P2 · 4 hours', 'P3 · 1 day'] },
                { key: 'channel', title: 'Channel', type: 'dropdown', options: ['Email', 'Chat', 'Phone'] },
            ],
            tags: [
                { name: 'churn-risk', color: '#DC2626' },
                { name: 'vip', color: '#7C3AED' },
                { name: 'known-issue', color: '#F59E0B' },
            ],
            tasks: [
                {
                    key: 'csv', name: 'SUP-2201 · CSV export of invoices times out', type: 'Bug report', status: 'Triaged', priority: 'HIGH', assignees: ['leo'], due: 0,
                    fields: { customer: 'Acme Retail', plan: 'Enterprise', sla: 'P2 · 4 hours', channel: 'Email' }, blockedBy: ['eng.csv'],
                    description: 'Acme Retail cannot export invoices to CSV since this morning. The export spins for a minute and then fails. Their finance team needs the file for month end.',
                },
                {
                    key: 'sso', name: 'SUP-2205 · SSO login loops back to the sign-in page', type: 'Bug report', status: 'Triaged', priority: 'HIGH', assignees: ['leo'], due: 0,
                    fields: { customer: 'Brightline Health', plan: 'Enterprise', sla: 'P1 · 1 hour', channel: 'Phone' }, tags: ['vip'], blockedBy: ['eng.sso'],
                    description: 'Clinicians at Brightline are sent back to the sign-in page after signing in with Okta. Started around 08:10 UTC.',
                },
                {
                    key: 'double-charge', name: 'SUP-2207 · Charged twice this month', type: 'Ticket', status: 'New', priority: 'HIGH', assignees: ['leo'], due: 0,
                    fields: { customer: 'Fernhill Studio', plan: 'Growth', sla: 'P2 · 4 hours', channel: 'Email' }, tags: ['churn-risk'],
                    description: 'Two charges of $490.00 on the same day. The customer asks whether to cancel and switch providers.',
                },
                {
                    key: 'import', name: 'SUP-2196 · Bulk user import fails on accented names', type: 'Bug report', status: 'Triaged', priority: 'MEDIUM', assignees: ['leo'], due: 2,
                    fields: { customer: 'Lyon Analytique', plan: 'Growth', sla: 'P3 · 1 day', channel: 'Chat' }, tags: ['known-issue'],
                    description: 'Rows with names like "Hélène" or "José" are rejected as invalid.',
                },
                {
                    key: 'webhooks', name: 'SUP-2198 · Webhook deliveries arrive 20 minutes late', type: 'Ticket', status: 'Waiting on customer', priority: 'MEDIUM', assignees: ['aisha'], due: 1,
                    fields: { customer: 'Parcelly', plan: 'Growth', sla: 'P2 · 4 hours', channel: 'Email' },
                    description: 'Asked the customer for their endpoint logs to compare timestamps. Related to INC-309.',
                },
                {
                    key: 'rate-limit', name: 'SUP-2209 · API returns 429 too early for our integration', type: 'Ticket', status: 'New', priority: 'MEDIUM', assignees: ['leo'], due: 1,
                    fields: { customer: 'Northwind Systems', plan: 'Enterprise', sla: 'P2 · 4 hours', channel: 'Email' },
                },
                {
                    key: 'reset-mail', name: 'SUP-2211 · Password reset email never arrives', type: 'Ticket', status: 'New', priority: 'LOW', assignees: ['leo'], due: 2,
                    fields: { customer: 'Cobalt Coffee', plan: 'Starter', sla: 'P3 · 1 day', channel: 'Chat' },
                },
                {
                    key: 'dark-mode', name: 'SUP-2193 · Request: dark mode in the mobile app', type: 'Feature request', status: 'Triaged', priority: 'LOW', assignees: ['aisha'],
                    fields: { customer: 'Several customers', plan: 'Growth', channel: 'Chat' },
                },
                {
                    key: 'second-admin', name: 'SUP-2190 · How do I add a second admin?', type: 'Ticket', status: 'Resolved', priority: 'LOW', assignees: ['leo'], due: -1,
                    fields: { customer: 'Cobalt Coffee', plan: 'Starter', sla: 'P3 · 1 day', channel: 'Chat' },
                },
                {
                    key: 'retention', name: 'SUP-2185 · Data retention questionnaire for procurement', type: 'Ticket', status: 'Closed', priority: 'MEDIUM', assignees: ['aisha'], due: -4,
                    fields: { customer: 'Brightline Health', plan: 'Enterprise', sla: 'P3 · 1 day', channel: 'Email' },
                },
            ],
        },
        {
            key: 'eng',
            name: 'Platform Engineering',
            code: 'ENG',
            color: '#4F46E5',
            lead: 'grace',
            members: ['grace', 'omar', 'nina', 'raj', 'chloe'],
            views: ['board', 'list', 'timeline', 'workload', 'dashboard'],
            summary: [
                'The sprint for release 4.18 of the TechNova platform: stories, customer bugs and chores in one board, from backlog to done.',
                '',
                '- Customer bugs arrive from Support already triaged, with steps to reproduce.',
                '- Every story passes QA before it is done; moving a card to QA hands it to Chloe automatically.',
                '- The Tech Lead and Release Manager agents plan the sprint and prepare the release; the Engineering Daily Digest reports progress.',
            ].join('\n'),
            stages: [
                { name: 'Backlog', goal: 'Written, sized, not yet planned.' },
                { name: 'Ready', goal: 'Planned for this sprint with acceptance criteria.' },
                { name: 'In progress', goal: 'Being built on a branch.' },
                { name: 'In review', goal: 'Pull request open and reviewed.' },
                { name: 'QA', goal: 'Tested against the acceptance criteria.' },
                { name: 'Done', goal: 'Merged and ready to release.' },
            ],
            essentials: ['A bug reported by an Enterprise customer', 'Anything tagged security'],
            escalations: ['The sprint is over capacity', 'A release blocker is found in QA'],
            statuses: [
                { name: 'Backlog', type: 'default_active', color: '#64748B' },
                { name: 'Ready', type: 'active', color: '#0EA5E9' },
                { name: 'In progress', type: 'active', color: '#2563EB' },
                { name: 'In review', type: 'active', color: '#9333EA' },
                { name: 'QA', type: 'active', color: '#D97706' },
                { name: 'Done', type: 'close', color: '#16A34A' },
            ],
            types: [
                { name: 'Story', icon: 'bookmark', color: '#16A34A' },
                { name: 'Bug', icon: 'bug', color: '#DC2626' },
                { name: 'Chore', icon: 'wrench', color: '#64748B' },
            ],
            fields: [
                { key: 'points', title: 'Story points', type: 'number' },
                { key: 'component', title: 'Component', type: 'dropdown', options: ['API', 'Web app', 'Mobile', 'Billing', 'Auth'] },
                { key: 'release', title: 'Target release', type: 'text' },
            ],
            tags: [
                { name: 'customer-reported', color: '#0891B2' },
                { name: 'security', color: '#DC2626' },
                { name: 'tech-debt', color: '#7C3AED' },
            ],
            tasks: [
                {
                    key: 'csv', name: 'Fix: CSV export times out for accounts with 50k+ invoices', type: 'Bug', status: 'Ready', priority: 'MEDIUM', assignees: ['omar'], due: 2,
                    fields: { points: 3, component: 'Billing', release: '4.18' }, tags: ['customer-reported'],
                    description: 'The export builds the whole file in one query and hits the 60-second gateway timeout. Stream rows in pages of 5,000 instead.',
                },
                {
                    key: 'sso', name: 'Fix: SSO redirect loop when the identity provider session has expired', type: 'Bug', status: 'In review', priority: 'HIGH', assignees: ['nina'], due: 0,
                    fields: { points: 5, component: 'Auth', release: '4.18' }, tags: ['customer-reported', 'security'],
                    checklist: [{ text: 'Reproduce with an expired Okta session', done: true }, { text: 'Fix the state check in the callback', done: true }, { text: 'Second review' }, { text: 'Retest on staging with Brightline\'s IdP settings' }],
                },
                {
                    key: 'rate-limits', name: 'Per-token API rate limits with Retry-After headers', type: 'Story', status: 'In review', priority: 'HIGH', assignees: ['omar'], due: 2,
                    fields: { points: 8, component: 'API', release: '4.18' },
                    description: 'Limit each API token to 600 requests a minute, return 429 with Retry-After, and show usage in the admin console.',
                },
                {
                    key: 'webhook-retries', name: 'Webhook retries with exponential backoff', type: 'Story', status: 'In progress', priority: 'MEDIUM', assignees: ['omar'], due: 3,
                    fields: { points: 5, component: 'API', release: '4.18' },
                },
                {
                    key: 'utf8-import', name: 'Bulk import: accept UTF-8 names', type: 'Bug', status: 'Ready', priority: 'MEDIUM', assignees: ['nina'], due: 4,
                    fields: { points: 2, component: 'Web app', release: '4.18' }, tags: ['customer-reported'],
                },
                {
                    key: 'audit-export', name: 'Audit log export to S3', type: 'Story', status: 'Ready', priority: 'MEDIUM', assignees: ['omar'], due: 6,
                    fields: { points: 5, component: 'API', release: '4.19' },
                },
                {
                    key: 'dark-mode', name: 'Dark mode for the mobile app', type: 'Story', status: 'Ready', priority: 'LOW', assignees: ['nina'], due: 7,
                    fields: { points: 8, component: 'Mobile', release: '4.18' },
                },
                {
                    key: 'node22', name: 'Upgrade services from Node 20 to Node 22', type: 'Chore', status: 'Backlog', priority: 'LOW', assignees: ['raj'],
                    fields: { points: 3, component: 'API' }, tags: ['tech-debt'],
                },
                {
                    key: 'admin-2fa', name: 'Enforce two-factor sign-in for workspace admins', type: 'Story', status: 'Done', priority: 'HIGH', assignees: ['nina'], due: -4,
                    fields: { points: 5, component: 'Auth', release: '4.18' }, tags: ['security'],
                },
                {
                    key: 'flaky-e2e', name: 'Quarantine the flaky checkout end-to-end tests', type: 'Chore', status: 'Done', priority: 'MEDIUM', assignees: ['chloe'], due: -2,
                    fields: { points: 2, component: 'Web app', release: '4.18' },
                },
                {
                    key: 'release', name: 'Release 4.18: notes and checklist', type: 'Chore', status: 'Backlog', priority: 'HIGH', assignees: ['grace'], due: 4,
                    fields: { release: '4.18' }, blockedBy: ['sso', 'rate-limits'],
                },
                {
                    key: 'digest', name: 'Daily engineering digest', type: 'Chore', status: 'In progress', priority: 'LOW', assignees: ['you'], due: 5,
                    description: 'Where the Engineering Daily Digest agent posts its board summary. Run it from AI, Agents, Run now, and pick this task.',
                },
            ],
        },
        {
            key: 'ops',
            name: 'IT Operations',
            code: 'OPS',
            color: '#EA580C',
            lead: 'raj',
            members: ['raj', 'grace', 'omar', 'aisha'],
            views: ['board', 'list', 'calendar'],
            summary: [
                'Incidents, planned changes and maintenance for the production platform.',
                '',
                '- An incident under investigation alerts the VP of Engineering and adds the status-page task automatically.',
                '- The Incident Scribe keeps the timeline while engineers fix the problem, then drafts the postmortem.',
                '- Every change carries its rollback plan before its window.',
            ].join('\n'),
            stages: [
                { name: 'Reported', goal: 'Logged with severity, service and customers affected.' },
                { name: 'Investigating', goal: 'On-call engaged, status page updated every 30 minutes.' },
                { name: 'Mitigated', goal: 'Customer impact stopped; root cause may still be open.' },
                { name: 'Monitoring', goal: 'Watching for a recurrence.' },
                { name: 'Postmortem', goal: 'Timeline, root cause and actions written up.' },
                { name: 'Resolved', goal: 'Actions filed, incident closed.' },
            ],
            essentials: ['SEV1 or SEV2', 'Customers affected above 25'],
            escalations: ['Data loss', 'An incident open longer than 2 hours'],
            statuses: [
                { name: 'Reported', type: 'default_active', color: '#64748B' },
                { name: 'Investigating', type: 'active', color: '#DC2626' },
                { name: 'Mitigated', type: 'active', color: '#D97706' },
                { name: 'Monitoring', type: 'active', color: '#2563EB' },
                { name: 'Postmortem', type: 'done', color: '#7C3AED' },
                { name: 'Resolved', type: 'close', color: '#16A34A' },
            ],
            types: [
                { name: 'Incident', icon: 'alert-octagon', color: '#DC2626' },
                { name: 'Change', icon: 'swap-horizontal', color: '#2563EB' },
                { name: 'Maintenance', icon: 'wrench-clock', color: '#64748B' },
            ],
            fields: [
                { key: 'severity', title: 'Severity', type: 'dropdown', options: ['SEV1', 'SEV2', 'SEV3'] },
                { key: 'service', title: 'Service', type: 'dropdown', options: ['Auth', 'API gateway', 'Billing', 'Database', 'Web app'] },
                { key: 'customers', title: 'Customers affected', type: 'number' },
                { key: 'window', title: 'Change window', type: 'date' },
            ],
            tags: [
                { name: 'customer-facing', color: '#DC2626' },
                { name: 'rollback-ready', color: '#16A34A' },
            ],
            tasks: [
                {
                    key: 'inc-311', name: 'INC-311 · SSO sign-in failures for EU customers', type: 'Incident', status: 'Reported', priority: 'HIGH', assignees: ['raj'], due: 0,
                    fields: { severity: 'SEV2', service: 'Auth', customers: 37 }, tags: ['customer-facing'],
                    description: 'Customers on SSO in the EU region are sent back to the sign-in page. Started after the auth-service 3.12.1 deploy.',
                },
                {
                    key: 'inc-309', name: 'INC-309 · Webhook queue backlog', type: 'Incident', status: 'Monitoring', priority: 'MEDIUM', assignees: ['raj'], due: 1,
                    fields: { severity: 'SEV3', service: 'API gateway', customers: 12 },
                },
                {
                    key: 'inc-302', name: 'INC-302 · Billing job ran twice', type: 'Incident', status: 'Postmortem', priority: 'HIGH', assignees: ['raj'], lead: 'grace', due: 1,
                    fields: { severity: 'SEV2', service: 'Billing', customers: 214 }, tags: ['customer-facing'],
                    description: 'A scheduler retry after a node restart charged 214 Growth customers twice. All were refunded within 6 hours.',
                    checklist: [{ text: 'Refund every duplicate charge', done: true }, { text: 'Make the billing job idempotent per invoice' }, { text: 'Alert when a job runs twice in one window' }],
                },
                {
                    key: 'inc-297', name: 'INC-297 · Raised API latency in us-east', type: 'Incident', status: 'Resolved', priority: 'MEDIUM', assignees: ['raj'], due: -5,
                    fields: { severity: 'SEV3', service: 'API gateway', customers: 0 },
                },
                {
                    key: 'chg-118', name: 'CHG-118 · Rotate the database TLS certificates', type: 'Change', status: 'Reported', priority: 'MEDIUM', assignees: ['raj'], due: 2,
                    fields: { service: 'Database', window: 2 }, tags: ['rollback-ready'],
                    checklist: ['New certificates issued and stored in the vault', 'Rollback: keep the old certificates for 24 hours', 'Announce the window in #ops'],
                },
                {
                    key: 'chg-121', name: 'CHG-121 · Deploy release 4.18 to production', type: 'Change', status: 'Reported', priority: 'HIGH', assignees: ['grace'], due: 5,
                    fields: { service: 'Web app', window: 5 }, blockedBy: ['eng.release'],
                },
                {
                    key: 'mnt-044', name: 'Monthly OS patching on build agents', type: 'Maintenance', status: 'Resolved', priority: 'LOW', assignees: ['raj'], due: -3,
                },
            ],
        },
    ],
    agents: [
        { key: 'support', role: 'it-company/support-agent', projects: ['sup'], does: 'Sorts new requests, finds the answer in past tickets and drafts replies a person sends.' },
        { key: 'triager', role: 'it-company/bug-triager', projects: ['sup', 'eng'], does: 'Turns customer bug reports into engineering-ready bugs with steps, priority and owner.' },
        { key: 'techlead', role: 'it-company/tech-lead', projects: ['eng'], does: 'Plans the sprint from the backlog and the ready bugs, within capacity.' },
        { key: 'release', role: 'it-company/release-manager', projects: ['eng', 'ops'], does: 'Writes the release checklist and notes from finished work.' },
        { key: 'scribe', role: 'it-company/incident-scribe', projects: ['ops'], does: 'Keeps the incident timeline and drafts the postmortem.' },
        { key: 'digest', skill: 'digest.ceo', name: 'Engineering Daily Digest', description: 'Posts a short digest of the sprint: what moved, what is stuck, what is late.', projects: ['eng'], does: 'Counts the sprint board and posts what moved, what is stuck and what is late.' },
    ],
    automations: [
        {
            name: 'Escalations page the engineering manager',
            project: 'sup',
            when: { statusTo: 'Escalated to engineering' },
            then: [
                { priority: 'HIGH' },
                { assign: ['grace'] },
                { comment: 'Escalated by automation: engineering acknowledges within one business hour. Support keeps the customer updated every 4 hours until it is fixed.' },
            ],
        },
        {
            name: 'An incident under investigation alerts leadership',
            project: 'ops',
            when: { statusTo: 'Investigating' },
            then: [
                { priority: 'HIGH' },
                { notify: { people: ['you', 'grace'], message: 'An incident is under investigation.' } },
                { subtask: 'Post a status page update every 30 minutes' },
            ],
        },
        {
            name: 'Work moved to QA goes to Chloe',
            project: 'eng',
            when: { statusTo: 'QA' },
            then: [
                { assign: ['chloe'] },
                { comment: 'Ready for QA. Chloe owns sign-off against the acceptance criteria.' },
            ],
        },
    ],
    story: [
        { comment: 'sup.csv', by: 'leo', text: 'Reproduced on Acme\'s account: the export spins for 60 seconds and fails. Accounts under 10,000 invoices are fine. Workaround sent: export by date range.' },
        {
            agentRun: 'triager', task: 'sup.csv', summary: 'Wrote up SUP-2201 as an engineering-ready bug.',
            text: 'Ready for engineering. Steps: 1) Open Billing → Invoices on an account with more than 50,000 invoices. 2) Export CSV. Expected: the file downloads. Actual: the request times out after 60 seconds. Likely cause: the export builds the file in a single query. Priority High: Enterprise customer, P2 SLA, workaround available. Linked to the engineering bug.',
        },
        { move: 'sup.csv', to: 'Escalated to engineering', by: 'aisha' },
        { move: 'sup.sso', to: 'Escalated to engineering', by: 'aisha' },
        {
            agentRun: 'support', task: 'sup.double-charge', summary: 'Drafted a reply about the duplicate charge and linked it to INC-302.',
            text: 'Draft reply for a person to send: "Hi, thanks for flagging this, and sorry for the worry. The second charge of $490.00 was a duplicate caused by a retry on our side. We have refunded it today; it shows on your statement in 3 to 5 business days." Checked: the billing log shows a retried charge, the same pattern as the 214 accounts in INC-302.',
        },
        { move: 'ops.inc-311', to: 'Investigating', by: 'raj' },
        {
            agentRun: 'scribe', task: 'ops.inc-311', summary: 'Started the INC-311 timeline.',
            text: 'Timeline (UTC): 08:12 first SSO failures from EU tenants · 08:19 Raj paged · 08:26 expired identity-provider sessions confirmed as the trigger · 08:31 rollback of auth-service 3.12.1 started. Customers affected so far: 37. Next status update due 09:00.',
        },
        { comment: 'ops.inc-311', by: 'raj', text: 'Rolled back auth-service to 3.12.0. Error rate is dropping. Keeping it in Investigating until EU sign-ins are clean for 15 minutes.' },
        {
            proposal: 'techlead', task: 'eng.csv', summary: 'Proposed pulling the CSV export fix into the sprint ahead of dark mode.',
            what: 'Pull the CSV export fix into this sprint and move dark mode to the next',
            why: 'An Enterprise customer is blocked at month end and the fix is 3 points. Dark mode (8 points) has no committed date, so swapping them keeps the sprint inside capacity.',
            changes: [
                { priority: 'HIGH' },
                { comment: 'Sprint change: CSV export fix in, dark mode to the next sprint. Net change minus 5 points; the sprint is at 34 of 36 points.' },
            ],
            priority: 'high',
        },
        { move: 'eng.rate-limits', to: 'QA', by: 'omar' },
        { comment: 'eng.sso', by: 'chloe', text: 'Retested with an expired Okta session on staging: no loop. Waiting on the second review before I sign it off.' },
        {
            proposal: 'release', task: 'eng.release', summary: 'Prepared the 4.18 release checklist and draft notes.',
            what: 'Add the release checklist and draft notes to release 4.18',
            why: 'Release 4.18 has 2 items done and 2 still in review or QA. It cannot go out until the SSO fix and the rate limits pass QA.',
            changes: [
                { subtask: { title: 'Confirm the SSO fix and the rate limits passed QA', description: 'Both are release blockers for 4.18.' } },
                { comment: 'Draft release notes for 4.18: added per-token API rate limits with Retry-After · two-factor sign-in enforced for admins · fixed the SSO redirect loop · quarantined flaky checkout tests. Blocked by: the SSO fix (in review) and the rate limits (QA).' },
            ],
        },
        {
            proposal: 'triager', task: 'sup.import', summary: 'Matched SUP-2196 to the open engineering bug.',
            what: 'Assign SUP-2196 to Nina, who owns the matching engineering bug',
            why: 'Same root cause as "Bulk import: accept UTF-8 names" in Platform Engineering. Linking them lets Support tell the customer when the fix ships.',
            changes: [
                { assign: ['nina'] },
                { comment: 'Same root cause as the engineering bug "Bulk import: accept UTF-8 names" (2 points, planned for 4.18).' },
            ],
        },
    ],
    routing: {
        sup: [
            { agent: 'support', types: ['Ticket'] },
            { agent: 'triager', types: ['Bug report'] },
        ],
        eng: [
            { agent: 'techlead', types: ['Story', 'Bug'] },
            { agent: 'release', types: ['Chore'] },
        ],
        ops: [
            { agent: 'scribe', types: ['Incident'] },
            { agent: 'release', types: ['Change'] },
        ],
    },
    handOvers: [
        { task: 'sup.double-charge', by: 'aisha' },
        { task: 'sup.import', by: 'aisha' },
        { task: 'eng.webhook-retries', by: 'grace' },
        { task: 'ops.inc-311', by: 'raj' },
    ],
    workflows: {
        templates: ['support-customer-bug', 'engineering-design-to-release'],
        own: {
            key: 'customer-bug-to-sprint',
            name: 'Customer bug: from support to the sprint',
            description: 'Support sorts the request, the Bug Triager files it for engineering, the VP of Engineering approves pulling the fix into the current sprint, and the Tech Lead plans it.',
            steps: [
                { id: 'sTriage', agent: 'support' },
                { id: 'sFile', agent: 'triager' },
                {
                    id: 'sSprintOk',
                    approval: {
                        title: 'Pull the fix into this sprint',
                        prompt: 'The bug is filed with steps to reproduce and a priority. Approve to hand it to the Tech Lead for this sprint, or reject to leave it in the backlog.',
                        owner: 'you',
                    },
                },
                { id: 'sPlan', agent: 'techlead' },
            ],
            run: { task: 'sup.csv', by: 'aisha' },
        },
    },
    goals: [
        {
            name: 'Ship release 4.18',
            description: 'Every 4.18 item done and released.',
            color: '#4F46E5',
            targets: [{ name: 'Release 4.18 items done', kind: 'tasks', tasks: ['eng.csv', 'eng.sso', 'eng.rate-limits', 'eng.webhook-retries', 'eng.utf8-import', 'eng.admin-2fa', 'eng.flaky-e2e'] }],
        },
        {
            name: 'Keep enterprise customers inside their SLA',
            description: 'Escalated enterprise requests resolved, first replies inside the SLA.',
            color: '#0891B2',
            targets: [
                { name: 'Escalated requests resolved', kind: 'tasks', tasks: ['sup.csv', 'sup.sso'] },
                { name: 'No P1 request missed its first-reply SLA this month', kind: 'boolean', done: true },
            ],
        },
    ],
    dashboard: { name: 'Engineering and support', project: 'eng', cards: ['tasks_by_status', 'at_risk', 'project_pulse', 'due_soon'] },
    guide: {
        project: 'sup',
        intro: 'TechNova builds a B2B software platform. You are signed in as the **VP of Engineering**. Work flows across three projects: **Customer Support** sorts and answers requests, **Platform Engineering** builds the release, and **IT Operations** runs incidents and changes. Role agents triage, plan and write things up; people decide.',
        tryThis: [
            'Open **Customer Support** on the Board. SUP-2201 and SUP-2205 are **Escalated to engineering**: when Aisha moved them, the automation set them to High, assigned Grace and posted the SLA comment.',
            'Open **SUP-2201**: the Bug Triager wrote it up with steps to reproduce, and it is blocked by the engineering bug in Platform Engineering.',
            'Move **SUP-2209** (API 429s) to **Escalated to engineering** yourself and watch the same automation fire. Every run is listed under **Automations** in the AI section.',
            'Open **Inbox → Approvals**. The Tech Lead asks to pull the CSV fix into the sprint, the Release Manager has the 4.18 checklist ready and the Bug Triager wants to assign SUP-2196. Approve one: the change is applied for real, with Undo for 15 minutes.',
            'In **IT Operations**, INC-311 is under investigation: the automation alerted you, set it to High and added the status-page subtask; the Incident Scribe keeps the timeline.',
            'In **AI → Agents**, click **Run now** on the **Engineering Daily Digest** and pick **Daily engineering digest**. It runs for real, with no AI model, and posts a digest counted from the board on that task.',
            'Open **Goals** and the **Engineering and support** dashboard: both are counted from the tasks, so they change as you move work.',
        ],
    },
};
