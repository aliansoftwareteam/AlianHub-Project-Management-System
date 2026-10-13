jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => []) }));
jest.mock('../Modules/CustomField/controller', () => ({ insertCustomFieldPromise: jest.fn() }));

const { escapeHtml } = require('../utils/escapeHtml');
const { buildHistoryObject } = require('../Modules/Tasks/helpers/helper');
const scrumRules = require('../Modules/Sprints/scrumRules');
const aiHistory = require('../Modules/AIProjectGenerator/historyMessages');

const MARKUP = '<img src=x onerror="alert(1)">';
const ESCAPED = '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;';
const tagsIn = (html) => (html.match(/<\/?[a-z][^>]*>/gi) || []).map((tag) => tag.replace(/\s.*$/, '').replace(/>$/, ''));

describe('escapeHtml', () => {
    it('escapes the characters that start markup or end an attribute', () => {
        expect(escapeHtml(`Tom & "Jerry" <b>'s</b>`)).toBe('Tom &amp; &quot;Jerry&quot; &lt;b&gt;&#39;s&lt;/b&gt;');
    });

    it('turns empty values into empty text', () => {
        expect(escapeHtml(undefined)).toBe('');
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(7)).toBe('7');
    });
});

describe('task history builders', () => {
    it('escapes the item name in a checklist message and keeps the bold markup', () => {
        const { message } = buildHistoryObject('checklistchecked', { Employee_Name: 'Max', name: MARKUP, isChecked: true });
        expect(message).toBe(`<b>Max</b> has <b>checked</b> <b>${ESCAPED}</b> checklist.`);
    });

    it('escapes the renamed item names without encoding brackets twice', () => {
        const { message } = buildHistoryObject('checklistedit', { Employee_Name: 'Max', previousName: 'Plan (v1)', newName: MARKUP });
        expect(message).toBe(`<b>Max</b> has changed checklist item name from <b>Plan (v1)</b> to <b>${ESCAPED}</b>`);
        expect(tagsIn(message).every((tag) => ['<b', '</b'].includes(tag))).toBe(true);
    });
});

describe('sprint history builders', () => {
    it('escapes the actor and sprint names when a sprint starts', () => {
        const message = scrumRules.sprintStartedMessage({ Employee_Name: MARKUP }, { name: MARKUP }, { tasks: 3 });
        expect(message).toBe(`<b>${ESCAPED}</b> started sprint <b>${ESCAPED}</b> with <b>3</b> task(s) committed.`);
    });

    it('escapes the actor, sprint and next sprint names when a sprint completes', () => {
        const message = scrumRules.sprintCompletedMessage({ Employee_Name: MARKUP }, { name: MARKUP }, { done: { tasks: 2 }, notDone: { tasks: 1 } }, { name: MARKUP });
        expect(message).toBe(`<b>${ESCAPED}</b> completed sprint <b>${ESCAPED}</b> — <b>2</b> done, <b>1</b> moved to <b>${ESCAPED}</b>.`);
    });
});

describe('ai project history builders', () => {
    it('escapes the actor and task names in a created-task message', () => {
        const message = aiHistory.taskCreatedHistoryMessage({ Employee_Name: MARKUP }, { TaskName: MARKUP, TaskType: 'sub_task' });
        expect(message).toBe(`<b>${ESCAPED}</b> has created new <b>${ESCAPED}</b> sub-task.`);
    });

    it('escapes the actor and project names in a created-project message', () => {
        const message = aiHistory.projectCreatedHistoryMessage({ Employee_Name: MARKUP }, { ProjectName: MARKUP }, { sprints: [1], tasks: [1, 2] });
        expect(message).toBe(`<b>${ESCAPED}</b> created project <b>${ESCAPED}</b> with <b>1</b> sprints and <b>2</b> tasks via AI.`);
    });

    it('escapes the project name in the created-project notification', () => {
        expect(aiHistory.projectCreatedNoticeMessage({ ProjectName: MARKUP })).toBe(`<p>Created a new project named <strong>${ESCAPED}</strong>.</p>`);
    });
});
