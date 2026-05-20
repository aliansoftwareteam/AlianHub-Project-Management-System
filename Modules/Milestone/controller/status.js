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

const { clearMilestoneStatusNotification } = require('./helpers');
exports.clearMilestoneStatus = async (req, res) => {
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
        let historyObj ={};
        let notificationObj = {};
        historyObj.message = `<b>${req.body.userDetail.Employee_Name}</b> has <b>clear all the milestone status</b> of milestone <b>${req.body.milestoneObject.milestoneName}</b>.`;
        historyObj.key = 'Project_Milestone_status_clear';
        notificationObj.message = `<p>The milestone named <strong>${req.body.milestoneObject.milestoneName}</strong> in Project <strong>${req.body.ProjectName}</strong> the milestone status have been cleared.</p>`;
        notificationObj.key = 'project_milestone_status_change';
        let typsObj = {
            statusArray: [],
            refundedAmount:[],
            minRefundDate:0,
            maxRefundDate:0,
            statusDate:0,
            statusId:''
        }
        let updateObject;
        if(req.body.milestoneObject && req.body.milestoneObject.statusArray && req.body.milestoneObject.statusArray.length && req.body.milestoneObject.statusArray[req.body.milestoneObject.statusArray.length - 1].milestoneStatusColor === "CANCELLED"){
            updateObject = {
                "milestoneAmount": req.body.milestoneObject.amount
            }
        }else if(req.body.milestoneObject && req.body.milestoneObject.refundedAmount && req.body.milestoneObject.refundedAmount){
            let refundAmount = 0;
            req.body.milestoneObject.refundedAmount.forEach((ele)=>{
                refundAmount += ele.amount;
            });
            updateObject = {
                "milestoneAmount": refundAmount
            }
        }
        await updateProjectInternal(req.body.companyId, req.body.projectId, updateObject, "$inc", []).then(async() => {
            let obj = {
                type:SCHEMA_TYPE.MILESTONE,
                data: [
                    { _id: new mongoose.Types.ObjectId(req.body.milestoneObject._id) },
                    {...typsObj}
                ]
            }
            await MongoDbCrudOpration(req.body.companyId,obj, "updateOne").then(() => {
                removeCache(`milestone:${req.body.projectId}:${req.body.companyId}`);
                res.send({
                    status: true,
                    statusText: "Milestone Clear Status",
                    data:''
                });
                clearMilestoneStatusNotification(req.body.companyId, req.body.projectId,req.body.userDetail,req.body.milestoneObject,historyObj,notificationObj);
            }).catch((err)=>{
                return res.send({
                    status: false,
                    statusText: err,
                });
            });
        }).catch((err) =>{
            return res.send({
                status: false,
                statusText: err,
            });
        })
    } catch (err) {
        logger.error(`handle clearMilestone: ${err}`);
        return res.send({status: false, statusText: err});
    }
};

