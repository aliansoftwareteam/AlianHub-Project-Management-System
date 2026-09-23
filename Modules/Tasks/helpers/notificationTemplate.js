const { sanitizeInput } = require("../../serviceFunction");
const { DateTime } = require('luxon');

const escapeText = (value) => sanitizeInput(String(value === undefined || value === null ? '' : value));

/* For values a builder has already escaped, such as the actor's name or the shown* results. */
const shown = (value) => (value === undefined || value === null ? '' : value);

const DEFAULT_DATE_FORMAT = 'DD/MM/YYYY';
const DATE_FORMAT = /^(?:YYYY|YY|MMMM|MMM|MM|M|DD|D|[-/., ])+$/;
const DATE_TOKEN = /YYYY|YY|MMMM|MMM|MM|M|DD|D/g;
const LUXON_TOKEN = { YYYY: 'yyyy', YY: 'yy', MMMM: 'MMMM', MMM: 'MMM', MM: 'MM', M: 'M', DD: 'dd', D: 'd' };

/* The web app's moment formats are mapped to luxon tokens; anything beyond those tokens and separators falls back to the default, so a format cannot carry quoted text into the message. */
const luxonFormatOf = (format) => (typeof format === 'string' && DATE_FORMAT.test(format) ? format : DEFAULT_DATE_FORMAT).replace(DATE_TOKEN, (token) => LUXON_TOKEN[token]);

const zoneOf = (zone) => (typeof zone === 'string' && zone && DateTime.local().setZone(zone).isValid ? zone : 'UTC');

exports.shownDate = (millis, format, zone) => {
    const date = DateTime.fromMillis(Number(millis), { zone: zoneOf(zone) });
    return date.isValid ? date.setLocale('en').toFormat(luxonFormatOf(format)) : '';
};


// For Create Project //
exports.createProject = (obj) => {
    return `<p>Created a new project named <strong>${escapeText(obj.projectName)}</strong>.</p>`;
}

exports.EditProjectName = (ProjectNameobj) => {
    return `<p>Project name is chnaged from <strong> ${escapeText(ProjectNameobj.ProjectName)}</strong> to <strong> ${escapeText(ProjectNameobj.editProjectValue)} </strong>.</p>`;
}

// For Create Sprint //
exports.createSprint = (sprintObj) => {
    return `<p>Created new <strong>Sprint</strong> named <strong>${sprintObj.sprintName}</strong> in <strong>${escapeText(sprintObj.ProjectName)}</strong> project.</p>`;
}

exports.EditSprint = (sprintObj) => {
    return `<p>In <strong>${escapeText(sprintObj.ProjectName)}</strong> project <strong>Sprint</strong> name is changed from <strong> ${sprintObj.previousSprint} </strong> to <strong> ${sprintObj.sprintName} </strong> </p>`;
}

// For Create Folder //
exports.createFolder = (obj) => {
    return `<p>Created new <strong>Folder</strong> named <strong>${obj.sprintFolderName}</strong> in <strong>${escapeText(obj.ProjectName)}</strong> project.</p>`;
}

exports.editFolder = (obj) => {
    return `<p>In <strong>${escapeText(obj.ProjectName)}</strong> project <strong>Folder</strong> name is changed from <strong> ${obj.previousFolder} </strong> to <strong> ${obj.sprintFolderName} </strong></p>`;
}

// For Create Sub Sprint //
exports.createSubSprint = (subSprintObj) => {
    return `<p>Created new <strong>Sprint</strong> named <strong>${subSprintObj.sprintName}</strong> in <strong>${subSprintObj.name}</strong> folder in <strong>${escapeText(subSprintObj.ProjectName)}</strong> project.</p>`;
}

exports.editSubSprint = (subSprintObj) => {
    return `<p>Change <strong>Sprint</strong> name from  <strong>${subSprintObj.previousSprint}</strong> to <strong> ${subSprintObj.sprintName}  </strong> in <strong>${subSprintObj.name}</strong> folder in <strong>${escapeText(subSprintObj.ProjectName)}</strong> project. </p>`;
}

// For Project Assignee Add //
exports.projectAssignee = (obj) => {
    return `<p><strong>${obj.projectName}</strong> is Assigned to <strong>${obj.Employee_Name}</strong>.</p>`;
}

// For Project Assignee Remove //
exports.projectAssigneeRemove = (obj) => {
    return `<p><strong>${obj.Employee_Name}</strong> is Removed from <strong>${obj.projectName}</strong>.</p>`;
}

