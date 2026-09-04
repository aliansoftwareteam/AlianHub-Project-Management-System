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

const { addMilestoneHistoryNotification, updateMilestoneNotification, deleteMilestoneNotification, addMilestoneHistory, updateMilestoneHistory } = require('./helpers');
exports.addMilestone = async (req, res) => {
    try{
        if(!req.body){
            res.send({status: false, statusText: 'Request body is required'});
            return;
        }
        if(!req.body.companyId){
            res.send({status: false, statusText: 'Company Id is required'});
            return;
        }
        if(!req.body.projectId){
            res.send({status: false, statusText: 'project Id is required'});
            return;
        }
        if(!(req.body.milestoneObject && Object.keys(req.body.milestoneObject).length)){
            res.send({status: false, statusText: 'milestoneObject is required'});
            return;
        }
        if(!(req.body.ProjectName)){
            res.send({status: false, statusText: 'ProjectName is required'});
            return;
        }
        if(!(req.body.userDetail && Object.keys(req.body.userDetail).length)){
            res.send({status: false, statusText: 'userDetail is required'});
            return;
        }
        let historyObj ={};
        let notificationObj = {};
        let milestoneStatusObj = req.body.milestoneStatusObj ? req.body.milestoneStatusObj : '';
        let milestoneObject = req.body.milestoneObject ? JSON.parse(JSON.stringify(req.body.milestoneObject)) : '';
        let milestoneName = milestoneObject.milestoneName ? milestoneObject.milestoneName : '';
        historyObj.message = `<b>${req.body.userDetail.Employee_Name}</b> has created new milestone as <b>${milestoneName}</b> in <b>${req.body.ProjectName}</b> project.`;
        historyObj.key = 'Project_Milestone_Changed';
        notificationObj.message = `<p>In Project <strong>${req.body.ProjectName}</strong> a new Milestone named <strong>${milestoneName}</strong> is Created.</p>`;
        notificationObj.key = 'project_milestone';

        if(req.body?.fixOrHourlyMilCheck === false){
            milestoneObject.dueDate = milestoneObject.dueDate ? new Date(milestoneObject.dueDate) : '';
        }
        milestoneObject.startDate = milestoneObject.startDate ? new Date(milestoneObject.startDate) : '';
        milestoneObject.endDate = milestoneObject.endDate ? new Date(milestoneObject.endDate) : '';
        if(milestoneObject.statusArray && milestoneObject.statusArray.length){
            milestoneObject.statusArray[0].statusDateValue = new Date(milestoneObject.statusArray[0].statusDateValue);
        }
        milestoneObject.amount = Number(milestoneObject.amount);
        milestoneObject.statusDate = milestoneObject.statusDate ? new Date(milestoneObject.statusDate) : '';
        milestoneObject.maxRefundDate = milestoneObject.maxRefundDate ? milestoneObject.maxRefundDate : '';
        milestoneObject.minRefundDate = milestoneObject.minRefundDate ? milestoneObject.minRefundDate : '';
        let typsObj = {};
        if(req.body?.fixOrHourlyMilCheck === false){
            typsObj = {
                'milestoneName': milestoneObject.milestoneName,
                'amount': milestoneObject.amount,
                'startDate':milestoneObject.startDate? new Date(milestoneObject.startDate).getTime() : 0,
                'endDate': milestoneObject.endDate ? new Date(milestoneObject.endDate).getTime() : 0,
                'dueDate': milestoneObject.dueDate ? new Date(milestoneObject.dueDate).getTime() : 0,
                'statusDate':milestoneObject.statusDate ? new Date(milestoneObject.statusDate).getTime() : 0,
                'statusId':milestoneObject.statusId ? milestoneObject.statusId : '',
                'refundedAmount': milestoneObject.refundedAmount && milestoneObject.refundedAmount.length ? milestoneObject.refundedAmount : [],
                'statusArray': milestoneObject.statusArray && milestoneObject.statusArray.length ? milestoneObject.statusArray : [],
                'projectId': req.body.projectId,
                'order': milestoneObject.order,
                'maxRefundDate' : milestoneObject.maxRefundDate ? new Date(milestoneObject.maxRefundDate).getTime() : 0,
                'minRefundDate' : milestoneObject.minRefundDate ? new Date(milestoneObject.minRefundDate).getTime() : 0
            };
        }else {
            typsObj = {
                'milestoneName': milestoneObject.milestoneName,
                'amount': milestoneObject.amount,
                'startDate': milestoneObject.startDate ? new Date(milestoneObject.startDate).getTime() : 0,
                'endDate': milestoneObject.endDate ? new Date(milestoneObject.endDate).getTime() : 0,
                'statusDate':milestoneObject.statusDate ? new Date(milestoneObject.statusDate).getTime() : 0,
                'statusId':milestoneObject.statusId ? milestoneObject.statusId : '',
                'refundedAmount': milestoneObject.refundedAmount && milestoneObject.refundedAmount.length ? milestoneObject.refundedAmount : [],
                'statusArray': milestoneObject.statusArray && milestoneObject.statusArray.length ? milestoneObject.statusArray : [],
                'projectId': req.body.projectId,
                'minute':milestoneObject.minute,
                'hours':milestoneObject.hours,
                'amountPerHours':milestoneObject.amountPerHours,
                'billingPeriod':milestoneObject.billingPeriod,
                'maxRefundDate' : milestoneObject.maxRefundDate ? new Date(milestoneObject.maxRefundDate).getTime() : 0,
                'minRefundDate' : milestoneObject.minRefundDate ? new Date(milestoneObject.minRefundDate).getTime() : 0
            };
        }
        let obj = {
            data: typsObj,
            type:SCHEMA_TYPE.MILESTONE
        }
        // add data
        let updateObject = {
            "milestoneAmount": milestoneObject.amount
        }
        await updateProjectInternal(req.body.companyId, req.body.projectId, updateObject, "$inc", []).then(async() => {
            await MongoDbCrudOpration(req.body.companyId,obj, "save").then((response) => {
                removeCache(`milestone:${req.body.projectId}:${req.body.companyId}`);
                res.send({
                    status: true,
                    statusText: "Milestone Added",
                    data:response
                });
                addMilestoneHistoryNotification(req.body.companyId, req.body.projectId,req.body.userDetail,milestoneStatusObj,historyObj,notificationObj,milestoneName,req.body.ProjectName);
                addMilestoneHistory(milestoneObject,req.body.companyId, req.body.projectId,req.body.userDetail,milestoneStatusObj,req.body.cuurencyValue);
            }).catch((error)=>{
                return res.send({status: false, statusText: error});
            });
        }).catch((err) => {
            return res.send({status: false, statusText: err});
        });
    }catch(err){
        logger.error(`add milestone: ${err}`);
        return res.send({status: false, statusText: err});
    }
};

