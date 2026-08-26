const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { MongoDbCrudOpration } = require('./mongo-handler/mongoQueries');
const { removeCache } = require('./commonFunctions');
const logger = require('../Config/loggerConfig');

// Sample tasks are inserted directly rather than through Modules/Tasks/helpers/taskMongo/create.js.
// That helper writes history and fires notifications, and at project-creation time there is no
// acting user to attribute them to — HandleHistory rejects on an empty user object, which has taken
// the server down before. Seeded example content needs neither a history trail nor a notification.
//
// Keyed by the template's TemplateName exactly as it appears in utils/projectTemplates.json, so a
// template with no entry simply gets no sample tasks.
const SAMPLE_TASKS = {
    'Backlogs and Sprints': [
        ['Write down everything the team might work on', 'This is your backlog. Anything that is not committed to yet lives here — rough ideas included. Nothing here has to be well defined.'],
        ['Pick what goes into this sprint', 'Move the items you are confident about into the sprint, and leave the rest in the backlog. If you are unsure, leave it out.'],
        ['Give each item an estimate', 'Open a task and set its estimated hours. Estimates are what make the burndown chart mean anything later.'],
        ['Assign an owner to every committed item', 'A task with no owner is a task nobody starts. Use the assignee field on each one.'],
        ['Try the Board view', 'Switch views using the tabs above the task list. The board shows the same tasks as columns you can drag between.'],
        ['Hold a short daily check-in', 'Comment on your own tasks with what changed. Comments keep the context on the work instead of in chat.'],
        ['Review what did not get finished', 'At the end of the sprint, move anything unfinished back to the backlog rather than deleting it.'],
        ['Delete these examples when you are ready', 'These eight tasks are here to show how the pieces fit together. Select them all and delete them once you have your own work in.'],
    ],
    'Hiring Candidates': [
        ['Write the job description', 'Use the task description for the full text. Everyone hiring can then read the same version instead of passing a document around.'],
        ['Decide who is on the interview panel', 'Add them as watchers on this task so they get told when anything changes.'],
        ['Post the role', 'One task per place you post it works well — you can see at a glance where you have and have not been.'],
        ['Screen the applications', 'Use the checklist inside this task to tick candidates off as you go.'],
        ['First interviews', 'Make one task per candidate as a subtask of this one, so the shortlist stays together.'],
        ['Take up references', 'Attach anything you receive to the task rather than keeping it in email.'],
        ['Make the offer', 'Set a due date on this one — offers going stale is the most common way a hire is lost.'],
        ['Delete these examples when you are ready', 'These are here to show the shape of a hiring pipeline. Select them all and delete them once you have real candidates.'],
    ],
    'Quick Start: Marketing': [
        ['Decide what this campaign is for', 'One clear goal per campaign. Put it in this description so every task below can be judged against it.'],
        ['Agree the audience', 'Who is this for, and what do they already believe? Everything else follows from the answer.'],
        ['Draft the message', 'Keep drafts in the task description so the history of what changed stays with the work.'],
        ['Produce the assets', 'Attach each finished asset to this task. Attachments live on the task, so nobody has to go looking.'],
        ['Schedule the posts', 'Set a due date on each one and the calendar view fills itself in.'],
        ['Launch', 'Mark this complete on the day it goes live. It becomes the marker you measure everything else from.'],
        ['Report on what happened', 'Write the numbers into a comment rather than a separate document, so next time you can find them.'],
        ['Delete these examples when you are ready', 'These eight are a starting shape for a campaign. Select them all and delete them once your own is in.'],
    ],
    'Support': [
        ['Set up how requests reach you', 'Decide where support requests arrive before you need them to. Write the answer here.'],
        ['Agree what counts as urgent', 'Use the priority field to mean the same thing across the team, and write down what each level means.'],
        ['Write answers to the questions you get most', 'One task per answer. Over time this becomes the fastest part of your support.'],
        ['Example: a customer cannot sign in', 'A worked example. Note how the description holds the detail and the comments hold the back and forth.'],
        ['Decide who picks up what', 'Assign an owner to every incoming request. Unassigned requests are the ones that get missed.'],
        ['Agree a response time', 'Set due dates from the day a request arrives, not the day you get to it.'],
        ['Look back at the week', 'What came up more than once? Those are the things worth fixing properly.'],
        ['Delete these examples when you are ready', 'Select them all and delete them once real requests are coming in.'],
    ],
    'Creative & Design': [
        ['Write the brief', 'What is being made, for whom, and what does done look like. Everything else hangs off this.'],
        ['Gather references', 'Attach the things you like to this task. Showing beats describing.'],
        ['First concepts', 'Make one task per direction you explore, as subtasks of this one, so the options stay side by side.'],
        ['Internal review', 'Use comments for feedback rather than a separate thread. The feedback then sits next to the work it is about.'],
        ['Revisions', 'Attach each new version instead of replacing the old one — being able to go back is worth the clutter.'],
        ['Final approval', 'Set the status to complete only when someone has actually said yes.'],
        ['Hand over the files', 'Attach the final assets here so whoever needs them later does not have to ask.'],
        ['Delete these examples when you are ready', 'Select them all and delete them once your own work is in.'],
    ],
};

