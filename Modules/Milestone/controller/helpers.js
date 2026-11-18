const { myCache } = require("../../../Config/config");
const { removeCache } = require("../../../utils/commonFunctions");
const {HandleBothNotification} = require("../../Tasks/helpers/handleNotification");
const logger = require("../../../Config/loggerConfig");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries.js");
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const hlp = require("../../Tasks/helpers/helper");
const {updateProjectInternal} = require("../../Project/controller/updateProject.js");
const mongoose = require("mongoose")
const { settingsCollectionDocs } = require("../../../Config/collections");

exports.addMilestoneHistoryNotification = async (companyId, projectId,userDetail,milestoneStatusObj,historyObj,notificationObj,milestoneName,ProjectName) => {
    try{
        hlp.HandleHistory('project',companyId, projectId,null,historyObj, userDetail).then((res)=>{
        }).catch((err) => {
            logger.error(`handle history: ${err}`);
        });
        HandleBothNotification({type: 'project', companyId: companyId, projectId: projectId, taskId: undefined, folderId: undefined, sprintId: undefined, object: notificationObj, userData: userDetail}).catch((err) => {
            logger.error(`handle notification for name: ${err}`);
        });
        if(milestoneStatusObj){
            let notificationStatusObj = {};
            notificationStatusObj.message = 
            `<p>Status of <strong>${milestoneName}</strong> Milestone is added <strong>
                <span style="padding-right: 5px;padding-left: 5px;border-radius: 5px;font-weight: 500;background-color:${milestoneStatusObj.backgroundColor}; 
                    color:#fff;">${milestoneStatusObj.name}
                </span>
                </strong> for <strong>${ProjectName}</strong> project.
            </p>`;
            notificationStatusObj.key = 'project_milestone_status_change';
            HandleBothNotification({type: 'project', companyId: companyId, projectId: projectId, taskId: undefined, folderId: undefined, sprintId: undefined, object: notificationStatusObj, userData: userDetail}).catch((err) => {
                logger.error(`handle notification for status: ${err}`);
            });
            try {
                if(milestoneStatusObj.value === 'FUNDED' || milestoneStatusObj.value === 'RELEASED'){
                    let obj = {
                        type:SCHEMA_TYPE.SETTINGS,
                        data: [
                            { "name": settingsCollectionDocs.PROJECT_MILESTONE_STATUS },
                            { $set: {'settings.$[elementIndex].isCount':0 }},
                            {arrayFilters: [{ "elementIndex.value": milestoneStatusObj.value }]}
                        ]
                    }
                    MongoDbCrudOpration(companyId,obj, "updateOne").then(() => {
                        removeCache(`milestoneStatus:${companyId}`);
                    }).catch((err)=>{
                        logger.error(`handle addMilestoneHistoryNotification setting update : ${err}`);
                    });
                }else{
                    let obj = {
                        type:SCHEMA_TYPE.SETTINGS,
                        data: [
                            { "name": settingsCollectionDocs.PROJECT_MILESTONE_STATUS },
                            {$inc: {"settings.$[elementIndex].isCount": 1}},
                            {arrayFilters: [{ "elementIndex.value": milestoneStatusObj.value }]}
                        ]
                    }
                    MongoDbCrudOpration(companyId,obj, "updateOne").then(() => {
                        removeCache(`milestoneStatus:${companyId}`);
                    }).catch((err)=>{
                        logger.error(`handle addMilestoneHistoryNotification setting update : ${err}`);
                    });
                }
            }catch(err){
                logger.error(`handle addMilestoneHistoryNotification setting : ${err}`);
            }
        }
    }catch(err){
        logger.error(`handle addMilestoneHistoryNotification : ${err}`);
    }
}

