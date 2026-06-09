const { DateTime } = require('luxon');
const hlp = require("../../Tasks/helpers/helper");
const notiTemp = require("../../Tasks/helpers/notificationTemplate")
const { HandleBothNotification } = require("../../Tasks/helpers/handleNotification");
// BUG-042 / #96 — replaced `moment` with luxon. logTime/controllerV2.js
// already imports `DateTime` above; the helper centralises the
// "format a JS Date as YYYY-MM-DD" call this file used moment for.
const { formatDate } = require("../../../utils/dateHelpers");
const logger = require("../../../Config/loggerConfig");
const { SCHEMA_TYPE } = require("../../../Config/schemaType")
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose")

const fs = require("fs");
const { updateUserFun } = require('../../Users/controller');
const { myCache } = require('../../../Config/config');
const { updateProjectInternal } = require('../../Project/controller/updateProject');
const loggerConfig = require('../../../Config/loggerConfig');
const socketEmitter = require('../../../event/socketEventEmitter.js');
const { handleFileUploadForTrackerSS,handleuploadMainFileForbase64Thumbnail } = require(`../../../common-storage/common-${process.env.STORAGE_TYPE}.js`);
/**
 * Add and Edit Manual Log Time
 * @param {Objcet} req
 * @param {Object} res
 * @returns
 */
exports.updateProjectForTimelog = (companyId, projectId, isOnlyTimestampUpdate, timestamp, userId, taskId, timesheetId, isAdd) => {
    try {
        let obj = {
            lastProjectActivity: timestamp
        };

        let userObj = {
            taskId: taskId,
            timesheetId: timesheetId,
            timestamp: timestamp
        };

        if (!isOnlyTimestampUpdate) {
            obj = {
                ...obj,
                ...(
                    isAdd ?
                        {$set: {[`userActivity.${userId}`]: userObj}}
                    :
                        {$unset: {[`userActivity.${userId}`]: {}}}
                )
            }
        }

        const updateProjectQuery = {
            type: SCHEMA_TYPE.PROJECTS,
            data: [
                {
                    _id: new mongoose.Types.ObjectId(projectId)
                },
                {
                    ...obj
                }
            ]
        }
        MongoDbCrudOpration(companyId, updateProjectQuery, "findOneAndUpdate")
        .catch((error) => {
            logger.error(`Error updating user activity timestamp: ${error}`);
        })

        const updateUserQuery = {
            type: SCHEMA_TYPE.USERS,
            data: [
                {
                    _id: new mongoose.Types.ObjectId(userId)
                },
                {
                    lastActive: new Date()
                }
            ]
        }
        updateUserFun(SCHEMA_TYPE.GOLBAL, updateUserQuery, "findOneAndUpdate",companyId,userId)
        .catch((error) => {
            logger.error(`Error updating user activity timestamp: ${error}`);
        })
    } catch (error) {
        logger.error(`Try Catch Error while update Project: ${error}`);
    }
};

/**
* Delete Log Time
* @param {Objcet} req
* @param {Object} res
* @returns
*/

