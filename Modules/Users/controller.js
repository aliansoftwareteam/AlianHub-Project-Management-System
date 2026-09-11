const { myCache } = require("../../Config/config.js");
const { dbCollections } = require("../../Config/collections.js");
const logger = require("../../Config/loggerConfig");
const { SCHEMA_TYPE } = require("../../Config/schemaType.js");
const { removeCache } = require("../../utils/commonFunctions.js");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries.js");
const mongoose = require("mongoose")
const {
    isObjectId, toSelfView, toMemberView, sharedCompanies, sanitizeUserQuery, scopeQueryToCompany,
    sanitizeSelfUpdate, companyRemovalOf, sanitizeUpdateOptions,
} = require("./helpers/userAccessRules.js");

const refuse = (res, code, message) => res.status(code).json({ status: false, statusText: message, message });

const loadGlobalUser = (id) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
    type: SCHEMA_TYPE.USERS,
    data: [{ _id: new mongoose.Types.ObjectId(String(id)) }]
}, 'findOne');

exports.updateUserStatus = async (req, res) => {
    const { userId, updateObject, newObj } = req.body || {};
    if (!req.uid) return refuse(res, 401, 'Unauthorized');
    if (!isObjectId(userId)) return refuse(res, 400, 'userId is required');
    if (!updateObject) return refuse(res, 400, 'updateObject is required');

    try {
        let update;
        let view;
        let afterUpdate = () => {};
        if (String(userId) === String(req.uid)) {
            const checked = sanitizeSelfUpdate(updateObject);
            if (!checked.ok) return refuse(res, 403, checked.error);
            const selected = checked.update.$set.lastSelectedCompany;
            if (selected !== undefined) {
                const me = await loadGlobalUser(req.uid);
                if (!sharedCompanies(me, { AssignCompany: [selected] }).length) return refuse(res, 403, 'You are not a member of that company.');
            }
            update = checked.update;
            view = toSelfView;
        } else {
            const companyId = companyRemovalOf(updateObject);
            if (!companyId || req.apiToken) return refuse(res, 403, 'You can only update your own profile.');
            const { getRoleType, isPrivileged, ROLE_OWNER } = require("../../Config/permissionGuard.js");
            const callerRole = await getRoleType(companyId, req.uid);
            const targetRole = await getRoleType(companyId, userId);
            if (!isPrivileged(callerRole) || targetRole === null || targetRole === ROLE_OWNER) {
                return refuse(res, 403, 'Only an owner or admin of that company can remove this member.');
            }
            const me = await loadGlobalUser(req.uid);
            update = { $pull: { AssignCompany: companyId } };
            view = (doc) => toMemberView(doc, (me && me.AssignCompany) || []);
            afterUpdate = () => require("../../Config/jwt.js").invalidateMembershipCache(String(userId), companyId);
        }

        const obj = {
            type: dbCollections.USERS,
            data: [{ _id: new mongoose.Types.ObjectId(String(userId)) }, update, sanitizeUpdateOptions(newObj)]
        };
        const response = await MongoDbCrudOpration('global', obj, "findOneAndUpdate");
        removeCache(`UserData:${userId}`);
        removeCache('UserAllData:', true);
        afterUpdate();
        return res.send({
            status: true,
            statusText: "User Status Updated",
            data: response ? view(response) : response
        });
    } catch (error) {
        logger.error(`USER STATUS UPDATE ERROR updateUserStatus: ${error.message || error}`);
        return refuse(res, 400, "User Status Not Updated");
    }
}

