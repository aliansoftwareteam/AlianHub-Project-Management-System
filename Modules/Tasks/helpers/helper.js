// BUG-042 / #96 — replaced `moment` with luxon. Used only by
// `changeDateFormat`; `formatDate` accepts moment-style tokens via the
// luxon mapping baked into the helper.
const { formatDate } = require('../../../utils/dateHelpers');
const logger = require("../../../Config/loggerConfig");
const { DateTime } = require('luxon');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { taskCheckListEdit, taskCheckList, taskCheckListRemove, taskCheckListChecked, taskCheckListAssignee, taskCheckListAssigneeRemove } = require('./notificationTemplate');
const { default: mongoose } = require("mongoose");
const { insertCustomFieldPromise } = require('../../CustomField/controller');


/* ------------- HANDLE HISTIRY FOR ALL THE ACTIVITIES ------------- */
exports.HandleHistory = (type, companyId, projectId, taskId, object, userData) => {
    return new Promise(async (resolve, reject) => {
        try {
            const obj = {
                'Type': type,
                'Key': object.key,
                'UserId': userData.id,
                'ProjectId': projectId,
                'TaskId': taskId !== null ? taskId : "",
                'Message': object.message
            }
            if (type == "Logtask") {
                obj.Type = "task";
            }
            // BUG-046 / #100 fix: drop the manual `DateTime.utc().ts`
            // (millis) timestamps. Mongoose handles createdAt/updatedAt
            // automatically now that the history schema declares
            // `timestamps: true`.
            const data = {
                'Type': type,
                'Key': object.key,
                'UserId': userData.id,
                'ProjectId': projectId,
                'TaskId': taskId !== null ? taskId : "",
                'Message': object.message,
            }
            let typeSchema = SCHEMA_TYPE.HISTORY
          
            let objSchema = {
                type: typeSchema,
                data: data
            }
            MongoDbCrudOpration(companyId, objSchema, "save")
                .then((response) => {
                    resolve({ status: true });
                }).catch(error => {
                    logger.error(`History========>Error ${error.message}`);
                    reject({ status: false, error: error });
                })
        } catch (error) {
            reject({ status: false, error: error });
        }
    });
}

/* ------------- HANDLE HISTIRY FOR ALL THE ACTIVITIES ------------- */
exports.changeDateFormat = (date, format) => {
    // BUG-042 / #96: luxon-backed helper accepts moment-style tokens
    // (YYYY, MM, DD, …) so callers don't need to change.
    if (date && date.seconds) {
        return formatDate(date.seconds * 1000, format);
    }
    return formatDate(date, format);
}

//Checklist history Object
exports.buildHistoryObject = (ops, params) => {
    let historyObj = {};

    switch (ops) {
        case 'taskchecklistcreate':
            historyObj = {
                key: 'Task_Checklist',
                message: `In <b>${params.projectName}</b> Project, <b>${params.taskName}</b> Created a new Check List named <b>${params.value}</b>.`
            };
            break;
        case 'checklistadd':
            historyObj = {
                key: 'Task_Checklist',
                message: `<b>${params.Employee_Name}</b> has created new checklist item <b class="text-ellipsis vertical-middle d-inline-block" style="max-width:150px" title="${params.name}">${params.name}</b>`
            };
            break;
        case 'checklistedit':
            historyObj = {
                key: 'CheckList_Changed',
                message: `<b>${params.Employee_Name}</b> has changed checklist item name from <b>${params.previousName}</b> to <b>${params.newName}</b>`
            };
            break;
        case 'checklistremove':
            historyObj = {
                key: "Task_Checklist",
                message: `<b>${params.Employee_Name}</b> has removed checklist item <b class="text-ellipsis vertical-middle d-inline-block" style="max-width:150px" title="${params.extractedData.name}">${params.extractedData.name}</b> and its subitems <b class="text-ellipsis vertical-middle d-inline-block" style="max-width:150px" title="${params.extractedData.subItemNames.slice(1).join('\n')}">${params.extractedData.subItemNames.slice(1).join('\n')}</b>`
            };
            break;

        case 'checklistchecked':
            historyObj = {
                key: "CheckList_Checked",
                message: `<b>${params.Employee_Name}</b> has <b>${params.isChecked ? 'checked' : 'unchecked'}</b> <b>${params.name}</b> checklist.`
            };
            break;

        case 'checklistassignee':
            historyObj = {
                key: "Task_Checklist_Assign",
                message: `<b>${params.Employee_Name}</b> has added <b>${params.label}</b> into checklist item <b>${params.checkList}</b>`
            };
            break;

        case 'assigneeremove':
            historyObj = {
                key: "Task_Checklist_Remove",
                message: `<b>${params.Employee_Name}</b> has removed <b>${params.label}</b> from checklist item <b>${params.checkList}</b>`
            };
            break;

        default:
            logger.error(`Unknown operation type: ${ops}`);
            break;
    }

    return historyObj;
}

