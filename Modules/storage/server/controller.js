const { dbCollections } = require("../../../Config/collections");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { createBucketHelper, getBucketSizeCompanyWiseStorage, iconsThumbnailGenerator } = require("./helpers/bucket.helper.js");
const fs = require('fs');
const path = require('path');
const { generateSignedUrl, checkBucketInDB, uploadStorageThumbnailFile } = require("./helpers/bucket.helper.js");
const thumbnailArray = require("../../../thumbnail.json");
const jwt = require("jsonwebtoken");

/**
 * @description Create a bucket for the specified database.
 * @param {*} req 
 * @param {*} res  
 */
exports.createBucketOnStorage = async(req, res) => {
    const {bucketId, rule} = req.body;

    if (!bucketId) {
        return res.status(400).json({
            success: false,
            statusText: 'bucketId is required'
        })
    }
    if (!rule || (rule && !Object.keys(rule).length)) {
        return res.status(400).json({
            success: false,
            statusText: 'rule is required'
        })
    }

    const regex = /^[^\s^\x00-\x1f\\?*:"";<>|\/.][^\x00-\x1f\\?*:"";<>|\/]*[^\s^\x00-\x1f\\?*:"";<>|\/.]+$/g;
    if(!regex.test(bucketId)){
        return res.status(400).json({
            success: false,
            statusText: 'Bucket name is not valid'
        })
    }

    const bucket = await createBucketHelper(req.body);

    if(!bucket?.status){
        return res.status(400).json({
            success: false,
            statusText: bucket?.isExists ? 'Bucket already exists' : 'Bucket creation failed'
        })
    }

    return res.status(200).json({
        success: true,
        statusText: 'Bucket created successfully'
    })

}


exports.getBucketOnStorage = async (req, res) => {
    const { bucketId } = req.params;
    try {
        const bucket = await MongoDbCrudOpration("global", { type: dbCollections.BUCKETS, data: [{ id: bucketId }] }, "findOne");
        if (!bucket) {
            return res.status(404).json({ status: false, statusText: 'Bucket not found', message: 'Bucket not found' });
        }
        return res.status(200).json({ status: true, statusText: 'Bucket found', data: bucket });
    } catch (error) {
        return res.status(400).json({ status: false, statusText: 'Bucket lookup failed', message: error.message });
    }
}


/**
 * @description Update a bucket in the database rules.
 * @param {*} req
 * @param {*} res
 */
exports.updateBucketOnStorage = (req,res) => {
    const {rule} = req.body;
    const {bucketId} = req.params;

    if(!bucketId) {
        return res.status(400).json({
            success: false,
            statusText: 'bucketId is required'
        })
    }
    if(!rule || (rule && !Object.keys(rule).length)) {
        return res.status(400).json({
            success: false,
            statusText: 'rule is required'
        })
    }

    const object = {
        type: dbCollections.BUCKETS,
        data: [
            { id : bucketId },
            { $set: { rule : rule } },
            { new: true }
        ]
    }
    try {
        MongoDbCrudOpration("global", object, "findOneAndUpdate")
        .then(result => {
            if(result !== null){
                return res.status(200).json(result)
            } else {
                return res.status(400).json({
                    success: false,
                    statusText: 'Bucket not found'
                })
            }
        })
        .catch(err => {
            return res.status(400).json({
                success: false,
                statusText: err
            })
        })
    } catch (error) {
        return res.status(400).json({
            success: false,
            statusText: error
        })
    }
}


exports.removeBucketOnStorage = async (req, res) => {
    const { bucketId } = req.params;
    try {
        const removed = await MongoDbCrudOpration("global", { type: dbCollections.BUCKETS, data: [{ id: bucketId }] }, "findOneAndDelete");
        if (!removed) {
            return res.status(404).json({ status: false, statusText: 'Bucket not found', message: 'Bucket not found' });
        }
        await fs.promises.rm(path.join(__dirname, '../../../storage', bucketId), { recursive: true, force: true });
        return res.status(200).json({ status: true, statusText: 'Bucket removed', data: removed });
    } catch (error) {
        return res.status(400).json({ status: false, statusText: 'Bucket removal failed', message: error.message });
    }
}


exports.getBucketSizeOnStorage = async (req, res) => {
    const { bucketId } = req.params;
    const { unit = '' } = req.query;
    try {
        const size = await getBucketSizeCompanyWiseStorage(bucketId, unit);
        return res.status(200).json({ status: true, statusText: 'Bucket size', data: size });
    } catch (error) {
        return res.status(400).json({ status: false, statusText: 'Bucket size failed', message: error.message || String(error.statusText || error) });
    }
}

