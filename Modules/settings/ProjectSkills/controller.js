const { myCache } = require("../../../Config/config");
const { settingsCollectionDocs } = require("../../../Config/collections");
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { removeCache } = require("../../../utils/commonFunctions");
const { validateName, MAX_SKILLS_PER_PROJECT } = require("./skillRules");

const cacheKeyFor = (companyId) => `projectSkills:${companyId}`;

const loadSkillsDoc = async (companyId) => {
    const skillsObj = {
        type: SCHEMA_TYPE.SETTINGS,
        data: [{ name: settingsCollectionDocs.PROJECT_SKILLS }]
    };
    const docs = await MongoDbCrudOpration(companyId, skillsObj, 'find');
    return (docs && docs[0]) || null;
};

exports.getProjectSkills = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        if (!companyId) return res.status(400).json({ message: "CompanyId is required" });

        const cacheKey = cacheKeyFor(companyId);
        let skills = myCache.get(cacheKey);
        let isFromCache = true;
        if (!skills) {
            isFromCache = false;
            const skillsObj = {
                type: SCHEMA_TYPE.SETTINGS,
                data: [{ name: settingsCollectionDocs.PROJECT_SKILLS }]
            };
            skills = await MongoDbCrudOpration(companyId, skillsObj, 'find');
            myCache.set(cacheKey, skills, 604800);
        }
        if (isFromCache) {
            res.set({ 'FromCache': 'true', 'cacheExpireTime': myCache.getTtl(cacheKey) });
        }
        return res.status(200).json(skills);
    } catch (error) {
        return res.status(500).json({ message: "An error occurred while getting the project skills", error: error.message });
    }
};

/**
 * Explicit `operation`, deliberately not the `{ queryFilter, queryObj }`
 * passthrough some sibling settings modules use — that hands the client an
 * arbitrary update against the settings collection.
 *
 *   add       { name }         -> appends { key, name, slug, active: true }
 *   rename    { key, name }    -> display name only; the slug stays frozen
 *   setActive { key, active }  -> hides from pickers, leaves tagged projects
 */
exports.updateProjectSkills = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        if (!companyId) return res.status(400).json({ message: "CompanyId is required" });

        const { operation } = req.body || {};
        if (!['add', 'rename', 'setActive'].includes(operation)) {
            return res.status(400).json({
                message: "Invalid operation. Supported operations: add, rename, setActive"
            });
        }

        const doc = await loadSkillsDoc(companyId);
        const existing = (doc && doc.settings) || [];

        let mongoObj;
        let responseSkill;

        if (operation === 'add') {
            const check = validateName(req.body.name, existing);
            if (!check.valid) return res.status(400).json({ message: check.reason });

            // Monotonic allocator, as in project_status — `existing.length` would
            // reuse keys after a removal.
            const nextKey = Number(doc && doc.totalStatus ? doc.totalStatus : existing.length) + 1;
            responseSkill = { key: nextKey, name: check.name, slug: check.slug, active: true };

            mongoObj = {
                type: SCHEMA_TYPE.SETTINGS,
                data: [
                    { name: settingsCollectionDocs.PROJECT_SKILLS },
                    { $push: { settings: responseSkill }, $set: { totalStatus: nextKey } },
                    { upsert: true, returnDocument: 'after' }
                ]
            };
        } else {
            const key = Number(req.body.key);
            if (!Number.isInteger(key)) return res.status(400).json({ message: "SKILL_KEY_REQUIRED" });

            const current = existing.find((s) => Number(s.key) === key);
            if (!current) return res.status(404).json({ message: "SKILL_NOT_FOUND" });

            if (operation === 'rename') {
                const check = validateName(req.body.name, existing, key);
                if (!check.valid) return res.status(400).json({ message: check.reason });
                responseSkill = { ...current, name: check.name };
                mongoObj = {
                    type: SCHEMA_TYPE.SETTINGS,
                    data: [
                        { name: settingsCollectionDocs.PROJECT_SKILLS },
                        { $set: { "settings.$[elem].name": check.name } },
                        { returnDocument: 'after', arrayFilters: [{ "elem.key": key }] }
                    ]
                };
            } else {
                const active = req.body.active === true;
                responseSkill = { ...current, active };
                mongoObj = {
                    type: SCHEMA_TYPE.SETTINGS,
                    data: [
                        { name: settingsCollectionDocs.PROJECT_SKILLS },
                        { $set: { "settings.$[elem].active": active } },
                        { returnDocument: 'after', arrayFilters: [{ "elem.key": key }] }
                    ]
                };
            }
        }

        const updated = await MongoDbCrudOpration(companyId, mongoObj, 'findOneAndUpdate');
        if (!updated) return res.status(400).json({ message: "Project skills not updated" });

        removeCache(cacheKeyFor(companyId), true);
        return res.status(200).json({ skill: responseSkill, maxPerProject: MAX_SKILLS_PER_PROJECT });
    } catch (error) {
        return res.status(500).json({ message: "An error occurred while updating the project skills", error: error.message });
    }
};

exports.loadSkillsDoc = loadSkillsDoc;
