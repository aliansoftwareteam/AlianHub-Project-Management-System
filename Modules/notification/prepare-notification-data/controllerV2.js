
const logger = require("../../../Config/loggerConfig")
const settingctrl = require("./settings-controllerV2");
const userctrl = require("./user-controllerV2");
const { SCHEMA_TYPE } = require("../../../Config/schemaType")
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { dbCollections } = require('../../../Config/collections');
const { updateUnReadCommentsCountFun } = require("../../notification-count/controller");
const { default: axios } = require("axios");
const config =  require('../../../Config/config.js');
const socketEmitter = require('../../../event/socketEventEmitter.js');
const { getUserProfilePresignedUrlCallBackFunction } = require("../../storage/wasabi/controller.js")



exports.handleNotification = (req, res) => {
  exports.handleNotificationtFun(req).then((data) => {
    res.json(data);
  }).catch((error) => {
    res.json(error);
  })
}

exports.handleNotificationtFun = (req) => {
  try {
    return new Promise((resolve, reject) => {
      if (!(req.body && req.body.key)) {
        resolve({
          status: false,
          message: "key is required."
        });
        return;
      }
      if (!(req.body && req.body.companyId)) {
        resolve({
          status: false,
          message: "companyId is required."
        });
        return;
      }
      if (!(req.body && req.body.projectId)) {
        resolve({
          status: false,
          message: "projectId is required."
        });
        return;
      }
      if (!(req.body && req.body.message)) {
        resolve({
          status: false,
          message: "message is required."
        });
        return;
      }
      if (!(req.body && req.body.userId)) {
        resolve({
          status: false,
          message: "userId is required."
        });
        return;
      }
      if (req.body.key === 'tasks') {
        if (!(req.body && req.body.taskId)) {
          resolve({
            status: false,
            message: "taskId is required."
          });
          return;
        }
      }

      resolve({ status: true, message: 'create notification data' })
      var body = {};
      var dataOwner = [];
      if(req.body.key === 'project'){
        body = { ...req.body }
      }else{
        if ("task_leader_ID" in req.body && req.body.task_leader_ID != "") {
          dataOwner.push(req.body.task_leader_ID)
        }
        body = { ...req.body, assigneeUsers: [...new Set(req.body.assigneeUsers.concat([...dataOwner]))] }
      }
      return this.handleSingleNotification(body).then(res => {
        return
      }).catch(error => {
        logger.error(`Prepare Notification Handler of single notification Catch error: ${error.message}`)
        return
      })
    })
  }
  catch (error) {
    logger.error(`Prepare Notification Handler of single notification Catch error Data: ${error.message}`)
    return Promise.reject({status:false, message: error?.message?error?.message:error })
  }
}

exports.handleSingleNotification = (notificationBody) => {
  return new Promise((resolve, reject) => {
    try {
      var assigneeUsers = notificationBody.assigneeUsers?.filter(item => item != notificationBody.userId) || []
      settingctrl.getNotificationSetttings(assigneeUsers, notificationBody.companyId).then(response => {
      
        this.manageNotificationSettings(notificationBody, response).then(responseSetting => {
          resolve(responseSetting)
        }).catch(error => {
          reject({ message: error.message })
        })
      }).catch(error => {
        reject({ message: error.message })
      })
    } catch (error) {
      reject({ message: error.message })
    }
  })
};
function generateUniqueId() {
  const timestamp = new Date().getTime().toString(36);
  const randomString = Math.random().toString(36).substr(2, 5); // 5 random characters
  return timestamp + randomString;
}