/**
 * @description Upload files on storage with bucket and path.
 * @param {*} req 
 * @param {*} res  
 */
exports.uploadFileOnStorage = async(req, res) => {
    if (!(req.body && req.body.path)) {
        res.status(400).send({
            status: false,
            statusText: 'path is required'
        });
        return;
    }
    
    if (!(req.body && req.body.companyId)) {
        res.status(400).send({
            status: false,
            statusText: 'companyId is required'
        });
        return;
    }

    if (req.file === undefined || req.file.path === undefined) {
        res.status(400).send({
            status: false,
            statusText: 'file is required'
        });
        return;
    }

    if(req.body.key) {
        let index = thumbnailArray.findIndex(x => x.key === req.body.key);
        let promises = [];
        if(index !== -1) {
            thumbnailArray[index].size.forEach((thu)=>{
                promises.push(uploadStorageThumbnailFile(req.body.path,thu.height,thu.width,req.body.companyId,req.file))
            })
            Promise.allSettled(promises).then(()=>{
                return res.status(200).send({
                    status: true,
                    statusText: req.body.path
                })
            }).catch((error)=>{
                return res.status(400).send({
                    status: false,
                    statusText: error
                })
            })
        } else {
            const filePath = path.join(__dirname, '../../../storage', req.body.companyId, req.body.path)
            fs.unlinkSync(filePath);
            return res.status(400).send({
                status: false,
                statusText: 'invalid thumbnail key'
            });
        }
    } else {
        return res.status(200).send({
            status: true,
            statusText: req.body.path
        })
    }
}

