const path = require('path');

/* Preloaded into a second test server (NODE_OPTIONS --require): the names in E2E_DECLARED_READ_HOSTS resolve to a
 * loopback server the suite runs, standing in for DNS. Every other rule of the agent fetch still applies, and any
 * other name is refused, so the server makes no real outbound request. */
const hosts = String(process.env.E2E_DECLARED_READ_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);

if (hosts.length) {
    const fetchModule = require(path.join(__dirname, '..', '..', 'Modules', 'Agents', 'engine', 'safeFetch'));
    const actual = fetchModule.safeFetch;
    const resolve = async (url) => {
        const u = new URL(url);
        if (!hosts.includes(u.hostname)) throw new Error(`the test server resolves only ${hosts.join(', ')}, not ${u.hostname}`);
        return { url: u, address: '127.0.0.1', family: 4 };
    };
    fetchModule.safeFetch = (url, opts = {}) => actual(url, { resolve, ...opts });
}
