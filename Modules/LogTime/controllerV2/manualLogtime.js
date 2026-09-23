const { DateTime } = require('luxon');
const hlp = require("../../Tasks/helpers/helper");
const notiTemp = require("../../Tasks/helpers/notificationTemplate")
const { HandleBothNotification } = require("../../Tasks/helpers/handleNotification");
const { formatDate } = require("../../../utils/dateHelpers");
const logger = require("../../../Config/loggerConfig");
const { SCHEMA_TYPE } = require("../../../Config/schemaType")
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose")
const { updateProjectForTimelog, findAndUpdateProjectOrTaskStartDate, updateRemainingTime } = require('./helpers');
const { isPeriodLocked, PERIOD_LOCKED } = require('../../TimesheetApproval/helpers/lockGuard');
const { pinSessionTenant } = require('../../../Config/tenant');
const { resolveSheetScope, SHEET_PERMISSION } = require('../../TimeSheet/helpers/timeScope');
const { actingUser } = require('../../Sprints/helpers/actingUser');
const { escapeHtml } = require('../../../utils/escapeHtml');

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const NOT_YOUR_TIME = "You can't log or change time for this person.";
const SIGNED_IN_REQUIRED = 'A signed-in user is required.';
const NEW_ENTRY_LOCKED = "This timesheet period is approved and locked — time can't be added to it.";

/* Another person's time is writable only where the timesheet screens would show it to the
 * caller, the same test timesheet.read applies to reading it. */
const mayWriteTimeOf = async (companyId, uid, entries) => {
    const others = entries.filter((entry) => entry && entry.person && String(entry.person) !== uid);
    if (!others.length) return true;
    if (others.some(({ person }) => !OBJECT_ID.test(String(person)))) return false;
    const sheet = await resolveSheetScope(companyId, uid, SHEET_PERMISSION.user);
    return sheet.everyone && others.every(({ projectId }) => sheet.visible === null || sheet.visible.includes(String(projectId)));
};

const refuse = (res, status, statusText) => res.status(status).send({ status: false, statusText, message: statusText });

const findEntry = (companyId, type, timeSheetId) => (OBJECT_ID.test(String(timeSheetId || ''))
    ? MongoDbCrudOpration(companyId, { type, data: [{ _id: new mongoose.Types.ObjectId(String(timeSheetId)) }] }, "findOne")
    : Promise.resolve(null));

const entryDay = (entry) => new Date((Number(entry.LogStartTime) || 0) * 1000);

