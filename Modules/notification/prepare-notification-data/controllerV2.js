
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
const { pinSessionTenant } = require('../../../Config/tenant');
const { activeMemberIds } = require('../activeMembers');
const { reasonFor } = require('../../Inbox/helpers/inboxRules');
const { wakeOnActivity } = require('../../Inbox/helpers/inboxState');
const { canReadProject } = require('../../../Config/projectAccess');
const mongoose = require('mongoose');
const { commentThreadAccess } = require('../../Comments/helpers/threadAccess');

const REQUEST_TEXT_FIELDS = ['key', 'type', 'message', 'projectId', 'taskId', 'sprintId', 'folderId', 'changeType', 'comments_id'];

const requestFields = (body) => Object.fromEntries(REQUEST_TEXT_FIELDS
    .filter((field) => typeof body[field] === 'string')
    .map((field) => [field, body[field]]));

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/* A person's words are kept as text: nothing in them opens a tag. Quotes and brackets stay as typed, since a
 * notice is also read where markup is not, on a phone's lock screen and in a mail subject. */
const asText = (words) => words.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* The thread a request names, with the list read from the stored task: a row is read later by the place it names. */
const threadNamedBy = async (companyId, fields) => {
    const thread = { projectId: fields.projectId, sprintId: fields.sprintId, taskId: fields.taskId };
    if (!OBJECT_ID.test(String(fields.taskId || ''))) return thread;
    const task = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: new mongoose.Types.ObjectId(fields.taskId) }, { sprintId: 1 }] }, 'findOne');
    return task && task.sprintId ? { ...thread, sprintId: String(task.sprintId) } : thread;
};

const opensThread = async (companyId, uid, thread) => (await commentThreadAccess(companyId, uid, thread)).allowed === true;

/* Those of `userIds` who can open the thread: the project, and the list or task the notice names. */
const readersOf = async (companyId, thread, userIds) => {
    const readable = await Promise.all(userIds.map((uid) => opensThread(companyId, uid, thread)));
    return userIds.filter((uid, index) => readable[index]);
};



// The tenant, sender and recipients are pinned here rather than in handleNotificationtFun: every
// other caller of that is an internal one passing a synthetic { body } it built from trusted data.
// A request is about a project, and a list or task of it, that its sender can open, and reaches the members who can
// open it too; it carries the fields a notice is written from and none of the ones the server fills in, and its
// words are kept as text.
exports.handleNotification = async (req, res) => {
  const companyId = pinSessionTenant(req, res);
  if (!companyId) return;
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const fields = requestFields(body);
    const notFound = () => res.status(404).json({ status: false, message: 'Project not found.' });
    if (!(await canReadProject(companyId, req.uid, fields.projectId)).allowed) return notFound();
    const thread = await threadNamedBy(companyId, fields);
    if (!(await opensThread(companyId, String(req.uid), thread))) return notFound();
    const claimed = (Array.isArray(body.assigneeUsers) ? body.assigneeUsers : []).filter((id) => typeof id === 'string');
    const leader = typeof body.task_leader_ID === 'string' ? body.task_leader_ID : '';
    const members = await activeMemberIds(companyId, [...claimed, leader]);
    const readers = new Set(await readersOf(companyId, thread, members));
    const assigneeUsers = [...new Set(claimed)].filter((id) => readers.has(id));
    req.body = {
      ...fields,
      ...(thread.sprintId ? { sprintId: thread.sprintId } : {}),
      ...(typeof fields.message === 'string' ? { message: asText(fields.message) } : {}),
      changeData: body.changeData && typeof body.changeData === 'object' && !Array.isArray(body.changeData) ? body.changeData : {},
      companyId,
      userId: String(req.uid),
      assigneeUsers,
      notSeen: assigneeUsers,
      isSelected: false,
      task_leader_ID: readers.has(leader) ? leader : '',
    };
    res.json(await exports.handleNotificationtFun(req));
  } catch (error) {
    res.json(error);
  }
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
      if (!(req.body && req.body.companyId)) { // tenant-scoping: internal callers pass a payload built from trusted data, and handleNotification pins the HTTP one to the session
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
      const { directUsers, ...rowBody } = notificationBody
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
                finalNotificationData.push({ ...rowBody, receiverID: item, reason: reasonFor(item, directUsers), notificationType: 'push', isSchedule: false, uniqueId })
              }
              if (settings.email) {
                if (notificationBody.key != "message_create") {
                  finalNotificationData.push({ ...rowBody, receiverID: item, reason: reasonFor(item, directUsers), notificationType: 'email', isSchedule: false, uniqueId })
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
        if (objects.notificationType === 'push' && objects.taskId) {
          wakeOnActivity(objects.companyId, objects.receiverID, objects.taskId)
            .catch((error) => logger.error(`Inbox wake on new activity failed: ${error.message}`))
        }
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

