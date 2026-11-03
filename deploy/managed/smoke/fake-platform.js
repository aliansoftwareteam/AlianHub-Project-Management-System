#!/usr/bin/env node
'use strict';

/* Stands in for the AlianHub Cloud control plane in the managed smoke test: it holds the Ed25519
 * key that signs entitlements (architecture §9) and nothing else.
 *
 *   node fake-platform.js --port 7070 --public-key-out <file>
 *   POST /sign/<instanceId>  body: fields to override  → { token, payload }
 *   GET  /api/v1/instances/<instanceId>/entitlements    → { token } (the instance's pull fallback) */

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');

const KID = 'smoke-1';
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const issued = new Map();

const b64url = (value) => Buffer.from(value).toString('base64url');

function sign(payload) {
    const input = `${b64url(JSON.stringify({ alg: 'EdDSA', kid: KID, typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}`;
    return `${input}.${b64url(crypto.sign(null, Buffer.from(input), privateKey))}`;
}

function entitlements(instanceId, overrides = {}) {
    const previous = issued.get(instanceId);
    return {
        instanceId,
        version: (previous ? previous.payload.version : 0) + 1,
        issuedAt: new Date().toISOString(),
        plan: 'starter',
        lifecycle: 'active',
        limits: { seats: 10, guests: null, workspaces: 1, storageBytes: 10 * 1024 ** 3, maxFileBytes: 100 * 1024 ** 2, emailsPerDay: 500 },
        features: { timeTracker: { enabled: false, seats: 0 }, customDomain: false, ownSmtp: false, sso: false },
        graceUntil: null,
        portalUrl: `https://account.alianhub.test/i/${instanceId}`,
        ...overrides
    };
}

function answer(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
}

function handle(req, res) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c)).on('end', () => {
        const signMatch = /^\/sign\/(ins_[a-z0-9]+)$/.exec(req.url);
        const pullMatch = /^\/api\/v1\/instances\/(ins_[a-z0-9]+)\/entitlements$/.exec(req.url);
        if (req.method === 'POST' && signMatch) {
            let overrides = {};
            try {
                overrides = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
            } catch {
                return answer(res, 400, { error: 'body is not JSON' });
            }
            const payload = entitlements(signMatch[1], overrides);
            const token = sign(payload);
            issued.set(signMatch[1], { payload, token });
            return answer(res, 200, { token, payload });
        }
        if (req.method === 'GET' && pullMatch) {
            const last = issued.get(pullMatch[1]);
            return last ? answer(res, 200, { token: last.token }) : answer(res, 404, { error: 'nothing issued' });
        }
        return answer(res, 404, { error: 'not found' });
    });
}

function main(argv) {
    const port = Number(argv[argv.indexOf('--port') + 1]) || 7070;
    const keyOut = argv.includes('--public-key-out') ? argv[argv.indexOf('--public-key-out') + 1] : null;
    const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    if (keyOut) fs.writeFileSync(keyOut, `${spki}\n`);
    http.createServer(handle).listen(port, '127.0.0.1', () => process.stdout.write(`fake platform on 127.0.0.1:${port}\n`));
}

if (require.main === module) main(process.argv);

module.exports = { sign, entitlements, publicKey };
