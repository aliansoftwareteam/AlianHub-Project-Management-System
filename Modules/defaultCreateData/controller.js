// const AWS = require('aws-sdk');
const wasabiRef = require("../storage/wasabi/controller.js");
const fs = require("fs");
const { SCHEMA_TYPE } = require("../../Config/schemaType.js");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries.js");
const iCtr = require('../ImportSettings/controller.js');
const { addAndRemoveUserInMongodbNotificationCount } = require("../Auth/controller.js");
const logger = require('../../Config/loggerConfig.js');
const { default: mongoose } = require("mongoose");
const createUserRef = require("../Auth/controller/createUser.js");
const { dbCollections } = require("../../Config/collections.js");
const dataFileRef = require("./data.js");
const serviceCtr = require("../serviceFunction.js");
const { importRestrictedExtensions, importCustomFields } = require("../../utils/data");
const createProjectCtr = require("../createProject/controller.js")


/**
 * createCompanyDataWasabiFun
 * @param {Object} bodyData 
 * @param {String} companyId 
 * @returns 
 */
exports.createCompanyDataWasabiFun = (bodyData, companyId) => {
    logger.info(`Start Create Compnay Data Wasabi Function ${companyId}`);
    return new Promise((resolve, reject) => {
        try {
            if (bodyData && bodyData.file && bodyData.fileName) {
                wasabiRef.createCompanyDataWasabi(companyId, bodyData.fileName ,bodyData.file).then(()=>{
                    logger.info(`Done Create Compnay Data Wasabi Function ${companyId}`);
                    resolve({
                        status: true,
                        statusText: `${companyId} DONE WASABI CREATED`
                    });
                }).catch((error)=>{
                    logger.error(`Failed Create Compnay Data Wasabi Function ${companyId} : Error: ${error}`);
                    reject({
                        status: false,
                        error: error
                    });
                })
            } else {
                wasabiRef.createCompanyDataWasabi(companyId,{},"").then(()=>{
                    logger.info(`Done Create Compnay Data Wasabi Function ${companyId}`);
                    resolve({
                        status: true,
                        statusText: `${companyId} >> DONE WASABI CREATED`
                    });
                }).catch((error)=> {
                    logger.error(`Failed Create Compnay Data Wasabi Function ${companyId} : Error: ${error}`);
                    reject({
                        status: false,
                        error: error
                    });
                })
            }
        } catch (error) {
            logger.error(`Failed Create Compnay Data Wasabi Function 1 ${companyId} : Error: ${error}`);
            reject({
                status: false,
                error: error
            });
        }
    })
};


/**
 * addAndRemoveUserInMongodbNotificationCountFun
 * @param {String} companyId 
 * @param {String} userId 
 * @returns 
 */
exports.addAndRemoveUserInMongodbNotificationCountFun = (companyId, userId) => {
    logger.info(`Start add and remove user in mongodb notification count Function ${companyId}`);
    return new Promise((resolve, reject) => {
        try {
            addAndRemoveUserInMongodbNotificationCount(companyId,userId,"Add")
            .then(() => {
                logger.info(`Done add and remove user in mongodb notification count Function ${companyId}`);
                resolve({
                    status: true,
                    statusText: `${companyId} >> USER ADDED FOR COUNTING DOC`
                });
            })
            .catch((error)=>{
                logger.error(`Failed add and remove user in mongodb notification count Function ${companyId} : Error: ${error}`);
                reject({
                    status: false,
                    error: error,
                    statusText: `ERROR in create user count doc In mongodb: ${error}`
                });
            })
        } catch (error) {
            logger.error(`Failed add and remove user in mongodb notification count Function 1 ${companyId} : Error: ${error}`);
            reject({
                status: false,
                error: error
            });
        }
    })
};


/**
 * createCompanyGlobalFun
 * @param {Object} dataObj 
 * @returns 
 */