// For Project Lead Add //
exports.projectLeadAdd = (obj) => {
    return `<p><strong>${obj.userName}</strong> has added <strong>${obj.Employee_Name}</strong> to <strong>Leader</strong> in <strong>${escapeText(obj.ProjectName)}</strong> project.</p>`;
}

// For Project Lead Remove //
exports.projectLeadRemove = (obj) => {
    return `<p><strong>${obj.userName}</strong> has removed <strong>${obj.Employee_Name}</strong> from <strong>Leader</strong> in <strong>${escapeText(obj.ProjectName)}</strong> project.</p>`;
}

//For Project Status Change //
exports.projectStatus = (Statusobj) => {
    return `<p>Status of <strong>${escapeText(Statusobj.ProjectName)}</strong> is changed from <span style="background-color:${Statusobj.backColor}; color:${Statusobj.color};padding-right: 5px;padding-left: 5px;border-radius: 5px;font-weight: 500;">${Statusobj.Statusname}</span> to <span style="font-weight: 500;background-color:${Statusobj.backgroundColor}; color:${Statusobj.textColor};padding-right: 5px;padding-left: 5px;border-radius: 5px;">${Statusobj.name}</span>.</p>`;
}

//For Project Category Change //
exports.projectCategory = (catObj) => {
    return `<p>Category of <strong>${escapeText(catObj.ProjectName)}</strong> is changed from <strong>${catObj.previousCategory}</strong> to <strong>${catObj.categoryObj}</strong>.</p>`;
}

// For Project Source Add //
exports.projectSourceAdd = (obj) => {
    return `<p>Project Source of <strong>${escapeText(obj.ProjectName)}</strong> is added as <strong>${obj.proSource}</strong>.</p>`;
}

// For Project Source Change //
exports.projectSourceChange = (obj) => {
    return `<p>Project Source of <strong>${escapeText(obj.ProjectName)}</strong> is changed from <strong>${obj.ProjectSource}</strong> to <strong>${obj.proSource}</strong>.</p>`;
}

// For Project Type Change //
exports.projectType = (obj) => {
    return `<p>Project Type of <strong>${escapeText(obj.ProjectName)}</strong> is changed from <strong>${obj.previousType}</strong> to <strong>${obj.name}</strong>.</p>`;
}

//For Project Currency Change //
exports.projectCurrency = (obj) => {
    return `<p>Project Currency of <strong>${escapeText(obj.ProjectName)}</strong> is changed from <strong>${obj.ProjectCurrency}</strong> to <strong>${obj.name}</strong>.</p>`;
}

//  For Project Start Date Add //
exports.projectStartDateAdd = (obj) => {
    return `<p>Start Date of <strong>${escapeText(obj.ProjectName)}</strong> is added as <strong><span style="background-color: rgb(236 238 255);color: #2F3990;border-radius: 5px;padding-right: 5px;padding-left: 5px;">${obj.formetedStartDate}</span></strong>.</p>`;
}

// For Project Start Date Change //
exports.projectStartDateChange = (obj) => {
    return `<p>Start Date of <strong>${escapeText(obj.ProjectName)}</strong> is changed from <strong><span style="background-color: rgb(236 238 255);color: #2F3990;border-radius: 5px;padding-right: 5px;padding-left: 5px;">${obj.formetedStartDate}</span></strong> to <strong><span style="background-color: rgb(236 238 255);color: #2F3990;border-radius: 5px;padding-right: 5px;padding-left: 5px;">${obj.newDate}</span></strong>.</p>`;
}

// For Project End Date Add //
exports.projectEndDateAdd = (obj) => {
    return `<p>End Date of <strong>${escapeText(obj.ProjectName)}</strong> is added as <strong><span style="background-color: rgb(236 238 255);color: #2F3990;border-radius: 5px;padding-right: 5px;padding-left: 5px;">${obj.formatedDate}</span></strong>.</p>`;
}

// For Project End Date Change //
exports.projectEndDateChange = (obj) => {
    return `<p>End Date of <strong>${escapeText(obj.ProjectName)}</strong> is changed from <strong><span style="background-color: rgb(236 238 255);color: #2F3990;border-radius: 5px;padding-right: 5px;padding-left: 5px;">${obj.formatedDate}</span></strong> to <strong><span style="background-color: rgb(236 238 255);color: #2F3990;border-radius: 5px;padding-right: 5px;padding-left: 5px;">${obj.newDate}</span></strong>.</p>`;
}