exports.checkUserAndCompany = (req, res) => {
    if(!req.body.userId) {
        res.send({status: false, message: 'userId is required'});
        return;
    }
    let obj = {
        type: dbCollections.USERS,
        data: [
            {
                _id : new mongoose.Types.ObjectId(req.body.userId)
            }
        ]
    }

    // BUG-027 / #81 fix: this handler has six different res.send sites
    // across nested .then / .catch chains. Pre-fix, a sync throw in
    // res.send (e.g. ERR_HTTP_HEADERS_SENT triggered by middleware) on
    // the inner .then could land in the inner .catch which would also
    // try to res.send — and the outer .catch would do it a third time.
    // Wrap every res.send through a `sendOnce` so duplicate writes are
    // suppressed instead of throwing.
    let responded = false;
    const sendOnce = (payload) => {
        if (responded) {
            logger.warn('checkUserAndCompany suppressed a duplicate res.send');
            return;
        }
        responded = true;
        res.send(payload);
    };

    try {
        MongoDbCrudOpration('global', obj, "findOne").then((response)=>{
            if(response && response.isEmailVerified === false) {
                sendOnce({
                    status: false,
                    statusText: "Email Not Verified",
                    data: {userData:response}
                });
                return;
            }
            if(response && response.AssignCompany && response.AssignCompany.length > 0) {
                const exists = response?.AssignCompany?.includes(response?.lastSelectedCompany);
                let cObj = {
                    type: dbCollections.COMPANIES,
                    data: [
                        {
                            _id: { $in: exists ? [new mongoose.Types.ObjectId(response?.lastSelectedCompany)] : [...response.AssignCompany.map((x) => new mongoose.Types.ObjectId(x))] },
                            isDisable: { $in : [false,undefined]}
                        }
                    ]
                }

                const allObj = {
                    type: dbCollections.COMPANIES,
                    data: [
                        { _id: { $in: response.AssignCompany.map((x) => new mongoose.Types.ObjectId(x)) } },
                        { Cst_CompanyName: 1, Cst_profileImage: 1, isDisable: 1 }
                    ]
                }
                // The workspace switcher on the login screen needs every workspace, not only the last one.
                const companiesPromise = MongoDbCrudOpration('global', allObj, "find")
                    .then((list) => (list || []).map((c) => ({ _id: c._id, Cst_CompanyName: c.Cst_CompanyName, Cst_profileImage: c.Cst_profileImage || '', isDisable: c.isDisable === true })))
                    .catch(() => []);

                Promise.all([MongoDbCrudOpration('global', cObj, "findOne"), companiesPromise]).then(([company, companies])=>{
                    if(company) {
                        sendOnce({
                            status: true,
                            statusText: "Comapny Found",
                            data: {isCompanyFind: true,companyId: company._id,userData:response, companies}
                        });
                        return;
                    } else {
                        sendOnce({
                            status: true,
                            statusText: "Comapny Not Found",
                            data: {isCompanyFind: false,companyId: '',userData:response}
                        });
                        return;
                    }
                }).catch((error)=>{
                    sendOnce({
                        status: false,
                        statusText: "Comapny Not Found",
                        data: {isCompanyFind: false,companyId: '',userData:response}
                    });
                    logger.error('USER STATUS UPDATE ERROR checkUserAndCompany: ',error);
                })

            } else {
                sendOnce({
                    status: true,
                    statusText: "Comapny Not Found",
                    data: {isCompanyFind: false,companyId: '',userData:response}
                });
                return;
            }
        }).catch((error)=>{
            sendOnce({
                status: false,
                statusText: "User Not Found",
                data: {isCompanyFind: false,companyId: '',userData: null}
            });
            logger.error('USER STATUS UPDATE ERROR checkUserAndCompany: ',error);
        })
    } catch (error) {
        sendOnce({
            status: false,
            statusText: "User Not Found",
            data: {}
        });
        logger.error('USER STATUS UPDATE ERROR checkUserAndCompany: ',error);
    }
}