exports.createCompanyGlobalFun = (dataObj) => {
    logger.info(`Start Create Compnay Global Function ${dataObj.data._id}`);
    return new Promise((resolve, reject) => {
        try {
            MongoDbCrudOpration('global', dataObj, "save")
            .then(() => {
                logger.info(`Done Create Compnay Global Function ${dataObj.data._id}`);
                resolve({
                    status: true,
                    statusText: `${JSON.stringify(dataObj.data._id)} >> COMPANY ADDED FOR GLOBAL DATABASE`
                });
            })
            .catch((error)=>{
                logger.error(`Failed Create Compnay Global Function ${dataObj.data._id} : Error: ${error}`);
                reject({
                    status: false,
                    error: error,
                    statusText: `ERROR in COMPANY ADDED FOR GLOBAL DATABASE: ${error}`
                });
            })
        } catch (error) {
            logger.error(`Failed Create Compnay Global Function 1 ${dataObj.data._id} : Error: ${error}`);
            reject({
                status: false,
                error: error
            });
        }
    })
};


/**
 * importSettingsFun
 * @param {Object} axiosData 
 * @returns 
 */
exports.importSettingsFun = (axiosData) => {
    logger.info(`Start ImportSettings Function ${axiosData.companyId}`);
    return new Promise((resolve, reject) => {
        try {
            iCtr.importSettingsFunction({body: axiosData}, (result) => {
                if(result.status) {
                    logger.info(`Done ImportSettings Function ${axiosData.companyId}`);
                    resolve({
                        status: true,
                        statusText: `${axiosData.companyId} >> Done ImportSettings`
                    });
                } else {
                    logger.error(`Failed ImportSettings Function ${axiosData.companyId}`);
                    reject({
                        status: false,
                        statusText: `${axiosData.companyId} >> Failed ImportSettings`
                    });
                }
            });
        } catch (error) {
            logger.error(`Failed ImportSettings Function 1 ${axiosData.companyId} : Error: ${error}`);
            reject({
                status: false,
                error: error
            });
        }
    })
};



/**
 * updateCompnayIdInUserFun
 * @param {Object} userUpdateObj 
 * @param {String} companyId 
 * @returns 
 */
exports.updateCompnayIdInUserFun = (userUpdateObj, companyId) => {
    logger.info(`Start Update CompanyId In User Function ${companyId}`);
    return new Promise((resolve, reject) => {
        try {
            MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL,userUpdateObj,'findOneAndUpdate').then(() => {
                logger.info(`Done Update CompanyId In User Function ${companyId}`);
                resolve({
                    status: true,
                    statusText: `${companyId} >> UPDATE COMAPNY ID IN USER SUCCESS`
                });
            }).catch((error)=>{
                logger.error(`Failed Update CompanyId In User Function ${companyId} : Error: ${error}`);
                reject({
                    status: false,
                    error: error,
                    statusText: `${companyId} >> UPDATE COMAPNY ID IN USER FAILED`
                });
            })
        } catch (error) {
            logger.error(`Failed Update CompanyId In User Function 1 ${companyId} : Error: ${error}`);
            reject({
                status: false,
                error: error
            });
        }
    })
};

exports.createProject = (companyId, userId, cb) => {
    try {
        logger.info(`Start Create Project Function ${companyId}`);
        let cObj = {
            type: SCHEMA_TYPE.CURRENCY_LIST,
            data: [{
                code: "INR"
            }]
        }
        MongoDbCrudOpration(companyId,cObj,'find').then((cDataRes) => {
            let databaseRes = false;
            const itemA = (pRow, itemACb) => {    
                try {
                    pRow.ProjectCurrency = JSON.parse(JSON.stringify(cDataRes[0])) || cDataRes[0];
                    pRow.projectCreatedBy = userId;
                    pRow.CompanyId = companyId;
                    databaseRes = false;

                    const finalObj = {
                        body: pRow
                    }
                    createProjectCtr.createProject(finalObj).then(() => {
                        databaseRes = false;
                        itemACb();
                    }).catch((error) => {
                        databaseRes = true;
                        itemACb();
                    })
                } catch (err) {
                    databaseRes = true;
                    itemACb();
                }
            }
            const itemADone = () => {
                if (databaseRes) {
                    logger.error(`Failed Create Project Function ${companyId}`);
                    cb({
                        status: false,
                        error: "Create Project Error"
                    });
                    return;
                }
                logger.info(`Done Create Project Function ${companyId}`);
                cb({
                    status: true
                });
            }
            serviceCtr.customWaterfall(dataFileRef.projectArray, itemA, itemADone)
        }).catch((error)=>{
            logger.error(`Failed Create Project Function ${companyId} : Error ${error}`);
            cb({
                status: false,
                error: error
            })
        })
    } catch(error) {
        logger.error(`Failed Create Project Function ${companyId} : Error ${error}`);
        cb({
            status: false,
            error: error.message || error
        })
    }
}


