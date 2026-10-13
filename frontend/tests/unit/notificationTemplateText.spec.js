import { describe, expect, it, vi } from 'vitest';

// The real composable index pulls in the whole store; only its HTML escaping matters here.
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({
        sanitizeInput: (input) => input
            ?.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/`/g, '&#96;')
            .replace(/\(/g, '&#40;').replace(/\)/g, '&#41;')
    })
}));

import * as T from '@/utils/NotificationTemplate';

const text = (html) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.textContent.replace(/\s+/g, ' ').trim();
};

const EVIL = '<img src=x onerror=alert(1)>';

describe('notification sentences', () => {
    const cases = [
        ['createProject', { projectName: 'Apollo' }, 'Created a new project named Apollo.'],
        ['EditProjectName', { previousTaskName: 'Old', TaskName: 'New' }, 'Project name is changed from Old to New .'],
        ['createSprints', { sprintName: 'S1', ProjectName: 'Apollo' }, 'Created new Sprint named S1 in Apollo project.'],
        ['EditSprint', { ProjectName: 'Apollo', previousSprint: 'S1', sprintName: 'S2' }, 'In Apollo project Sprint name is changed from S1 to S2'],
        ['createFolders', { sprintFolderName: 'F', ProjectName: 'Apollo' }, 'Created new Folder named F in Apollo project.'],
        ['editFolder', { ProjectName: 'Apollo', previousFolder: 'F1', sprintFolderName: 'F2' }, 'In Apollo project Folder name is changed from F1 to F2'],
        ['createSubSprint', { sprintName: 'S', name: 'Fold', ProjectName: 'Apollo' }, 'Created new Sprint named S in Fold folder in Apollo project.'],
        ['editSubSprint', { previousSprint: 'A', sprintName: 'B', name: 'Fold', ProjectName: 'Apollo' }, 'Change Sprint name from A to B in Fold folder in Apollo project.'],
        ['projectAssignee', { projectName: 'Apollo', Employee_Name: 'Ann' }, 'Apollo project is Assigned to Ann.'],
        ['projectAssigneeRemove', { projectName: 'Apollo', Employee_Name: 'Ann' }, 'Ann is Removed from Apollo project.'],
        ['projectLeadAdd', { userName: 'Bob', Employee_Name: 'Ann', ProjectName: 'Apollo' }, 'Bob has added Ann to Leader in Apollo project.'],
        ['projectLeadRemove', { userName: 'Bob', Employee_Name: 'Ann', ProjectName: 'Apollo' }, 'Bob has removed Ann from Leader in Apollo project.'],
        ['projectStatus', { ProjectName: 'Apollo', statusName: 'Open', newStatusName: 'Done' }, 'Status of Apollo is changed from Open to Done.'],
        ['projectCategory', { ProjectName: 'Apollo', previousCategory: 'A', categoryObj: 'B' }, 'Category of Apollo is changed from A to B.'],
        ['projectSourceAdd', { ProjectName: 'Apollo', proSource: 'Web' }, 'Project Source of Apollo is added as Web.'],
        ['projectSourceChange', { ProjectName: 'Apollo', ProjectSource: 'Web', proSource: 'Email' }, 'Project Source of Apollo is changed from Web to Email.'],
        ['projectType', { ProjectName: 'Apollo', previousType: 'Fixed', name: 'Hourly' }, 'Project Type of Apollo is changed from Fixed to Hourly.'],
        ['projectCurrency', { ProjectName: 'Apollo', ProjectCurrency: 'USD', name: 'EUR' }, 'Project Currency of Apollo is changed from USD to EUR.'],
        ['projectStartDateAdd', { ProjectName: 'Apollo', formetedStartDate: '1 Jan' }, 'Start Date of Apollo project is added as 1 Jan.'],
        ['projectStartDateChange', { ProjectName: 'Apollo', formetedStartDate: '1 Jan', newDate: '2 Jan' }, 'Start Date of Apollo project is changed from 1 Jan to 2 Jan.'],
        ['projectEndDateAdd', { ProjectName: 'Apollo', formatedDate: '1 Feb' }, 'End Date of Apollo project is added as 1 Feb.'],
        ['projectEndDateChange', { ProjectName: 'Apollo', formatedDate: '1 Feb', newDate: '2 Feb' }, 'End Date of Apollo project is changed from 1 Feb to 2 Feb.'],
        ['projectDueDateAdd', { ProjectName: 'Apollo', changedDate: '1 Mar' }, 'Due Date of Apollo project is added as 1 Mar.'],
        ['projectDueDateChange', { ProjectName: 'Apollo', previousDate: '1 Mar', changedDate: '2 Mar' }, 'Due Date of Apollo project is changed from 1 Mar to 2 Mar.'],
        ['projectAttachmentAdd', { url: 'a.pdf', ProjectName: 'Apollo' }, 'a.pdf attached on Apollo project.'],
        ['projectAttachmentChange', { removeFileName: 'a.pdf', ProjectName: 'Apollo' }, 'a.pdf removed on Apollo.'],
        ['projectCheckList', { ProjectName: 'Apollo', value: 'QA' }, 'Project Apollo Created a new Check List named QA.'],
        ['projectCheckListUserAdd', { ProjectName: 'Apollo', selectedCheckListName: 'QA', Employee_Name: 'Ann' }, 'In Apollo Project, QA Checklist is Assigned to Ann.'],
        ['projectCheckListEdit', { ProjectName: 'Apollo', previouName: 'QA', newName: 'QA2' }, 'Project Apollo Updated a Check List named from QA to QA2.'],
        ['projectCheckListRemove', { ProjectName: 'Apollo', checklist: 'Checklist', name: 'QA' }, 'Project Apollo Removed Checklist QA'],
        ['projectCheckListUserRemove', { ProjectName: 'Apollo', Employee_Name: 'Ann', selectedCheckListRemoveName: 'QA' }, 'In Apollo Project, Ann is Removed from QA Checklist.'],
        ['projectMileStone', { ProjectName: 'Apollo', milestoneName: 'M1' }, 'In Project Apollo a new Milestone named M1 is Created .'],
        ['projectMileStoneDelete', { ProjectName: 'Apollo', milestoneName: 'M1' }, 'In Project Apollo Milestone named M1 is Deleted.'],
        ['projectMarkStar', { ProjectName: 'Apollo' }, 'Apollo has been marked as star.'],
        ['projectRemoveStar', { ProjectName: 'Apollo' }, 'Apollo has been removed from marked as star.'],
        ['closeProject', { userName: 'Bob', projectName: 'Apollo' }, 'Bob has closed the Apollo Project'],
        ['createTask', { ProjectName: 'Apollo', newTaskname: 'T' }, 'In Apollo Project, created a new task named T.'],
        ['taskNameEdit', { ProjectName: 'Apollo', previousTaskName: 'A', TaskName: 'B' }, 'In Apollo Project, Task name is changed from A to B'],
        ['taskStatusChange', { ProjectName: 'Apollo', taskName: 'T', statusName: 'Open', newStatusName: 'Done' }, 'In Apollo Project, Status of T is changed from Open to Done.'],
        ['taskAssigneeAdd', { ProjectName: 'Apollo', TaskName: 'T', Employee_Name: 'Ann' }, 'In Apollo Project, T is Assigned to Ann'],
        ['taskAssigneeRemove', { ProjectName: 'Apollo', TaskName: 'T', Employee_Name: 'Ann' }, 'In Apollo Project, Ann is Removed from T Task'],
        ['taskDueDateAdd', { ProjectName: 'Apollo', TaskName: 'T', lastDate: '1 Apr' }, 'In Apollo Project, Due Date of T is added as 1 Apr.'],
        ['taskStartAndDueDateAdd', { ProjectName: 'Apollo', TaskName: 'T', lastDate: '1 Apr' }, 'In Apollo Project, Start And Due Date of T is added as 1 Apr.'],
        ['taskDueDateChange', { ProjectName: 'Apollo', TaskName: 'T', previousDate: '1 Apr', changedDate: '2 Apr' }, 'In Apollo Project, Due Date of T is changed from 1 Apr to 2 Apr.'],
        ['taskStartAndDueDateChange', { ProjectName: 'Apollo', TaskName: 'T', previousDate: '1 Apr', changedDate: '2 Apr' }, 'In Apollo Project, Start And Due Date of T is changed from 1 Apr to 2 Apr.'],
        ['taskStartDateAdd', { ProjectName: 'Apollo', TaskName: 'T', formetedStartDate: '1 May' }, 'In Apollo Project, Start Date of T is added as 1 May.'],
        ['taskStartDateChange', { ProjectName: 'Apollo', TaskName: 'T', formetedStartDate: '1 May', newDate: '2 May' }, 'In Apollo Project, Start Date of T is changed from 1 May to 2 May.'],
        ['taskEndDateAdd', { ProjectName: 'Apollo', TaskName: 'T', formatedDate: '1 Jun' }, 'In Apollo Project, End Date of T is added as 1 Jun.'],
        ['taskEndDateChange', { ProjectName: 'Apollo', TaskName: 'T', formatedDate: '1 Jun', newDate: '2 Jun' }, 'In Apollo Project, End Date of T is changed from 1 Jun to 2 Jun.'],
        ['taskAttachmentAdd', { ProjectName: 'Apollo', TaskName: 'T', url: 'a.pdf' }, 'In Apollo Project, a.pdf attached on T.'],
        ['taskAttachmentRemove', { ProjectName: 'Apollo', TaskName: 'T', removeFileName: 'a.pdf' }, 'In Apollo Project, a.pdf removed on T.'],
        ['taskCheckList', { ProjectName: 'Apollo', TaskName: 'T', value: 'QA' }, 'In Apollo Project, T Created a new Check List named QA.'],
        ['taskCheckListAssignee', { ProjectName: 'Apollo', TaskName: 'T', selectedChecklist: 'QA', Employee_Name: 'Ann' }, 'In Apollo Project, T of QA Checklist is Assigned to Ann.'],
        ['taskCheckListAssigneeRemove', { ProjectName: 'Apollo', TaskName: 'T', selectedChecklistRemove: 'QA', Employee_Name: 'Ann' }, 'In Apollo Project, T of QA Checklist is Removed Ann .'],
        ['taskCheckListEdit', { ProjectName: 'Apollo', TaskName: 'T', previouName: 'QA', newName: 'QA2' }, 'Project Apollo Updated a Check List named from QA to QA2 in T.'],
        ['taskCheckListRemove', { ProjectName: 'Apollo', TaskName: 'T', checklist: 'Checklist', name: 'QA' }, 'Project Apollo Removed a Checklist QA from T.'],
        ['createSubTask', { ProjectName: 'Apollo', newSubTaskName: 'Sub' }, 'In Apollo Project, created a new sub task named Sub.'],
        ['loggedHours', { userName: 'Bob', timeDuration: '2', logTimeDate: '1 Jul', TaskName: 'T', ProjectName: 'Apollo' }, 'Bob Added 2 hrs(1 Jul) logged hours in T task for this Apollo project.'],
        ['loggedHoursUpdated', { userName: 'Bob', previousLoggedTime: '1', timeDuration: '2', logTimeDate: '1 Jul', TaskName: 'T', ProjectName: 'Apollo' }, 'Bob Updated logged hours from 1 hrs to 2 hrs (1 Jul) in T task for this Apollo project.'],
        ['estimatedTimeAdded', { loggedUserName: 'Bob', updateEstimatedTime: '5', timeDateData: '1 Jul', TaskName: 'T', ProjectName: 'Apollo' }, 'Bob Added 5 hrs (1 Jul) Estimated hours in T task for this Apollo project.'],
        ['estimatedTimeUpdated', { loggedUserName: 'Bob', estimatedTime: '3', updateEstimatedTime: '5', timeDateData: '1 Jul', TaskName: 'T', ProjectName: 'Apollo' }, 'Bob Updated Estimated hours from 3 hrs to 5 hrs (1 Jul) in T task for this Apollo project.'],
        ['estimatedTimeAssignUpdated', { userName: 'Lead', estimatedTime: '3', updateEstimatedTime: '5', timeDateData: '1 Jul', loggedUserName: 'Bob', TaskName: 'T', ProjectName: 'Apollo' }, 'Lead Updated Estimated hours from 3 hrs to 5 hrs (1 Jul) for Bob in T task for this Apollo project.'],
        ['estimatedTimeAssignAdded', { userName: 'Lead', updateEstimatedTime: '5', timeDateData: '1 Jul', loggedUserName: 'Bob', TaskName: 'T', ProjectName: 'Apollo' }, 'Lead Added 5 hrs (1 Jul) Estimated hours for Bob in T task for this Apollo project.']
    ];

    it.each(cases)('%s reads as a sentence', (name, input, sentence) => {
        expect(text(T[name](input))).toBe(sentence);
    });

    it('covers every exported text template', () => {
        const covered = new Set(cases.map(([n]) => n));
        const special = ['projectMileStoneStatusChange', 'projectMileStoneStatusAdd', 'projectMileStoneStatusAddForHourly', 'newProjectMileStoneStatusAdd', 'projectMileStoneStatusChangeForHourly', 'projectDescriptionAdd', 'projectDescriptionChange', 'taskDescriptionAdd', 'taskDescriptionChange', 'taskPriorityChange', 'taskCheckListChecked'];
        const missing = Object.keys(T).filter((k) => !covered.has(k) && !special.includes(k));
        expect(missing).toEqual([]);
    });
});

describe('project and task names are escaped', () => {
    it.each([
        ['createSprints', { sprintName: 'S', ProjectName: EVIL }],
        ['projectLeadAdd', { userName: 'B', Employee_Name: 'A', ProjectName: EVIL }],
        ['projectStatus', { ProjectName: EVIL, statusName: 'a', newStatusName: 'b' }],
        ['createTask', { ProjectName: 'P', newTaskname: EVIL }],
        ['taskNameEdit', { ProjectName: 'P', previousTaskName: EVIL, TaskName: EVIL }],
        ['loggedHours', { userName: 'B', timeDuration: 1, logTimeDate: 'd', TaskName: EVIL, ProjectName: 'P' }],
        ['taskAssigneeAdd', { ProjectName: EVIL, TaskName: EVIL, Employee_Name: 'A' }]
    ])('%s shows the markup as plain text', (name, input) => {
        const html = T[name](input);
        const host = document.createElement('div');
        host.innerHTML = html;
        expect(host.querySelector('img')).toBeNull();
        expect(host.textContent).toContain(EVIL);
    });

    it('does not print "undefined" when a name is missing', () => {
        expect(text(T.projectMarkStar({}))).toBe('has been marked as star.');
        expect(text(T.createTask({ newTaskname: 'T' }))).toBe('In Project, created a new task named T.');
    });

    it('escapes quotes, ampersands and parentheses in names', () => {
        expect(T.projectMarkStar({ ProjectName: `R&D "x" (y)` })).toContain('R&amp;D &quot;x&quot; &#40;y&#41;');
    });

    it('escapes the new project name when renaming', () => {
        expect(T.EditProjectName({ previousTaskName: 'a', TaskName: EVIL })).not.toContain('<img');
    });
});

describe('description previews', () => {
    const long = 'abcdefghijklmnopqrstuvwxyz';
    it('shows short descriptions in full', () => {
        expect(text(T.projectDescriptionAdd({ ProjectName: 'P', textSimple: 'a'.repeat(20) }))).toBe(`Project Description of P is added as "${'a'.repeat(20)}".`);
    });
    it('cuts long descriptions to 20 characters with an ellipsis', () => {
        expect(text(T.projectDescriptionAdd({ ProjectName: 'P', textSimple: long }))).toBe('Project Description of P is added as "abcdefghijklmnopqrst...".');
        expect(text(T.taskDescriptionAdd({ ProjectName: 'P', TaskName: 'T', textSimple: long }))).toContain('"abcdefghijklmnopqrst..."');
    });
    it('cuts both the old and new description on change', () => {
        const out = text(T.projectDescriptionChange({ ProjectName: 'P', previousDiscriptionText: long, textSimple: 'short' }));
        expect(out).toBe('Project Description of P is changed from "abcdefghijklmnopqrst..." to "short".');
        expect(text(T.taskDescriptionChange({ ProjectName: 'P', TaskName: 'T', previousDiscriptionText: 'old', textSimple: long })))
            .toBe('In P Project, Description of T is changed from "old" to "abcdefghijklmnopqrst...".');
    });
    it('fails loudly when the description text is missing', () => {
        expect(() => T.projectDescriptionAdd({ ProjectName: 'P' })).toThrow();
    });
});

describe('colours and images', () => {
    it('paints status badges with the given colours', () => {
        const host = document.createElement('div');
        host.innerHTML = T.projectStatus({ ProjectName: 'P', statusName: 'Open', backColor: '#111111', color: '#222222', newStatusName: 'Done', bgColor: '#333333', textColor: '#444444' });
        const [from, to] = host.querySelectorAll('span');
        expect(from.style.backgroundColor).toBe('rgb(17, 17, 17)');
        expect(from.style.color).toBe('rgb(34, 34, 34)');
        expect(to.style.backgroundColor).toBe('rgb(51, 51, 51)');
        expect(to.style.color).toBe('rgb(68, 68, 68)');
    });

    it('shows both priority icons and names', () => {
        const host = document.createElement('div');
        host.innerHTML = T.taskPriorityChange({ ProjectName: 'P', taskName: 'T', statusImage: '/a.png', priorityName: 'Low', newStatusImage: '/b.png', newPriorityName: 'High' });
        expect([...host.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(['/a.png', '/b.png']);
        expect(text(host.innerHTML)).toBe('In P project, Priority of T is changed from Low to High');
    });

    it('checked / unchecked checklist wording', () => {
        expect(text(T.taskCheckListChecked({ Employee_Name: 'Ann', isChecked: true, name: 'QA' }))).toBe('Ann has checked QA checklist.');
        expect(text(T.taskCheckListChecked({ Employee_Name: 'Ann', isChecked: false, name: 'QA' }))).toBe('Ann has unchecked QA checklist.');
    });
});

describe('milestone status sentences', () => {
    const base = {
        ProjectName: 'Apollo', editMilestoneName: 'M1', editIndex: 0, editStatus: 'Open', status: 'Done',
        milestoneArray: [{ milestoneName: 'M1' }], backgroundColor: '#010101', textColor: '#020202',
        changebackgroundColor: '#030303', changetextColor: '#040404'
    };

    it('reads the status change', () => {
        expect(text(T.projectMileStoneStatusChange(base))).toBe('Status of M1 Milestone is changed from Open to Done for Apollo project.');
    });
    it('uses the milestone name from the list when it was renamed', () => {
        const renamed = { ...base, editMilestoneName: 'Draft', milestoneArray: [{ milestoneName: 'Final' }] };
        expect(text(T.projectMileStoneStatusChange(renamed))).toContain('Status of Final Milestone');
        expect(text(T.projectMileStoneStatusAdd(renamed))).toContain('Status of Final Milestone');
    });
    it('reads status add and the hourly variants', () => {
        expect(text(T.projectMileStoneStatusAdd(base))).toBe('Status of M1 Milestone is added Done for Apollo project.');
        expect(text(T.projectMileStoneStatusAddForHourly(base))).toBe('Status of M1 Milestone is added Done for Apollo project.');
        expect(text(T.projectMileStoneStatusChangeForHourly(base))).toBe('Status of M1 Milestone is changed from Open to Done for Apollo project.');
        expect(text(T.newProjectMileStoneStatusAdd(base))).toContain('In project Apollo Done status is Added in M1 milestone.');
    });
    it('applies status colours and leaves them blank when absent', () => {
        const host = document.createElement('div');
        host.innerHTML = T.projectMileStoneStatusChange(base);
        const [from, to] = host.querySelectorAll('span');
        expect(from.style.backgroundColor).toBe('rgb(1, 1, 1)');
        expect(to.style.color).toBe('rgb(4, 4, 4)');
        host.innerHTML = T.projectMileStoneStatusChange({ ...base, backgroundColor: undefined, changetextColor: null });
        const [f2, t2] = host.querySelectorAll('span');
        expect(f2.style.backgroundColor).toBe('');
        expect(t2.style.color).toBe('');
    });
    it('throws when the edited milestone is not in the list', () => {
        expect(() => T.projectMileStoneStatusChange({ ...base, editIndex: 5 })).toThrow();
    });
});
