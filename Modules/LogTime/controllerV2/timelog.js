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
const { pinSessionTenant } = require('../../../Config/tenant');
const { trackerUser } = require('./sessionUser');

exports.getTimelog = async (req, res) => {
    const companyId = pinSessionTenant(req, res);
    if (!companyId) return;
    const actor = await trackerUser(req, res);
    if (!actor) return;
    const { type = SCHEMA_TYPE.TIMESHEET } = req.body;
    var startDate = new Date();
    startDate.setHours(0);
    startDate.setMinutes(0);
    startDate.setSeconds(0);
    startDate.setMilliseconds(0);
    var endDate = new Date();
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
            Loggeduser: actor.id,
            createdAt: {
                $gte: startDate.getTime(),
                $lte: endDate.getTime(),
            }
        }]
    }
    MongoDbCrudOpration(companyId, obj, "find")
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
