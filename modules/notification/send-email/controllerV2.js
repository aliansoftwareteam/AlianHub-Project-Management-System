const logger = require("../../../Config/loggerConfig.js");
const config = require("../../../Config/config.js");
const sendMail = require("../../service.js");
const sendEmailNotification = require("../../template/sendEmailNotification.js")
const moment = require('moment')
const { Notification_key, TemplateType } = require("../../../Config/notificationKey.js");
const { removeDocument, UpdateDocument } = require("../notification-middleware/push-controllerV2.js")
exports.sendEmailHandlerSingle = (EmailDetails) => {
  return new Promise(async (resolve, reject) => {
    try {
      let email = [EmailDetails.notification.Employee_Email]
      var action_url = await actionForOpenTask(EmailDetails.notification)
      this.manageEmailData(EmailDetails).then(async response => {
        let mail = await sendEmailNotification({ bodyData: { ...response, action_url: action_url }, type: EmailDetails.notification.key, isSingle: false, defaultMessage: EmailDetails.notification.message, action_url: action_url });
        await sendMail.SendNotificationEmail(`${config.APP_NAME} - ${"Update: Stay Informed About Recent Changes"}`, mail, email, true, (result) => {
          if (!result.status) {
            logger.error(`send Email Handler Single Not Send`)
            reject({ message: result.error,status:false })
          } else {
            removeDocument(EmailDetails.notification)
            UpdateDocument(EmailDetails.notification)
            resolve(true)
          }
        })
      })

    } catch (error) {
      reject({ message: error.message })
    }
  })

}
exports.sendEmailHandlerSingleApi = (req, res) => {
  return new Promise(async (resolve, reject) => {
    try {
      var EmailDetails = req.body
      let email = [EmailDetails.notification.Employee_Email]
      var action_url = await actionForOpenTask(EmailDetails.notification)
      this.manageEmailData(EmailDetails).then(async response => {
        let mail = await sendEmailNotification({ bodyData: { ...response, action_url: action_url }, type: EmailDetails.notification.key, isSingle: false, defaultMessage: EmailDetails.notification.message, action_url: action_url });
        await sendMail.SendNotificationEmail(`${config.APP_NAME} - ${"Update: Stay Informed About Recent Changes"}`, mail, email, true, (result) => {
          if (!result.status) {
            logger.error(`send Email Handler Single Not Send`)
            reject({ message: error.message })
          } else {
            removeDocument(EmailDetails.notification)
            UpdateDocument(EmailDetails.notification)
            resolve(true)
          }
        })
      })

    } catch (error) {
       reject({ message: error.message })
    }
  })

}
exports.sendEmailHandlerMultiple = (EmailDetails) => {
  return new Promise((resolve, reject) => {
    let email = [EmailDetails.user.Employee_Email]
    // let mail = sendEmailNotification({bodyData:EmailDetails.emailData.map(item=>item.Type=="project"?item?.ProjectId:item?.TaskId),type:EmailDetails.Type});
    // await sendMail.SendNotificationEmail(`${config.APP_NAME}- ${"Update: Stay Informed About Recent Changes"}`, mail, email, true, (result) => {
    //     console.log("resultresultresultresult", result)
    //     if (!result.status) {
    //         reject({ error: "Email Not send" })
    //     } else {
    //         resolve(true)
    //     }
    // })
  })

}


exports.manageEmailData = (EmailDetails) => {
  return new Promise(async (resolve,reject) => {
    try {
      var header = await manageHeader(EmailDetails)
      var body = await manageEmailTemplateBody(EmailDetails)
      resolve({ templateHeader: header, templateBody: body })
    } catch (error) {
       reject({ message: error.message })
    }
  })

}