/**
 * @description generate siged or public url of files
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.getSignedUrlFile = async(req, res) => {
    const { filepath,domainUrl } = req.query;
    const { bucketId } = req.params;
    if (!filepath) {
        return res.status(400).send({
            status: false,
            statusText: 'filepath is required'
        });
    }
    if (!bucketId) {
        return res.status(400).send({
            status: false,
            statusText: 'bucketId is required'
        });
    }
    const bucketValid = await checkBucketInDB(bucketId);

    if(bucketValid && Object.keys(bucketValid).length) {
        if(bucketValid.rule.isPrivate) {
            const signedUrl = generateSignedUrl(bucketId, filepath, domainUrl);
            res.status(200).send({ url: signedUrl });
        } else {
            res.status(200).send({ url: `${domainUrl}/api/v1/download/${bucketId}/${filepath}` });
        }
    } else{
        res.status(404).send({
            status: false,
            statusText: 'Bucket not found'
        });
    }
};

/**
 * @description handle files of public and signed URLs request
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.handleFileRequest = async(req, res) => {
    const { bucketId } = req.params;
    const filepath = req.params[0];
    const { token } = req.query;

    try {

        if(!token) {
            const bucketValid = await checkBucketInDB(bucketId);
            if(bucketValid && Object.keys(bucketValid).length && bucketValid.rule.isPrivate == false) {
                const filePath = exports.resolveBucketFile(bucketId, filepath);
                if (fs.existsSync(filePath)) {
                    res.sendFile(filePath, (err) => {
                        if (err) {
                            return;
                        }
                    });
                    return;
                } else {
                    res.status(404).send({status: false,statusText:'Resorce Not Found'});
                    return;
                }
            } else {
                res.status(404).send({status: false,statusText:'Resorce Not Found on bucket'});
                return;
            }
        } else {
            const jwTDataobj = jwt.verify(token, process.env.JWT_SECRET);
    
            if (jwTDataobj.bucketId!== bucketId || jwTDataobj.filepath!== filepath) {
                res.status(404).send({status: false,statusText:'Resorce Not Found on bucket'});
                return;
            }
            const filePath = exports.resolveBucketFile(bucketId, filepath);
    
            if (fs.existsSync(filePath)) {
                if(req.query.download) {
                    res.download(filePath, err => {
                        if(err) {
                            return;
                        }
                    })
                } else {
                    res.sendFile(filePath, (err) => {
                        if (err) {
                            return;
                        }
                    });
                }
            } else {
                res.status(404).send({status: false,statusText:'Resorce Not Found'});
                return;
            }
        }
    } catch (error) {
        res.status(404).send({status: false,statusText:'Resorce Not Found'});
        return;
    }
}

/**
 * @description Remove files from the bucket in storage with specified path and bucket name.
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.removeFileFromStorage = (req,res) => {
    const { bucketId } = req.params;
    const { filepath } = req.query;
    if (!filepath) {
        return res.status(400).send({
            status: false,
            statusText: 'filepath is required'
        });
    }
    if (!bucketId) {
        return res.status(400).send({
            status: false,
            statusText: 'bucketId is required'
        });
    }

    if(req.query.thubmkey) {
        let index = thumbnailArray.findIndex(x => x.key === req.query.thubmkey);
        let promises = [];
        if(index!== -1) {
            thumbnailArray[index].size.forEach((thu) => {
                let filePath;
                if(req.query.thubmkey === 'userProfile') {
                    const directoryPath = filepath.split('/').slice(0, -1).join('/');
                    const fileName = filepath.split('/').pop();

                    const lastDotInd = fileName.lastIndexOf(".");
                    const baseName = fileName.substring(0, lastDotInd);
                    const extension = fileName.substring(lastDotInd + 1);
                    filePath = path.join(__dirname,'../../../storage',bucketId,directoryPath,`${baseName}-${thu.height}x${thu.width}.${extension}`);
                } else {
                    const extensionInd = filepath.lastIndexOf(".");
                    const baseName = filepath.substring(0, extensionInd);
                    const extension = filepath.substring(extensionInd + 1);
                    filePath = path.join(__dirname, '../../../storage', bucketId, `${baseName}-${thu.height}x${thu.width}.${extension}`);
                }
                if (fs.existsSync(filePath)) {
                    promises.push(fs.promises.unlink(filePath));
                }
            });
            Promise.allSettled(promises).then(()=>{
                const filePath = exports.resolveBucketFile(bucketId, filepath);
                // fs.chmodSync(filePath, 0o666);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    res.status(200).send({
                        status: true,
                        statusText: 'File deleted successfully'
                    });
                } else {
                    res.status(404).send({
                        status: false,
                        statusText: 'File not found'
                    });
                }
            }).catch((error)=>{
                return res.status(400).send({
                    status: false,
                    statusText: error
                })
            }) 
        }
    } else {
        const filePath = exports.resolveBucketFile(bucketId, filepath);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            res.status(200).send({
                status: true,
                statusText: 'File deleted successfully'
            });
        } else {
            res.status(404).send({
                status: false,
                statusText: 'File not found'
            });
        }
    }
}

exports.uploadBase64FileOnServerStorage = (req,res) => {
    try {
        if (!(req.body && req.body.path)) {
            res.status(400).send({
                status: false,
                statusText: 'path is required'
            });
            return;
        }
        
        if (!(req.body && req.body.companyId)) {
            res.status(400).send({
                status: false,
                statusText: 'companyId is required'
            });
            return;
        }
    
        if (!(req.body && req.body.base64String)) {
            res.status(400).send({
                status: false,
                statusText: 'base64String is required'
            });
            return;
        }
    
        const bucketDir = path.join(__dirname, '../../../storage', req.body.companyId);
    
        const dirPath = path.join(bucketDir, req.body.path);
    
        const base64Data = req.body.base64String.replace(/^data:([A-Za-z-+/]+);base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        iconsThumbnailGenerator(req.body.path,req.body.companyId,{},buffer,path.basename(dirPath),req.body.key || '').then(()=>{
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(path.dirname(dirPath), { recursive: true });
            }
            
            fs.writeFile(dirPath, buffer, (err) => {
                if (err) {
                    res.status(400).send({
                        status: false,
                        statusText: 'Error generating thumbnail'
                    })
                } else {
                    res.status(200).send({
                        status: true,
                        statusText: req.body.path
                    })
                }
            });
        }).catch(()=>{
            res.status(400).send({
                status: false,
                statusText: 'Error generating thumbnail'
            })
        })
    } catch (error) {
        res.status(400).send({
            status: false,
            statusText: 'Error generating thumbnail iconsThumbnailGenerator + error: ' + JSON.stringify(error)
        })
    }
}
const STORAGE_ROOT = path.resolve(__dirname, '../../../storage');

/* req.params[0] arrives URL-decoded, so "..%2f" is a real "../" by the time it is joined. */
exports.resolveBucketFile = (bucketId, filepath) => {
    const bucketRoot = path.resolve(STORAGE_ROOT, String(bucketId || ''));
    if (path.dirname(bucketRoot) !== STORAGE_ROOT) return '';
    const target = path.resolve(bucketRoot, String(filepath || ''));
    return target.startsWith(bucketRoot + path.sep) ? target : '';
};
