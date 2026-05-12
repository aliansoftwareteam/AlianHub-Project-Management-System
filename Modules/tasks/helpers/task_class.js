const { dbCollections } = require('../../../Config/collections')
const { HandleHistory} = require("./helper")
const { taskNameEdit, taskPriorityChange, taskStatusChange,} = require('./notificationTemplate')
const { HandleBothNotification } = require("./handleNotification")
const logger = require("../../../Config/loggerConfig")
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries")
const { default: mongoose } = require("mongoose")

/**
 * BUG-015 / #69 fix.
 *
 * Pre-fix every method in this class resolved the outer Promise FIRST and
 * then fired `HandleBothNotification(...)` / `HandleHistory(...)` as
 * fire-and-forget side effects. If those side effects failed the caller
 * had already seen `{status: true, statusText: "...updated successfully"}`
 * — the failure was only visible in the server log.
 *
 * The DB write itself was already awaited (it lived inside `.then` of
 * `MongoDbCrudOpration`), but the side effects were not, so the contract
 * "this method's resolution means everything finished" was violated.
 *
 * The fix collects each method's side effects into an array, attaches a
 * `.catch` to each so individual failures don't reject the whole batch,
 * `await Promise.allSettled(...)` them, and only then resolves. The
 * outer Promise now resolves at the point where every side effect has
 * either succeeded or failed-and-been-logged.
 *
 * Side-effect failures are still logged (existing behaviour) — they
 * don't fail the operation, but they no longer race the response.
 */
class Task {

    /* -------------- UPDATE STATUS FUNCTION FOR TASK -----------------*/
    updateStatus({newStatus, prevStatus, projectData, task, userData, isUpdateTask}) {
        return new Promise((resolve, reject) => {
            try {
                const buildChangeObj = () => ({
                    'ProjectName': projectData.ProjectName,
                    'taskName': prevStatus.taskName,
                    'backColor': prevStatus.backColor,
                    'color': prevStatus.color,
                    'statusName': prevStatus.statusName,
                    'bgColor': prevStatus.bgColor,
                    'textColor': prevStatus.textColor,
                    'newStatusName': newStatus.status.text,
                });

                const fireSideEffects = async () => {
                    const changeData = buildChangeObj();
                    const work = [];

                    const notificationObject = {
                        message: taskStatusChange(changeData),
                        key: "task_status",
                        projectId: projectData._id,
                        taskId: prevStatus.taskId,
                        sprintId: task.sprintArray.id,
                    };
                    if (prevStatus.updatedTaskName !== prevStatus.name) {
                        work.push(
                            HandleBothNotification({
                                type: 'tasks',
                                userData,
                                companyId: projectData.CompanyId,
                                projectId: projectData._id,
                                taskId: prevStatus.taskId,
                                folderId: task.sprintArray.folderId || "",
                                sprintId: task.sprintArray.id,
                                object: notificationObject,
                                changeType: 'status',
                                changeData,
                            })
                            .catch((error) => {
                                logger.error(`ERROR in notification Task Status: ${error.message || error}`);
                            })
                        );
                    }

                    const historyObj = {
                        key: "Task_Status",
                        message: `<b>${userData.Employee_Name}</b> has changed <b> Status</b> as <b>${prevStatus.updatedTaskName}</b>.`,
                        sprintId: task.sprintArray.id,
                    };
                    work.push(
                        HandleHistory('task', projectData.CompanyId, projectData._id, prevStatus.taskId, historyObj, userData)
                        .catch((error) => {
                            logger.error(`ERROR in task status update history : ${error.message || error}`);
                        })
                    );

                    await Promise.allSettled(work);
                };

                if (isUpdateTask === false) {
                    // No DB write here — the caller has already persisted the
                    // change and is just asking us to dispatch the side effects.
                    fireSideEffects().then(() => {
                        resolve({status: true, statusText: "Status updated successfully"});
                    });
                    return;
                }

                const query = {
                    type: dbCollections.TASKS,
                    data: [
                        { _id: new mongoose.Types.ObjectId(prevStatus.taskId) },
                        {
                            $set: { ...newStatus },
                            $unset: { groupByStatusIndex: 1 },
                        },
                    ],
                };
                MongoDbCrudOpration(projectData.CompanyId, query, "updateOne")
                .then(async () => {
                    await fireSideEffects();
                    resolve({status: true, statusText: "Status updated successfully"});
                })
                .catch((error) => {
                    logger.error(`ERROR in task status update : ${error.message || error}`);
                    reject(error);
                });
            } catch (error) {
                logger.error(`ERROR in task status update : ${error.message || error}`);
                reject(error);
            }
        });
    }

    /* -------------- UPDATE PRIORITY FUNCTION FOR TASK -----------------*/

