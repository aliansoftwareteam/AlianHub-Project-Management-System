const { SCHEMA_TYPE } = require("../../Config/schemaType.js");
const { removeCache } = require("../../utils/commonFunctions.js");
const { MongoDbCrudOpration, dropCompanyDatabase } = require("../../utils/mongo-handler/mongoQueries.js");
const iCtr = require('../ImportSettings/controller.js');
const { ensureNotificationDefaults } = require('../notification/defaults');
const vectorStore = require('../Knowledge/vectorStore');
const helperCtr = require('../Auth/controller/helper.js');
const logger = require('../../Config/loggerConfig.js');
const { addAndRemoveUserInMongodbNotificationCount } = require("../Auth/controller.js");
const { default: mongoose } = require("mongoose");
const { emitListener } = require("./eventController.js");
const serviceCtr = require("../service.js");
const serviceFunctionCtr = require("../serviceFunction.js");
const config =  require('../../Config/config.js');
const { dbCollections } = require("../../Config/collections.js");
const { updateCompanyFun } = require("./controller/updateCompany.js");
const { updateUserFun } = require("../Users/controller.js");
const { storeRefferalCode, checkAndStoreRefferalCode } = require("../Affiliate/controller.js");
const { handleCreateCompanyDataStorageFunForUpload, handleCreateCompanyDataStorageFun } = require(`../../common-storage/common-${process.env.STORAGE_TYPE}.js`);
const { seedSampleProject } = require("../createProject/sampleProject.js");
const { ensureViewCatalogue } = require("../projectTabs/catalogue.js");
const { normaliseFocus, FOCUS_LABELS } = require("../createProject/sampleTasks.js");
const { pinSessionTenant } = require("../../Config/tenant.js");
const { getRoleType, ROLE_OWNER } = require("../../Config/permissionGuard.js");
const { escapeHtml } = require('../../utils/escapeHtml');
const { WORKSPACE_FAILURE, failureReply } = require('./helpers/workspaceFailure');
const { NEW_COMPANY_PLAN, companyRowFor } = require('./helpers/companyRow');

const TEAM_SIZES = ["1", "2-15", "16-50", "50+"];


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
        if (!(bodyData && typeof bodyData.companyName === "string" && bodyData.companyName.trim())) {
            cb({
                status: false,
                statusText: "companyName is required"
            })
            return;
        }
        if (bodyData.teamSize !== undefined && bodyData.teamSize !== "" && !TEAM_SIZES.includes(String(bodyData.teamSize))) {
            cb({
                status: false,
                statusText: "teamSize is invalid"
            })
            return;
        }
        if (bodyData.teamFocus !== undefined && bodyData.teamFocus !== "" && !FOCUS_LABELS[normaliseFocus(bodyData.teamFocus)]) {
            cb({
                status: false,
                statusText: "teamFocus is invalid"
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

const reasonOf = (failure) => failure?.statusText || failure?.error?.message || failure?.message || String(failure?.error || failure);

exports.sendMailAfterCompanyCreation = (problems, companyId, req) => {
    if (!problems.length) return;
    logger.info(`${companyId} Company Creation problems: ${JSON.stringify(problems)}`);
    const subject = "AlianHub - Company Creation - Error Report";
    const toMail = config.ERRORRECIVEREMAIL;
    let html = "<p>Dear Developer,</p>";
    html += "<h3>Error Details:</h3>";
    html += "<ul>";
    html += `<li><strong>Date/Time:</strong> ${new Date()}</li>`;
    html += `<li><strong>Company Id:</strong> ${companyId}</li>`;
    html += `<li><strong>Error Message/Code:</strong> ${escapeHtml(JSON.stringify(problems, null, 4))}</li>`;
    html += `<li><strong>Environment:</strong> ${config.NODE_ENV}</li>`;
    html += `<li><strong>Browser/Device Information:</strong> ${escapeHtml(req?.headers["user-agent"] || "Unknown")}</li>`;
    html += `</ul>`
    serviceCtr.sendAttachMail(subject, html, toMail, null, () => {
        logger.info(`Company Creation Error Email Send Successfully (${companyId}).`);
    });
};

const CREATION_TRIES = 3;

// Only the operator's preset route fills the ready-made companies, so a fresh install has none waiting.
const prepareCompanyNow = async () => {
    const reserved = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
        type: SCHEMA_TYPE.PRECOMPANIES,
        data: { isAvailable: false, pickupCount: 1 }
    }, 'save');
    await exports.setCompany(String(reserved._id));
    return reserved;
};

const takeCompany = async () => {
    const readyCompany = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
        type: SCHEMA_TYPE.PRECOMPANIES,
        data: [{ isAvailable: true, pickupCount: 0 }, { isAvailable: false, $inc: { pickupCount: 1 } }]
    }, 'findOneAndUpdate');
    return readyCompany && readyCompany._id ? readyCompany : prepareCompanyNow();
};

const COMPANY_ROW = "the company row";

