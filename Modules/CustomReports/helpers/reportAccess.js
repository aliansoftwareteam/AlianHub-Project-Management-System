const mongoose = require('mongoose');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');

const OBJECT_ID = /^[a-f0-9]{24}$/i;

// Billing-rate figures follow the milestone financial card: owner and admin only.
const FINANCIAL_METRICS = Object.freeze(['revenue']);

const oidOrNull = (id) => (OBJECT_ID.test(String(id || '')) ? new mongoose.Types.ObjectId(String(id)) : null);

const isFinancialConfig = (cfg) => FINANCIAL_METRICS.includes(cfg && cfg.metric);

const isPrivilegedUser = async (companyId, uid) => Boolean(uid) && isPrivileged(await getRoleType(companyId, String(uid)));

const callerOf = async (companyId, uid) => {
    const id = String(uid || '');
    return { companyId, uid: id, privileged: await isPrivilegedUser(companyId, id) };
};

const canManage = (caller, doc) => Boolean(doc) && (caller.privileged || (Boolean(caller.uid) && String(doc.createdBy || '') === caller.uid));

const ownedScope = (caller) => (caller.privileged ? {} : { createdBy: caller.uid });

const RESTRICTED_BODY = Object.freeze({
    status: false,
    statusText: 'Billable amounts are only available to owners and admins.',
    message: 'Billable amounts are only available to owners and admins.',
    restricted: true,
});

module.exports = { FINANCIAL_METRICS, RESTRICTED_BODY, oidOrNull, isFinancialConfig, isPrivilegedUser, callerOf, canManage, ownedScope };
