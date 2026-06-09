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
const path = require('path');

var brandSettings = null; 
const filePath = path.join(__dirname, '../../../brandSettings.json');

exports.sendFcmNotificationsHandler = async (req, res) => {
    // BUG-024 / #78 fix: was `fs.readFileSync` on every notification request,
    // which blocks the event loop and stalls every other route under load.
    // Switch to the async API so the read doesn't block.
    try {
      if (fs.existsSync(filePath)) {
        const fileContent = await fs.promises.readFile(filePath, 'utf-8');
        brandSettings = fileContent ? JSON.parse(fileContent) : null;
      }
    } catch (err) {
      logger.error(`brandSettings read failed: ${err.message || err}`);
    }
    const { userIdArray, key, companyId, message, type, senderUserDetail, actionUrl } = req.body;

    // Validation
    if (!Array.isArray(userIdArray) || userIdArray.length === 0) {
        return res.status(400).json({ success: false, error: "userIdArray must be a non-empty array" });
    }
    if (!companyId || typeof companyId !== 'string') {
        return res.status(400).json({ success: false, error: "companyId is required and must be a string" });
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
    if (!senderUserDetail || !Object.keys(senderUserDetail).length) {
        return res.status(400).json({ success: false, error: "senderUserId is required and must be a string" });
    }
    if (!actionUrl || typeof actionUrl !== 'string') {
        return res.status(400).json({ success: false, error: "actionUrl is required and must be a string" });
    }

    try {
        // Fetch notification settings and filter eligible users
        const eligibleUserIds = [];
        
        try {
            const notificationSettings = await getNotificationSetttings(userIdArray, companyId);
            if (!notificationSettings || !Array.isArray(notificationSettings)) {
                logger.warn('No notification settings found for users');
            } else {
                notificationSettings.forEach(userSetting => {
                    if (userSetting?.[type]?.items) {
                        const notificationConfig = userSetting[type].items.find(item => item.key === key);
                        
                        if (notificationConfig && Object.keys(notificationConfig).length > 0) {
                            if (notificationConfig.browser || notificationConfig.mobile) {
                                eligibleUserIds.push(userSetting.userId);
                            }
                        }
                    }
                });
            }
        } catch (settingsError) {
            logger.error(`Failed to fetch notification settings: ${settingsError.message}`, {
                stack: settingsError.stack,
                userIdArray,
                companyId
            });
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to fetch notification settings'
            });
            // Continue execution even if settings fetch fails
        }
        
        // If no eligible users, return early
        if (eligibleUserIds.length === 0) {
            return res.json({ 
                success: true, 
                message: 'No eligible users for notification',
                response: { successCount: 0, failureCount: 0 }
            });
        }

        // Get unique receiver IDs and fetch their FCM tokens
        const uniqueReceiverIds = [...new Set(eligibleUserIds)];
        let fcmTokens = [];
        
        try {
            const receiverDetails = await getUsersDetails(uniqueReceiverIds);
            
            if (receiverDetails && Array.isArray(receiverDetails) && receiverDetails.length > 0) {
                receiverDetails.forEach(receiver => {
                    if (receiver?.webTokens && Array.isArray(receiver.webTokens) && receiver.webTokens.length > 0) {
                        fcmTokens = fcmTokens.concat(receiver.webTokens);
                    }
                });
            } else {
                logger.warn('No receiver details found');
            }
        } catch (receiverError) {
            logger.error(`Failed to fetch receiver details: ${receiverError.message}`, {
                stack: receiverError.stack,
                uniqueReceiverIds
            });
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to fetch receiver details for sending notifications'
            });
        }

        // If no tokens found, return early
        if (fcmTokens.length === 0) {
            return res.json({ 
                success: true, 
                message: 'No FCM tokens available for notification',
                response: { successCount: 0, failureCount: 0 }
            });
        }

        // Prepare notification payload
        const senderName = senderUserDetail?.Employee_Name ? `${senderUserDetail.Employee_Name}`: (brandSettings?.productName || 'Alian-Hub');
        
        const notificationPayload = {
            title: `${senderName} - Chat Notification`,
            body: changeText(message),
            click_action: `${config.WEBURL}/#/${actionUrl}`,
            // icon: Image,  // Commented out: adding user image in FCM notification was not working
            domainURL: process.env.APIURL,
            key: key === "comments_I'm_@mentioned_in" ? "mentions" : "notifications",
        };

        // Send FCM notification
        let fcmResult;
        
        try {
            fcmResult = await sendFCMNotification({ 
                notification: notificationPayload, 
                tokens: fcmTokens 
            });
        } catch (fcmError) {
            logger.error(`Failed to send FCM notification: ${fcmError.message}`, {
                stack: fcmError.stack,
                tokenCount: fcmTokens.length
            });
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to send FCM notification'
            });
        }

        return res.json({ success: true, response: fcmResult });
        
    } catch (error) {
        logger.error(`sendFcmNotificationsHandler unexpected error: ${error.message}`, {
            stack: error.stack,
            body: req.body
        });
        return res.status(500).json({ 
            success: false, 
            error: 'An unexpected error occurred while processing notification request'
        });
    }
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