// For Project Due Date Add //
exports.projectDueDateAdd = (obj) => {
    return `<p>Due Date of <strong>${escapeText(obj.ProjectName)}</strong> is added as <strong><span style="background-color: rgb(236 238 255);color: #2F3990;border-radius: 5px;padding-right: 5px;padding-left: 5px;">${obj.changedDate}</span></strong>.</p>`;
}

// For Project Due Date Change //
exports.projectDueDateChange = (obj) => {
    return `<p>Due Date of <strong>${escapeText(obj.ProjectName)}</strong> is changed from <strong><span style="background-color: rgb(236 238 255);color: #2F3990;border-radius: 5px;padding-right: 5px;padding-left: 5px;">${obj.previousDate}</span></strong> to <strong><span style="background-color: rgb(236 238 255);color: #2F3990;border-radius: 5px;padding-right: 5px;padding-left: 5px;">${obj.changedDate}</span></strong>.</p>`;
}

// For Project Description Add //
exports.projectDescriptionAdd = (Descobj) => {
    return `<p>Project Description of <strong>${escapeText(Descobj.ProjectName)}</strong> is added as <strong>"${Descobj.textSimple.length > 20 ? Descobj.textSimple.slice(0, 20) + '...' : Descobj.textSimple}"</strong>.</p>`;
}

// For Project Description Change //
exports.projectDescriptionChange = (Descobj) => {
    return `<p>Project Description of <strong>${escapeText(Descobj.ProjectName)}</strong> is changed from <strong>"${Descobj.previousDiscriptionText.length > 20 ? Descobj.previousDiscriptionText.slice(0, 20) + '...' : Descobj.previousDiscriptionText}"</strong> to <strong>"${Descobj.textSimple.length > 20 ? Descobj.textSimple.slice(0, 20) + '...' : Descobj.textSimple}"</strong>.</p>`;
}

// For Project Attachmnets Add //
exports.projectAttachmentAdd = (attachObj) => {
    return `<p><strong>${attachObj.url}</strong> attached on <strong>${escapeText(attachObj.ProjectName)}</strong>.</p>`;
}

// For Project Attachmnets Remove //
exports.projectAttachmentChange = (attachObj) => {
    return `<p><strong>${attachObj.removeFileName}</strong> removed on <strong>${escapeText(attachObj.ProjectName)}</strong>.</p>`;
}

// For Project Checklist //
exports.projectCheckList = (checkObj) => {
    return `<p>Project <strong>${escapeText(checkObj.ProjectName)}</strong> Created a new Check List named <strong>${checkObj.value}</strong>.</p>`;
}

// For Project Checklist Assignee Add //
exports.projectCheckListUserAdd = (checkObj) => {
    return `<p>In ${escapeText(checkObj.ProjectName)} Project, <strong>${checkObj.selectedCheckListName}</strong> Checklist is Assigned to <strong>${checkObj.Employee_Name}</strong>.</p>`;
}
 //For Project Checklist Edit
exports.projectCheckListEdit = (checkObj) => {
    return `<p>Project <strong>${escapeText(checkObj.ProjectName)}</strong> Updated a  Check List named  from <strong> ${checkObj.previouName}</strong> to  <strong>${checkObj.newName}</strong>.</p>`;
}
exports.projectCheckListRemove = (checkObj) => {
    return `<p>Project <strong>${escapeText(checkObj.ProjectName)}</strong> Removed  ${checkObj.checklist} <strong> ${checkObj.name}</strong></p>`;
}
// For Project Checklist Assignee Remove //
exports.projectCheckListUserRemove = (checkObj) => {
    return `<p>In ${escapeText(checkObj.ProjectName)} Project, <strong>${checkObj.Employee_Name}</strong> is Removed from <strong>${checkObj.selectedCheckListRemoveName}</strong> Checklist.</p>`;
}

// For Project MileStone //
exports.projectMileStone = (obj) => {
    return `<p>In Project <strong>${escapeText(obj.ProjectName)}</strong> a new Milestone named <strong>${obj.milestoneName}</strong> is Created .</p>`;
}

// For projectMileStoneDelete  //
exports.projectMileStoneDelete = (obj) => {
    return `<p>In Project <strong>${escapeText(obj.ProjectName)}</strong> Milestone named <strong>${obj.milestoneName}</strong> is Deleted.</p>`;
}

