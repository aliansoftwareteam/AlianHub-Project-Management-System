const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

const RELATION_READS = ['list', 'openBlockers'];

/* The app reads some of its data with POST. Each entry was checked against its handler: it
 * only queries. `when` narrows an entry to the request bodies that read. A path that can
 * write is not here even when a screen wants it: project/personal creates the Personal List
 * on a first visit, and ai/* spends provider money. */
const ALLOWED_READS = [
    { method: 'POST', path: '/api/v1/task/find', why: 'Task lists in every view: an aggregate over tasks, with $out and $merge refused by taskQueryGuard.' },
    { method: 'POST', path: '/api/v1/user/find', why: 'Member names and avatars: a $match over users, sanitised by sanitizeUserQuery and scoped to the workspace.' },
    { method: 'POST', path: '/api/v1/admin/company', why: 'The workspace record (name, logo, plan): a find limited to the caller\'s own workspaces.' },
    { method: 'POST', path: '/api/v1/main-chats/find', why: 'The caller\'s own conversations in Chat: a find with a filter the server forces.' },
    { method: 'POST', path: '/api/v2/tasks/relations', when: (body) => Boolean(body) && RELATION_READS.includes(body.action), why: 'Linked tasks in the task panel and Gantt: the list and openBlockers actions only read; add and remove stay blocked.' },
    { method: 'POST', path: '/api/v1/timesheet/project', why: 'Project timesheet: an aggregate over time logs built on the server.' },
    { method: 'POST', path: '/api/v1/timesheet/tracker', why: 'Tracker timesheet: an aggregate over time logs built on the server.' },
    { method: 'POST', path: '/api/v1/timesheet/workload-grid', why: 'Workload grid: finds over estimates, time logs and time off.' },
    { method: 'POST', path: '/api/v1/estimatedTime', why: 'Estimates in the list, workload and timesheets: an aggregate over estimates, with $out and $merge refused by timesheetQueryScope.' },
    { method: 'POST', path: '/api/v2/sprints/hours', why: 'Sprint hour totals in the project sidebar: a find and two aggregates.' },
    { method: 'POST', path: '/api/v1/milestoneReport', why: 'Milestone report: an aggregate over milestones built on the server.' },
    { method: 'POST', path: '/api/v1/reports/custom/run', why: 'Custom report preview: runs a validated report config and saves nothing.' },
    { method: 'POST', path: '/socket.io/', why: 'Socket.io long-polling sends its connect and room-join packets as POST; a page that only loads joins rooms and nothing else.' },
];

const refuse = (reason) => ({ allow: false, reason });

function decide({ method, url, body = null } = {}, { baseUrl } = {}) {
    const verb = String(method || '').toUpperCase();
    if (!verb) return refuse('a request without a method');
    if (SAFE_METHODS.includes(verb)) return { allow: true, reason: 'read' };

    let target;
    let home;
    try {
        target = new URL(url);
        home = new URL(baseUrl);
    } catch {
        return refuse(`${verb} to an address that cannot be read`);
    }
    if (target.origin !== home.origin) return refuse(`${verb} to another host (${target.host})`);

    const entry = ALLOWED_READS.find((candidate) => candidate.method === verb && candidate.path === target.pathname);
    if (!entry) return refuse(`${verb} ${target.pathname} is not on the read list`);
    if (entry.when && !entry.when(body)) return refuse(`${verb} ${target.pathname} with this body is not a read`);
    return { allow: true, reason: 'listed read' };
}

module.exports = { ALLOWED_READS, SAFE_METHODS, decide };