// The demo project a brand-new company lands on. Deliberately one task per feature, so reading the
// list is itself the tour.
const WELCOME_PROJECT_NAME = 'Welcome to AlianHub';
const WELCOME_TASKS = [
    ["Start here — this project is a sandbox",
        "Welcome to AlianHub. This project is example content made just for you — nothing in it touches real work, and deleting it later removes it completely.\nEach task below teaches one core part of the system. Work through them in order like a checklist: open a task, read it, do the small exercise at the end, then set its status to Complete.\nTry it now:\n1. Click this task's name to open it.\n2. What opened is the task detail — the description here, and the fields (Assignee, Priority, dates) beside it.\n3. Change the status from To Do to Complete, and watch this row move on the list."],
    ["Open a task to see what it holds",
        "A task is the basic unit of work in AlianHub. Everything about one piece of work lives on the task itself, so nobody has to dig through chat or email for the context later.\nEvery task holds: a description like this one, an assignee, a status, a priority, start and due dates, attachments, comments, subtasks, and an activity log where every change is recorded automatically.\nTry it:\n1. Open this task and look along the toolbar — hover each icon to see what it does.\n2. Find the Activity section: it already shows when this task was created.\n3. Change any field, look at Activity again, and see the change recorded with your name on it."],
    ["Give a task an owner",
        "The assignee is the person responsible for a task. Work only shows up in someone's own list once it is assigned to them — an unassigned task is a task nobody starts.\nMore than one person can be assigned when the work is genuinely shared, and watchers can follow a task without owning it.\nTry it:\n1. Open this task and click the assignee control.\n2. Pick yourself — your avatar appears on this row in the list.\n3. Use the Me filter at the top of the list to see only the tasks assigned to you."],
    ["Set a priority",
        "Priority says what matters most when everything feels urgent: Urgent, High, Medium or Low, shown as a coloured flag on every row.\nIt earns its keep in the views — sort, group and filter by priority so the team always starts at the top of the pile.\nTry it:\n1. Open this task and set the priority flag to High.\n2. Back on the list, open the Group by control at the top and choose Priority.\n3. The list reorganises into priority groups. Switch Group by back to Status when you are done."],
    ["Leave a comment",
        "Comments keep the conversation attached to the work. Six months from now the reasoning is still on the task, instead of lost in a chat thread.\nType @ followed by a name to mention someone — they get a notification that points straight at this task.\nTry it:\n1. Open this task and find the comment box at the bottom.\n2. Write anything and post it.\n3. Hover your comment to edit it or add a reaction — comments are a conversation, not just a log."],
    ["Attach a file",
        "Files belong with the work they are about. Attach designs, documents, screenshots or contracts to the task, and whoever opens it later finds everything in one place.\nTry it:\n1. Open this task.\n2. Drag any file from your computer onto it, or use the paperclip control.\n3. The file appears in the Attachments section — click it to preview it right here, without downloading."],
    ["Track how long something takes",
        "AlianHub has time tracking built in, so timesheets fill themselves from real work instead of Friday-evening guesswork.\nStart the timer when you begin and stop it when you pause — or log time afterwards if you forgot. Add an estimate to a task and you can compare the plan against what actually happened.\nTry it:\n1. Open this task and start the timer control.\n2. Stop it after a few seconds — the entry is saved against this task.\n3. Open Time Sheet from the top menu: the time you just logged is already in your day."],
    ["Break a big task into subtasks",
        "When one task is really several pieces of work, split it into subtasks. The parent keeps the overall picture; each subtask gets its own assignee, status and dates.\nTry it:\n1. Open this task and find the Subtask section.\n2. Add two or three subtasks — the steps of something you are actually doing this week work well.\n3. Close the task and click the expand arrow on this row — your subtasks nest underneath it in the list."],
    ["Try a different view",
        "The same tasks can be looked at in different ways, and the tabs above this list switch between them.\nList is the day-to-day view, grouped by status. Board turns statuses into columns you drag cards between — ideal for standups. Project Details, Comments and Activity hold this project's own information, discussion and history. Workload shows who has how much on their plate.\nTry it:\n1. Click Board in the tabs above.\n2. Drag this card from To Do to another column and back — dragging IS changing the status.\n3. Click + View to see what else is available; Calendar and Table are good ones to add next."],
    ["Invite someone",
        "AlianHub is built for teams. Invite a colleague and you can assign work to each other, comment, and mention each other on tasks.\nNew people join with the Member role: they can work on projects and tasks straight away, but cannot change company settings. Roles and permissions can be adjusted any time in Settings.\nTry it:\n1. Open Settings from your profile menu, then Members.\n2. Enter a colleague's email, keep the Member role, and send the invitation.\n3. Once they accept, assign them one of these tasks and mention them in a comment with @."],
    ["Delete this project when you are finished",
        "Once you have worked through these tasks, this project has done its job.\nDeleting it removes the project and everything in it — these example tasks, their comments and attachments. Nothing else in your workspace is affected.\nTry it:\n1. Find this project in the left sidebar.\n2. Open its menu (the three dots) and choose Delete.\n3. Confirm — then start your first real project with the + New button, and pick a template that matches your work."],
];

