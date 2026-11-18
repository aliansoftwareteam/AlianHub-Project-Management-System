const data = require('./companyBlueprints.json');
const playbooks = require('./rolePlaybooks');

const SIZES = Object.freeze(['small', 'medium', 'large']);
const STARTER = 3;

const resolveRole = (entry) => {
    const role = entry.slug ? playbooks.all().find((one) => one.slug === entry.slug) : null;
    if (!role) return { name: entry.name || entry.slug, team: entry.team || '', key: null };
    return { name: role.name, team: role.team, key: `${role.blueprint}/${role.slug}`, blueprint: role.blueprint };
};

/* The pack route works on one blueprint at a time, so the starter roles are grouped by the blueprint that holds them. */
const applicable = (starter) => {
    const groups = new Map();
    starter.filter((role) => role.key).forEach((role) => {
        if (!groups.has(role.blueprint)) groups.set(role.blueprint, []);
        groups.get(role.blueprint).push(role);
    });
    return [...groups].map(([blueprint, roles]) => ({ blueprint, teams: [...new Set(roles.map((role) => role.team))], roles: roles.map((role) => role.key) }));
};

const view = () => data.industries.map((industry) => {
    const all = industry.roles.map(resolveRole);
    return {
        id: industry.id,
        sizes: Object.fromEntries(SIZES.map((size) => {
            const config = industry.sizes[size];
            const roles = all.slice(0, config.roles).map(({ name, team, key }) => ({ name, team, key }));
            const starter = roles.slice(0, STARTER);
            const packs = applicable(all.slice(0, STARTER));
            return [size, { people: config.people, seats: config.seats, teams: [...new Set(roles.map((role) => role.team))], roles, starter: starter.map((role) => role.name), packs }];
        })),
    };
});

module.exports = { SIZES, STARTER, view };