exports.manageNotificationSettings = (notificationBody, settingRes) => {
  return new Promise(async(resolve, reject) => {
    try {

      var notificationSetting = []
      var finalNotificationData = []
      var assigneeUsers = notificationBody.assigneeUsers?.filter(item => item != notificationBody.userId) || []
      notificationSetting = [...settingRes]
      if (settingRes.length > 0) {
        var data = [...settingRes.map(item => ({ ...item[notificationBody.type], userId: item.userId })).filter(itm => ({ ...itm.items })).map(items => items.items.map(itemm => ({ ...itemm, userId: items.userId })))].flat(1).filter(item => item.key == notificationBody.key) || []
        if (assigneeUsers.length > 0) {
          assigneeUsers.map(item => {
            var settings = data.find(itm => itm.userId == item) || {}
            if (Object.keys(settings).length > 0) {
              const uniqueId = generateUniqueId();
              if (settings.browser || settings.mobile) {
                finalNotificationData.push({ ...notificationBody, receiverID: item, notificationType: 'push', isSchedule: false, uniqueId })
              }
              if (settings.email) {
                if (notificationBody.key != "message_create") {
                  finalNotificationData.push({ ...notificationBody, receiverID: item, notificationType: 'email', isSchedule: false, uniqueId })
                }
              }
            }
          })
          var receiverIDs = [...new Set(finalNotificationData?.map(item => item.receiverID))]
          var senderIDs = [...new Set(finalNotificationData?.map(item => item.userId))]
          userctrl.getUsersDetails([...new Set(receiverIDs.concat(senderIDs))]).then(async(response) => {
            await Promise.allSettled(finalNotificationData.map(async(item, index) => {
              if (response.length > 0) {
                var userDetails = response.find(itm => itm._id == item.receiverID)
                var senderDetails = response.find(itm => itm._id == item.userId)
                if (receiverIDs.includes(item.receiverID)) {
                  finalNotificationData[index]["Employee_Email"] = userDetails?.Employee_Email || ''
                  finalNotificationData[index]["Employee_Name"] = userDetails?.Employee_Name || ''
                  finalNotificationData[index]["Employee_profileImage"] = await exports.getWasabiImageUrl(item.companyId,userDetails?.Employee_profileImage) || ''
                }
                if (senderIDs.includes(item.userId)) {
                  finalNotificationData[index]["User_Employee_Email"] = senderDetails?.Employee_Email || ''
                  finalNotificationData[index]["User_Employee_Name"] = senderDetails?.Employee_Name || ''
                  finalNotificationData[index]["User_Employee_profileImage"] = await exports.getWasabiImageUrl(item.companyId,senderDetails?.Employee_profileImage) || ''
                }

                finalNotificationData[index]["isSeen"] = false
                finalNotificationData[index]["notificationStatus"] = 'in-process'

                if (item.notificationType == 'push') {
                  finalNotificationData[index]["webTokens"] = userDetails?.webTokens || []
                }
                else {
                  finalNotificationData[index]["User_Employee_Verify"] = senderDetails?.isEmailVerified || false;
                  finalNotificationData[index]["webTokens"] = []
                }
              } else {
                resolve([])
              }
            }));
            this.createNotificationsData(finalNotificationData).then(res => {
              resolve(finalNotificationData)
            }).catch(error => {
              reject({ message: error.message })
            })

          }).catch(error => {
            reject({ message: error.message })
          })

        }
        else {
          resolve([])
        }
      }
      else {
        resolve([])
      }
    } catch (error) {
      resolve([])
    }
  })
};

exports.createNotificationsData = (notificationBody) => {
  return new Promise((resolve, reject) => {
    try {
      if (notificationBody.length === 0) {
        return resolve({});
      }

      const uniqueArray = [...new Set(notificationBody.map(obj => obj.uniqueId))]

      const notificationTypeArray = uniqueArray.map(id => notificationBody.find(obj => obj.uniqueId === id && obj.key !== `comments_I'm_@mentioned_in`)).filter(Boolean);

      const updatePromises = notificationTypeArray && notificationTypeArray.length > 0 ? notificationTypeArray.map(item => exports.updateNotificationCount(item)) : [];
      const createPromises = notificationBody.map(item => exports.createNotificationsBody(item));

      Promise.allSettled([...updatePromises, ...createPromises])
        .then(resolve)
        .catch(error => reject({ message: error.message }));

    } catch (error) {
      reject({ message: error.message });
    }
  });
};

exports.updateNotificationCount = (notificationBody) => {
  try {
    updateUnReadCommentsCountFun({body: {
      "companyId" : notificationBody.companyId,
      "key" : 5,
      "userIds": [notificationBody.receiverID],
      "readAll": false
    }})
    .catch((error) => {
      console.error("ERR: ", error);
    })
  } catch (error) {
    console.error("ERR: ", error);
  }
}

exports.createNotificationsBody = (notificationBody) => {
  delete notificationBody.createdAt
  return new Promise((resolve, reject) => {
    try {
      var objects = notificationBody
      let obj = {
        type: SCHEMA_TYPE.NOTIFICATIONS,
        collection: dbCollections.NOTIFICATIONS,
        data: objects
      }
      MongoDbCrudOpration(objects.companyId, obj, "save").then(response => {
        this.createCommonNotificationsBody({ ...objects, notificationId: response.id })
        resolve(response)
      }).catch(error => {
        reject({ message: error.message })
      })

    } catch (error) {
      reject({ message: error.message })
    }
  })


};
exports.createCommonNotificationsBody = (notificationBody) => {
  return new Promise((resolve, reject) => {
    try {
      var objects = notificationBody
      let obj = {
        type: dbCollections.NOTIFICATIONS,
        collection: dbCollections.NOTIFICATIONS,
        data: objects
      }
      MongoDbCrudOpration(dbCollections.GLOBAL, obj, "save").then(response => {
        socketEmitter.emit('insert', { type: "insert", data: response , updatedFields: {}, module: 'globalNotification' });
        resolve(response)
      }).catch(error => {
        reject({ message: error.message })
      })

    } catch (error) {
      reject({ message: error.message })
    }
  })
};

exports.getWasabiImageUrl = (companyId,path) => {
  return new Promise((resolve) => {
    try {
      const formData = {
        companyId: companyId,
        path: path
      }
      
      getUserProfilePresignedUrlCallBackFunction(formData)
      .then((response) => {
        if (response.status === true) {
          resolve(response.statusText);
        } else {
          resolve('');
        }
      })
      .catch(() => {
        resolve('');
      });
    } catch (error) {
      logger.error(`Error in get wasabi image url : ${error}`)
      resolve('');
    }
  })
}

