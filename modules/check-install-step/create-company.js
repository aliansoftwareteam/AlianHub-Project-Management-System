// const AWS = require('aws-sdk');
const { SCHEMA_TYPE } = require("../../Config/schemaType.js");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries.js");
const iCtr = require('../import-settings/controller.js');
const { addAndRemoveUserInMongodbNotificationCount } = require("../auth/controller.js");
const logger = require('../../Config/loggerConfig.js');
const { default: mongoose } = require("mongoose");
const { emitListener } = require("./event-controller.js");
const createUserRef = require("../auth/controller/create-user.js");
const sendMailRef = require("../auth/controller/send-verification-mail.js")
const { dbCollections } = require("../../Config/collections.js");
// const { installSteps, envVar } = require("./controller.js");
const mainCtr = require("./controller.js");
const installStepsFilePath = __dirname + "/../../installationSteps.json";
const defaultSubscriptionDataRef = require("./default-subscription-data.js")
const serviceFun = require("../serviceFunction.js");
const { updateCompanyFun } = require("../company/controller/update-company.js");
const { updateUserFun, getUserByQueyFun } = require("../users-module/controller.js");
const { storeRefferalCode } = require("../affiliate/controller.js");
const { handleCreateCompanyDataStorageFun } = require(`../../common-storage/common-${process.env.STORAGE_TYPE}.js`);



/**
 * addAndRemoveUserInMongodbNotificationCountFun
 * @param {String} companyId 
 * @param {String} userId 
 * @returns 
 */
