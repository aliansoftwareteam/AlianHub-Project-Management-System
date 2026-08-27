const logger = require('../../../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../../utils/mongo-handler/mongoQueries');
const { default: mongoose } = require('mongoose');
const {
    normalizeFreq,
    nextOccurrenceDates,
    shouldSpawnNext,
    pickOpenStatus,
    buildNextOccurrenceTask,
} = require('./recurrenceRules');

module.exports = {
    updateRecurrence({ firebaseObj, project, task, userData }) {
        return new Promise((resolve, reject) => {
            try {
                const freq = normalizeFreq(firebaseObj && firebaseObj.recurrence);
                const recurrence = freq ? { freq, spawnedTaskId: null } : { freq: '', spawnedTaskId: null };
                const companyId = (project && project.CompanyId) || (task && task.CompanyId);
                const query = {
                    type: SCHEMA_TYPE.TASKS,
                    data: [
                        { _id: new mongoose.Types.ObjectId(task._id) },
                        { $set: { recurrence } },
                        { returnDocument: 'after' },
                    ],
                };
                MongoDbCrudOpration(companyId, query, 'findOneAndUpdate')
                    .then((result) => {
                        const socketEmitter = require('../../../../event/socketEventEmitter');
                        socketEmitter.emit('update', { type: 'update', data: result, updatedFields: { recurrence }, module: 'task' });
                        resolve({ status: true, statusText: 'Recurrence updated successfully', data: result });
                        const { HandleHistory } = require('../mongo_helper');
                        const label = freq === 'week' ? 'weekly' : (freq === 'month' ? 'monthly' : 'does not repeat');
                        HandleHistory('task', companyId, (project && project._id) || task.ProjectID, task._id, {
                            key: 'task_recurrence',
                            message: `<b>${(userData && userData.Employee_Name) || 'Someone'}</b> set due date to <b>${label}</b>.`,
                            sprintId: task.sprintId,
                        }).catch((error) => {
                            logger.error(`ERROR in recurrence history: ${error.message}`);
                        });
                    })
                    .catch((error) => {
                        logger.error(`ERROR in update recurrence: ${error.message}`);
                        reject(error);
                    });
            } catch (error) {
                logger.error(`ERROR in update recurrence: ${error.message}`);
                reject(error);
            }
        });
    },

    maybeSpawnNextOnComplete({ companyId, task, prevStatusType, nextStatusType, projectData, userData }) {
        return new Promise(async (resolve) => {
            try {
                const source = task || {};
                if (!shouldSpawnNext({
                    prevStatusType,
                    nextStatusType,
                    recurrence: source.recurrence,
                })) {
                    return resolve({ spawned: false });
                }
                const result = await this.spawnNextRecurringTask({
                    companyId,
                    task: source,
                    projectData,
                    userData,
                });
                resolve(result);
            } catch (error) {
                logger.error(`ERROR in maybeSpawnNextOnComplete: ${error.message}`);
                resolve({ spawned: false, error: error.message });
            }
        });
    },

    spawnNextRecurringTask({ companyId, task, projectData, userData }) {
        return new Promise(async (resolve) => {
            try {
                const dates = nextOccurrenceDates({
                    startDate: task.startDate,
                    dueDate: task.DueDate,
                    freq: task.recurrence,
                });
                if (!dates) {
                    return resolve({ spawned: false, reason: 'no-dates' });
                }

                let project = projectData;
                if (!project || !Array.isArray(project.taskStatusData) || !project.ProjectCode) {
                    project = await MongoDbCrudOpration(companyId, {
                        type: SCHEMA_TYPE.PROJECTS,
                        data: [{ _id: new mongoose.Types.ObjectId(task.ProjectID) }],
                    }, 'findOne') || projectData || {};
                }

                const data = buildNextOccurrenceTask(task, {
                    dates,
                    openStatus: pickOpenStatus(project),
                    spawnedFromId: task._id,
                });
                data._id = new mongoose.Types.ObjectId();

                const created = await this.create({
                    data,
                    user: userData,
                    projectData: {
                        _id: project._id || task.ProjectID,
                        CompanyId: companyId,
                        ProjectName: project.ProjectName,
                        ProjectCode: project.ProjectCode,
                    },
                    indexObj: {
                        indexName: 'groupByStatusIndex',
                        searchKey: 'statusKey',
                        searchValue: String(data.statusKey || 1),
                    },
                });

                if (!created || !created.status) {
                    return resolve({ spawned: false, reason: created && created.message });
                }

                await MongoDbCrudOpration(companyId, {
                    type: SCHEMA_TYPE.TASKS,
                    data: [
                        { _id: new mongoose.Types.ObjectId(task._id) },
                        { $set: { 'recurrence.spawnedTaskId': String(created.id) } },
                        { returnDocument: 'after' },
                    ],
                }, 'findOneAndUpdate');

                resolve({ spawned: true, id: created.id, count: 1 });
            } catch (error) {
                logger.error(`ERROR in spawnNextRecurringTask: ${error.message}`);
                resolve({ spawned: false, error: error.message });
            }
        });
    },
};
