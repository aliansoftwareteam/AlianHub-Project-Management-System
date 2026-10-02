jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const T = require('../Modules/Tasks/helpers/notificationTemplate');

const ATTACK = '<img src=x onerror=alert(1)>';
const SAFE_ATTACK = '&lt;img src=x onerror=alert&#40;1&#41;&gt;';

describe('shownDate', () => {
    const noon = Date.UTC(2026, 2, 7, 12, 0);

    it('formats day/month/year in UTC by default', () => {
        expect(T.shownDate(noon)).toBe('07/03/2026');
    });

    it('uses the format the web app uses', () => {
        expect(T.shownDate(noon, 'YYYY-MM-DD')).toBe('2026-03-07');
        expect(T.shownDate(noon, 'MMM D, YYYY')).toBe('Mar 7, 2026');
        expect(T.shownDate(noon, 'MMMM DD YYYY')).toBe('March 07 2026');
    });

    it('moves the day with the time zone', () => {
        const lateEvening = Date.UTC(2026, 2, 7, 23, 30);
        expect(T.shownDate(lateEvening, 'DD/MM/YYYY', 'UTC')).toBe('07/03/2026');
        expect(T.shownDate(lateEvening, 'DD/MM/YYYY', 'Asia/Kolkata')).toBe('08/03/2026');
        expect(T.shownDate(lateEvening, 'DD/MM/YYYY', 'America/Los_Angeles')).toBe('07/03/2026');
    });

    it('falls back to UTC for a time zone it does not know', () => {
        expect(T.shownDate(Date.UTC(2026, 2, 7, 23, 30), 'DD/MM/YYYY', 'Mars/Olympus')).toBe('07/03/2026');
        expect(T.shownDate(Date.UTC(2026, 2, 7, 23, 30), 'DD/MM/YYYY', 42)).toBe('07/03/2026');
    });

    it('falls back to the default format for anything but date tokens and separators', () => {
        expect(T.shownDate(noon, "DD 'secret' YYYY")).toBe('07/03/2026');
        expect(T.shownDate(noon, 'HH:mm')).toBe('07/03/2026');
        expect(T.shownDate(noon, 42)).toBe('07/03/2026');
        expect(T.shownDate(noon, '')).toBe('07/03/2026');
    });

    it('returns an empty string when there is no usable date', () => {
        expect(T.shownDate(undefined)).toBe('');
        expect(T.shownDate('abc')).toBe('');
        expect(T.shownDate(NaN)).toBe('');
    });

    it('reads a date given as numeric text', () => {
        expect(T.shownDate(String(noon), 'YYYY')).toBe('2026');
    });
});

describe('names are escaped before they reach the message', () => {
    it('escapes a project name everywhere it is shown', () => {
        expect(T.createProject({ projectName: ATTACK })).toContain(SAFE_ATTACK);
        expect(T.createProject({ projectName: ATTACK })).not.toContain('<img');
        expect(T.projectMarkStar({ ProjectName: ATTACK })).not.toContain('<img');
        expect(T.projectStatus({ ProjectName: ATTACK, previousStatus: 'a', status: 'b' })).not.toContain('<img');
    });

    it('escapes task names in task messages', () => {
        expect(T.createTask({ ProjectName: 'P', newTaskname: ATTACK })).toContain(SAFE_ATTACK);
        expect(T.taskNameEdit({ ProjectName: 'P', previousTaskName: ATTACK, TaskName: ATTACK })).not.toContain('<img');
        expect(T.taskAssigneeAdd({ ProjectName: 'P', TaskName: ATTACK, Employee_Name: 'Ana' })).not.toContain('<img');
        expect(T.taskAttachmentAdd({ ProjectName: 'P', TaskName: 'T', url: ATTACK })).not.toContain('<img');
    });

    it('escapes quotes and ampersands too', () => {
        expect(T.createProject({ projectName: 'Q&A "Team"' })).toContain('Q&amp;A &quot;Team&quot;');
    });

    it('treats a missing name as blank rather than printing undefined', () => {
        expect(T.createProject({})).toBe('<p>Created a new project named <strong></strong>.</p>');
        expect(T.createProject({ projectName: null })).not.toContain('null');
    });

    it('shows the parts a builder already escaped as they are', () => {
        const out = T.taskTotalEstimate({ TaskName: 'T', UserName: '<b>Ana</b>', message: '2h' });
        expect(out).toContain('<b>Ana</b> added 2h');
    });

    it('escapes the sprint name when a sprint is created', () => {
        expect(T.createSprint({ sprintName: ATTACK, ProjectName: 'P' })).not.toContain('<img');
    });

    it('escapes both sprint names when a sprint is renamed', () => {
        expect(T.EditSprint({ ProjectName: 'P', previousSprint: ATTACK, sprintName: ATTACK })).not.toContain('<img');
    });

    it('escapes the folder name when a folder is created', () => {
        expect(T.createFolder({ sprintFolderName: ATTACK, ProjectName: 'P' })).not.toContain('<img');
    });

    it('escapes the sub task name when one is created', () => {
        expect(T.createSubTask({ ProjectName: 'P', newSubTaskName: ATTACK })).not.toContain('<img');
    });

    it('escapes the task name in a description message', () => {
        expect(T.taskDescriptionAdd({ ProjectName: 'P', TaskName: ATTACK, textSimple: 'x' })).not.toContain('<img');
    });

    it('escapes the milestone name when one is created', () => {
        expect(T.projectMileStone({ ProjectName: 'P', milestoneName: ATTACK })).not.toContain('<img');
    });
});