/* `needed` marks what a workspace cannot open without: its own row, the owner's seat in it, and the company on the
 * owner's account. Without the unread counter row the workspace opens and only its unread counts are missing. */
const creationSteps = (companyMongoId, bodyData) => {
    const companyId = String(companyMongoId);
    const { userId, email } = bodyData;
    return [
        { name: "the unread counter row", needed: false, run: () => exports.addAndRemoveUserInMongodbNotificationCountFun(companyId, userId) },
        { name: COMPANY_ROW, needed: true, run: () => exports.createCompanyGlobalFun(companyRowFor(companyMongoId, bodyData)) },
        { name: "the owner's seat and notification settings", needed: true, run: () => exports.importSettingsV2Fun({ companyId, uid: userId, email }) },
        { name: "the company on the owner's account", needed: true, run: () => exports.updateCompnayIdInUserFun({
            type: SCHEMA_TYPE.USERS,
            data: [{ _id: userId }, { $push: { AssignCompany: companyId } }, false]
        }, companyId, userId) },
    ];
};

/* Takes back what an unfinished creation wrote, so the same person can try again under the same name. A company
 * row left behind would also count against the person's free workspaces. The prepared database stays reserved: one
 * that has just failed is not handed to the next sign-up. Answers the names of what could not be taken back. */
const undoCreation = async (companyMongoId, userId) => {
    const companyId = String(companyMongoId);
    const ownRowsOf = (type) => () => MongoDbCrudOpration(companyId, { type, data: [{ userId }] }, 'deleteMany');
    const takeBack = [
        { name: "the company on the owner's account", run: () => updateUserFun(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.USERS,
            data: [{ _id: userId }, { $pull: { AssignCompany: companyId } }]
        }, 'updateOne', companyId, userId) },
        { name: "the owner's seat", run: ownRowsOf(SCHEMA_TYPE.COMPANY_USERS) },
        { name: "the owner's notification settings", run: ownRowsOf(SCHEMA_TYPE.NOTIFICATIONS_SETTINGS) },
        { name: "the unread counter row", run: ownRowsOf(SCHEMA_TYPE.USERID) },
        { name: COMPANY_ROW, run: () => updateCompanyFun(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.COMPANIES,
            data: [{ _id: companyMongoId, userId }]
        }, 'deleteOne', companyId) },
    ];
    const results = await Promise.allSettled(takeBack.map((step) => step.run()));
    removeCache(`company_users:${companyId}`);
    return takeBack.filter((step, index) => results[index].status === "rejected").map((step) => step.name);
};

