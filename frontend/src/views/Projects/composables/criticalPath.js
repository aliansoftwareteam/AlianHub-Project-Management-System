/* Critical-path maths for the Gantt view. Pure and dependency-free (CommonJS so the
 * jest suite in tests/critical-path.test.js can require it directly).
 *
 * Input rows are the task shape the Gantt already has: an id, a start and due date,
 * and the ids this task blocks. Cycles are tolerated — a relation pair that loops
 * would otherwise hang the topological walk. */

const DAY_MS = 86400000;

const toTime = (value) => {
    if (value === null || value === undefined || value === '') return NaN;
    const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isNaN(t) ? NaN : t;
};

const durationDays = (start, end) => {
    const s = toTime(start);
    const e = toTime(end);
    if (Number.isNaN(s) || Number.isNaN(e)) return 1;
    return Math.max(1, Math.round((e - s) / DAY_MS) + 1);
};

/* [{ id, startDate, DueDate, blocks: [id] }] → nodes keyed by id, edges deduped and
 * pointing only at ids that are actually in the set. */
const buildNodes = (tasks) => {
    const nodes = new Map();
    (tasks || []).forEach((t) => {
        const id = String((t && (t.id !== undefined ? t.id : t._id)) || '');
        if (!id || nodes.has(id)) return;
        nodes.set(id, {
            id,
            duration: Number(t.duration) > 0 ? Number(t.duration) : durationDays(t.startDate || t.start, t.DueDate || t.end),
            succs: [],
            preds: [],
        });
    });
    (tasks || []).forEach((t) => {
        const id = String((t && (t.id !== undefined ? t.id : t._id)) || '');
        const node = nodes.get(id);
        if (!node) return;
        const blocks = Array.isArray(t.blocks) ? t.blocks : [];
        blocks.forEach((raw) => {
            const target = String(raw || '');
            if (!target || target === id || !nodes.has(target)) return;
            if (node.succs.includes(target)) return;
            node.succs.push(target);
            nodes.get(target).preds.push(id);
        });
    });
    return nodes;
};

/* Kahn order; anything left over sits in a cycle and is appended so it still gets
 * finite times instead of being dropped from the schedule. */
const topoOrder = (nodes) => {
    const indegree = new Map();
    nodes.forEach((n, id) => indegree.set(id, n.preds.length));
    const queue = [...indegree.keys()].filter((id) => indegree.get(id) === 0);
    const order = [];
    while (queue.length) {
        const id = queue.shift();
        order.push(id);
        nodes.get(id).succs.forEach((s) => {
            indegree.set(s, indegree.get(s) - 1);
            if (indegree.get(s) === 0) queue.push(s);
        });
    }
    if (order.length !== nodes.size) {
        nodes.forEach((n, id) => { if (!order.includes(id)) order.push(id); });
    }
    return order;
};

/* Forward/backward pass. Times are in days relative to the first task, not calendar
 * dates: the chart draws real dates, this only decides what has slack. */
const schedule = (tasks) => {
    const nodes = buildNodes(tasks);
    const order = topoOrder(nodes);
    const es = new Map();
    const ef = new Map();
    order.forEach((id) => {
        const node = nodes.get(id);
        const start = node.preds.reduce((max, p) => Math.max(max, ef.has(p) ? ef.get(p) : 0), 0);
        es.set(id, start);
        ef.set(id, start + node.duration);
    });
    const total = order.reduce((max, id) => Math.max(max, ef.get(id) || 0), 0);
    const lf = new Map();
    const ls = new Map();
    [...order].reverse().forEach((id) => {
        const node = nodes.get(id);
        const finish = node.succs.length
            ? node.succs.reduce((min, s) => Math.min(min, ls.has(s) ? ls.get(s) : total), total)
            : total;
        lf.set(id, finish);
        ls.set(id, finish - node.duration);
    });
    const result = new Map();
    nodes.forEach((node, id) => {
        result.set(id, {
            id,
            duration: node.duration,
            earliestStart: es.get(id),
            earliestFinish: ef.get(id),
            latestStart: ls.get(id),
            latestFinish: lf.get(id),
            slack: ls.get(id) - es.get(id),
            critical: ls.get(id) - es.get(id) <= 0,
            succs: node.succs,
            preds: node.preds,
        });
    });
    return { nodes: result, total };
};

/* The longest chain, in order, so the chart can draw it as one run rather than a
 * scatter of red bars. Ties resolve on the longer remaining chain. */
const criticalPath = (tasks) => {
    const { nodes, total } = schedule(tasks);
    if (!nodes.size) return { path: [], ids: [], durationDays: 0, nodes };
    const critical = [...nodes.values()].filter((n) => n.critical);
    if (!critical.length) return { path: [], ids: [], durationDays: total, nodes };
    const chainLength = new Map();
    const longestFrom = (id, seen) => {
        if (chainLength.has(id)) return chainLength.get(id);
        if (seen.has(id)) return 0;
        seen.add(id);
        const node = nodes.get(id);
        const best = node.succs
            .filter((s) => nodes.get(s) && nodes.get(s).critical)
            .reduce((max, s) => Math.max(max, longestFrom(s, seen)), 0);
        seen.delete(id);
        const value = node.duration + best;
        chainLength.set(id, value);
        return value;
    };
    // Every node inside a cycle has a critical predecessor, so fall back to the
    // earliest one rather than returning nothing.
    const starts = critical.filter((n) => !n.preds.some((p) => nodes.get(p) && nodes.get(p).critical));
    const heads = starts.length ? starts : [...critical].sort((a, b) => a.earliestStart - b.earliestStart);
    const head = heads.sort((a, b) => longestFrom(b.id, new Set()) - longestFrom(a.id, new Set()))[0];
    const path = [];
    let cursor = head;
    while (cursor && !path.includes(cursor.id)) {
        path.push(cursor.id);
        const next = cursor.succs
            .map((s) => nodes.get(s))
            .filter((n) => n && n.critical)
            .sort((a, b) => longestFrom(b.id, new Set()) - longestFrom(a.id, new Set()))[0];
        cursor = next;
    }
    return { path, ids: path, durationDays: total, nodes };
};

/* Convenience for the view: the set of ids to paint red. */
const criticalTaskIds = (tasks) => new Set(criticalPath(tasks).path);

module.exports = { DAY_MS, durationDays, schedule, criticalPath, criticalTaskIds };
