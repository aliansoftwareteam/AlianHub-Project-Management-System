const path = require('path');
const {dbCollections} = require('../../Config/collections');
const logger = require("../../Config/loggerConfig");
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { updateCommentSprint } = require("../Comments/controller");

const fp = `${__dirname}/`;
const mongoose = require("mongoose");
const socketEmitter = require('../../event/socketEventEmitter');


exports.changeTaskType = async (req, res) => {
    try {
        if (!(req.body && req.body.companyId)) {
            res.send({
                status: false,
                statusText: "CompanyId is required"
            })
            return;
        }
        if (!(req.body && req.body.projectId)) {
            res.send({
                status: false,
                statusText: "ProjectId is required"
            })
            return;
        }
        if (!(req.body && req.body.taskTypeKey)) {
            res.send({
                status: false,
                statusText: "taskTypeKey is required"
            })
            return;
        }
        if (!(req.body && req.body.oldTaskType)) {
            res.send({
                status: false,
                statusText: "oldTaskType is required"
            })
            return;
        }
    
        let tasks = [];
        let promisesArr = [];
    
        await MongoDbCrudOpration(req.body.companyId, {type: dbCollections.TASKS,data: [{'ProjectID': req.body.projectId,'TaskTypeKey': { $in: req.body.taskTypeKey }}]}, "find")
        .then(async(result) => {
            result.map((x) => {
                tasks.push(x)
            })
        })
        tasks.forEach((task) => {
            promisesArr.push(
                new Promise((resolve1, reject1) => {
                    try {
                        req.body.taskTypeKey.forEach(async(key) => {
                            if(key === task.TaskTypeKey){
                                let newStatus = req.body.oldTaskType.filter((y) => y.key === key)[0]?.convertType;
                                if(newStatus){
                                    const obj = {
                                        ...task._doc,
                                        TaskTypeKey : newStatus.key,
                                        TaskType: newStatus.value,
                                    }
                                    let updateObj = {
                                        type: dbCollections.TASKS,
                                        data: [
                                            {
                                                _id : task._id
                                            },
                                            { 
                                                ...obj
                                            },
                                            {
                                                returnDocument: 'after'
                                            }
                                        ]
                                    }
                                    MongoDbCrudOpration(req.body.companyId,updateObj,"findOneAndUpdate").then((result) => {
                                        socketEmitter.emit('update', { type: "update", data: result , updatedFields: obj , module: 'task'});
                                        resolve1()
                                    })
                                    .catch((error) => {
                                        logger.error(`TASK type Error: ${error}`);
                                        reject1(error);
                                    })
                                }
                            }
                        })
                    } catch (error) {
                        logger.error(`TASK type Error: ${error}`);
                        reject1(error)
                    }
                })
            );  
        })
        Promise.allSettled(promisesArr).then(() => {
            res.send({
                status: true,
                statusText: "TASK UPDATE SUCCESFULLY"
            })
        }).catch((error) => {
            logger.error(`TASK type Error: ${error}`);
            res.send({
                status: false,
                statusText: error
            })
        })
    } catch (error) {
        logger.error(`TASK type Error: ${error}`);
    }
};

