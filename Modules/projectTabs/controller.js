const { myCache } = require("../../Config/config");
const logger = require("../../Config/loggerConfig");
const { missingViews, findViews, ensureViewCatalogue } = require("./catalogue");

/* Companies seeded before the catalogue import stopped wiping and refilling can hold only a
 * few views, so every read completes the catalogue; a failed heal still answers what is stored. */
async function completeCatalogue(companyId, projectTabs) {
    try {
        await ensureViewCatalogue(companyId);
        return await findViews(companyId);
    } catch (error) {
        logger.error(`project view catalogue heal failed for ${companyId}: ${error.message}`);
        return projectTabs;
    }
}

exports.getProjectTabs = async (req,res) => {
    try {
        const companyId = req.headers['companyid'];
        const tabCache = `ProjectTabs:${companyId}`;
        let projectTabs = myCache.get(tabCache);
        const isFromCache = Boolean(projectTabs) && !missingViews(projectTabs).length;
        if (!isFromCache) {
            projectTabs = await findViews(companyId);
            if (missingViews(projectTabs).length) projectTabs = await completeCatalogue(companyId, projectTabs);
            myCache.set(tabCache, projectTabs, 604800);
        }
        if (isFromCache) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(tabCache)
            });
        }
        res.status(200).json(projectTabs);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while fetching the project tab", error: error.message });
    }
}
