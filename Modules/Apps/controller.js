const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { myCache } = require('../../Config/config');

exports.getApps = async (req, res) => {
    const companyId = req.headers['companyid'];
    const fetchAllApps = (req.body && req.body.fetchAllApps) || false;

    try {
        const appCacheKey = `apps:${companyId}`;
        let apps = myCache.get(appCacheKey);
        let isFromcache = true;
        if (!apps) {
            isFromcache = false;
            apps = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.APPS,
                data: fetchAllApps ? [{}] : []
            }, 'find');
            myCache.set(appCacheKey, apps, 604800);
        }

        const data = (apps || []).filter(app => app.key !== 'IncompleteWarning');

        if (isFromcache) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(appCacheKey)
            });
        }
        return res.status(200).json({ status: true, statusText: 'Apps fetched.', data });
    } catch (error) {
        return res.status(500).json({ status: false, statusText: 'An error occurred while fetching the apps', message: error.message });
    }
};