exports.changeTaskStatus = async (req, res) => {
    try {
        if (!(req.body && req.body.companyId)) {
            res.send({
                status: false,
                statusText: "CompanyId is required"
            })
            return;
        }
        if (!(req.body && req.body.projectId)) {
            res.send({
                status: false,
                statusText: "ProjectId is required"
            })
            return;
        }
        if (!(req.body && req.body.taskStatusKey)) {
            res.send({
                status: false,
                statusText: "taskStatusKey is required"
            })
            return;
        }
        if (!(req.body && req.body.oldTaskStatus)) {
            res.send({
                status: false,
                statusText: "oldTaskStatus is required"
            })
            return;
        }
    
        let tasks = [];
        let promisesArr = [];
    
        await MongoDbCrudOpration(req.body.companyId, {type: dbCollections.TASKS,data: [{ProjectID: req.body.projectId,'statusKey': { $in:  req.body.taskStatusKey }}]}, "find").then((result) => {
            result.map((x) => {
                tasks.push(x)
            })
        })
        tasks.forEach(async(task) => {
            promisesArr.push(
                new Promise((resolve, reject) => {
                    try {
                        req.body.taskStatusKey.forEach(async(key) => {
                            if(key === task.statusKey){
                                let newStatus = req.body.oldTaskStatus.filter((y) => y.key === key)[0]?.convertStatus;
                                if(newStatus){
                                    const obj = {
                                        ...task._doc,
                                        statusKey : newStatus.key,
                                        status : {
                                            'text' : newStatus.name,
                                            'key' : newStatus.key,
                                            'type':newStatus.type
                                        },
                                    }
                                    let updateObj = {
                                        type: dbCollections.TASKS,
                                        data: [
                                            {
                                                _id : task._id
                                            },
                                            { 
                                                ...obj
                                            },
                                            {
                                                returnDocument: 'after'
                                            }
                                        ]
                                    }
                                    MongoDbCrudOpration(req.body.companyId,updateObj,"findOneAndUpdate").then((result) => {
                                        socketEmitter.emit('update', { type: "update", data: result , updatedFields: obj , module: 'task'});
                                        resolve();
                                    })
                                    .catch((error) => {
                                        logger.error(`Error: ${error}`);
                                        reject(error);
                                    })
                                }
                            }
                        })
                    } catch (error) {
                        logger.error(`Error: ${error}`);
                        reject(error)
                    }
                })
            );
        })
        Promise.allSettled(promisesArr).then(() => {
            res.send({
                status: true,
                statusText: "TASK UPDATE SUCCESFULLY"
            })
        }).catch((error) => {
            logger.error(`TASK status Error: ${error}`);
            res.send({
                status: false,
                statusText: error
            })
        })
    } catch (error) {
        logger.error(`TASK status Error: ${error}`);
    }
};

// SPRINT FOLDER ADD QUERY

async function batchUpdate(updateArray, cid) {
    return new Promise((resolve, reject) => {
        try {
            // tasks BATCH FUNCTION
            let count = 0;
            let batch = 1;
            const perBatch = 5;
            const next = () => {
                batch++;
                loopFun();
            }

            let results = []
            const loopFun = () => {
                console.log("TOTAL: ", count, "/", updateArray.length, "==", ((count * 100) / updateArray.length).toFixed(2));
                if(count >= updateArray.length) {
                    resolve(results)
                    console.log("END");
                    return;
                } else {
                    try {
                        let promises = [];
                        const startIndex = count;
                        const endIndex = count + perBatch;
                        count = endIndex;

                        for (let i = startIndex; i < endIndex; i++) {
                            const data = updateArray[i];
                            let schemaType = data && (data.private === true || data.private === false) ? SCHEMA_TYPE.SPRINTS : SCHEMA_TYPE.FOLDERS
                            if(data) {
                                promises.push(new Promise((resolve2, reject2) => {
                                    try {
                                        let query = {
                                            type: schemaType,
                                            data: data
                                        };
                                        MongoDbCrudOpration(cid, query, "save")
                                        .then((res) => {
                                            res.query = query;
                                            resolve2(res);
                                        })
                                        .catch((error) => {
                                            reject2(error)
                                        })
                                    } catch (error) {
                                        reject2(error)
                                    }
                                }))
                            }
                        }

                        Promise.allSettled(promises)
                        .then((result) => {
                            result.filter((x) => x.status === "rejected").forEach((x) => {
                                console.log(`UPDATE failed for: ${x}`)
                            })
                            results = [...results, ...result]
                            setTimeout(() => {
                                next();
                            }, 200);
                        })
                        .catch((error) => {
                            console.log(`UPDATE failed batch: ${batch} > ${error.message}`);
                            next();
                        })
                    } catch (e) {
                        console.error(`UPDATE failed batch: ${batch}${e}`)
                    }
                }
            }
            loopFun()
        } catch (error) {
            reject(error)
        }
    })
}

