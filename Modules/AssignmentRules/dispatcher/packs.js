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
    const ids = Array.isArray(body && body.projectIds) ? body.projectIds.map(String) : [];
    if (!ids.length || ids.length > MAX_PROJECTS || !ids.every((id) => OBJECT_ID.test(id))) throw new RuleError(`projectIds must list from 1 to ${MAX_PROJECTS} projects.`);
    return [...new Set(ids)];
};

const rolesOfPack = (body) => {
    const pack = packs().find((one) => one.blueprint === String((body && body.blueprint) || ''));
    if (!pack) throw new RuleError('There is no such company blueprint.');
    const asked = Array.isArray(body.teams) ? [...new Set(body.teams.map(String))] : [];
    if (!asked.length) throw new RuleError('Pick at least one team.');
    const unknown = asked.filter((team) => !pack.teams.some((one) => one.team === team));
    if (unknown.length) throw new RuleError(`There is no team "${unknown[0]}" in this blueprint.`);
    return { blueprint: pack.blueprint, teams: asked, roles: pack.teams.filter((one) => asked.includes(one.team)).flatMap((one) => one.roles.map((role) => role.key)) };
};

const saveRoles = (companyId, projectId, current, roles, actorId) => settings.save(companyId, projectId, {
    mode: current.mode, threshold: current.threshold, modelGuess: current.modelGuess, rules: current.rules, roles,
}, actorId);

/* Turns the pack's roles on and nothing else: the mode stays as the project has it, so a project whose dispatcher is
 * off routes nothing until a person switches it on. A project that already has every role is left unwritten. */
async function apply(companyId, body, actorId) {
    const projectIds = projectIdsOf(body);
    const pack = rolesOfPack(body);
    const projects = [];
    for (const projectId of projectIds) {
        const current = await settings.load(companyId, projectId);
        const kept = current.roles.filter((key) => settings.roleOf(key));
        const added = pack.roles.filter((key) => !kept.includes(key));
        if (added.length) await saveRoles(companyId, projectId, current, [...kept, ...added], actorId);
        projects.push({ projectId, added, mode: current.mode });
    }
    return { blueprint: pack.blueprint, teams: pack.teams, projects };
}

/* Turns off only the roles a pack turned on, as its answer listed them. */
async function undo(companyId, body, actorId) {
    const projectIds = projectIdsOf(body);
    const given = body.roles && typeof body.roles === 'object' && !Array.isArray(body.roles) ? body.roles : {};
    if (Object.keys(given).some((id) => !projectIds.includes(id))) throw new RuleError('roles may name only the projects in projectIds.');
    const projects = [];
    for (const projectId of projectIds) {
        const asked = Array.isArray(given[projectId]) ? given[projectId].map(String) : [];
        const current = await settings.load(companyId, projectId);
        const removed = current.roles.filter((key) => asked.includes(key));
        if (removed.length) await saveRoles(companyId, projectId, current, current.roles.filter((key) => !removed.includes(key) && settings.roleOf(key)), actorId);
        projects.push({ projectId, removed, mode: current.mode });
    }
    return { projects };
}

module.exports = { MAX_PROJECTS, packs, apply, undo };