exports.getUserById = async(req, res) => {
    try {
        if (!req.uid) return refuse(res, 401, 'Unauthorized');
        let { id } = req.params;
        const { query } = req.query;

        if(!id) {
            return res.status(400).json({
                status: false,
                message: 'id is required.'
            });
        }

        const customerCacheKey = `customerId:${id}`;
        let key = '_id';

        if (query === 'customerId') {
            const cachedCustomerId = myCache.get(customerCacheKey);
            if (cachedCustomerId) {
                id = cachedCustomerId;
            } else {
                key = 'customerId';
            }
        }
        if (key === '_id' && !isObjectId(id)) {
            return res.status(404).json({ status: false, message: "user not found" });
        }

        const cached = myCache.get(`UserData:${id}`);
        let user = cached ? JSON.parse(cached) : null;

        if (!user) {
            const userObj = {
                type: SCHEMA_TYPE.USERS,
                data: [
                    {[key] : id}
                ]
            };
            user = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, userObj, 'findOne');
            if (!user) {
                return res.status(404).json({ status: false, message: "user not found" });
            }
            const userId = user._id;
            const userData = JSON.stringify(user);
            if (query === 'customerId') {
                myCache.set(customerCacheKey, userId);
                myCache.set(`UserData:${userId}`, userData, 604800);
            } else {
                (user?.customerIds || []).forEach((customerId) => myCache.set(`customerId:${customerId}`, userId));
                myCache.set(`UserData:${id}`, userData, 604800);
            }
        }

        if (String(user._id) === String(req.uid)) {
            return res.status(200).json(toSelfView(user));
        }
        const shared = sharedCompanies(await loadGlobalUser(req.uid), user);
        if (!shared.length) {
            return res.status(404).json({ status: false, message: "user not found" });
        }
        return res.status(200).json(toMemberView(user, shared));
    } catch (error) {
        logger.error(`getUserById: ${error.message || error}`);
        res.status(500).json({ status: false, message: "An error occurred while getting the user" });
    }
}

exports.getUserByQuey = async(req, res) => {
    try {
        if (!req.uid) return refuse(res, 401, 'Unauthorized');
        const headerCompany = req.headers['companyid'];
        const bodyCompany = req.body.companyId;
        const companyId = String(headerCompany || bodyCompany || '');
        if (!isObjectId(companyId)) return refuse(res, 400, 'companyId is required');
        if (headerCompany && bodyCompany && String(bodyCompany) !== companyId) {
            return refuse(res, 403, 'You do not have access to this company');
        }
        const { verifyCompanyMembership } = require("../../Config/jwt.js");
        if (!(await verifyCompanyMembership(String(req.uid), companyId))) {
            return refuse(res, 403, 'You do not have access to this company');
        }
        const checked = sanitizeUserQuery(req.body.query);
        if (!checked.ok) return refuse(res, 400, checked.error);

        const users = await exports.getUserByQueyFun(scopeQueryToCompany(checked.query, companyId), companyId, false);
        const list = Array.isArray(users) ? users : [];
        return res.json(list.map((user) => (String(user._id) === String(req.uid) ? toSelfView(user) : toMemberView(user, [companyId]))));
    } catch (error) {
        logger.error(`getUserByQuey: ${error.message || error}`);
        return refuse(res, 400, 'An error occurred while getting the users');
    }
}

exports.getUserByQueyFun = async(query = {},companyId = '',fetchFromCache = false, preAggregate = false) => {
    return new Promise(async(resolve, reject) => {
        try {
            const cacheKey = `UserAllData:${companyId}`;

            const value = myCache.get(cacheKey);

            if (value && fetchFromCache) {
                return resolve(JSON.parse(value)); 
            }

            let userQuery = [
                {
                    $match: query
                }
            ];
            if (preAggregate) {
                userQuery = query
            } 

            const userObj = {
                type: SCHEMA_TYPE.USERS,
                data: [userQuery]
            };
            const users = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, userObj, 'aggregate');

            if (!users) {
                return resolve({ message: "user not found" });
            }
            if(fetchFromCache){
                myCache.set(cacheKey,JSON.stringify(users), 604800);
            }
            users.forEach((user) => {
                myCache.set(`UserData:${user._id.toString()}`,JSON.stringify(user),604800);
            })

            return resolve(users);
        } catch (error) {
            reject({ message: "An error occurred while getting the users",error:error })
        }
    })
}

exports.updateUserFun = (type,companyObj,method,companyId = "",userId = "",updateMany = false) => {
    return new Promise (async(resolve,reject) => {
        try {
            const userData = await MongoDbCrudOpration(type, companyObj, method);

            if (!userData) {
                return resolve({ message: "user not updated"});
            }

            if(userId === ''){
                if(!updateMany){
                    userId = JSON.parse(JSON.stringify(userData._id));
                }else{
                    removeCache(`UserData:`,true);
                }
            }

            if(userId){
                removeCache(`UserData:${userId}`);
            }

            if(companyId){
                removeCache(`UserAllData:${companyId}`,true);
            }else{
                removeCache(`UserAllData:`,true);
            }

            return resolve({message: "user updated",data: userData || {}});
        } catch (error) {
            reject(error);
        }
    })
}