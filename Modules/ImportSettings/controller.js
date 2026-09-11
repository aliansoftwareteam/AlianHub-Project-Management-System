const logger = require("../../Config/loggerConfig");
const importData = require('../../utils/data');
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { removeCache } = require('../../utils/commonFunctions');
const { tenantOf } = require('../../Config/tenant');
const { ROLE_OWNER, getRoleType, isPrivileged, evaluatePermission, isWritable } = require('../../Config/permissionGuard');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const forbidden = (res, statusText) => res.status(403).send({ status: false, statusText });
const failed = (res, error) => res.status(error.statusCode || 500).send({ status: false, statusText: error.message });

async function batchUpdate(arr) {
    return new Promise((resolve, reject) => {
        try {
            // tasks BATCH FUNCTION
            let count = 0;
            let batch = 1;
            const perBatch = 8;
            const next = () => {
                batch++;
                loopFun();
            }

            let results = []
            const loopFun = () => {
                logger.info(`TOTAL: ${count} / ${arr.length} == ${((count * 100) / arr.length).toFixed(2)}`);
                if(count >= arr.length) {
                    resolve(results)
                    logger.info("END");
                    return;
                } else {
                    try {
                        let promises = [];
                        const startIndex = count;
                        const endIndex = count + perBatch;
                        count = endIndex;

                        for (let i = startIndex; i < endIndex; i++) {
                            const data = arr[i]

                            if(data) {
                                promises.push(importData[data.name].apply(null, data.params))
                                logger.info(`DATA FOR: ${data.name}`);
                            }
                        }

                        Promise.allSettled(promises)
                            .then((result) => {
                                const failedUpdates = result.filter(x => x.status === "rejected");

                                if (failedUpdates.length > 0) {
                                    reject(new Error(`Batch update stopped due to failure in batch ${batch}`));
                                    return;
                                }
                                results = [...results, ...result]
                                setTimeout(() => {
                                    next();
                                }, 200);
                            })
                            .catch((error) => {
                                logger.error(`UPDATE failed batch: ${batch} > ${error.message}`);
                                reject(new Error(`Batch update failed: ${error.message}`));
                            });

                    } catch (e) {
                        console.error(`UPDATE failed batch: ${batch}`);
                        reject(new Error(`Unexpected error in batch ${batch}`));
                    }
                }
            }
            loopFun()
        } catch (error) {
            reject(error)
        }
    })
}

exports.importSettingsFunction = (req, cb) => {
    try {

        //Request variables
        const { companyId, uid, email, rules, isFromBackend } = req.body;

        //Validations
        if(!companyId || companyId === '') {
            cb({
                status: false,
                statusText: "Company id is required."
            });
            return;
        }

        if (!isFromBackend) {
            if((rules === undefined || rules.includes("importCompanyUserOwner")) && (!email || email === '')) {
                cb({
                    status: false,
                    statusText: "Email id is required."
                });
                return;
            }
    
            if((rules === undefined || rules.includes("importUserNotifications") || rules.includes("importCompanyUserOwner")) &&  (!uid || uid === '')) {
                cb({
                    status: false,
                    statusText: "User id is required."
                });
                return;
            }
        }

        let allRules = [
            "importProjectCategories",
            "importHourlyMilestoneRange",
            "importHourlyMilestoneWeeklyRange",
            "importProjectPriorities",
            "importProjectMilestone",
            "importCommonDateFormat",
            "importCommonExtension",
            "importCompanyUserStatus",
            "importCompanyRules",
            "importCompanyRoles",
            "importCurrency",
            "importProjectTabComponents",
            "importProjectApps",
            // "importUserNotifications",
            "importTaskStatusTemplate",
            "importTaskTypeTemplate",
            "createDefaultMainChats",
            "importProjectStatusTemplate",
            // "importCompanyUserOwner",
            "importTaskDefaultStatus",
            "importProjectStatus",
            "importStatusType",
            "importCompanyDesignations",
            "importProjectSkills"
        ]

        if (!isFromBackend) {
            allRules = allRules.concat(['importUserNotifications','importCompanyUserOwner'])
        }
        const rulesToBeApplied = allRules.filter((x) => rules === undefined || rules.includes(x))?.map((rule) => {
            let obj = {
                name: rule
            };

            switch(rule) {
                case "importUserNotifications":
                    obj.params = [companyId, uid]
                    break;

                case "importCompanyUserOwner": {
                    const dataObj = {
                        companyId: companyId,
                        userId: uid,
                        isDelete: false,
                        roleType: 1,
                        status: 2,
                        userEmail: email,
                        designation : 0
                    }
                    const queryObj = {
                        type : SCHEMA_TYPE.COMPANY_USERS,
                        data: [
                            {userId : uid},
                            {$set: { ...dataObj }},
                            { upsert: true }
                        ]
                    }
                    obj.params = [companyId, queryObj]
                    break;
                }

                default:
                    obj.params = [companyId]
                    break;
            }

            return obj;
        });

        batchUpdate(rulesToBeApplied)
        .then(() => {
            removeCache(`company_users:${companyId}`);
            cb({
                status: true,
                statusText: "Settings has been imported successfully"
            })
        })
        .catch((error) => {
            console.error(`ERROR in import company settings: ${error.messge}`);
            logger.error(`ERROR in import company settings: ${error.messge}`);
            cb({
                status: false,
                statusText: error.messge
            });
        });

    } catch (error) {
        logger.error(`Import Default Settings Catch Error: ${error.messge}`);
        cb({
            status: false,
            statusText: error.messge
        });
    }
};