/**
 * Create a new Company and Create Wasabi bucket, policy and user for that company.
 * @param {Objcet} data
 * @returns
 */
exports.createCompany = (data) => {
    logger.info(`Start Create Company Function`);
    return new Promise((resolve, reject) => {
        try {
            const companyMongoId = new mongoose.Types.ObjectId();
            const companyId = JSON.parse(JSON.stringify(companyMongoId));
            let obj = {
                userId: data.userId,
                Cst_CompanyName:  data.companyName,
                Cst_Phone:  data.phoneNumber,
                Cst_Country: data.country,
                Cst_City: data.city,
                Cst_State: data.state,
                Cst_DialCode: data.countryCodeObj,
                Cst_LogTimeDays: data.logtimeDays,
                totalProjects: data.totalProjects,
                isInactive: data.isInactive,
                isFree: data.isFree,
                subscriptionData: data.subscriptionData,
                totalData :data.totalData,
                _id: companyMongoId
            }
        
            const dataObj = {
                type : SCHEMA_TYPE.COMPANIES,
                data: obj
            }
            const axiosData = {
                "companyId": companyId,
                "uid": data.userId,
                "email": data.email,
            };
            let userUpdateObj = {
                type: SCHEMA_TYPE.USERS,
                data: [
                    { _id: data.userId },
                    { $push: { AssignCompany: companyId } },
                    false, // Upsert
                ]
            }
            const allProcess = [
                exports.createCompanyDataWasabiFun(data, companyId), // Create a new Bucket from Company Id
                exports.addAndRemoveUserInMongodbNotificationCountFun(companyId, data.userId), // addAndRemoveUserInMongodbNotificationCount
                exports.createCompanyGlobalFun(dataObj), // Create Company in Global Database
                exports.importSettingsFun(axiosData), // Import Settings
                exports.updateCompnayIdInUserFun(userUpdateObj, companyId) // ADD COMPANY ID IN USER DOCUMENT AFTER THE PROCESS COMPLETE
            ];
        
            Promise.allSettled(allProcess).then(async() => {
                setTimeout(() => {
                    setTimeout(() => {
                        let obj = {
                            type: dbCollections.COMPANIES,
                            data: [{
                                _id: companyId,
                            }, {
                                planFeature: dataFileRef.planObj
                            }]
                        }
                        logger.info(`Start Plan Update in company ${companyId}`);
                        MongoDbCrudOpration("global",obj,"findOneAndUpdate").then(()=>{
                            logger.info(`Done Plan Update in company ${companyId}`);
                            logger.info(`Start Create Admin User ${companyId}`);
                            exports.createUserGlobal(dataFileRef.adminUserObj, companyId, 2, (createUser) => {
                                if (!createUser.status) {
                                    logger.error(`Failed Create Admin User ${companyId} : Error: ${createUser}`);
                                    reject(createUser);
                                    return
                                }
                                logger.info(`Done Create Admin User ${companyId}`);
                                logger.info(`Start Create Member User ${companyId}`);
                                exports.createUserGlobal(dataFileRef.memberUserObj, companyId, 3, (createUser) => {
                                    if (!createUser.status) {
                                        logger.error(`Failed Create Member User ${companyId} : Error: ${createUser}`);
                                        reject(createUser);
                                        return
                                    }
                                    logger.info(`Done Create Member User ${companyId}`);
                                    exports.createProject(companyId, data.userId, (pDataRes) => {
                                        if (!pDataRes.status) {
                                            reject(pDataRes);
                                            return;
                                        }
                                        resolve("All Is Done.");
                                    });
                                })
                            })
                        }).catch((error)=>{
                            logger.error(`Failed Plan Update in company ${companyId} : Error: ${error}`);
                            reject(error);
                        })
                    }, 5000)
                });
            }).catch((error) => {
                reject(error);
            });
        } catch (error) {
            reject(error);
        }
    })
}

