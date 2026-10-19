module.exports = {
    key: 'peoplefirst',
    industry: 'hr',
    company: { name: 'HR & People · PeopleFirst', domain: 'peoplefirst' },
    owner: { title: 'Head of People' },
    people: [
        { key: 'olivia', firstName: 'Olivia', lastName: 'Grant', title: 'Talent Acquisition Lead', role: 'admin', designations: ['Manager'] },
        { key: 'ethan', firstName: 'Ethan', lastName: 'Brooks', title: 'Recruiter', role: 'member', designations: ['HR Executive', 'Operations Executive'] },
        { key: 'sofia', firstName: 'Sofia', lastName: 'Marquez', title: 'People Operations Partner', role: 'member', designations: ['HR Executive', 'Operations Executive'] },
        { key: 'ahmed', firstName: 'Ahmed', lastName: 'Siddiqui', title: 'HR Compliance Specialist', role: 'member', designations: ['HR Executive', 'Operations Executive'] },
        { key: 'mei', firstName: 'Mei', lastName: 'Lin', title: 'IT Support Lead', role: 'member', designations: ['IT Administrator'] },
        { key: 'jonas', firstName: 'Jonas', lastName: 'Weber', title: 'Hiring Manager, Engineering', role: 'member', designations: ['Engineering Manager', 'Manager'] },
    ],
    projects: [
        {
            key: 'hire',
            name: 'Hiring Pipeline',
            code: 'HIRE',
            color: '#DB2777',
            lead: 'olivia',
            members: ['olivia', 'ethan', 'jonas', 'sofia'],
            views: ['board', 'list', 'table', 'docs'],
            summary: [
                'Every open role and candidate, from application to first day. Three roles are open: Senior Backend Engineer (2 seats), Customer Success Manager and Payroll Specialist.',
                '',
                '- The Meeting Notes Writer turns each panel\'s notes into a scorecard; the hiring manager decides.',
                '- The Document Drafter prepares offer letters with every point a person must check marked.',
                '- An accepted offer starts onboarding automatically.',
            ].join('\n'),
            stages: [
                { name: 'Applied', goal: 'Application received and acknowledged.' },
                { name: 'Screening', goal: 'Recruiter call done; must-haves checked.' },
                { name: 'Interviewing', goal: 'Panel interviews with a written scorecard each.' },
                { name: 'Offer', goal: 'Offer approved inside the salary band and sent.' },
                { name: 'Offer accepted', goal: 'Signed offer received; onboarding started.' },
                { name: 'Hired', goal: 'First day done.' },
            ],
            essentials: ['An offer outside the salary band', 'A candidate waiting more than 5 days for feedback'],
            escalations: ['A counter-offer', 'A reference or background check concern'],
            statuses: [
                { name: 'Applied', type: 'default_active', color: '#64748B' },
                { name: 'Screening', type: 'active', color: '#2563EB' },
                { name: 'Interviewing', type: 'active', color: '#7C3AED' },
                { name: 'Offer', type: 'active', color: '#D97706' },
                { name: 'Offer accepted', type: 'done', color: '#0D9488' },
                { name: 'Not progressing', type: 'done', color: '#94A3B8' },
                { name: 'Hired', type: 'close', color: '#16A34A' },
            ],
            types: [
                { name: 'Candidate', icon: 'account-search', color: '#DB2777' },
            ],
            fields: [
                { key: 'role', title: 'Role', type: 'dropdown', options: ['Senior Backend Engineer', 'Customer Success Manager', 'Payroll Specialist'] },
                { key: 'source', title: 'Source', type: 'dropdown', options: ['Referral', 'LinkedIn', 'Careers page', 'Agency'] },
                { key: 'score', title: 'Interview score', type: 'number' },
                { key: 'salary', title: 'Offer salary', type: 'money', currency: 'USD' },
                { key: 'start', title: 'Target start date', type: 'date' },
            ],
            tags: [
                { name: 'relocation', color: '#0891B2' },
                { name: 'urgent-hire', color: '#DC2626' },
            ],
            tasks: [
                {
                    key: 'amara', name: 'Amara Nwosu · Senior Backend Engineer', type: 'Candidate', status: 'Offer', priority: 'HIGH', assignees: ['olivia'], due: 2,
                    fields: { role: 'Senior Backend Engineer', source: 'Referral', score: 4.6, salary: 168000, start: 30 }, tags: ['urgent-hire', 'relocation'],
                    description: 'Panel recommended hire. Moving from Austin; relocation support to confirm.',
                },
                {
                    key: 'diego', name: 'Diego Fernández · Senior Backend Engineer', type: 'Candidate', status: 'Interviewing', priority: 'MEDIUM', assignees: ['ethan'], lead: 'jonas', due: 3,
                    fields: { role: 'Senior Backend Engineer', source: 'LinkedIn', score: 4.1 },
                },
                {
                    key: 'hana', name: 'Hana Kobayashi · Senior Backend Engineer', type: 'Candidate', status: 'Screening', priority: 'MEDIUM', assignees: ['ethan'], due: 2,
                    fields: { role: 'Senior Backend Engineer', source: 'Careers page' },
                },
                {
                    key: 'noah', name: 'Noah Kim · Senior Backend Engineer', type: 'Candidate', status: 'Applied', priority: 'LOW', assignees: ['ethan'], due: 4,
                    fields: { role: 'Senior Backend Engineer', source: 'Agency' },
                },
                {
                    key: 'william', name: 'William Osei · Customer Success Manager', type: 'Candidate', status: 'Offer', priority: 'HIGH', assignees: ['olivia'], due: 1,
                    fields: { role: 'Customer Success Manager', source: 'Agency', score: 4.4, salary: 92000, start: 7 },
                },
                {
                    key: 'rosa', name: 'Rosa Lima · Customer Success Manager', type: 'Candidate', status: 'Not progressing', priority: 'LOW', assignees: ['ethan'], due: -2,
                    fields: { role: 'Customer Success Manager', source: 'LinkedIn', score: 3.2 },
                },
                {
                    key: 'zara', name: 'Zara Ahmed · Customer Success Manager', type: 'Candidate', status: 'Hired', priority: 'MEDIUM', assignees: ['olivia'], due: -10,
                    fields: { role: 'Customer Success Manager', source: 'Referral', score: 4.7, salary: 90000, start: -10 },
                },
                {
                    key: 'ben', name: 'Ben Carter · Payroll Specialist', type: 'Candidate', status: 'Interviewing', priority: 'MEDIUM', assignees: ['ethan'], due: 5,
                    fields: { role: 'Payroll Specialist', source: 'Referral', score: 3.8 },
                },
                {
                    key: 'lena', name: 'Lena Fischer · Payroll Specialist', type: 'Candidate', status: 'Applied', priority: 'LOW', assignees: ['ethan'], due: 4,
                    fields: { role: 'Payroll Specialist', source: 'LinkedIn' },
                },
            ],
        },
        {
            key: 'onb',
            name: 'Onboarding',
            code: 'ONB',
            color: '#059669',
            lead: 'sofia',
            members: ['sofia', 'mei', 'olivia', 'jonas'],
            views: ['board', 'list', 'calendar', 'dashboard'],
            summary: [
                'Each new starter\'s first 30 days, from signed offer to fully productive. IT prepares equipment and accounts before day one; the hiring manager owns the first piece of real work.',
                '',
                '- The Onboarding Coordinator builds each plan from the onboarding doc and keeps it moving.',
                '- A blocked onboarding alerts the Head of People, because the start date may move.',
            ].join('\n'),
            stages: [
                { name: 'Pre-boarding', goal: 'Contract signed, equipment ordered, accounts requested.' },
                { name: 'Week 1', goal: 'Day one done, buddy introduced, first meetings held.' },
                { name: 'First 30 days', goal: 'Training complete and a first piece of work delivered.' },
                { name: 'Blocked', goal: 'Waiting on a check, a document or equipment, with a date.' },
                { name: 'Complete', goal: '30-day check-in done.' },
            ],
            essentials: ['Equipment not ordered 10 working days before the start date', 'Right-to-work check not done before day one'],
            escalations: ['A start date that must move'],
            statuses: [
                { name: 'Pre-boarding', type: 'default_active', color: '#64748B' },
                { name: 'Week 1', type: 'active', color: '#2563EB' },
                { name: 'First 30 days', type: 'active', color: '#7C3AED' },
                { name: 'Blocked', type: 'active', color: '#DC2626' },
                { name: 'Complete', type: 'close', color: '#16A34A' },
            ],
            types: [
                { name: 'Onboarding plan', icon: 'account-plus', color: '#059669' },
                { name: 'Equipment', icon: 'laptop', color: '#2563EB' },
                { name: 'Report', icon: 'file-chart', color: '#64748B' },
            ],
            fields: [
                { key: 'hire', title: 'New hire', type: 'text' },
                { key: 'dept', title: 'Department', type: 'dropdown', options: ['Engineering', 'Customer Success', 'Finance', 'Sales'] },
                { key: 'start', title: 'Start date', type: 'date' },
            ],
            tags: [
                { name: 'remote', color: '#0891B2' },
            ],
            tasks: [
                {
                    key: 'william', name: 'Onboarding · William Osei · Customer Success Manager', type: 'Onboarding plan', status: 'Pre-boarding', priority: 'HIGH', assignees: ['sofia'], due: 7,
                    fields: { hire: 'William Osei', dept: 'Customer Success', start: 7 },
                },
                {
                    key: 'william-kit', name: 'Laptop and accounts · William Osei', type: 'Equipment', status: 'Pre-boarding', priority: 'HIGH', assignees: ['mei'], due: 5,
                    fields: { hire: 'William Osei', dept: 'Customer Success', start: 7 },
                    checklist: ['Laptop ordered (14-inch, standard build)', 'Email, Slack and CRM accounts', 'Security keys and MFA set-up', 'Ship to home address'],
                },
                {
                    key: 'zara', name: 'Onboarding · Zara Ahmed · Customer Success Manager', type: 'Onboarding plan', status: 'First 30 days', priority: 'MEDIUM', assignees: ['sofia'], due: 20,
                    fields: { hire: 'Zara Ahmed', dept: 'Customer Success', start: -10 },
                    checklist: [{ text: 'Day one induction', done: true }, { text: 'Product training', done: true }, { text: 'Shadow 5 customer calls', done: true }, { text: 'Own 3 accounts' }, { text: '30-day check-in' }],
                },
                {
                    key: 'pedro', name: 'Onboarding · Pedro Alves · Data Analyst', type: 'Onboarding plan', status: 'Week 1', priority: 'MEDIUM', assignees: ['sofia'], due: 27,
                    fields: { hire: 'Pedro Alves', dept: 'Finance', start: -3 }, tags: ['remote'],
                },
                {
                    key: 'pedro-kit', name: 'Laptop and accounts · Pedro Alves', type: 'Equipment', status: 'Complete', priority: 'LOW', assignees: ['mei'], due: -5,
                    fields: { hire: 'Pedro Alves', dept: 'Finance', start: -3 },
                },
                {
                    key: 'kai', name: 'Onboarding · Kai Turner · Account Executive', type: 'Onboarding plan', status: 'Pre-boarding', priority: 'HIGH', assignees: ['sofia'], due: 3,
                    fields: { hire: 'Kai Turner', dept: 'Sales', start: 3 },
                    description: 'Starts in three days. The background check is still open.',
                },
                {
                    key: 'mira', name: 'Onboarding · Mira Shah · Frontend Engineer', type: 'Onboarding plan', status: 'Complete', priority: 'LOW', assignees: ['sofia'], due: -6,
                    fields: { hire: 'Mira Shah', dept: 'Engineering', start: -36 },
                },
                {
                    key: 'digest', name: 'Weekly people operations digest', type: 'Report', status: 'Week 1', priority: 'LOW', assignees: ['you'], due: 4,
                    description: 'Where the People Ops Digest agent posts its board summary. Run it from AI, Agents, Run now, and pick this task.',
                },
            ],
        },
        {
            key: 'comp',
            name: 'Compliance and Training',
            code: 'COMP',
            color: '#4338CA',
            lead: 'ahmed',
            members: ['ahmed', 'sofia', 'olivia'],
            views: ['board', 'list', 'calendar'],
            summary: [
                'Every legal and policy obligation with a date: right-to-work checks, certificates, mandatory training and data-protection requests.',
                '',
                '- The Credential Expiry Watch and Training Due Watch agents warn before anything lapses.',
                '- An overdue item alerts the Head of People and goes to compliance at once.',
            ].join('\n'),
            stages: [
                { name: 'Upcoming', goal: 'Known date, owner named.' },
                { name: 'Due soon', goal: 'Inside 60 days; work started.' },
                { name: 'In progress', goal: 'Being completed by the people affected.' },
                { name: 'Overdue', goal: 'Past its date; escalated with a recovery plan.' },
                { name: 'Complete', goal: 'Evidence stored.' },
            ],
            statuses: [
                { name: 'Upcoming', type: 'default_active', color: '#64748B' },
                { name: 'Due soon', type: 'active', color: '#D97706' },
                { name: 'In progress', type: 'active', color: '#2563EB' },
                { name: 'Overdue', type: 'active', color: '#DC2626' },
                { name: 'Complete', type: 'close', color: '#16A34A' },
            ],
            types: [
                { name: 'Certification', icon: 'certificate', color: '#4338CA' },
                { name: 'Training', icon: 'school', color: '#7C3AED' },
                { name: 'Policy', icon: 'file-sign', color: '#0D9488' },
            ],
            fields: [
                { key: 'requirement', title: 'Requirement', type: 'dropdown', options: ['Right to work', 'Data protection', 'Health and safety', 'Harassment prevention', 'Security awareness'] },
                { key: 'people', title: 'People affected', type: 'number' },
                { key: 'expires', title: 'Expiry date', type: 'date' },
            ],
            tasks: [
                {
                    key: 'visas', name: 'Work visa renewals · 2 engineers', type: 'Certification', status: 'Due soon', priority: 'HIGH', assignees: ['ahmed'], due: 15,
                    fields: { requirement: 'Right to work', people: 2, expires: 45 },
                },
                {
                    key: 'gdpr', name: 'Annual data-protection training · 14 people outstanding', type: 'Training', status: 'In progress', priority: 'MEDIUM', assignees: ['ahmed'], due: 9,
                    fields: { requirement: 'Data protection', people: 14 },
                },
                {
                    key: 'first-aid', name: 'First-aid certificates · London office', type: 'Certification', status: 'Due soon', priority: 'MEDIUM', assignees: ['ahmed'], due: -1, overdue: true,
                    fields: { requirement: 'Health and safety', people: 2, expires: -1 },
                    description: 'Two first-aiders\' certificates lapsed yesterday; the office needs at least two certified first-aiders on site.',
                },
                {
                    key: 'harassment', name: 'Harassment-prevention refresher for managers', type: 'Training', status: 'Upcoming', priority: 'MEDIUM', assignees: ['sofia'], due: 20,
                    fields: { requirement: 'Harassment prevention', people: 9 },
                },
                {
                    key: 'handbook', name: 'Employee handbook v5 acknowledgements', type: 'Policy', status: 'In progress', priority: 'LOW', assignees: ['sofia'], due: 6,
                    fields: { people: 11 },
                    description: '92% of staff have acknowledged the new handbook; 11 people are outstanding.',
                },
                {
                    key: 'dsar', name: 'Data subject access request · former employee', type: 'Policy', status: 'In progress', priority: 'HIGH', assignees: ['ahmed'], due: 12,
                    fields: { requirement: 'Data protection', people: 1 },
                    description: 'Statutory deadline: 30 days from receipt. Identity verified.',
                },
                {
                    key: 'phishing', name: 'Security awareness: quarterly phishing test', type: 'Training', status: 'Complete', priority: 'LOW', assignees: ['ahmed'], due: -8,
                    fields: { requirement: 'Security awareness', people: 58 },
                },
            ],
        },
    ],
    agents: [
        { key: 'notes', role: 'professional-services/meeting-notes-writer', projects: ['hire'], does: 'Turns each interview panel\'s notes into a scorecard and next steps.' },
        { key: 'drafter', role: 'professional-services/document-drafter', projects: ['hire'], does: 'Drafts offer letters with every point a person must check marked.' },
        { key: 'onboarding', role: 'it-company/onboarding-coordinator', projects: ['onb'], does: 'Builds each new starter\'s first-weeks plan and keeps it moving.' },
        { key: 'training', role: 'manufacturing/training-due-watch', projects: ['comp'], does: 'Watches training records and warns before anyone falls out of date.' },
        { key: 'credentials', role: 'clinic/credential-expiry-watch', projects: ['comp'], does: 'Tracks expiring visas, registrations and certificates.' },
        { key: 'digest', skill: 'digest.ceo', name: 'People Ops Digest', description: 'Posts a short digest of onboarding: what moved, what is blocked, what is late.', projects: ['onb'], does: 'Counts the onboarding board and posts what moved, what is blocked and what is late.' },
    ],
    automations: [
        {
            name: 'An accepted offer starts onboarding',
            project: 'hire',
            when: { statusTo: 'Offer accepted' },
            then: [
                { assign: ['sofia'] },
                { notify: { people: ['sofia', 'mei'], message: 'An offer was accepted: start the onboarding plan and order equipment.' } },
                { comment: 'Offer accepted. People Operations starts the onboarding plan; IT orders equipment with 10 working days\' notice.' },
            ],
        },
        {
            name: 'A blocked onboarding alerts the Head of People',
            project: 'onb',
            when: { statusTo: 'Blocked' },
            then: [
                { priority: 'HIGH' },
                { notify: { people: ['you', 'sofia'], message: 'An onboarding is blocked and the start date may move.' } },
                { comment: 'Blocked: the Head of People was notified. Record what is missing, who owes it and the date it is promised.' },
            ],
        },
        {
            name: 'Overdue compliance items escalate',
            project: 'comp',
            when: { statusTo: 'Overdue' },
            then: [
                { priority: 'HIGH' },
                { assign: ['ahmed'] },
                { notify: { people: ['you'], message: 'A compliance item is overdue.' } },
            ],
        },
    ],
    story: [
        {
            agentRun: 'notes', task: 'hire.diego', summary: 'Turned the panel\'s notes into Diego\'s scorecard.',
            text: 'Interview scorecard, panel: Jonas Weber, Ethan Brooks. System design 4/5: designed a rate limiter with clear trade-offs. Coding 4/5. Collaboration 4.5/5. Concern: limited on-call experience. The panel recommends a final round. Overall 4.1.',
        },
        { comment: 'hire.diego', by: 'jonas', text: 'Agree with the scorecard. Let\'s book the final round this week.' },
        { move: 'hire.william', to: 'Offer accepted', by: 'olivia' },
        {
            proposal: 'onboarding', task: 'onb.william', summary: 'Built William Osei\'s first-weeks plan from the onboarding doc.',
            what: 'Add William Osei\'s first-weeks plan',
            why: 'William starts in 7 days as Customer Success Manager. The onboarding doc requires accounts on day one, a buddy and customer-call shadowing in week one.',
            changes: [
                { subtask: { title: 'Day one: accounts, laptop and HR induction', description: 'IT has the equipment task; HR induction 10:00 to 12:00.' } },
                { subtask: { title: 'Week one: shadow 3 customer calls', description: 'Pick calls from accounts William will take over.' } },
                { comment: 'Plan follows the Customer Success onboarding doc. Buddy to be named by the Customer Success lead. First owned accounts in week 3.' },
            ],
            priority: 'high',
        },
        {
            proposal: 'drafter', task: 'hire.amara', summary: 'Drafted Amara Nwosu\'s offer letter for Olivia to finish.',
            what: 'Post the draft offer letter for Amara Nwosu',
            why: 'The panel recommended hiring (score 4.6) and the salary is inside the Senior Backend Engineer band ($155,000 to $175,000).',
            changes: [
                { comment: 'Draft offer for Olivia to finish and send: Senior Backend Engineer, base salary $168,000, standard equity grant, benefits from day one. Marked [CHECK]: the relocation allowance from Austin and the notice period with her current employer.' },
            ],
        },
        { move: 'onb.kai', to: 'Blocked', by: 'sofia' },
        { comment: 'onb.kai', by: 'sofia', text: 'The background check provider needs one more reference. Kai has sent it; clearance is expected in two days, so the start date holds for now.' },
        { move: 'comp.first-aid', to: 'Overdue', by: 'ahmed' },
        {
            agentRun: 'credentials', task: 'comp.visas', summary: 'Found two work visas expiring in 45 days.',
            text: 'Expiry watch: two work visas in Engineering expire in 45 days. Renewal takes about 30 days with the sponsor, so applications should start this week to avoid a gap. Documents to request: an employment confirmation letter and the last 3 payslips.',
        },
        {
            agentRun: 'training', task: 'comp.gdpr', summary: 'Counted who still owes the data-protection training.',
            text: 'Training status: 14 of 58 people have not completed the annual data-protection training; 9 of them are in Customer Success. It is due in 9 days. Suggested: a reminder from each team lead today and a 20-minute group session this week.',
        },
        { comment: 'comp.dsar', by: 'ahmed', text: 'Identity verified. Pulling records from the HR system and the ticketing tool; the response is due in 12 days.' },
    ],
    routing: {
        hire: [
            { agent: 'notes', statuses: ['Interviewing'] },
            { agent: 'drafter', statuses: ['Offer'] },
        ],
        onb: [
            { agent: 'onboarding', types: ['Onboarding plan', 'Equipment'] },
        ],
        comp: [
            { agent: 'credentials', types: ['Certification'] },
            { agent: 'training', types: ['Training'] },
        ],
    },
    handOvers: [
        { task: 'hire.diego', by: 'olivia' },
        { task: 'onb.pedro', by: 'sofia' },
        { task: 'comp.gdpr', by: 'ahmed' },
    ],
    workflows: {
        own: {
            key: 'offer-to-first-day',
            name: 'Hiring: from the offer to the first day',
            description: 'The Document Drafter drafts the offer letter with every point to check marked, the Head of People approves it inside the salary band, and the Onboarding Coordinator builds the first-weeks plan.',
            steps: [
                { id: 'sDraft', agent: 'drafter' },
                {
                    id: 'sOfferOk',
                    approval: {
                        title: 'Approve the offer',
                        prompt: 'The offer letter is drafted with every point to check marked. Approve it inside the salary band, or reject it with a comment for the recruiter.',
                        owner: 'you',
                    },
                },
                { id: 'sPlan', agent: 'onboarding' },
            ],
            run: { task: 'hire.amara', by: 'olivia' },
        },
    },
    goals: [
        {
            name: 'Fill this quarter\'s open roles',
            description: 'Senior Backend Engineer (2), Customer Success Manager and Payroll Specialist hired.',
            color: '#DB2777',
            targets: [{ name: 'Offers accepted or hired', kind: 'tasks', tasks: ['hire.amara', 'hire.diego', 'hire.william', 'hire.zara', 'hire.ben'] }],
        },
        {
            name: 'Every new starter productive in 30 days',
            description: 'Onboarding plans complete within 30 days of the start date.',
            color: '#059669',
            targets: [{ name: 'Onboarding plans complete', kind: 'tasks', tasks: ['onb.william', 'onb.zara', 'onb.pedro', 'onb.kai', 'onb.mira'] }],
        },
        {
            name: 'Nothing lapses',
            description: 'Every certificate, check and mandatory training done before its date.',
            color: '#4338CA',
            targets: [
                { name: 'Compliance items complete', kind: 'tasks', lists: ['comp'] },
                { name: 'Right-to-work checks done before day one for every starter', kind: 'boolean', done: true },
            ],
        },
    ],
    dashboard: { name: 'People operations', project: 'onb', cards: ['tasks_by_status', 'at_risk', 'due_soon', 'project_pulse'] },
    guide: {
        project: 'hire',
        intro: 'PeopleFirst runs hiring, onboarding and compliance for a 60-person company. You are signed in as the **Head of People**. **Hiring Pipeline** follows every candidate, **Onboarding** takes each new starter through their first 30 days, and **Compliance and Training** keeps every date that matters. Role agents take notes, draft and watch dates; people decide.',
        tryThis: [
            'Open **Hiring Pipeline** on the Board. William Osei is in **Offer accepted**: when Olivia moved him, the automation assigned Sofia, told IT and People Operations, and posted the next steps.',
            'Open **Inbox → Approvals**. The Onboarding Coordinator has William\'s first-weeks plan ready, and the Document Drafter has Amara\'s offer letter. Approve one: the subtasks or the comment are created for real, with Undo for 15 minutes.',
            'Open **Diego Fernández** to read the scorecard the Meeting Notes Writer made from the panel\'s notes.',
            'In **Onboarding**, Kai Turner is **Blocked** on a background check; in **Compliance and Training**, the first-aid certificates are **Overdue**. Both automations notified you.',
            'Move **Ben Carter** to **Offer accepted** yourself and watch the onboarding automation fire. Every run is listed under **Automations** in the AI section.',
            'In **AI → Agents**, click **Run now** on the **People Ops Digest** and pick **Weekly people operations digest**. It runs for real, with no AI model, and posts a digest counted from the board on that task.',
            'Open **Goals** and the **People operations** dashboard: both are counted from the tasks.',
        ],
    },
};
