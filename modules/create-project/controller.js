const { dbCollections,settingsCollectionDocs } = require("../../Config/collections");
const logger = require("../../Config/loggerConfig");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const axios = require('axios');
const { addSprintFun } = require("../sprints/controller")
const config = require("../../Config/config");
const { getCachedGlobalTemplateData } = require("../../utils/enterpriseHelper");
const { removeCache } = require('../../utils/commonFunctions');
const { updateCompanyFun } = require("../company/controller/update-company");
const projectTemplate = require("../../utils/projectTemplates.json");

exports.checkProjectPlan = (req) => {
    return new Promise(async(resolve,reject) => {
        try {
            let projectIncObj = {
                type: SCHEMA_TYPE.COMPANIES,
                data: [
                    { _id : new mongoose.Types.ObjectId(req.body.CompanyId)},
                    { $inc: {'projectCount.projectCount': 1} },
                    {
                        returnDocument : 'after'
                    }
                ]
            }
            if(req.body.isPrivateSpace === true){
                projectIncObj.data[1].$inc = {...projectIncObj.data[1].$inc,'projectCount.privateCount': 1 }
            }else{
                projectIncObj.data[1].$inc = {...projectIncObj.data[1].$inc,'projectCount.publicCount': 1 }
            }

            const companyData = await updateCompanyFun(SCHEMA_TYPE.GOLBAL,projectIncObj,"findOneAndUpdate",req.body.CompanyId,true)
            .then((respone) => respone)
            .catch((error) => {
                reject({status : false,error:error,countRollBack:false});
                return null;
            });

            if(companyData === null) return;

            let data = JSON.parse(JSON.stringify(companyData?.data))
            let planfeatures = data.planFeature;
            let projectCount = data?.projectCount.projectCount || 0;
            if(planfeatures === undefined){
                reject({status : false});
            }
            if(planfeatures.project === null || planfeatures.project >= projectCount){
                if(req.body.isPrivateSpace === false){
                    exports.checkProjectCount('public',data).then((ress) => {
                        if(ress === true) {
                            resolve({status : true});
                        }else{
                            reject({status : false});
                        }
                    }).catch(() => {
                        reject({status : false});
                    });
                }
                else{
                    exports.checkProjectCount('private',data).then((ress) => {
                        if(ress === true) {
                            resolve({status : true});
                        }else{
                            reject({status : false});
                        }
                    }).catch(() => {
                        reject({status : false});
                    });
                }
            }
            else{
                reject({status : false});
            }
        } catch (error) {
            reject({status : false,error:error});
        }
    })
}

exports.createProjectFun = async(req, res) => {
    try {
        exports.checkProjectPlan(req).then((data) => {
            if(data.status) {
                exports.createProject(req).then((cData) => {
                    removeCache("UserProjectData:", true);
                    res.send(cData);
                })
                .catch((error) => {
                    exports.removeProjectCount(req.body.CompanyId,req.body.isPrivateSpace);
                    res.send({status:false, statusText: error});
                });
            }
        }).catch((error) => {
            if(error?.countRollBack === false && error.countRollBack !== undefined){
                res.send({status:false, statusText: error});
            }
            else{
                exports.removeProjectCount(req.body.CompanyId,req.body.isPrivateSpace);
                res.send({status:false, statusText: error});
            }
        })
    } catch (error) {
        reject(error)
    }
};

