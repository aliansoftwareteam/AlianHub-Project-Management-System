const mongoose = require('mongoose');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');

// KNOWLEDGE_RETRIEVAL is off by default, and off means Ask gathers exactly as it
// did before the retrieval interface existed, without reading the company row.
// "tenant" turns retrieval on only for a company whose knowledgeRetrieval.mode
// is "on"; "all" turns it on for every company except one that set "off", so a
// tenant whose answers get worse can step back out while the rest stay on.

const MODES = ['off', 'tenant', 'all'];
const COMPANY_FIELD = 'knowledgeRetrieval';
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const mode = () => {
    const raw = String(process.env.KNOWLEDGE_RETRIEVAL || 'off').trim().toLowerCase();
    return MODES.includes(raw) ? raw : 'off';
};

const companyMode = async (companyId) => {
    try {
        const company = await MongoDbCrudOpration(dbCollections.GLOBAL, {
            type: dbCollections.COMPANIES,
            data: [{ _id: new mongoose.Types.ObjectId(String(companyId)) }, COMPANY_FIELD],
        }, 'findOne');
        const stored = company && company[COMPANY_FIELD];
        return stored && typeof stored.mode === 'string' ? stored.mode : null;
    } catch (error) {
        logger.error(`knowledge flag: company ${companyId}: ${error.message}`);
        return undefined;
    }
};

const enabledFor = async (companyId) => {
    const installation = mode();
    if (installation === 'off' || !OBJECT_ID.test(String(companyId || ''))) return false;
    const own = await companyMode(companyId);
    if (own === undefined) return false;
    return installation === 'all' ? own !== 'off' : own === 'on';
};

module.exports = { MODES, COMPANY_FIELD, mode, enabledFor };