exports.updateMilestoneNotification = async (prevMilestoneName,milestoneStatusObj,companyId, projectId,userDetail,milestoneName,milestoneArray,ProjectName,statusObj) => {
    try{
        if(prevMilestoneName !== milestoneName){
            let historyObj ={};
            let notificationObj = {};
            historyObj.message = `<b>${userDetail.Employee_Name}</b> has update milestone as <b>${milestoneName}</b> from <b>${prevMilestoneName}</b> in <b>${ProjectName}</b> project.`;
            historyObj.key = 'Project_Milestone_Edit_Name';
            notificationObj.message = `<p>In Project <strong>${ProjectName}</strong> a Milestone named is update as <strong>${milestoneName}</strong> form <strong>${prevMilestoneName}</strong>.</p>`;
            notificationObj.key = 'project_milestone';
            hlp.HandleHistory('project',companyId, projectId,null,historyObj, userDetail).catch((err) => {
                logger.error(`handle history: ${err}`);
            });
            HandleBothNotification({type: 'project', companyId: companyId, projectId: projectId, taskId: undefined, folderId: undefined, sprintId: undefined, object: notificationObj, userData: userDetail}).catch((err) => {
                logger.error(`handle notification for name: ${err}`);
            });
        }
        if(milestoneStatusObj){
            let statusHistoryObj ={};
            let historyObj ={};
            statusHistoryObj.key = 'project_milestone_status_change';
            historyObj.key = 'Project_Milestone_Status_Changed';
            if(milestoneArray.statusArray && milestoneArray.statusArray.length){
                if(milestoneArray.statusArray.length !== 1){
                    let lastStatusName = statusObj.name;
                    let backgroundColor = statusObj.backgroundColor;
                    statusHistoryObj.message = 
                    `<p>Status of <strong>${milestoneName}</strong> Milestone is changed from <strong><span style="padding-right: 5px;
                    padding-left: 5px; border-radius: 5px; font-weight: 500;background-color:${backgroundColor}; color:#fff;">${lastStatusName}</span></strong> to <strong><span style="padding-right: 5px;
                    padding-left: 5px;  border-radius: 5px; font-weight: 500;background-color:${milestoneStatusObj.backgroundColor}; color:#fff;">${milestoneStatusObj.name}</span></strong> for <strong>${ProjectName}</strong> project.</p>`;  
                    historyObj.message = `<b>${userDetail.Employee_Name}</b> changed <b>${milestoneName}</b> milestone status from <b>${lastStatusName}</b> to <b>${milestoneStatusObj.name}</b> and status date set to <b>DATE_${new Date(milestoneStatusObj.statusDate).getTime()}</b>.`
                }else{
                    let backgroundColor = statusObj.backgroundColor;
                    let milestoneStatus = statusObj.name;
                    statusHistoryObj.message = 
                    `<p>Status of <strong>${milestoneName}</strong> Milestone is added <strong>
                        <span style="padding-right: 5px;padding-left: 5px;border-radius: 5px;font-weight: 500;background-color:${backgroundColor}; 
                            color:#fff;">${milestoneStatus}
                        </span>
                        </strong> for <strong>${ProjectName}</strong> project.
                    </p>`;
                    historyObj.message = `<b>${userDetail.Employee_Name}</b> has set the status of milestone ${milestoneName} to  ${milestoneStatus} and the status date is set to <b>DATE_${new Date(milestoneStatusObj.statusDate).getTime()}</b>.`;
                }
            }
            hlp.HandleHistory('project',companyId, projectId,null,historyObj, userDetail).catch((err) => {
                logger.error(`handle history: ${err}`);
            });
            HandleBothNotification({type: 'project', companyId: companyId, projectId: projectId, taskId: undefined, folderId: undefined, sprintId: undefined, object: statusHistoryObj, userData: userDetail}).catch((err) => {
                logger.error(`handle notification for name: ${err}`);
            });
            try {
                if(milestoneStatusObj.value === 'FUNDED' || milestoneStatusObj.value === 'RELEASED'){
                    let obj = {
                        type:SCHEMA_TYPE.SETTINGS,
                        data: [
                            { "name": settingsCollectionDocs.PROJECT_MILESTONE_STATUS },
                            { $set: {'settings.$[elementIndex].isCount':0 }},
                            {arrayFilters: [{ "elementIndex.value": milestoneStatusObj.value }]}
                        ]
                    }
                    MongoDbCrudOpration(companyId,obj, "updateOne").then(() => {
                        removeCache(`milestoneStatus:${companyId}`);
                    }).catch((err)=>{
                        logger.error(`handle updateMilestoneNotification setting update : ${err}`);
                    });
                }else{
                    let obj = {
                        type:SCHEMA_TYPE.SETTINGS,
                        data: [
                            { "name": settingsCollectionDocs.PROJECT_MILESTONE_STATUS },
                            {$inc: {"settings.$[elementIndex].isCount": 1}},
                            {arrayFilters: [{ "elementIndex.value": milestoneStatusObj.value }]}
                        ]
                    }
                    MongoDbCrudOpration(companyId,obj, "updateOne").then(() => {
                        removeCache(`milestoneStatus:${companyId}`);
                    }).catch((err)=>{
                        logger.error(`handle updateMilestoneNotification setting update : ${err}`);
                    });
                }
            }catch(err){
                logger.error(`handle updateMilestoneNotification setting : ${err}`);
            }
        }
    } catch (err) {
        logger.error(`handle updateMilestoneNotification : ${err}`);
    }
}

