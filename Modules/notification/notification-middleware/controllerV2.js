const pushController = require('./push-controllerV2')
const emailController = require('./email-controllerV2')
const { NODE_ENV } = require("../../../Config/config");
const { getCompanyDataFun } = require("../../Company/controller/updateCompany");
const socketEmitter = require('../../../event/socketEventEmitter');

const logger = require('../../../Config/loggerConfig');

const { getNotificationSetttings } = require("../prepare-notification-data/settings-controllerV2");
const { sendFCMNotification } = require("./sendNotification");
const config = require('../../../Config/config');
const { getUsersDetails } = require("../prepare-notification-data/user-controllerV2");
const fs = require('fs');
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { sessionTenantOf, TenantError } = require('../../../Config/tenant');
const { activeMemberIds } = require('../activeMembers');
const path = require('path');

var brandSettings = null; 
const filePath = path.join(__dirname, '../../../brandSettings.json');

const PUSH_ANSWER = { success: true, message: 'Notification processed' };

const senderNameOf = async (uid) => {
    const user = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.USERS, data: [{ _id: new mongoose.Types.ObjectId(String(uid)) }] }, 'findOne');
    return (user && user.Employee_Name) || '';
};

async function pushToMembers(companyId, { userIdArray, key, message, type, actionUrl, senderId }) {
    const recipients = await activeMemberIds(companyId, userIdArray);
    if (!recipients.length) return;

    const settings = await getNotificationSetttings(recipients, companyId);
    const eligible = (Array.isArray(settings) ? settings : []).filter((userSetting) => {
        const setting = userSetting?.[type]?.items?.find((item) => item.key === key);
        return Boolean(setting && (setting.browser || setting.mobile));
    }).map((userSetting) => userSetting.userId);
    if (!eligible.length) return;

    const receivers = await getUsersDetails([...new Set(eligible)]);
    const tokens = (Array.isArray(receivers) ? receivers : []).flatMap((receiver) => (Array.isArray(receiver?.webTokens) ? receiver.webTokens : []));
    if (!tokens.length) return;

    const senderName = (await senderNameOf(senderId)) || brandSettings?.productName || 'Alian-Hub';
    await sendFCMNotification({
        notification: {
            title: `${senderName} - Chat Notification`,
            body: changeText(message),
            click_action: `${config.WEBURL}/#/${actionUrl}`,
            domainURL: process.env.APIURL,
            key: key === "comments_I'm_@mentioned_in" ? "mentions" : "notifications",
        },
        tokens,
    });
}

// Every accepted request gets PUSH_ANSWER, so the reply never tells the caller which of the
// named users are members, have push turned on or hold a device token.
exports.sendFcmNotificationsHandler = async (req, res) => {
    let companyId;
    try {
        companyId = sessionTenantOf(req);
    } catch (error) {
        if (!(error instanceof TenantError)) throw error;
        return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    try {
      if (fs.existsSync(filePath)) {
        const fileContent = await fs.promises.readFile(filePath, 'utf-8');
        brandSettings = fileContent ? JSON.parse(fileContent) : null;
      }
    } catch (err) {
      logger.error(`brandSettings read failed: ${err.message || err}`);
    }
    const { userIdArray, key, message, type, actionUrl } = req.body || {};

    if (!Array.isArray(userIdArray) || userIdArray.length === 0) {
        return res.status(400).json({ success: false, error: "userIdArray must be a non-empty array" });
    }
    if (!message || typeof message !== 'string') {
        return res.status(400).json({ success: false, error: "message is required and must be a string" });
    }
    if (!type || typeof type !== 'string') {
        return res.status(400).json({ success: false, error: "type is required and must be a string" });
    }
    if (!key || typeof key !== 'string') {
        return res.status(400).json({ success: false, error: "key is required and must be a string" });
    }
    if (!actionUrl || typeof actionUrl !== 'string') {
        return res.status(400).json({ success: false, error: "actionUrl is required and must be a string" });
    }

    try {
        await pushToMembers(companyId, { userIdArray, key, message, type, actionUrl, senderId: req.uid });
    } catch (error) {
        logger.error(`sendFcmNotificationsHandler: ${error && error.message ? error.message : error}`);
    }
    return res.json(PUSH_ANSWER);
};


function changeText(msg) {
    const mentionRegex = /@\[[\w ]+?\]\(\w{4,30}\)/gi;
    let mentions = msg.match(mentionRegex);

    if (mentions !== null) {
        mentions.forEach((mention) => {
            msg = msg.replace(mention, `@${mention.split("]")[0].replace("@[", "")}`)
        })
    }
    msg =  msg.replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'");
    return msg;
}

exports.fetchCompanies = () => {
  return new Promise((resolve, reject) => {
    try {
      getCompanyDataFun([],true)
        .then(usersDetails => {
          resolve(usersDetails)
        })
        .catch(error => {
          reject({ message: error.message })
        })
    } catch (error) {
      reject({ message: error.message })
    }
  })
}

exports.fetchNotsifications = () => {
  // SOCKET-PERFORMANCE-PLAN #2: subscribe to the module-scoped event so
  // this listener only wakes up for `globalNotification` inserts, not for
  // every task/comment/companies/userId mutation across the system.
  socketEmitter.on('globalNotification:insert', (value) => {
    getCompanyDataFun([value.data.companyId], false).then((companyData) => {
      let planfeatures = JSON.parse(JSON.stringify(companyData[0]?.planFeature || {}));
      if (value.type === 'insert') {
        this.manageTypeNotification(value.data, planfeatures)
      } else if (value.type === 'update') {
        this.manageTypeNotification(value.data, planfeatures)
      }
    })
  });
}
exports.manageTypeNotification=(notificationData,planFeature)=>{
  notificationData.path = "";
  if(notificationData.notificationType == 'push' && (planFeature?.pushNotification || false)){
    pushController.sendNotificationHandler([notificationData]).catch((error)=>{
      logger.error(`Error In send notification ${error.message}`);
    })
  }
  if(notificationData.notificationType == 'email' && (planFeature?.emailNotification || false)){
    emailController.emailNotificationManage([notificationData]).catch((error)=>{
      logger.error(`Error In send notification ${error.message}`);
    })
  }
}

if(NODE_ENV === "production") {
  this.fetchNotsifications()
}