exports.importSettingsV2Function = (req, cb) => {
    try {

        //Request variables
        const { companyId, uid, email, rules } = req.body;

        //Validations
        if(!companyId || companyId === '') {
            cb({
                status: false,
                statusText: "Company id is required."
            });
            return;
        }

        if((rules === undefined || rules.includes("importCompanyUserOwner")) && (!email || email === '')) {
            cb({
                status: false,
                statusText: "Email id is required."
            });
            return;
        }

        if((rules === undefined || rules.includes("importUserNotifications") || rules.includes("importCompanyUserOwner")) &&  (!uid || uid === '')) {
            cb({
                status: false,
                statusText: "User id is required."
            });
            return;
        }

        const allRules = [
            "importCompanyUserOwner",
            "importUserNotifications"
        ]

        const rulesToBeApplied = allRules.filter((x) => rules === undefined || rules.includes(x))?.map((rule) => {
            let obj = {
                name: rule
            };

            switch(rule) {
                case "importUserNotifications":
                    obj.params = [companyId, uid]
                    break;

                case "importCompanyUserOwner": {
                    const dataObj = {
                        companyId: companyId,
                        userId: uid,
                        isDelete: false,
                        roleType: 1,
                        status: 2,
                        userEmail: email,
                        designation : 0
                    }
                    const queryObj = {
                        type : SCHEMA_TYPE.COMPANY_USERS,
                        data: [
                            {userId : uid},
                            {$set: { ...dataObj }},
                            { upsert: true }
                        ]
                    }
                    obj.params = [companyId, queryObj]
                    break;
                }

                default:
                    obj.params = [companyId]
                    break;
            }

            return obj;
        });

        batchUpdate(rulesToBeApplied)
        .then(() => {
            removeCache(`company_users:${companyId}`);
            cb({
                status: true,
                statusText: "Settings has been imported successfully"
            })
        })
        .catch((error) => {
            console.error(`ERROR in import company settings: ${error.messge}`);
            logger.error(`ERROR in import company settings: ${error.messge}`);
            cb({
                status: false,
                statusText: error.messge
            });
        });

    } catch (error) {
        logger.error(`Import Default Settings Catch Error: ${error.messge}`);
        cb({
            status: false,
            statusText: error.messge
        });
    }
};

// The company-wide path wipes and re-inserts the rules collection; the project
// path only adds rules for one project, which is what the project permission
// sidebar (gated on settings_security_permissions) applies.
exports.importSettingsProjectFunction = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const { type, projectId } = req.body || {};
        const roleType = await getRoleType(companyId, req.uid);
        if (type === 'project') {
            if (!OBJECT_ID.test(String(projectId || ''))) {
                return res.status(400).send({ status: false, statusText: 'A valid project id is required.' });
            }
            const allowed = isPrivileged(roleType) || isWritable(await evaluatePermission(companyId, req.uid, 'settings.settings_security_permissions'));
            if (!allowed) return forbidden(res, 'You do not have permission to change project permissions.');
        } else if (!isPrivileged(roleType)) {
            return forbidden(res, 'Only an owner or admin can re-import company rules.');
        }
        const response = await importData.importCompanyRules(companyId, type, projectId);
        return res.send({ status: true, statusText: 'Settings has been imported successfully', data: response });
    } catch (error) {
        logger.error(`Error in import project rules: ${error.message}`);
        return failed(res, error);
    }
};

// Owner only: the full import upserts an owner company_users row for the caller,
// so letting an admin run it would promote them.
exports.importSettings = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        if (await getRoleType(companyId, req.uid) !== ROLE_OWNER) {
            return forbidden(res, 'Only the company owner can re-import company settings.');
        }
        const { email, rules } = req.body || {};
        exports.importSettingsFunction({ body: { companyId, uid: String(req.uid), email, rules } }, (cData) => res.send(cData));
    } catch (error) {
        logger.error(`Import Default Settings Catch Error: ${error.message}`);
        return failed(res, error);
    }
};

exports.importTemplate = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        if (!isPrivileged(await getRoleType(companyId, req.uid))) {
            return forbidden(res, 'Only an owner or admin can import templates.');
        }
        const templates = req.body && req.body.templates;
        if (!(Array.isArray(templates) && templates.length)) {
            return res.json({ status: false, statusText: 'template is required.' });
        }
        importData.importSettingTemplate(companyId, templates, (data) => res.json(data));
    } catch (error) {
        logger.error(`Import template error: ${error.message}`);
        return failed(res, error);
    }
};

exports.importSettingsNotification = (req, res) => {
    try {

        //Request variables
        const { companyId, userId} = req.body;

        //Validations
        if(!companyId || companyId === '') {
            res.send({
                status: false,
                statusText: "Company id is required."
            });
            return;
        }
        if(!userId || userId === '') {
            res.send({
                status: false,
                statusText: "User id is required."
            });
            return;
        }
        if (String(userId) !== String(req.uid) || String(companyId) !== String(req.headers.companyid)) {
            res.status(403).send({
                status: false,
                statusText: "You can only import your own notification settings."
            });
            return;
        }
        importData.importUserNotifications(companyId,userId).then(() => {
            res.send({
                status: true,
                statusText: "Notification Settings has been imported successfully"
            });
        }).catch((err) => {
            logger.error(`Error in import Notification Settings rules: ${err}`);
            res.send({
                status: false,
                statusText: err
            });
        })
    } catch (error) {
        logger.error(`Import Default Settings Catch Error: ${error}`);
        res.send({
            status: false,
            statusText: error
        });
    }
};
