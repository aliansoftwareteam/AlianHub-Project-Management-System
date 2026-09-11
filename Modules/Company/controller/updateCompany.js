const { myCache } = require("../../../Config/config");
const {removeCache} = require('../../../utils/commonFunctions');
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { default: mongoose } = require("mongoose");
const { replaceObjectKey } = require("../../Auth/helper");
const socketEmitter = require("../../../event/socketEventEmitter");
const { isInstanceOwner } = require("../../Instance/guard");
const { tenantOf, namedCompanyIds, TenantError } = require("../../../Config/tenant");
const { OBJECT_ID_PATTERN, ownCompanyIds, allowedCompanyIds, scopeCompanyPipeline, companyUpdateKind, seatFilter } = require("../helpers/companyAccessRules");
const { evaluatePermission, isPrivileged, isWritable, ROLE_OWNER } = require("../../../Config/permissionGuard");

const findSeat = (companyId, uid, kind) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.COMPANY_USERS,
    data: [seatFilter(uid, kind), { roleType: 1 }]
}, 'findOne');

const managesMembers = async (companyId, uid) => isWritable(await evaluatePermission(companyId, uid, 'settings.settings_member_list').catch(() => null));

const MAY_SEND = {
    details: ({ roleType }) => isPrivileged(roleType),
    projectType: () => true,
    seatRelease: ({ roleType, companyId, req }) => isPrivileged(roleType) || managesMembers(companyId, req.uid),
    ownerClaim: ({ roleType, req }) => roleType === ROLE_OWNER && req.body.updateObject.objId.userId === String(req.uid),
};

const ROLE_REFUSAL = {
    ownerClaim: 'Only an owner can record themselves as the company owner.',
};

const companyWrite = (companyId, body, kind, uid) => {
    if (kind === 'ownerClaim') {
        return [{ _id: companyId }, { $set: { userId: new mongoose.Types.ObjectId(String(uid)) } }, { returnDocument: 'after' }];
    }
    const data = body.key
        ? [{ _id: companyId }, { [body.key]: body.updateObject }]
        : [{ _id: companyId }, { $set: body.updateObject }, { returnDocument: 'after' }];
    if (body.arrayFilters?.length) data.push({ arrayFilters: body.arrayFilters });
    return data;
};

const loadOwnCompanyIds = async (uid) => {
    const user = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
        type: SCHEMA_TYPE.USERS,
        data: [{ _id: new mongoose.Types.ObjectId(String(uid)) }, { AssignCompany: 1 }]
    }, 'findOne');
    return ownCompanyIds(user);
};

const isInstanceAdminRequest = async (req) => !req.apiToken && isInstanceOwner(req.uid);
const hasSession = (req) => OBJECT_ID_PATTERN.test(String(req.uid || ''));

exports.updateCompany = async(req,res) => {
    try {
        const named = namedCompanyIds(req);
        if (named.length > 1) {
            return res.status(403).json({ status: false, message: 'The request names more than one company.' });
        }
        if (!OBJECT_ID_PATTERN.test(named[0] || '')) {
            return res.status(400).json({ status: false, message: 'A valid company id is required' });
        }
        const companyId = tenantOf(req);

        if (!(req.body && req.body.updateObject)) {
            return res.status(400).json({message: 'Update Object is Required'});
        }

        const kind = companyUpdateKind(req.body);
        if (!kind) {
            return res.status(403).json({ status: false, message: 'Only the company details can be changed here. Plan, billing, seat, storage and usage fields are managed by the server.' });
        }

        const seat = await findSeat(companyId, req.uid, kind);
        if (!seat) {
            return res.status(403).json({ status: false, message: 'Only active members of this company can change it.' });
        }
        if (!(await MAY_SEND[kind]({ roleType: seat.roleType, companyId, req }))) {
            return res.status(403).json({ status: false, message: ROLE_REFUSAL[kind] || 'Only an owner or an admin can change the company.' });
        }

        const mongoObj = {
            type: SCHEMA_TYPE.COMPANIES,
            data: companyWrite(companyId, req.body, kind, req.uid)
        };

        const company = await MongoDbCrudOpration('global', mongoObj, 'findOneAndUpdate');

        if (!company) {
            return res.status(400).json({ message: "company not updated" });
        }

        removeCache(`companyData_${companyId}`,true);

        return res.status(200).json(company);
    } catch (error) {
        if (error instanceof TenantError) {
            return res.status(403).json({ status: false, message: error.message });
        }
        return res.status(500).json({ message: "An error occurred while updating the company",error:error });
    }
}

