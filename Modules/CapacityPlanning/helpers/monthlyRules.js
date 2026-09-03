// Pure month-by-team capacity rules (hours). Unit-tested in tests/capacity-monthly-rules.test.js.

const MAX_MONTHS = 12;
const TIGHT_PCT = 90;
const pad = (n) => String(n).padStart(2, '0');

/* 'YYYY-MM' keys from `from` to `to` inclusive (both 'YYYY-MM' or a date string). */
const monthKeys = (from, to) => {
    const f = new Date(`${String(from).slice(0, 7)}-01T00:00:00Z`);
    const t = new Date(`${String(to).slice(0, 7)}-01T00:00:00Z`);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || t < f) return [];
    const out = [];
    const cur = new Date(f);
    while (cur <= t && out.length < MAX_MONTHS) {
        out.push(`${cur.getUTCFullYear()}-${pad(cur.getUTCMonth() + 1)}`);
        cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
    return out;
};

const monthBounds = (key) => {
    const [y, m] = String(key).split('-').map(Number);
    return {
        start: new Date(Date.UTC(y, m - 1, 1)),
        end: new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)),
    };
};

const monthOf = (d) => {
    const x = new Date(d);
    return Number.isNaN(x.getTime()) ? '' : `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}`;
};

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

const cellStatus = ({ availableHours, committedHours }) => {
    if (committedHours > availableHours) return 'over';
    if (availableHours > 0 && (committedHours / availableHours) * 100 >= TIGHT_PCT) return 'tight';
    return 'ok';
};

/* Roll member-months up into team-months.
 *   teams: [{ teamId, name, memberIds: [] }]
 *   users: { [userId]: { name, months: { [m]: { availableHours, ptoHours, committedHours, pipelineHours, ptoDays } } } }
 * Members outside any team land in a synthetic "unassigned" team so no hours vanish. */
const summarizeTeams = ({ teams = [], users = {}, months = [] } = {}) => {
    const inTeam = new Set();
    const list = teams.map((t) => ({ teamId: String(t.teamId), name: t.name, memberIds: (t.memberIds || []).map(String) }));
    list.forEach((t) => t.memberIds.forEach((id) => inTeam.add(id)));
    const loose = Object.keys(users).filter((id) => !inTeam.has(id));
    if (loose.length) list.push({ teamId: 'unassigned', name: '', memberIds: loose, unassigned: true });

    const gaps = [];
    const rows = list.map((t) => {
        const byMonth = {};
        months.forEach((m) => {
            const cell = { availableHours: 0, ptoHours: 0, committedHours: 0, pipelineHours: 0, notes: [] };
            t.memberIds.forEach((id) => {
                const u = users[id];
                const um = u && u.months && u.months[m];
                if (!um) return;
                cell.availableHours += um.availableHours || 0;
                cell.ptoHours += um.ptoHours || 0;
                cell.committedHours += um.committedHours || 0;
                cell.pipelineHours += um.pipelineHours || 0;
                if (um.ptoDays > 0) cell.notes.push({ userId: id, name: u.name, kind: 'pto', days: um.ptoDays });
                if (um.availableHours > 0 && um.committedHours > um.availableHours) {
                    cell.notes.push({ userId: id, name: u.name, kind: 'over', pct: Math.round((um.committedHours / um.availableHours) * 100) });
                }
            });
            cell.availableHours = round1(cell.availableHours);
            cell.ptoHours = round1(cell.ptoHours);
            cell.committedHours = round1(cell.committedHours);
            cell.pipelineHours = round1(cell.pipelineHours);
            cell.status = cellStatus(cell);
            cell.gapHours = round1(Math.max(0, cell.committedHours - cell.availableHours));
            if (cell.status === 'over') gaps.push({ teamId: t.teamId, teamName: t.name, month: m, ...cell });
            byMonth[m] = cell;
        });
        return { teamId: t.teamId, name: t.name, unassigned: !!t.unassigned, members: t.memberIds.length, months: byMonth };
    });
    gaps.sort((a, b) => b.gapHours - a.gapHours);
    return { teams: rows, gaps };
};

module.exports = { MAX_MONTHS, TIGHT_PCT, monthKeys, monthBounds, monthOf, cellStatus, summarizeTeams };