exports.findAndUpdateProjectOrTaskStartDate = async ({
  companyId,
  userId,
  projectId,
  taskId,
  startDateForProjectOrTask
}) => {
    // Validate required parameters early
    if (!companyId || !userId || !projectId || !taskId) {
        logger.error('Missing required identifiers', { companyId, userId, projectId, taskId });
        return;
    }

    // Helper function to safely parse JSON from cache
    const safeParse = (value, defaultValue) => {
        try {
            return value ? JSON.parse(value) : defaultValue;
        } catch {
            return defaultValue;
        }
    };

    // Fetch project data from cache or DB
    const cacheKey = `UserProjectData:${companyId}:${userId}`;
    const cachedValue = myCache.get(cacheKey);
    const projectArray = safeParse(cachedValue, null);

    let projectToUpdate = projectArray?.find((project) => project?._id === projectId) || null;

    if (!projectToUpdate) {
        try {
            const mongoObj = { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: projectId }] };
            projectToUpdate = await MongoDbCrudOpration(companyId, mongoObj, 'findOne');
        } catch (error) {
            logger.error(`Error fetching project from DB: ${error.message}`, { projectId });
            return;
        }
    }

    // Fetch task from DB
    let taskResponse;
    try {
        const query = { type: SCHEMA_TYPE.TASKS, data: [{ _id: new mongoose.Types.ObjectId(taskId) }] };
        taskResponse = await MongoDbCrudOpration(companyId, query, 'findOne');
    } catch (error) {
        logger.error(`Error fetching task: ${error.message}`, { taskId });
        return;
    }

    // Update task startDate if missing
    if (taskResponse && !taskResponse?.startDate && projectToUpdate) {
        try {
            const firebaseObject = { startDate: startDateForProjectOrTask ? startDateForProjectOrTask : new Date() };
            let object = {
                type:SCHEMA_TYPE.TASKS,
                data: [
                    { _id: new mongoose.Types.ObjectId(taskId) },
                    { ...firebaseObject },
                    {returnDocument: "after"}
                ]
            }
            MongoDbCrudOpration(companyId,object, "findOneAndUpdate")
            .then((result) => {
                socketEmitter.emit('update', { type: "update", data: result , updatedFields: firebaseObject, module: 'task' });
            });

            const historyObj = {
                key: 'Task_StartDate',
                message: `<b>Start Date</b> was auto-assigned as <b>DATE_${new Date(firebaseObject.startDate).getTime()}</b>.`,
                sprintId: taskResponse.sprintId,
            };

            const userData = { id: userId };
            await hlp.HandleHistory('task', companyId, projectId, taskId, historyObj, userData).catch((error) => {
                logger.error(`ERROR in task history: ${error.message}`);
            });
        } catch (error) {
            logger.error(`Error updating task startDate: ${error.message}`, { taskId });
        }
    }

    // Update project StartDate if missing
    if (projectToUpdate && !projectToUpdate?.StartDate) {
        try {
            const updateObject = { StartDate: startDateForProjectOrTask ? startDateForProjectOrTask : new Date() };
            await updateProjectInternal(companyId, projectId, updateObject, '', []);
            
            const historyObj = {
                key: 'Project_StartDate',
                message: `<b>Start Date</b> was auto-assigned as <b>DATE_${new Date(updateObject.StartDate).getTime()}</b>.`,
            };

            const userData = { id: userId };
            await hlp.HandleHistory('project', companyId, projectId, null, historyObj, userData).catch((error) => {
                logger.error(`ERROR in project history: ${error.message}`);
            });
        } catch (error) {
            logger.error(`Error updating project StartDate: ${error.message}`, { projectId });
        }
    }
};

exports.updateRemainingTime = async (companyID,taskId) => {
try {
    const logtimeObj = {
        type: SCHEMA_TYPE.TIMESHEET,
        data: [
            {
                "TicketID": taskId
            },
            {LogTimeDuration:1,_id:0},
        ]
    };
    const loggedTime =  await MongoDbCrudOpration(companyID, logtimeObj, 'find');
    const totalEstimatedTime = loggedTime.reduce((acc,ele)=> acc = acc + ele.LogTimeDuration,0)
    const taskestimatedObj = {
        type: SCHEMA_TYPE.TASKS,
        data: [
           {_id: new mongoose.Types.ObjectId(taskId)},
           {totalEstimatedTime:1}
        ]
    };
    const totalEstimated =  await MongoDbCrudOpration(companyID, taskestimatedObj, 'findOne');
    const remainingLogtime = totalEstimated.totalEstimatedTime - totalEstimatedTime;
    const result = await MongoDbCrudOpration(companyID, {
        type: SCHEMA_TYPE.TASKS,
        data: [
           {_id: new mongoose.Types.ObjectId(taskId)},
           {remainingHours:remainingLogtime > 0 ? remainingLogtime : 0},
           {returnDocment: "after"}
        ]
    }, 'findOneAndUpdate');
    socketEmitter.emit('update', { type: "update", data: result , updatedFields: {remainingHours:remainingLogtime > 0 ? remainingLogtime : 0}, module: 'task' });
} catch (error) {
    loggerConfig.error(`Remaining LOg hours Error:${error}`);
}

}