exports.manualLogTime = async (req, res) => {
    const companyId = pinSessionTenant(req, res);
    if (!companyId) return;
    if (!(req.body && req.body.logTimeDate)) {
        res.send({
            status: false,
            statusText: "Logdate is required"
        });
        return;
    }
    if (!(req.body && req.body.description)) {
        res.send({
            status: false,
            statusText: "Description is required"
        })
        return;
    }
    if (!(req.body && req.body.endLogTime)) {
        res.send({
            status: false,
            statusText: "Endlogtime is required"
        })
        return;
    }
    if (!(req.body && req.body.startLogTime)) {
        res.send({
            status: false,
            statusText: "StartLogtime is required"
        })
        return;
    }
    if (!(req.body && req.body.timeDuration)) {
        res.send({
            status: false,
            statusText: "TimeDuration is required"
        })
        return;
    }
    if (!(req.body && req.body.ticketId)) {
        res.send({
            status: false,
            statusText: "TickerId is required"
        })
        return;
    }
    if (!(req.body && req.body.projectId)) {
        res.send({
            status: false,
            statusText: "ProjectId is required"
        })
        return;
    }
    if ((!req.body || req.body.isEdit === undefined || typeof req.body.isEdit !== "boolean")) {
        res.send({
            status: false,
            statusText: "Isedit is required"
        })
        return;
    }

    if (req.body.isEdit === true) {
        if (!(req.body && req.body.timeSheetId)) {
            res.send({
                status: false,
                statusText: "TimesheetId is required"
            })
            return;
        }
        if (!(req.body && req.body.previousLoggedTime)) {
            res.send({
                status: false,
                statusText: "previousLoggedTime is required"
            })
            return;
        }
    }
    if (!(req.body && req.body.dateFormat)) {
        res.send({
            status: false,
            statusText: "DateFormat is required"
        });
        return;
    }
    if (!(req.body && req.body.taskName)) {
        res.send({
            status: false,
            statusText: "taskName is required"
        });
        return;
    }
    if (!(req.body && req.body.projectName)) {
        res.send({
            status: false,
            statusText: "projectName is required"
        });
        return;
    }
    if (!(req.body && req.body.sprintId)) {
        res.send({
            status: false,
            statusText: "sprintId is required"
        });
        return;
    }
    if (!(req.body && req.body.companyOwnerId)) {
        res.send({
            status: false,
            statusText: "companyOwnerId is required"
        });
        return;
    }
    if (!(req.body && req.body.timeZone)) {
        res.send({
            status: false,
            statusText: "timeZone is required"
        });
        return;
    }
    const { type = SCHEMA_TYPE.TIMESHEET } = req.body;
    if (typeof req.body.timeDuration !== 'string' || !/^\d+:\d+$/.test(req.body.timeDuration)) {
        res.send({
            status: false,
            statusText: "timeDuration must be a string in HH:MM format"
        });
        return;
    }
    const actor = await actingUser(req);
    if (!actor) return refuse(res, 401, SIGNED_IN_REQUIRED);
    const uid = actor.id;
    const storedEntry = req.body.isEdit === true ? await findEntry(companyId, type, req.body.timeSheetId) : null;
    const owner = String(req.body.userId || (storedEntry && storedEntry.Loggeduser) || uid);
    const allowed = await mayWriteTimeOf(companyId, uid, [
        { person: owner, projectId: req.body.projectId },
        storedEntry && { person: storedEntry.Loggeduser, projectId: storedEntry.ProjectId },
    ]);
    if (!allowed) {
        logger.warn(`manualLogtime refused: ${uid} for ${owner} in ${companyId}`);
        return refuse(res, 403, NOT_YOUR_TIME);
    }
    const diffArr = req.body.timeDuration.split(':');
    const diffMin = (+diffArr[0]) * 60 + (+diffArr[1]);
    let data = {
        ProjectId: req.body.projectId,
        LogStartTime: getTimeStamp(req.body.timeZone, req.body.logTimeDate, req.body.startLogTime),
        LogEndTime: getTimeStamp(req.body.timeZone, req.body.logTimeDate, req.body.endLogTime),
        LogTimeDuration: diffMin,
        LogDescription: req.body.description,
        Loggeduser: owner,
        logAddType : 0,
        billable: req.body.billable !== false
    }
    if(req.body.isEdit === false){
        data.TicketID = req.body.ticketId
    }

    if (req.body.isEdit === true) {
       if (storedEntry) {
           const locked = await isPeriodLocked({ companyId, userId: storedEntry.Loggeduser || owner, date: entryDay(storedEntry) });
           if (locked) {
               return res.send({ status: false, statusText: "This timesheet period is approved and locked — the entry can't be edited." });
           }
       }
       let obj = {
            type: type,
            data: [
                {
                    _id: new mongoose.Types.ObjectId(req.body.timeSheetId)
                },
                {$set : data},
                {new : true}
            ]
        }
        MongoDbCrudOpration(companyId, obj, "findOneAndUpdate")
            .then((response) => {
                let historyObj = {
                    'message': `<b>${escapeHtml(actor.Employee_Name)}</b> has edited <b>${req.body.timeDuration} hrs (DATE_${new Date(req.body.logTimeDate).getTime()} from TIMESTAMP_${data.LogStartTime * 1000} to TIMESTAMP_${data.LogEndTime * 1000}) </b> logged hours`,
                    'key': 'TimeLog',
                    sprintId: req.body.sprintId
                }
                let userData = {
                    id: uid
                }
                hlp.HandleHistory("Logtask", companyId, req.body.projectId, req.body.ticketId, historyObj, userData).then(() => {
                    let notiObj = {
                        userName: actor.Employee_Name,
                        timeDuration: req.body.timeDuration,
                        logTimeDate: req.body.logTimeDate,
                        TaskName: req.body.taskName,
                        ProjectName: req.body.projectName,
                        previousLoggedTime: req.body.previousLoggedTime,
                    }
                    let notificationObject = {
                        key: "logged_hours_notification",
                        message: notiTemp.loggedHoursUpdated(notiObj),
                    };
                    let userDataNoti = {
                        id: uid,
                        companyOwnerId: req.body.companyOwnerId,
                    }
                    HandleBothNotification({
                        type: 'task',
                        companyId,
                        projectId: req.body.projectId,
                        taskId: req.body.taskId,
                        folderId: req.body.folderId ? req.body.folderId : "",
                        sprintId: req.body.sprintId,
                        object: notificationObject,
                        userData: userDataNoti
                    })
                        .catch((error) => {
                            logger.error(`Notification Set Error: ${error}`);
                        })
                    updateProjectForTimelog(companyId, req.body.projectId, true, Math.floor(new Date().getTime() / 1000));
                    updateRemainingTime(companyId,req.body.ticketId);
                    res.send({
                        status: true,
                        statusText: "Logtime added successfully",
                        data : response
                    })
                }).catch((error) => {
                    logger.error(`TimeSheet===========>Error ${error.message}`);
                    res.send({
                        status: false,
                        statusText: `Error4: ${error}`
                    })
                })

            })
            .catch((err) => {
                logger.error(`TimeSheet===========>Error ${err.message}`);
                res.send({ status: false, message: err.message })
            });
    } else {
        if (await isPeriodLocked({ companyId, userId: owner, date: entryDay(data) })) {
            return res.send({ status: false, statusText: NEW_ENTRY_LOCKED, code: PERIOD_LOCKED });
        }
        let obj = {
            type: type,
            data: data
        }
        MongoDbCrudOpration(companyId, obj, "save")
            .then((response) => {
                findAndUpdateProjectOrTaskStartDate({companyId,userId:owner,projectId:req.body.projectId,taskId:req.body.ticketId,startDateForProjectOrTask:new Date(req.body.logTimeDate)});
                let historyObj = {
                    'message': `<b>${escapeHtml(actor.Employee_Name)}</b> has added <b>${req.body.timeDuration} hrs (DATE_${new Date(req.body.logTimeDate).getTime()} from TIMESTAMP_${data.LogStartTime * 1000} to TIMESTAMP_${data.LogEndTime * 1000}) </b> logged hours
                `,
                    'key': 'TimeLog',
                    sprintId: req.body.sprintId
                }
                let userData = {
                    id: uid
                }
                hlp.HandleHistory("Logtask", companyId, req.body.projectId, req.body.ticketId, historyObj, userData).then(() => {

                    let notiObj = {
                        userName: actor.Employee_Name,
                        timeDuration: req.body.timeDuration,
                        logTimeDate: req.body.logTimeDate,
                        TaskName: req.body.taskName,
                        ProjectName: req.body.projectName
                    }

                    let notificationObject = {
                        key: "logged_hours_notification",
                        message: notiTemp.loggedHours(notiObj),
                    };

                    let userDataNoti = {
                        id: uid,
                        companyOwnerId: req.body.companyOwnerId,
                    }

                    HandleBothNotification({
                        type: 'task',
                        companyId,
                        projectId: req.body.projectId,
                        taskId: req.body.taskId,
                        folderId: req.body.folderId ? req.body.folderId : "",
                        sprintId: req.body.sprintId,
                        object: notificationObject,
                        userData: userDataNoti
                    }).catch((error) => {
                        logger.error(`TimeSheet===========>Error ${error.message}`);
                        logger.error(`Notification Set Error: ${error}`);

                    })
                    updateProjectForTimelog(companyId, req.body.projectId, true, Math.floor(new Date().getTime() / 1000));
                    updateRemainingTime(companyId,req.body.ticketId);
                    res.send({
                        status: true,
                        statusText: "Logtime added successfully",
                        data: response
                    })
                }).catch((error) => {
                    logger.error(`TimeSheet===========>Error ${error.message}`);
                    logger.error(`error: ${error}`);
                    res.send({
                        status: false,
                        statusText: `Error4 1: ${error}`
                    })
                })
            })
            .catch((err) => {
                logger.error(`TimeSheet===========>Error ${err.message}`);
                res.send({ status: false, message: err.message })
            });
    }


};
const getTimeStamp = (timezone, date, time) => {
    const dateTimeString = `${date} ${time}:00 ${timezone}`;
    const dateTime = DateTime.fromFormat(dateTimeString, 'yyyy-MM-dd HH:mm:ss z', { setZone: true });
    const utcTimestamp = Math.floor(dateTime.toSeconds());
    return utcTimestamp;
}
/**
 * Function For Update Field In project Collection
 * @param {Objcet} companyId
 * @param {Objcet} projectId
 * @param {Object} isOnlyTimestampUpdate
 * @param {Object} timestamp
 * @param {Object} userId
 * @param {Object} taskId
 * @param {Object} timesheetId
 * @returns
 */

