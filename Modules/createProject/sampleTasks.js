const FOCUS_LABELS = {
    software: 'Software',
    design: 'Design / creative',
    marketing: 'Marketing',
    agency: 'Agency / client work',
    operations: 'Operations / HR',
    support: 'Support',
    other: 'Something else',
};

const TEMPLATE_FOCUS_BY_ID = {
    '65f8478c2d7cb2e8c8ace2d3': 'operations',
    '65f8478c2d7cb2e8c8ace2dc': 'software',
    '65f8478c2d7cb2e8c8ace2d1': 'operations',
    '65f8478c2d7cb2e8c8ace2d0': 'software',
    '65f8478c2d7cb2e8c8ace2d8': 'operations',
    '65f8478c2d7cb2e8c8ace2da': 'marketing',
    '65f8478c2d7cb2e8c8ace2d6': 'software',
    '65f8478c2d7cb2e8c8ace2d5': 'operations',
    '65f8478c2d7cb2e8c8ace2db': 'support',
    '65f8478c2d7cb2e8c8ace2d7': 'software',
    '65f8478c2d7cb2e8c8ace2d2': 'design',
    '65f8478c2d7cb2e8c8ace2cf': 'marketing',
    '65f8478c2d7cb2e8c8ace2d4': 'marketing',
    '65f8478c2d7cb2e8c8ace2d9': 'agency',
};

const TEMPLATE_FOCUS_BY_CATEGORY = { 1: 'operations', 2: 'software', 3: 'marketing', 4: 'operations', 5: 'operations', 6: 'support' };

/**
 * Ten tasks, one per thing a new workspace owner should learn. The order
 * matters: the first three are due today and assigned to the owner so the
 * Home "Today" list is never empty on day one.
 */
const LESSONS = [
    { teaches: 'assigning', priority: 'High', dueInDays: 0, assignToOwner: true,
        context: 'Every task has an assignee. Unassigned work is the first thing that slips, so start by taking this one.',
        steps: ['Open this task and click the assignee avatar', 'Pick yourself from the list', 'Notice the task now shows in your Today list on Home'],
        done: ['You are the assignee', 'The task appears under Today on Home'] },
    { teaches: 'priorities', priority: 'Medium', dueInDays: 0, assignToOwner: true,
        context: 'Priority is a flag, not a to-do order. Use it to say what must not wait.',
        steps: ['Open the priority menu on this task', 'Change it from Medium to High', 'Sort the list by priority to see it move'],
        done: ['Priority reads High', 'The list order reflects it'] },
    { teaches: 'comments', priority: 'Low', dueInDays: 0, assignToOwner: true,
        context: 'Conversation lives on the task, so the decision and the work stay together.',
        steps: ['Open the Comments tab on this task', 'Write a short note and @mention yourself', 'Check the mention in your Inbox'],
        done: ['One comment exists on this task', 'The mention shows in Inbox'] },
    { teaches: 'files', priority: 'Medium', dueInDays: 1,
        context: 'Attachments are versioned per task, so nobody hunts through chat for the latest file.',
        steps: ['Drop any file onto this task, or use the attach button', 'Rename it if the file name is unclear', 'Preview it inline'],
        done: ['At least one attachment on the task'] },
    { teaches: 'timer', priority: 'High', dueInDays: 1,
        context: 'Time is tracked against the task you are on. One timer, globally; starting another stops the first.',
        steps: ['Press Start on the timer in this task', 'Work for a while, then press Stop', 'Log an hour manually if you want to backfill'],
        done: ['One time entry on this task', 'Your Getting started checklist ticks "Track an hour of work"'] },
    { teaches: 'statuses', priority: 'Medium', dueInDays: 2,
        context: 'Statuses are the columns on the Board. Move a task and the whole team sees it move.',
        steps: ['Change the status on this task to In Progress', 'Open the Board view and drag it to Done'],
        done: ['The task sits in Done on the Board'] },
    { teaches: 'subtasks', priority: 'Low', dueInDays: 3,
        context: 'Big tasks hide work. Split them so each piece has an owner and a date.',
        steps: ['Add two subtasks to this task', 'Assign each one', 'Watch the parent progress update'],
        done: ['Two subtasks exist and are assigned'] },
    { teaches: 'due dates', priority: 'Medium', dueInDays: 4,
        context: 'Dates drive Today, Overdue and the Planner. A task without a date never shows up where you look.',
        steps: ['Set a due date on this task', 'Open Planner to see it placed', 'Move the date by dragging it in Planner'],
        done: ['The task has a due date', 'It appears in Planner'] },
    { teaches: 'inviting', priority: 'High', dueInDays: 5,
        context: 'AlianHub has no seat pricing. Invite the whole team and hand this task to someone else.',
        steps: ['Open Members from the More menu', 'Invite a teammate by email', 'Assign this task to them once they join'],
        done: ['At least one invitation sent', 'This task is assigned to someone other than you'] },
    { teaches: 'projects', priority: 'Medium', dueInDays: 7,
        context: 'This sample project is disposable. When you are ready, start a real one from a template that matches your work.',
        steps: ['Click New project on the Projects page', 'Pick a template named after your job', 'Delete this sample project when you no longer need it'],
        done: ['One real project exists', 'You know where the templates live'] },
];

