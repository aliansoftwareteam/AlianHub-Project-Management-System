
// const AWS = require('aws-sdk');
const awsRef = require('../../../Config/aws.js');
const { S3Client, GetObjectCommand ,CreateBucketCommand , PutObjectCommand ,DeleteObjectCommand,ListObjectsV2Command, CopyObjectCommand, DeleteBucketCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const fs = require("fs");
const logger = require("../../../Config/loggerConfig.js");
const sharp = require('sharp');
const thumbnailArray = require("../../../thumbnail.json");
const { SCHEMA_TYPE } = require('../../../Config/schemaType.js');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries.js');
const { default: mongoose } = require('mongoose');
const {myCache, requestHandler} = require('../../../Config/config');
const { updateCompanyFun, getCompanyDataFun } = require('../../company/controller/update-company.js');
/**
 * S3 client configuration for create bucket
 */
let s3Client = new S3Client({
    region: awsRef.region,
    credentials: {
        accessKeyId: awsRef.wasabiAccessKey,
        secretAccessKey: awsRef.wasabiSecretAccessKey,
    },
    endpoint: awsRef.wasabiEndPoint,
    requestHandler
});

// Used function in default data create demo saas
exports.deleteBucketInWasabi = (companyId) => {
    return new Promise(async (resolve, reject) => {
        try {
            const command = new DeleteBucketCommand ({ Bucket: companyId });
            const response = await s3Client.send(command);
            logger.info(`Bucket is deleted successfully for company ${companyId}`);
            resolve(response);
        } catch (error) {
            reject(error);
        }
    })
}

/**
 * Create a new Bucket using companyId
 * @param {Objcet} CompanyId
 */
exports.createNewBucketInWasabi = (companyId) => {
    return new Promise(async (resolve, reject) => {
        try {
            const s3ClientInstance = new S3Client({
                region: awsRef.region,
                credentials: {
                    accessKeyId: awsRef.wasabiAccessKey,
                    secretAccessKey: awsRef.wasabiSecretAccessKey,
                },
                endpoint: awsRef.wasabiEndPoint,
                requestHandler
            });
            const command = new CreateBucketCommand({ Bucket: companyId });
            const response = await s3ClientInstance.send(command);
            logger.info(`Bucket is created successfully for company ${companyId}`);
            resolve(response);
        } catch (error) {
            reject(error);
        }
    })
}


/**
 * Update Local File In Wassabi
 * @param {String} CompanyId - CompanyId in which file is need to upload
 * @param {String} Path - Path where file is uploaded in Wasabi
 * @param {Object} File - File Which is need to Upload
 * @returns {Promise<String>} A Promise that resolves with the updated file path upon successful upload.
 *                            Rejects with an error message if any issues occur during the upload process.
 */
exports.updateLocalWasabiFiles = (companyId, path, file) => {
    return new Promise((resolve, reject) => {
        let updatedFilePath = path
        const fileContent = fs.readFileSync(file);
        const bucketName = companyId;
        const fileName = updatedFilePath;
        
        const params = {
            Bucket: bucketName,
            Key: fileName,
            Body: fileContent,
            ContentType: exports.getContentType(fileName)
        };
        try {
            const s3ClientInstance = new S3Client({
                region: awsRef.region,
                credentials: {
                    accessKeyId: awsRef.wasabiAccessKey,
                    secretAccessKey: awsRef.wasabiSecretAccessKey,
                },
                endpoint: awsRef.wasabiEndPoint,
                requestHandler
            });
            s3ClientInstance.send(new PutObjectCommand(params))
            .then(() => {
                resolve(updatedFilePath);
            }).catch((error)=>{
                reject(`Error while upload file: ${error}`)
            })
        } catch (error) {
            reject(`File upload error: ${error}`)
        }
    })
}


exports.uploadIamgesInWasabi = (imageArray,companyId) => {
    return new Promise(async (resolve, reject) => {
        try {
            imageArray.forEach((x)=>{
                exports.updateLocalWasabiFiles(companyId,x.path,x.filePath).catch((error)=>{
                    logger.error(`updateLocalWasabiFiles: ${error}`);
                });
            });
            resolve()
        } catch (error) {
            reject(error);
        }
    })
}

exports.uploadTaskTypeImage = (companyId) => {
    return new Promise(async (resolve, reject) => {
        try {
            let imageArray = [
                {
                    path:'setting/task_type/bug.png',
                    filePath: __dirname + "/../../../wasabiUploadsLocal/bug.png"
                },
                {
                    path:'setting/task_type/design.png',
                    filePath: __dirname + "/../../../wasabiUploadsLocal/design.png"
                },
                {
                    path:'setting/task_type/subtask.png',
                    filePath: __dirname + "/../../../wasabiUploadsLocal/subtask.png"
                },
                {
                    path:'setting/task_type/task.png',
                    filePath: __dirname + "/../../../wasabiUploadsLocal/task.png"
                },

            ];
            exports.uploadIamgesInWasabi(imageArray,companyId).then(() => {
                resolve();
            })
        } catch (error) {
            reject(error);
        }
    })
}
exports.uploadPriority = (companyId) => {
    return new Promise(async (resolve, reject) => {
        try {
            let imageArray = [
                {
                    path:'taskPriorities/priority_medium.png',
                    filePath: __dirname + "/../../../wasabiUploadsLocal/priority_medium.png"
                },
                {
                    path:'taskPriorities/priority_low.png',
                    filePath: __dirname + "/../../../wasabiUploadsLocal/priority_low.png"
                },
                {
                    path:'taskPriorities/priority_high.png',
                    filePath: __dirname + "/../../../wasabiUploadsLocal/priority_high.png"
                }

            ];
            exports.uploadIamgesInWasabi(imageArray,companyId).then(() => {
                resolve();
            })
        } catch (error) {
            reject(error);
        }
    })
}

/**
 * Update A thumbnail File In Wassabi
 * @param {String} Base64 - Base64String Which is need to be uploaded
 * @param {String} Path - Path where file is uploaded in Wasabi
 * @param {String} Width - Height of the thumbnail file
 * @param {String} Height - Width of the thumbnail file
 * @param {String} CompanyId - CompanyId in which file is need to upload
 * @param {String} AccessKeyId - AccessKeyId of Company For Upload file In wasabi
 * @param {String} SecretAccessKey - AccessKeyId of Company For Upload file In wasabi
 * @returns {Promise<String>} A Promise that resolves with the updated file name upon successful upload.
 *                            Rejects with an error message if any issues occur during the upload process.
 */
exports.uploadThumbnailFileFromBase64 = (base64,path,name,width,height,companyId, isUserProfile = false) =>{
    return new Promise((resolve, reject) => {
        const base64Data = base64.replace(/^data:image\/png;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const fileExtension = name.split('.')[1];
        const fileName = `${name.split('.')[0]}-${width}x${height}.${fileExtension}`
        sharp(buffer)
        .resize(width, height, (!isUserProfile ? {fit: "inside"}: {}))
        .withMetadata()
        .toBuffer()
        .then(resizedBuffer => {
            const bucketName = isUserProfile ? process.env.USERPROFILEBUCKET : companyId;
            const params = {
                Bucket: bucketName,
                Key: fileName,
                Body: resizedBuffer,
                ContentType: exports.getContentType(fileName)
            };
            try {
                s3Client.send(new PutObjectCommand(params))
                .then(() => {
                    resolve(fileName)
                }).catch((error)=>{
                    reject(`Error while upload file: ${error}`)
                })
            } catch (error) {
                reject(`File upload error: ${error}`)
            }
        })
        .catch(error => {
            reject('Error:', error);
        });
    })
}


/**
 * Update File In Wassabi
 * @param {String} CompanyId - CompanyId in which file is need to upload
 * @param {String} Path - Path where file is uploaded in Wasabi
 * @param {Object} Base64String - Base64String Which is need to be uploaded
 * @param {Boolean} ReplaceFile - Boolean True if you want to replace existing file in Wasabi
 * @param {String} ThumbanilKey - Thumbnail Key For Genrate Thumbnail
 * @returns {Promise<String>} A Promise that resolves with the updated file path upon successful upload.
 *                            Rejects with an error message if any issues occur during the upload process.
 */
exports.uploadMainFileForbase64Thumbnail = (companyId, path, base64String, replaceFile, thumbanilKey, isUserProfile = false) => {
    return new Promise((resolve, reject) => {
        let ind;
        let updatedFilePath = ''
        if (!(replaceFile &&  replaceFile == false)) {
            const currentDate = new Date();
            const timestamp = currentDate.toISOString().replace(/[-:.]/g, '');
            const pathComponents = path.split('/');
            const fileName = pathComponents.pop();
            const newFileName = `${timestamp}_${fileName}`;
            updatedFilePath = isUserProfile ? pathComponents.join('/') + newFileName : pathComponents.join('/') + '/' + newFileName;
        } else {
            updatedFilePath = path
        }

        let thumInd = thumbnailArray.findIndex((data)=>{
            return data.key === thumbanilKey
        })
        const base64Data = base64String.replace(/^data:image\/png;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const promises = [];
        let filePathArray = [];
        const fileContent = buffer;
        const fileName = updatedFilePath;
        const bucketName = isUserProfile ? process.env.USERPROFILEBUCKET : companyId;
        const params = {
            Bucket: bucketName,
            Key: fileName,
            Body: fileContent,
            ContentType: exports.getContentType(fileName)
        };
        try {
            s3Client.send(new PutObjectCommand(params))
            .then(() => {
                filePathArray.push(updatedFilePath);
                if (thumInd === -1) {
                    resolve(filePathArray);
                }else{
                    thumbnailArray[thumInd].size.forEach((thu)=>{
                        if(!isUserProfile){
                            promises.push(exports.uploadThumbnailFileFromBase64(base64String,path,updatedFilePath,thu.height,thu.width,companyId, isUserProfile))
                        }else{
                            promises.push(exports.uploadThumbnailFileFromBase64(base64String,path,updatedFilePath,thu.height,thu.width,companyId, isUserProfile))
                        }
                    })
                    Promise.allSettled(promises)
                    .then((results) => {
                        let count = 0;
                        let countFunction = (row) => {
                            if (count >= results.length) {
                                resolve(filePathArray);
                                return;
                            } else {
                                if (row.status === "fulfilled") {
                                    filePathArray.push(row.value);
                                    count++;
                                    countFunction(results[count]);
                                } else {
                                    logger.error("Error upload in thumbnail:", row.reason);
                                    count++;
                                    countFunction(results[count]);
                                }
                            }
                        }
                        countFunction(results[count]);
                    })
                    .catch((error) => {
                        logger.error("Promise.allSettled error:", error);
                    });
                }
            }).catch((error)=>{
                reject(`Error while upload file: ${error}`)
                fs.unlink(file, (err) => {
                    if (err) {
                        logger.error(`Error deleting file: ${err}`);
                    }
                });
            })
        } catch (error) {
            reject(`File upload error: ${error}`)
            fs.unlink(file, (err) => {
                if (err) {
                    logger.error(`Error deleting file: ${err}`);
                }
            });
        }

    });
}


/**
 * Upload a local file on company create
 * @param {Objcet} CompanyId
 */
exports.uploadLocalFileOnCompanyCreate = (companyId,fileNamess,fileString) => {
    return new Promise(async (resolve, reject) => {
        try {
            try {
                Promise.allSettled([exports.uploadTaskTypeImage(companyId),exports.uploadPriority(companyId)]).then((resp) => {
                    if (fileString && fileNamess !== '') {
                        let path = `companyIcon/${fileNamess}`;
                        exports.uploadMainFileForbase64Thumbnail(companyId,path,fileString,false,"companyIcon").then(async(fileName)=>{
                            let firebaseObj = {
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
                            await updateCompanyFun(SCHEMA_TYPE.GOLBAL,firebaseObj,"findOneAndUpdate",companyId)
                            .then(()=>{
                                resolve();
                            }).catch((error)=>{
                                reject(error);
                                logger.error(`Company Profile Error: ${error}`);
                            })
                        }).catch((error)=>{
                            reject(error);
                            logger.error(`Error uploading file: ${error}`);
                        })
                    } else {
                        resolve();
                    }
                }).catch((error)=>{
                    logger.error(`Error in upload task type image ${error}`);
                    if (fileString && fileNamess !== '') {
                        let path = `companyIcon/${fileNamess}`;
                        exports.uploadMainFileForbase64Thumbnail(companyId,path,fileString,false,"companyIcon").then(async(fileName)=>{
                            let firebaseObj = {
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
                            await updateCompanyFun(SCHEMA_TYPE.GOLBAL,firebaseObj,"findOneAndUpdate",companyId)
                            .then(()=>{
                                resolve();
                            }).catch((error)=>{
                                reject(error);
                                logger.error(`Company Profile Error: ${error}`);
                            })
                        }).catch((error)=>{
                            reject(error);
                            logger.error(`Error uploading file: ${error}`);
                        })
                    } else {
                        resolve();
                    }
                })
              } catch (error) {
                reject(error);
              }
        } catch (error) {
            reject(error);
        }
    })
}


/**
 * Create a new Bucket, policy, user and attach policy to that user in wasabi
 * @param {Objcet} CompanyId
 */
exports.createCompanyDataWasabi =  (companyId, fileName, fileString) => {
    return new Promise((resolve, reject) => {
        try {
            exports.createNewBucketInWasabi(companyId).then(() => {
                    exports.uploadLocalFileOnCompanyCreate(companyId,fileName, fileString).then(()=>{
                        resolve();
                    }).catch((error)=>{
                        reject(error);
                        logger.error(`createUserAndAttachPolicyDocument Error: ${JSON.stringify(error)}`);
                    })
            }).catch((error)=>{
                reject(error);
                logger.error(`createNewBucketInWasabi Error: ${JSON.stringify(error)}`);
            })
        } catch (error) {
            reject(error);
        }
    })
}



/**
 * Get a Presigned URL for Object
 * @param {Objcet} req
 * @param {Object} res
 * @returns
 */
exports.getPresignedUrl  = async (req,res) => {
    try {
        if (!(req.body && req.body.companyId)) {
            res.send({
                status: false,
                statusText: `Company Id is required`
            })
            return;
        }

        if (!(req.body && req.body.path)) {
            res.send({
                status: false,
                statusText: `path Id is required`
            })
            return;
        }

        const aud = req?.aud || "";
        const isAllowed = aud.split(",").includes(req.body.companyId);

        if (!isAllowed) {
            res.send({
                status: false,
                statusText: `You don't have access to requested bucket`
            });
            return;
        }
        if (req.body.isCache === true) {
            const cacheKey = `image:${req.body.path}`;
            const value = myCache.get(cacheKey);
            
            if (value) {
                res.set('Cache-Control', 'public, max-age=43200');
                res.send({
                    status: true, 
                    statusText: value,
                });
            } else {
                const command = new GetObjectCommand({
                    Bucket: req.body.companyId,
                    Key: req.body.path,
                });
                const url = await getSignedUrl(s3Client, command, { expiresIn: 86400 });
                myCache.set( cacheKey, url, 1200 );
                res.set('Cache-Control', 'public, max-age=43200')
                res.send({
                    status: true, 
                    statusText: url,
                });
            }
        } else {
            const command = new GetObjectCommand({
                Bucket: req.body.companyId,
                Key: req.body.path,
            });
            const url = await getSignedUrl(s3Client, command, { expiresIn: 86400 });
            res.send({
                status: true,
                statusText: url,
            });
        }


    } catch (error) {
        res.send({
            status: false, 
            statusText: `Error: ${error}`
        });
    }
}


/**
 * Get a Presigned URL for User Profile Which Use Root User Access Key.
 * @param {Objcet} req
 * @param {Object} res
 * @returns
 */
exports.getUserProfilePresignedUrl  = async (req,res) => {
    if (!(req.params && req.params.path)) {
        res.send({
            status: false,
            statusText: `path Id is required`
        })
        return;
    }
    const cacheKey = `imageExists:${req.params.path}`;
    const value = myCache.get(cacheKey);
    if (value) {
        res.set('Cache-Control', 'public, max-age=86400');
        res.send({
            status: true, 
            statusText: value,
        });
        return;
    } else {
        try {
            const command = new GetObjectCommand({
                Bucket: process.env.USERPROFILEBUCKET,
                Key: req.params.path,
            });
            const url = await getSignedUrl(s3Client, command, { expiresIn: 86400 });
            myCache.set( cacheKey, url, 1200 );
            res.set('Cache-Control', 'public, max-age=86400')
            res.send({
                status: true, 
                statusText: url,
            });
        } catch (error) {
            res.send({
                status: false, 
                statusText: `Error: ${error}`
            });
        }
    }
}

exports.getUserProfilePresignedUrlCallBackFunction = async (params) => {
    if (!(params && params.path)) {
        return { status: false, statusText: "path Id is required" };
    }

    const cacheKey = `imageExists:${params.path}`;
    const value = myCache.get(cacheKey);

    if (value) {
        return { status: true, statusText: value };
    }

    try {
        const command = new GetObjectCommand({
            Bucket: process.env.USERPROFILEBUCKET,
            Key: params.path,
        });

        const url = await getSignedUrl(s3Client, command, { expiresIn: 86400 });

        // store in cache for 20 minutes (1200s)
        myCache.set(cacheKey, url, 1200);

        return { status: true, statusText: url };
    } catch (error) {
        logger.error(`Error in getUserProfilePresignedUrlCallBackFunction hook: ${error}`);
        return { status: false, statusText: error.message || "Something went wrong" };
    }
};

/**
 * Update A thumbnail File In Wassabi
 * @param {Object} File - File Which is need to Upload
 * @param {String} X - Height of the thumbnail file
 * @param {String} Y - Width of the thumbnail file
 * @param {String} CompanyId - CompanyId in which file is need to upload
 * @param {String} AccessKeyId - AccessKeyId of Company For Upload file In wasabi
 * @param {String} SecretAccessKey - AccessKeyId of Company For Upload file In wasabi
 * @param {Object} FileObject - File Object which is neeeded to be uploaded
 * @param {Boolean} IsUserProfile - True if it is a user profile other wise it is not required
 * @returns {Promise<String>} A Promise that resolves with the updated file name upon successful upload.
 *                            Rejects with an error message if any issues occur during the upload process.
 */
exports.uploadThumbnailFile = (file,x,y,path,companyId,isUserProfile = false) => {
    let outputFile = `thumbnails/${file.filename}${x}${y}.${file.mimetype.split("/")[1]}`;
    return new Promise((resolve,reject) => {
        sharp(file.path)
        .resize(x, y, (!isUserProfile ? {fit: "inside"}: {}))
        .withMetadata()
        .toFile(outputFile, (err) => {
            if (err) {
                reject(err);
            } else {
                const fileContent = fs.readFileSync(`thumbnails/${file.filename}${x}${y}.${file.mimetype.split("/")[1]}`);
                const bucketName = isUserProfile ? awsRef.userProfileBucket : companyId;
                const fileExtension = path.split('.')[1];
                const fileName = `${path.split('.')[0]}-${x}x${y}.${fileExtension}`
            
                const params = {
                    Bucket: bucketName,
                    Key: fileName,
                    Body: fileContent,
                    ContentType: exports.getContentType(fileName) 
                };
                try {
                    s3Client.send(new PutObjectCommand(params))
                    .then(() => {
                        resolve(fileName)
                        fs.unlink(outputFile, (err) => {
                            if (err) {
                                logger.error(`Error deleting file: ${err}`);
                            }
                        });
                    }).catch((error)=>{
                        reject(`Error while upload file: ${error}`)
                        fs.unlink(outputFile, (err) => {
                            if (err) {
                                logger.error(`Error deleting file: ${err}`);
                            }
                        });
                    })
                } catch (error) {
                    reject(`File upload error: ${error}`)
                }
            }
        });
    })
}

/**
 * Update File In Wassabi
 * @param {String} CompanyId - CompanyId in which file is need to upload
 * @param {String} Path - Path where file is uploaded in Wasabi
 * @param {Object} File - File Which is need to Upload
 * @param {Boolean} ReplaceFile - Boolean True if you want to replace existing file in Wasabi
 * @param {Object} FileObject - File Object which is neeeded to be uploaded
 * @param {String} ThumbanilKey - Thumbnail Key For Genrate Thumbnail
 * @param {Boolean} IsUserProfile - True if it is a user profile other wise it is not required
 * @returns {Promise<String>} A Promise that resolves with the updated file path upon successful upload.
 *                            Rejects with an error message if any issues occur during the upload process.
 */
exports.uploadFileWasabiPromise = (companyId, path, file, replaceFile, fileObject, thumbanilKey,isUserProfile = false) => {
    return new Promise((resolve, reject) => {
        try {
            let updatedFilePath = ''
            if (!isUserProfile) {
                if (!(replaceFile &&  replaceFile == false)) {
                    const currentDate = new Date();
                    const timestamp = currentDate.toISOString().replace(/[-:.]/g, '');
                    const pathComponents = path.split('/');
                    const fileName = pathComponents.pop();
                    const newFileName = `${timestamp}_${fileName}`;
                    updatedFilePath = pathComponents.join('/') + '/' + newFileName;
                } else {
                    updatedFilePath = path
                }
            } else {
                updatedFilePath = path
            }

            if (thumbanilKey && thumbanilKey!== "") {
                let thumInd = thumbnailArray.findIndex((data)=>{
                    return data.key === thumbanilKey
                })
                if (thumInd === -1) {
                    reject("Invalid thumbnailKey")
                }
                const promises = [];
                let filePathArray = [];
                const fileContent = fs.readFileSync(file);
                const bucketName = isUserProfile ? awsRef.userProfileBucket : companyId;
                const fileName = updatedFilePath;
              
                const params = {
                    Bucket: bucketName,
                    Key: fileName,
                    Body: fileContent,
                    ContentType: exports.getContentType(fileName)
                };
                try {
                    s3Client.send(new PutObjectCommand(params))
                    .then(() => {
                        filePathArray.push(updatedFilePath);
                        thumbnailArray[thumInd].size.forEach((thu)=>{
                            promises.push(exports.uploadThumbnailFile(fileObject,thu.height,thu.width,updatedFilePath,companyId,isUserProfile))
                        })
                        Promise.allSettled(promises)
                        .then((results) => {
                            let count = 0;
                            let countFunction = (row) => {
                                if (count >= results.length) {
                                    fs.unlink(file, (err) => {
                                        if (err) {
                                            logger.error(`Error deleting file: ${err}`);
                                        }
                                    });
                                    resolve(filePathArray);
                                    return;
                                } else {
                                    if (row.status === "fulfilled") {
                                        filePathArray.push(row.value);
                                        count++;
                                        countFunction(results[count]);
                                    } else {
                                        logger.error("Error upload in thumbnail:", row.reason);
                                        count++;
                                        countFunction(results[count]);
                                    }
                                }
                            }
                            countFunction(results[count]);
                        })
                        .catch((error) => {
                            logger.error("Promise.allSettled error:", error);
                        });
                    }).catch((error)=>{
                        reject(`Error while upload file: ${error}`)
                        fs.unlink(file, (err) => {
                            if (err) {
                                logger.error(`Error deleting file: ${err}`);
                            }
                        });
                    })
                } catch (error) {
                    reject(`File upload error: ${error}`)
                    fs.unlink(file, (err) => {
                        if (err) {
                            logger.error(`Error deleting file: ${err}`);
                        }
                    });
                }
            } else {
                const fileContent = fs.readFileSync(file);
                const bucketName = isUserProfile ? awsRef.userProfileBucket : companyId;
                const fileName = updatedFilePath;
                const params = {
                    Bucket: bucketName,
                    Key: fileName,
                    Body: fileContent,
                    ContentType: exports.getContentType(fileName) 
                };
                try {
                    s3Client.send(new PutObjectCommand(params))
                    .then((response) => {
                        resolve(updatedFilePath);
                            fs.unlink(file, (err) => {
                                if (err) {
                                    logger.error(`Error deleting file: ${err}`);
                                }
                            });
                    }).catch((error)=>{
                        reject(`Error while upload file: ${error}`)
                        fs.unlink(file, (err) => {
                            if (err) {
                                logger.error(`Error deleting file: ${err}`);
                            }
                        });
                    })
                } catch (error) {
                    reject(`File upload error: ${error}`)
                    fs.unlink(file, (err) => {
                        if (err) {
                            logger.error(`Error deleting file: ${err}`);
                        }
                    });
                }
            }
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Upload a file in wasabi bucket
 * @param {Objcet} req
 * @param {Object} res
 * @returns
 */
exports.uploadFileWasabi = async (req,res) => {
    if (!(req.body && req.body.path)) {
        res.send({
            status: false,
            statusText: 'path is required'
        });
        return;
    }
    if (req.file === undefined || req.file.path === undefined) {
        res.send({
            status: false,
            statusText: 'file is required'
        });
        return;
    }
    let isUserProfile = false;
    if (req.body && (req.body.isUserProfile == true || req.body.isUserProfile == 'true')) {
        isUserProfile = true;
    } else {
        if (!(req.body && req.body.companyId)) {
            res.send({
                status: false,
                statusText: 'Company id is required'
            });
            return;
        }
    }
    if (!req.aud.split(",").includes(req.body.companyId)) {
        res.send({
            status: false,
            statusText: `You don't have access to requested bucket`
        });
        return;
    }
    exports.uploadFileWasabiPromise(req.body.companyId,req.body.path,req.file.path, req.body.replaceFile,req.file,req.body.key,isUserProfile).then((fileName)=>{
        res.send({
            status: true,
            statusText: fileName
        })
    }).catch((error)=>{
        res.send({
            status: false,
            statusText: error
        })
    })
}



/**
 * Delete a file in wasabi
 * @param {Objcet} req
 * @param {Object} res
 * @returns
 */
exports.deleteFileWasabi = async (req, res) => {
    if (!(req.body && req.body.companyId)) {
        res.send({
            status: false,
            statusText: `Company Id is required`
        })
        return;
    }

    if (!(req.body && req.body.path)) {
        res.send({
            status: false,
            statusText: `path Id is required`
        })
        return;
    }

    if (!req.aud.split(",").includes(req.body.companyId)) {
        res.send({
            status: false,
            statusText: `You don't have access to requested bucket`
        });
        return;
    }

    const command = new DeleteObjectCommand({
        Bucket: req.body.companyId,
        Key: req.body.path,
    });

    try {
        await s3Client.send(command);
        res.send({
           status: true, 
           statusText: `File deleted successfully`,
        });
    } catch (error) {
        res.send({
            status: false, 
            statusText: `Error: ${error}`
        });
    }
};

exports.getBucketSizeCompanyWise = async(companyId) => {
    try {
        const bucketName = JSON.parse(JSON.stringify(companyId));
        const params = {
            Bucket: bucketName,
            ContentType: exports.getContentType('')
        };
        const listObjectsCommand = new ListObjectsV2Command(params);
        await s3Client.send(listObjectsCommand)
        .then(async(data) => {
            let totalSize = 0;

            data.Contents.forEach((obj) => {
                totalSize += obj.Size;
            });

            let mongoObj = {
                type: SCHEMA_TYPE.COMPANIES,
                data: [
                    {
                        _id: new mongoose.Types.ObjectId(companyId)
                    },
                    {
                        $set: {
                            bucketSize: `${totalSize / (1024 * 1024)}`
                        }
                    }
                ]
            }
            await updateCompanyFun(SCHEMA_TYPE.GOLBAL,mongoObj,"findOneAndUpdate",companyId)
            .catch((error) => {
                logger.error(`Error updating company : ${error}`);
            })

        })
        .catch((err) => {
            logger.error(`Error while getting bucket size: ${err}`)
        });
    } catch (error) {
        logger.error(`Error while getting bucket size: ${error}`)
    }
}

exports.getBucketSize = () => {
    return new Promise((resolve, reject) => {
        try {
            let promises = [];

            getCompanyDataFun([],true)
            .then((response) => {
                response.forEach((cmp) => {
                    promises.push(exports.getBucketSizeCompanyWise(cmp._id))
                })
                Promise.allSettled(promises).then(() => {
                    logger.info("Completed");
                    resolve();
                }).catch((error) => {
                    logger.error("promises error", error);
                    reject();
                    return;
                })
            })
        } catch (error) {
            reject(error);
            logger.error(`Error while getting bucket size: ${error})`)
        }
    })
}

exports.copyWasabiImage = async(companyId,path,destinationKey) => {
    const copyParams = {
        Bucket: companyId,
        CopySource: `${companyId}/${path}`,
        Key: destinationKey,
    };
    try {
        await s3Client.send(new CopyObjectCommand(copyParams));
    } catch (err) {
        logger.error(`Error copying image: ${err}`)
    }
}

exports.getContentType = (key) => {
    const extension = key.split('.').pop().toLowerCase();
    switch (extension) {
        case 'png':
            return 'image/png';
        case 'jpg':
        case 'jpeg':
            return 'image/jpeg';
        case 'svg':
            return 'image/svg+xml';
        case 'gif':
            return 'image/gif';
        default:
            return 'application/octet-stream';
    }
};

/**
 * This funcion is used to upload any public assets into wasabi
 * @param {*} path 
 * @param {*} file 
 * @returns 
 */
exports.uploadPublicAssetsToWasabi = async (path, file) => {
    const fileContent = fs.readFileSync(file);
    const bucketName = process.env.USERPROFILEBUCKET;
    const fileName = `public_assets/${path}`;

    const params = {
        Bucket: bucketName,
        Key: fileName,
        Body: fileContent,
        ContentType: exports.getContentType(fileName),
        ACL: "public-read",
    };

    try {
        await s3Client.send(new PutObjectCommand(params));
        return fileName;
    } catch (error) {
        // Don’t crash server — just throw error back
        throw new Error(`Error uploading ${fileName}: ${error.message || error}`);
    }
};

exports.uploadPublicAssetsImagesInWasabi = async (imageArray) => {
    const results = await Promise.allSettled(
        imageArray.map(x =>
            exports.uploadPublicAssetsToWasabi(x.path, x.filePath)
        )
    );

    // Collect successful uploads
    const success = results.filter(r => r.status === "fulfilled").map(r => r.value);

    // Collect failed uploads
    const failed = results.filter(r => r.status === "rejected").map(r => r.reason);

    if (failed.length > 0) {
        logger.error("Some uploads failed:", failed);
    }

    return success; // return only successful public URLs
};

exports.uploadPublicAssets = async () => {
    const imageArray = [
        { path: 'email_arrow_right_alt.png', filePath: __dirname + "/../../../wasabiUploadsLocal/email_arrow_right_alt.png" },
        { path: 'email_banner_icon.png', filePath: __dirname + "/../../../wasabiUploadsLocal/email_banner_icon.png" },
        { path: 'email_folder_icon.png', filePath: __dirname + "/../../../wasabiUploadsLocal/email_folder_icon.png" },
    ];

    return await exports.uploadPublicAssetsImagesInWasabi(imageArray);
};


exports.cleanUpTrackShotCompanyWise = async(companyId) => {
    try {
        
        const RETENTION_DAYS = process.env.TRACKSHOT_RETENTION_DAYS || 180;
        const cutoffDate = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
        
            let mongoObj = {
                type: SCHEMA_TYPE.TIMESHEET,
                data: [{
                LogStartTime: { $lt: Number(cutoffDate)/1000 },
                "trackShots.0": { $exists: true },
            }]
            }
            const oldTimesheets = await MongoDbCrudOpration(companyId,mongoObj,"find");
    
            for (const ts of oldTimesheets) {
                let updatedShots = [];
                
                for (const shot of ts.trackShots) {
                    try {

                        const command = new DeleteObjectCommand({
                            Bucket: companyId,
                            Key: shot.image,
                        });

                        await s3Client.send(command)
                        updatedShots.push({
                            ...shot,
                            deleted: true,
                        });
                    } catch (err) {
                        updatedShots.push({
                            ...shot,
                            deleted: false,
                        });
                    }
                }
                await MongoDbCrudOpration(companyId,{
                    type: SCHEMA_TYPE.TIMESHEET,
                    data: [
                        { _id: ts._id },
                    { $set: { trackShots: updatedShots } }
                    ]
                },'findOneAndUpdate');
            }
    } catch (error) {
        logger.error(`Error Updating aut cleanup company trackshot:${error}`)
    }

}
exports.cleanUpTrackshotStorage = async () => {
    try {
    getCompanyDataFun([],true)
    .then((response) => {
        response.forEach((cmp) => {
            cleanUpTrackShotCompanyWise(cmp._id);
        })}).catch((error)=>{
            logger.error(`Error getting company:${error}`)
        })
    } catch (err) {
        logger.error(`Error getting company:${err.message}`)
    }
}

