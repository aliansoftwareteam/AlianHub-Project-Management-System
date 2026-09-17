const mongoose = require('mongoose');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');

// Both knowledge switches read the same way. Off by default, and off never reads the
// company row. "tenant" turns a switch on only for a company whose own field has mode
// "on"; "all" turns it on for every company except one that set "off", so a tenant
// whose answers get worse can step back out while the rest stay on.
//
// KNOWLEDGE_RETRIEVAL decides whether Ask gathers through the retrieval interface.
// KNOWLEDGE_INDEXER decides whether page events are ingested into the chunk store and
// whether retrieval reads page passages from it.

const MODES = ['off', 'tenant', 'all'];
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ON_VALUES = ['on', 'true', '1', 'yes', 'enabled'];

/* The row is hand-editable, so "off" may arrive as a bare string, in capitals or as a
 * boolean. Only a recognisable "on" counts as on: any other value that is present
 * reads as off, so a mistyped opt-out never turns a switch on under "all". */
const normaliseCompanyMode = (stored) => {
    const raw = stored !== null && typeof stored === 'object' ? stored.mode : stored;
    if (raw === undefined || raw === null) return null;
    const value = String(raw).trim().toLowerCase();
    if (!value) return null;
    return ON_VALUES.includes(value) ? 'on' : 'off';
};

const createFlag = ({ companyField, readEnv }) => {
    const mode = () => {
        const raw = String(readEnv() || 'off').trim().toLowerCase();
        return MODES.includes(raw) ? raw : 'off';
    };

    const companyMode = async (companyId) => {
        try {
            const company = await MongoDbCrudOpration(dbCollections.GLOBAL, {
                type: dbCollections.COMPANIES,
                data: [{ _id: new mongoose.Types.ObjectId(String(companyId)) }, companyField],
            }, 'findOne');
            return normaliseCompanyMode(company && company[companyField]);
        } catch (error) {
            logger.error(`knowledge flag ${companyField}: company ${companyId}: ${error.message}`);
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

    return { companyField, mode, enabledFor };
};

const retrieval = createFlag({ companyField: 'knowledgeRetrieval', readEnv: () => process.env.KNOWLEDGE_RETRIEVAL });
const indexer = createFlag({ companyField: 'knowledgeIndexer', readEnv: () => process.env.KNOWLEDGE_INDEXER });

module.exports = {
    MODES,
    COMPANY_FIELD: retrieval.companyField,
    mode: retrieval.mode,
    enabledFor: retrieval.enabledFor,
    normaliseCompanyMode,
    createFlag,
    indexer,
};
