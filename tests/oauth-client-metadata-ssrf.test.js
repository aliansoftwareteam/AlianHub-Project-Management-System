const http = require('http');
const dns = require('dns');

jest.mock('../Modules/Agents/engine/safeFetch', () => {
    const actual = jest.requireActual('../Modules/Agents/engine/safeFetch');
    return { ...actual, safeFetch: jest.fn(actual.safeFetch) };
});

const actual = jest.requireActual('../Modules/Agents/engine/safeFetch');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const metadataDocument = require('../Modules/OAuthServer/metadataDocument');

/* The client ID metadata document URL comes from whoever calls /oauth/authorize. These run the real
 * safeFetch rules with the caps metadataDocument passes it. A local server stands in for a public https
 * host: the first hop is re-pointed at it, and every later hop resolves the ordinary way. */

const PUBLIC_ID = 'https://agent.s10s2.test/oauth/client.json';
const REDIRECT = 'http://127.0.0.1:33418/callback';
const doc = { client_id: PUBLIC_ID, client_name: 'S10S2 agent', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' };

let server;
let port;
let route;

beforeAll(async () => {
    server = http.createServer((req, res) => route(req, res));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
    metadataDocument.forget();
    safeFetch.mockImplementation(actual.safeFetch);
    route = (req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(doc)); };
});

const viaLocalServer = () => safeFetch.mockImplementation((url, opts) => {
    const local = String(url).replace('https://agent.s10s2.test', `http://agent.s10s2.test:${port}`);
    const resolve = (target) => (new URL(target).hostname === 'agent.s10s2.test'
        ? { url: new URL(target), address: '127.0.0.1', family: 4 }
        : actual.resolvePublic(target));
    return actual.safeFetch(local, { ...opts, resolve });
});

describe('client ID metadata document fetching refuses to reach private addresses', () => {
    it.each([
        'https://127.0.0.1/oauth/client.json',
        'https://10.1.2.3/oauth/client.json',
        'https://169.254.169.254/latest/meta-data',
        'https://[::1]/oauth/client.json',
        'https://localhost/oauth/client.json',
        'https://metadata.internal/oauth/client.json',
        'https://0x7f000001/oauth/client.json',
    ])('%s', async (clientId) => {
        await expect(metadataDocument.load(clientId)).rejects.toThrow(metadataDocument.MetadataDocumentError);
    });

    it('a public-looking name that resolves to a private address', async () => {
        const lookup = jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '10.0.0.7', family: 4 }]);
        try {
            await expect(metadataDocument.load('https://rebind.s10s2.test/oauth/client.json')).rejects.toThrow(/private or reserved address/);
        } finally {
            lookup.mockRestore();
        }
    });

    it.each([
        ['loopback', () => `http://127.0.0.1:${port}/oauth/client.json`],
        ['the cloud metadata endpoint', () => 'http://169.254.169.254/latest/meta-data'],
        ['an internal name', () => 'https://db.internal/client.json'],
    ])('a redirect from a public host to %s', async (label, target) => {
        viaLocalServer();
        let served = 0;
        route = (req, res) => {
            served += 1;
            if (req.url === '/oauth/client.json') { res.statusCode = 302; res.setHeader('location', target()); return res.end(); }
            res.setHeader('content-type', 'application/json');
            return res.end(JSON.stringify(doc));
        };
        await expect(metadataDocument.load(PUBLIC_ID)).rejects.toThrow(/private, local or internal host/);
        expect(served).toBe(1);
    });

    it('an oversized document', async () => {
        viaLocalServer();
        route = (req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ...doc, padding: 'x'.repeat(6 * 1024) })); };
        await expect(metadataDocument.load(PUBLIC_ID)).rejects.toThrow(/size cap/);
    });

    it('a document that takes too long', async () => {
        viaLocalServer();
        route = () => {};
        const started = Date.now();
        await expect(metadataDocument.load(PUBLIC_ID)).rejects.toThrow(/time budget/);
        expect(Date.now() - started).toBeLessThan(metadataDocument.FETCH.timeoutMs + 2000);
    }, 15000);

    it('while a well-formed document on a public host loads and is cached', async () => {
        viaLocalServer();
        let served = 0;
        route = (req, res) => { served += 1; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'max-age=60'); res.end(JSON.stringify(doc)); };
        const client = await metadataDocument.load(PUBLIC_ID);
        expect(client).toMatchObject({ clientId: PUBLIC_ID, kind: 'metadata_document', name: 'S10S2 agent', redirectUris: [REDIRECT], tokenEndpointAuthMethod: 'none' });
        await metadataDocument.load(PUBLIC_ID);
        expect(served).toBe(1);
    });
});

describe('cache lifetime', () => {
    it('follows Cache-Control, capped at a day, and keeps nothing marked no-store', () => {
        expect(metadataDocument.cacheMsOf({ 'cache-control': 'max-age=120' })).toBe(120000);
        expect(metadataDocument.cacheMsOf({ 'cache-control': 'public, max-age=99999999' })).toBe(24 * 60 * 60 * 1000);
        expect(metadataDocument.cacheMsOf({ 'cache-control': 'no-store' })).toBe(0);
        expect(metadataDocument.cacheMsOf({})).toBe(300000);
    });
});
