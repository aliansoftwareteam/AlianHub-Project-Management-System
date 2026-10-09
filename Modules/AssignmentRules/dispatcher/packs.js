const mongoose = require('mongoose');
const playbooks = require('../../Agents/rolePlaybooks');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');
const logger = require('../../../Config/loggerConfig');
const { RuleError } = require('../rules');
const settings = require('./settings');
const packAgents = require('./packAgents');
const { withPackLock } = require('./packLock');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const MAX_PROJECTS = 50;
const SUMMARY_MAX = 280;
const PACK_AGENT = Object.freeze({ _id: 'team-pack', name: 'Team pack' });
const TAG_ACTION = 'tag.create';
const KEPT_APPLIES = 20;
const MANAGE_REFUSAL = 'Only an Owner or an Admin can create or remove agents. Leave the team\'s agents out to turn on its roles.';

const packs = () => {
    const byBlueprint = new Map();
    playbooks.all().forEach((role) => {
        if (!byBlueprint.has(role.blueprint)) byBlueprint.set(role.blueprint, new Map());
        const teams = byBlueprint.get(role.blueprint);
        if (!teams.has(role.team)) teams.set(role.team, []);
        teams.get(role.team).push({
            key: settings.roleKey(role), slug: role.slug, name: role.name, department: role.department, summary: playbooks.summary(role, SUMMARY_MAX), tools: [...role.tools, ...role.toolsOptional],
            starterRules: role.starterRules.map((rule) => ({ ...rule })), tags: [...role.tags],
        });
    });
    return [...byBlueprint].map(([blueprint, teams]) => ({ blueprint, teams: [...teams].map(([team, roles]) => ({ team, roles })) }));
};

const projectIdsOf = (body) => {
    const given = Array.isArray(body && body.projectIds) ? body.projectIds : [];
    const ids = [...new Set(given.map((id) => String(id).trim().toLowerCase()))];
    if (!ids.length || given.length > MAX_PROJECTS || !ids.every((id) => OBJECT_ID.test(id))) throw new RuleError(`projectIds must list from 1 to ${MAX_PROJECTS} projects.`);
    return ids;
};

/* Runs before the per-project permission check, so the check sees the same short, clean list the handler uses. */
const normaliseProjectIds = (req, res, next) => {
    try {
        const body = req.body || {};
        body.projectIds = projectIdsOf(body);
        ['roles', 'rules', 'proposals'].forEach((key) => {
            if (body[key] && typeof body[key] === 'object' && !Array.isArray(body[key])) {
                body[key] = Object.fromEntries(Object.entries(body[key]).map(([id, value]) => [String(id).trim().toLowerCase(), value]));
            }
        });
        req.body = body;
        return next();
    } catch (error) {
        return res.status(error.statusCode || 400).json({ status: false, statusText: error.message, message: error.message });
    }
};

/* A company blueprint turns on only its first few roles, so a request may narrow the chosen teams to some of their roles. */
const onlyOf = (body, inTeams) => {
    if (body.only === undefined || body.undo === true) return inTeams;
    if (!Array.isArray(body.only) || !body.only.length) throw new RuleError('only must list at least one role.');
    const unknown = body.only.map(String).filter((key) => !inTeams.includes(key));
    if (unknown.length) throw new RuleError(`The role "${unknown[0]}" is not in the chosen teams.`);
    return inTeams.filter((key) => body.only.map(String).includes(key));
};

const rolesOfPack = (body) => {
    const pack = packs().find((one) => one.blueprint === String((body && body.blueprint) || ''));
    if (!pack) throw new RuleError('There is no such company blueprint.');
    const asked = Array.isArray(body.teams) ? [...new Set(body.teams.map(String))] : [];
    if (!asked.length) throw new RuleError('Pick at least one team.');
    const unknown = asked.filter((team) => !pack.teams.some((one) => one.team === team));
    if (unknown.length) throw new RuleError(`There is no team "${unknown[0]}" in this blueprint.`);
    const inTeams = pack.teams.filter((one) => asked.includes(one.team)).flatMap((one) => one.roles.map((role) => role.key));
    return { blueprint: pack.blueprint, teams: asked, roles: onlyOf(body, inTeams) };
};