// Checked field by field against schema.tasks rather than copied from a project payload. The
// required set is TaskName, TaskKey, TaskType, TaskTypeKey, ProjectID, CompanyId, status,
// isParentTask, Task_Leader, sprintArray, Task_Priority, deletedStatusKey, sprintId, statusType,
// statusKey — and Task_Leader is a String, not an array, which is what an [] here failed on.
const TASK_DEFAULTS = {
    AssigneeUserId: [],
    watchers: [],
    DueDate: null,
    dueDateDeadLine: [],
    ParentTaskId: '',
    isParentTask: true,
    Task_Priority: 'MEDIUM',
    deletedStatusKey: 0,
    queueListArray: [],
    attachments: [],
    relations: [],
    reactions: [],
    checklistArray: [],
    tagsArray: [],
    favouriteTasks: [],
    // statusKey 1 / "default_active" is To Do, which importTaskDefaultStatus seeds for every company.
    statusType: 'default_active',
    statusKey: 1,
    estimateChangedFlag: false,
    points: null,
    subTasks: 0,
};

// Where a task sits. Resolved against the project's OWN status list rather than hardcoded keys,
// because a company can edit its statuses and the demo has to follow whatever it actually has.
function resolveStatus(taskStatusData, want) {
    const list = Array.isArray(taskStatusData) ? taskStatusData : [];
    const byType = (t) => list.find((s) => s && s.type === t);
    const byName = (n) => list.find((s) => s && String(s.name).toLowerCase() === n);
    const actives = list.filter((s) => s && s.type === 'active');

    let hit = null;
    if (want === 'in_progress') hit = byName('in progress') || actives[0];
    else if (want === 'in_review') hit = byName('in review') || actives[1] || actives[0];
    else if (want === 'backlog') hit = byName('backlog') || actives[actives.length - 1];
    else if (want === 'done') hit = byType('done') || byName('done') || actives[actives.length - 1];
    else if (want === 'complete') hit = byType('close') || byName('complete');
    hit = hit || byType('default_active') || list[0];

    return hit ? { text: hit.name, key: hit.key, type: hit.type } : null;
}

const dayMs = 24 * 60 * 60 * 1000;