exports.getCompany = async (req,res) => {
    try {
        if (!hasSession(req)) return res.status(401).json({ status: false, message: 'Unauthorized' });
        if (await isInstanceAdminRequest(req)) {
            return res.json(await exports.getCompanyDataFun(req.body.companyIds, req.body.fetchAllCompany));
        }
        if (req.body.fetchAllCompany) {
            return res.status(403).json({ status: false, message: 'Only the instance owner can list every company.' });
        }
        const allowed = allowedCompanyIds(req.body.companyIds, await loadOwnCompanyIds(req.uid));
        return res.json(await exports.getCompanyDataFun(allowed));
    } catch (error) {
        return res.status(500).json({ status: false, message: "An error occurred while getting the company" });
    }
}

exports.getCompanyDataFun = async(companyIds,fetchAllCompany = false) => {
    return new Promise (async(resolve,reject) => {
        try {
            if (!companyIds) {
                return resolve({
                    message: "An error occurred while getting the companys.",
                    error: "Company ids is required."
                });
            }

            const notInCacheIds = [];
            const companyCacheData = [];

            companyIds.forEach((companyId) => {
                const companyCache = `companyData_${companyId}`;
                const cachedCompany = myCache.get(companyCache);

                if(cachedCompany){
                    companyCacheData.push(cachedCompany);
                } else {
                    notInCacheIds.push(companyId)
                }
            })

            if(notInCacheIds.length > 0 || fetchAllCompany){
                const companyObj = {
                    type: SCHEMA_TYPE.COMPANIES
                }

                if(fetchAllCompany){
                    companyObj.data = [{}];
                } else{
                    companyObj.data = [
                        {
                            _id: {$in: [...companyIds.map(x => new mongoose.Types.ObjectId(x))]}
                        }
                    ]
                }

                const companyData =  await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, companyObj, 'find');

                companyData.forEach((company) => {
                    myCache.set(`companyData_${company._id.toString()}`,company,604800);
                    companyCacheData.push(company);
                })
            }
            resolve(companyCacheData);
        } catch (error) {
            reject({ message: "An error occurred while getting the company",error:error })
        }
    })
}

exports.updateCompanyFun = (type,companyObj,method,companyId = "",isSocketUpdateSend=false) => {
    return new Promise (async(resolve,reject) => {
        try {
            const companyData = await MongoDbCrudOpration(type, companyObj, method);

            if (!companyData) {
                return resolve({ message: "company not updated"});
            }

            if(companyId === ''){
                companyId = JSON.parse(JSON.stringify(companyData._id));
            }
            if(isSocketUpdateSend) {
                socketEmitter.emit('update', { type: "update", data: {data:companyData} , updatedFields: {    
                    ...companyData
                }, module: 'companies' });
            }

            removeCache(`companyData_${companyId}`,true);

            return resolve({message: "company updated",data: companyData || {}});
        } catch (error) {
            reject(error);
        }
    })
}

exports.getCompanyByAggregate = async(req,res) => {
    try {
        if (!hasSession(req)) return res.status(401).json({ status: false, message: 'Unauthorized' });
        const { findQuery } = req.body;

        if (!findQuery) {
            return res.status(400).json({
                status: false,
                message: "An error occurred while getting the task.",
                error: "Query is required."
            });
        }
        const query = replaceObjectKey(findQuery, ["objId"])
        let pipeline = [query];
        if (!(await isInstanceAdminRequest(req))) {
            const own = (await loadOwnCompanyIds(req.uid)).map((id) => new mongoose.Types.ObjectId(id));
            const scoped = scopeCompanyPipeline(query, own);
            if (!scoped.ok) return res.status(403).json({ status: false, message: scoped.error });
            pipeline = scoped.pipeline;
        }
        const companyObj = {
            type: SCHEMA_TYPE.COMPANIES,
            data: [pipeline]
        };

        const response = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL,companyObj, 'aggregate');

        return res.status(200).json(response);
    } catch (error) {
        return res.status(500).json({ status: false, message: "An error occurred while fetching the company" });
    }
}

exports.getCompanyRefferCode = async (req,res) => {
    try {
        const companyId = req.headers['companyid'];
        if (!companyId) {
            res.status(400).json({message: 'Company id is required'});
            return;
        }

        const companyRefferalCache = `companyRefferal_${companyId}`;
        const cachedRefferal = myCache.get(companyRefferalCache);
        if(cachedRefferal) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(companyRefferalCache)
            });
            res.status(200).json({data:cachedRefferal});
            return;
        } else {
            const companyRferalData =  await MongoDbCrudOpration('global', {
                type: SCHEMA_TYPE.REFERCODE,
                data: [
                    {
                        "companyId": companyId
                    },
                    { code: 1, _id: 0 } 
                ]
            }, 'findOne');
            
            myCache.set(companyRefferalCache,companyRferalData.code,604800)
            res.status(200).json({data: companyRferalData.code})
        }
    } catch (error) {
        res.status(400).json({ message: "Error while fetching Reffer Code",error: error});
    }
}