exports.createCompanyFromAPIFunction = (userId,obj) => {
    logger.info(`Start Create Company From API Function`);
    return new Promise((resolve, reject) => {
        try {
            let object = {
                userId: userId,
                companyName:  obj.companyName,
                phoneNumber:  obj.phoneNumber,
                country: obj.country,
                city: obj.city,
                state: obj.state,
                email: obj.email,
                countryCodeObj: obj.countryCodeObj,
                logtimeDays: 8,
                totalProjects: 0,
                isInactive: false,
                isFree: true,
                subscriptionData: {
                    storage : 0,
                    trackers: 0,
                    users :5
                },
                totalData :{
                    storage: 0,
                    trackers: 0,
                    users:1
                },
                eventId: obj.eventId
            }
            exports.createCompany(object).then(()=>{
                logger.info(`Done Create Company From API Function`);
                resolve();
            }).catch((error)=>{
                logger.error(`Failed Create Company From API Function : Error: ${error}`);
                reject(error);
            })
        } catch (error) {
            logger.error(`Failed Create Company From API Function 1 : Error: ${error}`);
            reject(error);
        }
    })
}

exports.createUserCompnay = (data, key, companyId, uid, cb) => {
    logger.info(`Start Create User Company Function ${companyId}`);
    try {
        const obj = {
            companyId: companyId,
            userId: uid,
            isDelete: false,
            roleType: key,
            status: 2,
            userEmail: data.email,
            designation : 0
        }
    
        const dataObj = {
            type : SCHEMA_TYPE.COMPANY_USERS,
            data: obj
        }
        MongoDbCrudOpration(companyId, dataObj, "save")
            .then(() => {
                logger.info(`Done Create User Company Function ${companyId}`);
                cb({
                    status: true,
                    statusText: `${JSON.stringify(dataObj.data)} >> USER ADDED FOR COMPANY DATABASE`
                });
            })
            .catch((error)=>{
                logger.error(`Failed Create User Company Function ${companyId} : Error: ${error}`);
                cb({
                    status: false,
                    error: error,
                    statusText: `ERROR in USER ADDED FOR COMPANY DATABASE: ${error}`
                });
            })
    } catch (error) {
        logger.error(`Failed Create User Company Function 1 ${companyId} : Error: ${error}`);
        cb({status: false, error: error.message || error});
    }
}
exports.createUserGlobal = (data, companyId, key, cb) => {
    const userObj = {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        password: data.password,
        isInvitation: true,
        assignCompany: companyId
    }
    createUserRef.addUserMongodbV2(userObj,response).then((respo)=>{
        exports.createUserCompnay(userObj, key, companyId, response.data._id, (createCompanyUserRes) => {
            if (!createCompanyUserRes.status) {
                cb(createCompanyUserRes);
                return;
            }
            cb({status: true, statusText: "user create successfully"})
        })
    }).catch((error)=>{
        cb({status: false, error: error});
    })
}

/**
 * Api for create user and company
 * @param {Obj} bodyData 
 * @param {Obj} cb 
 */ 
