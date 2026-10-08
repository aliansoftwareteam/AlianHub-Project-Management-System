const playbooks = require('../../Agents/rolePlaybooks');
const { RuleError } = require('../rules');
const settings = require('./settings');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const MAX_PROJECTS = 50;
const SUMMARY_MAX = 280;

const packs = () => {
    const byBlueprint = new Map();
    playbooks.all().forEach((role) => {
        if (!byBlueprint.has(role.blueprint)) byBlueprint.set(role.blueprint, new Map());
        const teams = byBlueprint.get(role.blueprint);
        if (!teams.has(role.team)) teams.set(role.team, []);
        teams.get(role.team).push({
            key: settings.roleKey(role), slug: role.slug, name: role.name, department: role.department, summary: playbooks.summary(role, SUMMARY_MAX), tools: [...role.tools],
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
        if (body.roles && typeof body.roles === 'object' && !Array.isArray(body.roles)) {
            body.roles = Object.fromEntries(Object.entries(body.roles).map(([id, roles]) => [String(id).trim().toLowerCase(), roles]));
        }
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

const bodyWith = (current, roles) => ({ mode: current.mode, threshold: current.threshold, modelGuess: current.modelGuess, rules: current.rules, roles });

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
 * off routes nothing until a person switches it on. A project that already has every role is left unwritten. */
async function apply(companyId, body, actorId) {
    const projectIds = projectIdsOf(body);
    const pack = rolesOfPack(body);
    const plans = [];
    for (const projectId of projectIds) {
        const current = await settings.load(companyId, projectId);
        const kept = current.roles.filter((key) => settings.roleOf(key));
        const added = pack.roles.filter((key) => !kept.includes(key));
        plans.push({ projectId, added, mode: current.mode, body: added.length ? bodyWith(current, [...kept, ...added]) : null });
    }
    await writeAll(companyId, plans, actorId);
    return { blueprint: pack.blueprint, teams: pack.teams, projects: plans.map(({ projectId, added, mode }) => ({ projectId, added, mode })) };
}

/* Turns off the roles a pack turned on, as its answer listed them, and never a role outside that pack. */
async function undo(companyId, body, actorId) {
    const projectIds = projectIdsOf(body);
    const pack = rolesOfPack(body);
    const given = body.roles && typeof body.roles === 'object' && !Array.isArray(body.roles) ? body.roles : {};
    if (Object.keys(given).some((id) => !projectIds.includes(id))) throw new RuleError('roles may name only the projects in projectIds.');
    const plans = [];
    for (const projectId of projectIds) {
        const asked = (Array.isArray(given[projectId]) ? given[projectId].map(String) : []).filter((key) => pack.roles.includes(key));
        const current = await settings.load(companyId, projectId);
        const removed = current.roles.filter((key) => asked.includes(key));
        const body = removed.length ? bodyWith(current, current.roles.filter((key) => !removed.includes(key) && settings.roleOf(key))) : null;
        plans.push({ projectId, removed, mode: current.mode, body });
    }
    await writeAll(companyId, plans, actorId);
    return { blueprint: pack.blueprint, teams: pack.teams, projects: plans.map(({ projectId, removed, mode }) => ({ projectId, removed, mode })) };
}

module.exports = { MAX_PROJECTS, packs, normaliseProjectIds, apply, undo };