exports.updateMilestone = async (req, res) => {
    try {
        if(!req.body){
            res.send({status: false, statusText: 'Request body is required'});
            return;
        }
        if(!req.body.companyId){
            res.send({status: false, statusText: 'Company Id is required'});
            return;
        }
        if(!req.body.projectId){
            res.send({status: false, statusText: 'project Id is required'});
            return;
        }
        if(!(req.body.milestoneObject && Object.keys(req.body.milestoneObject).length)){
            res.send({status: false, statusText: 'milestoneArray is required'});
            return;
        }
        if(!(req.body.ProjectName)){
            res.send({status: false, statusText: 'ProjectName is required'});
            return;
        }
        if(!(req.body.userDetail && Object.keys(req.body.userDetail).length)){
            res.send({status: false, statusText: 'userDetail is required'});
            return;
        }
        if(req.body?.fixOrHourlyMilCheck === false){
            req.body.milestoneObject.dueDate = req.body.milestoneObject.dueDate ? req.body.milestoneObject.dueDate.seconds ? new Date(req.body.milestoneObject.dueDate.seconds * 1000 + req.body.milestoneObject.dueDate.nanoseconds / 1000000) : new Date(req.body.milestoneObject.dueDate) : '';
        }
        req.body.milestoneObject.startDate = req.body.milestoneObject.startDate ? req.body.milestoneObject.startDate.seconds ? new Date(req.body.milestoneObject.startDate.seconds * 1000 + req.body.milestoneObject.startDate.nanoseconds / 1000000) : new Date(req.body.milestoneObject.startDate) : '';
        req.body.milestoneObject.endDate = req.body.milestoneObject.endDate ? req.body.milestoneObject.endDate.seconds ? new Date(req.body.milestoneObject.endDate.seconds * 1000 + req.body.milestoneObject.endDate.nanoseconds / 1000000) : new Date(req.body.milestoneObject.endDate) : '';
        req.body.milestoneObject.maxRefundDate = req.body.milestoneObject.maxRefundDate ? req.body.milestoneObject.maxRefundDate.seconds ? new Date(req.body.milestoneObject.maxRefundDate.seconds * 1000) : new Date(req.body.milestoneObject.maxRefundDate)  : '';
        req.body.milestoneObject.minRefundDate = req.body.milestoneObject.minRefundDate ? req.body.milestoneObject.minRefundDate.seconds ? new Date(req.body.milestoneObject.minRefundDate.seconds * 1000) : new Date(req.body.milestoneObject.minRefundDate) : '';
        
        if(req.body.milestoneObject.statusArray && req.body.milestoneObject.statusArray.length){
            req.body.milestoneObject.statusArray.forEach((element) => {
                if(element.statusDateValue.seconds){
                    element.statusDateValue = new Date(element.statusDateValue.seconds * 1000);
                }else{
                    element.statusDateValue = new Date(element.statusDateValue);
                }
            });
            req.body.milestoneObject.statusId = req.body.milestoneObject.statusArray[req.body.milestoneObject.statusArray.length - 1].milestoneStatusColor;
            req.body.milestoneObject.statusDate = req.body.milestoneObject.statusArray[req.body.milestoneObject.statusArray.length - 1].statusDateValue;
        }
        if(req.body.milestoneObject.refundedAmount && req.body.milestoneObject.refundedAmount.length){
            req.body.milestoneObject.refundedAmount.forEach((e)=>{
                e.date = e.date ? e.date.seconds ? new Date(e.date.seconds * 1000) : new Date(e.date) : '' 
            });
        }
        let typsObj = {};
        if(req.body?.fixOrHourlyMilCheck === false){
            typsObj = {
                'milestoneName': req.body.milestoneObject.milestoneName,
                'amount': req.body.milestoneObject.amount,
                'startDate': req.body.milestoneObject.startDate ? new Date(req.body.milestoneObject.startDate).getTime() : 0,
                'endDate': req.body.milestoneObject.endDate ? new Date(req.body.milestoneObject.endDate).getTime() : 0,
                'dueDate': req.body.milestoneObject.dueDate ? new Date(req.body.milestoneObject.dueDate).getTime() : 0,
                'statusId':req.body.milestoneObject.statusId ? req.body.milestoneObject.statusId : '',
                'statusDate':req.body.milestoneObject.statusDate ? new Date(req.body.milestoneObject.statusDate).getTime() : 0,
                'refundedAmount': req.body.milestoneObject.refundedAmount && req.body.milestoneObject.refundedAmount.length ? req.body.milestoneObject.refundedAmount : [],
                'statusArray': req.body.milestoneObject.statusArray && req.body.milestoneObject.statusArray.length ? req.body.milestoneObject.statusArray : [],
                'order': req.body.milestoneObject.order,
                'maxRefundDate' : req.body.milestoneObject.maxRefundDate ? new Date(req.body.milestoneObject.maxRefundDate).getTime() : 0,
                'minRefundDate' : req.body.milestoneObject.minRefundDate ? new Date(req.body.milestoneObject.minRefundDate).getTime() : 0
            };
        }else{
            typsObj = {
                'milestoneName': req.body.milestoneObject.milestoneName,
                'startDate': req.body.milestoneObject.startDate ? new Date(req.body.milestoneObject.startDate).getTime() : 0,
                'endDate': req.body.milestoneObject.endDate ? new Date(req.body.milestoneObject.endDate).getTime() : 0,
                'amount': Number(req.body.milestoneObject.amount),
                'amountPerHours': Number(req.body.milestoneObject.amountPerHours),
                'hours':Number(req.body.milestoneObject.hours),
                'minute':Number(req.body.milestoneObject.minute),
                'statusId':req.body.milestoneObject.statusId ? req.body.milestoneObject.statusId : '',
                'statusDate':req.body.milestoneObject.statusDate ? new Date(req.body.milestoneObject.statusDate).getTime() : 0,
                'statusArray':req.body.milestoneObject.statusArray && req.body.milestoneObject.statusArray.length ? req.body.milestoneObject.statusArray : [],
                'refundedAmount':req.body.milestoneObject.refundedAmount && req.body.milestoneObject.refundedAmount.length ? req.body.milestoneObject.refundedAmount : [],
                'maxRefundDate' : req.body.milestoneObject.maxRefundDate ? new Date(req.body.milestoneObject.maxRefundDate).getTime() : 0,
                'minRefundDate' : req.body.milestoneObject.minRefundDate ? new Date(req.body.milestoneObject.minRefundDate).getTime() : 0
            };
        }

        let updateObject = {
            "milestoneAmount": req.body.onlyNumber
        }
        await updateProjectInternal(req.body.companyId, req.body.projectId, updateObject, "$inc", []).then(async() => {
            let obj = {
                type:SCHEMA_TYPE.MILESTONE,
                data: [
                    { _id: new mongoose.Types.ObjectId(req.body.milestoneObject.id) },
                    {...typsObj}
                ]
            }
            await MongoDbCrudOpration(req.body.companyId,obj, "updateOne").then(() => {
                removeCache(`milestone:${req.body.projectId}:${req.body.companyId}`);
                res.send({
                    status: true,
                    statusText: "Milestone Update",
                    data:''
                });
                let prevMilestoneName = req.body.prevMilestoneName.milestoneName;
                let milestoneName = req.body.milestoneObject.milestoneName;
                updateMilestoneNotification(prevMilestoneName,req.body.milestoneStatusObj,req.body.companyId, req.body.projectId,req.body.userDetail,milestoneName,req.body.milestoneObject,req.body.ProjectName,req.body.statusObj);
                updateMilestoneHistory(req.body.companyId,req.body.projectId,req.body.userDetail,req.body.prevMilestoneName,req.body.milestoneObject,req.body.cuurencyValue);
            }).catch((err)=>{
                return res.send({
                    status: false,
                    statusText: err,
                });
            });
        }).catch((err)=>{
            return res.send({
                status: false,
                statusText: err,
            });
        });
    } catch (err) {
        logger.error(`handle updateMilestone : ${err}`);
        return res.send({status: false, statusText: err});
    }
}