exports.createUserAndCompany = (bodyData, cb) => {
    try {
        if (!(bodyData && bodyData.email)) {
            cb({status: false, error:  "user email is required"});
            return;
        }
        if (!(bodyData && bodyData.companyName)) {
            cb({status: false, error:  "companyName is required"});
            return;
        }
        if (!(bodyData && bodyData.phoneNumber)) {
            cb({status: false, error:  "phoneNumber is required"});
            return;
        }
        if (!(bodyData && bodyData.country)) {
            cb({status: false, error:  "country is required"});
            return;
        }
        if (!(bodyData && bodyData.city)) {
            cb({status: false, error:  "city is required"});
            return;
        }
        if (!(bodyData && bodyData.state)) {
            cb({status: false, error:  "state is required"});
            return;
        }
        if (!(bodyData && bodyData.countryCodeObj)) {
            cb({status: false, error:  "countryCodeObj is required"});
            return;
        }
        if (!(bodyData && bodyData.firstName)) {
            cb({status: false, error:  "firstName is required"});
            return;
        }
        if (!(bodyData && bodyData.lastName)) {
            cb({status: false, error:  "lastName is required"});
            return;
        }
        if (!(bodyData && bodyData.password)) {
            cb({status: false, error:  "password is required"});
            return;
        }
        let obj = {
            type: dbCollections.USERS,
            data: [{}]
        }
        MongoDbCrudOpration("global",obj,"find").then((users)=>{
            if (users.length) {
                exports.importsMongoDbData("660a74e817c43b963ea051e7", () => {
                    cb({status: true, error: "Already Users"})
                });
            } else {
                let userObj = {
                    firstName: bodyData.firstName,
                    lastName: bodyData.lastName,
                    email: bodyData.email,
                    password: bodyData.password,
                    isInvitation: true,
                }
                createUserRef.addUserMongodbV2(userObj,response).then((respo)=>{
                    exports.createCompanyFromAPIFunction(respo.statusText._id,bodyData).then(()=>{
                        cb({status: true, statusText: "user and company create successfully"});
                    }).catch((error)=>{
                        cb({status: false, error: error});
                    })
                }).catch((error)=>{
                    cb({status: false, error: error});
                })
            }
        })

    } catch (error) {
        cb({status: false, error: error});
    }
}
exports.startInitialization = () => {
    return new Promise((resolve, reject) => {
        try {
            const promises = [];

            promises.push(
                // ADD RESTRICTED EXTENSIONS
                importRestrictedExtensions(SCHEMA_TYPE.GOLBAL)
            )
            promises.push(
                // ADD customField
                importCustomFields(SCHEMA_TYPE.GOLBAL)
            )

            Promise.allSettled(promises)
            .then((result) => {
                resolve({status: true});
            })
            .catch((error) => {
                reject({status: false, error: error});
            })
        } catch (error) {
            reject({status: false, error: error});
        }
    });
};

exports.removeUserFromMongo = (userData, cb) => {
    let databaseRes = false;
    const itemA = (data, itemACb) => {
        if (data.email === dataFileRef.createCompanyObj.email || data.email === dataFileRef.createCompanyObj.memberUserObj || data.email === dataFileRef.createCompanyObj.adminUserObj) {
            databaseRes = false;
            itemACb();
            return;
        }
        databaseRes = false;
        itemACb();
    }
    const itemADone = () => {
        if (databaseRes) {
            cb({
                status: false,
                error: "User Remove MongoDb Error"
            });
            return;
        }
        cb({
            status: true
        });
    }
    serviceCtr.customWaterfall(userData, itemA, itemADone)
}


exports.dropDatabase = (cb) => {
    let collectionNameArray = ["global"];
    let databaseRes = false;
    try {
        const getUserObj = {
            type: SCHEMA_TYPE.USERS,
            data: []
        }
        MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL,getUserObj,'find').then((userData) => {
            collectionNameArray = [];
            collectionNameArray.push("global");
            const itemA = (data, itemACb) => {
                if (data.email === dataFileRef.createCompanyObj.email || data.email === dataFileRef.createCompanyObj.memberUserObj || data.email === dataFileRef.createCompanyObj.adminUserObj) {
                    databaseRes = false;
                    itemACb();
                    return;
                }
                let obj = {
                    type: SCHEMA_TYPE.USERS,
                    collection:SCHEMA_TYPE.USERS,
                    data: [
                        {
                            _id: new mongoose.Types.ObjectId(data._id)
                        },
                    ]
                }
                MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, obj, "deleteOne").then(() => {
                    databaseRes = false;
                    setTimeout(() => {
                        itemACb();
                    }, 1000);
                }).catch((error) => {
                    databaseRes = true;
                    itemACb();
                })
            }
            const itemADone = () => {
                if (databaseRes) {
                    cb({
                        status: false,
                        error: "Remove User From Global Database Error"
                    });
                    return;
                }
                exports.removeUserFromMongo(userData, (rUser) => {
                    if (!rUser.status) {
                        cb(rUser);
                        return;
                    }
                    cb({
                        status: true
                    });
                })
            }
            serviceCtr.customWaterfall(userData, itemA, itemADone)
        }).catch(() => {
            logger.info(`Get User Data Error: ${error}`);
            cb({
                status: false,
                error: error
            })
        })
    } catch (error) {
        logger.error(`Drop Database Error: ${error.message || error}`);
        cb({
            status: false,
            error: error.message || error
        });
    }
}

