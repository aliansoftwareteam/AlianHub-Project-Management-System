const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

const hostsOf = (url) => {
    const match = /^mongodb:\/\/([^/?#]*)/i.exec(String(url || '').trim());
    if (!match) return [];
    const authority = match[1];
    const hostList = authority.slice(authority.lastIndexOf('@') + 1);
    return hostList.split(',').map((entry) => {
        const host = entry.trim();
        if (host.startsWith('[')) return host.slice(1, host.indexOf(']')).toLowerCase();
        return host.split(':')[0].toLowerCase();
    });
};

const localTargetProblem = (env = process.env, argv = []) => {
    if (argv.includes('--force')) return 'there is no --force; the demo scripts only run against a local database.';
    if (String(env.NODE_ENV || '').trim().toLowerCase() === 'production') return 'NODE_ENV is production.';
    if (!env.MONGODB_URL) return 'MONGODB_URL is not set.';
    const hosts = hostsOf(env.MONGODB_URL);
    if (!hosts.length || !hosts.every((host) => LOCAL_HOSTS.has(host))) {
        return 'MONGODB_URL does not point to localhost or 127.0.0.1.';
    }
    return null;
};

const assertLocalTarget = (env = process.env, argv = []) => {
    const problem = localTargetProblem(env, argv);
    if (problem) throw new Error(`Refusing to run: ${problem}`);
};

module.exports = { localTargetProblem, assertLocalTarget };