exports.migrateSprintsFun = async (req, res) => {
    try {
        let projects = await MongoDbCrudOpration(req.body.companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{}] }, "find");
        let mainChat = await MongoDbCrudOpration(req.body.companyId, { type: SCHEMA_TYPE.MAIN_CHATS, data: [{}] }, "find");
        projects = projects.concat(mainChat);
        console.log(projects.length,"length");

        // Process projects sequentially and collect all promises
        const migrateAll = () => new Promise((resolveMigration) => {
            let count = 0;
            const countFunction = (project) => {
                if (count >= projects.length) {
                    console.log(`END PROJECT`);
                    resolveMigration();
                    return;
                }
                exports.migrateProject(project, req.body.companyId)
                    .then(() => {
                        count++;
                        countFunction(projects[count]);
                    })
                    .catch((error) => {
                        console.error(error, `error in migrateProject ${project?._id}`);
                        count++;
                        countFunction(projects[count]);
                    });
            };
            countFunction(projects[count]);
        });

        await migrateAll().then(() => {
            res.send({ status: true, statusText: "done"});
        }).catch((error) => {
            console.log(`Error in migration Promise: ${error}`);
        });

    } catch (error) {
        res.send({ status: false, statusText: error});
        console.log(`Error in migration : ${error}`);
    }
};

exports.migrateProject = (project,companyId) => {
    return new Promise((resolve, reject) => {
        try {
            const { sprintsObj = {}, sprintsfolders = {} } = project;
            let folderPromise = [];
            let sprintPromise = [];
            const extractSprints = (sprints) => Object.values(sprints || {}).map(x => ({ ...x, projectId: project._id }));
            let sprints = [...extractSprints(sprintsObj || {}), ...(Object.keys(sprintsfolders).length > 0 ? extractSprints(Object.assign(...Object.values(sprintsfolders || {})?.map(x => x.sprintsObj || {}))) : [])];
            let folders = Object.values(sprintsfolders || {}).map((x) => ({...x,projectId : project._id}));
            folders = folders.map(folder => {
                const folderObj = {
                    name: folder.name,
                    deletedStatusKey: folder.deletedStatusKey || 0,
                    legacyId: folder.folderId,
                    projectId : folder.projectId
                };
                return folderObj;
            })
            let myArr = [...folders]
            folderPromise.push(batchUpdate(myArr, companyId));
            Promise.allSettled(folderPromise).then((response) => {
                console.log(`FOLDER UPDATE END ${project._id}`);
                let updatedFolders = response[0].value.map((result) => result.value);
                sprints = sprints.map(sprint => {
                    let sprintObj = {
                        name: sprint.name,
                        deletedStatusKey: sprint.deletedStatusKey || 0,
                        private: sprint.private || false,
                        AssigneeUserId: sprint.AssigneeUserId || [],
                        watchers: sprint.watchers || [],
                        favouriteTasks: sprint.favouriteTasks || [],
                        archiveTaskCount: sprint.archiveTaskCount || 0,
                        legacyId: sprint.id,
                        projectId : sprint.projectId
                    };
                    if(sprint.folderId){
                        sprintObj.folderId = new mongoose.Types.ObjectId(updatedFolders.find(x => x.legacyId === sprint.folderId)._id);
                    }
                    return sprintObj;
                })

                sprintPromise.push(batchUpdate(sprints, companyId));

                Promise.allSettled(sprintPromise).then(() => {
                    Promise.allSettled([exports.updateTaksSprints(JSON.parse(JSON.stringify(project._id)),companyId),exports.updateTaksFolders(JSON.parse(JSON.stringify(project._id)),companyId), updateCommentSprint(JSON.parse(JSON.stringify(project._id)),companyId)]).then(() => {
                        resolve();
                    }).catch((error) => {
                        console.log("Erro in update sprint and folders task");
                        reject(error);
                    })
                })
            }).catch((error) => {
                console.log(`Error in Promise folder and sprint: ${error}`);
            });
        } catch (error) {
            reject(error);
        }
    })
};

