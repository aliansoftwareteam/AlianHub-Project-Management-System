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
const { updateProjectForTimelog, findAndUpdateProjectOrTaskStartDate, updateRemainingTime } = require('./helpers');
exports.manualLogTime = async (req, res) => {
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
    if (!(req.body && req.body.companyId)) {
        res.send({
            status: false,
            // BUG-028 / #82 fix: was copy-paste error "ProjectId is required".
            statusText: "CompanyId is required"
        })
        return;
    }
    if (!(req.body && req.body.userId)) {
        res.send({
            status: false,
            statusText: "UserId is required"
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
    if (!(req.body && req.body.userName)) {
        res.send({
            status: false,
            statusText: "userName is required"
        });
        return;
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
    // BUG-029 / #83 fix: the existing validation at line 53 only blocks
    // falsy timeDuration. A non-string value (number, array, object) or a
    // string without a colon (e.g. "1") would crash here with a TypeError
    // or silently store NaN in the DB. Validate the shape explicitly.
    if (typeof req.body.timeDuration !== 'string' || !/^\d+:\d+$/.test(req.body.timeDuration)) {
        res.send({
            status: false,
            statusText: "timeDuration must be a string in HH:MM format"
        });
        return;
    }
    const diffArr = req.body.timeDuration.split(':');
    const diffMin = (+diffArr[0]) * 60 + (+diffArr[1]);
    let data = {
        ProjectId: req.body.projectId,
        LogStartTime: getTimeStamp(req.body.timeZone, req.body.logTimeDate, req.body.startLogTime),
        LogEndTime: getTimeStamp(req.body.timeZone, req.body.logTimeDate, req.body.endLogTime),
        LogTimeDuration: diffMin,
        LogDescription: req.body.description,
        Loggeduser: req.body.userId,
        logAddType : 0
    }
    if(req.body.isEdit === false){
        data.TicketID = req.body.ticketId
    }

    if (req.body.isEdit === true) {
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
        MongoDbCrudOpration(req.body.companyId, obj, "findOneAndUpdate")
            .then((response) => {
                let historyObj = {
                    'message': `<b>${req.body.userName}</b> has edited <b>${req.body.timeDuration} hrs (DATE_${new Date(req.body.logTimeDate).getTime()} from TIMESTAMP_${data.LogStartTime * 1000} to TIMESTAMP_${data.LogEndTime * 1000}) </b> logged hours`,
                    'key': 'TimeLog',
                    sprintId: req.body.sprintId
                }
                let userData = {
                    id: req.body.userId
                }
                hlp.HandleHistory("Logtask", req.body.companyId, req.body.projectId, req.body.ticketId, historyObj, userData).then(() => {
                    let notiObj = {
                        userName: req.body.userName,
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
                        id: req.body.userId,
                        companyOwnerId: req.body.companyOwnerId,
                    }
                    HandleBothNotification({
                        type: 'task',
                        companyId: req.body.companyId,
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
                    updateProjectForTimelog(req.body.companyId, req.body.projectId, true, Math.floor(new Date().getTime() / 1000));
                    updateRemainingTime(req.body.companyId,req.body.ticketId);
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
        let obj = {
            type: type,
            data: data
        }
        MongoDbCrudOpration(req.body.companyId, obj, "save")
            .then((response) => {
                findAndUpdateProjectOrTaskStartDate({companyId:req.body.companyId,userId:req.body.userId,projectId:req.body.projectId,taskId:req.body.ticketId,startDateForProjectOrTask:new Date(req.body.logTimeDate)});
                let historyObj = {
                    'message': `<b>${req.body.userName}</b> has added <b>${req.body.timeDuration} hrs (DATE_${new Date(req.body.logTimeDate).getTime()} from TIMESTAMP_${data.LogStartTime * 1000} to TIMESTAMP_${data.LogEndTime * 1000}) </b> logged hours
                `,
                    'key': 'TimeLog',
                    sprintId: req.body.sprintId
                }
                let userData = {
                    id: req.body.userId
                }
                hlp.HandleHistory("Logtask", req.body.companyId, req.body.projectId, req.body.ticketId, historyObj, userData).then(() => {

                    let notiObj = {
                        userName: req.body.userName,
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
                        id: req.body.userId,
                        companyOwnerId: req.body.companyOwnerId,
                    }

                    HandleBothNotification({
                        type: 'task',
                        companyId: req.body.companyId,
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
                    updateProjectForTimelog(req.body.companyId, req.body.projectId, true, Math.floor(new Date().getTime() / 1000));
                    updateRemainingTime(req.body.companyId,req.body.ticketId);
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
    if (!(req.body && req.body.companyId)) {
        res.send({
            status: false,
            statusText: "CompanyId is required"
        })
        return;
    }
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
    if (!(req.body && req.body.userId)) {
        res.send({
            status: false,
            statusText: "userId is required"
        })
        return;
    }
    if (!(req.body && req.body.userName)) {
        res.send({
            status: false,
            statusText: "userName is required"
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
    let companyId = req.body.companyId
    let type = req.body.type || SCHEMA_TYPE.TIMESHEET

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
                'message': `<b>${req.body.userName}</b> has deleted <b>${`${hoursStr}:${minutesStr}`} hrs (DATE_${new Date(req.body.logTimeDate).getTime()} from TIMESTAMP_${req.body.LogStartTime * 1000} to TIMESTAMP_${req.body.LogEndTime * 1000}) </b> logged hours`,
                'key': 'TimeLog',
                sprintId: req.body.sprintId
            }
            let userData = {
                id: req.body.userId
            }
            hlp.HandleHistory("Logtask", req.body.companyId, req.body.projectId, req.body.ticketId, historyObj, userData).then(() => {
                let notiObj = {
                    userName: req.body.userName,
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
                    id: req.body.userId,
                    companyOwnerId: req.body.companyOwnerId,
                }
                HandleBothNotification({
                    type: 'task',
                    companyId: req.body.companyId,
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
                updateProjectForTimelog(req.body.companyId, req.body.projectId, true, Math.floor(new Date().getTime() / 1000));
                updateRemainingTime(req.body.companyId,req.body.ticketId);
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