exports.addDefaultdata = () => {
    logger.info(`Start Create Defaule Database Cron`);
    try {
        logger.info(`Start Drop Database Function`);
        exports.dropDatabase((data) => {
            if (!data.status) {
                logger.error(`Failed Drop Database Function`);
                return;
            }
            logger.info(`Done Drop Database Function`);
            logger.info(`Start Initialization Function`);
            exports.startInitialization().then((initializationRes) => {
                logger.info(`Done Initialization Function`);
                logger.info(`Start Create User And Company Function`);
                exports.createUserAndCompany(dataFileRef.createCompanyObj, (createCompanyRes) => {
                    if (!createCompanyRes.status) {
                        logger.error(`Failed Create User And Company Function : Error: ${createCompanyRes}`);
                        return;
                    }
                    logger.info(`Done Create User And Company Function`);
                    logger.info(`All Step Is Done`);
                    logger.info(`Done Create Defaule Database Cron`);
                });
            }).catch((error) => {
                logger.error(`Failed Initialization Function : Error: ${error}`);
            })
        })
    } catch (error) {
        logger.error(`Filed Create Defaule Database Cron : Error: ${error.message || error}`);
    }
};


exports.createdefaultcompany = (req, res) => {
    try {
        exports.addDefaultdata();
        res.json({
            status: true,
            statusText: "Your Processing is start."
        })
    } catch (error) {
        res.json({
            status: false,
            error: error.message || error
        })
    }
}