const bodyWith = (current, roles, rules = current.rules) => ({ mode: current.mode, threshold: current.threshold, modelGuess: current.modelGuess, rules, roles });

const lower = (value) => String(value).trim().toLowerCase();
const sameRule = (one, other) => one.role === other.role && JSON.stringify(one.when) === JSON.stringify(other.when);
const cleanRule = (rule) => settings.view({ rules: [rule] }).rules[0];

const readProject = async (companyId, projectId) => (await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECTS,
    data: [{ _id: new mongoose.Types.ObjectId(projectId) }, { ProjectName: 1, taskTypeCounts: 1, tagsArray: 1 }],
}, 'findOne')) || {};

const tagsOf = (project) => (Array.isArray(project.tagsArray) ? project.tagsArray : []).filter((tag) => tag && tag.uid !== undefined && tag.uid !== null && tag.tagName);

/* A starter rule names a type or a tag by its name; the rule stores the project's own key or tag id, so one the project lacks is left out. */
const conditionFor = (kind, value, project) => {
    if (kind === 'priority') return { priorities: [value] };
    if (kind === 'type') {
        const type = (Array.isArray(project.taskTypeCounts) ? project.taskTypeCounts : []).find((one) => one && [one.name, one.value].some((label) => label && lower(label) === lower(value)) && Number.isFinite(Number(one.key)));
        return type ? { taskTypeKeys: [Number(type.key)] } : null;
    }
    const tag = tagsOf(project).find((one) => lower(one.tagName) === lower(value));
    return tag ? { tags: [String(tag.uid)] } : null;
};

const starterRulesFor = (roleKeys, project, held) => {
    const made = [];
    let skipped = 0;
    roleKeys.forEach((key) => {
        ((settings.roleOf(key) || {}).starterRules || []).forEach(({ kind, value }) => {
            const when = conditionFor(kind, value, project);
            if (!when) { skipped += 1; return; }
            const rule = { id: new mongoose.Types.ObjectId().toString(), ...cleanRule({ role: key, when }) };
            if (![...held, ...made].some((one) => sameRule(one, rule))) made.push(rule);
        });
    });
    return { made, skipped };
};

const tagNamesFor = (roleKeys, project) => {
    const held = new Set(tagsOf(project).map((tag) => lower(tag.tagName)));
    const seen = new Set();
    return roleKeys.flatMap((key) => (settings.roleOf(key) || {}).tags || []).filter((name) => {
        if (held.has(lower(name)) || seen.has(lower(name))) return false;
        seen.add(lower(name));
        return true;
    });
};

const pendingTagNames = async (companyId, projectId) => {
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_PROPOSALS, data: [{ projectId: { $in: idForms([projectId]) }, agentId: PACK_AGENT._id, status: 'pending' }, { changes: 1 }],
    }, 'find');
    return new Set((rows || []).flatMap((row) => row.changes || []).filter((change) => change.action === TAG_ACTION).map((change) => lower((change.params || {}).name)));
};

