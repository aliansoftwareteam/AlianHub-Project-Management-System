const loggerConfig = require("../Config/loggerConfig");
const { SCHEMA_TYPE } = require("../Config/schemaType");
const { updateCompanyFun } = require("../Modules/Company/controller/updateCompany");
const { uploadMainFileForbase64Thumbnail, uploadFileWasabiPromise, getBucketSize,cleanUpTrackshotStorage, createCompanyDataWasabi, getUserProfilePresignedUrl, getUserProfilePresignedUrlCallBackFunction, getPresignedUrl, copyWasabiImage } = require("../Modules/storage/wasabi/controller");
const fs = require("fs");

exports.currentDirectory = 'wasabi';
/**
 * createCompanyDataWasabiFun
 * @param {object} bodyData 
 * @param {string} companyId 
 * @returns 
 */
exports.createCompanyDataWasabiFunnction = (bodyData, companyId) => {
    return new Promise((resolve, reject) => {
        try {
            if (bodyData && bodyData.file && bodyData.fileName) {
                
                createCompanyDataWasabi(companyId, bodyData.fileName ,bodyData.file).then(()=>{
                    loggerConfig.info(`${companyId} >> WASABI CREATED`);
                    resolve({
                        status: true,
                        statusText: `${companyId} >> WASABI CREATED`
                    });
                }).catch((error)=>{
                    reject({
                        status: false,
                        error: error
                    });
                })
            } else {
                createCompanyDataWasabi(companyId,{},"").then(()=>{
                    loggerConfig.info(`${companyId} >> WASABI CREATED`);
                    resolve({
                        status: true,
                        statusText: `${companyId} >> WASABI CREATED`
                    });
                }).catch((error)=> {
                    reject({
                        status: false,
                        error: error
                    });
                })
            }
        } catch (error) {
            reject({
                status: false,
                error: error
            });
        }
    })
};

/**
 * 
 * @param {object} cObj 
 * @param {string} companyId 
 * @returns 
 */
exports.handleCreateCompanyDataStorageFun = async(cObj,companyId) => {
    return new Promise((resolve, reject) => {
        try {
            exports.createCompanyDataWasabiFunnction(cObj,companyId).then((resObject) => {
                resolve(resObject);
            })
            .catch((err) => {
                reject(err);
                loggerConfig.error('Error handleCreateCompanyDataStorageFun' + err.message)
            });
        } catch (error) {
            reject(error);
            loggerConfig.error('Error handleCreateCompanyDataStorageFun' + error.message)
        }
    })
}


/**
 * 
 * @param {object} bodyData 
 * @param {string} companyId 
 * @returns 
 */
exports.handleCreateCompanyDataStorageFunForUpload = async(bodyData,companyId) => {
    return new Promise((resolve, reject) => {
        if(bodyData && bodyData.file && bodyData.fileName) {
            let path = `companyIcon/${bodyData.fileName}`;
            try {
                uploadMainFileForbase64Thumbnail(companyId,path,bodyData.file,false,"companyIcon").then(async(fileName)=>{
                    let queryObject = {
                        type: SCHEMA_TYPE.COMPANIES,
                        data: [
                            {
                                _id: companyId
                            },
                            {
                                $set: {
                                    Cst_profileImage: fileName[0]
                                }
                            }
                        ]
                    }
                    await updateCompanyFun(SCHEMA_TYPE.GOLBAL,queryObject,"findOneAndUpdate",companyId)
                    .then(()=>{
                        resolve();
                    }).catch((error)=>{
                        reject(error);
                        loggerConfig.error(`Company Profile Error: ${error}`);
                    })
                })
            } catch (error) {
                reject(error);
                loggerConfig.error(`Error uploading file: ${error}`);
            }
        } else {
            resolve();
        }
    })
}

/**
 * 
 * @param {object} companyId 
 * @param {string} localFilePath 
 * @param {object} filedata
 * @returns 
 */
exports.handleChargeebeCreditNotUpload = (companyId,localFilePath,filedata,id) => {
    return new Promise((resolve, reject) => {
        try {
            fs.writeFile(localFilePath, Buffer.from(filedata,'binary'), (error) => {
                if (error) {
                    loggerConfig.error(`Credit Note Download Error ${error.message ? error.message : error}`);
                    return;
                }
                let path = `InvoiceAndCreditNotes/CreditNotes/${companyId}/${id}.pdf`;
                uploadFileWasabiPromise(companyId,path,localFilePath, true,localFilePath,'',true).then(()=>{
                    resolve();
                }).catch((error)=>{
                    loggerConfig.error(`Error While Uploading Credit Note In Wasabi: ${error.message ? error.message : error}`);
                    reject(error);
                })
            });
        } catch (error) {
            loggerConfig.error(`Error While Uploading Credit Note In Wasabi: ${error.message ? error.message : error}`);
            reject(error);
        }
    })
}

exports.handleBucketSizeUpdateCron = () => {
    getBucketSize();
}
exports.cleanUpTrackshot = async () => {
    cleanUpTrackshotStorage();
}

/**
 * 
 * @param {string} companyId 
 * @param {string} path 
 * @param {string} filepath 
 * @param {boolean} isReplace 
 * @param {object} file 
 * @param {string} trackshot 
 * @returns 
 */
exports.handleFileUploadForTrackerSS = (companyId, path, filepath, isReplace ,file, trackshot) => {
    return new Promise((resolve, reject) => {
        try {
            uploadFileWasabiPromise(companyId, path, filepath, isReplace ,file, trackshot).then((value) => {
                resolve(value);
            }).catch((ewrrr)=>{
                reject(ewrrr);
            })
        } catch (error) {
            reject(error);
        }
    });
}

exports.handleuploadMainFileForbase64Thumbnail = (companyId, filepath, file, isReplace, trackshot) => {
    return new Promise((resolve, reject) => {
        try {
            uploadMainFileForbase64Thumbnail(companyId, filepath, file, isReplace, trackshot).then((val)=>{
                resolve(val);
            }).catch((err)=>{
                reject(err);
            })
        } catch (error) {
            reject(error);
        }
    })
}

exports.handleMulterStorage = () => {
    return { dest: "wasabiUploads/" }
}

exports.handleProfileGetForUser = async (req,res) => {
    // POST /api/v1/getUserProfile sends the path in the body; the params-based
    // getUserProfilePresignedUrl is for the GET /wasabi/retriveUserProfile route.
    const result = await getUserProfilePresignedUrlCallBackFunction({ path: req.body?.path });
    res.send(result);
}
exports.handleTaskTypeImageGet = (req,res) => {
    getPresignedUrl(req,res);
}
exports.handleTaskAttachmentsDuplicateFunctionality = async(bucketId, previousPath, destinationPath) => {
    await copyWasabiImage(bucketId, previousPath, destinationPath)
}