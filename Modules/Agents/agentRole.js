const playbooks = require('./rolePlaybooks');

class AgentRoleError extends Error {
    constructor(message) {
        super(message);
        this.status = 400;
    }
}

/* The role an agent plays, as 'blueprint/slug' of a playbook in ./roles, or '' for none. */
const roleOf = (value) => {
    if (value === null || value === '') return '';
    const [blueprint, slug, rest] = String(value).trim().split('/');
    if (rest !== undefined || !blueprint || !slug || !playbooks.find(blueprint, slug)) throw new AgentRoleError(`There is no role "${String(value).slice(0, 120)}".`);
    return `${blueprint}/${slug}`;
};

module.exports = { AgentRoleError, roleOf };
