/* The scripted model's answers for "Website relaunch for a client: design, build, launch in 6 weeks".
 * Each answer has the shape the matching prompt asks for, so the server validates it like a real reply. */

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

const description = (context, steps, criteria) => [
    { type: 'paragraph', data: { text: context } },
    { type: 'header', data: { text: 'What to do', level: 4 } },
    { type: 'list', data: { style: 'ordered', items: steps } },
    { type: 'header', data: { text: 'Acceptance criteria', level: 4 } },
    { type: 'list', data: { style: 'unordered', items: criteria } },
];

const COVERAGE_OPEN = {
    coverage: { what_for_whom: 'met', done_when: 'met', existing: 'missing', constraints: 'missing', team: 'missing' },
    notes: {
        what_for_whom: 'A client website relaunch.',
        done_when: 'Live within six weeks.',
        existing: 'Not said whether content and brand assets exist.',
        constraints: 'No budget or platform named.',
        team: 'Not said who does design and build.',
    },
};

const COVERAGE_MET = {
    coverage: { what_for_whom: 'met', done_when: 'met', existing: 'met', constraints: 'met', team: 'met' },
    notes: {},
};

const QUESTIONS = {
    understanding: 'A six-week relaunch of a client website: design, build and go-live.',
    questions: [
        {
            id: 'existing-content', point: 'existing', category: 'features', type: 'segmented', required: true,
            question: 'Is the content moving over from the old site?',
            options: [
                { value: 'migrate', label: 'Migrate it', description: 'Keep pages and blog posts' },
                { value: 'rewrite', label: 'Rewrite it' },
                { value: 'mix', label: 'A mix' },
            ],
            recommended: 'migrate',
        },
        {
            id: 'platform', point: 'constraints', category: 'tech_stack', type: 'segmented', required: true,
            question: 'Which platform will the new site run on?',
            options: [
                { value: 'headless', label: 'Headless CMS' },
                { value: 'wordpress', label: 'WordPress' },
                { value: 'static', label: 'Static site' },
            ],
            recommended: 'headless',
        },
        {
            id: 'team-shape', point: 'team', category: 'audience', type: 'segmented', required: true,
            question: 'Who is on the team?',
            options: [
                { value: 'in-house', label: 'Our studio team' },
                { value: 'with-client', label: 'Studio plus client reviewers' },
            ],
            recommended: 'with-client',
        },
    ],
};

const BRIEF = {
    sections: {
        what_for_whom: 'Relaunch the client\'s marketing website with a new design, a pricing page and a faster, accessible build, for prospects comparing plans.',
        done_when: 'The new site is live in six weeks, old URLs redirect, and the client has signed off the pricing page.',
        existing: 'Pages and blog posts move over from the old site; brand guidelines already exist.',
        constraints: 'Headless CMS, WCAG 2.1 AA, launch on a Tuesday with a rollback plan.',
        team: 'Northwind Studio designs and builds; the client reviews each milestone.',
    },
    assumptions: [],
};

const GUIDE = {
    stages: [
        { name: 'Discovery', goal: 'Agree scope, content and success metrics with the client.' },
        { name: 'Design', goal: 'Wireframes and a design system the client signs off.' },
        { name: 'Build', goal: 'Templates, pricing page and content migration on staging.' },
        { name: 'Launch', goal: 'Redirects, checks and a calm go-live with a rollback plan.' },
    ],
    essentials: ['Client sign-off before the pricing page goes live', 'Every old URL redirects'],
    escalations: ['Any change to scope or budget goes to the project lead.'],
    style: 'Lead with the single clearest next step and propose at most three follow-up tasks.',
};