exports.createProject = async (req) => {
    return new Promise((resolve,reject) => {
        try{
            if(!req.body && !Object.keys(req.body)?.length){
                reject({status: false, statusText: 'req body is requried'});
                return;
            }
            if(!req.body.CompanyId){
                reject({status: false, statusText: 'company Id is requried'});    
                return;
            }
            if(!req.body.ProjectName){
                reject({status: false, statusText: 'project name is requried'});
                return;
            }
            if(!req.body.ProjectCode){
                reject({status: false, statusText: 'project key is requried'});
                return;
            }
            if(!req.body.projectIcon && Object.keys(req.body.projectIcon)?.length){
                reject({status: false, statusText: 'project icon is requried'});
                return;
            }
            const collectionPromises = [
                MongoDbCrudOpration(req.body.CompanyId, {type: dbCollections.SETTINGS,data: [{name : settingsCollectionDocs.PROJECT_STATUS}]}, "find"),
                MongoDbCrudOpration(req.body.CompanyId, {type: dbCollections.SETTINGS,data: [{name : settingsCollectionDocs.TASK_STATUS}]}, "find"),
                MongoDbCrudOpration(req.body.CompanyId, {type: dbCollections.SETTINGS,data: [{name : settingsCollectionDocs.TASK_TYPE}]}, "find"),
                MongoDbCrudOpration(req.body.CompanyId, {type: dbCollections.APPS,data: [{}]}, "find"),
                MongoDbCrudOpration(req.body.CompanyId, {type: dbCollections.PROJECT_TAB_COMPONENTS,data: [{}]}, "find")
            ]
            Promise.allSettled(collectionPromises).then(async(results) => {
                let rejected = results.filter((x) => x.status === 'rejected');
                if (rejected.length === 0) {
                    let resultsValue = results.map((x) => x.value);
                    let createProjectObject = req.body;
                    let appArray = [];
                    let tabComponentsArray = [];
                    //template
                    let updateProjectStatus = {};
                    let projectStatusArrayCheck = [];
                    let updateTaskStatus = {};
                    let TaskStatusArrayCheck = [];
                    let updateTaskTypeStatus = {};
                    let TaskTypeStatusArrayCheck = [];
                    const [projectStatusData, taskStatusData, taskTypeData, appsData, projectTabComponentsData] = resultsValue;
                    appsData.forEach(element => {
                        appArray.push(element);
                    });
                    projectTabComponentsData.forEach(element => {
                        tabComponentsArray.push(element) ;
                    });
                    if(req.body.isTemplate === true){
                        try {
                            const projectStatusMergedArray = createProjectObject.projectStatusData.map(item => {
                                const valueItem = projectStatusData[0].settings.find(value => value.key === item.key);
                                if (valueItem) {
                                    return Object.assign(
                                        {},
                                        item, 
                                        {
                                            value: valueItem.value,
                                            backgroundColor:valueItem.backgroundColor,
                                            name:valueItem.name,
                                            textColor:valueItem.textColor
                                        }
                                    );
                                }
                                return item;
                            });
                            const taskStatusMergedArray = createProjectObject.taskStatusData.map(item => {
                                const valueItem = taskStatusData[0].settings.find(value => value.key === item.key);
                                if (valueItem) {
                                    return Object.assign(
                                        {},
                                        item, 
                                        {
                                            bgColor:valueItem.bgColor,
                                            name:valueItem.name,
                                            textColor:valueItem.textColor
                                        }
                                    );
                                }
                                return item;
                            });
                            const taskTypeMergedArray = createProjectObject.taskTypeCounts.map(item => {
                                const valueItem = taskTypeData[0].settings.find(value => value.key === item.key);
                                if (valueItem) {
                                    return Object.assign(
                                        {},
                                        item, 
                                        {
                                            value: valueItem.value,
                                            name:valueItem.name,
                                            taskImage:valueItem.taskImage
                                        }
                                    );
                                }
                                return item;
                            });
                            const projectAppMergedArray = createProjectObject.apps.map(item => {
                                const valueItem = appArray.find(value => JSON.parse(JSON.stringify(value))?._id === item._id);
                                if (valueItem) {
                                    return valueItem.key;
                                }
                                return item;
                            });
                            const projectRequiredComponent = createProjectObject.ProjectRequiredComponent.map(item => {
                                const valueItem = tabComponentsArray.find(value => JSON.parse(JSON.stringify(value))?._id === item._id);
                                if (valueItem) {
                                    return Object.assign(
                                        {},
                                        item, 
                                        {
                                            activeIcon:valueItem.activeIcon,
                                            icon:valueItem.icon,
                                            createdAt:valueItem.createdAt ? valueItem.createdAt.seconds ? new Date(valueItem.createdAt.seconds * 1000) : new Date(valueItem.createdAt) : new Date(),
                                            keyName:valueItem.keyName,
                                            name:valueItem.name,
                                            updatedAt:valueItem.updatedAt ? valueItem.updatedAt.seconds ? new Date(valueItem.updatedAt.seconds * 1000) : new Date(valueItem.updatedAt) : new Date()
                                        }
                                    );
                                }
                                return item;
                            });
                            createProjectObject.projectStatusData = projectStatusMergedArray;
                            createProjectObject.taskStatusData = taskStatusMergedArray;
                            createProjectObject.taskTypeCounts = taskTypeMergedArray;
                            createProjectObject.apps = projectAppMergedArray;
                            createProjectObject.ProjectRequiredComponent = projectRequiredComponent;
                        } catch (error) {
                            reject({status: false, statusText: error});
                            logger.error(`Error ${error}`);
                        }
                    }else{
                        if(createProjectObject.useTemplateProj === 'category'){
                            try {
                                    if(projectTemplate.length <= 0){
                                        reject({status: false, statusText: 'error in getting template with category'});
                                        return;
                                    }
                                    let projectTemplateData = projectTemplate[0];
                                    let incrementProjectStatus = projectStatusData[0].totalStatus;
                                    let incrementTask = taskStatusData[0]?.totalStatus;
                                    let incrementTaskType = taskTypeData[0]?.totalStatus;
                                    const projectStatusMergedTempArray = projectTemplateData.projectStatusData.map(item => {
                                    const valueItem = projectStatusData[0].settings.find(value => value.name.toLowerCase() === item.name.toLowerCase());
                                        if (valueItem) {
                                            return Object.assign(
                                                {},
                                                {
                                                    value: valueItem.value,
                                                    backgroundColor:valueItem.backgroundColor,
                                                    key:valueItem.key,
                                                    textColor:valueItem.textColor,
                                                    name:item.name,
                                                    type:item.type
                                                }
                                            );
                                        }else{
                                            if(item.name){
                                                incrementProjectStatus += 1;
                                                const objectStatus = Object.assign(
                                                    {},
                                                    {
                                                        key:incrementProjectStatus,
                                                        value: item.value,
                                                        backgroundColor:item.backgroundColor,
                                                        textColor:item.textColor,
                                                        name:item.name,
                                                        type:item.type
                                                    }
                                                );
                                                updateProjectStatus.totalStatus = incrementProjectStatus;
                                                projectStatusArrayCheck.push(objectStatus);
                                                return objectStatus;
                                            }
                                        }
                                        return item;
                                    });
                                    
                                    const taskStatusMergedTempArray = projectTemplateData.taskStatusData.map(item => {
                                        const valueItem = taskStatusData[0].settings.find(value => value.name.toLowerCase() === item.name.toLowerCase());
                                        if (valueItem) {
                                            return Object.assign(
                                                {},
                                                {
                                                    bgColor:valueItem.bgColor,
                                                    key:valueItem.key,
                                                    textColor:valueItem.textColor,
                                                    name:item.name,
                                                    type:item.type
                                                }
                                            );
                                        }else{
                                            if(item.name){
                                                incrementTask += 1;
                                                const objectStatus = Object.assign(
                                                    {},
                                                    {
                                                        bgColor:item.bgColor,
                                                        name:item.name,
                                                        textColor:item.textColor,
                                                        key:incrementTask,
                                                        type:item.type
                                                    }
                                                );
                                                updateTaskStatus.totalStatus = incrementTask;
                                                TaskStatusArrayCheck.push(objectStatus);
                                                return objectStatus;
                                            }
                                        }
                                        return item;
                                    });
                                    const taskTypeMergedTempArray = projectTemplateData.TemplateTaskType.map(item => {
                                        const valueItem = taskTypeData[0].settings.find(value => value.name.toLowerCase() === item.name.toLowerCase());
                                        if (valueItem) {
                                            return Object.assign(
                                                {},
                                                {
                                                    value: valueItem.value,
                                                    key:valueItem.key,
                                                    taskImage:valueItem.taskImage,
                                                    name:item.name
                                                }
                                            );
                                        }else{
                                            if(item.name){
                                                incrementTaskType += 1;
                                                const objectStatus = Object.assign(
                                                    {},
                                                    {
                                                        value: item.value,
                                                        name:item.name,
                                                        taskImage:item.taskImage,
                                                        key:incrementTaskType
                                                    }
                                                );
                                                updateTaskTypeStatus.totalStatus = incrementTaskType;
                                                TaskTypeStatusArrayCheck.push(objectStatus);
                                                return objectStatus;
                                            }
                                        }
                                        return item;
                                    });

                                    const projectAppMergedTempArray = projectTemplateData.apps.map(item => {
                                        const valueItem = appArray.find(value => value.name === item.name);
                                        if (valueItem) {
                                            return valueItem.key;
                                        }
                                        return item;
                                    });
                                    const projectRequiredTempComponent = projectTemplateData.TemplateRequiredComponent.map(item => {
                                        const valueItem = tabComponentsArray.find(value => value.name === item.name);
                                        if (valueItem) {
                                            return Object.assign(
                                                {},
                                                {
                                                    activeIcon:valueItem.activeIcon,
                                                    icon:valueItem.icon,
                                                    createdAt:valueItem.createdAt ? valueItem.createdAt.seconds ? new Date(valueItem.createdAt.seconds * 1000) : new Date(valueItem.createdAt) : new Date(),
                                                    keyName:valueItem.keyName,
                                                    name:valueItem.name,
                                                    updatedAt:valueItem.updatedAt ? valueItem.updatedAt.seconds ? new Date(valueItem.updatedAt.seconds * 1000) : new Date(valueItem.updatedAt) : new Date(),
                                                    _id: valueItem.id ?  valueItem.id : JSON.parse(JSON.stringify(valueItem._id)),
                                                    setAsDefault:item.setAsDefault,
                                                    viewStatus:item.viewStatus
                                                }
                                            );
                                        }
                                        return item;
                                    });
                                    createProjectObject.projectStatusData = projectStatusMergedTempArray;
                                    createProjectObject.taskStatusData = taskStatusMergedTempArray;
                                    createProjectObject.taskTypeCounts = taskTypeMergedTempArray;
                                    createProjectObject.apps = projectAppMergedTempArray;
                                    createProjectObject.ProjectRequiredComponent = projectRequiredTempComponent;
                                    createProjectObject.status = createProjectObject.projectStatusData.filter((x) => x.type === 'default_active')[0].value;
                            } catch(err){
                                reject({status: false, statusText: 'error in getting template with category'});
                                logger.error(`status update error: ${err}`);
                            }
                        }else{
                            try{
                                await MongoDbCrudOpration(req.body.CompanyId, {type: dbCollections.PROJECT_TEMPLATES,data: [{_id: new mongoose.Types.ObjectId(createProjectObject.TemplateId)}]}, "findOne").then((res)=> {
                                    if(Object.keys(res).length <= 0){
                                        reject({status: false, statusText: 'error in getting template without category'})
                                        return;
                                    }
                                    const appTempArray = res.apps
                                        .filter(item => item.appStatus === true)
                                        .map(item => item.key);

                                    createProjectObject.projectStatusData = res.projectStatusData;
                                    createProjectObject.taskStatusData = res.taskStatusData;
                                    createProjectObject.taskTypeCounts = res.TemplateTaskType;
                                    createProjectObject.apps = appTempArray;
                                    createProjectObject.ProjectRequiredComponent = res.TemplateRequiredComponent;
                                    createProjectObject.status = createProjectObject.projectStatusData.filter((x) => x.type === 'default_active')[0].value
                                }).catch((err)=>{
                                    reject({status: false, statusText: 'error in getting template without category'})
                                    logger.error(`without category: ${err}`);
                                });
                            } catch(err) {
                                reject({status: false, statusText: 'error in getting template without category'})
                                logger.error(`without category: ${err}`);
                            }
                        }
                    }
                    createProjectObject.DueDate = createProjectObject.DueDate ? new Date(createProjectObject.DueDate) : '';
                    createProjectObject.viewColumn = [
                        {
                            label: "Chat",
                            key: "commentCounts",
                            postition: 0,
                            show:true
                        },
                        {
                            label: "Assignee",
                            key: "AssigneeUserId",
                            funcPermission: 'task.task_assignee',
                            postition: 1,
                            show:true
                        },
                        {
                            label: "Due Date",
                            key: "DueDate",
                            funcPermission: 'task.task_due_date',
                            postition: 2,
                            show:true
                        },
                        {
                            label: "Priority",
                            key: "Task_Priority",
                            funcPermission: 'task.task_priority',
                            appPermission: 'Priority',
                            postition: 3,
                            show:true
                        },
                        {
                            label: "Key",
                            key: "TaskKey",
                            postition: 4,
                            show:true
                        },
                        {
                            label: "Created Date",
                            key: "created_date",
                            postition: 5,
                            show:true
                        },
                        {
                            label: "Created By",
                            key: "created_by",
                            postition: 6,
                            show:true
                        }
                    ] 
                    let customFieldVal = JSON.parse(JSON.stringify(createProjectObject.customFiedlsValue)) || [];
                    createProjectObject._id = new mongoose.Types.ObjectId(createProjectObject?._id);
                    delete createProjectObject?.isTemplate;
                    delete createProjectObject?.useTemplateProj;
                    delete createProjectObject?.customFiedlsValue;
                    let finalObj = {
                        type: dbCollections.PROJECTS,
                        data: createProjectObject
                    }
                    MongoDbCrudOpration(req.body.CompanyId, finalObj, "save").then((respone) => {
                        if(projectStatusArrayCheck && projectStatusArrayCheck.length > 0){
                            let projectStatusObj = {
                                type: dbCollections.SETTINGS,
                                data: [
                                    {
                                        name: settingsCollectionDocs.PROJECT_STATUS
                                    },
                                    {
                                        $push: {
                                            settings: { $each: projectStatusArrayCheck.map(setting => ({ ...setting })) }
                                        },
                                        $inc: {
                                            totalStatus:projectStatusArrayCheck.length
                                        }
                                    }
                                ]
                            }
                            MongoDbCrudOpration(req.body.CompanyId, projectStatusObj, "updateOne").catch((err)=>{
                                logger.error(`add project status: ${err}`);
                                reject({status: false, statusText: 'error in creating project'});
                                exports.deleteProject(respone,req.body.CompanyId);
                            });
                        }
                        if(TaskStatusArrayCheck && TaskStatusArrayCheck.length > 0){
                            let taskStatusObj = {
                                type: dbCollections.SETTINGS,
                                data: [
                                    {
                                        name: settingsCollectionDocs.TASK_STATUS
                                    },
                                    {
                                        $push: {
                                            settings: { $each: TaskStatusArrayCheck.map(setting => ({ ...setting })) }
                                        },
                                        $inc: {
                                            totalStatus:TaskStatusArrayCheck.length
                                        }
                                    }
                                ]
                            }
                            MongoDbCrudOpration(req.body.CompanyId, taskStatusObj, "updateOne").catch((err)=>{
                                logger.error(`add task status: ${err}`);
                                exports.deleteProject(respone,req.body.CompanyId);
                                reject({status: false, statusText: 'error in creating project'});
                            });
                        }
                        if(TaskTypeStatusArrayCheck && TaskTypeStatusArrayCheck.length > 0){
                            let taskTypeObj = {
                                type: dbCollections.SETTINGS,
                                data: [
                                    {
                                        name: settingsCollectionDocs.TASK_TYPE
                                    },
                                    {
                                        $push: {
                                            settings: { $each: TaskTypeStatusArrayCheck.map(setting => ({ ...setting })) }
                                        },
                                        $inc: {
                                            totalStatus:TaskTypeStatusArrayCheck.length
                                        }
                                    },
                                    
                                ]
                            }
                            MongoDbCrudOpration(req.body.CompanyId, taskTypeObj, "updateOne").catch((err)=>{
                                logger.error(`add task type: ${err}`);
                                exports.deleteProject(respone,req.body.CompanyId);
                                reject({status: false, statusText: 'error in creating project'});
                            });
                        }
                        if(customFieldVal.length > 0) {
                            let finalCustonArray = customFieldVal.map((ele)=>{return {...ele,userId:createProjectObject?.projectCreatedBy || '',type:'task',global:false,projectId:[respone?._id?.toString()]}})
                            let finalObjCostom = {
                                type: dbCollections.CUSTOM_FIELDS,
                                data: [finalCustonArray]
                            }
                            MongoDbCrudOpration(req.body.CompanyId,finalObjCostom,"insertMany").then((customResponce)=>{   
                                removeCache(`customField:${req.body.CompanyId}`);
                                resolve({status: true, statusText: 'createProject added successfully', data: respone,customFieldVal: customResponce})
                                const addObj = {
                                    body: {
                                        companyId: req.body.CompanyId,
                                        projectId: respone._id,
                                        sprintName: 'List',
                                        userData:{},
                                        projectName: createProjectObject.ProjectName
                                    }
                                }
                                addSprintFun(addObj).catch((err)=>{
                                    logger.error('Create Sprint Error',err)
                                });
                            }).catch((e)=>{
                                logger.error(`error in add create project: ${e}`);
                                exports.deleteProject(respone,req.body.CompanyId);
                                reject({status: false, statusText: 'error in creating project'});
                            })
                        } else {
                            resolve({status: true, statusText: 'createProject added successfully', data: respone});
                            const addObj = {
                                body: {
                                    companyId: req.body.CompanyId,
                                    projectId: respone._id,
                                    sprintName: 'List',
                                    userData:{},
                                    projectName: createProjectObject.ProjectName
                                }
                            }
                            addSprintFun(addObj).catch((err)=>{
                                logger.error('Create Sprint Error',err)
                            });
                        }
                    }).catch((err)=>{
                        reject({status: false, statusText: err});
                        logger.error(`add create project: ${err}`);
                    });
                }else{
                    reject({status: false, statusText: 'error in createProject'});
                }
            }).catch((error) => {
                reject({status: false, statusText: error});
                // Handle errors that might occur during fetching the data
                logger.error(`Promise Error: ${error}`);
            });
        }catch(err){
            reject({status: false, statusText: err});
            logger.error(`createProject: ${err}`);
        }
    })
}