// For Project MileStone Status Change //
exports.projectMileStoneStatusChange = (milestoneobj) => {
    return `<p>Status of <strong>${(milestoneobj.editMilestoneName !== milestoneobj.milestoneArray[milestoneobj.editIndex].milestoneName) ? milestoneobj.milestoneArray[milestoneobj.editIndex].milestoneName : milestoneobj.editMilestoneName}</strong> Milestone is changed from <strong><span style="padding-right: 5px;
    padding-left: 5px; border-radius: 5px; font-weight: 500;background-color:${milestoneobj.backgroundColor ? milestoneobj.backgroundColor : ''}; color:${milestoneobj.textColor ? milestoneobj.textColor : ''};">${milestoneobj.editStatus}</span></strong> to <strong><span style="padding-right: 5px;
    padding-left: 5px;  border-radius: 5px; font-weight: 500;background-color:${milestoneobj.changebackgroundColor ? milestoneobj.changebackgroundColor : ''}; color:${milestoneobj.changetextColor ? milestoneobj.changetextColor : ''};">${milestoneobj.status}</span></strong> for <strong>${escapeText(milestoneobj.ProjectName)}</strong> project.</p>`;
}

// For Project MileStone Status Add //
exports.projectMileStoneStatusAdd = (milestoneobj) => {
    return `<p>Status of <strong>${(milestoneobj.editMilestoneName !== milestoneobj.milestoneArray[milestoneobj.editIndex].milestoneName) ? milestoneobj.milestoneArray[milestoneobj.editIndex].milestoneName : milestoneobj.editMilestoneName}</strong> Milestone is added <strong><span style="padding-right: 5px;
    padding-left: 5px;  border-radius: 5px; font-weight: 500;background-color:${milestoneobj.changebackgroundColor ? milestoneobj.changebackgroundColor : ''}; color:${milestoneobj.textColor ? milestoneobj.textColor : ''};">${milestoneobj.status}</span></strong> for <strong>${escapeText(milestoneobj.ProjectName)}</strong> project.</p>`;
} 

exports.projectMileStoneStatusAddForHourly = (milestoneobj) => {
    return `<p>Status of <strong>${milestoneobj.editMilestoneName}</strong> Milestone is added <strong><span style="padding-right: 5px;
    padding-left: 5px;  border-radius: 5px; font-weight: 500;background-color:${milestoneobj.changebackgroundColor ? milestoneobj.changebackgroundColor : ''}; color:${milestoneobj.textColor ? milestoneobj.textColor : ''};">${milestoneobj.status}</span></strong> for <strong>${escapeText(milestoneobj.ProjectName)}</strong> project.</p>`;
} 
exports.newProjectMileStoneStatusAdd = (milestoneobj) => {
    // return `<p>Status of <strong>${milestoneobj.editMilestoneName}</strong> Milestone is added <strong><span style="padding-right: 5px;
    // padding-left: 5px;  border-radius: 5px; font-weight: 500;background-color:${milestoneobj.changebackgroundColor ? milestoneobj.changebackgroundColor : ''}; color:${milestoneobj.textColor ? milestoneobj.textColor : ''};">${milestoneobj.status}</span></strong> for <strong>${milestoneobj.ProjectName}</strong> project.</p>`;
    return `<p>In project <strong>${escapeText(milestoneobj.ProjectName)}</strong> <span style="padding-right: 5px;
    padding-left: 5px;  border-radius: 5px; font-weight: 500;background-color:${milestoneobj.changebackgroundColor ? milestoneobj.changebackgroundColor : ''}; color:${milestoneobj.textColor ? milestoneobj.textColor : ''};">${milestoneobj.status}</span></strong> status is Added in <strong>${milestoneobj.editMilestoneName}</strong> milestone.</p>`
} 
exports.projectMileStoneStatusChangeForHourly = (milestoneobj) => {
    return `<p>Status of <strong>${milestoneobj.editMilestoneName}</strong> Milestone is changed from <strong><span style="padding-right: 5px;
    padding-left: 5px; border-radius: 5px; font-weight: 500;background-color:${milestoneobj.backgroundColor ? milestoneobj.backgroundColor : ''}; color:${milestoneobj.textColor ? milestoneobj.textColor : ''};">${milestoneobj.editStatus}</span></strong> to <strong><span style="padding-right: 5px;
    padding-left: 5px;  border-radius: 5px; font-weight: 500;background-color:${milestoneobj.changebackgroundColor ? milestoneobj.changebackgroundColor : ''}; color:${milestoneobj.changetextColor ? milestoneobj.changetextColor : ''};">${milestoneobj.status}</span></strong> for <strong>${escapeText(milestoneobj.ProjectName)}</strong> project.</p>`;
}
// For Project Mark As Star //
exports.projectMarkStar = (starObj) => {
    return `<p><strong>${escapeText(starObj.ProjectName)}</strong> has been marked as star.</p>`;
}

