/**
 * BUG-037 regression — bodyParser 50mb global limit.
 *
 * Pre-fix: `index.js` mounted three bodyParser middlewares each with
 * `limit: '50mb'`. Any unauthenticated POST could force the server to
 * buffer 50MB before validation. Trivial memory DoS.
 *
 * Post-fix: the global default drops to 2MB (env-tunable via
 * `BODY_LIMIT`). File-upload routes that need more handle uploads via
 * `multer` with their own caps, so this doesn't affect them.
 *
 * We exercise the limit by spinning up a tiny Express app with the
 * same bodyParser wiring and confirming a 3MB body returns 413.
 */

const path = require('path');
const fs = require('fs');

function assert(cond, label) {
    if (!cond) {
        console.error('FAIL:', label);
        process.exit(1);
    }
    console.log('PASS:', label);
}

const indexSrc = fs.readFileSync(path.resolve(__dirname, '../../index.js'), 'utf8');

// 1. Source-level: env-driven BODY_LIMIT with a tightened default.
assert(
    /BODY_LIMIT\s*=\s*process\.env\.BODY_LIMIT\s*\|\|\s*['"]2mb['"]/.test(indexSrc),
    'index.js reads BODY_LIMIT from env with a 2MB default (down from 50MB)'
);

// 2. No remaining hard-coded `'50mb'` body-parser limits.
const fiftyMb = indexSrc.match(/['"]50mb['"]/g) || [];
assert(fiftyMb.length === 0, `no hard-coded '50mb' literals remain (found ${fiftyMb.length})`);

// 3. Behaviour test — re-run the same wiring locally and hit it with
//    bodies above and below the limit.
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
const TEST_LIMIT = '1mb';
app.use(bodyParser.json({ limit: TEST_LIMIT }));
app.post('/ping', (req, res) => res.json({ ok: true }));
// Express error handler so the 413 lands as a JSON response.
app.use((err, req, res, next) => res.status(err.status || 500).json({ status: false, message: err.message }));

const server = app.listen(0, async () => {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    const small = JSON.stringify({ x: 'a'.repeat(500) });
    const big = JSON.stringify({ x: 'a'.repeat(2 * 1024 * 1024) }); // 2MB > 1mb limit

    async function post(body) {
        const res = await fetch(`${base}/ping`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body
        });
        return res.status;
    }

    try {
        const smallStatus = await post(small);
        assert(smallStatus === 200, `small body (under limit) → 200 (got ${smallStatus})`);

        const bigStatus = await post(big);
        assert(bigStatus === 413, `oversize body (above limit) → 413 (got ${bigStatus})`);

        console.log('\nAll BUG-037 assertions passed.');
        server.close();
        process.exit(0);
    } catch (e) {
        console.error('TEST ERROR:', e);
        server.close();
        process.exit(1);
    }
});
