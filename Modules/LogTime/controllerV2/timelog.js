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