const NAMES = {
    software: ['Assign yourself the login bug', 'Raise the API outage to High', 'Comment on the pull-request review', 'Attach the architecture diagram', 'Track an hour on the payments refactor', 'Move "Set up CI" to In Progress', 'Split the release into subtasks', 'Give the mobile beta a due date', 'Invite a teammate and hand them the code review', 'Start a real project from the Sprints template'],
    design: ['Assign yourself the homepage hero', 'Raise the brand refresh to High', 'Comment on the logo round two', 'Attach the moodboard', 'Track an hour on the icon set', 'Move "Wireframe onboarding" to In Progress', 'Split the design system into subtasks', 'Give the print deadline a due date', 'Invite a teammate and hand them the illustrations', 'Start a real project from the Creative template'],
    marketing: ['Assign yourself the launch email', 'Raise the campaign go-live to High', 'Comment on the blog draft', 'Attach the social calendar', 'Track an hour on the landing page copy', 'Move "Keyword research" to In Progress', 'Split the webinar into subtasks', 'Give the newsletter a due date', 'Invite a teammate and hand them the ad creatives', 'Start a real project from the Marketing template'],
    agency: ['Assign yourself the Acme kickoff', 'Raise the client escalation to High', 'Comment on the proposal draft', 'Attach the signed statement of work', 'Track a billable hour for Acme', 'Move "Discovery call" to In Progress', 'Split the retainer into subtasks', 'Give the client review a due date', 'Invite a teammate and hand them the account', 'Start a real project from the Agency template'],
    operations: ['Assign yourself the onboarding checklist', 'Raise the payroll cutoff to High', 'Comment on the new hire plan', 'Attach the vendor contract', 'Track an hour on the quarterly close', 'Move "Update the handbook" to In Progress', 'Split the office move into subtasks', 'Give the compliance review a due date', 'Invite a teammate and hand them the hiring pipeline', 'Start a real project from the Operations template'],
    support: ['Assign yourself ticket #1042', 'Raise the outage report to High', 'Comment on the refund request', 'Attach the customer screenshot', 'Track an hour on the knowledge base', 'Move "Reply to Priya" to In Progress', 'Split the macro rewrite into subtasks', 'Give the SLA review a due date', 'Invite a teammate and hand them the queue', 'Start a real project from the Support template'],
    other: ['Assign yourself your first task', 'Raise this task to High', 'Leave a comment on this task', 'Attach a file to this task', 'Track an hour of work', 'Move this task to In Progress', 'Split this task into subtasks', 'Give this task a due date', 'Invite a teammate and hand them a task', 'Start a real project from a template'],
};

const normaliseFocus = (raw) => {
    const key = String(raw || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(FOCUS_LABELS, key) ? key : 'other';
};

const focusForTemplate = (template) => {
    if (!template) return 'other';
    const byId = TEMPLATE_FOCUS_BY_ID[String(template._id || '')];
    if (byId) return byId;
    return TEMPLATE_FOCUS_BY_CATEGORY[Number(template.TemplateCategory && template.TemplateCategory.key)] || 'other';
};

const dueDate = (days) => {
    const d = new Date();
    d.setHours(18, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return d.toISOString();
};

const descriptionBlocks = (lesson) => ([
    { type: 'paragraph', data: { text: lesson.context } },
    { type: 'header', data: { text: 'What to do', level: 4 } },
    { type: 'list', data: { style: 'ordered', items: lesson.steps } },
    { type: 'header', data: { text: 'Acceptance criteria', level: 4 } },
    { type: 'list', data: { style: 'unordered', items: lesson.done } },
]);

/**
 * Plan-shaped tasks (what the AI orchestrator consumes) for one focus.
 * Names are flavoured by the focus; the lesson each task teaches is fixed.
 */
const sampleTasksFor = (focus, ownerId) => {
    const key = normaliseFocus(focus);
    const names = NAMES[key] || NAMES.other;
    return LESSONS.map((lesson, i) => ({
        TaskName: names[i],
        status: 'To Do',
        priority: lesson.priority,
        DueDate: dueDate(lesson.dueInDays),
        AssigneeUserId: lesson.assignToOwner && ownerId ? [String(ownerId)] : [],
        estimatedHours: 1,
        descriptionBlocks: descriptionBlocks(lesson),
    }));
};

const sampleTaskNamesFor = (focus) => (NAMES[normaliseFocus(focus)] || NAMES.other).slice();

const SAMPLE_PROJECT_NAME = 'Welcome to AlianHub';

const buildSamplePlan = ({ focus, ownerId }) => ({
    project: {
        ProjectName: SAMPLE_PROJECT_NAME,
        description: `Ten short tasks that teach assigning, priorities, comments, files and the timer. Tuned for a ${FOCUS_LABELS[normaliseFocus(focus)].toLowerCase()} team. Delete this project whenever you like.`,
        projectIcon: { type: 'color', data: '#2F3990' },
        isPrivateSpace: false,
        source: 'other',
        skills: [],
        LeadUserId: ownerId ? [String(ownerId)] : [],
        taskTypeCounts: [{ name: 'Task', value: 'task', key: 1 }],
        projectStatusData: [],
        taskStatusData: [],
    },
    sprints: [{ sprintName: 'Getting started', tasks: sampleTasksFor(focus, ownerId) }],
});

module.exports = {
    FOCUS_LABELS,
    SAMPLE_PROJECT_NAME,
    SAMPLE_TASK_COUNT: LESSONS.length,
    normaliseFocus,
    focusForTemplate,
    sampleTasksFor,
    sampleTaskNamesFor,
    buildSamplePlan,
};