exports.checkProjectCount = (requestFor,companyData) => { 
    return new Promise((resolve,reject) => {
        try {
            if(companyData?.planFeature === undefined){
                reject(false);
            }
            let maxProject = companyData?.planFeature.project;
            let projectCount = companyData?.projectCount?.projectCount || 0;
            if(maxProject === null) {
                //request specific type
                resolve(exports.checkSpecificTypeCount(requestFor,companyData))
            } else {
                let mainAvailable = maxProject - projectCount;

                if(mainAvailable >= 0) {
                    //request specific type
                    resolve(exports.checkSpecificTypeCount(requestFor,companyData))
                } else {
                    reject(false)
                }
            }
        } catch (error) {
            reject(error);
        }
    })
}

exports.checkSpecificTypeCount= (requestFor,companyData) => {
    try {
        let maxPublicProject = companyData?.planFeature.maxPublicProject;
        let maxPrivateProject = companyData?.planFeature.maxPrivateProject;
        let projectPublicCount = companyData?.projectCount?.publicCount || 0;
        let projectPrivateCount = companyData?.projectCount?.privateCount || 0;
        if(requestFor === 'public') {
            if(maxPublicProject === null) {
                return true
            } else {
                let available = maxPublicProject - projectPublicCount
    
                if(available >= 0) {
                    return true
                } else {
                    return false
                }
            }
        } else if(requestFor === 'private') {
            if(maxPrivateProject === null) {
                return true
            } else {
                let available = maxPrivateProject - projectPrivateCount
    
                if(available >= 0) {
                    return true
                } else {
                    return false
                }
            }
        }
    } catch (error) {
        logger.error(`Error in check Plan: ${error}`)
    }
}