function manageHeader(EmailDetails) {
  return new Promise((resolve,reject) => {
    try {
      var headerTitle = ""
      var headerDescription = []
      if (EmailDetails.notification.type == 'tasks') {
        if (EmailDetails.projects.length > 0 && checkNeedDescription(EmailDetails.notification.key)) {
          headerTitle = EmailDetails.projects[0].ProjectName
        }
        if (checkNeedDescription(EmailDetails.notification.key)) {
          headerDescription.push({ title: EmailDetails.projects[0].ProjectName, showFolder: false })
          if (EmailDetails.tasks.length > 0) {
            if ("folderName" in EmailDetails.tasks[0].sprintArray) {
              headerDescription.push({ title: EmailDetails.tasks[0].sprintArray.folderName, showFolder: true })
              headerDescription.push({ title: EmailDetails.tasks[0].sprintArray.name, showFolder: false })
              headerDescription.push({ title: EmailDetails.tasks[0].TaskKey, showFolder: false })
            } else {

              headerDescription.push({ title: EmailDetails.tasks[0].sprintArray.name, showFolder: false })
              headerDescription.push({ title: EmailDetails.tasks[0].TaskKey, showFolder: false })
            }

          }
        }
      }
      else if (EmailDetails.notification.type == 'project') {
        if (EmailDetails.projects.length > 0) {
          headerTitle = EmailDetails.projects[0].ProjectName
        }
      }
      else if (EmailDetails.notification.type == 'before') {
        //use in future functionality
      }
      resolve({ title: headerTitle, description: headerDescription })
    } catch (error) {
       reject({ message: error.message })
    }
  })

}

function manageEmailTemplateBody(EmailDetails) {
  return new Promise(async (resolve,reject) => {
    try {
      var requireField = checkRequiredDetails(EmailDetails.notification.key)
      var body = []
      var name = EmailDetails.notification.User_Employee_Name
      var profile = EmailDetails.notification.User_Employee_profileImage
      var notificationType=  EmailDetails?.notification?.type
      var date = EmailDetails.notification?.createdAt ? moment(new Date(EmailDetails.notification?.createdAt)).calendar(null, {
        lastDay: 'DD-MM-YYYY HH:MM A [IST]',
        sameDay: 'DD-MM-YYYY HH:MM A [IST]',
        nextDay: 'DD-MM-YYYY HH:MM A [IST]',
        lastWeek: 'DD-MM-YYYY HH:MM A [IST]',
        nextWeek: 'DD-MM-YYYY HH:MM A [IST]',
        sameElse: 'DD-MM-YYYY HH:MM A [IST]'
      }) : "N/A"
      if (requireField.includes(TemplateType.CREATE)) {

        var createObj = []

        if (EmailDetails?.tasks?.length > 0) {
          EmailDetails.tasks.map((item => {
            var sprintsData = {}
            if ("folderName" in item.sprintArray) {
              sprintsData.folder = item.sprintArray.folderName
              sprintsData.list = item.sprintArray.name
            }
            else {
              sprintsData.list = item.sprintArray.name
            }
            createObj.push({
              name: name,
              profile: profile,
              date: date,
              taskValue: item?.TaskName,
              taskLabel: item?.isParentTask ? "Task" : !item?.isParentTask ? "Sub Task" : "",
              ...sprintsData,
              notificationType
            })
          }))
        }
        if (EmailDetails?.projects?.length > 0) {
          EmailDetails.projects.map(item => {
            createObj.push({
              name: name,
              profile: profile,
              date: date,
              changeType: EmailDetails.notification?.changeType || "",
              changeData:{ ...EmailDetails.notification?.changeData,notificationType }|| {}
            })
          })

        }
        body.push({ key: TemplateType.CREATE, data: createObj })
      }
      if (requireField.includes(TemplateType.COMMENTS)) {

        var createObj = []
        if (EmailDetails?.comments?.length > 0) {
          EmailDetails.comments.map(item => {
            createObj.push({
              name: name,
              profile: profile,
              date: date,
              message: item.comment_message
            })
          })

        }
        body.push({ key: TemplateType.COMMENTS, data: createObj })
      }
      if (requireField.includes(TemplateType.UPDATES)) {
        var createObj = []
        if (EmailDetails?.tasks?.length > 0) {
          EmailDetails.tasks.map(item => {
            createObj.push({
              name: name,
              profile: profile,
              date: date,
              changeType: EmailDetails.notification?.changeType || "",
              changeData:{...EmailDetails.notification?.changeData,notificationType} || {}
            })
          })

        } 
        if (EmailDetails?.projects?.length > 0) {
          EmailDetails.projects.map(item => {
            createObj.push({
              name: name,
              profile: profile,
              date: date,
              changeType: EmailDetails.notification?.changeType || "",
              changeData:{ ...EmailDetails.notification?.changeData,notificationType }|| {}
            })
          })

        }

        body.push({ key: TemplateType.UPDATES, data: createObj })
      }
      resolve(body)
    } catch (error) {
      reject({ message: error.message })
    }
  })
}