exports.deleteMilestoneNotification = async (companyId, projectId,userDetail,milestoneObjForDelete,historyObj,notificationObj) => {
    try {
        hlp.HandleHistory('project',companyId, projectId,null,historyObj, userDetail).catch((err) => {
            logger.error(`handle history: ${err}`);
        });
        HandleBothNotification({type: 'project', companyId: companyId, projectId: projectId, taskId: undefined, folderId: undefined, sprintId: undefined, object: notificationObj, userData: userDetail}).catch((err) => {
            logger.error(`handle notification for name: ${err}`);
        });
        if(milestoneObjForDelete.statusArray && milestoneObjForDelete.statusArray.length){
            try {
                milestoneObjForDelete.statusArray.forEach((element2) => {
                    if(element2.milestoneStatusColor === 'CANCELLED' || 
                        element2.milestoneStatusColor === 'RELEASED' ||
                        element2.milestoneStatusColor === 'FUNDED' ||
                        element2.milestoneStatusColor === 'REFUNDED'){
                        let obj = {
                            type:SCHEMA_TYPE.SETTINGS,
                            data: [
                                { "name": settingsCollectionDocs.PROJECT_MILESTONE_STATUS },
                                { $set: {'settings.$[elementIndex].isCount':0 }},
                                {arrayFilters: [{ "elementIndex.value": element2.milestoneStatusColor }]}
                            ]
                        }
                        MongoDbCrudOpration(companyId,obj, "updateOne").then(() => {
                            removeCache(`milestoneStatus:${companyId}`);
                        }).catch((err)=>{
                            logger.error(`handle deleteMilestoneNotification setting update : ${err}`);
                        });
                    }else{
                        let obj = {
                            type:SCHEMA_TYPE.SETTINGS,
                            data: [
                                { "name": settingsCollectionDocs.PROJECT_MILESTONE_STATUS },
                                {$inc: {"settings.$[elementIndex].isCount": -1}},
                                {arrayFilters: [{ "elementIndex.value": element2.milestoneStatusColor }]}
                            ]
                        }
                        MongoDbCrudOpration(companyId,obj, "updateOne").then(() => {
                            removeCache(`milestoneStatus:${companyId}`);
                        }).catch((err)=>{
                            logger.error(`handle deleteMilestoneNotification setting update : ${err}`);
                        });
                    }
                })
            }catch(err){
                logger.error(`handle deleteMilestoneNotification setting : ${err}`);
            }
        }
    } catch (err) {
        logger.error(`handle deleteMilestoneNotification : ${err}`);
    }
}

