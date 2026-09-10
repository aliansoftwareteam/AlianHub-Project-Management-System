const http = require('http');
const dns = require('dns');
const { safeFetch, resolvePublic, isBlockedHostname, isPrivateAddress } = require('../Modules/Agents/engine/safeFetch');
const { fetchPage, extractUrl } = require('../Modules/Agents/engine/pageAudit');
const { inputsOf } = require('../Modules/Agents/taskInputs');

const SECRET = 'IMDS-TOKEN-DO-NOT-LEAK';

const listen = (handler) => new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
});

describe('agent egress — private-host rule', () => {
    it('classifies every reserved range by the resolved address, not the string', () => {
        ['0.0.0.0', '0.1.2.3', '10.1.2.3', '127.0.0.1', '127.9.9.9', '169.254.169.254', '172.16.0.1', '172.31.255.255',
         '192.168.1.1', '100.64.0.1', '100.127.255.254', '224.0.0.1', '239.255.255.250', '255.255.255.255',
         '::', '::1', 'fc00::1', 'fd12::1', 'fe80::1', 'febf::1', 'ff02::1',
         '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:10.0.0.1', '::ffff:7f00:1'].forEach((ip) => {
            expect([ip, isPrivateAddress(ip)]).toEqual([ip, true]);
        });
        ['8.8.8.8', '203.0.113.10', '172.32.0.1', '100.128.0.1', '2606:4700::1111', '::ffff:8.8.8.8'].forEach((ip) => {
            expect([ip, isPrivateAddress(ip)]).toEqual([ip, false]);
        });
    });

    it('refuses localhost and internal-only suffixes before resolving', () => {
        ['localhost', 'LOCALHOST', 'printer.local', 'db.internal', 'a.b.internal', '[::1]', '127.1', '0x7f000001', '2130706433'].forEach((h) => {
            expect([h, isBlockedHostname(h)]).toEqual([h, true]);
        });
        expect(isBlockedHostname('example.com')).toBe(false);
        expect(isBlockedHostname('internal.example.com')).toBe(false);
    });

    describe('resolution', () => {
        let lookup;
        beforeEach(() => { lookup = jest.spyOn(dns.promises, 'lookup'); });
        afterEach(() => lookup.mockRestore());

        it('rejects a public-looking hostname that resolves to a private address', async () => {
            lookup.mockResolvedValue([{ address: '10.0.0.7', family: 4 }]);
            await expect(resolvePublic('https://internal-service.example.com/')).rejects.toThrow(/private|reserved/i);
            expect(lookup).toHaveBeenCalledWith('internal-service.example.com', expect.objectContaining({ all: true }));
        });

        it('rejects when ANY resolved address is private', async () => {
            lookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }, { address: '169.254.169.254', family: 4 }]);
            await expect(resolvePublic('http://split-horizon.example.com/')).rejects.toThrow(/private|reserved/i);
            lookup.mockResolvedValue([{ address: '2606:4700::1111', family: 6 }, { address: '::ffff:127.0.0.1', family: 6 }]);
            await expect(resolvePublic('http://mapped.example.com/')).rejects.toThrow(/private|reserved/i);
        });

        it('returns the validated address so the connection can be pinned to it', async () => {
            lookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
            await expect(resolvePublic('https://example.com/x')).resolves.toMatchObject({ address: '203.0.113.10', family: 4 });
        });

        it('only allows http and https', async () => {
            await expect(resolvePublic('file:///etc/passwd')).rejects.toThrow(/http/);
            await expect(resolvePublic('ftp://example.com/')).rejects.toThrow(/http/);
            await expect(resolvePublic('not a url')).rejects.toThrow();
            expect(lookup).not.toHaveBeenCalled();
        });
    });

    describe('fetching', () => {
        let server; let port; let hits;
        beforeAll(async () => {
            hits = [];
            ({ server, port } = await listen((req, res) => {
                hits.push(req.url);
                if (req.url === '/secret') return res.end(SECRET);
                if (req.url === '/to-loopback') { res.writeHead(302, { Location: `http://127.0.0.1:${port}/secret` }); return res.end(); }
                if (req.url === '/to-metadata') { res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' }); return res.end(); }
                if (req.url === '/to-internal-name') { res.writeHead(302, { Location: 'http://db.internal/' }); return res.end(); }
                if (req.url === '/relative') { res.writeHead(301, { Location: '/landed' }); return res.end(); }
                if (req.url === '/landed') return res.end('<html><title>landed</title></html>');
                if (/^\/loop\/\d+$/.test(req.url)) { const n = Number(req.url.split('/')[2]); res.writeHead(302, { Location: `/loop/${n + 1}` }); return res.end(); }
                if (req.url === '/big') { res.writeHead(200, { 'Content-Type': 'text/html' }); const chunk = Buffer.alloc(64 * 1024, 'a'); const tick = () => { if (!res.write(chunk)) return res.once('drain', tick); setImmediate(tick); }; return tick(); }
                if (req.url === '/slow') return;
                res.writeHead(404); res.end();
            }));
        });
        afterAll(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
        beforeEach(() => { hits.length = 0; });

        /* Every address on this test server is loopback, so a fake resolver stands in
         * for DNS on the FIRST hop only: `public.test` is "public" and pinned to the
         * server. Every other target — including redirect targets — goes through the
         * real rule, which is exactly what the old code skipped. */
        const resolve = (url) => {
            const u = new URL(url);
            if (u.hostname === 'public.test') return Promise.resolve({ url: u, address: '127.0.0.1', family: 4 });
            return resolvePublic(url);
        };
        const opts = () => ({ resolve, timeoutMs: 3000, maxRedirects: 5, maxBytes: 1024 * 1024 });

        it('fetchPage refuses a loopback literal outright', async () => {
            await expect(fetchPage(`http://127.0.0.1:${port}/secret`)).rejects.toThrow(/private|reserved/i);
            expect(hits).toEqual([]);
        });

        it('does not follow a redirect from a public host to loopback', async () => {
            await expect(safeFetch(`http://public.test:${port}/to-loopback`, opts())).rejects.toThrow(/private|reserved/i);
            expect(hits).toEqual(['/to-loopback']);
        });

        it('does not follow a redirect to the cloud metadata endpoint or an internal name', async () => {
            await expect(safeFetch(`http://public.test:${port}/to-metadata`, opts())).rejects.toThrow(/private|reserved/i);
            await expect(safeFetch(`http://public.test:${port}/to-internal-name`, opts())).rejects.toThrow(/private|reserved|internal/i);
            expect(hits).toEqual(['/to-metadata', '/to-internal-name']);
        });

        it('follows a relative redirect on the same validated host', async () => {
            const page = await safeFetch(`http://public.test:${port}/relative`, opts());
            expect(page.status).toBe(200);
            expect(page.body).toContain('landed');
            expect(page.url).toBe(`http://public.test:${port}/landed`);
            expect(hits).toEqual(['/relative', '/landed']);
        });

        it('stops after the redirect cap', async () => {
            await expect(safeFetch(`http://public.test:${port}/loop/0`, opts())).rejects.toThrow(/redirect/i);
            expect(hits.length).toBeLessThanOrEqual(6);
        });

        it('aborts the stream once the body exceeds the size cap', async () => {
            await expect(safeFetch(`http://public.test:${port}/big`, { ...opts(), maxBytes: 200 * 1024 })).rejects.toThrow(/size|large|bytes/i);
        });

        it('gives up when the total time budget is spent', async () => {
            const started = Date.now();
            await expect(safeFetch(`http://public.test:${port}/slow`, { ...opts(), timeoutMs: 300 })).rejects.toThrow(/time/i);
            expect(Date.now() - started).toBeLessThan(2500);
        });
    });

    it('the task-input and URL-extraction rules share the same list', () => {
        ['http://169.254.169.254/latest/meta-data/', 'http://172.20.0.1/', 'http://100.64.1.1/', 'http://[::1]:4000/', 'http://[fe80::1]/',
         'http://0.0.0.0:4000/', 'http://printer.local/', 'http://vault.internal/', 'http://127.1/', 'http://2130706433/'].forEach((url) => {
            expect([url, inputsOf({ TaskName: `Review ${url}` }).publicUrl]).toEqual([url, null]);
            expect([url, extractUrl(`Review ${url}`)]).toEqual([url, null]);
        });
        expect(inputsOf({ TaskName: 'Review https://example.com/pricing' }).publicUrl).toBe('https://example.com/pricing');
        expect(extractUrl('Review https://example.com/pricing')).toBe('https://example.com/pricing');
    });
});