exports.deleteManualLogtime = async (req, res) => {
    const companyId = pinSessionTenant(req, res);
    if (!companyId) return;
    if (!(req.body && req.body.timeSheetId)) {
        res.send({
            status: false,
            statusText: "TimeSheetId is required"
        })
        return;
    }
    if (!(req.body && req.body.logTimeDate)) {
        res.send({
            status: false,
            statusText: "logTimeDate is required"
        })
        return;
    }
    if (!(req.body && req.body.dateFormat)) {
        res.send({
            status: false,
            statusText: "dateFormat is required"
        })
        return;
    }
    if (!req.body && req.body.timeDuration === undefined) {
        res.send({
            status: false,
            statusText: "timeDuration is required"
        })
        return;
    }
    if (!(req.body && req.body.startLogTime)) {
        res.send({
            status: false,
            statusText: "startLogTime is required"
        })
        return;
    }
    if (!(req.body && req.body.endLogTime)) {
        res.send({
            status: false,
            statusText: "endLogTime is required"
        })
        return;
    }
    if (!(req.body && req.body.projectId)) {
        res.send({
            status: false,
            statusText: "projectId is required"
        })
        return;
    }
    if (!(req.body && req.body.ticketId)) {
        res.send({
            status: false,
            statusText: "ticketId is required"
        })
        return;
    }
    if (!(req.body && req.body.sprintId)) {
        res.send({
            status: false,
            statusText: "sprintId is required"
        })
        return;
    }
    if (!(req.body && req.body.companyOwnerId)) {
        res.send({
            status: false,
            statusText: "companyOwnerId is required"
        })
        return;
    }
    if (!(req.body && req.body.taskName)) {
        res.send({
            status: false,
            statusText: "taskName is required"
        })
        return;
    }
    if (!(req.body && req.body.projectName)) {
        res.send({
            status: false,
            statusText: "projectName is required"
        })
        return;
    }
    let type = req.body.type || SCHEMA_TYPE.TIMESHEET

    const actor = await actingUser(req);
    if (!actor) return refuse(res, 401, SIGNED_IN_REQUIRED);
    const uid = actor.id;
    const storedEntry = await findEntry(companyId, type, req.body.timeSheetId);
    const owner = String(req.body.userId || (storedEntry && storedEntry.Loggeduser) || uid);
    const allowed = await mayWriteTimeOf(companyId, uid, [
        { person: owner, projectId: req.body.projectId },
        storedEntry && { person: storedEntry.Loggeduser, projectId: storedEntry.ProjectId },
    ]);
    if (!allowed) {
        logger.warn(`deleteManualLogtime refused: ${uid} for ${owner} in ${companyId}`);
        return refuse(res, 403, NOT_YOUR_TIME);
    }

    if (storedEntry) {
        const locked = await isPeriodLocked({ companyId, userId: storedEntry.Loggeduser || owner, date: entryDay(storedEntry) });
        if (locked) {
            return res.send({ status: false, statusText: "This timesheet period is approved and locked — the entry can't be deleted." });
        }
    }

    let obj = {
        type: type,
        data: [
            {
                _id: new mongoose.Types.ObjectId(req.body.timeSheetId)
            }
        ]
    }
    MongoDbCrudOpration(companyId, obj, "deleteOne")
        .then((response) => {
            let date = formatDate(new Date(req.body.logTimeDate), 'yyyy-LL-dd');
            const hours = Math.floor(req.body.timeDuration / 60);
            const remainingMinutes = req.body.timeDuration % 60;
            const hoursStr = String(hours).padStart(2, '0');
            const minutesStr = String(remainingMinutes).padStart(2, '0');
            let historyObj = {
                'message': `<b>${escapeHtml(actor.Employee_Name)}</b> has deleted <b>${`${hoursStr}:${minutesStr}`} hrs (DATE_${new Date(req.body.logTimeDate).getTime()} from TIMESTAMP_${req.body.LogStartTime * 1000} to TIMESTAMP_${req.body.LogEndTime * 1000}) </b> logged hours`,
                'key': 'TimeLog',
                sprintId: req.body.sprintId
            }
            let userData = {
                id: uid
            }
            hlp.HandleHistory("Logtask", companyId, req.body.projectId, req.body.ticketId, historyObj, userData).then(() => {
                let notiObj = {
                    userName: actor.Employee_Name,
                    strtLogTime: req.body.startLogTime,
                    endLogTime: req.body.endLogTime,
                    TaskName: req.body.taskName,
                    ProjectName: req.body.projectName,
                }
                let notificationObject = {
                    key: "logged_hours_notification",
                    message: notiTemp.loggedHoursDeleted(notiObj),
                };
                let userDataNoti = {
                    id: uid,
                    companyOwnerId: req.body.companyOwnerId,
                }
                HandleBothNotification({
                    type: 'task',
                    companyId,
                    projectId: req.body.projectId,
                    taskId: req.body.ticketId,
                    folderId: req.body.folderId ? req.body.folderId : "",
                    sprintId: req.body.sprintId,
                    object: notificationObject,
                    userData: userDataNoti
                })
                    .catch((error) => {
                        logger.error(`Notification Set Error: ${error}`);
                    })
                updateProjectForTimelog(companyId, req.body.projectId, true, Math.floor(new Date().getTime() / 1000));
                updateRemainingTime(companyId,req.body.ticketId);
                res.send({
                    status: true,
                    statusText: "Logtime deleted successfully"
                })
            }).catch((error) => {
                res.send({
                    status: false,
                    statusText: `Error4: ${error}`
                })
            })

        })
        .catch((err) => {
            logger.error(`TimeSheet===========>Error ${err.message}`);
            res.send({ status: false, message: err.message })
        });

}


/**
 * Time Tracker Start API
 * @param {Objcet} req
 * @param {Object} res
 * @returns
 */
