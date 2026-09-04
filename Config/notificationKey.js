
const Notification_key = {
  //TASK
  COMMENTS_IM_MENTIONS_IN:"comments_I'm_@mentioned_in",
  CREATE_TASK:"task_create",
  TASK_NAME:"task_edit",
  TASK_NOTIFICATION:"task_notification",
  TASK_CREATE:"task_create",
  TASK_EDIT:"task_edit",
  TASK_STATUS:"task_status",
  TASK_ASSIGNEE:"task_assignee",
  TASK_PRIORITY:"task_priority",
  TASK_TYPE:"task_type",
  TASK_DUE_DATE:"task_due_date",
  TASK_DESCRIPTION:"task_description",
  TASK_CHECKLIST:"task_checklist",
  TASK_CHECKLIST_ASSIGN:"task_checklist_assign",
  TASK_CHECKLIST_REMOVE:"task_checklist_remove",
  TASK_ATTACHMENTS:"task_attachments",
  LOGGED_HOURS_NOTIFICATION:"logged_hours_notification",
  AFTER_3_HOURS_TODAY_PENDING_HOURS:"after_3_hours_today_pending_hours",
  TASK_ESTIMATED_HOURS:"task_estimated_hours",

  // PROJECT 
  PROJECT_DESCRIPTION:"project_description",
  PROJECT_CREATE:"project_create",
  PROJECT_NAME:"project_name",
  PROJECT_STATUS_CHANGE:"project_status_change",
  PROJECT_ASSIGNEE:"project_assignee",
  PROJECT_LEAD:"project_lead",
  PROJECT_CATEGORY:"project_category",
  PROJECT_SOURCE:"project_source",
  PROJECT_TYPE:"project_type",
  PROJECT_CURRENCY:"project_currency",
  PROJECT_AMOUNT:"project_amount",
  PROJECT_START_DATE:"project_start_date",
  PROJECT_END_DATE:"project_end_date",
  PROJECT_DUE_DATE:"project_due_date",
  PROJECT_CLOSE:"project_close",
  PROJECT_CHECKLIST:"project_checklist",
  PROJECT_CHECKLIST_ASSIGN:"project_checklist_assign",
  PROJECT_CHECKLIST_REMOVE:"project_checklist_remove",
  PROJECT_ATTACHMENTS:"project_attachments",
  PROJECT_MILESTONE:"project_milestone",
  PROJECT_MILESTONE_STATUS_CHANGE:"project_milestone_status_change",
  PROJECT_SPRINT_CREATE:"project_sprint_create",
  PROJECT_FOLDER_CREATE:"project_folder_create",
}
const TemplateType = {
 CREATE:'create',
 COMMENTS:'comments',
 UPDATES:"updates"
}

const ChangeTypes={
  STATUS:'status',
  DESCRIPTION:"description",
  PRIORITY:"priority",
  NAME:"name",
  PROJECT_CREATE:"project_create",
  PROJECT_STATUS:"project_status",
  PROJECT_CATEGORY:"project_category",
  PROJECT_SOURCE:"project_source",
  PROJECT_TYPE:"project_type",
  CURRENCY:"currency",
  AMOUNT:"amount",
  START_DATE:"start_date",
  END_DATE:"end_date",
  DUE_DATE:"due_date",
  ASSIGNEE:"assignee",
  CHECKLIST: "checklist",
  CHECKLIST_ASSIGN:"checklist_assign",
  CHECKLIST_REMOVE:"checklist_remove",
  ATTACHMENTS:"attachments",
  SPRINT_CREATE:"sprint_create",
  FOLDER_CREATE:"folder_create",
  PROJECT_CLOSE:"project_close"
}

module.exports = {
    Notification_key,
    TemplateType,
    ChangeTypes
};