/* One approval per project holds all its tags, so a person decides them together; nothing is added to the project before then. */
async function tagProposalFor(companyId, projectId, names, blueprint) {
    if (!names.length || !require('../../Agents/registry').get(TAG_ACTION)) return null;
    const waiting = await pendingTagNames(companyId, projectId);
    const fresh = names.filter((name) => !waiting.has(lower(name)));
    if (!fresh.length) return null;
    const proposals = require('../../Agents/proposals');
    const changes = fresh.map((name) => ({ action: TAG_ACTION, params: { projectId, name }, label: `Add the tag "${name}"` }));
    const check = proposals.validateChanges(changes);
    if (!check.valid) throw new RuleError(`Project ${projectId}: the tags cannot be proposed. ${check.reason}`, 400);
    return {
        names: fresh,
        input: {
            agent: PACK_AGENT,
            projectId,
            what: `Add ${fresh.length} tag${fresh.length === 1 ? '' : 's'} for the ${blueprint} team pack`,
            why: 'The roles of this team pack hand work on with these tags, and the project does not have them yet.',
            changes,
            source: proposals.SOURCE_SYSTEM,
            allowedActions: [TAG_ACTION],
        },
    };
}

async function withdrawProposal(companyId, projectId, proposalId) {
    if (!OBJECT_ID.test(String(proposalId || ''))) return false;
    const proposals = require('../../Agents/proposals');
    const own = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_PROPOSALS, data: [{ _id: new mongoose.Types.ObjectId(proposalId), projectId: { $in: idForms([projectId]) }, agentId: PACK_AGENT._id, status: proposals.STATUS.PENDING }, { _id: 1 }],
    }, 'findOne');
    if (!own) return false;
    return Boolean(await proposals.withdraw(companyId, proposalId, 'The team pack was undone.'));
}

const validateAll = (plans) => plans.filter((plan) => plan.body).forEach((plan) => {
    try {
        settings.validate(plan.body);
    } catch (error) {
        throw new RuleError(`Project ${plan.projectId}: ${error.message}`, error.statusCode || 400);
    }
});

/* Every project's new settings are checked before any is written, so a pack lands in all of its projects or in none. */
async function writeAll(companyId, plans, actorId) {
    validateAll(plans);
    for (const plan of plans.filter((one) => one.body)) await settings.save(companyId, plan.projectId, plan.body, actorId);
}

/* Each write records how to take it back; a failed apply takes back what it wrote, last first. */
const journal = () => {
    const steps = [];
    return {
        done: (what, takeBack) => { steps.push({ what, takeBack }); },
        async rollBack() {
            const left = [];
            for (const step of steps.reverse()) {
                try {
                    await step.takeBack();
                } catch (error) {
                    logger.error(`[team-pack] could not take back ${step.what}: ${error.message}`);
                    left.push(step.what);
                }
            }
            return left;
        },
    };
};

const failedApply = (error, left) => {
    const why = error instanceof RuleError ? ` ${error.message}` : '';
    if (left.length) return new RuleError(`The team pack could not be applied, and ${left.join(', ')} could not be taken back. Check them before trying again.${why}`, 500);
    return new RuleError(`The team pack could not be applied, so nothing was changed.${why || ' Please try again.'}`, error instanceof RuleError ? error.statusCode : 500);
};

const rowFilter = (projectId) => ({ projectId: String(projectId) });

/* What an apply added is kept on each of its projects' rule rows, so an undo takes back that and never a list a client
 * sends. Only the last few applies per project are kept. */
async function recordApply(companyId, { blueprint, projectIds, plans, agents, actorId }, written) {
    const changed = plans.some((plan) => plan.body || plan.proposalId) || agents.made.length || agents.widened.length;
    if (!changed) return null;
    const applyId = new mongoose.Types.ObjectId().toString();
    const shared = {
        applyId,
        blueprint,
        projectIds,
        agents: { made: agents.made.map((agent) => agent.agentId), widened: agents.widened.map(({ agentId, projectIds: added }) => ({ agentId, projectIds: added })) },
        skills: agents.skills || [],
        by: String(actorId),
        at: new Date(),
    };
    for (const plan of plans) {
        const entry = { ...shared, roles: plan.body ? plan.added : [], rules: plan.body ? plan.rules : [], proposalId: plan.proposalId || null };
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.ASSIGNMENT_RULES,
            data: [rowFilter(plan.projectId), { $push: { teamPacks: { $each: [entry], $slice: -KEPT_APPLIES } }, $setOnInsert: { entries: [] } }, { upsert: true }],
        }, 'updateOne');
        written.done(`the record of the pack in project ${plan.projectId}`, () => MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.ASSIGNMENT_RULES, data: [rowFilter(plan.projectId), { $pull: { teamPacks: { applyId } } }],
        }, 'updateOne'));
    }
    return applyId;
}

