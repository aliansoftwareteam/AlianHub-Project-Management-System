// How a role's value is read out of the RULES list. Kept free of requires so the permission
// guard and the project list (Modules/Agents/scope) resolve the same value for the same role.

/** Arrange the flat RULES array into the nested object the frontend uses. */
const arrangeRules = (rawRules) => {
    const arranged = {};
    const rules = [...(rawRules || [])].filter(Boolean).sort((a, b) => (a.isParent > b.isParent ? -1 : 1));
    rules.forEach((rule) => {
        const ownKey = rule.key ? rule.key : String(rule.name || "").replaceAll(" ", "_").toLowerCase();
        if (rule.isParent) {
            arranged[ownKey] = { ...rule };
        } else {
            const parent = rules.find((x) => String(x._id) === String(rule.parentId));
            if (parent && parent.key && arranged[parent.key]) {
                arranged[parent.key][ownKey] = rule;
            }
        }
    });
    return arranged;
};

const lookupRule = (arranged, path) => {
    let rule = null;
    for (const segment of String(path).split('.')) {
        rule = rule ? rule[segment] : arranged[segment];
        if (rule === undefined || rule === null) return null;
    }
    return rule && Array.isArray(rule.roles) ? rule : null;
};

const rolePermission = (arranged, roleType, path) => {
    const rule = lookupRule(arranged, path);
    const match = rule && rule.roles.find((r) => r.key === roleType);
    return match ? match.permission : null;
};

const isWritable = (permission) => permission === true || permission === 1 || permission === 2;
const isReadable = (permission) => permission !== null && permission !== undefined && permission !== 0;

const PRIVATE_PROJECTS = 'project.private_projects';
const PRIVATE_VISIBLE_TO_EVERYONE = 2;

// Any other value leaves a private project to its assignees.
const seesEveryPrivateProject = (permission) => permission === PRIVATE_VISIBLE_TO_EVERYONE;

module.exports = { arrangeRules, rolePermission, isWritable, isReadable, PRIVATE_PROJECTS, seesEveryPrivateProject };
