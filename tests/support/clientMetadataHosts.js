const path = require('node:path');

/* Preloaded (NODE_OPTIONS --require) into a test server only. A client ID metadata document must sit on a
 * public https host, which a test cannot have, so the hosts named in MCP_TEST_CLIENT_METADATA_HOSTS
 * ("agent.example.test=127.0.0.1:4100,...") are served by the test over plain http on loopback. Everything
 * else about the fetch (no redirects, size and time caps, the served-at-its-own-URL check, the document
 * rules) is the app's own; any other host, loopback included, still meets the private-address refusal. */
const hosts = new Map(String(process.env.MCP_TEST_CLIENT_METADATA_HOSTS || '')
    .split(',')
    .filter(Boolean)
    .map((entry) => {
        const [name, target] = entry.split('=');
        const [address, port] = target.split(':');
        return [name, { address, port: Number(port) }];
    }));

if (hosts.size) {
    const safeFetchModule = require(path.join(__dirname, '..', '..', 'Modules', 'Agents', 'engine', 'safeFetch'));
    const real = safeFetchModule.safeFetch;
    safeFetchModule.safeFetch = (url, opts = {}) => {
        const asked = new URL(String(url));
        const local = hosts.get(asked.hostname);
        if (!local || asked.protocol !== 'https:') return real(url, opts);
        const origin = `https://${asked.host}`;
        const plain = `http://${asked.hostname}:${local.port}`;
        const resolve = (target) => {
            const next = new URL(target);
            return hosts.has(next.hostname) ? { url: next, address: local.address, family: 4 } : safeFetchModule.resolvePublic(target);
        };
        return real(`${plain}${asked.pathname}${asked.search}`, { ...opts, resolve })
            .then((res) => ({ ...res, url: String(res.url).replace(plain, origin) }));
    };
}
