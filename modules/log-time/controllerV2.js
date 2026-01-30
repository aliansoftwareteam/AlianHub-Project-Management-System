const { DateTime } = require('luxon');
const hlp = require("../tasks/helpers/helper");
const notiTemp = require("../tasks/helpers/notificationTemplate")
const { HandleBothNotification } = require("../tasks/helpers/handleNotification");
const moment = require("moment");
const logger = require("../../Config/loggerConfig");
const { SCHEMA_TYPE } = require("../../Config/schemaType")
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose")

const fs = require("fs");
const { updateUserFun } = require('../users-module/controller');
const { myCache } = require('../../Config/config');
const { updateProjectInternal } = require('../project/controller/update-project.js');
const loggerConfig = require('../../Config/loggerConfig');
const socketEmitter = require('../../event/socketEventEmitter.js');
const { handleFileUploadForTrackerSS,handleuploadMainFileForbase64Thumbnail } = require(`../../common-storage/common-${process.env.STORAGE_TYPE}.js`);
/**
 * Add and Edit Manual Log Time
 * @param {Objcet} req
 * @param {Object} res
 * @returns
 */
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
            statusText: "ProjectId is required"
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
    let diffArr = req.body.timeDuration.split(':');
    let diffMin = (+diffArr[0]) * 60 + (+diffArr[1]);
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
                    exports.updateProjectForTimelog(req.body.companyId, req.body.projectId, true, Math.floor(new Date().getTime() / 1000));
                    exports.updateRemainingTime(req.body.companyId,req.body.ticketId);
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
                exports.findAndUpdateProjectOrTaskStartDate({companyId:req.body.companyId,userId:req.body.userId,projectId:req.body.projectId,taskId:req.body.ticketId,startDateForProjectOrTask:new Date(req.body.logTimeDate)});
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
                    exports.updateProjectForTimelog(req.body.companyId, req.body.projectId, true, Math.floor(new Date().getTime() / 1000));
                    exports.updateRemainingTime(req.body.companyId,req.body.ticketId);
                    res.send({
                        status: true,
                        statusText: "Logtime added successfully",
                        data: response
                    })
                }).catch((error) => {
                    logger.error(`TimeSheet===========>Error ${error.message}`);
                    console.log("error=========>",error)
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
            let date = moment(new Date(req.body.logTimeDate)).format("YYYY-MM-DD");
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
                exports.updateProjectForTimelog(req.body.companyId, req.body.projectId, true, Math.floor(new Date().getTime() / 1000));
                exports.updateRemainingTime(req.body.companyId,req.body.ticketId);
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
exports.timeTrackerStart = (req, res) => {
    if (!(req.body && req.body.description)) {
        res.send({
            status: false,
            statusText: `description is required`
        });
        return;
    }
    if (!(req.body && req.body.userId)) {
        res.send({
            status: false,
            statusText: `UserId is required`
        })
        return;
    }
    if (!(req.body && req.body.projectId)) {
        res.send({
            status: false,
            statusText: `ProjectId is required`
        })
        return;
    }
    if (!(req.body && req.body.taskId)) {
        res.send({
            status: false,
            statusText: `TaskId is required`
        })
        return;
    }
    if (!(req.body && req.body.companyId)) {
        res.send({
            status: false,
            statusText: `CompanyId is required`
        })
        return;
    }
    const utcDateTime = DateTime.utc();
    const timeStamp = Math.floor(utcDateTime.toSeconds());
    let companyId = req.body.companyId
    let type = req.body.type || SCHEMA_TYPE.TIMESHEET
    let data = {
        CreatedAt: utcDateTime.ts,
        UpdatedAt: utcDateTime.ts,
        LogDescription: req.body.description,
        Loggeduser: req.body.userId,
        TicketID: req.body.taskId,
        ProjectId: req.body.projectId,
        LogStartTime: timeStamp,
        LogEndTime: timeStamp,
        LogTimeDuration: 0,
        logAddType: 1,
        trackShots: [],
        startTimeTracker: timeStamp,
    }
    let obj = {
        type: type,
        data: data
    }
    MongoDbCrudOpration(req.body.companyId, obj, "save")
        .then((response) => {
            exports.updateProjectForTimelog(req.body.companyId, req.body.projectId, false, timeStamp, req.body.userId, req.body.taskId, response.id, true)
            exports.updateRemainingTime(req.body.companyId,req.body.taskId);
            res.send({
                status: true,
                statusText: response.id
            })
            // res.send(response)
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
exports.timeTrackerStart2 = (req, res) => {
    if (!(req.body && req.body.description)) {
        res.send({
            status: false,
            statusText: `description is required`
        });
        return;
    }
    if (!(req.body && req.body.userId)) {
        res.send({
            status: false,
            statusText: `UserId is required`
        })
        return;
    }
    if (!(req.body && req.body.projectId)) {
        res.send({
            status: false,
            statusText: `ProjectId is required`
        })
        return;
    }
    if (!(req.body && req.body.taskId)) {
        res.send({
            status: false,
            statusText: `TaskId is required`
        })
        return;
    }
    if (!(req.body && req.body.companyId)) {
        res.send({
            status: false,
            statusText: `CompanyId is required`
        })
        return;
    }
    const utcDateTime = DateTime.utc();
    const timeStamp = Math.floor(utcDateTime.toSeconds());
    // console.log(req.body.considerActionTime,"req.body.considerActionTime",req.body.actionTime);
    
    let companyId = req.body.companyId
    let type = req.body.type || SCHEMA_TYPE.TIMESHEET
    let data = {
        CreatedAt: utcDateTime.ts,
        UpdatedAt: utcDateTime.ts,
        LogDescription: req.body.description,
        Loggeduser: req.body.userId,
        TicketID: req.body.taskId,
        ProjectId: req.body.projectId,
        LogStartTime: req.body.considerActionTime ? req.body.actionTime : timeStamp,
        LogEndTime: req.body.considerActionTime ? req.body.actionTime : timeStamp,
        LogTimeDuration: 0,
        logAddType: 1,
        trackShots: [],
        startTimeTracker: req.body.considerActionTime ? req.body.actionTime : timeStamp,
    }
    let object = {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [
            {
                userId: req.body.userId
            },
            {
                isTrackerUser: 1,
                _id: 0
            }
        ]
    }
    MongoDbCrudOpration(req.body.companyId, object,"findOne").then((cUser)=>{
        if (cUser.isTrackerUser) {            
            let obj = {
                type: type,
                data: data
            }
            MongoDbCrudOpration(req.body.companyId, obj, "save")
                .then((response) => {
                    exports.updateProjectForTimelog(req.body.companyId, req.body.projectId, false, timeStamp, req.body.userId, req.body.taskId, response.id, true)
                    exports.findAndUpdateProjectOrTaskStartDate({companyId:req.body.companyId,userId:req.body.userId,projectId:req.body.projectId,taskId:req.body.taskId,startDateForProjectOrTask:new Date()});
                    exports.updateRemainingTime(req.body.companyId,req.body.taskId);
                    res.send({
                        status: true,
                        statusText: response.id
                    })
                    // res.send(response)
                })
                .catch((err) => {
                    logger.error(`TimeSheet===========>Error ${err.message}`);
                    res.send({ status: false, message: err.message })
                });
        } else {
            res.send({
                status: false,
                isPermissionDenied: true,
                message: 'Permisson Denied'
            })
        }
    }).catch((error)=>{
        res.send({
            status: false,
            message: error.message ? error.message : error
        })
    })
}

/**
 * End time tracker API
 * @param {Objcet} req
 * @param {Object} res
 * @returns
 */
exports.endTimeTracker = (req, res) => {
    if (!(req.body && req.body.timeSheetId)) {
        res.send({
            status: false,
            statusText: "timeSheetId is required"
        })
        return;
    }
    if (!(req.body && req.body.companyId)) {
        res.send({
            status: false,
            statusText: "companyId is required"
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
    if (!(req.body && req.body.userId)) {
        res.send({
            status: false,
            statusText: "userId is required"
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
    if (!(req.body && req.body.taskId)) {
        res.send({
            status: false,
            statusText: "taskId is required"
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
    if (!(req.body && req.body.companyOwnerId)) {
        res.send({
            status: false,
            statusText: "companyOwnerId is required"
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
    if (!(req.body && req.body.timeZone)) {
        res.send({
            status: false,
            statusText: "timeZone is required"
        })
        return;
    }
    if (!(req.body && req.body.strokes)) {
        res.send({
            status: false,
            statusText: "strokes is required"
        })
        return;
    }
    const utcDateTime = DateTime.utc();
    const timeStamp = Math.floor(utcDateTime.toSeconds());
    let companyId = req.body.companyId
    let type =  req.body.type||SCHEMA_TYPE.TIMESHEET
    const calculateDuration = (startTimestamp, endTimestamp) => {
        const timeDifference = endTimestamp - startTimestamp;
        const durationMinutes = timeDifference / 60;
        return Math.round(durationMinutes);
    }
    let objGet = {
        type: type,
        data: [{
            _id: {
                $in:[req.body.timeSheetId]
            },
         }]
    }
    MongoDbCrudOpration(req.body.companyId, objGet, "findOne")
        .then((response) => {
            let trackShots = [];
            let trttt = response.trackShots||[];
            if (response.trackShots && response.trackShots.length) {
                let strok = response.trackShots[response.trackShots.length - 1].strokes
                trackShots = strok.concat(req.body.strokes);
                trttt[response.trackShots.length - 1].strokes = trackShots
            }
            let data = {
                updatedAt: utcDateTime.ts,
                LogEndTime: req.body.considerActionTime ? req.body.actionTime : timeStamp,
                LogTimeDuration: calculateDuration(response.LogStartTime, req.body.considerActionTime ? req.body.actionTime : timeStamp),
                trackShots: response.trackShots ? trttt : [],
            }
            let obj = {
                type: type,
                data: [{ _id: req.body.timeSheetId },{
                    $set: { ...data },
                    $unset: {
                                    startTimeTracker: 1 // Remove field2 from the document
                                },
                },
                { new: true, useFindAndModify: false }]
            }
            MongoDbCrudOpration(req.body.companyId, obj, "findOneAndUpdate")
                .then((resUp) => {
                    const dt = response.CreatedAt;
                    function convertTimestampToTime(timestamp) {
                        const dateTime = DateTime.fromSeconds(timestamp);
                        const formattedTime = dateTime.toFormat('hh:mm a');
                        return formattedTime;
                    }
                    function convertMinutesToHHMM(minutes) {
                        const hours = Math.floor(minutes / 60);
                        const mins = minutes % 60;
                        const formattedTime = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
                        return formattedTime;
                    }
                    let historyObj = {
                        'message': `<b>${req.body.userName}</b> has added <b>${convertMinutesToHHMM(data.LogTimeDuration)} hrs (${`DATE_${dt}`} from ${`TIMESTAMP_${response.LogStartTime * 1000}`} to ${`TIMESTAMP_${data.LogEndTime * 1000}`}) </b> logged hours`,
                        'key': 'TimeLog',
                        sprintId: req.body.sprintId
                    }
                    let userData = {
                        id: req.body.userId
                    }
                    hlp.HandleHistory("Logtask", req.body.companyId, req.body.projectId, req.body.taskId, historyObj, userData).then((resp) => {
                        let notiObj = {
                            userName: req.body.userName,
                            timeDuration: convertMinutesToHHMM(data.LogTimeDuration),
                            logTimeDate: dt,
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
                            logger.error(`Notification Set Error: ${error}`);
                        })
                        exports.updateProjectForTimelog(req.body.companyId, req.body.projectId, false, req.body.considerActionTime ? req.body.actionTime : timeStamp, req.body.userId, req.body.taskId, req.body.timeSheetId, false)
                        exports.updateRemainingTime(req.body.companyId,req.body.taskId);
                        res.send({
                            status: true,
                            statusText: "Logtime added successfully"
                        })
                    }).catch((error) => {
                        res.send({
                            status: false,
                            statusText: `Error4: ${error}`
                        })
                    })
                })
                .catch((err) => {
                     res.send({ status: false, statusText: "No Data found for given timeSheet id" })
                });

        })
        .catch((err) => {
            res.send({
                status: false,
                statusText: err.message
            });
        });

};

/**
 * Capture TimeTracker API
 * @param {Objcet} req
 * @param {Object} res
 * @returns
 */
exports.captureTimetracker = (req, res) => {
    try {
        if (!(req.body && req.body.file)) {
            res.send({
                status: false,
                statusText: 'screenShot is required'
            });
            return;
        }
        if (!(req.body && req.body.path)) {
            res.send({
                status: false,
                statusText: 'path is required'
            });
            return;
        }
        if (!(req.body && req.body.companyId)) {
            res.send({
                status: false,
                statusText: 'companyId is required'
            });
            return;
        }
        if (!(req.body && req.body.timeSheetId)) {
            res.send({
                status: false,
                statusText: 'timeSheetId is required'
            });
            return;
        }
        if (!(req.body && req.body.key)) {
            res.send({
                status: false,
                statusText: 'key is required'
            });
            return;
        }
        if (!(req.body && req.body.imageName)) {
            res.send({
                status: false,
                statusText: 'imageName is required'
            });
            return;
        }
        if (!req.body || req.body.prevscreenShot == undefined) {
            res.send({
                status: false,
                statusText: 'prevscreenShot is required'
            });
            return;
        }
        if (!(req.body && req.body.memoName)) {
            res.send({
                status: false,
                statusText: 'memoName is required'
            });
            return;
        }
        if (!(req.body && req.body.screenShotTime)) {
            res.send({
                status: false,
                statusText: 'screenShotTime is required'
            });
            return;
        }
        if (!(req.body && req.body.strokes)) {
            res.send({
                status: false,
                statusText: 'strokes is required'
            });
            return;
        }
        const base64String = req.body.file;
        const base64Data = base64String.replace(/^data:image\/png;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const filenames = `file_${Date.now()}.png`;

        fs.writeFile(`wasabiUploads/${filenames}`, buffer, (err) => {
            if (err) {
                return res.send({
                    status: false,
                    statusText: `Error file create:${err}`
                })
            }
            handleuploadMainFileForbase64Thumbnail(req.body.companyId, req.body.path, req.body.file, false, 'trackshot').then((fileName) => {
                fs.unlink(`wasabiUploads/${filenames}`, (err) => {
                    if (err) {
                        logger.error(`Error deleting file: ${err}`);
                    }
                });
                let companyId = req.body.companyId
                let type = req.body.type||SCHEMA_TYPE.TIMESHEET
                let objGet = {
                    type: type,
                    data: [{
                        _id: {
                            $in:[req.body.timeSheetId]
                        },
                     }]
                }
                MongoDbCrudOpration(req.body.companyId, objGet, "findOne")
                    .then((response) => {
                        const utcDateTime = DateTime.utc();
                        const timeStamp = Math.floor(utcDateTime.toSeconds());
                        const calculateDuration = (startTimestamp, endTimestamp) => {
                            const timeDifference = endTimestamp - startTimestamp;
                            const durationMinutes = timeDifference / 60;
                            return Math.round(durationMinutes);
                        }

                        let strokesArray = [];
                        strokesArray = JSON.parse(req.body.strokes)
                        let trackshotObj = {
                            key: req.body.key,
                            name: req.body.imageName,
                            prevscreenShot: req.body.prevscreenShot,
                            screenShotTime: req.body.screenShotTime,
                            image: fileName[0],
                            memoName: req.body.memoName,
                            strokes: strokesArray,
                        }
                        let updateObj = {
                            updatedAt: utcDateTime.ts,
                            LogEndTime: timeStamp,
                            LogTimeDuration: calculateDuration(response.LogStartTime, timeStamp),
                            // trackShots: array,
                            startTimeTracker: timeStamp
                        }
                        let obj = {
                            type: type,
                            data: [{ _id: req.body.timeSheetId },{
                                $set: { ...updateObj },
                                $push: {trackShots:trackshotObj},
                            },
                            { new: true, useFindAndModify: false }]
                        }
                        MongoDbCrudOpration(req.body.companyId, obj, "findOneAndUpdate")
                        .then(updateRes => {
                            exports.updateProjectForTimelog(req.body.companyId, response.ProjectId, false, timeStamp, response.Loggeduser, response.TicketID, req.body.timeSheetId, true)
                            exports.updateRemainingTime(req.body.companyId,response.TicketID);
                            res.send({
                                status: true,
                                statusText: `Data Update Succesfully`
                            });
                        }).catch(err => {
                            logger.error(`TimeSheet===========>Error ${err.message}`);
                            res.send({ status: false, message: err.message })
                        })
                    })
                    .catch((err) => {
                        res.send({
                            status: false,
                            statusText: `No Data found for given timeSheet id`
                        });
                    });

            }).catch((error) => {
                logger.error(`TimeSheet===========>Error ${error.message}`);
                res.send({
                    status: false,
                    statusText: "error"
                })
            })
        });
    } catch (error) {
        logger.error(`TimeSheet===========>Error ${error.message}`);
        res.send({
            status: false,
            statusText: error
        })
    }
}


exports.captureTimetracker2 = (req, res) => {
    try {
        if (!(req.body && req.file)) {
            res.send({
                status: false,
                statusText: 'screenShot is required'
            });
            return;
        }
        if (!(req.body && req.body.path)) {
            res.send({
                status: false,
                statusText: 'path is required'
            });
            return;
        }
        if (!(req.body && req.body.companyId)) {
            res.send({
                status: false,
                statusText: 'companyId is required'
            });
            return;
        }
        if (!(req.body && req.body.timeSheetId)) {
            res.send({
                status: false,
                statusText: 'timeSheetId is required'
            });
            return;
        }
        if (!(req.body && req.body.key)) {
            res.send({
                status: false,
                statusText: 'key is required'
            });
            return;
        }
        if (!(req.body && req.body.imageName)) {
            res.send({
                status: false,
                statusText: 'imageName is required'
            });
            return;
        }
        if (!req.body || req.body.prevscreenShot == undefined) {
            res.send({
                status: false,
                statusText: 'prevscreenShot is required'
            });
            return;
        }
        if (!(req.body && req.body.memoName)) {
            res.send({
                status: false,
                statusText: 'memoName is required'
            });
            return;
        }
        if (!(req.body && req.body.screenShotTime)) {
            res.send({
                status: false,
                statusText: 'screenShotTime is required'
            });
            return;
        }
        if (!(req.body && req.body.strokes)) {
            res.send({
                status: false,
                statusText: 'strokes is required'
            });
            return;
        }
            handleFileUploadForTrackerSS(req.body.companyId, req.body.path, req.file.path, false ,req.file,  'trackshot').then((fileName) => {
                let type = req.body.type||SCHEMA_TYPE.TIMESHEET
                let objGet = {
                    type: type,
                    data: [{
                        _id: {
                            $in:[req.body.timeSheetId]
                        },
                     }]
                }
                MongoDbCrudOpration(req.body.companyId, objGet, "findOne")
                    .then((response) => {
                        const utcDateTime = DateTime.utc();
                        const timeStamp = Math.floor(utcDateTime.toSeconds());
                        const calculateDuration = (startTimestamp, endTimestamp) => {
                            const timeDifference = endTimestamp - startTimestamp;
                            const durationMinutes = timeDifference / 60;
                            return Math.round(durationMinutes);
                        }

                        let strokesArray = [];
                        strokesArray = JSON.parse(req.body.strokes)
                        let trackshotObj = {
                            key: req.body.key,
                            name: req.body.imageName,
                            prevscreenShot: req.body.prevscreenShot,
                            screenShotTime: req.body.screenShotTime,
                            image: fileName[0],
                            memoName: req.body.memoName,
                            strokes: strokesArray,
                        }
                        let updateObj = {
                            updatedAt: utcDateTime.ts,
                            LogEndTime: timeStamp,
                            LogTimeDuration: calculateDuration(response.LogStartTime, timeStamp),
                            startTimeTracker: timeStamp
                        }
                        let obj = {
                            type: type,
                            data: [{ _id: req.body.timeSheetId },{
                                $set: { ...updateObj },
                                $push: {trackShots:trackshotObj},
                            },
                            { new: true, useFindAndModify: false }]
                        }
                        MongoDbCrudOpration(req.body.companyId, obj, "findOneAndUpdate")
                        .then(() => {
                            exports.updateProjectForTimelog(req.body.companyId, response.ProjectId, false, timeStamp, response.Loggeduser, response.TicketID, req.body.timeSheetId, true)
                            exports.updateRemainingTime(req.body.companyId,response.TicketID);
                            res.send({
                                status: true,
                                statusText: `Data Update Succesfully`
                            });
                        }).catch(err => {
                            res.send({ status: false, message: err.message })
                        })
                    })
                    .catch((err) => {
                        res.send({
                            status: false,
                            statusText: `Error: ${err}`
                        });
                    });

            }).catch((error) => {
                res.send({
                    status: false,
                    statusText: error
                })
            })
        // });
    } catch (error) {
        res.send({
            status: false,
            statusText: error
        })
    }
}


exports.captureTimetracker3 = (req, res) => {
    try {
        if (!(req.body && req.file)) {
            res.send({
                status: false,
                statusText: 'screenShot is required'
            });
            return;
        }
        if (!(req.body && req.body.path)) {
            res.send({
                status: false,
                statusText: 'path is required'
            });
            return;
        }
        if (!(req.body && req.body.companyId)) {
            res.send({
                status: false,
                statusText: 'companyId is required'
            });
            return;
        }
        if (!(req.body && req.body.timeSheetId)) {
            res.send({
                status: false,
                statusText: 'timeSheetId is required'
            });
            return;
        }
        if (!(req.body && req.body.key)) {
            res.send({
                status: false,
                statusText: 'key is required'
            });
            return;
        }
        if (!(req.body && req.body.imageName)) {
            res.send({
                status: false,
                statusText: 'imageName is required'
            });
            return;
        }
        if (!req.body || req.body.prevscreenShot == undefined) {
            res.send({
                status: false,
                statusText: 'prevscreenShot is required'
            });
            return;
        }
        if (!(req.body && req.body.memoName)) {
            res.send({
                status: false,
                statusText: 'memoName is required'
            });
            return;
        }
        if (!(req.body && req.body.screenShotTime)) {
            res.send({
                status: false,
                statusText: 'screenShotTime is required'
            });
            return;
        }
        if (!(req.body && req.body.strokes)) {
            res.send({
                status: false,
                statusText: 'strokes is required'
            });
            return;
        }
            handleFileUploadForTrackerSS(req.body.companyId, req.body.path, req.file.path, false ,req.file,  'trackshot').then((fileName) => {
                let type = req.body.type||SCHEMA_TYPE.TIMESHEET
                let objGet = {
                    type: type,
                    data: [{
                        _id: {
                            $in:[req.body.timeSheetId]
                        },
                     }]
                }
                MongoDbCrudOpration(req.body.companyId, objGet, "findOne")
                    .then((response) => {
                        let object = {
                            type: SCHEMA_TYPE.COMPANY_USERS,
                            data: [
                                {
                                    userId: response.Loggeduser
                                },
                                {
                                    isTrackerUser: 1,
                                    _id: 0
                                }
                            ]
                        }
                        MongoDbCrudOpration(req.body.companyId, object,"findOne").then((cUser)=>{
                            if (cUser.isTrackerUser) {    
                                const utcDateTime = DateTime.utc();
                                const timeStamp = Math.floor(utcDateTime.toSeconds());
                                const calculateDuration = (startTimestamp, endTimestamp) => {
                                    const timeDifference = endTimestamp - startTimestamp;
                                    const durationMinutes = timeDifference / 60;
                                    return Math.round(durationMinutes);
                                }
        
                                let strokesArray = [];
                                strokesArray = JSON.parse(req.body.strokes)
                                let trackshotObj = {
                                    key: req.body.key,
                                    name: req.body.imageName,
                                    prevscreenShot: req.body.prevscreenShot,
                                    screenShotTime: req.body.screenShotTime,
                                    image: fileName[0],
                                    memoName: req.body.memoName,
                                    strokes: strokesArray,
                                }
                                let updateObj = {
                                    updatedAt: utcDateTime.ts,
                                    LogEndTime: req.body.considerActionTime ? req.body.actionTime : timeStamp,
                                    LogTimeDuration: calculateDuration(response.LogStartTime, req.body.considerActionTime ? req.body.actionTime : timeStamp),
                                    startTimeTracker: req.body.considerActionTime ? req.body.actionTime : timeStamp
                                }
                                let obj = {
                                    type: type,
                                    data: [{ _id: req.body.timeSheetId },{
                                        $set: { ...updateObj },
                                        $push: {trackShots:trackshotObj},
                                    },
                                    { new: true, useFindAndModify: false }]
                                }
                                MongoDbCrudOpration(req.body.companyId, obj, "findOneAndUpdate")
                                .then(() => {
                                    exports.updateProjectForTimelog(req.body.companyId, response.ProjectId, false, timeStamp, response.Loggeduser, response.TicketID, req.body.timeSheetId, true)
                                    exports.updateRemainingTime(req.body.companyId,response.TicketID);
                                    res.send({
                                        status: true,
                                        statusText: `Data Update Succesfully`
                                    });
                                }).catch(err => {
                                    res.send({ status: false, message: err.message })
                                })
                            } else {
                                res.send({
                                    status: false,
                                    isPermissionDenied: true,
                                    message: 'Permisson Denied'
                                })
                            }
                        }).catch((error)=>{
                            res.send({
                                status: false,
                                message: error.message ? error.message : error
                            })
                        })
                    })
                    .catch((err) => {
                        res.send({
                            status: false,
                            statusText: `Error: ${err}`
                        });
                    });

            }).catch((error) => {
                res.send({
                    status: false,
                    statusText: error
                })
            })
        // });
    } catch (error) {
        res.send({
            status: false,
            statusText: error
        })
    }
}


/**
 * End time tracker API
 * @param {Objcet} req
 * @param {Object} res
 * @returns
 */
exports.getTimelog = (req, res) => {

    if (!(req.body && req.body.companyId)) {
        res.send({
            status: false,
            statusText: "companyId is required"
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
    const { type = SCHEMA_TYPE.TIMESHEET, companyId } = req.body;
    var startDate = new Date(); // Create a new Date object

    // Set hours, minutes, and seconds to zero
    startDate.setHours(0);
    startDate.setMinutes(0);
    startDate.setSeconds(0);
    startDate.setMilliseconds(0);
    var endDate = new Date(); // Create a new Date object

    // Set hours, minutes, and seconds to zero
    endDate.setHours(23);
    endDate.setMinutes(59);
    endDate.setSeconds(59);
    endDate.setMilliseconds(59);
    if (req.body && req.body.startDate) {
        startDate = new Date(req.body.startDate);
    }
    if (req.body && req.body.endDate) {
        endDate = new Date(req.body.endDate);
    }

    let obj = {
        type: type,
        data: [{
            Loggeduser: {
                $in: req.body.userId
            },
            createdAt: {
                $gte: startDate.getTime(), // Greater than or equal to start date
                $lte: endDate.getTime(),   // Less than or equal to end date
            }
        }]
    }
    MongoDbCrudOpration(req.body.companyId, obj, "find")
        .then((data) => {
            res.send({
                status: true,
                data: data
            })
        })
        .catch(error => {
            res.send({
                status: false,
                statusText: error.message
            })
        })
};

/**
 * Function For Update Field In project or task Collection
 * @param {Objcet} companyId
 * @param {Objcet} projectId
 * @param {Object} userId
 * @param {Object} taskId
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