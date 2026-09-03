/**
 * "Blank" in Create Project: To Do · In Progress · Done and nothing else.
 * Shaped like an entry of utils/projectTemplates.json so the category merge
 * in createProject can consume it unchanged.
 */
module.exports = {
    _id: 'blank',
    TemplateName: 'Blank',
    Description: 'To do · In progress · Done. Nothing else.',
    TemplateCategory: { key: 0, name: 'Blank' },
    projectStatusData: [
        { name: 'Open', value: 'open', textColor: '#7367F0', backgroundColor: '#E3E1FC35', key: 1, type: 'default_active' },
        { name: 'Completed', value: 'completed', textColor: '#1aee17', backgroundColor: '#1aee1735', key: 5, type: 'done' },
        { name: 'Close', value: 'close', textColor: '#6BC950', backgroundColor: '#6BC95035', key: 2, type: 'close' },
    ],
    taskStatusData: [
        { name: 'To Do', bgColor: '#ff960035', textColor: '#ff9600', key: 1, type: 'default_active' },
        { name: 'In Progress', bgColor: '#6473e835', textColor: '#6473e8', key: 3, type: 'active' },
        { name: 'Done', bgColor: '#24c11035', textColor: '#24c110', key: 6, type: 'close' },
    ],
    TemplateTaskType: [
        { name: 'Task', value: 'task', taskImage: 'task.png', key: 1 },
    ],
    apps: [
        { appStatus: true, key: 'Priority', name: 'Priority' },
        { appStatus: true, key: 'MultipleAssignees', name: 'Multiple Assignees' },
        { appStatus: true, key: 'TimeTracking', name: 'Time Tracking' },
    ],
    TemplateRequiredComponent: [
        { viewStatus: true, keyName: 'ProjectListView', value: 'list', name: 'List', setAsDefault: true },
        { keyName: 'ProjectKanban', viewStatus: true, value: 'ProjectKanban', setAsDefault: false, name: 'Board' },
    ],
    customFiedlsValue: [],
};
