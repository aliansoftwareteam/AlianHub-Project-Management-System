const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections, settingsCollectionDocs } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { activeMemberIds } = require('../../utils/companyMembers');
const llmProvider = require('../AICore/llmProvider');
const aiSwitch = require('../AICore/aiSwitch');
const { FEATURES } = require('../AICore/features');
const { parseModelJson } = require('../AICore/modelCall');
const { describeRule } = require('./helpers/sentenceRules');
const { draftSchema, checkDraft } = require('./helpers/aiDraftCheck');
const { catalogueOf } = require('./helpers/statusConditions');
const access = require('./helpers/ruleAccess');

const MAX_SENTENCE = 1000;
const MAX_TOKENS = 1200;
const REQUEST_TIMEOUT_MS = 45_000;
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const UNCONFIGURED = 'No AI model is set up for this instance, so a rule cannot be drafted.';
const UNREADABLE = 'The AI could not draft a rule from that sentence. Try rewording it.';
const FAILED = 'Could not draft a rule right now.';

const systemPrompt = (schema) => [
    'You turn one sentence into a draft automation rule for a project-management tool.',
    'Use ONLY the triggers, condition fields, operators and actions in the registry below, with their keys copied exactly. Never invent a key, field, operator, option or setting.',
    'Pick condition fields from the list for the chosen trigger\'s entity, and only actions whose appliesTo includes that trigger\'s actsOn.',
    'Operators in operatorsWithoutValue take no value; operators in operatorsTakingAList take a list.',
    'For people, statuses, projects and task types, write the name exactly as the sentence says it; never guess an id.',
    'Leave "project" null unless the sentence names one project.',
    'Any part of the sentence you cannot express with this registry goes in "unmapped" with the words from the sentence and a short reason, e.g. {"text":"when a customer emails","reason":"there is no email trigger yet"}. If the trigger itself cannot be expressed, set "trigger" to null.',
    'Reply with one JSON object and nothing else:',
    '{"trigger": "<trigger key>" | null, "project": "<project name>" | null, "conditions": [{"field": "<field>", "op": "<operator>", "value": <value>}], "actions": [{"action": "<action key>", "config": {"<setting>": <value>}}], "unmapped": [{"text": "<words>", "reason": "<why>"}]}',
    '',
    `Registry: ${JSON.stringify(schema)}`,
].join('\n');

const withTimeout = (promise) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('The AI draft timed out.')), REQUEST_TIMEOUT_MS).unref()),
]);

const askModel = ({ companyId, uid, sentence }) => withTimeout(llmProvider.getProvider().chat({
    systemPrompt: systemPrompt(draftSchema()),
    messages: [{ role: 'user', content: `Sentence: ${sentence}` }],
    jsonMode: true,
    temperature: 0,
    maxTokens: MAX_TOKENS,
    spend: { feature: FEATURES.AUTOMATION_DRAFT, companyId, userId: String(uid || '') },
}));

const statusNames = (project) => (Array.isArray(project.taskStatusData) ? project.taskStatusData : [])
    .map((row) => (row && row.convertStatus ? row.convertStatus : row))
    .map((row) => row && row.name)
    .filter(Boolean);

/* Only what the caller may use: projects they can open, the statuses of those
 * projects, and the people assigned to them who still hold a live seat. */
async function loadRefs(companyId, uid) {
    const visible = (await access.visibleProjectIds(companyId, uid)).map(String).filter((id) => OBJECT_ID.test(id));
    const rows = visible.length ? await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ _id: { $in: visible.map((id) => new mongoose.Types.ObjectId(id)) }, deletedStatusKey: { $ne: 1 } }, { ProjectName: 1, AssigneeUserId: 1, taskStatusData: 1 }],
    }, 'find') : [];
    const projects = (rows || []).map((p) => ({ id: String(p._id), name: p.ProjectName || '', statuses: statusNames(p), members: (p.AssigneeUserId || []).map(String) }));

    const candidates = [...new Set(projects.flatMap((p) => p.members).concat(String(uid)).filter((id) => OBJECT_ID.test(id)))];
    const seated = await activeMemberIds(companyId, candidates);
    const users = seated.length ? await MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: SCHEMA_TYPE.USERS,
        data: [{ _id: { $in: seated.map((id) => new mongoose.Types.ObjectId(id)) } }, { Employee_Name: 1, Employee_Email: 1 }],
    }, 'find') : [];
    const people = (users || []).map((u) => ({ id: String(u._id), name: u.Employee_Name || '', email: u.Employee_Email || '' }));

    const settings = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SETTINGS, data: [{ name: settingsCollectionDocs.TASK_TYPE }],
    }, 'find').catch(() => []);
    const taskTypes = (settings || []).flatMap((doc) => (Array.isArray(doc.taskTypes) ? doc.taskTypes : []))
        .filter((t) => t && !t.isDeleted && t.name).map((t) => t.name);

    return { projects, people, taskTypes, statusCatalogue: catalogueOf(rows || []) };
}

/* POST /api/v2/automations/draft  body: { sentence }
 * Answers a draft for the builder and saves nothing: the person reviews it,
 * backtests it and saves it through the normal create path. */
async function draftHandler(req, res) {
    const companyId = String(req.headers.companyid || '');
    if (!companyId) return res.status(400).send({ status: false, statusText: 'companyId is required.' });
    try {
        if (!(await access.canManageRules(companyId, req.uid))) return res.status(403).send({ status: false, statusText: access.MANAGE_REFUSED });
        const sentence = String((req.body && req.body.sentence) || '').replace(/\s+/g, ' ').trim();
        if (!sentence) return res.status(400).send({ status: false, statusText: 'A sentence is required.' });
        if (sentence.length > MAX_SENTENCE) return res.status(400).send({ status: false, statusText: `A sentence may be at most ${MAX_SENTENCE} characters.` });

        await aiSwitch.assertAllowed(companyId);
        if (!llmProvider.isAnyProviderConfigured()) return res.send({ status: false, aiState: aiSwitch.STATE.UNCONFIGURED, statusText: UNCONFIGURED });

        const answer = await askModel({ companyId, uid: req.uid, sentence });
        const parsed = parseModelJson(answer && answer.content);
        if (!parsed.ok) return res.send({ status: false, statusText: UNREADABLE });

        const refs = await loadRefs(companyId, req.uid);
        const out = checkDraft(parsed.value, refs);
        return res.send({
            status: true,
            data: {
                drafted: true,
                rule: out.rule,
                sentence: out.rule ? describeRule(out.rule, { people: refs.people }) : sentence,
                unmapped: out.unmapped,
                rejected: out.rejected,
            },
        });
    } catch (error) {
        if (aiSwitch.isAiOff(error)) {
            const aiState = error.scope === 'instance' ? aiSwitch.STATE.OFF_INSTANCE : aiSwitch.STATE.OFF_WORKSPACE;
            return res.status(403).send({ status: false, code: aiSwitch.AI_OFF, aiState, statusText: error.message });
        }
        logger.error(`automation ai draft: ${error && error.message ? error.message : error}`);
        return res.send({ status: false, code: (error && error.code) || undefined, statusText: error && error.code ? error.message : FAILED });
    }
}

module.exports = { draftHandler, draftSchema, loadRefs };
