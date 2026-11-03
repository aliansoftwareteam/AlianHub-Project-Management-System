const hostingMode = require('../../Config/hostingMode');
const { storageLevel, unlimited } = require('./checks');
const { summary } = require('./entitlements');
const { mailState } = require('./mailCap');

const over = (used, limit) => !unlimited(limit) && Number(used) > Number(limit);

/* Pure: the Plan & usage page's numbers from 062's usage report and the current plan. Guests
 * never take a member's seat, so seats are the people who are not guests everywhere. Only owners
 * and admins see the split by workspace. */
function shapeUsage(report, plan, mail, lifecycle, { privileged = false } = {}) {
    const limits = plan.limits;
    const members = Math.max(0, (report.seats.active || 0) - (report.seats.guests || 0));
    const storageBytes = Number(report.storage.bytes) || 0;
    return {
        managed: true,
        plan: plan.plan,
        version: plan.version,
        portalUrl: plan.portalUrl,
        canManage: privileged,
        lifecycle,
        seats: { used: members, pending: report.seats.pending || 0, limit: limits.seats, overLimit: over(members, limits.seats) },
        guests: { used: report.seats.guests || 0, limit: limits.guests, overLimit: over(report.seats.guests || 0, limits.guests) },
        storage: {
            bytes: storageBytes,
            limit: limits.storageBytes,
            level: storageLevel({ usedBytes: storageBytes, limit: limits.storageBytes }),
            ...(privileged ? { byWorkspace: report.storage.byWorkspace || [] } : {}),
        },
        workspaces: { count: report.workspaces.count, limit: limits.workspaces },
        timeTracker: { enabled: plan.timeTracker.enabled, used: report.timeTracker.seatsUsed || 0, limit: plan.timeTracker.enabled ? plan.timeTracker.seats : 0 },
        maxFileBytes: limits.maxFileBytes,
        mail: { sentToday: mail.sentToday, limit: limits.emailsPerDay, capped: mail.capped, queued: privileged ? mail.queued : undefined },
    };
}

async function planUsage({ privileged = false, now = Date.now() } = {}) {
    if (!hostingMode.isManaged()) return { managed: false };
    const [report, mail] = await Promise.all([require('../Platform/usage').usageReport(now), mailState(now)]);
    const lifecycle = require('../Platform/lifecycle').lifecycleState();
    return shapeUsage(report, summary(), mail, { state: lifecycle.state, message: lifecycle.message, graceUntil: lifecycle.graceUntil }, { privileged });
}

module.exports = { shapeUsage, planUsage };