/* Turns the pack's roles on and nothing else: the mode stays as the project has it, so a project whose dispatcher is
 * off routes nothing until a person switches it on. A project that already has every role is left unwritten.
 * With starterRules the roles' own routing rules join the project's, each once; with proposeTags the tags the roles
 * hand work on with are proposed, for a person to approve. Settings, rules, tag approvals and agents are all planned
 * and checked before the first write, and a write that fails takes back the ones before it. */
async function apply(companyId, body, actorId, { managesAgents = false } = {}) {
    const projectIds = projectIdsOf(body);
    const pack = rolesOfPack(body);
    const createAgents = body.createAgents === undefined ? managesAgents : body.createAgents !== false;
    if (createAgents && !managesAgents) throw new RuleError(MANAGE_REFUSAL, 403);
    const plans = [];
    for (const projectId of projectIds) {
        const current = await settings.load(companyId, projectId);
        const project = body.starterRules === true || body.proposeTags === true ? await readProject(companyId, projectId) : {};
        const kept = current.roles.filter((key) => settings.roleOf(key));
        const added = pack.roles.filter((key) => !kept.includes(key));
        const starter = body.starterRules === true ? starterRulesFor(pack.roles, project, current.rules) : { made: [], skipped: 0 };
        const changed = added.length || starter.made.length;
        const tags = body.proposeTags === true ? tagNamesFor(pack.roles, project) : [];
        plans.push({
            projectId,
            added,
            mode: current.mode,
            rules: starter.made,
            skippedRules: starter.skipped,
            proposal: await tagProposalFor(companyId, projectId, tags, pack.blueprint),
            previous: bodyWith(current, kept, current.rules),
            body: changed ? bodyWith(current, [...kept, ...added], [...current.rules, ...starter.made]) : null,
        });
    }
    validateAll(plans);
    const agentPlan = createAgents ? await packAgents.plan(companyId, pack.roles, projectIds) : null;

    const proposals = require('../../Agents/proposals');
    const written = journal();
    let agents = { made: [], kept: [], widened: [], skills: [] };
    let applyId = null;
    try {
        for (const plan of plans.filter((one) => one.body)) {
            await settings.save(companyId, plan.projectId, plan.body, actorId);
            written.done(`the dispatcher settings of project ${plan.projectId}`, () => settings.save(companyId, plan.projectId, plan.previous, actorId));
        }
        for (const plan of plans.filter((one) => one.proposal)) {
            plan.proposalId = String((await proposals.create(companyId, plan.proposal.input))._id);
            written.done(`the tag approval of project ${plan.projectId}`, () => proposals.withdraw(companyId, plan.proposalId, 'The team pack could not be applied.'));
        }
        if (agentPlan) agents = await packAgents.write(companyId, agentPlan, actorId, written);
        applyId = await recordApply(companyId, { blueprint: pack.blueprint, projectIds, plans, agents, actorId }, written);
    } catch (error) {
        logger.error(`[team-pack] apply of ${pack.blueprint} failed: ${(error && error.message) || error}`);
        throw failedApply(error, await written.rollBack());
    }
    const projects = plans.map((plan) => ({
        projectId: plan.projectId,
        added: plan.added,
        mode: plan.mode,
        rules: plan.rules,
        skippedRules: plan.skippedRules,
        tags: plan.proposal ? plan.proposal.names : [],
        proposalId: plan.proposalId || null,
    }));
    const { skills, ...shown } = agents;
    return { blueprint: pack.blueprint, teams: pack.teams, applyId, projects, agents: shown };
}