exports.cancelMilestoneStatus = async (req, res) => {
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
        if(!(req.body.statusObj && Object.keys(req.body.statusObj).length)){
            res.send({status: false, statusText: 'statusObj is required'});
            return;
        }
        let milestoneName = req.body.milestoneObject.milestoneName;
        req.body.milestoneObject.statusArray.forEach((element) => {
            element.statusDateValue = element.statusDateValue.seconds ? new Date(element.statusDateValue.seconds * 1000) : new Date(element.statusDateValue);
        });
        let typobject = {
            'statusArray': req.body.milestoneObject.statusArray ? req.body.milestoneObject.statusArray : [],
            'statusId' : req.body.milestoneObject.statusArray[req.body.milestoneObject.statusArray.length - 1].milestoneStatusColor,
            'statusDate' : new Date(req.body.milestoneObject.statusArray[req.body.milestoneObject.statusArray.length - 1].statusDateValue).getTime()
        }
        
        let obj = {
            type:SCHEMA_TYPE.MILESTONE,
            data: [
                { _id: new mongoose.Types.ObjectId(req.body.milestoneObject._id) },
                {...typobject}
            ]
        }
        let updateObject = {
            "milestoneAmount": -req.body.onlyNumber
        }
        await updateProjectInternal(req.body.companyId, req.body.projectId, updateObject, "$inc", []).then(async() => {
            await MongoDbCrudOpration(req.body.companyId,obj, "updateOne").then(() => {
                removeCache(`milestone:${req.body.projectId}:${req.body.companyId}`);
                res.send({
                    status: true,
                    statusText: "Milestone Cancel Status",
                    data:''
                });
                let notificationObj = {};
                notificationObj.message =
                `<p>In Project <strong>${req.body.ProjectName}</strong> a Milestone named <strong>${milestoneName}</strong> has updated the status <strong style="padding-right: 5px;padding-left: 5px;border-radius: 5px;font-weight: 500;background-color:${req.body.statusObj.backgroundColor};
                color:#fff;">${req.body.statusObj.name}</strong>.</p>`;
                notificationObj.key = 'project_milestone_status_change';
                HandleBothNotification({type: 'project', companyId: req.body.companyId, projectId: req.body.projectId, taskId: undefined, folderId: undefined, sprintId: undefined, object: notificationObj, userData: req.body.userDetail}).catch((err) => {
                    logger.error(`handle notification for name: ${err}`);
                });
                let historyObj = {};
                historyObj.message = `<b>${req.body.userDetail.Employee_Name}</b> changed <b>${milestoneName}</b> milestone status to <b>${req.body.statusObj.name}</b></b>.`
                historyObj.key = 'Project_Milestone_Changed';
                hlp.HandleHistory('project',req.body.companyId,req.body.projectId,null,historyObj,req.body.userDetail).catch((err) => {
                    logger.error(`handle history: ${err}`);
                });
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
        logger.error(`cancelMilestoneStatus milestone: ${err}`);
        return res.send({status: false, statusText: err});
    }
};

exports.refundAmount = async (req, res) => {
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
        if(!req.body.onlyNumber){
            res.send({status: false, statusText: 'onlyNumber is required'});
            return;
        }
        if(!(req.body.milestoneObject && Object.keys(req.body.milestoneObject).length)){
            res.send({status: false, statusText: 'milestoneArray is required'});
            return;
        }
        req.body.milestoneObject.refundedAmount.forEach((ele) => {
            if(ele.date){
                ele.date = ele.date ? ele.date.seconds ? new Date(ele.date.seconds * 1000) : new Date(ele.date) : '';
            }
        });
        const { minDate, maxDate } = req.body.milestoneObject.refundedAmount.reduce((acc, obj) => {
            const currentDate = new Date(obj.date).getTime(0,0,0);
            if (currentDate < acc.minDate) {
                acc.minDate = currentDate;
            }
            if (currentDate > acc.maxDate) {
                acc.maxDate = currentDate;
            }
            return acc;
        }, { minDate: new Date(req.body.milestoneObject.refundedAmount[0].date).getTime(0,0,0), maxDate: new Date(req.body.milestoneObject.refundedAmount[0].date).getTime(0,0,0)});
        const setMaxDate = new Date(maxDate).setHours(0,0,0);
        const setMinDate = new Date(minDate).setHours(0,0,0);
        let typobject = {
            'refundedAmount': req.body.milestoneObject.refundedAmount ? req.body.milestoneObject.refundedAmount : [],
            'maxRefundDate' : new Date(setMaxDate).getTime(),
            'minRefundDate' : new Date(setMinDate).getTime()
        }
        let obj = {
            type:SCHEMA_TYPE.MILESTONE,
            data: [
                { _id: new mongoose.Types.ObjectId(req.body.milestoneObject._id) },
                {...typobject}
            ]
        }
        let updateObject = {
            "milestoneAmount": -req.body.onlyNumber
        }
        await updateProjectInternal(req.body.companyId, req.body.projectId, updateObject, "$inc", []).then(async() => {
            await MongoDbCrudOpration(req.body.companyId,obj, "updateOne").then(() => {
                removeCache(`milestone:${req.body.projectId}:${req.body.companyId}`);
                res.send({
                    status: true,
                    statusText: "Milestone Refund Amount",
                    data:''
                });
                let historyObj = {};
                let amountObj = req.body.milestoneObject.refundedAmount[req.body.milestoneObject.refundedAmount.length - 1]
                historyObj.message = `<b>${req.body.userDetail.Employee_Name}</b>  processed a refund of <b>${req.body.cuurencyValue} ${amountObj.amount}</b>
                 for the <b>${req.body.milestoneObject.milestoneName}</b> milestone on <b>DATE_${new Date(amountObj.date).getTime()}</b> </b>`;
                historyObj.key = 'Project_Milestone_Changed';
                hlp.HandleHistory('project',req.body.companyId,req.body.projectId,null,historyObj,req.body.userDetail).catch((err) => {
                    logger.error(`handle history: ${err}`);
                });
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
        logger.error(`refundAmount milestone: ${err}`);
        return res.send({status: false, statusText: err});
    }
};

exports.draggableMilestone = async (req, res) => {
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
            res.send({status: false, statusText: 'milestoneObject is required'});
            return;
        }
        let object = {
            'order': req.body.milestoneObject.order,
        };
        let obj = {
            type:SCHEMA_TYPE.MILESTONE,
            data: [
                { _id: new mongoose.Types.ObjectId(req.body.milestoneObject._id) },
                {...object}
            ]
        };
        MongoDbCrudOpration(req.body.companyId,obj, "updateOne").then(() => {
            removeCache(`milestone:${req.body.projectId}:${req.body.companyId}`);
            res.send({
                status: true,
                statusText: "Milestone Drag",
                data:''
            });
        }).catch((err)=>{
            res.send({
                status: false,
                statusText: err,
            });
            logger.error(`refund amount milestone mongodb crud opration : ${err}`);
        });
        
    } catch (err) {
        res.send({status: false, statusText: err});
        logger.error(`draggableMilestone milestone: ${err}`);
    }
};