function checkRequiredDetails(type) {
  switch (type) {
    case Notification_key.CREATE_TASK:
      return [TemplateType.CREATE]
    case Notification_key.COMMENTS_IM_MENTIONS_IN:
      return [TemplateType.COMMENTS]
    case Notification_key.TASK_STATUS:
      return [TemplateType.UPDATES]
    case Notification_key.TASK_NAME:
      return [TemplateType.UPDATES]
    case Notification_key.TASK_DESCRIPTION:
      return [TemplateType.UPDATES]
    case Notification_key.TASK_PRIORITY:
      return [TemplateType.UPDATES]
    case Notification_key.PROJECT_DESCRIPTION:
      return [TemplateType.UPDATES]
    case Notification_key.PROJECT_CREATE:
      return [TemplateType.CREATE]  
    case Notification_key.PROJECT_NAME:
      return [TemplateType.UPDATES]  
    case Notification_key.PROJECT_STATUS_CHANGE:
      return [TemplateType.UPDATES]  
    case Notification_key.PROJECT_ASSIGNEE:
      return [TemplateType.UPDATES]
    case Notification_key.PROJECT_LEAD:
      return [TemplateType.UPDATES]  
    case Notification_key.PROJECT_CATEGORY:
      return [TemplateType.UPDATES]
    case Notification_key.PROJECT_SOURCE:
      return [TemplateType.UPDATES]
    case Notification_key.PROJECT_TYPE:
      return [TemplateType.UPDATES]  
    case Notification_key.PROJECT_CURRENCY:
      return [TemplateType.UPDATES] 
    case Notification_key.PROJECT_AMOUNT:
      return [TemplateType.UPDATES]  
    case Notification_key.PROJECT_START_DATE:
      return [TemplateType.UPDATES]    
    case Notification_key.PROJECT_END_DATE:
      return [TemplateType.UPDATES] 
    case Notification_key.PROJECT_DUE_DATE:
      return [TemplateType.UPDATES] 
    case Notification_key.PROJECT_CLOSE:
      return [TemplateType.UPDATES] 
    case Notification_key.PROJECT_CHECKLIST:
      return [TemplateType.UPDATES] 
    case Notification_key.PROJECT_CHECKLIST_ASSIGN:
      return [TemplateType.UPDATES] 
    case Notification_key.PROJECT_CHECKLIST_REMOVE:
      return [TemplateType.UPDATES] 
    case Notification_key.PROJECT_ATTACHMENTS:
      return [TemplateType.UPDATES]
    case Notification_key.PROJECT_MILESTONE:
      return [TemplateType.UPDATES]
    case Notification_key.PROJECT_MILESTONE_STATUS_CHANGE:
      return [TemplateType.UPDATES]
    case Notification_key.PROJECT_SPRINT_CREATE:
      return [TemplateType.CREATE]
    case Notification_key.PROJECT_FOLDER_CREATE:
      return [TemplateType.CREATE]
    case Notification_key.PROJECT_CLOSE:
      return [TemplateType.UPDATES]
    default:
      return []
  }
}

