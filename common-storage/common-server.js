const loggerConfig = require("../Config/loggerConfig");
const { createCompanyDataStorageFun, getBucketSizeStorage, uploadStorageThumbnailFile, storageRef, generateSignedUrl,cleanUpTrackshotStorage } = require("../Modules/storage/server/helpers/bucket.helper");
const fs = require('fs');
const newPath = require("path")
const thumbnailArray = require('../thumbnail.json');
exports.currentDirectory = 'server';
/**
 * 
 * @param {object} cObj 
 * @param {string} companyId 
 * @returns 
 */
exports.handleCreateCompanyDataStorageFun = async(cObj,companyId) => {
    return new Promise((resolve, reject) => {
        try {
            createCompanyDataStorageFun(cObj,companyId).then((resObject) => {
                resolve(resObject);
            })
            .catch((err) => {
                reject(err);
                loggerConfig.error('Error handleCreateCompanyDataStorageFun' + err.message)
            });
        } catch (error) {
            reject(err);
            loggerConfig.error('Error handleCreateCompanyDataStorageFun' + err.message)
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
        try {
            createCompanyDataStorageFun(bodyData,companyId).then((resObject) => {
                resolve(resObject);
            })
            .catch((err) => {
                reject(err);
                loggerConfig.error('Error handleCreateCompanyDataStorageFunForUpload' + err.message)
            });
        } catch (error) {
            reject(err);
            loggerConfig.error('Error handleCreateCompanyDataStorageFunForUpload' + err.message)
        }
    })
}

/**
 * 
 * @param {object} companyId 
 * @param {object} _ 
 * @param {string} fileData 
 * @returns 
 */
exports.handleChargeebeCreditNotUpload = (companyId,_,fileData,id) => {
    return new Promise((resolve, reject) => {
        try {
            let filePath = `USER_PROFILES/InvoiceAndCreditNotes/CreditNotes/${companyId}/${id}.pdf`;
            let fullPath = newPath.join(__dirname, '../storage', filePath);
            fs.writeFile(fullPath, Buffer.from(fileData,'binary'), (error) => {
                if (error) {
                    loggerConfig.error(`Credit Note Download Error ${error.message ? error.message : error}`);
                    return;
                }
                resolve()
            });
        } catch (error) {
            loggerConfig.error(`Erro While Uploading Credit Note In STorage: ${error.message ? error.message : error}`);
            reject(error);
        }
    })
}

exports.handleBucketSizeUpdateCron = () => {
    getBucketSizeStorage();
}

exports.cleanUpTrackshot = async () => {
    cleanUpTrackshotStorage();
}

/**
 * 
 * @param {String} companyId 
 * @param {String} fpath 
 * @param {String} filepath 
 * @param {boolean} isReplace as _
 * @param {object} file 
 * @param {string} trackshot 
 * @returns 
 */
exports.handleFileUploadForTrackerSS = (companyId, fpath, filepath, _, file, trackshot) => {
    return new Promise((resolve, reject) => {
        try {
            let index = thumbnailArray.findIndex(x => x.key === trackshot);
            if (index === -1) {
                return resolve({
                    status: false,
                    statusText: 'Invalid Key thumbnail'
                });
            }

            let promises = thumbnailArray[index].size.map((thu) => 
                uploadStorageThumbnailFile(fpath, thu.height, thu.width, companyId, file)
            );

            Promise.allSettled(promises).then(() => {
                return resolve([fpath]);
            });
        } catch (error) {
            loggerConfig.error(`Error handleFileUploadForTrackerSS: ${error.message ? error.message : error}`);
            reject(error);
        }
    });
};

exports.handleWasabiCredentials = () => {
    return new Promise((resolve, reject) => {
        try {
            resolve();
        } catch (error) {
            reject(error);
        }
    })
}
exports.handleuploadMainFileForbase64Thumbnail = (companyId, filepath, file, isReplace, trackshot) => {
    return exports.handleFileUploadForTrackerSS(companyId, filepath, file, isReplace, trackshot);
}

exports.handleMulterStorage = () => {
    return {storage:storageRef};
}

exports.handleProfileGetForUser = async (req,res) => {
    if(!(req.body || req.body.path)) {
        res.send({
            status: false,
            statusText: 'path is required'
        });
        return;
    }
    
    const domainUrl = `${req.protocol}://${req.get('host')}`;
    const signedUrl = await generateSignedUrl("USER_PROFILES", req.body.path, domainUrl);

    if(signedUrl) {
        return res.status(200).send({ status:true ,statusText: signedUrl });
    } else {
        return res.send({
            status: false,
            statusText: 'error while fetching userprofile'
        });
    }
}
exports.handleTaskTypeImageGet = async (req,res) => {
        if(!(req.body || req.body.path)) {
            res.send({
                status: false,
                statusText: 'path is required'
            });
            return;
        }
        if(!(req.body || req.body.companyId)) {
            res.send({
                status: false,
                statusText: 'companyId is required'
            });
            return;
        }
        
        const domainUrl = `${req.protocol}://${req.get('host')}`;
        const signedUrl = await generateSignedUrl(req.body.companyId, req.body.path, domainUrl);

        if(signedUrl) {
            return res.status(200).send({ status:true ,statusText: signedUrl });
        } else {
            return res.send({
                status: false,
                statusText: 'error while fetching userprofile'
            });
        }
}
exports.handleTaskAttachmentsDuplicateFunctionality = async (bucketId, previousPath, destinationPath) => {
    try {
        const baseDir = newPath.join(__dirname, '../storage', bucketId);
        const fullPreviousPath = newPath.join(baseDir, newPath.dirname(previousPath));
        const destinationDir = newPath.join(baseDir, newPath.dirname(destinationPath));

        await fs.promises.mkdir(destinationDir, { recursive: true });

        const files = await fs.promises.readdir(fullPreviousPath);
        
        if (files.length === 0) {
            return true;
        }

        await Promise.all(files.map(file => {
            const oldFilePath = newPath.join(fullPreviousPath, file);
            const newFilePath = newPath.join(destinationDir, file);
            return fs.promises.copyFile(oldFilePath, newFilePath);
        }));

        return true;
    } catch (error) {
        throw error;
    }
};