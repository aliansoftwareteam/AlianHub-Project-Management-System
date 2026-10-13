const { default: mongoose } = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { HandleHistory } = require('../../Tasks/helpers/helper');
const { HandleBothNotification } = require('../../Tasks/helpers/handleNotification');
const templates = require('../../Tasks/helpers/notificationTemplate');
const { employeeNameOf, escapeText } = require('../../Tasks/helpers/taskWriteFields');

const PLAN_DATE_FORMAT = 'DD/MM/YYYY';
const HISTORY_KEY = 'Task_Due_Date';
const NOTIFICATION_KEY = 'task_estimated_hours';

const pad = (value) => String(value).padStart(2, '0');
const hoursOf = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(Math.floor(minutes % 60))}`;

const byId = (companyId, type, id) => MongoDbCrudOpration(companyId, { type, data: [{ _id: new mongoose.Types.ObjectId(String(id)) }] }, 'findOne');

const previousPlanOf = (companyId, filter) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.ESTIMATES_TIME, data: [filter] }, 'findOne');

/* The sentences are the ones the web app wrote; the added or updated one is picked by whether the day already had a plan. */
const planTexts = ({ actorName, personName, forSelf, previousMinutes, minutes, day, taskName, projectName }) => {
    const time = hoursOf(minutes);
    const prevTime = previousMinutes ? hoursOf(previousMinutes) : '';
    const shown = { userName: actorName, loggedUserName: personName, estimatedTime: prevTime, updateEstimatedTime: time, timeDateData: day, TaskName: taskName, ProjectName: projectName };
    const updated = previousMinutes !== null;
    if (forSelf) {
        return updated
            ? { history: `<b>${actorName}</b> has updated <b>estimated time</b> for <b>${day}</b> from <b>hrs(${prevTime})</b> to <b>hrs(${time})</b>.`, notice: templates.estimatedTimeUpdated(shown) }
            : { history: `<b>${actorName}</b> has added <b>hrs(${time})</b> <b>estimated time</b> for<b> ${day}</b>.`, notice: templates.estimatedTimeAdded(shown) };
    }
    return updated
        ? { history: `<b>${actorName}</b> updated the <b>estimated time</b> of <b>${personName}</b> for <b>${day}</b> from <b>${prevTime}</b> to <b>${time}</b>.`, notice: templates.estimatedTimeAssignUpdated(shown) }
        : { history: `<b>${actorName}</b> added <b>hrs(${time})</b> in <b>estimated time</b> of <b>${personName}</b> for <b>${day}</b>.`, notice: templates.estimatedTimeAssignAdded(shown) };
};

const recordPlanChange = async ({ companyId, actorId, previous, saved, timeZone }) => {
    const minutes = Number(saved.EstimatedTime) || 0;
    const previousMinutes = previous ? Number(previous.EstimatedTime) || 0 : null;
    if (previousMinutes === minutes) return;

    const task = await byId(companyId, SCHEMA_TYPE.TASKS, saved.TaskId);
    if (!task) return;
    const project = await byId(companyId, SCHEMA_TYPE.PROJECTS, task.ProjectID);

    const personId = String(saved.UserId || saved.userId);
    const forSelf = personId === String(actorId);
    const actorName = escapeText(await employeeNameOf(actorId));
    const personName = forSelf ? actorName : escapeText(await employeeNameOf(personId));
    const texts = planTexts({
        actorName,
        personName,
        forSelf,
        previousMinutes,
        minutes,
        day: templates.shownDate(new Date(saved.Date).getTime(), PLAN_DATE_FORMAT, timeZone),
        taskName: task.TaskName,
        projectName: project && project.ProjectName,
    });

    const actor = { id: String(actorId), Employee_Name: actorName };
    const projectId = String(task.ProjectID);
    const taskId = String(task._id);
    await Promise.all([
        HandleHistory('task', companyId, projectId, taskId, { key: HISTORY_KEY, message: texts.history, sprintId: task.sprintId }, actor),
        HandleBothNotification({ type: 'tasks', companyId, projectId, taskId, folderId: task.folderObjId || '', sprintId: task.sprintId || '', userData: actor, object: { key: NOTIFICATION_KEY, message: texts.notice } }),
    ]);
};

module.exports = {
    HISTORY_KEY,
    NOTIFICATION_KEY,
    previousPlanOf,
    recordPlanChange,
};
