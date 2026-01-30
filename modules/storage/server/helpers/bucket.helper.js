const fs = require('fs');
const path = require('path');
const { dbCollections } = require('../../../../Config/collections');
const { MongoDbCrudOpration } = require('../../../../utils/mongo-handler/mongoQueries');
const loggerConfig = require('../../../../Config/loggerConfig');
const { default: mongoose } = require("mongoose");
const { SCHEMA_TYPE } = require('../../../../Config/schemaType');
const thumbnailArray = require('../../../../thumbnail.json');

exports.iconsThumbnailGenerator = (fpath,companyId,file,bufferString,fileNameWithRan,thumbnailKey) => {
    return new Promise((resolve, reject) => {
        try {
            let index = thumbnailArray.findIndex(x => x.key === thumbnailKey);
            if (index === -1) {
                return resolve({
                    status: false,
                    statusText: 'Invalid Key thumbnail'
                });
            }
        
            let promises = thumbnailArray[index].size.map((thu) => 
                this.uploadStorageThumbnailFilev2(fpath, thu.height, thu.width, companyId, file,bufferString,fileNameWithRan)
            );
        
            Promise.allSettled(promises).then(() => {
                return resolve([fpath]);
            });
        } catch (error) {
            reject(error);
        }
    })
}
/**
 * @description Helper for creating a bucket in the database as well as creating in storage directory.
 * @returns true if the bucket creation is successful
 * @returns false if the bucket creation is failed
 * @param {Object}
 */