//Checklist Query Object
exports.buildQueryObject = (operation, taskId, data, historyObject) => {
    const taskObjId = new mongoose.Types.ObjectId(taskId);

    switch (operation) {
        case 'checklistedit':
            return [
                { _id: taskObjId },
                { $set: { "checklistArray.$[elem].name": historyObject.newName } },
                { arrayFilters: [{ "elem.id": historyObject.updatedId }], returnDocument: 'after' }
            ];
        case 'taskchecklistcreate':
            return [{ _id: taskObjId }, { $push: { checklistArray: data } },{ returnDocument: 'after'}];
        case 'checklistadd':
            return [{ _id: taskObjId }, { $push: { checklistArray: { $each: [...data] } } },{ returnDocument: 'after'}];
        case 'checklistremove':
            return [{ _id: taskObjId }, { $pull: { checklistArray: { id: { $in: data } } } },{ returnDocument: 'after'}];
        case 'checklistchecked':
            return [{ _id: taskObjId }, { $set: { checklistArray: data } },{ returnDocument: 'after'}];
        case 'checklistassignee':
        case 'assigneeremove':
            return [
                { _id: taskObjId, "checklistArray.id": historyObject.updateCheckListId },
                historyObject.type === 'add' ?
                    { $push: { "checklistArray.$.AssigneeUserId": historyObject.assigneeId } } :
                    { $pull: { "checklistArray.$.AssigneeUserId": historyObject.assigneeId } },
                    {returnDocument: 'after'}
            ];
        default:
            logger.error(`Unknown operation type: ${operation}`);
            return [];
    }
}

//Checklist Notification Object
exports.buildNotificationObject = (operation, historyObject) => {
    switch (operation) {
        case "checklistedit":
            return {
                message: taskCheckListEdit({
                    'ProjectName': historyObject.projectName,
                    'TaskName': historyObject.taskName,
                    'previouName': historyObject.previousName,
                    'newName': historyObject.newName
                }),
                key: "task_checklist",
            };
        case "taskchecklistcreate":
        case "checklistadd":
            return {
                message: taskCheckList({
                    'ProjectName': historyObject.projectName,
                    'TaskName': historyObject.taskName,
                    'value': historyObject.value || historyObject.name
                }),
                key: "task_checklist",
            };
        case "checklistremove":
            return {
                message: taskCheckListRemove({
                    'ProjectName': historyObject.projectName,
                    'TaskName': historyObject.taskName,
                    'checklist': historyObject?.extractedData?.name || '',
                    'name': historyObject?.extractedData?.subItemNames?.slice(1)?.join('\n') || ''
                }),
                key: "task_checklist",
            };
        case "checklistchecked":
            return {
                message: taskCheckListChecked({
                    'Employee_Name': historyObject.Employee_Name,
                    'name': historyObject.name,
                    'isChecked': historyObject.isChecked
                }),
                key: "task_checklist",
            };
        case "checklistassignee":
            return {
                message: taskCheckListAssignee({
                    'Employee_Name': historyObject.label,
                    'selectedChecklist': historyObject.checkList,
                    'ProjectName': historyObject.projectName,
                    'TaskName': historyObject.taskName
                }),
                key: "task_checklist_assign",
            };
        case "assigneeremove":
            return {
                message: taskCheckListAssigneeRemove({
                    'Employee_Name': historyObject.label,
                    'selectedChecklistRemove': historyObject.checkList,
                    'ProjectName': historyObject.projectName,
                    'TaskName': historyObject.taskName
                }),
                key: "task_checklist_remove",
            };
        default:
            logger.error(`Unknown operation type: ${operation}`);
            return null;
    }
}
exports.createCustomFields = ({tasks, userData, projectData}) => {
        return new Promise((resolve, reject) => {
            try {
                if (!tasks.length) return resolve();

                const firstTask = tasks[0];
                let customFieldIds = {};
                let customFieldsArr = [];

                // Step 1: Create custom fields using only the first task and store only the ID of custom fields created
                const fieldCreationPromises = Object.keys(firstTask)
                    .filter(key => key.startsWith("custom_"))
                    .map(customFieldKey => {
                        return buildRequestData({task: tasks[0], customFieldKey, userData, projectData})
                            .then(requestData => {
                                if (!requestData) return;
                                
                                return insertCustomFieldPromise(
                                    requestData, 
                                    "save",
                                    projectData.CompanyId
                                ).then(response => {
                                    customFieldsArr.push(response);
                                    if (response?._id) {
                                        customFieldIds[customFieldKey] = response._id;
                                    }
                                });
                            });
                    });

                // Wait for all custom fields to be created before proceeding
                Promise.allSettled(fieldCreationPromises)
                    .then(() => {
                        // Step 2: Update all tasks while preserving their original custom field values
                        tasks = tasks.map(task => {
                            let customField = {};

                            // Build the customFields object with values and ID as per database
                            Object.keys(customFieldIds).forEach(customFieldKey => {
                                if (task[customFieldKey]) {
                                    customField[customFieldIds[customFieldKey]] = {
                                        fieldValue: task[customFieldKey].value, // Preserve original value
                                        _id: customFieldIds[customFieldKey] // Use new ID
                                    };
                                }
                            });

                            // Return updated task with new customFields
                            return {
                                ...Object.fromEntries(Object.entries(task).filter(([key]) => !key.startsWith("custom_"))), // Remove old custom fields
                                ...(Object.keys(customField).length > 0 && { customField }) // Add customFields only if it has data
                            };
                        });
                        resolve({tasks: tasks, customFields: customFieldsArr});
                    })
                    .catch((error) => {
                        console.log("error here:", error);
                        reject(error)
                    });
            } catch (error) {
                reject(error);
            }
        });
    }

