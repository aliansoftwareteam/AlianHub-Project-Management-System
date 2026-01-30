const { myCache } = require("../../../Config/config");
const {removeCache} = require('../../../utils/commonFunctions');
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { default: mongoose } = require("mongoose");
const { replaceObjectKey } = require("../../auth/helper");
const socketEmitter = require("../../../event/socketEventEmitter");

exports.updateCompany = async(req,res) => {
    try {

        const companyId = req.headers['companyid'] || req.body.companyId;

        if (!(req.body && req.body.updateObject)) {
            return res.status(400).json({message: 'Update Object is Required'});
        }

        let key;
        let data;
        if (req.body.key) {
            key = req.body.key;
            data =  [
                { _id: companyId },
                {   
                    [key]: req.body.updateObject
                },
            ]
        } else {
            key = '$set'
            data =  [
                { _id: companyId }, 
                {   
                    [key]: req.body.updateObject
                },
                {
                    returnDocument : 'after'
                }
            ]
        }

        if (req.body.arrayFilters?.length) {
            let arrObj = {arrayFilters: req.body.arrayFilters}
            data.push(arrObj)
        }

        const dataConvert = replaceObjectKey(data,"objId")        
        let mongoObj = {
            type: SCHEMA_TYPE.COMPANIES,
            data: dataConvert
        }

        const company = await MongoDbCrudOpration('global', mongoObj, 'findOneAndUpdate');

        if (!company) {
            return res.status(400).json({ message: "company not updated" });
        }

        removeCache(`companyData_${companyId}`,true);

        return res.status(200).json(company);
    } catch (error) {
        return res.status(500).json({ message: "An error occurred while updating the company",error:error });
    }
}

exports.getCompany = (req,res) => {
    exports.getCompanyDataFun(req.body.companyIds,req.body.fetchAllCompany,req.body.condition).then((data) => {
        res.json(data);
    }).catch((error) => {
        res.json(error);
    })
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
        const { findQuery } = req.body;

        if (!findQuery) {
            return res.status(400).json({
                message: "An error occurred while getting the task.",
                error: "Query is required."
            });
        }
        const query = replaceObjectKey(findQuery, ["objId"])
        const cQuery = [query];
        const companyObj = {
            type: SCHEMA_TYPE.COMPANIES,
            data: [cQuery]
        };

        const response = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL,companyObj, 'aggregate');

        return res.status(200).json(response);
    } catch (error) {
        return res.status(500).json({ message: "An error occurred while fetching the company",error:error });
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