exports.createBucketHelper = (bucketObject,files = '',fromCreateCompnay = false) => {
    return new Promise(async(resolve, reject) => {

        const { bucketId, rule } = bucketObject;

        const bucketDir = path.join(__dirname, '../../../../storage', bucketId);

        if (fs.existsSync(bucketDir) && fromCreateCompnay === false) {
            return resolve({status:false,isExists:true});
        }

        const object = {
            type: dbCollections.BUCKETS,
            data: {
                id:bucketId,
                rule
            }
        }
        if (files && fromCreateCompnay) {
            let fileNameWithRan = Date.now() + '_' + files.fileName;
            const dirPath = path.join(bucketDir, 'companyIcon');
            const filePath = path.join(dirPath, fileNameWithRan);
    
        
            fs.mkdirSync(dirPath, { recursive: true });
        
            const base64Data = files.fileString.replace(/^data:([A-Za-z-+/]+);base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            await this.iconsThumbnailGenerator('companyIcon/' + fileNameWithRan,bucketId,files,buffer,fileNameWithRan,'companyIcon')
        
            fs.writeFile(filePath, buffer, (err) => {
                if (err) {
                    reject(err);
                    loggerConfig.error(`Error writing file:: ${err}`);
                } else {
                    loggerConfig.info(`STORAGE DONE FOR FILES::`);
                }
            });

            let firebaseObj = {
                type: SCHEMA_TYPE.COMPANIES,
                data: [
                    {
                        _id: new mongoose.Types.ObjectId(bucketId)
                    },
                    {
                        $set: {
                            Cst_profileImage: 'companyIcon/' + fileNameWithRan
                        }
                    }
                ]
            }
            updateCompanyFun(SCHEMA_TYPE.GOLBAL,firebaseObj,"updateOne",bucketId)
            .then(()=>{
                resolve({status:true,isExists:false});
            }).catch((error)=>{
                reject(error);
                loggerConfig.error(`Company Profile Error: ${error}`);
            })
        } else {
            let objectFind = {
                type: dbCollections.BUCKETS,
                data: [{
                    id: bucketId
                }]
            }
            MongoDbCrudOpration('global',objectFind,"find").then((bucketRes) => {
                if (bucketRes.length) {
                    resolve({status:false,isExists:true});
                } else {
                    MongoDbCrudOpration("global", object, "save")
                    .then(result => {
                        fs.mkdirSync(bucketDir, { recursive: true });
                        this.uploadTaskTypeImage(bucketId)
                        this.uploadPriority(bucketId)
            
                        resolve({status:true,isExists:false});
                    })
                    .catch(err => {
                        loggerConfig.error(`Company Profile Error: ${err}`);
                        reject({status:true});
                    })
                }
            }).catch((error)=>{
                reject(error);
                loggerConfig.error(`Company Profile Error: ${error}`);
            })
        }
    })
}

/**
 * @description Getting the bucket size with nested files and folders.
 * @param {string} directoryPath 
 * @returns 
 */
exports.getDirectorySize = (directoryPath) => {
    let totalSize = 0;

    function calculateFSize(dirPath) {
        const files = fs.readdirSync(dirPath);

        files.forEach(file => {
            const filePath = path.join(dirPath, file);
            const stats = fs.statSync(filePath);

            if (stats.isDirectory()) {
                calculateFSize(filePath);
            } else {
                totalSize += stats.size;
            }
        });
    }

    calculateFSize(directoryPath);
    return totalSize;
}

/**
 * @description Formatting the size of the bucket.
 * @param {number} size 
 * @param {string} unit 
 * @returns
 */
exports.formatBucketSize = (size, unit) => {
    switch (unit) {
        case 'KB':
        case 'kb':
            return size / 1024;
        case 'MB':
        case 'mb':
            return size / (1024 * 1024);
        case 'GB':
        case 'gb':
            return size / (1024 * 1024 * 1024);
        default:
            return size;
    }
}

async function copyFile(source, destination) {
    try {
        await fs.cp(source, destination,(err, data) => {
            if (err) {
                loggerConfig.error('Error copying file:', err);
            } else {
                loggerConfig.info('File copied successfully');
            }
        });
    } catch (error) {
        loggerConfig.error('Error copying file:', error);
    }
}
exports.uploadIamgesInStorage = (imageArray,companyId) => {
    return new Promise(async (resolve, reject) => {
        try {
            imageArray.forEach(async(x)=>{
                const destPath = path.join(__dirname, '../../../../storage', companyId, x.path);
                const srcPath = path.join(__dirname, '/../../../../wasabiUploadsLocal', x.filePath);
                await copyFile(srcPath,destPath)
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
                    filePath: "bug.png"
                },
                {
                    path:'setting/task_type/design.png',
                    filePath: "design.png"
                },
                {
                    path:'setting/task_type/subtask.png',
                    filePath: "subtask.png"
                },
                {
                    path:'setting/task_type/task.png',
                    filePath: "task.png"
                },

            ];
            exports.uploadIamgesInStorage(imageArray,companyId).then(() => {
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
                    filePath: "priority_medium.png"
                },
                {
                    path:'taskPriorities/priority_low.png',
                    filePath: "priority_low.png"
                },
                {
                    path:'taskPriorities/priority_high.png',
                    filePath: "priority_high.png"
                }

            ];
            exports.uploadIamgesInStorage(imageArray,companyId).then(() => {
                resolve();
            })
        } catch (error) {
            reject(error);
        }
    })
}

exports.createCompanyDataStorageFun = (bodyData, companyId) => {
    return new Promise((resolve, reject) => {
        try {
            if (bodyData && bodyData.file && bodyData.fileName) {
                exports.createCompanyDataStorage(companyId, bodyData.fileName ,bodyData.file).then(()=>{
                    loggerConfig.info(`${companyId} >> STORAGE CREATED`);
                    resolve({
                        status: true,
                        statusText: `${companyId} >> STORAGE CREATED`
                    });
                }).catch((error)=>{
                    reject({
                        status: false,
                        error: error
                    });
                })
            } else {
                exports.createCompanyDataStorage(companyId,{},"").then(()=>{
                    loggerConfig.info(`${companyId} >> STORAGE CREATED`);
                    resolve({
                        status: true,
                        statusText: `${companyId} >> STORAGE CREATED`
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
}

exports.createCompanyDataStorage =  (companyId, fileName, fileString) => {
    return new Promise((resolve, reject) => {
        if(fileName && Object.keys(fileName).length > 0 && fileString) {
            exports.createBucketHelper({bucketId: companyId ,rule: {isPrivate: true} },{fileName:fileName,fileString:fileString}, true).then((res)=>{
                resolve();
            }).catch((error)=>{
                reject(error);
                loggerConfig.error(`createBucketHelper Error: ${JSON.stringify(error)}`);
            })
        } else {
            exports.createBucketHelper({bucketId: companyId ,rule: {isPrivate: true} },'',true).then(()=>{
                resolve();
            }).catch((error)=>{
                reject(error);
                loggerConfig.error(`createBucketHelper Error: ${JSON.stringify(error)}`);
            })
        }
    })
}


exports.getBucketSizeCompanyWiseStorage = (bucketId,unit,isUpdate=false) => {
    return new Promise(async(resolve, reject) => {
        try {
                const bucketDir = path.join(__dirname, '../../../../storage', bucketId);
                if (fs.existsSync(bucketDir)) {
                    
                    const dataSize = this.getDirectorySize(bucketDir);
                    const size = this.formatBucketSize(dataSize,unit);
                    if(isUpdate) {
                        let mongoObj = {
                            type: SCHEMA_TYPE.COMPANIES,
                            data: [
                                {
                                    _id: new mongoose.Types.ObjectId(bucketId)
                                },
                                {
                                    $set: {
                                        bucketSize: `${dataSize / (1024 * 1024)}`
                                    }
                                }
                            ]
                        }
                        await updateCompanyFun(SCHEMA_TYPE.GOLBAL,mongoObj,"findOneAndUpdate",bucketId)
                        then(()=>{
                            resolve({
                                size: size,
                                unit: unit
                            })
                        }).catch((error) => {
                            loggerConfig.error(`Error updating company : ${error}`);
                        })
                    } else {
                        resolve({
                            size: size,
                            unit: unit
                        })
                    }
                } else {
                    resolve({
                        size: 0,
                        unit: unit
                    })
                }
            } catch (error) {
                reject({
                    success: false,
                    statusText: error
                })
            }
        })
    }

exports.getBucketSizeStorage = () => {
    return new Promise((resolve, reject) => {
        try {
            let promises = [];
            getCompanyDataFun([],true)
            .then((response) => {
                response.forEach((cmp) => {
                    promises.push(exports.getBucketSizeCompanyWiseStorage(JSON.parse(JSON.stringify(cmp._id)),'',true))
                })
                Promise.allSettled(promises).then(() => {
                    loggerConfig.info("Completed");
                    resolve();
                }).catch((error) => {
                    loggerConfig.error("promises error", error);
                    reject();
                    return;
                })
            })
        } catch (error) {
            reject(error);
            loggerConfig.error(`Error while getting bucket size: ${error})`)
        }
    })
}

// FILE 
const multer = require('multer');
const jwt = require('jsonwebtoken');
const sharp = require('sharp');
const { updateCompanyFun, getCompanyDataFun } = require('../../../company/controller/update-company');

const storage = multer.diskStorage({
    destination: function (req, _, cb) {
        const { path: filepath, companyId: bucketId } = req.body;

        const dir = path.join(__dirname, '../../../../storage', bucketId ,filepath.split('/').slice(0, -1).join('/'));

        fs.mkdirSync(dir, { recursive: true });

        cb(null, dir);
    },
    filename: function (req, _, cb) {
        let fileNameFromPath = req.body.path.split('/').pop();
        cb(null, fileNameFromPath);
    }
});
exports.storageRef = storage;
exports.upload = multer({  storage });

exports.validatePath = async(req, res, next) => {
    const { path: filepath, companyId: bucketId } = req.body;
    if (!req.aud.split(",").includes(req.body.companyId)) {
        res.send({
            status: false,
            statusText: `You don't have access to requested bucket`
        });
        return;
    }
    
    if (!filepath || filepath.includes('..') || filepath.includes('./') || filepath.includes('//') || filepath.startsWith('/')) {

        const dir = path.join(__dirname, '../../../../storage', bucketId ,filepath);
        if (fs.existsSync(dir)) {
            fs.unlinkSync(dir);
        }
        return res.status(400).send({status: false, statusText: 'Invalid path'});
    }

    if(bucketId !== "USER_PROFILES") {
        const bucketValid = await this.checkBucketInDB(bucketId);

        if (bucketValid && Object.keys(bucketValid).length == 0) {
            const dir = path.join(__dirname, '../../../../storage', bucketId);
            if (fs.existsSync(dir)) {
                fs.rmdirSync(dir,{ recursive: true, force: true });
            }
            return res.status(400).send({status: false, statusText: 'Invalid bucketId'});
        }
    }

    next();
}

exports.generateSignedUrl = (bucketId, filepath,domainUrl) => {
    const token = jwt.sign({ bucketId, filepath }, process.env.JWT_SECRET, { algorithm: process.env.JWT_ALGORITHM,
        expiresIn: process.env.JWT_EXP });
    return `${domainUrl}/api/v1/download/${bucketId}/${filepath}?token=${token}`;
}

exports.checkBucketInDB = (bucketId) => {
    return new Promise((resolve, reject) => {
        if(bucketId !== 'USER_PROFILES') {
            let obj = {
                type: dbCollections.BUCKETS,
                data: [{id : bucketId}]
            }
            MongoDbCrudOpration("global",obj,"findOne")
            .then((dataObject)=>{
                if(dataObject && Object.keys(dataObject).length) {
                    resolve(dataObject)
                } else {
                    resolve({})
                }
            })
            .catch((error)=>{
                loggerConfig.error('Mongo check error: ' + error.messge)
                reject(error)
            })
        } else {
            resolve({rule: {isPrivate : true}})
        }
    })
}


exports.uploadStorageThumbnailFile = async (filePath, x, y, companyId, file) => {
    const outputDir = path.join(__dirname, '../../../../storage', companyId, filePath.split('/').slice(0, -1).join('/'));

    const outputFile = path.join(outputDir, `${path.basename(file.filename, path.extname(file.filename))}-${x}x${y}${path.extname(file.filename)}`);

    try {
        fs.mkdirSync(outputDir, { recursive: true });

        await sharp(file.path)
            .resize(x, y)
            .toFile(outputFile);

        return outputFile;
    } catch (err) {
        loggerConfig.error('Error generating thumbnail:', err);
        throw err;
    }
};

exports.uploadStorageThumbnailFilev2 = async (filePath, x, y, companyId, file,bufferString='',fileNameWithRan='') => {
    let outputDir;
    let outputFile;
    try {
        outputDir = path.join(__dirname, '../../../../storage', companyId, filePath.split('/').slice(0, -1).join('/'));
        outputFile = path.join(outputDir, `${path.basename(fileNameWithRan, path.extname(fileNameWithRan))}-${x}x${y}${path.extname(fileNameWithRan)}`);
    } catch (error) {
        loggerConfig.error('Error generating thumbnail:outputDir,outputFile', error);
    }

    try {
        fs.mkdirSync(outputDir, { recursive: true });

        let sharpInstance;
        if (bufferString) {
            const buffer = Buffer.from(bufferString, 'base64');
            sharpInstance = sharp(buffer);
        } else {
            sharpInstance = sharp(file.path);
        }

        await sharpInstance
            .resize(x, y)
            .toFile(outputFile);

        return outputFile;
    } catch (err) {
        loggerConfig.error('Error generating thumbnail:', err);
        throw err;
    }
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
                        const filePath = path.join(__dirname, '../../../storage', companyId, shot.image);
                        fs.unlinkSync(filePath);
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