const GOAL_NAME = 'Scale: tasks done';
const TARGET_NAME = 'Every list of the project';
const MAX_SOURCE_LISTS = 20;

/* One goal is kept in the seed company and found again by name, so a run adds nothing after the first. */
const scaleGoal = async (call, sources) => {
    const listed = (await call('GET', '/api/v2/goals')).json.data || [];
    const found = listed.find((goal) => goal.name === GOAL_NAME);
    if (found) return found;
    return (await call('POST', '/api/v2/goals', { name: GOAL_NAME, targets: [{ name: TARGET_NAME, kind: 'tasks', sources }] })).json.data;
};

/* Replacing a target's sources is the one request that always counts at once: it checks every source,
 * reads the tasks in one grouped query and writes the goal. A read never waits for a count, so the
 * count cannot be timed through one. */
async function goalProbes({ call, lists, log = () => {} }) {
    const sources = { sprintIds: lists.slice(0, MAX_SOURCE_LISTS).map((list) => String(list._id)), taskIds: [] };
    let goal;
    try {
        goal = await scaleGoal(call, sources);
    } catch (error) {
        log(`Goal timings not run: ${error.message} (the server may be on a build without goals).`);
        return [];
    }
    const target = (goal.targets || []).find((entry) => entry.kind === 'tasks');
    if (!target) {
        log(`Goal timings not run: the goal "${GOAL_NAME}" has no target counted from tasks.`);
        return [];
    }
    const recount = async () => {
        const answer = await call('PATCH', `/api/v2/goals/${goal._id}/targets/${target.id}`, { sources });
        const counted = answer.json.data.targets.find((entry) => entry.id === target.id).counted;
        return { ...answer, rows: counted.total };
    };
    return [
        { key: 'api.goalRecount', label: `API: Goal recount (a target counting ${sources.sprintIds.length} lists: source check, one grouped read of the tasks, one write)`, run: recount },
        { key: 'api.goalsList', label: 'API: Goals list (stored numbers, no count)', run: () => call('GET', '/api/v2/goals') },
    ];
}

module.exports = { GOAL_NAME, MAX_SOURCE_LISTS, goalProbes };