exports.createCompanyV2 = async (req, res) => {
    try {
        if (!req.uid) return res.status(401).json({ status: false, statusText: "Unauthorized" });
        const account = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.USERS,
            data: [{ _id: new mongoose.Types.ObjectId(String(req.uid)) }, { Employee_Email: 1 }]
        }, 'findOne');
        if (!(account && account.Employee_Email)) return res.status(401).json({ status: false, statusText: "Unauthorized" });
        req.body = { ...(req.body || {}), ...NEW_COMPANY_PLAN(), userId: String(req.uid), email: account.Employee_Email };
        const bodyData = req.body;
        const validation = await new Promise((resolve) => exports.companyValidation(bodyData, resolve));
        if (!validation.status) return res.json(failureReply(WORKSPACE_FAILURE.INVALID_DETAILS, validation.statusText));

        const resObject = await exports.checkFreeCompanyCounts(bodyData.userId);
        if (!resObject.isFree) {
            logger.info(`checkFreeCompanyCounts Errors:: ${bodyData.userId} reached the maximum limit for creating free companies. Upgrade to unlock more.`);
            emitListener(bodyData.eventId, {step: "STOP",error: "You've reached the maximum limit for creating free companies.",freeCompanyLimitReached:true});
            return res.json({
                status: false,
                statusText: "You've reached the maximum limit for creating free companies. Upgrade to unlock more.",
                freeCompanyLimitReached:true
            });
        }

        const refuse = (failure) => {
            emitListener(bodyData.eventId, { step: "STOP", error: failure.statusText, code: failure.code });
            return res.json(failureReply(failure));
        };

        let company;
        try {
            company = await takeCompany();
        } catch (error) {
            logger.error(`ERROR in get tmp company data: ${error?.message || error}`);
            return refuse(WORKSPACE_FAILURE.NOT_PREPARED);
        }
        emitListener(bodyData.eventId, {step: 1});
        const companyId = String(company._id);

        const steps = creationSteps(company._id, bodyData);
        const settled = await serviceFunctionCtr.allSettledWithRetry(CREATION_TRIES, steps.map((step) => step.run));
        const outcomeOf = (name) => settled[steps.findIndex((step) => step.name === name)];
        const failedSteps = steps.filter((step) => outcomeOf(step.name).status === "rejected");
        const problems = failedSteps.map((step) => ({ step: step.name, reason: reasonOf(outcomeOf(step.name).reason) }));

        if (failedSteps.some((step) => step.needed)) {
            logger.error(`Company creation (${companyId}) could not finish: ${failedSteps.map((step) => step.name).join(", ")}`);
            const leftBehind = await undoCreation(company._id, bodyData.userId);
            exports.sendMailAfterCompanyCreation([...problems, { step: "taking the unfinished workspace back", leftBehind }], companyId, req);
            return refuse(WORKSPACE_FAILURE.NOT_FINISHED);
        }

        const withoutStopping = async (name, run) => {
            try {
                await run();
            } catch (error) {
                logger.error(`Company creation (${companyId}) went on without ${name}: ${reasonOf(error)}`);
                problems.push({ step: name, reason: reasonOf(error) });
            }
        };
        // The storage was made when the company was prepared: only a logo sent with the request is stored here.
        await withoutStopping("the logo", () => handleCreateCompanyDataStorageFunForUpload(bodyData, companyId));
        // A preset company may have been seeded before the catalogue import stopped wiping and refilling.
        await withoutStopping("the project views", () => ensureViewCatalogue(companyId));
        if (bodyData.teamFocus && bodyData.seedSampleProject !== false) {
            emitListener(bodyData.eventId, {step: 2});
            await withoutStopping("the sample project", () => seedSampleProject({ companyId, uid: bodyData.userId, teamFocus: bodyData.teamFocus }));
        }
        await withoutStopping("the notification defaults", () => ensureNotificationDefaults(companyId, bodyData.userId));
        vectorStore.prepareCompany(companyId);
        await withoutStopping("the referral code", async () => {
            await storeRefferalCode(companyId, bodyData.userId);
            if (bodyData.refferalCode && bodyData.refferalCode !== '') {
                await checkAndStoreRefferalCode(bodyData.refferalCode, companyId, bodyData.userId);
            }
        });

        // The page opens the workspace on this message as well as on the reply, so it is said only now.
        emitListener(bodyData.eventId, {step: "STOP", companyId});
        res.send({
            status: true,
            statusText: "Company created successfully",
            companyId,
            companyData: outcomeOf(COMPANY_ROW).value,
            paymentObj: {}
        });
        exports.sendMailAfterCompanyCreation(problems, companyId, req);
    } catch (error) {
        logger.error(`ERROR in create compnay v2 function: ${error?.message || error}`);
        if (!res.headersSent) res.json(failureReply(WORKSPACE_FAILURE.SERVER_ERROR));
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
        if (String(userId) !== String(req.uid || '')) {
            return res.json({ status: true, statusText: "Success", isFree: true, companies: [] });
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

/* Destroys the tenant's whole database, so it is gated harder than any other company write:
 * the owner of the company the verified session names, who has typed that company's name back.
 * The role is read against the pinned tenant, not the header, so the company being judged and
 * the company being dropped cannot be two different ones. */
exports.deleteCompany = async (req, res) => {
    const refuse = (code, statusText) => res.status(code).send({ status: false, statusText });
    try {
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        if (req.apiToken) return refuse(403, "An API token cannot delete a company.");

        const roleType = await getRoleType(companyId, req.uid);
        if (roleType !== ROLE_OWNER) return refuse(403, "Only the company owner can delete this company.");

        const company = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.COMPANIES,
            data: [{ _id: new mongoose.Types.ObjectId(companyId) }, { Cst_CompanyName: 1 }],
        }, "findOne");
        if (!company) return refuse(404, "No such company.");
        if (String(req.body.confirm || "") !== String(company.Cst_CompanyName || "")) {
            return refuse(400, "Type the company name to confirm the deletion.");
        }

        const companyRow = { _id: new mongoose.Types.ObjectId(companyId) };
        const markDeleting = (update) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.COMPANIES, data: [companyRow, update] }, "updateOne");
        await markDeleting({ $set: { deletingAt: new Date() } });
        try {
            await dropCompanyDatabase(companyId);
        } catch (error) {
            await markDeleting({ $unset: { deletingAt: 1 } }).catch(() => {});
            throw error;
        }

        const delObj = {
            type: SCHEMA_TYPE.COMPANIES,
            data: [{ _id: new mongoose.Types.ObjectId(companyId) }],
        };
        await updateCompanyFun(SCHEMA_TYPE.GOLBAL, delObj, "deleteOne", companyId);

        const findObj = {
            type: dbCollections.USERS,
            data: [
                { 'AssignCompany': { $in: [companyId] } },
                { $pull: { 'AssignCompany': companyId } },
            ],
        };
        await updateUserFun(dbCollections.GLOBAL, findObj, "updateMany", companyId, '', true);
        // A cached membership or role would let the next request pass and reopen, so recreate, the database.
        removeCache(companyId, true);

        logger.info(`Company ${companyId} deleted by ${req.uid}`);
        return res.send({ status: true, statusText: "Done" });
    } catch (error) {
        logger.error(`ERROR in delete company: ${error.message || error}`);
        return refuse(500, "Could not delete the company.");
    }
}