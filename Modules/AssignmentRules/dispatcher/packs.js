const mongoose = require('mongoose');
const playbooks = require('../../Agents/rolePlaybooks');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');
const logger = require('../../../Config/loggerConfig');
const { RuleError } = require('../rules');
const settings = require('./settings');
const packAgents = require('./packAgents');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const MAX_PROJECTS = 50;
const SUMMARY_MAX = 280;
const PACK_AGENT = Object.freeze({ _id: 'team-pack', name: 'Team pack' });
const TAG_ACTION = 'tag.create';
const MAX_AGENTS = 200;

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
            const rule = cleanRule({ role: key, when });
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
async function proposeTags(companyId, projectId, names, blueprint) {
    if (!names.length || !require('../../Agents/registry').get(TAG_ACTION)) return { names: [], proposalId: null };
    try {
        const waiting = await pendingTagNames(companyId, projectId);
        const fresh = names.filter((name) => !waiting.has(lower(name)));
        if (!fresh.length) return { names: [], proposalId: null };
        const proposal = await require('../../Agents/proposals').create(companyId, {
            agent: PACK_AGENT,
            projectId,
            what: `Add ${fresh.length} tag${fresh.length === 1 ? '' : 's'} for the ${blueprint} team pack`,
            why: 'The roles of this team pack hand work on with these tags, and the project does not have them yet.',
            changes: fresh.map((name) => ({ action: TAG_ACTION, params: { projectId, name }, label: `Add the tag "${name}"` })),
            source: require('../../Agents/proposals').SOURCE_SYSTEM,
            allowedActions: [TAG_ACTION],
        });
        return { names: fresh, proposalId: String(proposal._id) };
    } catch (error) {
        logger.error(`[team-pack] could not propose tags for project ${projectId}: ${error.message}`);
        return { names: [], proposalId: null, failed: true };
    }
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

/* Every project's new settings are checked before any is written, so a pack lands in all of its projects or in none. */
async function writeAll(companyId, plans, actorId) {
    plans.filter((plan) => plan.body).forEach((plan) => {
        try {
            settings.validate(plan.body);
        } catch (error) {
            throw new RuleError(`Project ${plan.projectId}: ${error.message}`, error.statusCode || 400);
        }
    });
    for (const plan of plans.filter((one) => one.body)) await settings.save(companyId, plan.projectId, plan.body, actorId);
}

/* Turns the pack's roles on and nothing else: the mode stays as the project has it, so a project whose dispatcher is
 * off routes nothing until a person switches it on. A project that already has every role is left unwritten.
 * With starterRules the roles' own routing rules join the project's, each once; with proposeTags the tags the roles
 * hand work on with are proposed, for a person to approve, once the settings are saved. */
async function apply(companyId, body, actorId) {
    const projectIds = projectIdsOf(body);
    const pack = rolesOfPack(body);
    const plans = [];
    for (const projectId of projectIds) {
        const current = await settings.load(companyId, projectId);
        const project = body.starterRules === true || body.proposeTags === true ? await readProject(companyId, projectId) : {};
        const kept = current.roles.filter((key) => settings.roleOf(key));
        const added = pack.roles.filter((key) => !kept.includes(key));
        const starter = body.starterRules === true ? starterRulesFor(pack.roles, project, current.rules) : { made: [], skipped: 0 };
        const changed = added.length || starter.made.length;
        plans.push({
            projectId,
            added,
            mode: current.mode,
            rules: starter.made,
            skippedRules: starter.skipped,
            tags: body.proposeTags === true ? tagNamesFor(pack.roles, project) : [],
            body: changed ? bodyWith(current, [...kept, ...added], [...current.rules, ...starter.made]) : null,
        });
    }
    await writeAll(companyId, plans, actorId);
    const projects = [];
    for (const plan of plans) {
        const proposed = await proposeTags(companyId, plan.projectId, plan.tags, pack.blueprint);
        projects.push({
            projectId: plan.projectId,
            added: plan.added,
            mode: plan.mode,
            rules: plan.rules,
            skippedRules: plan.skippedRules,
            tags: proposed.names,
            proposalId: proposed.proposalId,
            ...(proposed.failed ? { tagsFailed: true } : {}),
        });
    }
    const agents = body.createAgents === false ? { made: [], kept: [] } : await packAgents.create(companyId, pack.roles, projectIds, actorId);
    return { blueprint: pack.blueprint, teams: pack.teams, projects, agents };
}

const mapOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

const agentIdsOf = (body) => {
    const given = Array.isArray(body.agents) ? body.agents.map((id) => String(id).trim().toLowerCase()) : [];
    if (given.length > MAX_AGENTS || !given.every((id) => OBJECT_ID.test(id))) throw new RuleError(`agents must list at most ${MAX_AGENTS} agent ids.`);
    return [...new Set(given)];
};

/* Takes back what a pack added, as its answer listed it: its roles, the rules it wrote, the tag approval it filed
 * while nobody has decided it, and the agents it made that have done no work. Never a role or a rule outside that
 * pack; a rule a person has since changed stays, and so does an agent that has worked. */
async function undo(companyId, body, actor) {
    const actorId = actor.id;
    const projectIds = projectIdsOf(body);
    const pack = rolesOfPack(body);
    const given = mapOf(body.roles);
    const givenRules = mapOf(body.rules);
    const givenProposals = mapOf(body.proposals);
    if ([given, givenRules, givenProposals].some((one) => Object.keys(one).some((id) => !projectIds.includes(id)))) throw new RuleError('roles, rules and proposals may name only the projects in projectIds.');
    const plans = [];
    for (const projectId of projectIds) {
        const asked = (Array.isArray(given[projectId]) ? given[projectId].map(String) : []).filter((key) => pack.roles.includes(key));
        const askedRules = (Array.isArray(givenRules[projectId]) ? givenRules[projectId] : [])
            .filter((rule) => rule && typeof rule === 'object' && pack.roles.includes(String(rule.role))).map(cleanRule);
        const current = await settings.load(companyId, projectId);
        const removed = current.roles.filter((key) => asked.includes(key));
        const left = [...current.rules];
        const droppedRules = askedRules.filter((rule) => {
            const at = left.findIndex((one) => sameRule(one, rule));
            if (at < 0) return false;
            left.splice(at, 1);
            return true;
        });
        const body = removed.length || droppedRules.length ? bodyWith(current, current.roles.filter((key) => !removed.includes(key) && settings.roleOf(key)), left) : null;
        plans.push({ projectId, removed, rules: droppedRules, mode: current.mode, body });
    }
    await writeAll(companyId, plans, actorId);
    const projects = [];
    for (const plan of plans) {
        const withdrawn = await withdrawProposal(companyId, plan.projectId, givenProposals[plan.projectId]).catch(() => false);
        projects.push({ projectId: plan.projectId, removed: plan.removed, rules: plan.rules, mode: plan.mode, tagsWithdrawn: withdrawn });
    }
    const agents = await packAgents.remove(companyId, pack.blueprint, agentIdsOf(body), projectIds, actor);
    return { blueprint: pack.blueprint, teams: pack.teams, projects, agents };
}

module.exports = { MAX_PROJECTS, packs, normaliseProjectIds, apply, undo };