exports.updateTaksSprints = (projectId,companyId) => {
    return new Promise((resolve, reject) => {
        try {
            let findObj = {
                type: dbCollections.SPRINTS,
                data: [{ projectId: new mongoose.Types.ObjectId(projectId)}],
            };
            let updatePromises = [];
            MongoDbCrudOpration(companyId, findObj, "find").then(async(resp) => {
                resp.forEach((sprint) => {
                    let legacyId = sprint.legacyId ? sprint.legacyId : '';
                    let sprintId = JSON.parse(JSON.stringify(sprint._id));
                    if(legacyId){
                        const updateObj = {
                            type: SCHEMA_TYPE.TASKS,
                            data: [
                                { "sprintArray.id": {$in : [legacyId,sprintId]} , ProjectID: new mongoose.Types.ObjectId(projectId)},
                                { sprintId:  new mongoose.Types.ObjectId(sprintId)}
                            ]
                        }
                        const promise =  MongoDbCrudOpration(companyId,updateObj,"updateMany").then(() => {
                            console.log("IF DONE updateTaksSprints");
                        }).catch((err) => {
                            console.log(err,"ERROR IN IF UPDATE MANY");
                        })
                        updatePromises.push(promise);
                    }else{
                        const uObj = {
                            type: SCHEMA_TYPE.TASKS,
                            data: [
                                { "sprintArray.id": sprintId , ProjectID: new mongoose.Types.ObjectId(projectId)},
                                { "sprintId":  new mongoose.Types.ObjectId(sprintId)}
                            ]
                        }
                        const promise =  MongoDbCrudOpration(companyId,uObj,"updateMany").then(() => {
                            console.log("ELSE DONE updateTaksSprints");
                        }).catch((err) => {
                            console.log(err,"ERROR IN ELSE UPDATE MANY");
                        })
                        updatePromises.push(promise);
                    }
                })
            })
            Promise.allSettled(updatePromises).then(() => {
                resolve();
            }).catch((error) => {
                console.log(error,"ERROR IN ALL SETTLED");
                reject();
            });
        } catch (error) {
            console.log(error,"ERROR IN UPDATE SPRINTS:");
            reject();
        }
    })
}

exports.updateTaksFolders = (projectId,companyId) => {
    return new Promise((resolve, reject) => {
        try {
            let findObj = {
                type: dbCollections.FOLDERS,
                data: [{ projectId: new mongoose.Types.ObjectId(projectId)}],
            };
            let updatePromises = [];
            MongoDbCrudOpration(companyId, findObj, "find").then(async(resp) => {
                resp.forEach((folder) => {
                    let legacyId = folder.legacyId ? folder.legacyId : '';
                    let folderId = JSON.parse(JSON.stringify(folder._id));
                    if(legacyId){
                        const updateObj = {
                            type: SCHEMA_TYPE.TASKS,
                            data: [
                                {"sprintArray.folderId" :{ $exists: true},"sprintArray.folderId": {$in : [legacyId,folderId]} , ProjectID: new mongoose.Types.ObjectId(projectId)},
                                { folderObjId : new mongoose.Types.ObjectId(folderId)}
                            ]
                        }
                        const promise =  MongoDbCrudOpration(companyId,updateObj,"updateMany").then(() => {
                            console.log("IF DONE updateTaksFolders");
                        }).catch((err) => {
                            console.log(err,"ERROR IN IF UPDATE MANY");
                        })
                        updatePromises.push(promise);
                    }
                })
            })
            Promise.allSettled(updatePromises).then(() => {
                resolve();
            }).catch((error) => {
                console.log(error,"ERROR IN ALL SETTLED");
                reject();
            });
        } catch (error) {
            reject();
            console.log(error,"ERROR IN UPDATE FOLDERS:");
        }
    })
}