exports.clearMilestoneStatusNotification = async (companyId, projectId,userDetail,milestoneObjFor,historyObj,notificationObj) => {
    try {
        hlp.HandleHistory('project',companyId, projectId,null,historyObj, userDetail).catch((err) => {
            logger.error(`handle history: ${err}`);
        });
        HandleBothNotification({type: 'project', companyId: companyId, projectId: projectId, taskId: undefined, folderId: undefined, sprintId: undefined, object: notificationObj, userData: userDetail}).catch((err) => {
            logger.error(`handle notification for name: ${err}`);
        });
        try {
            if(milestoneObjFor.statusArray && milestoneObjFor.statusArray.length){
                milestoneObjFor.statusArray.forEach((element2) => {
                    if(element2.milestoneStatusColor === 'CANCELLED' || 
                        element2.milestoneStatusColor === 'RELEASED' ||
                        element2.milestoneStatusColor === 'FUNDED' ||
                        element2.milestoneStatusColor === 'REFUNDED'){
                        let obj = {
                            type:SCHEMA_TYPE.SETTINGS,
                            data: [
                                { "name": settingsCollectionDocs.PROJECT_MILESTONE_STATUS },
                                { $set: {'settings.$[elementIndex].isCount':0 }},
                                {arrayFilters: [{ "elementIndex.value": element2.milestoneStatusColor }]}
                            ]
                        }
                        MongoDbCrudOpration(companyId,obj, "updateOne").then(() => {
                            removeCache(`milestoneStatus:${companyId}`);
                        }).catch((err)=>{
                            logger.error(`handle clearMilestoneStatusNotification setting update : ${err}`);
                        });
                    }else{
                        let obj = {
                            type:SCHEMA_TYPE.SETTINGS,
                            data: [
                                { "name": settingsCollectionDocs.PROJECT_MILESTONE_STATUS },
                                {$inc: {"settings.$[elementIndex].isCount": -1}},
                                {arrayFilters: [{ "elementIndex.value": element2.milestoneStatusColor }]}
                            ]
                        }
                        MongoDbCrudOpration(companyId,obj, "updateOne").then(() => {
                            removeCache(`milestoneStatus:${companyId}`);
                        }).catch((err)=>{
                            logger.error(`handle clearMilestoneStatusNotification setting update : ${err}`);
                        });
                    }
                });
            }
        } catch (err) {
            logger.error(`handle clearMilestoneStatusNotification setting : ${err}`);
        }
    } catch (err) {
        logger.error(`handle clearMilestoneStatusNotification : ${err}`);
    }
};

exports.addMilestoneHistory = (milestoneObject,companyId, projectId,userDetail,statusobj,cuurencyValue) => {
    if(milestoneObject.startDate){
        let historyObj = {};
        historyObj.message = `<b>${userDetail.Employee_Name}</b> has set the start date of milestone <b>${milestoneObject.milestoneName}</b> to <b>DATE_${new Date(milestoneObject.startDate).getTime()}</b>`;
        historyObj.key = 'Project_Milestone_Changed';
        hlp.HandleHistory('project',companyId, projectId,null,historyObj, userDetail).catch((err) => {
            logger.error(`handle history: ${err}`);
        });
    }
    if(milestoneObject.endDate){
        let historyObj = {};
        historyObj.message = `<b>${userDetail.Employee_Name}</b> has set the end date of milestone <b>${milestoneObject.milestoneName}</b> to <b>DATE_${new Date(milestoneObject.endDate).getTime()}</b>`;
        historyObj.key = 'Project_Milestone_Changed';
        hlp.HandleHistory('project',companyId, projectId,null,historyObj, userDetail).catch((err) => {
            logger.error(`handle history: ${err}`);
        });
    }
    if(milestoneObject.dueDate){
        let historyObj = {};
        historyObj.message = `<b>${userDetail.Employee_Name}</b> has set the due date of milestone <b>${milestoneObject.milestoneName}</b> to <b>DATE_${new Date(milestoneObject.dueDate).getTime()}</b>`;
        historyObj.key = 'Project_Milestone_Changed';
        hlp.HandleHistory('project',companyId, projectId,null,historyObj, userDetail).catch((err) => {
            logger.error(`handle history: ${err}`);
        });
    }
    if(milestoneObject.statusArray.length > 0){
        let historyObj = {};
        historyObj.message = `<b>${userDetail.Employee_Name}</b> has set the status date of milestone <b>${milestoneObject.milestoneName}</b> to <b>DATE_${new Date(milestoneObject.statusArray[0].statusDateValue).getTime()}</b>`;
        historyObj.key = 'Project_Milestone_Changed';
        hlp.HandleHistory('project',companyId, projectId,null,historyObj, userDetail).catch((err) => {
            logger.error(`handle history: ${err}`);
        });
    }
    if(statusobj){
        let historyObj = {};
        historyObj.message = `<b>${userDetail.Employee_Name}</b> has set the status of milestone <b>${milestoneObject.milestoneName}</b> to <b>${statusobj.label}</b>`;
        historyObj.key = 'Project_Milestone_Changed';
        hlp.HandleHistory('project',companyId, projectId,null,historyObj, userDetail).catch((err) => {
            logger.error(`handle history: ${err}`);
        });
    }
    if(milestoneObject.amount){
        let historyObj = {};
        historyObj.message = `<b>${userDetail.Employee_Name}</b> has set the amount of milestone <b>${milestoneObject.milestoneName}</b> to <b>${cuurencyValue} ${milestoneObject.amount}</b>`;
        historyObj.key = 'Project_Milestone_Changed';
        hlp.HandleHistory('project',companyId, projectId,null,historyObj, userDetail).catch((err) => {
            logger.error(`handle history: ${err}`);
        });
    }
}