// For Project Mark As Star Remove //
exports.projectRemoveStar = (starObj) => {
    return `<p><strong>${escapeText(starObj.ProjectName)}</strong> has been removed from marked as star.</p>`;
}

// For Close Project
exports.closeProject = (closeObj) => {
    return `<p><strong>${closeObj.userName}</strong> has closed the <strong>${escapeText(closeObj.ProjectName)}</strong> Project</p>`;
}

// For Create Task //
exports.createTask = (taskObj) => {
    return `<p>In <strong>${escapeText(taskObj.ProjectName)}</strong> Project, created a new task named <strong>${escapeText(taskObj.newTaskname)}</strong>.</p>`;
}

// Fot Task Name Edit //
exports.taskNameEdit = (taskObj) => {
    return `In <strong>${escapeText(taskObj.ProjectName)}</strong> Project, Task name is changed from <strong>${escapeText(taskObj.previousTaskName)}</strong> to <strong>${escapeText(taskObj.TaskName)}</strong>`;
}

exports.taskTotalEstimate = (taskObj) => {
    return `In <strong>${escapeText(taskObj.TaskName)}</strong> Task, ${shown(taskObj.UserName)} added ${shown(taskObj.message)} total Estimate of task.</strong>`;
}


/* The template escapes the task name itself; everything else it places in HTML or an attribute is escaped here. */
exports.shownStatus = (prevStatus = {}, newStatus = {}) => ({
    template: {
        backColor: escapeText(prevStatus.backColor),
        color: escapeText(prevStatus.color),
        statusName: escapeText(prevStatus.statusName),
        bgColor: escapeText(prevStatus.bgColor),
        textColor: escapeText(prevStatus.textColor),
        newStatusName: escapeText(newStatus.status && newStatus.status.text),
    },
    updatedTaskName: escapeText(prevStatus.updatedTaskName),
});

exports.shownPriority = (priorityObj = {}) => ({
    template: {
        statusImage: escapeText(priorityObj.statusImage),
        priorityName: escapeText(priorityObj.priorityName),
        newStatusImage: escapeText(priorityObj.newStatusImage),
        newPriorityName: escapeText(priorityObj.newPriorityName),
    },
    newPriorityName: escapeText(priorityObj.newPriorityName),
});

exports.shownTaskType = (prevStatus = {}, newStatus = {}) => ({
    template: {
        oldTaskTypeImage: escapeText(prevStatus.taskImage),
        oldTaskTypeName: escapeText(prevStatus.name),
        newTaskTypeImage: escapeText(newStatus.taskTypeImage),
        newTaskTypeName: escapeText(newStatus.taskTypeName),
    },
    newTaskTypeName: escapeText(newStatus.taskTypeName),
});

// For Task Status Change //
exports.taskStatusChange = (obj) => {
    return `<p>In <strong>${escapeText(obj.ProjectName)}</strong> Project, Status of <strong>${escapeText(obj.taskName)
        }</strong> is changed from <span style="background-color:${shown(obj.backColor)}; color:${shown(obj.color)};padding-right: 5px;padding-left: 5px;border-radius: 5px;font-weight: 500;">${shown(obj.statusName)}</span> to <span style="font-weight: 500;background-color:${shown(obj.bgColor)
        }; color:${shown(obj.textColor)
        };padding-right: 5px;padding-left: 5px;border-radius: 5px;">${shown(obj.newStatusName)
        }</span>.</p>`;
}