exports.addAndRemoveUserInMongodbNotificationCountFun = (companyId, userId) => {
    return new Promise((resolve, reject) => {
        try {
            addAndRemoveUserInMongodbNotificationCount(companyId,userId,"Add")
            .then(() => {
                logger.info(`${companyId} >> USER ADDED FOR COUNTING DOC`);
                resolve({
                    status: true,
                    statusText: `${companyId} >> USER ADDED FOR COUNTING DOC`
                });
            })
            .catch((error)=>{
                logger.error(`ERROR in create user count doc In mongodb: ${error}`)
                reject({
                    status: false,
                    error: error,
                    statusText: `ERROR in create user count doc In mongodb: ${error}`
                });
            })
        } catch (error) {
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
    return new Promise((resolve, reject) => {
        try {
            MongoDbCrudOpration('global', dataObj, "save")
            .then(() => {
                logger.info(`${JSON.stringify(dataObj.data._id)} >> COMPANY ADDED FOR GLOBAL DATABASE`);
                resolve({
                    status: true,
                    statusText: `${JSON.stringify(dataObj.data._id)} >> COMPANY ADDED FOR GLOBAL DATABASE`
                });
            })
            .catch((error)=>{
                logger.error(`ERROR in COMPANY ADDED FOR GLOBAL DATABASE: ${error}`)
                reject({
                    status: false,
                    error: error,
                    statusText: `ERROR in COMPANY ADDED FOR GLOBAL DATABASE: ${error}`
                });
            })
        } catch (error) {
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
    return new Promise((resolve, reject) => {
        try {
            iCtr.importSettingsFunction({body: axiosData}, (result) => {
                if(result.status) {
                    logger.info(`${axiosData.companyId} >> ADD SETTINGS SUCCESS`);
                    resolve({
                        status: true,
                        statusText: `${axiosData.companyId} >> ADD SETTINGS SUCCESS`
                    });
                } else {
                    logger.info(`${axiosData.companyId} >> ADD SETTINGS FAILED`);
                    reject({
                        status: false,
                        error: error,
                        statusText: `${axiosData.companyId} >> ADD SETTINGS FAILED`
                    });
                }
            });
        } catch (error) {
            reject({
                status: false,
                error: error
            });
        }
    })
};


/**
 * importSettingsFun V2
 * @param {Object} axiosData 
 * @returns 
 */
exports.importSettingsV2Fun = (axiosData) => {
    return new Promise((resolve, reject) => {
        try {
            iCtr.importSettingsV2Function({body: axiosData}, (result) => {
                if(result.status) {
                    logger.info(`${axiosData.companyId} >> ADD SETTINGS SUCCESS`);
                    resolve({
                        status: true,
                        statusText: `${axiosData.companyId} >> ADD SETTINGS SUCCESS`
                    });
                } else {
                    logger.info(`${axiosData.companyId} >> ADD SETTINGS FAILED`);
                    reject({
                        status: false,
                        error: result?.statusText || "ERROR in add settings",
                        statusText: `${axiosData.companyId} >> ADD SETTINGS FAILED`
                    });
                }
            });
        } catch (error) {
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
exports.updateCompnayIdInUserFun = (userUpdateObj, companyId,userId) => {
    return new Promise((resolve, reject) => {
        try {
            updateUserFun(SCHEMA_TYPE.GOLBAL,userUpdateObj,'findOneAndUpdate',companyId,userId)
            .then(() => {
                logger.info(`${companyId} >> UPDATE COMAPNY ID IN USER SUCCESS`);
                resolve({
                    status: true,
                    statusText: `${companyId} >> UPDATE COMAPNY ID IN USER SUCCESS`
                });
            }).catch((error)=>{
                logger.info(`${companyId} >> UPDATE COMAPNY ID IN USER FAILED`);
                reject({
                    status: false,
                    error: error,
                    statusText: `${companyId} >> UPDATE COMAPNY ID IN USER FAILED`
                });
            })
        } catch (error) {
            reject({
                status: false,
                error: error
            });
        }
    })
};


/**
 * Create a new Company and Create Wasabi bucket, policy and user for that company.
 * @param {Objcet} req
 * @param {Object} res
 * @returns
 */
exports.createCompany = (data) => {
    return new Promise((resolve, reject) => {
        try {
            // emitListener(data?.eventId, {step: 1});
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
                _id: companyMongoId,
                companyData: [{users:1}]
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
            setTimeout(() => {
                emitListener(data?.eventId, {step: 2});
            }, 3000);
            const allProcess = [
                handleCreateCompanyDataStorageFun(data, companyId), // Create a new Bucket from Company Id
                exports.addAndRemoveUserInMongodbNotificationCountFun(companyId, data.userId), // addAndRemoveUserInMongodbNotificationCount
                exports.createCompanyGlobalFun(dataObj), // Create Company in Global Database
                exports.importSettingsFun(axiosData), // Import Settings
            ];
        
            Promise.allSettled(allProcess).then(async() => {
                await exports.updateCompnayIdInUserFun(userUpdateObj, companyId,data.userId) // ADD COMPANY ID IN USER DOCUMENT AFTER THE PROCESS COMPLETE
                setTimeout(() => {
                    emitListener(data?.eventId, {step: 3});
                    resolve(companyId);
                }, 3000);
                setTimeout(() => {
                    setTimeout(() => {
                        emitListener(data?.eventId, {step: 4});
                        setTimeout(() => {
                            emitListener(data?.eventId, {step: 5});
                            let obj = {
                                type: dbCollections.COMPANIES,
                                data: [{
                                    _id: companyId,
                                }, {
                                    planFeature: defaultSubscriptionDataRef.planObj
                                }]
                            }
                            updateCompanyFun(SCHEMA_TYPE.GOLBAL,obj,"findOneAndUpdate",companyId)
                            .then(async()=>{
                                await storeRefferalCode(companyId,data.userId);
                                mainCtr.installSteps[7].status = "done";
                                serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: mainCtr.installSteps, envVar: mainCtr.envVar}, null, 4), () => {
                                    setTimeout(() => {
                                        emitListener(data?.eventId, {step: "STOP"});
                                    }, 3000);
                                    logger.info(`${companyId} >> ADD After Snap PERMISSIONS`);
                                });
                            }).catch((error)=>{
                                emitListener(data?.eventId, {step: "STOP", error: error?.message || error});
                                logger.error(`ERROR in add after snapshot: ${error.message}`);
                            })
                        }, 5000)
                    }, 5000)
                });
            }).catch((error) => {
                emitListener(data?.eventId, {step: "STOP", error: error?.message || error});
                reject(error);
            });
        } catch (error) {
            emitListener(data?.eventId, {step: "STOP", error: error?.message || error});
            reject(error);
        }
    })
}



/**
 * Api for create user and company
 * @param {Obj} req 
 * @param {Obj} res 
 */ 
exports.createUserAndCompany = (req,res) => {
    try {
        // emitListener(req.body?.eventId, {step: 1});
        mainCtr.installSteps[7].status = "inprogress";
        serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: mainCtr.installSteps, envVar: mainCtr.envVar}, null, 4), () => {
            if (!(req.body && req.body.email)) {
                mainCtr.installSteps[7].status = "error";
                serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: mainCtr.installSteps, envVar: mainCtr.envVar}, null, 4), () => {
                    res.status(400).json({message:  "user email is required"});
                    emitListener(req.body?.eventId, {step: "STOP", error: "user email is required"});
                });
                return;
            }
            if (!(req.body && req.body.companyName)) {
                mainCtr.installSteps[7].status = "error";
                serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: mainCtr.installSteps, envVar: mainCtr.envVar}, null, 4), () => {
                    res.status(400).json({message:  "companyName is required"});
                    emitListener(req.body?.eventId, {step: "STOP", error: "companyName is required"});
                });
                return;
            }
            if (!(req.body && req.body.phoneNumber)) {
                mainCtr.installSteps[7].status = "error";
                serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: mainCtr.installSteps, envVar: mainCtr.envVar}, null, 4), () => {
                    res.status(400).json({message:  "phoneNumber is required"});
                    emitListener(req.body?.eventId, {step: "STOP", error: "phoneNumber is required"});
                });
                return;
            }
            if (!(req.body && req.body.country)) {
                mainCtr.installSteps[7].status = "error";
                serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: mainCtr.installSteps, envVar: mainCtr.envVar}, null, 4), () => {
                    res.status(400).json({message:  "country is required"});
                    emitListener(req.body?.eventId, {step: "STOP", error: "country is required"});
                });
                return;
            }
            if (!(req.body && req.body.city)) {
                mainCtr.installSteps[7].status = "error";
                serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: mainCtr.installSteps, envVar: mainCtr.envVar}, null, 4), () => {
                    res.status(400).json({message:  "city is required"});
                    emitListener(req.body?.eventId, {step: "STOP", error: "city is required"});
                });
                return;
            }
            if (!(req.body && req.body.state)) {
                mainCtr.installSteps[7].status = "error";
                serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: mainCtr.installSteps, envVar: mainCtr.envVar}, null, 4), () => {
                    res.status(400).json({message:  "state is required"});
                    emitListener(req.body?.eventId, {step: "STOP", error: "state is required"});
                });
                return;
            }
            if (!(req.body && req.body.countryCodeObj)) {
                mainCtr.installSteps[7].status = "error";
                serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: mainCtr.installSteps, envVar: mainCtr.envVar}, null, 4), () => {
                    res.status(400).json({message:  "countryCodeObj is required"});
                    emitListener(req.body?.eventId, {step: "STOP", error: "countryCodeObj is required"});
                });
                return;
            }
            if (!(req.body && req.body.firstName)) {
                mainCtr.installSteps[7].status = "error";
                serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: mainCtr.installSteps, envVar: mainCtr.envVar}, null, 4), () => {
                    res.status(400).json({message:  "firstName is required"});
                    emitListener(req.body?.eventId, {step: "STOP", error: "firstName is required"});
                });
                return;
            }
            if (!(req.body && req.body.lastName)) {
                mainCtr.installSteps[7].status = "error";
                serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: mainCtr.installSteps, envVar: mainCtr.envVar}, null, 4), () => {
                    res.status(400).json({message:  "lastName is required"});
                    emitListener(req.body?.eventId, {step: "STOP", error: "lastName is required"});
                });
                return;
            }
            if (!(req.body && req.body.password)) {
                mainCtr.installSteps[7].status = "error";
                serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: mainCtr.installSteps, envVar: mainCtr.envVar}, null, 4), () => {
                    res.status(400).json({message:  "password is required"});
                    emitListener(req.body?.eventId, {step: "STOP", error: "password is required"});
                });
                return;
            }
            getUserByQueyFun().then((users)=>{
                if (users.length) {
                    res.status(420).json({message: "Already Users"})
                } else {
                    let userObj = {
                        firstName: req.body.firstName,
                        lastName: req.body.lastName,
                        email: req.body.email,
                        password: req.body.password,
                        isInvitation: false,
                        isProductOwner: true
                    }
                    createUserRef.addUserMongodbV2(userObj).then((respo)=>{
                        sendMailRef.sendVerificationEmailPromise(respo.statusText._id,respo.statusText.Employee_Email).catch((error)=>{
                            logger.error(error.statusText);
                        })
                        emitListener(req.body?.eventId, {step: 1});
                        exports.createCompanyFromAPIFunction(respo.statusText._id,req.body).then(()=>{
                            mainCtr.installSteps[7].status = "done";
                            serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: mainCtr.installSteps, envVar: mainCtr.envVar}, null, 4), () => {
                                res.status(200).json({message: "user and company create successfully"})
                            });
                        }).catch((error)=>{
                            mainCtr.installSteps[7].status = "error";
                            serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: mainCtr.installSteps, envVar: mainCtr.envVar}, null, 4), () => {
                                res.status(400).json({message: error});
                            });
                        })
                    }).catch((error)=>{
                        mainCtr.installSteps[7].status = "error";
                        serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: mainCtr.installSteps, envVar: mainCtr.envVar}, null, 4), () => {
                            res.status(400).json({message: error});
                        });
                    })
                }
            })
        });

    } catch (error) {
        mainCtr.installSteps[7].status = "error";
        serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: mainCtr.installSteps, envVar: mainCtr.envVar}, null, 4), () => {
            emitListener(req.body?.eventId, {step: "STOP", error: error?.message || error});
            res.status(400).json({message: error});
        });
    }
}


exports.createCompanyFromAPIFunction = (userId,obj) => {
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
                resolve();
            }).catch((error)=>{
                console.log(error);
            })
        } catch (error) {
            reject(error);
        }
    })
}