exports.updateMilestoneHistory = (companyId,projectId,userDetail,oldObject,newObject,cuurencyValue) => {
    if(newObject.startDate){
        let historyObj = {
            key : 'Project_Milestone_Changed'
        }
        if (oldObject.startDate === '' && newObject.startDate) {
            historyObj.message = `<b>${userDetail.Employee_Name}</b> has set the start date of  milestone <b>${newObject.milestoneName}</b> to DATE_${new Date(newObject.startDate).getTime()}</b>.`
        }
        else if(new Date(oldObject.startDate).getTime() !== new Date(newObject.startDate).getTime()){
            historyObj.message = `<b>${userDetail.Employee_Name}</b> changed <b>${newObject.milestoneName}</b> milestone start date from <b>DATE_${new Date(oldObject.startDate).getTime()}</b> to <b>DATE_${new Date(newObject.startDate).getTime()}</b>`
        } 
        if(historyObj.message){
            hlp.HandleHistory('project',companyId, projectId,null,historyObj, userDetail).catch((err) => {
                logger.error(`handle history: ${err}`);
            });
        }
    }

    if(newObject.endDate){
        let historyObj = {
            key : 'Project_Milestone_Changed'
        }
        if (oldObject.endDate === '' && newObject.endDate) {
            historyObj.message = `<b>${userDetail.Employee_Name}</b> has set the end date of  milestone <b>${newObject.milestoneName}</b> to DATE_${new Date(newObject.endDate).getTime()}</b>.`
        }
        else if(new Date(oldObject.endDate).getTime() !== new Date(newObject.endDate).getTime()){
            historyObj.message = `<b>${userDetail.Employee_Name}</b> changed <b>${newObject.milestoneName}</b> milestone end date from <b>DATE_${new Date(oldObject.endDate).getTime()}</b> to <b>DATE_${new Date(newObject.endDate).getTime()}</b>`
        }
        if(historyObj.message){
            hlp.HandleHistory('project',companyId, projectId,null,historyObj, userDetail).catch((err) => {
                logger.error(`handle history: ${err}`);
            });
        }
    }

    if(newObject.amount){
        let historyObj = {
            key : 'Project_Milestone_Changed'
        }
        if (oldObject.amount === '' && newObject.amount) {
            historyObj.message = `<b>${userDetail.Employee_Name}</b> has set the amount of milestone <b>${newObject.milestoneName}</b> to ${cuurencyValue} ${newObject.amount}</b>.`
        }
        else  if(oldObject.amount !== newObject.amount){
            historyObj.message = `<b>${userDetail.Employee_Name}</b> changed <b>${newObject.milestoneName}</b> milestone amount from <b>${cuurencyValue} ${oldObject.amount}</b> to <b>${cuurencyValue} ${newObject.amount}</b>`
        }
        if(historyObj.message){
            hlp.HandleHistory('project',companyId, projectId,null,historyObj, userDetail).catch((err) => {
                logger.error(`handle history: ${err}`);
            });
        }
    }

    if(newObject.dueDate){
        let historyObj = {
            key : 'Project_Milestone_Changed'
        }
        if (oldObject.dueDate === '' && newObject.dueDate) {
            historyObj.message = `<b>${userDetail.Employee_Name}</b> has set the due date of  milestone <b>${newObject.milestoneName}</b> to DATE_${new Date(newObject.dueDate).getTime()}</b>.`
        } 
        else if(new Date(oldObject.dueDate).getTime() !== new Date(newObject.dueDate).getTime()){
            historyObj.message = `<b>${userDetail.Employee_Name}</b> changed <b>${newObject.milestoneName}</b> milestone due date from <b>DATE_${new Date(oldObject.dueDate).getTime()}</b> to <b>DATE_${new Date(newObject.dueDate).getTime()}</b>`
        }
        if(historyObj.message){
            hlp.HandleHistory('project',companyId, projectId,null,historyObj, userDetail).catch((err) => {
                logger.error(`handle history: ${err}`);
            });
        }
    }
}
