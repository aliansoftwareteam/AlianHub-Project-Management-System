// Rollups over the provenance record (29c). Pure — no I/O — and built on the
// same badge derivation the task carries, so a chart can never disagree with the
// badge on the row.
//
// The split rule: a task counts as human work only when no agent touched it.
// AGENT, MIXED and UNCHECKED all needed an agent, so all three sit on the agent
// side of the velocity line — that is what makes "plan on the human line if your
// agent access might change" an honest thing to read.

const C = require('./completion');

const PATTERNS = Object.freeze([C.BADGES.HUMAN, C.BADGES.AGENT, C.BADGES.MIXED, C.BADGES.UNCHECKED]);
const HUMAN_PATTERNS = Object.freeze([C.BADGES.HUMAN]);

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : null);

const isClosed = (task) => String((task && task.statusType) || '') === C.DONE_TYPE;
const patternOf = (task) => C.deriveBadge(C.normalize(task && task.completion));
const isHumanPattern = (pattern) => HUMAN_PATTERNS.includes(pattern);

/* Hours on one task, split by who spent them. */
const hoursOf = (task) => {
    const c = C.normalize(task && task.completion);
    const out = c.workBy.reduce((acc, w) => {
        const hours = Number(w.hours) || 0;
        if (w.actorType === C.ACTOR_AGENT) acc.agent += hours;
        else acc.human += hours;
        return acc;
    }, { human: 0, agent: 0 });
    return { human: round(out.human), agent: round(out.agent), total: round(out.human + out.agent) };
};

const emptyPatterns = () => PATTERNS.reduce((acc, key) => {
    acc[key] = { tasks: 0, points: 0, hours: 0 };
    return acc;
}, {});

/* One sprint's closed work, split. `completedHuman` / `completedAgent` are the
 * field names the velocity chart reads; they always sum to `completed`. */
const velocitySplit = (tasks) => {
    const out = {
        closed: 0,
        completed: 0,
        completedHuman: 0,
        completedAgent: 0,
        tasksHuman: 0,
        tasksAgent: 0,
        unchecked: 0,
        byPattern: emptyPatterns(),
        hours: { human: 0, agent: 0, total: 0 },
        firstPass: { human: { closed: 0, firstPass: 0, pct: null }, agent: { closed: 0, firstPass: 0, pct: null } },
    };
    (tasks || []).filter(isClosed).forEach((task) => {
        const pattern = patternOf(task);
        const points = Number(task.points) || 0;
        const hours = hoursOf(task);
        const human = isHumanPattern(pattern);
        const bucket = out.byPattern[pattern];

        out.closed += 1;
        out.completed += points;
        bucket.tasks += 1;
        bucket.points += points;
        bucket.hours = round(bucket.hours + hours.total);
        out.hours.human = round(out.hours.human + hours.human);
        out.hours.agent = round(out.hours.agent + hours.agent);
        if (pattern === C.BADGES.UNCHECKED) out.unchecked += 1;
        if (human) {
            out.completedHuman += points;
            out.tasksHuman += 1;
        } else {
            out.completedAgent += points;
            out.tasksAgent += 1;
        }
        const pass = human ? out.firstPass.human : out.firstPass.agent;
        pass.closed += 1;
        if (!C.normalize(task.completion).reopenCount) pass.firstPass += 1;
    });
    out.hours.total = round(out.hours.human + out.hours.agent);
    ['human', 'agent'].forEach((key) => {
        const pass = out.firstPass[key];
        pass.pct = pct(pass.firstPass, pass.closed);
    });
    return out;
};

/* The same split, keyed by sprint, for the velocity series. */
const bySprint = (tasks, sprintIds) => {
    const groups = new Map((sprintIds || []).map((id) => [String(id), []]));
    (tasks || []).forEach((task) => {
        const key = String(task && task.sprintId);
        if (groups.has(key)) groups.get(key).push(task);
    });
    const out = {};
    groups.forEach((rows, key) => { out[key] = velocitySplit(rows); });
    return out;
};

/* Cost and margin by who did the work. Rates are minor units per hour. There is
 * no honest default for a cost rate, so without one the caller gets
 * `hasCostRate: false` and must show a "set a rate" state rather than a zero —
 * the same contract as Milestone billingMath.profitability. */
const marginSplit = ({ tasks, blendedCostRateMinor = null, agentCostRateMinor = null, billedMinor = 0 } = {}) => {
    const split = velocitySplit(tasks);
    const humanRate = Number(blendedCostRateMinor);
    const hasCostRate = Number.isFinite(humanRate) && humanRate > 0;
    const agentGiven = agentCostRateMinor !== null && agentCostRateMinor !== undefined && agentCostRateMinor !== '';
    const agentRate = agentGiven && Number.isFinite(Number(agentCostRateMinor)) && Number(agentCostRateMinor) >= 0 ? Number(agentCostRateMinor) : humanRate;
    const billed = Number(billedMinor) || 0;

    if (!hasCostRate) {
        return {
            hasCostRate: false,
            closed: split.closed,
            hours: split.hours,
            costMinor: null,
            billedMinor: billed,
            marginMinor: null,
            marginBp: null,
            costPerClosedTaskMinor: null,
        };
    }

    const costOf = (hours, rate) => Math.round((Number(hours) || 0) * rate);
    const perPattern = {};
    PATTERNS.forEach((pattern) => { perPattern[pattern] = { costMinor: 0, tasks: 0 }; });
    (tasks || []).filter(isClosed).forEach((task) => {
        const hours = hoursOf(task);
        const entry = perPattern[patternOf(task)];
        entry.tasks += 1;
        entry.costMinor += costOf(hours.human, humanRate) + costOf(hours.agent, agentRate);
    });

    const human = costOf(split.hours.human, humanRate);
    const agent = costOf(split.hours.agent, agentRate);
    const total = human + agent;
    const costPerClosedTaskMinor = { all: split.closed ? Math.round(total / split.closed) : null };
    PATTERNS.forEach((pattern) => {
        const entry = perPattern[pattern];
        costPerClosedTaskMinor[pattern] = entry.tasks ? Math.round(entry.costMinor / entry.tasks) : null;
    });

    return {
        hasCostRate: true,
        closed: split.closed,
        hours: split.hours,
        costMinor: { human, agent, total },
        billedMinor: billed,
        marginMinor: billed - total,
        marginBp: billed ? Math.round(((billed - total) / billed) * 10000) : null,
        costPerClosedTaskMinor,
    };
};

module.exports = { PATTERNS, isClosed, patternOf, isHumanPattern, hoursOf, velocitySplit, bySprint, marginSplit };
