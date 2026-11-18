
const mainTemplate = require('./emailTemplate/main-template')
const commonTemplate = require('./emailTemplate/commonTemplate')
const { Notification_key, TemplateType } = require("../../Config/notificationKey");
const sendEmailNotification = async ({ bodyData = { templateHeader: {},description:[],action_url:"" }, type = '', isSingle = false ,defaultMessage="",}) => {
    return checkTemplateType(bodyData, type, isSingle,defaultMessage)
}

function checkTemplateType(bodyData, type, isSingle,defaultMessage) {
    switch (type) {
        case Notification_key.CREATE_TASK:
            return createTaskEmailTemplate(bodyData)
        case Notification_key.COMMENTS_IM_MENTIONS_IN:
            return commentsEmailTemplate(bodyData)
        case Notification_key.TASK_STATUS:
            return changeStatusEmailTemplate(bodyData)
        case Notification_key.TASK_NAME:
            return changeNameEmailTemplate(bodyData)
       case Notification_key.TASK_DESCRIPTION:
            return changeDescriptionEmailTemplate(bodyData)    
        case Notification_key.TASK_PRIORITY:
            return changePriorityEmailTemplate(bodyData)   
        case Notification_key.PROJECT_DESCRIPTION:
            return changePriorityEmailTemplate(bodyData)
        case Notification_key.PROJECT_CREATE:
            return changeDescriptionEmailTemplate(bodyData)
        case Notification_key.PROJECT_NAME:
            return changeDescriptionEmailTemplate(bodyData)
        case Notification_key.PROJECT_STATUS_CHANGE:
            return changeDescriptionEmailTemplate(bodyData)
        case Notification_key.PROJECT_ASSIGNEE:
            return changeDescriptionEmailTemplate(bodyData)
        case Notification_key.PROJECT_LEAD:
            return changeDescriptionEmailTemplate(bodyData)  
        case Notification_key.PROJECT_CATEGORY:
            return changeDescriptionEmailTemplate(bodyData)
        case Notification_key.PROJECT_SOURCE:
            return changeDescriptionEmailTemplate(bodyData)
        case Notification_key.PROJECT_TYPE:
            return changeDescriptionEmailTemplate(bodyData)  
        case Notification_key.PROJECT_CURRENCY:
            return changeDescriptionEmailTemplate(bodyData) 
        case Notification_key.PROJECT_AMOUNT:
            return changeDescriptionEmailTemplate(bodyData) 
        case Notification_key.PROJECT_START_DATE:
            return changeDescriptionEmailTemplate(bodyData) 
        case Notification_key.PROJECT_END_DATE:
            return changeDescriptionEmailTemplate(bodyData) 
        case Notification_key.PROJECT_DUE_DATE:
            return changeDescriptionEmailTemplate(bodyData) 
        case Notification_key.PROJECT_CLOSE:
            return changeDescriptionEmailTemplate(bodyData) 
        case Notification_key.PROJECT_MILESTONE:
            return changeDescriptionEmailTemplate(bodyData) 
        case Notification_key.PROJECT_MILESTONE_STATUS_CHANGE:
            return changeDescriptionEmailTemplate(bodyData) 
        case Notification_key.PROJECT_SPRINT_CREATE:
            return changeDescriptionEmailTemplate(bodyData) 
        case Notification_key.PROJECT_FOLDER_CREATE:
            return changeDescriptionEmailTemplate(bodyData) 
        default:
            return commonMessageTemplate(defaultMessage)
            // return `<div>${defaultMessage}</div>`
    }

}
const createTaskEmailTemplate = (bodyData) => {
    return mainTemplate.renderHTML(bodyData)
}
const commentsEmailTemplate = (bodyData) => {
    return mainTemplate.renderHTML(bodyData)
}

const changeStatusEmailTemplate = (bodyData) => {
    return mainTemplate.renderHTML(bodyData)
}

const changeNameEmailTemplate = (bodyData) => {
    return mainTemplate.renderHTML(bodyData)
}
const changeDescriptionEmailTemplate = (bodyData) => {
    return mainTemplate.renderHTML(bodyData)
}
const changePriorityEmailTemplate = (bodyData) => {
    return mainTemplate.renderHTML(bodyData)
}
const commonMessageTemplate = (defaultMessage) => {
    return commonTemplate.notificationCommonTemplate(defaultMessage)
}
module.exports = sendEmailNotification