// Rows are [title, description] or [title, description, options]. Template rows carry no options
// and so come out looking exactly as they did before; only the welcome set uses them, to make the
// demo project look like a project someone has actually been working in — statuses spread across
// the board, real owners, dates on the calendar, mixed priorities and one task with subtasks.
function buildTaskDocs(project, sprint, rows, startingNumber, ownerId) {
    const projectId = String(project._id);
    const companyId = String(project.CompanyId);
    const code = project.ProjectCode || 'TASK';
    const firstType = (project.taskTypeCounts && project.taskTypeCounts[0]) || null;
    const statuses = project.taskStatusData;
    const fallback = resolveStatus(statuses) || { text: 'To Do', key: 1, type: 'default_active' };
    const today = new Date(new Date().setHours(12, 0, 0, 0));

    const describe = (text) => ({
        description: text,
        descriptionBlock: {
            time: Date.now(),
            blocks: String(text).split('\n').filter((line) => line.trim())
                .map((line, n) => ({ id: 'manual-entry-' + n, type: 'paragraph', data: { text: line } })),
            version: '2.30.7',
        },
    });

    const base = (TaskName, text, n) => ({
        ...TASK_DEFAULTS,
        TaskName,
        ...describe(text),
        TaskKey: `${code}-${n}`,
        ProjectID: projectId,
        CompanyId: companyId,
        sprintId: String(sprint._id),
        // Real tasks carry the whole sprint document here, not an array, and Task_Leader is a
        // user id string. status is an object too — every existing task in the wild has all
        // three in exactly this shape.
        sprintArray: sprint,
        Task_Leader: ownerId,
        status: fallback,
        statusType: fallback.type,
        statusKey: fallback.key,
        // Real tasks store the type's VALUE ("task"), not its display name ("Task") — the UI
        // looks the type up by value, so a name here shows the wrong icon and label.
        TaskType: (firstType && firstType.value) || 'task',
        TaskTypeKey: (firstType && firstType.key) !== undefined ? firstType.key : 1,
    });

    const docs = [];
    const comments = [];
    let n = startingNumber;

    rows.forEach((row, i) => {
        const [TaskName, text, opts = {}] = row;
        n += 1;

        // Ids are generated up front so a subtask can name its parent in the same insert.
        const _id = new mongoose.Types.ObjectId();
        const doc = { ...base(TaskName, text, n), _id, groupByStatusIndex: i };

        const status = opts.status ? resolveStatus(statuses, opts.status) : null;
        if (status) {
            doc.status = status;
            doc.statusType = status.type;
            doc.statusKey = status.key;
        }
        if (opts.assign) doc.AssigneeUserId = [ownerId];
        if (opts.priority) doc.Task_Priority = opts.priority;
        if (opts.dueInDays !== undefined) doc.DueDate = new Date(today.getTime() + (opts.dueInDays * dayMs));

        const kids = Array.isArray(opts.subtasks) ? opts.subtasks : [];
        doc.subTasks = kids.length;
        docs.push(doc);

        kids.forEach((kidName, k) => {
            n += 1;
            docs.push({
                ...base(kidName, `An example subtask of "${TaskName}".`, n),
                _id: new mongoose.Types.ObjectId(),
                isParentTask: false,
                ParentTaskId: String(_id),
                subTasks: 0,
                groupByStatusIndex: k,
                ...(k === 0 ? { status: resolveStatus(statuses, 'complete') || fallback } : {}),
            });
            if (k === 0) {
                const last = docs[docs.length - 1];
                last.statusType = last.status.type;
                last.statusKey = last.status.key;
            }
        });

        if (opts.comment) {
            comments.push({
                project: false,
                projectId,
                taskId: String(_id),
                sprintId: String(sprint._id),
                userId: ownerId,
                type: 'text',
                message: opts.comment,
                isDeleted: false,
                hasReply: false,
                mentionIds: [],
            });
        }
    });

    return { docs, comments };
}

// Never rejects. Sample content failing must not take a project creation down with it.
async function seedSampleTasks(project, sprint, rows, ownerId) {
    try {
        const leader = String(ownerId || project.projectCreatedBy
            || (Array.isArray(project.LeadUserId) && project.LeadUserId[0]) || '');
        // Task_Leader is required and a String, so an empty one fails validation outright.
        if (!project || !project._id || !sprint || !sprint._id || !leader
            || !Array.isArray(rows) || !rows.length) {
            logger.error('seedSampleTasks: nothing to do (missing project, sprint, owner or rows)');
            return 0;
        }

        const companyId = String(project.CompanyId);
        const startingNumber = Number(project.lastTaskId) || 0;
        const { docs, comments } = buildTaskDocs(project, sprint, rows, startingNumber, leader);

        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [docs],
        }, 'insertMany');

        // Comments are a nice-to-have: one example so the chat column is not blank. Their own
        // failure must not lose the tasks that were already written.
        if (comments.length) {
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.COMMENTS,
                data: [comments],
            }, 'insertMany').catch((error) => {
                logger.error(`seedSampleTasks: example comment skipped — ${error.message}`);
            });
        }

        // TaskKey numbering comes off lastTaskId, so it has to move or the next real task collides.
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [
                { _id: project._id },
                { $inc: { lastTaskId: docs.length } },
            ],
        }, 'findOneAndUpdate');

        // Only parents count towards the sprint total, the same as anywhere else in the app.
        const parents = docs.filter((d) => d.isParentTask !== false).length;
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.SPRINTS,
            data: [
                { _id: sprint._id },
                { $inc: { tasks: parents } },
            ],
        }, 'findOneAndUpdate');

        removeCache(`project:${String(project._id)}`);
        removeCache(`projectList:${companyId}`);

        return docs.length;
    } catch (error) {
        logger.error(`seedSampleTasks failed: ${error.message}`);
        return 0;
    }
}

