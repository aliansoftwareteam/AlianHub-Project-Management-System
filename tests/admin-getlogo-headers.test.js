const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const express = require('express');
const controller = require('../Modules/Admin/common/controller');

const SANDBOX = "default-src 'none'; sandbox";
const SVG_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

const appWith = (handler) => {
    const app = express();
    app.get('/api/v1/getlogo', handler);
    return app;
};

const get = async (app, url) => {
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
        const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { signal: AbortSignal.timeout(3000) });
        const text = await res.text();
        let body;
        try { body = JSON.parse(text); } catch { body = text; }
        return { status: res.status, headers: Object.fromEntries(res.headers), body };
    } finally {
        server.close();
    }
};

describe('GET /api/v1/getlogo headers', () => {
    const app = appWith(controller.getlogo);

    test('an SVG logo keeps its image type under the sandbox policy, inline', async () => {
        const res = await get(app, '/api/v1/getlogo?key=logo&type=admin');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('image/svg+xml');
        expect(res.headers['content-security-policy']).toBe(SVG_POLICY);
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['content-disposition']).toBeUndefined();
    });

    test('a PNG logo is sandboxed and still inline for <img> and email', async () => {
        const res = await get(app, '/api/v1/getlogo?key=logo&type=emailTemplateLogo');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('image/png');
        expect(res.headers['content-security-policy']).toBe(SANDBOX);
        expect(res.headers['content-disposition']).toBeUndefined();
    });

    test('the request query is left untouched', async () => {
        const seen = [];
        const probe = express();
        probe.get('/api/v1/getlogo', (req, res, next) => {
            const query = req.query;
            res.on('finish', () => seen.push({ ...query }));
            next();
        }, controller.getlogo);
        await get(probe, '/api/v1/getlogo');
        expect(seen).toEqual([{}]);
    });
});

describe('logo folder contents', () => {
    let root;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-'));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('a missing folder answers 404 and the process keeps serving', async () => {
        const app = appWith(controller.createLogoHandler(root));
        const res = await get(app, '/api/v1/getlogo?key=logo&type=admin');
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ status: false });

        fs.mkdirSync(path.join(root, 'admin-logo'));
        fs.writeFileSync(path.join(root, 'admin-logo', 'brand.png'), 'png');
        const again = await get(app, '/api/v1/getlogo?key=logo&type=admin');
        expect(again.status).toBe(200);
    });

    test('dotfiles are never picked as the logo', async () => {
        const folder = path.join(root, 'admin-logo');
        fs.mkdirSync(folder);
        fs.writeFileSync(path.join(folder, 'brand.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
        fs.writeFileSync(path.join(folder, '.gitkeep'), '');
        fs.writeFileSync(path.join(folder, '.DS_Store'), '');
        fs.writeFileSync(path.join(folder, '.zz-hidden'), '');

        const res = await get(appWith(controller.createLogoHandler(root)), '/api/v1/getlogo?key=logo&type=admin');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('image/svg+xml');
        expect(res.headers['content-security-policy']).toBe(SVG_POLICY);
    });

    test('a folder holding only dotfiles answers 404', async () => {
        const folder = path.join(root, 'favicon');
        fs.mkdirSync(folder);
        fs.writeFileSync(path.join(folder, '.gitkeep'), '');
        const res = await get(appWith(controller.createLogoHandler(root)), '/api/v1/getlogo?key=favicon');
        expect(res.status).toBe(404);
    });
});
