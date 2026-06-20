// REP-06 — pure capacity / utilization rules (everything in HOURS). The capacity
// itself (working hours minus approved PTO) is computed by Pto.computeAvailableCapacity
// (SEC-08); this adds the allocation/utilization + over-allocation flag on top.
// Unit-tested in tests/capacity-rules.test.js.

const userUtilization = ({ capacityHours = 0, allocatedHours = 0 } = {}) => {
    const cap = Number(capacityHours) || 0;
    const alloc = Number(allocatedHours) || 0;
    const availableHours = Math.max(0, cap - alloc);
    const utilizationPct = cap > 0 ? Math.round((alloc / cap) * 100) : (alloc > 0 ? 100 : 0);
    let status = 'under';
    if (alloc > cap) status = 'over';           // allocated beyond available capacity (incl. cap 0)
    else if (utilizationPct >= 80) status = 'full';
    return { capacityHours: cap, allocatedHours: alloc, availableHours, utilizationPct, status };
};

const summarize = (rows = []) => {
    const t = rows.reduce((a, r) => {
        a.totalCapacity += r.capacityHours || 0;
        a.totalAllocated += r.allocatedHours || 0;
        if (r.status === 'over') a.over++;
        else if (r.status === 'full') a.full++;
        else a.under++;
        return a;
    }, { users: rows.length, totalCapacity: 0, totalAllocated: 0, over: 0, full: 0, under: 0 });
    t.utilizationPct = t.totalCapacity > 0 ? Math.round((t.totalAllocated / t.totalCapacity) * 100) : 0;
    return t;
};

module.exports = { userUtilization, summarize };