const TASKS = [
    ['Discovery', 'Kick-off workshop with the client', 0, 'Done', 'High', -10],
    ['Discovery', 'Audit existing pages and content', 1, 'Done', 'Medium', -8],
    ['Discovery', 'Define success metrics', 0, 'In Progress', 'High', 2],
    ['Design', 'Sitemap and page wireframes', 3, 'In Progress', 'High', 4],
    ['Design', 'Design system tokens and components', 3, 'To Do', 'Medium', 9],
    ['Design', 'Client review of the homepage design', 0, 'To Do', 'High', 12],
    ['Build', 'Set up the headless CMS and staging', 4, 'To Do', 'Medium', 14],
    ['Build', 'Build pricing page', 1, 'To Do', 'Urgent', 18],
    ['Build', 'Build homepage and navigation', 2, 'To Do', 'High', 20],
    ['Build', 'Migrate blog posts', 2, 'To Do', 'Medium', 24],
    ['Launch', 'Accessibility pass on every template', 3, 'To Do', 'Medium', 30],
    ['Launch', 'Set up redirects for old URLs', 4, 'To Do', 'High', 34],
    ['Launch', 'Go-live checklist and rollback plan', 0, 'To Do', 'Urgent', 38],
    ['Launch', 'Write the launch announcement', 5, 'To Do', 'Low', 41],
];

function plan(memberIds) {
    const pick = (at) => (memberIds.length ? [memberIds[at % memberIds.length]] : []);
    const sprints = [];
    for (const [list, name, person, status, priority, due] of TASKS) {
        let sprint = sprints.find((s) => s.sprintName === list);
        if (!sprint) {
            sprint = { sprintName: list, tasks: [] };
            sprints.push(sprint);
        }
        sprint.tasks.push({
            TaskName: name,
            descriptionBlocks: description(`Part of the ${list.toLowerCase()} stage of the website relaunch.`, ['Agree the scope with the lead', 'Do the work on staging', 'Ask for review'], ['Reviewed by the project lead', 'Linked from the launch plan']),
            TaskTypeKey: 1,
            status,
            DueDate: day(due),
            AssigneeUserId: pick(person),
            priority,
        });
    }
    return {
        needsClarification: false,
        plan: {
            project: {
                ProjectName: 'Website relaunch',
                ProjectCode: 'WEB',
                description: 'Design, build and launch the client\'s new website in six weeks.',
                projectIcon: { emoji: '🚀', backgroundColor: '#6473E8' },
                DueDate: day(42),
                isPrivateSpace: false,
                ProjectType: 'Fix',
                projectStatusData: [
                    { name: 'Planned', type: 'default_active', textColor: '#6473E8' },
                    { name: 'Live', type: 'close', textColor: '#2E9E6B' },
                ],
                taskStatusData: [
                    { name: 'To Do', type: 'default_active', textColor: '#8A8F98' },
                    { name: 'In Progress', type: 'active', textColor: '#3B82F6' },
                    { name: 'In Review', type: 'active', textColor: '#B7791F' },
                    { name: 'Done', type: 'close', textColor: '#2E9E6B' },
                ],
                taskTypeCounts: [{ name: 'Task', key: 1 }],
                LeadUserId: pick(0),
            },
            sprints,
            views: [
                { name: 'Board by assignee', kind: 'board', look: { groupBy: 'assignee' } },
                { name: 'Due this week', kind: 'list', look: { due: 'this_week', sortBy: 'due', sortDirection: 'asc' } },
            ],
            rules: [{
                name: 'When a task moves to In Review, tell the person who created it',
                trigger: 'task.status_changed',
                conditions: [{ field: 'statusRef', op: 'changedTo', value: 'In Review' }],
                actions: [{ action: 'notify', config: { recipients: ['task_creator'], message: 'Ready for your review.' } }],
            }],
            dashboard: { name: 'Launch health', cards: ['due_soon', 'tasks_by_status', 'at_risk'] },
        },
    };
}

module.exports = { COVERAGE_OPEN, COVERAGE_MET, QUESTIONS, BRIEF, GUIDE, plan, TASK_COUNT: TASKS.length };
