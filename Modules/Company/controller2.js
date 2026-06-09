
const { SCHEMA_TYPE } = require("../../Config/schemaType.js");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries.js");
const logger = require('../../Config/loggerConfig.js');
const companyRef = require('./controller.js');
const helperCtr = require('../Auth/controller/helper.js');
let errorArray = [];
const config = require('../../Config/config.js');
const sendMailRef  = require("../../Modules/service.js");
const fs = require('fs');
exports.preCompanySetup = (preCompanyNumber) => {
    let totalPreCompany = preCompanyNumber || 10;
    let obj = {
        type: SCHEMA_TYPE.PRECOMPANIES,
        data: [{
            isAvailable: true,
            pickupCount: 0
        }]
    }
    MongoDbCrudOpration("global",obj, "find").then((resp)=>{
        if (resp.length >= totalPreCompany) {
            logger.info(`No need to setup pre-companies as already ${totalPreCompany} companies are available`);
            return;
        } else {
            let setUpCompanies = totalPreCompany - resp.length;
            let count = 0;
            let countFunction = () => {
                if (count >= setUpCompanies) {
                    if (errorArray.length > 0) {
                        try {
                            let jsonData = JSON.stringify(errorArray);
                            fs.writeFileSync("errorInSetPreCompanies.json",jsonData)
                            exports.sendEmail([{
                                filename: 'errorInSetPreCompanies.json',
                                path: 'errorInSetPreCompanies.json'
                            }],(Mailres)=>{
                                if (!Mailres.status) {
                                    logger.error(`Pre Companies Error Mail Send Error : ${Mailres.statusText}`);
                                    errorArray = [];
                                } else {
                                    fs.unlinkSync('errorInSetPreCompanies.json');
                                    logger.info(`Preset Company Process Completed and ${setUpCompanies} preset company Created`);
                                    errorArray = [];
                                }
                            })
                        } catch (error) {
                            logger.error(`Pre Companies Error : ${error.message ? error.message : error}`);
                        }
                    } else {
                        logger.info(`Preset Company Process Completed and ${setUpCompanies} preset company Created`);
                        errorArray = [];
                    }
                    return;
                } else {
                    exports.setUpPreDefineCompanies().then(()=> {
                        count++;
                        countFunction();
                        // setTimeout(() => {
                        //     count++;
                        //     countFunction();
                        // }, 420000);
                    }).catch(()=>{
                            count = setUpCompanies;
                            countFunction();
                        // setTimeout(() => {
                        //     count++;
                        //     countFunction();
                        // }, 420000);
                    })
                }
            }
            countFunction()
        }
    }).catch((error)=>{
        logger.error(`Error Get PreCompanies:: ${error.message? error.message : error}`);
    })
}

exports.setUpPreDefineCompanies = () => {
    return new Promise((resolve, reject) => {
        try {
            let obj = {
                type: SCHEMA_TYPE.PRECOMPANIES,
                data: {
                    isAvailable: false,
                    pickupCount: 0
                }
            }
            MongoDbCrudOpration("global", obj, "save").then((resp)=>{
                let companyId = JSON.parse(JSON.stringify(resp))._id
                let axiosData = {
                    "companyId": companyId
                }
                const { handleCreateCompanyDataStorageFun } = require(`../../common-storage/common-${process.env.STORAGE_TYPE}.js`);
                const allProcess = [
                    handleCreateCompanyDataStorageFun({}, companyId),
                    companyRef.importSettingsFun(axiosData), // Import Settings
                ];
                Promise.allSettled(allProcess).then((result)=>{
                    let errors = result.filter((x) => x.status === "rejected");
                    if (errors.length) {
                        errorArray.push({type: 'Import Setting And Wasabi Error',error: errors});
                        reject();
                    } else {
                        let object = {
                            type: SCHEMA_TYPE.PRECOMPANIES,
                            data: [
                                {
                                    _id: companyId
                                },
                                {
                                    isAvailable: true,
                                    pickupCount: 0
                                }
                            ]
                        }
                        MongoDbCrudOpration("global", object, "findOneAndUpdate").then(()=>{
                            resolve();
                        }).catch((error)=>{
                            errorArray.push({type: 'Mongo Db Doc Update error',error: error.message ? error.message : error});
                            reject(error);
                        })
                    }
                }).catch((error)=>{
                    errorArray.push({type: 'Promise Catch Error',error: error.message ? error.message : error});
                    reject();
                })
            }).catch((error)=>{
                errorArray.push({type: 'Mongo Db Doc Save Error',error: error.message ? error.message : error});
                reject(error);
            })
        } catch (error) {
            errorArray.push({type: 'setUpPreDefineCompanies Try Catch Error',error: error.message ? error.message : error});
            reject(error);
        }
    })
}

exports.sendEmail = (attachMents,cb) => {
    sendMailRef.sendAttachMail('PreCompanies Set Error', `PreCompanies Process In ${config.NODE_ENV} Has Error Please check below file for more detail`,config.ERRORRECIVEREMAIL,attachMents, (res)=>{
        cb(res);
    })
}