exports.deleteProject = (data,companyId) => {
    try {
        let obj = {
            type: SCHEMA_TYPE.PROJECTS,
            data: [
                {
                    _id: new mongoose.Types.ObjectId(data._id)
                }
            ]
        }
        MongoDbCrudOpration(companyId, obj, "deleteOne").catch(err => {
            logger.error(`deleteProject: ${err}`);
        });
    } catch (error) {
        logger.error(`deleteProject: ${error}`);
    }
}

exports.removeProjectCount = (companyId,isPrivateSpace) => {
    try {
        let decObj = {
            type: SCHEMA_TYPE.COMPANIES,
            data: [
                { _id : new mongoose.Types.ObjectId(companyId)},
                { $inc: {'projectCount.projectCount': -1} },
                { new: true }
            ]
        }
        if(isPrivateSpace === true){
            decObj.data[1].$inc = {...decObj.data[1].$inc,'projectCount.privateCount': -1 }
        }else{
            decObj.data[1].$inc = {...decObj.data[1].$inc,'projectCount.publicCount': -1 }
        }
        updateCompanyFun(SCHEMA_TYPE.GOLBAL,decObj,"findOneAndUpdate",companyId,true);
    } catch (error) {
        console.log(error,"ERROR:");
    }
}

exports.getGlobalTemplate = (req,res) => {
    try {
        getCachedGlobalTemplateData().then((resp) => {
            res.send(resp);
        }).catch((error) => {
            res.send({status: false,statusText: error});
        })
    } catch (error) {
        res.send({status: false,statusText: error});
    }
}