describe('shown* builders', () => {
    it('escapes every part of a status change and names the new status', () => {
        const out = T.shownStatus(
            { backColor: '#fff', color: '"><x>', statusName: ATTACK, bgColor: 'b', textColor: 't', updatedTaskName: ATTACK },
            { status: { text: 'Done' } },
        );
        expect(out.template.statusName).toBe(SAFE_ATTACK);
        expect(out.template.color).toBe('&quot;&gt;&lt;x&gt;');
        expect(out.template.newStatusName).toBe('Done');
        expect(out.updatedTaskName).toBe(SAFE_ATTACK);
    });

    it('does not fail on empty input', () => {
        const out = T.shownStatus();
        expect(out.template.statusName).toBe('');
        expect(out.template.newStatusName).toBe('');
        expect(T.shownPriority().template.priorityName).toBe('');
        expect(T.shownTaskType().newTaskTypeName).toBe('');
    });

    it('escapes priority and task type fields', () => {
        const priority = T.shownPriority({ statusImage: ATTACK, priorityName: 'Low', newStatusImage: 'i', newPriorityName: ATTACK });
        expect(priority.template.statusImage).toBe(SAFE_ATTACK);
        expect(priority.newPriorityName).toBe(SAFE_ATTACK);
        const type = T.shownTaskType({ taskImage: 'a', name: ATTACK }, { taskTypeImage: 'b', taskTypeName: ATTACK });
        expect(type.template.oldTaskTypeName).toBe(SAFE_ATTACK);
        expect(type.newTaskTypeName).toBe(SAFE_ATTACK);
    });
});

describe('message wording', () => {
    it('cuts a description to 20 characters with dots, and keeps a short one whole', () => {
        const long = T.projectDescriptionAdd({ ProjectName: 'P', textSimple: 'abcdefghijklmnopqrstuvwxyz' });
        expect(long).toContain('"abcdefghijklmnopqrst..."');
        const edge = T.projectDescriptionAdd({ ProjectName: 'P', textSimple: 'abcdefghijklmnopqrst' });
        expect(edge).toContain('"abcdefghijklmnopqrst"');
        expect(edge).not.toContain('...');
    });

    it('says "is" for one assignee and "are" for several', () => {
        expect(T.taskAssigneeReplace({ ProjectName: 'P', TaskName: 'T', Employee_Name: 'Ana' })).toContain('Ana</strong> is Assigned');
        expect(T.taskAssigneeReplace({ ProjectName: 'P', TaskName: 'T', Employee_Name: 'Ana, Bo' })).toContain('Ana, Bo</strong> are Assigned');
    });

    it('says checked or unchecked for a checklist item', () => {
        expect(T.taskCheckListChecked({ Employee_Name: 'Ana', isChecked: true, name: 'Todo' })).toContain('<strong>checked</strong>');
        expect(T.taskCheckListChecked({ Employee_Name: 'Ana', isChecked: false, name: 'Todo' })).toContain('<strong>unchecked</strong>');
    });

    it('shows a date added or changed for start and due dates together', () => {
        const added = T.taskStartAndDueDateChange({ ProjectName: 'P', TaskName: 'T', startDate: '1 Jan', dueDate: '9 Jan' });
        expect(added).toContain('is added as');
        expect(added).not.toContain('is changed from');
        const changed = T.taskStartAndDueDateChange({ ProjectName: 'P', TaskName: 'T', previousStartDate: '1 Jan', startDate: '2 Jan', previousDueDate: '9 Jan', dueDate: '10 Jan' });
        expect(changed).toContain('is changed from');
        expect(changed.match(/is changed from/g)).toHaveLength(2);
        expect(changed).toContain('10 Jan');
    });

    it('mixes added and changed when only one of the dates had a previous value', () => {
        const out = T.taskStartAndDueDateChange({ ProjectName: 'P', TaskName: 'T', startDate: '2 Jan', previousDueDate: '9 Jan', dueDate: '10 Jan' });
        expect(out).toContain('Start Date of <strong>T</strong> is added as');
        expect(out).toContain('Due Date is changed from');
    });

    it('names the milestone from the list when it was renamed during a status change', () => {
        const out = T.projectMileStoneStatusChange({
            editMilestoneName: 'New name',
            milestoneArray: [{ milestoneName: 'Old name' }],
            editIndex: 0,
            editStatus: 'Open',
            status: 'Done',
        });
        expect(out).toContain('<strong>Old name</strong>');
    });
});
