const { handleProfileGetForUser, handleTaskTypeImageGet } = require(`../../../common-storage/common-${process.env.STORAGE_TYPE}.js`);
const ctrl = require('./controller');
const { upload, validatePath } = require('./helpers/bucket.helper');
const { requireInstanceAdmin } = require('../../Instance/guard');
const { requireOwnBucket, requireBucketWrite, requireBucketRemoval, requireSafeObjectPath, bucketIdParam, bodyField, queryField } = require('../bucketAccess');

exports.init = (app) => {
    const ownBucket = requireOwnBucket(bucketIdParam);
    const ownOrProfileBucket = requireOwnBucket(bucketIdParam, { allowUserProfiles: true });

    // No app screen manages buckets: a company's bucket is created with the company.
    app.post('/api/v1/createBucket', requireInstanceAdmin, requireOwnBucket(bodyField('bucketId')), ctrl.createBucketOnStorage);
    app.patch('/api/v1/updateBucket/:bucketId', requireInstanceAdmin, ownBucket, ctrl.updateBucketOnStorage);
    app.get('/api/v1/getBucket/:bucketId', ownBucket, ctrl.getBucketOnStorage);
    app.delete('/api/v1/removeBucket/:bucketId', requireInstanceAdmin, ownBucket, ctrl.removeBucketOnStorage);
    app.get('/api/v1/getBucketSize/:bucketId', ownBucket, ctrl.getBucketSizeOnStorage);

    app.post('/api/v1/storage/uploadFile', upload.single("file"), validatePath, ctrl.uploadFileOnStorage);
    app.get('/api/v1/generateSignedUrl/:bucketId', ownOrProfileBucket, requireSafeObjectPath(queryField('filepath')), ctrl.getSignedUrlFile);
    app.get('/api/v1/download/:bucketId/*', ctrl.handleFileRequest);
    app.delete('/api/v1/storage/removeFile/:bucketId', requireBucketRemoval(bucketIdParam, queryField('filepath')), requireSafeObjectPath(queryField('filepath')), ctrl.removeFileFromStorage);

    app.post("/api/v1/getUserProfile", requireSafeObjectPath(bodyField('path')), handleProfileGetForUser);
    app.post("/api/v1/getTaskTypeImage", requireOwnBucket(bodyField('companyId')), requireSafeObjectPath(bodyField('path')), handleTaskTypeImageGet);
    app.post('/api/v1/storage/uploadFileBase64', requireBucketWrite(bodyField('companyId'), bodyField('path')), requireSafeObjectPath(bodyField('path')), ctrl.uploadBase64FileOnServerStorage);
}