    updatePriority({firebaseObj, projectData, taskData, priorityObj, userData, isUpdateTask}) {
        return new Promise((resolve, reject) => {
            try {
                const buildChangeObj = () => ({
                    'ProjectName': projectData?.ProjectName,
                    'taskName': priorityObj?.taskName,
                    'statusImage': priorityObj?.statusImage,
                    'priorityName': priorityObj?.priorityName,
                    'newStatusImage': priorityObj?.newStatusImage,
                    'newPriorityName': priorityObj?.newPriorityName,
                });

                const fireSideEffects = async () => {
                    const changeData = buildChangeObj();
                    const work = [];

                    const notificationObject = {
                        key: "task_priority",
                        message: taskPriorityChange(changeData),
                    };
                    if (priorityObj.newPriorityName !== priorityObj.priorityName) {
                        work.push(
                            HandleBothNotification({
                                type: 'tasks',
                                userData,
                                companyId: projectData.CompanyId,
                                projectId: projectData._id,
                                taskId: priorityObj.taskId,
                                folderId: taskData.sprintArray.folderId || "",
                                sprintId: taskData.sprintArray.id,
                                object: notificationObject,
                                changeType: 'priority',
                                changeData,
                            })
                            .catch((error) => {
                                logger.error(`ERROR in notification Task Priority: ${error.message || error}`);
                            })
                        );
                    }

                    const historyObj = {
                        key: "task_priority",
                        message: `<b>${userData.Employee_Name}</b> has changed <b> Priority</b> as <b>${priorityObj.newPriorityName}</b>.`,
                        sprintId: taskData.sprintArray.id,
                    };
                    work.push(
                        HandleHistory('task', projectData.CompanyId, projectData._id, priorityObj.taskId, historyObj, userData)
                        .catch((error) => {
                            logger.error(`ERROR in task priority update history : ${error.message || error}`);
                        })
                    );

                    await Promise.allSettled(work);
                };

                if (isUpdateTask === false) {
                    fireSideEffects().then(() => {
                        resolve({status: true, statusText: "Priority updated successfully"});
                    });
                    return;
                }

                const query = {
                    type: dbCollections.TASKS,
                    data: [
                        { _id: new mongoose.Types.ObjectId(priorityObj.taskId) },
                        {
                            $set: { ...firebaseObj },
                            $unset: { groupByPriorityIndex: 1 },
                        },
                    ],
                };
                MongoDbCrudOpration(projectData.CompanyId, query, "updateOne")
                .then(async () => {
                    await fireSideEffects();
                    resolve({status: true, statusText: "Priority updated successfully"});
                })
                .catch((error) => {
                    logger.error(`ERROR in task priority update : ${error.message || error}`);
                    reject(error);
                });
            } catch (error) {
                logger.error(`ERROR in task priority update : ${error.message || error}`);
                reject(error);
            }
        });
    }

    /* -------------- UPDATE TASK NAME FUNCTION -----------------*/

    updateTaskName({firebaseObj, projectData, taskData, obj, userData}) {
        return new Promise((resolve, reject) => {
            try {
                const fireSideEffects = async () => {
                    const work = [];

                    const editTaskObj = {
                        'ProjectName': projectData.ProjectName,
                        'previousTaskName': obj.previousTaskName,
                        'TaskName': firebaseObj.TaskName,
                    };
                    const notificationObject = {
                        key: "task_edit",
                        message: taskNameEdit(editTaskObj),
                    };
                    work.push(
                        HandleBothNotification({
                            type: 'tasks',
                            userData,
                            companyId: projectData.CompanyId,
                            projectId: projectData._id,
                            taskId: taskData._id,
                            folderId: taskData.sprintArray.folderId || "",
                            sprintId: taskData.sprintArray.id,
                            object: notificationObject,
                            changeType: 'name',
                            changeData: editTaskObj,
                        })
                        .catch((error) => {
                            logger.error(`ERROR in notification Task Name: ${error.message || error}`);
                        })
                    );

                    const historyObj = {
                        key: "task_name_edit",
                        message: `<b>${obj.userName}</b> has changed <b> Task name</b> from <b>${obj.previousTaskName}</b> to <b>${firebaseObj.TaskName}</b>.`,
                        sprintId: taskData.sprintArray.id,
                    };
                    work.push(
                        HandleHistory('task', projectData.CompanyId, projectData._id, taskData._id, historyObj, userData)
                        .catch((error) => {
                            logger.error(`ERROR in task name update history : ${error.message || error}`);
                        })
                    );

                    await Promise.allSettled(work);
                };

                const query = {
                    type: dbCollections.TASKS,
                    data: [
                        { _id: new mongoose.Types.ObjectId(taskData._id) },
                        { $set: { ...firebaseObj } },
                    ],
                };
                MongoDbCrudOpration(projectData.CompanyId, query, "updateOne")
                .then(async () => {
                    await fireSideEffects();
                    resolve({status: true, statusText: "Task name updated successfully"});
                })
                .catch((error) => {
                    logger.error(`ERROR in task Name update : ${error.message || error}`);
                    reject(error);
                });
            } catch (error) {
                logger.error(`ERROR in task Name update : ${error.message || error}`);
                reject(error);
            }
        });
    }
}

exports.task = new Task();
