const { settingsCollectionDocs } = require("../../../Config/collections");
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { filterSkillSlugs } = require("./skillRules");
const logger = require("../../../Config/loggerConfig");

const loadSettings = async (companyId) => {
    const docs = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SETTINGS,
        data: [{ name: settingsCollectionDocs.PROJECT_SKILLS }]
    }, 'find');
    return (docs && docs[0] && docs[0].settings) || [];
};

/**
 * Every path that writes `projects.skills` goes through here, so neither a
 * client nor a hallucinating model can invent vocabulary. Returns [] on lookup
 * failure — dropping tags is recoverable, failing the save is not.
 */
exports.resolveProjectSkills = async (companyId, requested) => {
    if (!Array.isArray(requested) || !requested.length) return [];
    try {
        const kept = filterSkillSlugs(requested, await loadSettings(companyId));
        if (kept.length !== requested.length) {
            logger.info(`resolveProjectSkills dropped ${requested.length - kept.length} unknown/inactive skill(s) for company ${companyId}`);
        }
        return kept;
    } catch (error) {
        logger.error(`resolveProjectSkills error: ${error && error.message ? error.message : error}`);
        return [];
    }
};

/** Slugs the AI plan prompt is allowed to offer. */
exports.getActiveSkillSlugs = async (companyId) => {
    try {
        return (await loadSettings(companyId)).filter((s) => s.active !== false).map((s) => s.slug).filter(Boolean);
    } catch (error) {
        logger.error(`getActiveSkillSlugs error: ${error && error.message ? error.message : error}`);
        return [];
    }
};
