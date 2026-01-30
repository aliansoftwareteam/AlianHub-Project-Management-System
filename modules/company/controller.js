const { SCHEMA_TYPE } = require("../../Config/schemaType.js");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries.js");
const iCtr = require('../import-settings/controller.js');
const helperCtr = require('../auth/controller/helper.js');
const logger = require('../../Config/loggerConfig.js');
const { addAndRemoveUserInMongodbNotificationCount } = require("../auth/controller.js");
const { default: mongoose } = require("mongoose");
const { emitListener } = require("./event-controller.js");
const serviceCtr = require("../service.js");
const serviceFunctionCtr = require("../serviceFunction.js");
const config =  require('../../Config/config.js');
const { dbCollections } = require("../../Config/collections.js");
const defaultSubscriptionDataRef = require("./default-subscription-data.js")
const { updateCompanyFun } = require("./controller/update-company.js");
const { updateUserFun } = require("../users-module/controller.js");
const { storeRefferalCode, checkAndStoreRefferalCode } = require("../affiliate/controller.js");
const { handleCreateCompanyDataStorageFunForUpload, handleCreateCompanyDataStorageFun } = require(`../../common-storage/common-${process.env.STORAGE_TYPE}.js`);


exports.setCompany = (companyId) => {
    return new Promise((resolve, reject) => {
        try {
            let axiosData = {
                "companyId": companyId
            }
            const allProcess = [
                handleCreateCompanyDataStorageFun({}, companyId),
                exports.importSettingsFun(axiosData), // Import Settings
            ];
            Promise.allSettled(allProcess).then((result)=>{
                let errors = result.filter((x) => x.status === "rejected");
                if (errors.length) {
                    reject("Company Creation error");
                } else {
                    resolve();
                }
            }).catch(()=>{
                reject("Company Creation error");
            })
        } catch (error) {
            reject(error.message ? error.message : error);
        }
    })
}


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
            .then((data) => {
                logger.info(`${JSON.stringify(dataObj.data._id)} >> COMPANY ADDED FOR GLOBAL DATABASE`);
                resolve({
                    status: true,
                    statusText: `${JSON.stringify(dataObj.data._id)} >> COMPANY ADDED FOR GLOBAL DATABASE`,
                    data: data
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
            axiosData.isFromBackend = true;
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
 * Company Validation
 * @param {Object} bodyData 
 * @param {Object} cb 
 * @returns 
 */
exports.companyValidation = (bodyData, cb) => {
    try {
        if (!(bodyData && bodyData.userId)) {
            cb({
                status: false,
                statusText: "userId is required"
            })
            return;
        }
        if (!(bodyData && bodyData.email)) {
            cb({
                status: false,
                statusText: "user email is required"
            })
            return;
        }
        if (!(bodyData && bodyData.companyName)) {
            cb({
                status: false,
                statusText: "companyName is required"
            })
            return;
        }
        if (!(bodyData && bodyData.phoneNumber)) {
            cb({
                status: false,
                statusText: "phoneNumber is required"
            })
            return;
        }
        if (!(bodyData && bodyData.country)) {
            cb({
                status: false,
                statusText: "country is required"
            })
            return;
        }
        if (!(bodyData && bodyData.countryCodeObj)) {
            cb({
                status: false,
                statusText: "countryCodeObj is required"
            })
            return;
        }
        if (!(bodyData && bodyData.logtimeDays)) {
            cb({
                status: false,
                statusText: "logtimeDays is required"
            })
            return;
        }
        if (!bodyData && bodyData.totalProjects !== undefined) {
            cb({
                status: false,
                statusText: "totalProjects is required"
            })
            return;
        }
        if (!bodyData || bodyData.isInactive === undefined) {
            cb({
                status: false,
                statusText: "isInactive is required"
            })
            return;
        }
        if (!bodyData || bodyData.isFree === undefined) {
            cb({
                status: false,
                statusText: "isFree is required"
            })
            return;
        }
        if (!(bodyData && bodyData.subscriptionData)) {
            cb({
                status: false,
                statusText: "subscriptionData is required"
            })
            return;
        }
        if (!(bodyData && bodyData.totalData)) {
            cb({
                status: false,
                statusText: "totalData is required"
            })
            return;
        }
        if (bodyData && bodyData.file) {
            if (!(bodyData && bodyData.fileName)) {
                cb({
                    status: false,
                    statusText: "fileName is required"
                })
                return;
            }
        }
        cb({
            status: true
        });
    } catch (error) {
        cb({
            status: false,
            statusText: "Something went to wrong."
        });
    }
};

exports.companyValidationFromAdmin = (bodyData, cb) => {
    try {
        if (!(bodyData && bodyData.email)) {
            cb({
                status: false,
                statusText: "user email is required"
            })
            return;
        }
        if (!(bodyData && bodyData.companyName)) {
            cb({
                status: false,
                statusText: "companyName is required"
            })
            return;
        }
        if (!(bodyData && bodyData.phoneNumber)) {
            cb({
                status: false,
                statusText: "phoneNumber is required"
            })
            return;
        }
        if (!(bodyData && bodyData.country)) {
            cb({
                status: false,
                statusText: "country is required"
            })
            return;
        }
        if (!(bodyData && bodyData.city)) {
            cb({
                status: false,
                statusText: "city is required"
            })
            return;
        }
        if (!(bodyData && bodyData.state)) {
            cb({
                status: false,
                statusText: "state is required"
            })
            return;
        }
        if (!(bodyData && bodyData.countryCodeObj)) {
            cb({
                status: false,
                statusText: "countryCodeObj is required"
            })
            return;
        }
        if (!(bodyData && bodyData.logtimeDays)) {
            cb({
                status: false,
                statusText: "logtimeDays is required"
            })
            return;
        }
        if (!bodyData && bodyData.totalProjects !== undefined) {
            cb({
                status: false,
                statusText: "totalProjects is required"
            })
            return;
        }
        if (!bodyData || bodyData.isInactive === undefined) {
            cb({
                status: false,
                statusText: "isInactive is required"
            })
            return;
        }
        if (!bodyData || bodyData.isFree === undefined) {
            cb({
                status: false,
                statusText: "isFree is required"
            })
            return;
        }
        if (!(bodyData && bodyData.subscriptionData)) {
            cb({
                status: false,
                statusText: "subscriptionData is required"
            })
            return;
        }
        if (!(bodyData && bodyData.totalData)) {
            cb({
                status: false,
                statusText: "totalData is required"
            })
            return;
        }
        if (bodyData && bodyData.file) {
            if (!(bodyData && bodyData.fileName)) {
                cb({
                    status: false,
                    statusText: "fileName is required"
                })
                return;
            }
        }
        cb({
            status: true
        });
    } catch (error) {
        cb({
            status: false,
            statusText: "Something went to wrong."
        });
    }
};

/**
 * Send Mail After Company Creation
 * @param {Object} allSettledRes 
 * @param {String} companyId 
 * @param {Object} req 
 */
exports.sendMailAfterCompanyCreation = (allSettledRes, companyId, req) => {
    const rejectedPromise = allSettledRes.filter((x) => x.status === "rejected") || [];
    logger.info(`${companyId} Company Creation rejectedPromise: ${rejectedPromise}`);
    // Send Error Mail
    if (rejectedPromise && rejectedPromise.length) {
        const subject = "AlianHub - Company Creation - Error Report";
        const toMail = config.ERRORRECIVEREMAIL;
        let html = "<p>Dear Developer,</p>";
        html += "<h3>Error Details:</h3>";
        html += "<ul>";
        html += `<li><strong>Date/Time:</strong> ${new Date()}</li>`;
        html += `<li><strong>Company Id:</strong> ${companyId}</li>`;
        html += `<li><strong>Error Message/Code:</strong> ${JSON.stringify(rejectedPromise, null, 4)}</li>`;
        html += `<li><strong>Environment:</strong> ${config.NODE_ENV}</li>`;
        html += `<li><strong>Browser/Device Information:</strong> ${req?.headers["user-agent"] || "Unknown"}</li>`;
        html += `</ul>`
        serviceCtr.sendAttachMail(subject, html, toMail, null, () => {
            logger.info(`Company Creation Error Email Send Successfully (${companyId}).`);
        });
    };
};

/**
 * Create Company V2
 * @param {Object} req 
 * @param {Object} res 
 */
exports.createCompanyV2 = (req, res) => {
    try {
        exports.companyValidation(req.body, async(validation) => {
            if (!validation.status) {
                res.json(validation);
                return
            }
            const bodyData = req.body;
            let resObject = await exports.checkFreeCompanyCounts(bodyData.userId);
            if (!resObject.isFree) {
                logger.info(`checkFreeCompanyCounts Errors:: ${bodyData.userId} reached the maximum limit for creating free companies. Upgrade to unlock more.`);
                emitListener(bodyData?.eventId, {step: "STOP",error: "You've reached the maximum limit for creating free companies.",freeCompanyLimitReached:true});
                res.json({
                    status: false,
                    statusText: "You've reached the maximum limit for creating free companies. Upgrade to unlock more.",
                    freeCompanyLimitReached:true
                });
                return;          
            }
            let obj = {
                type: SCHEMA_TYPE.PRECOMPANIES,
                data: [{
                    isAvailable: true,
                    pickupCount: 0
                },
                {
                    isAvailable: false,
                    $inc: {
                        pickupCount: 1
                    }
                }]
            }
            MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, obj, 'findOneAndUpdate')
            .then((compnayData) => {
                if (!(compnayData && compnayData._id)) {
                    logger.error(`Predefine comapny not found.`);
                    res.json({
                        status: false,
                        statusText: "Predefine comapny not found."
                    })
                    return;
                }
    
                emitListener(bodyData?.eventId, {step: 1});
                const companyMongoId = compnayData._id;
                const companyId = JSON.parse(JSON.stringify(compnayData._id));
                const companyObj = {
                    type : SCHEMA_TYPE.COMPANIES,
                    data: {
                        userId: bodyData.userId,
                        Cst_CompanyName:  bodyData.companyName,
                        Cst_Phone:  bodyData.phoneNumber,
                        Cst_Country: bodyData.country,
                        Cst_City: bodyData.city,
                        Cst_State: bodyData.state,
                        Cst_DialCode: bodyData.countryCodeObj,
                        Cst_LogTimeDays: bodyData.logtimeDays,
                        totalProjects: bodyData.totalProjects,
                        isInactive: bodyData.isInactive,
                        isFree: bodyData.isFree,
                        subscriptionData: bodyData.subscriptionData,
                        totalData :bodyData.totalData,
                        _id: companyMongoId,
                        companyData: [{users:1}],
                        Cst_stateCode: bodyData.Cst_stateCode,
                        Cst_countryCode: bodyData.Cst_countryCode
                    }
                }
                companyObj.data.planFeature = defaultSubscriptionDataRef.planObj;
                const importSettingsData = {
                    "companyId": companyId,
                    "uid": bodyData.userId,
                    "email": bodyData.email,
                };
                let userUpdateObj = {
                    type: SCHEMA_TYPE.USERS,
                    data: [
                        { _id: bodyData.userId },
                        { $push: { AssignCompany: companyId } },
                        false, // Upsert
                    ]
                }
                // Please don't change a array object position in allProcess Array
                const allProcess = [
                    () => exports.addAndRemoveUserInMongodbNotificationCountFun(companyId, bodyData.userId), // addAndRemoveUserInMongodbNotificationCount
                    () => exports.createCompanyGlobalFun(companyObj), // Create Company in Global Database
                    () => exports.importSettingsV2Fun(importSettingsData), // Import Settings
                    () => exports.updateCompnayIdInUserFun(userUpdateObj, companyId,bodyData.userId) // ADD COMPANY ID IN USER DOCUMENT AFTER THE PROCESS COMPLETE
                ];
                let paymentObj = {};
                serviceFunctionCtr.allSettledWithRetry(3, allProcess)
                .then(async(allSettledRes) => {
                    await handleCreateCompanyDataStorageFunForUpload(req.body, companyId)
                    emitListener(bodyData?.eventId, {step: "STOP",companyId:companyId});
                    if (process.env.PAYMENTMETHOD) {
                        paymentObj = allSettledRes[4].status === "fulfilled" ? allSettledRes[4].value : {}
                    }
                    await storeRefferalCode(companyId,bodyData.userId);
                    if (req.body.refferalCode && req.body.refferalCode !== '') {
                       await checkAndStoreRefferalCode(req.body.refferalCode,companyId,bodyData.userId);
                    }
                    res.send({
                        status: true,
                        statusText: "Company created successfully",
                        companyId: companyId,
                        companyData: allSettledRes[1].status === "fulfilled" ? allSettledRes[1].value : {},
                        paymentObj: paymentObj
                    });

                    exports.sendMailAfterCompanyCreation(allSettledRes, companyId, req);
                }).catch((error) => {
                    logger.error(`Company Creation Error All allSettledWithRetry (${companyId}) Error: ${error}.`);
                    emitListener(bodyData?.eventId, {step: "STOP", error: error?.message || error});
                    res.json({
                        status: false,
                        statusText: "Error" + error?.message
                    });
                });
            }).catch((error) => {
                logger.error(`ERROR in get tmp company data: ${error?.message || error}`);
                emitListener(bodyData?.eventId, {step: "STOP", error: error?.message || error});
                res.json({
                    status: false,
                    statusText: "Something went to wrong. Please contact to Admin.",
                    error: error?.message || error
                });
            })
        });
    } catch (error) {
        logger.error(`ERROR in create compnay v2 function: ${error?.message || error}`);
        res.json({
            status: false,
            statusText: "Something went to wrong. Please contact to Admin.",
            error: error?.message || error
        });
    }
};

exports.checkFreeCompanyCountsApi = (req,res) => {
    try {
        let userId = req.params.userId;
        if (!userId) {
            return res.status(400).json({
                status: false,
                statusText: "Bad request, userId is required."
            });
        }
        exports.checkFreeCompanyCounts(userId).then((result) => {
            res.json({
                status: true,
                statusText: "Success",
                isFree: result.isFree,
                companies: result?.companies ?? []
            });
        }).catch((error) => {
            logger.error(`Error in checkFreeCompanyCounts: ${error?.message || error}`);
            res.status(500).json({
                status: false,
                statusText: "Internal Server Error"
            });
        });
    } catch (error) {
        logger.error(`Unexpected Error in checkFreeCompanyCountsApi: ${error.message}`);
        res.status(500).json({
            status: false,
            statusText: "Internal Server Error"
        });
    }
}
exports.checkFreeCompanyCounts = (userId) => {
    return new Promise(async (resolve, reject) => {
        try {
            let PredefineCounts = parseInt(process.env.FREE_COMPANY_COUNT ?? "-1", 10);

            if (PredefineCounts === 0 || PredefineCounts === -1) {
                return resolve({ isFree: true });
            }

            let aggregationPipeline = [
                { $match: { userId: new mongoose.Types.ObjectId(userId) } },
                {
                    $lookup: {
                        from: "subscriptionPlan",
                        localField: "planFeature.planName",
                        foreignField: "planName",
                        as: "matchedPlan",
                    },
                },
                { $match: { "matchedPlan.defaultSubscribe": true } },
                {
                    $group: {
                        _id: "$userId",
                        defaultSubscriptionCount: { $sum: 1 },
                        Cst_CompanyName: { $push: "$Cst_CompanyName" }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        Cst_CompanyName: 1,
                        defaultSubscriptionCount: 1
                    }
                }
            ];

            MongoDbCrudOpration("global", { type: dbCollections.COMPANIES, data: [aggregationPipeline] }, "aggregate")
                .then((ele) => {
                    let count = ele?.[0]?.defaultSubscriptionCount ?? 0;
                    resolve({ isFree: count < PredefineCounts, companies: ele?.[0]?.Cst_CompanyName ?? [] });
                })
                .catch((error) => {
                    logger.error(`Error while getting referral mapping Aggregate: ${error.message}`);
                    return reject(error);
                });

        } catch (error) {
            logger.error(`Unexpected Error in checkFreeCompanyCounts: ${error.message}`);
            return reject(error);
        }
    });
};

exports.deleteCompany = (req, res) => {
    try {
        if (!(req.body && req.body.companyId)) {
            res.send({
                status: false,
                statusText: "CompanyId is required"
            })
            return;
        }
        mongoose.connect(process.env.MONGODB_URL+"/"+req.body.companyId);
        const connection = mongoose.connection;
        connection.once('open', () => {
            console.log("MongoDB database connection established successfully "+ req.body.companyId);
        });
        mongoose.connection.dropDatabase().then(() => {
            try {
                mongoose.connection.close();
                let delObj = {
                    type: SCHEMA_TYPE.COMPANIES,
                    data: [
                        {
                            _id: new mongoose.Types.ObjectId(req.body.companyId)
                        }
                    ]
                }
                updateCompanyFun(SCHEMA_TYPE.GOLBAL,delObj,"deleteOne",req.body.companyId)
                .then(() => {
                    let findObj = {
                        type: dbCollections.USERS,
                        data: [
                            {'AssignCompany': { $in: [req.body.companyId]}},
                            {
                                $pull: { 'AssignCompany': req.body.companyId }
                            }
                        ]
                    };

                    updateUserFun(dbCollections.GLOBAL,findObj,"updateMany",req.body.companyId,'',true)
                    .then(() => {
                        res.send({ status: true, statusText: "Done"});
                    }).catch((error) => {
                        res.send({ status: false, statusText: error});
                        console.error(error,"errorerror");
                    });
                })
            } catch (err) {
                res.send({ status: false, statusText: error});
                console.error(err,"ERROR IN CLOSE CONNECTION");
            }
        }).catch((error) => {
            res.send({ status: false, statusText: error});
            console.error(error,"ERROR IN DROP DATABASE");
        });
    } catch (error) {
        res.send({ status: false, statusText: error});
        console.error(error,"ERROR IN DELETE COMPANY:");
    }
}