// The demo project rides the same hook the templates do, so there is one path that seeds tasks
// rather than two.
SAMPLE_TASKS[WELCOME_PROJECT_NAME] = WELCOME_TASKS;

function sampleTasksForTemplate(templateName) {
    return SAMPLE_TASKS[String(templateName || '').trim()] || null;
}

// How the demo project is populated. Applied BY POSITION over whatever list the demo ends up
// with, not attached to particular rows — picking "Marketing" during setup swaps most of the
// rows out, and attaching the variety to specific rows meant that choice produced a flat,
// all-To-Do project with no subtasks and no comment.
//
// Statuses are names of intent, resolved against the project's own status list, so a company
// that renames or reorders its statuses still gets a sensible spread.
const DEMO_LIFE = [
    { status: 'in_progress', assign: true, dueInDays: 0, priority: 'HIGH' },
    { status: 'complete', assign: true, dueInDays: -1 },
    { assign: true, dueInDays: 1 },
    { dueInDays: 2, priority: 'URGENT' },
    { status: 'in_progress', assign: true, dueInDays: 3, comment: 'This is what a comment looks like. The conversation stays on the task, so the reasoning is still here months from now.' },
    { dueInDays: 4, priority: 'LOW' },
    { status: 'in_review', assign: true, dueInDays: 5 },
    { status: 'in_progress', assign: true, dueInDays: 7, priority: 'HIGH', subtasks: ['Write the first draft', 'Review it with someone', 'Publish the final version'] },
    { status: 'done', assign: true, dueInDays: 6 },
    { status: 'backlog', dueInDays: 12, priority: 'LOW' },
    { dueInDays: 14 },
];

// Anything past the plan still gets a date, so the calendar never has gaps.
function withDemoLife(rows) {
    return rows.map((row, i) => [row[0], row[1], DEMO_LIFE[i] || { dueInDays: 15 + i }]);
}

// What the owner said their team does, answered once during setup, mapped onto the sample content
// that suits it. Anything unrecognised — including the blank every company created before the
// question existed carries — falls back to the product walkthrough.
const FOCUS_TO_TEMPLATE = {
    software: 'Backlogs and Sprints',
    marketing: 'Quick Start: Marketing',
    design: 'Creative & Design',
    support: 'Support',
    hiring: 'Hiring Candidates',
};

const TEAM_FOCUS_OPTIONS = Object.keys(FOCUS_TO_TEMPLATE).concat('other');

// The first three welcome tasks come first whatever the answer: they explain what a task is and how
// to work one, which a first-time user needs before any domain-shaped board is useful.
function demoTasksForFocus(focus) {
    const templateName = FOCUS_TO_TEMPLATE[String(focus || '').trim().toLowerCase()];
    const rows = (!templateName || !SAMPLE_TASKS[templateName])
        ? WELCOME_TASKS
        // The first three welcome tasks come first whatever the answer: they explain what a task
        // is and how to work one, which a first-time user needs before any domain board is useful.
        : WELCOME_TASKS.slice(0, 3).concat(SAMPLE_TASKS[templateName]);
    return withDemoLife(rows);
}

module.exports = {
    SAMPLE_TASKS,
    buildTaskDocs,
    TEAM_FOCUS_OPTIONS,
    demoTasksForFocus,
    withDemoLife,
    WELCOME_TASKS,
    WELCOME_PROJECT_NAME,
    seedSampleTasks,
    sampleTasksForTemplate,
};