exports.deleteMilestone = async (req, res) => {
    try {
        if(!req.body){
            res.send({status: false, statusText: 'Request body is required'});
            return;
        }
        if(!req.body.companyId){
            res.send({status: false, statusText: 'Company Id is required'});
            return;
        }
        if(!req.body.projectId){
            res.send({status: false, statusText: 'project Id is required'});
            return;
        }
        if(!(req.body.milestoneObjForDelete && Object.keys(req.body.milestoneObjForDelete).length)){
            res.send({status: false, statusText: 'milestoneArray is required'});
            return;
        }
        if(!(req.body.ProjectName)){
            res.send({status: false, statusText: 'ProjectName is required'});
            return;
        }
        if(!(req.body.userDetail && Object.keys(req.body.userDetail).length)){
            res.send({status: false, statusText: 'userDetail is required'});
            return;
        }
        let milestoneName = req.body.milestoneObjForDelete.milestoneName;
        let historyObj ={};
        let notificationObj = {};
        historyObj.message = `<b>${req.body.userDetail.Employee_Name}</b> has deleted milestone <b>${milestoneName}</b> in <b>${req.body.ProjectName}</b> project.`;
        historyObj.key = 'Project_Milestone_delete';
        notificationObj.message = `<p>In Project <strong>${req.body.ProjectName}</strong> a Milestone named <strong>${milestoneName}</strong> is deleted.</p>`;
        notificationObj.key = 'project_milestone';
        let updateObject = {
            "milestoneAmount": -req.body.onlyNumber
        }
        await updateProjectInternal(req.body.companyId, req.body.projectId, updateObject, "$inc", []).then(async() => {
            let obj = {
                type: SCHEMA_TYPE.MILESTONE,
                data: [
                    {
                        _id: new mongoose.Types.ObjectId(req.body.milestoneObjForDelete._id)
                    }
                ]
            }
            await MongoDbCrudOpration(req.body.companyId, obj, "deleteOne").then((response)=>{
                removeCache(`milestone:${req.body.projectId}:${req.body.companyId}`);
                res.send({
                    status: true,
                    statusText: "Milestone Delete",
                    data:response
                });
                deleteMilestoneNotification(req.body.companyId, req.body.projectId,req.body.userDetail,req.body.milestoneObjForDelete,historyObj,notificationObj);
            }).catch((err)=>{
                return res.send({status: false, statusText: err});
            })
        }).catch((err)=>{
            return res.send({status: false, statusText: err});
        })
    } catch (err) {
        logger.error(`handle deleteMilestone: ${err}`);
        return res.send({status: false, statusText: err});
    }
};