function buildRequestData({ task, customFieldKey, userData, projectData }) {
    return new Promise((resolve, reject) => {
        try {
            const countryObject = {
                "ru": "Соединенные Штаты",
                "lt": "Jungtinės Valstijos",
                "tr": "Amerika Birleşik Devletleri",
                "en": "United States",
                "flag": "🇺🇸",
                "code": "US",
                "dialCode": "+1",
                "mask": "(999) 999-9999",
                "maskWithDialCode": "(###) ###-####"
            };

            const { type, value, fieldDetails, delimiter } = task[customFieldKey];

            let fieldObject = {
                fieldTitle: customFieldKey.replace("custom_", ""),
                fieldPlaceholder: customFieldKey.replace("custom_", ""),
                fieldDescription: `Custom field for ${customFieldKey}`,
                fieldType: type,
                global: false,
                projectId: [projectData._id],
                type: "task",
                isDelete: true,
                userId: userData.id,
                fieldImage: fieldDetails?.cfIcon,
                fieldImageGrey: fieldDetails?.cfIconGrey,
                fieldPrimaryColor: fieldDetails?.cfPrimaryColor,
                fieldBackgroundColor: fieldDetails?.cfBackgroundColor,
                fieldRequired: [],
                fieldMinimum: "",
                fieldMaximum: "",
                fieldHide: [],
                fieldValidation: "",
                fieldEntryLimits: [],
                fieldCountryObject: "",
                fieldCountryCode: "",
                fieldCountrySelect: [""],
                fieldMoneyCode: "",
                fieldMoneyName: "",
                fieldMoneySymbol: "",
                __v: 0,
            };

            switch (type) {
                case "money":
                    fieldObject.fieldMoneyCode = "INR";
                    fieldObject.fieldMoneyName = "Indian Rupee";
                    fieldObject.fieldMoneySymbol = "₹";
                    break;
                case "date":
                    Object.assign(fieldObject, {
                        fieldSeparator: "-",
                        fieldDateFormate: "MM-DD-YYYY",
                        fieldLiteMode: ["Lite Mode"],
                        fieldTimeFormate: "24 Hour",
                        fieldPastFuture: ["Past", "Future"],
                        fieldDaysDisable: []
                    });
                    break;
                case "dropdown":
                    fieldObject.fieldOptions = delimiter === "None"
                        ? [{
                            id: makeUniqueId(5),
                            color: "#34495E",
                            value: value.trim(),
                            label: value.trim(),
                            selected: false,
                        }]
                        : value.split(delimiter.match(/\((.*?)\)/)[1].trim()).map(option => ({
                            id: makeUniqueId(5),
                            color: "#34495E",
                            value: option.trim(),
                            label: option.trim(),
                            selected: false,
                        }));
                    break;
                case "phone":
                    fieldObject.fieldCountryCode = "+1";
                    fieldObject.fieldCountryObject = countryObject.value;
                    fieldObject.fieldCountrySelect = ["Country Code"];
                    break;
            }

            resolve(fieldObject);
        } catch (error) {
            console.error("Error in buildRequestData:", error);
            reject(error);
        }
    });
}

function makeUniqueId(length = 6) {
    var result = '';
    var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for (var i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() *
            charactersLength));
    }
    return result;
}

exports.convertToDisplayFormat = (totalEstimate) => {
    const totalMinutes = totalEstimate || 0
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    const text =  `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`
    return text
}