// For Task Priority Change //
exports.taskPriorityChange = (priorityObj) => {
    return `<p>In <strong>${escapeText(priorityObj.ProjectName)}</strong> project, Priority of
    <strong>${escapeText(priorityObj.taskName)}</strong> is changed from 
    <span>
        <img style='width: 10px; height: 10px;' v-if='${shown(priorityObj.statusImage)}' src="${shown(priorityObj.statusImage)}" alt="task priority"/> ${shown(priorityObj.priorityName)}
    </span> to 
    <span>
        <img style='width: 10px; height: 10px;' v-if='${shown(priorityObj.newStatusImage)}' src="${shown(priorityObj.newStatusImage)}" alt="task priority"/> ${shown(priorityObj.newPriorityName)}
    </span></p>`;
}
// For Task Task Type Change
exports.taskTypeChage = (taskTpeData) => {
    return `<p>In <strong>${escapeText(taskTpeData.ProjectName)}</strong> project, Task Type of
    <strong>${escapeText(taskTpeData.taskName)}</strong> is changed from 
    <span>
        <img style='width: 10px; height: 10px;' v-if='${shown(taskTpeData.oldTaskTypeImage)}' src="${shown(taskTpeData.oldTaskTypeImage)}" alt="task priority"/> ${shown(taskTpeData.oldTaskTypeName)}
    </span> to 
    <span>
        <img style='width: 10px; height: 10px;' v-if='${shown(taskTpeData.newTaskTypeImage)}' src="${shown(taskTpeData.newTaskTypeImage)}" alt="task priority"/> ${shown(taskTpeData.newTaskTypeName)}
    </span></p>`;
}

// For Task Assignee Add //
exports.taskAssigneeAdd = (obj) => {
    return `<p>In <strong>${escapeText(obj.ProjectName)}</strong> Project, <strong>${escapeText(obj.TaskName)}</strong> is Assigned to <strong>${shown(obj.Employee_Name)}</strong></p>`;
}

// For Task Assignee Remove //
exports.taskAssigneeRemove = (obj) => {
    return `<p>In <strong>${escapeText(obj.ProjectName)}</strong> Project, <strong>${shown(obj.Employee_Name)}</strong> is Removed from <strong>${escapeText(obj.TaskName)}</strong> Task</p>`;
}

// For Task Assigne Replace
exports.taskAssigneeReplace = (obj) => {
    return `<p>In <strong>${escapeText(obj.ProjectName)}</strong> Project, <strong>${shown(obj.Employee_Name)}</strong> ${String(shown(obj.Employee_Name)).includes(",") ? 'are' : 'is'} Assigned to <strong>${escapeText(obj.TaskName)}</strong> Task</p>`;
}

// For Task Due Date Add //
exports.taskDueDateAdd = (obj) => {
    return `<p>In <strong>${escapeText(obj.ProjectName)}</strong> Project, Due Date of <strong>${escapeText(obj.TaskName) ? escapeText(obj.TaskName) : ""
        }</strong> is added as <strong><span style="background-color: rgb(236 238 255);color: #2F3990;border-radius: 5px;padding-right: 5px;padding-left: 5px;">${shown(obj.lastDate)}</span></strong>.</p>`;
}

// For Task Due Date Change //
exports.taskDueDateChange = (obj) => {
    return `<p>In <strong>${escapeText(obj.ProjectName)}</strong> Project, Due Date of <strong>${escapeText(obj.TaskName) ? escapeText(obj.TaskName) : ""}
            </strong> is changed from <strong><span style="background-color: rgb(236 238 255);color: #2F3990;border-radius: 5px;padding-right: 5px;padding-left: 5px;">${shown(obj.previousDate)}</span></strong> to <strong><span style="background-color: rgb(236 238 255);color: #2F3990;border-radius: 5px;padding-right: 5px;padding-left: 5px;">${shown(obj.changedDate)}</span></strong>.</p>`;
}

// For Task Start Date Add //
exports.taskStartDateAdd = (obj) => {
    return `<p>In <strong>${escapeText(obj.ProjectName)}</strong> Project, Start Date of <strong>${escapeText(obj.TaskName)}</strong> is added as <strong><span style="background-color: rgb(236 238 255);color: #2F3990;border-radius: 5px;padding-right: 5px;padding-left: 5px;">${shown(obj.formetedStartDate)}</span></strong>.</p>`;
}

// For Task Start Date Change //
exports.taskStartDateChange = (obj) => {
    return `<p>In <strong>${escapeText(obj.ProjectName)}</strong> Project, Start Date of <strong>${escapeText(obj.TaskName)}</strong> is changed from <strong><span style="background-color: rgb(236 238 255);color: #2F3990;border-radius: 5px;padding-right: 5px;padding-left: 5px;">${shown(obj.formetedStartDate)}</span></strong> to <strong><span style="background-color: rgb(236 238 255);color: #2F3990;border-radius: 5px;padding-right: 5px;padding-left: 5px;">${shown(obj.newDate)}</span></strong>.</p>`;
}

