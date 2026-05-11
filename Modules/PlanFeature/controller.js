const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { myCache } = require('../../Config/config');

exports.planFeature = async (req, res) => {
    try {
        const planFeatureCacheKey = 'planfeature'; 
        let planFeature = myCache.get(planFeatureCacheKey);
        let isFromCache = true;
        if (!planFeature) {
            isFromCache = false;
            const planFeatureObj = {
                type: SCHEMA_TYPE.PLANFEATURE,
                data: []
            };

            planFeature = await MongoDbCrudOpration('global', planFeatureObj, 'find');

            if (!planFeature || planFeature.length === 0) {
                return res.status(404).json({ message: 'No plan feature found' });
            }

            if (isFromCache) {
                res.set({
                    'FromCache': 'true',
                    'cacheExpireTime': myCache.getTtl(planFeatureCacheKey)
                });
            }
            myCache.set(planFeatureCacheKey, planFeature, 604800);
        }

        res.status(200).json(planFeature);
    } catch (error) {
        res.status(404).json({ message: 'An error occurred while fetching the planFeature', error: error.message });
    }
};

exports.planFeatureDisplay = async (req, res) => {
    try {
        const planFeatureDisplayCacheKey = 'planfeaturedisplay'; 
        let planFeatureDisplay = myCache.get(planFeatureDisplayCacheKey);
        let isFromCache = true;
        if (!planFeatureDisplay) {
            isFromCache = false;
            const planFeatureDisplayObj = {
                type: SCHEMA_TYPE.PLANFEATUREDISPLAY,
                data: []
            };

            planFeatureDisplay = await MongoDbCrudOpration('global', planFeatureDisplayObj, 'find');

            if (!planFeatureDisplay || planFeatureDisplay.length === 0) {
                return res.status(404).json({ message: 'No plan feature display found' });
            }

            myCache.set(planFeatureDisplayCacheKey, planFeatureDisplay, 604800);
        }
        if (isFromCache) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(planFeatureDisplayCacheKey)
            });
        }
        res.status(200).json(planFeatureDisplay);
    } catch (error) {
        res.status(404).json({ message: 'An error occurred while fetching the planFeatureDisplay', error: error.message });
    }
};