exports.importsMongoDbData = (companyId, cb) => {
    try {
        console.log(`Start Import MongoDb Data`);
        const fixDate = 1711996200000;
        const currentDateStart = new Date().setHours(0, 0, 0, 0);
        const gapDays = currentDateStart - fixDate;
        fs.readdir(__dirname + "/./mongoDbData", function (err, files) {
            if (err) {
                console.log(`Error Import MongoDb Data: ${err}`);
                return
            }
            const collectionNames = []
            //listing all files using forEach
            files.forEach(function (file) {
                collectionNames.push(file.substring(0, file.lastIndexOf('.')));
            });
            console.log("collectionNames", collectionNames)
            // collectionNames.push("tasks", "projects");
            if (!(collectionNames && collectionNames.length)) {
                console.log(`Failed Import MongoDb Data Collection not found.`)
                return;
            }
            const collectionErrorNames = [];

            const itemA = (data, itemACb) => {
                let obj = {
                    type: data,
                    data: [{}]
                }
                console.log(`Start Delete Collection ${data}`);
                MongoDbCrudOpration(companyId, obj, "deleteMany").then((deleteRes) => {
                    console.log(`Done Delete Collection ${data} Res: ${deleteRes}`);
                    let JSONData = require("./mongoDbData/"+data+".json");
                    const currentData = new Date().getTime();
                    JSONData = JSONData.map((x) => {
                        const updatedAt = x.updatedAt;
                        const createdAt = x.createdAt;
                        delete x.createdAt;
                        delete x.updatedAt;
                        let finalData = {
                            ...x,
                            _id: x._id["$oid"]
                        };
                        if (data === "sprints") {
                            finalData.projectId = x.projectId["$oid"];
                        }
                        if (data === "estimated_time") {
                            finalData.Date = new Date(new Date(x.Date["$date"]).getTime() + (gapDays));
                        }
                        if (data === "timesheets") {
                            finalData.LogStartTime = x.LogStartTime + ((gapDays/1000));
                            finalData.LogEndTime = x.LogEndTime + ((gapDays/1000));

                            if (x.logAddType == 1) {
                                if (x.startTimeTracker) {
                                    finalData.startTimeTracker = x.startTimeTracker + ((gapDays/1000));
                                }
                                finalData.CreatedAt = Number(x.CreatedAt["$numberLong"]) + gapDays;
                                finalData.UpdatedAt = Number(x.UpdatedAt["$numberLong"]) + gapDays;
                                if (x.trackShots && x.trackShots.length) {
                                    const trackShots = x.trackShots.map((ts) => {
                                        const strokes = ts.strokes && ts.strokes.length ?
                                            ts.strokes.map((st) => {
                                                const oldSt = st[Object.keys(st)[0]];
                                                const oldSt1 = Object.keys(st)[0];
                                                const finalObj = {
                                                    [(Number(oldSt1) + gapDays).toString()]: oldSt
                                                }
                                                delete st;
                                                return finalObj
                                            })
                                            : []
                                        return {
                                            ...ts,
                                            prevscreenShot: (Number(ts.prevscreenShot) + gapDays).toString(),
                                            screenShotTime: (Number(ts.screenShotTime) + gapDays).toString(),
                                            strokes: JSON.parse(JSON.stringify(strokes, null, 4)),
                                        }
                                    })
                                    finalData.trackShots = trackShots;
                                }
                            }
                        }
                        if (data === "history") {
                            finalData.updatedAt = updatedAt["$date"];
                            finalData.createdAt = createdAt["$date"];
                        }
                        if (data === "projects") {
                            finalData.DueDate = x.DueDate["$date"];
                            finalData.StartDate = x.StartDate["$date"];
                            finalData.EndDate = x.EndDate["$date"];
                            finalData.ProjectRequiredComponent = x.ProjectRequiredComponent.map((yy) => {return {...yy, createdAt: yy?.createdAt?.["$date"] ? new Date(yy?.createdAt?.["$date"]) : new Date(), updatedAt: yy?.updatedAt?.["$date"] ? new Date(yy?.updatedAt?.["$date"]) : new Date()}});
                            finalData.apps = x.apps.map((yy) => {return {...yy, createdAt: yy?.createdAt?.["$date"] ? new Date(yy?.createdAt?.["$date"]) : new Date(), updatedAt: yy?.updatedAt?.["$date"] ? new Date(yy?.updatedAt?.["$date"]) : new Date()}});
                            finalData.dueDateDeadLine = x.dueDateDeadLine.map((yy) => {return {...yy, date: yy?.date?.["$date"] ? new Date(yy?.date?.["$date"]) : new Date()}})
                            finalData.lastProjectActivity = new Date().getTime() / 1000;
                        }

                        if (data === "tasks") {
                            let currentDateStart = new Date().setHours(0);
                            currentDateStart = new Date(currentDateStart).setMinutes(0);
                            currentDateStart = new Date(currentDateStart).setSeconds(0);
                            currentDateStart = new Date(currentDateStart).setMilliseconds(0);


                            finalData.ProjectID = x.ProjectID["$oid"];
                            finalData.CompanyId = x.CompanyId["$oid"];
                            finalData.sprintId = x.sprintId["$oid"]
                            finalData.dueDateDeadLine = x.dueDateDeadLine.map((yy) => {
                                return {
                                    ...yy, 
                                    date: yy?.date?.["$date"] ? new Date(new Date(yy.date["$date"]).getTime() + (gapDays)) : new Date()
                                }
                            })
                            if (x.startDate) {
                                finalData.startDate = new Date(new Date(x.startDate["$date"]).getTime() + (gapDays));
                            }
                            if (x.DueDate) {
                                finalData.DueDate = new Date(new Date(x.DueDate["$date"]).getTime() + (gapDays));
                            }
                        }
                        return finalData;
                    })
                    let finalObj = {
                        type: data,
                        data: [JSONData]
                    }
                    console.log(`Start Insert Collection ${data}`);
                    MongoDbCrudOpration(companyId, finalObj, "insertMany").then(()=>{
                        console.log(`Done Insert Collection ${data}`);
                        itemACb();
                    }).catch((error) => {
                        console.log(`Error Insert Collection ${data} Error: ${error}`);
                        collectionErrorNames.push(data);
                        itemACb();
                    });
                }).catch((error) => {
                    console.log(`Error Delete Collection ${data} Error: ${error}`);
                    collectionErrorNames.push(data);
                    itemACb();
                });
            }
            const itemADone = () => {
                if (collectionErrorNames && collectionErrorNames.length) {
                    // Send Here to Error Mail
                    cb({
                        status: true,
                        collectionErrorNames,
                        error: "Import Collection in Error"
                    });
                    return;
                }
                cb({
                    status: true,
                    statusText: "Import Collection is successfully."
                });
            }
            serviceCtr.customWaterfall(collectionNames, itemA, itemADone)
        });
    } catch (error) {
        console.log(`Import MongoDb Data error: ${error.message || error}`);
    }
}

// exports.importsMongoDbData("660a74e817c43b963ea051e7", (data) => {
//     console.log(">>>>>>>>>>>>> data", data);
// });