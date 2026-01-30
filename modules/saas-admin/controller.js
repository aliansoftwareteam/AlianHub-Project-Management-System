const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const logger = require("../../Config/loggerConfig");
const { dbCollections } = require("../../Config/collections");
const { updateCompanyFun, getCompanyDataFun } = require("../company/controller/update-company");

/**
 * @returns {Promise<String>} A Promise that resolves when porcess of company data add is completed.
 *                            Rejects with an error message if any issues occur during the Process.
 */
exports.addCompanyDataFunction = () => {
    return new Promise((resolve, reject) => {
        try {
            getCompanyDataFun([],true)
            .then((response)=>{
                let promise = [];
                response.forEach((element) => {
                    promise.push(exports.setCompanyWiseData(JSON.parse(JSON.stringify(element))._id));                    
                });
                Promise.allSettled(promise).then((ele)=>{
                    let errorArray = ele.filter((x)=> x.status === 'rejected')
                    if (errorArray.length) {
                        reject(JSON.stringify(errorArray));
                    } else {
                        resolve(`Company Data set Successfully for ${response.length} company`);
                    }
                }).catch((error)=>{
                    reject(error);
                })
            }).catch((error)=>{
                reject(error);
            })
        } catch (error) {
            reject(error);
        }
    })
}


/** Set CompanyWiseData
 * @param {Object} companyId - companyId 
 * @returns {Promise<String>} A Promise that resolves when porcess of company data add is completed.
 *                            Rejects with an error message if any issues occur during the Process.
 */
exports.setCompanyWiseData = (companyId) => {
    return new Promise((resolve, reject) => {
        try {
            let projectQuery = {
                type: dbCollections.PROJECTS,
                data: [[{$match: {}},{
                    "$count": "myCount"
                }]]
            }
            let taskQuery = {
                type: dbCollections.TASKS,
                data: [[{$match: {}},{
                    "$count": "myCount"
                }]]
            }
            let users = {
                type: dbCollections.COMPANY_USERS,
                data: [[{$match: {}},{
                    "$count": "myCount"
                }]]
            }
            let promises = [
                exports.mongoQueryFunction(projectQuery,companyId,"projects"),
                exports.mongoQueryFunction(taskQuery,companyId,"tasks"),
                exports.mongoQueryFunction(users,companyId,"users")
            ]
            Promise.allSettled(promises).then((resp)=>{
                let errorArray = resp.filter((x)=> x.status === 'rejected');
                if (!errorArray.length) {
                    let success = resp.filter((x)=> x.status === 'fulfilled').map((y)=> y.value).flat(Infinity);
                    let finalDat = Object.assign({}, ...success)
                    finalDat.updatedAt = new Date();
                    let obj = {
                        type: dbCollections.COMPANIES,
                        data: [{
                            _id: companyId,
                        },{
                            companyData: finalDat
                        }]
                    }
                    updateCompanyFun(SCHEMA_TYPE.GOLBAL,obj,"findOneAndUpdate",companyId)
                    .then(()=>{
                        resolve(finalDat)
                    }).catch((error)=>{
                        reject(error);
                    })
                } else {
                    reject(JSON.stringify(errorArray))
                }
            })
        } catch (error) {
            reject(error);
        }
    })
}

/** Set CompanyWiseData
 * @param {Object} query - query object
 * @param {Object} companyId - companyId 
 * @param {String} companyId - key like project, task, user
 * @param {String} type - type of query like find, findoneAndUpdate default aggregate 
 * @returns {Promise<String>} A Promise that resolves when porcess of company data add is completed.
 *                            Rejects with an error message if any issues occur during the Process.
 */
exports.mongoQueryFunction = (query,companyId,key,type="aggregate") => {
    return new Promise((resolve, reject) => {
        try {
            MongoDbCrudOpration(companyId,query,type).then((result)=>{
                if (type === 'aggregate') {
                    let obj = {};
                    if (result.length) {
                        obj[key] = result[0].myCount
                    } else {
                        obj[key] = 0
                    }
                    resolve(obj)
                }
            }).catch((error)=>{
                reject(error);
            })
        } catch (error) {
            reject(error)
        }
    })
}

/**
 * Add Company Data Crone Function
 */
exports.addCompanyData = () => {
    exports.addCompanyDataFunction().then((response)=>{
        logger.info(response);
    }).catch((error)=>{
        logger.error(`Error in aad company Data ${error}`);
    })
}