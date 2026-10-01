const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/* The app reads some of its data with POST. Each entry below was checked against its
 * handler: it only queries. A path whose handler also writes for some request bodies
 * (project/checklist, project/tags, dashboard) is deliberately not here. */
const ALLOWED_READS = [
    { method: 'POST', path: '/api/v1/task/find', why: 'Task lists in every view: an aggregate over tasks, with $out and $merge refused by taskQueryGuard.' },
    { method: 'POST', path: '/socket.io/', why: 'Socket.io long-polling sends its connect and room-join packets as POST; a page that only loads joins rooms and nothing else.' },
];

const refuse = (reason) => ({ allow: false, reason });

function decide({ method, url } = {}, { baseUrl } = {}) {
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

    const listed = ALLOWED_READS.some((entry) => entry.method === verb && entry.path === target.pathname);
    return listed ? { allow: true, reason: 'listed read' } : refuse(`${verb} ${target.pathname} is not on the read list`);
}

module.exports = { ALLOWED_READS, SAFE_METHODS, decide };
