const { canReadTask } = require('../../Tasks/helpers/taskReadAccess');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');

const makerOf = (hook) => String((hook && hook.createdBy) || '');

/* A webhook posts a task to an address outside the workspace that its maker chose, so it carries
 * only what its maker can open today. One with no recorded maker predates ownership and is in
 * the hands of the owners and admins, who see every task. */
const hooksThatMayCarry = async (companyId, hooks, task) => {
    const makers = [...new Set(hooks.map(makerOf).filter(Boolean))];
    const opens = await Promise.all(makers.map((maker) => canReadTask(companyId, maker, task)));
    const readers = new Set(makers.filter((maker, index) => opens[index]));
    return hooks.filter((hook) => !makerOf(hook) || readers.has(makerOf(hook)));
};

const NO_MAKER = [{ createdBy: '' }, { createdBy: null }, { createdBy: { $exists: false } }];

/* The match for the webhooks a person manages: their own, and for an owner or admin also the
 * ones with no recorded maker, which would otherwise keep posting with nobody able to stop them. */
const managedBy = async (companyId, uid) => ({
    $or: [{ createdBy: uid }, ...(isPrivileged(await getRoleType(companyId, uid)) ? NO_MAKER : [])],
});

module.exports = { hooksThatMayCarry, managedBy };
