const { escapeHtml } = require('../../utils/escapeHtml');

const taskCreatedHistoryMessage = (actor, task) => {
    const typeLabel = String(task.TaskType || 'task').replace(/_/g, '-');
    return `<b>${escapeHtml(actor.Employee_Name || 'AlianHub AI')}</b> has created new <b>${escapeHtml(task.TaskName)}</b> ${escapeHtml(typeLabel)}.`;
};

const projectCreatedHistoryMessage = (actor, projectDoc, tracker) => `<b>${escapeHtml(actor.Employee_Name || 'AI')}</b> created project <b>${escapeHtml(projectDoc.ProjectName)}</b> with <b>${tracker.sprints.length}</b> sprints and <b>${tracker.tasks.length}</b> tasks via AI.`;

const projectCreatedNoticeMessage = (projectDoc) => `<p>Created a new project named <strong>${escapeHtml(projectDoc.ProjectName)}</strong>.</p>`;

module.exports = { taskCreatedHistoryMessage, projectCreatedHistoryMessage, projectCreatedNoticeMessage };
