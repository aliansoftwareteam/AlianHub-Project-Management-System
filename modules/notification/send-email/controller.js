const moment = require('moment')
const { Notification_key, TemplateType } = require("../../../Config/notificationKey.js");

exports.manageEmailData = (EmailDetails) => {
  return new Promise(async (resolve) => {
    var header = await manageHeader(EmailDetails)
    var body = await manageEmailTemplateBody(EmailDetails)
    resolve({ templateHeader: header, templateBody: body })
  })
}


function manageHeader(EmailDetails) {
  return new Promise(async (resolve) => {
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

  })

}

function manageEmailTemplateBody(EmailDetails) {
  return new Promise(async (resolve) => {
    var requireField = checkRequiredDetails(EmailDetails.notification.key)
    var body = []
    var name = EmailDetails.notification.User_Employee_Name
    var profile = EmailDetails.notification.User_Employee_profileImage
    var date = EmailDetails.notification?.createdAt?.seconds ? moment(new Date(EmailDetails.notification?.createdAt?.seconds * 1000)).calendar(null, {
      lastDay: 'DD-MM-YYYY HH:MM A [IST]',
      sameDay: 'DD-MM-YYYY HH:MM A [IST]',
      nextDay: 'DD-MM-YYYY HH:MM A [IST]',
      lastWeek: 'DD-MM-YYYY HH:MM A [IST]',
      nextWeek: 'DD-MM-YYYY HH:MM A [IST]',
      sameElse: 'DD-MM-YYYY HH:MM A [IST]'
    }) : "N/A"
    if (requireField.includes(TemplateType.CREATE)) {

      var createObj = []

      if (EmailDetails.tasks.length > 0) {
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
            ...sprintsData
          })
        }))
      }
      body.push({ key: TemplateType.CREATE, data: createObj })
    }
    if (requireField.includes(TemplateType.COMMENTS)) {

      var createObj = []
      if (EmailDetails.comments.length > 0) {
        EmailDetails.comments.map(item => {
          createObj.push({
            name: name,
            profile: profile,
            date: date,
            message: item.message
          })
        })

      }
      body.push({ key: TemplateType.COMMENTS, data: createObj })
    }
    if (requireField.includes(TemplateType.UPDATES)) {
      var createObj = []
      if (EmailDetails.tasks.length > 0) {
        EmailDetails.tasks.map(item => {
          createObj.push({
            name: name,
            profile: profile,
            date: date,
            changeType: EmailDetails.notification?.changeType || "",
            changeData: EmailDetails.notification?.changeData || {}
          })
        })

      }
      body.push({ key: TemplateType.UPDATES, data: createObj })
    }
    resolve(body)
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
    default:
      return false
  }
}