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
const { updateProjectForTimelog, updateRemainingTime } = require('./helpers');
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
                            updateProjectForTimelog(req.body.companyId, response.ProjectId, false, timeStamp, response.Loggeduser, response.TicketID, req.body.timeSheetId, true)
                            updateRemainingTime(req.body.companyId,response.TicketID);
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
                            updateProjectForTimelog(req.body.companyId, response.ProjectId, false, timeStamp, response.Loggeduser, response.TicketID, req.body.timeSheetId, true)
                            updateRemainingTime(req.body.companyId,response.TicketID);
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
                                    updateProjectForTimelog(req.body.companyId, response.ProjectId, false, timeStamp, response.Loggeduser, response.TicketID, req.body.timeSheetId, true)
                                    updateRemainingTime(req.body.companyId,response.TicketID);
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