const datePill = (date) => `<strong><span style="background-color: rgb(236 238 255);color: #2F3990;border-radius: 5px;padding-right: 5px;padding-left: 5px;">${shown(date)}</span></strong>`;
const dateMove = (previous, next) => (previous ? `is changed from ${datePill(previous)} to ${datePill(next)}` : `is added as ${datePill(next)}`);

exports.taskStartAndDueDateChange = (obj) => {
    return `<p>In <strong>${escapeText(obj.ProjectName)}</strong> Project, Start Date of <strong>${escapeText(obj.TaskName)}</strong> ${dateMove(obj.previousStartDate, obj.startDate)} and Due Date ${dateMove(obj.previousDueDate, obj.dueDate)}.</p>`;
}

// For Task End Date Add //
exports.taskEndDateAdd = (obj) => {
    return `<p>In <strong>${escapeText(obj.ProjectName)}</strong> Project, End Date of <strong>${escapeText(obj.TaskName)}</strong> is added as <strong><span style="background-color: rgb(236 238 255);color: #2F3990;border-radius: 5px;padding-right: 5px;padding-left: 5px;">${shown(obj.formatedDate)}</span></strong>.</p>`;
}

// For Task End Date Change //
exports.taskEndDateChange = (obj) => {
    return `<p>In <strong>${escapeText(obj.ProjectName)}</strong> Project, End Date of <strong>${escapeText(obj.TaskName)}</strong> is changed from <strong><span style="background-color: rgb(236 238 255);color: #2F3990;border-radius: 5px;padding-right: 5px;padding-left: 5px;">${shown(obj.formatedDate)}</span></strong> to <strong><span style="background-color: rgb(236 238 255);color: #2F3990;border-radius: 5px;padding-right: 5px;padding-left: 5px;">${shown(obj.newDate)}</span></strong>.</p>`;
}

// For Task Description Add //
exports.taskDescriptionAdd = (Descobj) => {
    return `<p>In <strong>${escapeText(Descobj.ProjectName)}</strong> Project, Description of <strong>${Descobj.TaskName
        }</strong> is added as <strong>"${Descobj.textSimple.length > 20 ? Descobj.textSimple.slice(0, 20) + '...' : Descobj.textSimple}"</strong>.</p>`;
}

// For Task Description Change //
exports.taskDescriptionChange = (Descobj) => {
    return `<p>In <strong>${escapeText(Descobj.ProjectName)}</strong> Project, Description of <strong>${Descobj.TaskName}</strong> is changed from <strong>"${Descobj.previousDiscriptionText.length > 20 ? Descobj.previousDiscriptionText.slice(0, 20) + '...' : Descobj.previousDiscriptionText}"</strong> to <strong>"${Descobj.textSimple.length > 20 ? Descobj.textSimple.slice(0, 20) + '...' : Descobj.textSimple}"</strong>.</p>`;
}

// For Task Attachment Add //
exports.taskAttachmentAdd = (Attachobj) => {
    return `<p>In <strong>${escapeText(Attachobj.ProjectName)}</strong> Project, <strong>${escapeText(Attachobj.url)}</strong> attached on <strong>${escapeText(Attachobj.TaskName)}</strong>.</p>`;
}

// For Task Attachment Remove //
exports.taskAttachmentRemove = (Attachobj) => {
    return `<p>In <strong>${escapeText(Attachobj.ProjectName)}</strong> Project, <strong>${escapeText(Attachobj.removeFileName)}</strong> removed on <strong>${escapeText(Attachobj.TaskName)}</strong>.</p>`;
}

// For Task Checklist Add //
exports.taskCheckList = (Checkobj) => {
    return `<p>In <strong>${escapeText(Checkobj.ProjectName)}</strong> Project, <strong>${Checkobj.TaskName}</strong> Created a new Check List named <strong>${Checkobj.value}</strong>.</p>`;
}

// For Task Checklist Assignee Add //
exports.taskCheckListAssignee = (obj) => {
    return `<p>In <strong>${escapeText(obj.ProjectName)}</strong> Project, <strong>${escapeText(obj.TaskName)}</strong> of <strong>${obj.selectedChecklist}</strong> Checklist is Assigned to <strong>${obj.Employee_Name}</strong>.</p>`;
}

// For Task Checklist Assignee Remove //
exports.taskCheckListAssigneeRemove = (obj) => {
    return `<p>In <strong>${escapeText(obj.ProjectName)}</strong> Project, <strong>${escapeText(obj.TaskName)}</strong> of <strong>${obj.selectedChecklistRemove}</strong> Checklist is Removed <strong>${obj.Employee_Name}</strong> .</p>`;
}