const appliesOf = async (companyId, applyId) => ((await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.ASSIGNMENT_RULES, data: [{ teamPacks: { $elemMatch: { applyId } } }, { projectId: 1, teamPacks: 1 }],
}, 'find')) || []).map((row) => (row && typeof row.toObject === 'function' ? row.toObject() : row))
    .map((row) => ({ projectId: String(row.projectId), entry: (row.teamPacks || []).find((one) => one && one.applyId === applyId) }))
    .filter((row) => row.entry);

/* Takes back what the apply named by applyId recorded: the roles it turned on, the rules it added, its tag approval
 * while nobody has decided it, and the agents it made or widened. A rule a person has since changed stays. */
async function undo(companyId, body, actor, { managesAgents = false } = {}) {
    const actorId = actor.id;
    const projectIds = projectIdsOf(body);
    const pack = rolesOfPack(body);
    const applyId = String(body.applyId || '').trim().toLowerCase();
    if (!OBJECT_ID.test(applyId)) throw new RuleError('applyId must name the pack to undo.');
    const applied = await appliesOf(companyId, applyId);
    if (!applied.length) throw new RuleError('There is nothing left of this pack to undo.', 404);
    const record = applied[0].entry;
    if (record.blueprint !== pack.blueprint) throw new RuleError('This pack was applied from another blueprint.');
    const reached = [...new Set([...applied.map((row) => row.projectId), ...(record.projectIds || []).map(String)])];
    if (reached.some((id) => !projectIds.includes(id))) throw new RuleError('projectIds must name every project the pack was applied to.');
    const agentIds = (record.agents && record.agents.made) || [];
    const widened = (record.agents && record.agents.widened) || [];
    if ((agentIds.length || widened.length) && !managesAgents) throw new RuleError(MANAGE_REFUSAL, 403);
    const plans = [];
    for (const { projectId, entry } of applied) {
        const current = await settings.load(companyId, projectId);
        const removed = current.roles.filter((key) => (entry.roles || []).includes(key));
        const recorded = (entry.rules || []).filter((rule) => rule && rule.id);
        const droppedRules = current.rules.filter((rule) => recorded.some((one) => one.id === rule.id && sameRule(one, rule)));
        const left = current.rules.filter((rule) => !droppedRules.includes(rule));
        const changed = removed.length || droppedRules.length;
        plans.push({
            projectId, removed, rules: droppedRules, mode: current.mode, proposalId: entry.proposalId,
            body: changed ? bodyWith(current, current.roles.filter((key) => !removed.includes(key) && settings.roleOf(key)), left) : null,
        });
    }
    await writeAll(companyId, plans, actorId);
    const projects = [];
    for (const plan of plans) {
        const withdrawn = await withdrawProposal(companyId, plan.projectId, plan.proposalId).catch(() => false);
        projects.push({ projectId: plan.projectId, removed: plan.removed, rules: plan.rules, mode: plan.mode, tagsWithdrawn: withdrawn });
    }
    const agents = await packAgents.remove(companyId, pack.blueprint, agentIds, reached, actor);
    agents.narrowed = await packAgents.narrow(companyId, widened);
    agents.skillsRemoved = await packAgents.dropUnusedSkills(companyId, applied.flatMap((row) => row.entry.skills || []));
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.ASSIGNMENT_RULES, data: [{ projectId: { $in: applied.map((row) => row.projectId) } }, { $pull: { teamPacks: { applyId } } }],
    }, 'updateMany');
    return { blueprint: pack.blueprint, teams: pack.teams, projects, agents };
}

module.exports = {
    MAX_PROJECTS, packs, normaliseProjectIds,
    apply: (companyId, ...rest) => withPackLock(companyId, () => apply(companyId, ...rest)),
    undo: (companyId, ...rest) => withPackLock(companyId, () => undo(companyId, ...rest)),
};
