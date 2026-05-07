const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { myCache } = require('../../Config/config');

exports.getApps = async (req, res) => {
    const companyId = req.headers['companyid'];
    const fetchAllApps = req.body.fetchAllApps || false;

    try {
        const appCacheKey = `apps:${companyId}`;
        let apps = myCache.get(appCacheKey);
        let isFromcache = true;
        if (!apps) {
            isFromcache = false;
            const appsObj = {
                type: SCHEMA_TYPE.APPS,
                data: fetchAllApps ? [{}] : []
            };

            apps = await MongoDbCrudOpration(companyId, appsObj, 'find');

            myCache.set(appCacheKey, apps, 604800);
        }
        
        const data = apps.filter(app => app.key !== 'IncompleteWarning')
        
        if (isFromcache) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(appCacheKey)
            });
        }
        res.status(200).json(data);
    } catch (error) {
        res.status(404).json({ message: "An error occurred while fetching the apps", error: error.message });
    }
};