function checkNeedDescription(type) {
  switch (type) {
    case Notification_key.CREATE_TASK:
      return true
    case Notification_key.COMMENTS_IM_MENTIONS_IN:
      return true
    case Notification_key.TASK_STATUS:
      return true
    case Notification_key.TASK_NAME:
      return true
    case Notification_key.TASK_DESCRIPTION:
      return true
    case Notification_key.TASK_PRIORITY:
      return true
    case Notification_key.PROJECT_DESCRIPTION:
      return true
    case Notification_key.PROJECT_CREATE:
      return true  
    case Notification_key.PROJECT_NAME:
      return true
    case Notification_key.PROJECT_STATUS_CHANGE:
      return true
    case Notification_key.PROJECT_ASSIGNEE:
      return true
    case Notification_key.PROJECT_LEAD:
      return true
    case Notification_key.PROJECT_CATEGORY:
      return true
    case Notification_key.PROJECT_SOURCE:
      return true
    case Notification_key.PROJECT_TYPE:
      return true
    case Notification_key.PROJECT_CURRENCY:
      return true
    case Notification_key.PROJECT_AMOUNT:
      return true
    case Notification_key.PROJECT_START_DATE:
      return true   
    case Notification_key.PROJECT_END_DATE:
      return true
    case Notification_key.PROJECT_DUE_DATE:
      return true 
    case Notification_key.PROJECT_CLOSE:
      return true
    case Notification_key.PROJECT_CHECKLIST:
      return true 
    case Notification_key.PROJECT_CHECKLIST_ASSIGN:
      return true
    case Notification_key.PROJECT_CHECKLIST_REMOVE:
      return true 
    case Notification_key.PROJECT_ATTACHMENTS:
      return true
    case Notification_key.PROJECT_MILESTONE:
      return true
    case Notification_key.PROJECT_MILESTONE_STATUS_CHANGE:
      return true
    case Notification_key.PROJECT_SPRINT_CREATE:
      return true
    case Notification_key.PROJECT_FOLDER_CREATE:
      return true
    default:
      return false
  }
}


function actionForOpenTask(body) {
  let actionUrl = "";
  var { folderId = "", sprintId = "", projectId = "", companyId = '', taskId = "" } = body
  if (body.type.toLowerCase() === "project") {
    if (folderId !== undefined && folderId !== null && folderId !== '') {
      if (sprintId !== undefined && sprintId !== null && sprintId !== '') {
        actionUrl = `${body.companyId}/project/${projectId}/fs/${folderId}/${sprintId}`
      } else {
        actionUrl = `${body.companyId}/project/${projectId}/f/${folderId}`
      }
    } else if (sprintId !== undefined && sprintId !== null && sprintId !== '') {
      actionUrl = `${body.companyId}/project/${projectId}/s/${sprintId}`
    } else {
      actionUrl = `${body.companyId}/project/${projectId}/p?tab=ProjectDetail`
    }
  } else {
    if (folderId !== undefined && folderId !== null && folderId !== '') {
      actionUrl = `${body.companyId}/project/${projectId}/fs/${folderId}/${sprintId}/${taskId}${body.key === "logged_hours_notification" ? '?tab=ProjectListView&taskTab=TimeLog' : body.key === "comments_I'm_@mentioned_in" ? '?tab=ProjectListView&taskTab=comment' : ''}`
    } else {
      actionUrl = `${body.companyId}/project/${projectId}/s/${sprintId}/${taskId}${body.key === "logged_hours_notification" ? '?tab=ProjectListView&taskTab=TimeLog' : body.key === "comments_I'm_@mentioned_in" ? '?tab=ProjectListView&taskTab=comment' : ''}`
    }
  }

  return `${config.WEBURL}/#/${actionUrl}`
}