exports.taskCheckListEdit = (checkObj) => {
    return `<p>Project <strong>${escapeText(checkObj.ProjectName)}</strong> Updated a  Check List named  from <strong> ${checkObj.previouName}</strong> to  <strong>${checkObj.newName}</strong> in <strong>${checkObj.TaskName}</strong>.</p>`;
}

exports.taskCheckListRemove = (checkObj) => {
    return `<p>Project <strong>${escapeText(checkObj.ProjectName)}</strong> Removed a  ${checkObj.checklist} <strong> ${checkObj.name}</strong> from <strong>${checkObj.TaskName}</strong>.</p>`;
}
exports.taskCheckListChecked = (checkObj) => {
    return `<p><strong>${checkObj.Employee_Name}</strong> has <strong>${checkObj.isChecked ? 'checked' : 'unchecked'}</strong> <strong>${checkObj.name}</strong> checklist.<p>`;
}
// For Create Sub Task //
exports.createSubTask = (Subobj) => {
    return `<p>In <strong>${escapeText(Subobj.ProjectName)}</strong> Project, created a new sub task named <strong>${Subobj.newSubTaskName}</strong>.</p>`;
}

// For Logged Hours //
exports.loggedHours = (obj) => {
    return `<p><strong>${obj.userName}</strong> Added <strong>${obj.timeDuration} hrs(${obj.logTimeDate})</strong> logged hours in <strong>${escapeText(obj.TaskName)}</strong> task for this <strong>${escapeText(obj.ProjectName)}</strong> project.</p>`;
}

// For Logged Hours Update //
exports.loggedHoursUpdated = (obj) => {
    return `<p><strong>${obj.userName}</strong> Updated logged hours from <strong>${obj.previousLoggedTime} hrs</strong> to <strong>${obj.timeDuration} hrs (${obj.logTimeDate})</strong> in <strong>${escapeText(obj.TaskName)}</strong> task for this <strong>${escapeText(obj.ProjectName)}</strong> project.</p>`;
}
exports.loggedHoursDeleted= (obj) => {
    return `<p><strong>${obj.userName}</strong> Deleted logged hours from <strong>${obj.strtLogTime}  to ${obj.endLogTime} in <strong>${escapeText(obj.TaskName)}</strong> task of <strong>${escapeText(obj.ProjectName)}</strong></p>`;
}
// For Task Estimated Hour Add //
exports.estimatedTimeAdded = (obj) => {
    return `<p><strong>${obj.loggedUserName}</strong> Added <strong>${obj.updateEstimatedTime} hrs (${obj.timeDateData})</strong> Estimated hours in <strong>${escapeText(obj.TaskName)}</strong> task for this <strong>${escapeText(obj.ProjectName)}</strong> project.</p>`;
}

// For Task Estimated Hour Update //
exports.estimatedTimeUpdated = (obj) => {
    return `<p><strong>${obj.loggedUserName}</strong> Updated Estimated hours from <strong>${obj.estimatedTime} hrs</strong> to <strong>${obj.updateEstimatedTime} hrs (${obj.timeDateData}) </strong> in <strong>${escapeText(obj.TaskName)}</strong> task for this <strong>${escapeText(obj.ProjectName)}</strong> project.</p>`;
}

// For Admin or TL is Assign Estimated hours For User //
exports.estimatedTimeAssignUpdated = (obj) => {
    return `<p><strong>${obj.userName}</strong> Updated Estimated hours from <strong>${obj.estimatedTime} hrs</strong> to <strong>${obj.updateEstimatedTime} hrs (${obj.timeDateData})</strong>  for <strong>${obj.loggedUserName}</strong> in <strong>${escapeText(obj.TaskName)}</strong> task for this <strong>${escapeText(obj.ProjectName)}</strong> project.</p>`;
}

// For Admin or TL is Assign Estimated hours Updated For User //
exports.estimatedTimeAssignAdded = (obj) => {
    return `<p><strong>${obj.userName}</strong> Added <strong>${obj.updateEstimatedTime} hrs (${obj.timeDateData})</strong> Estimated hours for <strong>${obj.loggedUserName}</strong> in <strong>${escapeText(obj.TaskName)}</strong> task for this <strong>${escapeText(obj.ProjectName)}</strong> project.</p>`;
}
