const { myCache } = require("../../Config/config");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");

// AHE — ensure the "Dashboard" project view exists in a company's catalog even
// if the company predates it (the catalog is seeded once at company creation and
// then cached for 7 days). Idempotent: inserts the record only when missing.
async function ensureDashboardTab(companyId, tabs) {
    try {
        const list = Array.isArray(tabs) ? tabs : [];
        if (list.some((t) => t && t.keyName === 'ProjectDashboard')) return list;
        const record = { name: 'Dashboard', sortIndex: 8, keyName: 'ProjectDashboard', value: 'dashboard', setAsDefault: false, viewStatus: false, default: true };
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECT_TAB_COMPONENTS, data: record }, 'save');
        list.push(saved && saved._id ? saved : record);
        return list;
    } catch (e) {
        return tabs;
    }
}

exports.getProjectTabs = async (req,res) => {
    try {
        const companyId = req.headers['companyid'];
        const tabObj = {
            type: SCHEMA_TYPE.PROJECT_TAB_COMPONENTS,
            data: []
        };

        const tabCache = `ProjectTabs:${companyId}`;
        let projectTabs = myCache.get(tabCache);
        let isFromCache = true;
        if(!projectTabs){
            isFromCache  = false;
            projectTabs =  await MongoDbCrudOpration(companyId, tabObj, 'find');
            // Self-heal companies that predate the Dashboard view (idempotent).
            projectTabs = await ensureDashboardTab(companyId, projectTabs);
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