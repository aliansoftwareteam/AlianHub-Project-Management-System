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
    ['Start here — this project is a sandbox', 'Everything in it is example content. Nothing here affects your real work, and you can delete the whole project in one go from the project menu when you are done.'],
    ['Open a task to see what it holds', 'Click any task in this list. A task has a description, an owner, a status, a priority, dates, attachments, comments and a history of what changed.'],
    ['Give a task an owner', 'Use the assignee field. A person only sees work in My Work once it is assigned to them.'],
    ['Set a priority', 'Priority is how you say what matters when everything is urgent. It is one of the fields you can group and filter the board by.'],
    ['Leave a comment', 'Comments belong on the task rather than in chat, so the reasoning is still there in six months. Type @ to pull someone in.'],
    ['Attach a file', 'Drop a file onto a task. It stays with the work instead of in somebody\'s inbox.'],
    ['Track how long something takes', 'Start the timer on a task, or log time against it afterwards. Timesheets are built from this and need no extra bookkeeping.'],
    ['Break a big task into subtasks', 'Any task can hold subtasks. Use them when one task is really several, and the parent keeps the overall picture.'],
    ['Try a different view', 'The tabs above this list switch between List, Board, Calendar, Table and more. They are the same tasks arranged differently — changing view changes nothing about the data.'],
    ['Invite someone', 'Open Settings, then Members, and send an invitation. New teammates arrive as Members, which lets them work on tasks without being able to change your company settings.'],
    ['Delete this project when you are finished', 'Open the project menu and delete it. Nothing else in your company is affected.'],
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

function buildTaskDocs(project, sprint, rows, startingNumber, ownerId) {
    const projectId = String(project._id);
    const companyId = String(project.CompanyId);
    const code = project.ProjectCode || 'TASK';
    const firstType = (project.taskTypeCounts && project.taskTypeCounts[0]) || null;

    return rows.map((row, i) => {
        const [TaskName, text] = row;
        return {
            ...TASK_DEFAULTS,
            TaskName,
            // The editor reads descriptionBlock; plain `description` is the text mirror alongside it.
            // Writing only one of the two leaves the task looking empty in one place or the other.
            description: text,
            descriptionBlock: {
                time: Date.now(),
                blocks: [{ id: 'manual-entry', type: 'paragraph', data: { text } }],
                version: '2.30.7',
            },
            TaskKey: `${code}-${startingNumber + i + 1}`,
            ProjectID: projectId,
            CompanyId: companyId,
            sprintId: String(sprint._id),
            // Real tasks carry the whole sprint document here, not an array, and Task_Leader is a
            // user id string. status is an object too — every existing task in the wild has all
            // three in exactly this shape.
            sprintArray: sprint,
            Task_Leader: ownerId,
            status: { text: 'To Do', key: 1, type: 'default_active' },
            TaskType: (firstType && firstType.name) || 'Task',
            TaskTypeKey: (firstType && firstType.key) !== undefined ? firstType.key : 1,
            groupByStatusIndex: i,
        };
    });
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
        const docs = buildTaskDocs(project, sprint, rows, startingNumber, leader);

        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [docs],
        }, 'insertMany');

        // TaskKey numbering comes off lastTaskId, so it has to move or the next real task collides.
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [
                { _id: project._id },
                { $inc: { lastTaskId: docs.length } },
            ],
        }, 'findOneAndUpdate');

        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.SPRINTS,
            data: [
                { _id: sprint._id },
                { $inc: { tasks: docs.length } },
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
    if (!templateName || !SAMPLE_TASKS[templateName]) return WELCOME_TASKS;
    return WELCOME_TASKS.slice(0, 3).concat(SAMPLE_TASKS[templateName]);
}

module.exports = {
    SAMPLE_TASKS,
    buildTaskDocs,
    TEAM_FOCUS_OPTIONS,
    demoTasksForFocus,
    WELCOME_TASKS,
    WELCOME_PROJECT_NAME,
    seedSampleTasks,
    sampleTasksForTemplate,
};
