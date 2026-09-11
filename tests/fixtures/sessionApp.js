// Spins up an express app behind the real JWT middleware lists, and signs web sessions the
// way login does, with the session row and company membership pre-seeded in the cache so the
// middleware never needs a database.
const express = require('express');
const jwt = require('jsonwebtoken');
const { myCache } = require('../../Config/config');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret';
process.env.JWT_ALGORITHM = process.env.JWT_ALGORITHM || 'HS256';
process.env.JWT_EXP = process.env.JWT_EXP || '1h';

function signSession(uid, companyIds = []) {
    const options = { algorithm: 'HS256', expiresIn: '1h' };
    const refreshToken = jwt.sign({}, process.env.JWT_SECRET, options);
    const token = jwt.sign({ uid, refreshToken }, process.env.JWT_SECRET, companyIds.length ? { ...options, audience: companyIds.join(',') } : options);
    myCache.set(`session:${uid}:${refreshToken}`, JSON.stringify({ userId: uid, refreshToken }), 600);
    companyIds.forEach((companyId) => myCache.set(`membership:${uid}:${companyId}`, true, 600));
    return token;
}

async function startApp(configure) {
    const app = express();
    app.use(express.json());
    configure(app);
    const server = await new Promise((resolve) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    // fetch reuses keep-alive sockets; on a loaded runner the default 5s idle close races it into ECONNRESET.
    server.keepAliveTimeout = 60000;
    const baseURL = `http://127.0.0.1:${server.address().port}`;

    const call = async (method, path, { token, companyId, body } = {}) => {
        const headers = {};
        if (token) headers.authorization = `Bearer ${token}`;
        if (companyId) headers.companyid = companyId;
        if (body !== undefined) headers['content-type'] = 'application/json';
        const res = await fetch(baseURL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        const text = await res.text();
        let parsed = text;
        try {
            parsed = text ? JSON.parse(text) : null;
        } catch {}
        return { status: res.status, body: parsed };
    };

    return { call, close: () => new Promise((resolve) => server.close(resolve)) };
}

module.exports = { signSession, startApp };
