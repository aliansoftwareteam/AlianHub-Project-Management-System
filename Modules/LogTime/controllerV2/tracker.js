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
            updateProjectForTimelog(req.body.companyId, req.body.projectId, false, timeStamp, req.body.userId, req.body.taskId, response.id, true)
            updateRemainingTime(req.body.companyId,req.body.taskId);
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
                    updateProjectForTimelog(req.body.companyId, req.body.projectId, false, timeStamp, req.body.userId, req.body.taskId, response.id, true)
                    findAndUpdateProjectOrTaskStartDate({companyId:req.body.companyId,userId:req.body.userId,projectId:req.body.projectId,taskId:req.body.taskId,startDateForProjectOrTask:new Date()});
                    updateRemainingTime(req.body.companyId,req.body.taskId);
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
                        updateProjectForTimelog(req.body.companyId, req.body.projectId, false, req.body.considerActionTime ? req.body.actionTime : timeStamp, req.body.userId, req.body.taskId, req.body.timeSheetId, false)
                        updateRemainingTime(req.body.companyId,req.body.taskId);
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
