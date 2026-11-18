const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('../e2e/support/server');

jest.setTimeout(60000);

const STAND_IN = path.join('tests', 'fixtures', 'harnessStandInServer.js');
const scratchDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-port-'));
const listen = (server) => new Promise((resolve) => server.listen(0, () => resolve(server.address().port)));

test('a port taken between pick and start moves the server to a fresh port, not onto the squatter', async () => {
    const squatter = http.createServer((req, res) => { res.writeHead(200); res.end('squatter'); });
    const taken = await listen(squatter);
    const server = await startServer({ mongoUrl: 'mongodb://127.0.0.1:9', logFile: path.join(scratchDir(), 'server.log'), port: taken, entry: STAND_IN });
    try {
        expect(server.port).not.toBe(taken);
        const res = await fetch(`${server.baseURL}/health`);
        expect(await res.text()).toBe('stand-in');
    } finally {
        await server.stop();
        await new Promise((resolve) => squatter.close(resolve));
    }
});

test('a server that dies for another reason is reported, not retried', async () => {
    const dir = scratchDir();
    const entry = path.join(dir, 'crash.js');
    fs.writeFileSync(entry, 'process.exit(3);\n');
    await expect(startServer({ mongoUrl: 'mongodb://127.0.0.1:9', logFile: path.join(dir, 'server.log'), entry })).rejects.toThrow(/exited with code 3/);
});
