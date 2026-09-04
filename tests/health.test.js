const { summarizeHealth, checkDb, withTimeout } = require('../Modules/Instance/health');
const { version } = require('../package.json');

describe('/health — what a load balancer and an operator read from it', () => {
    it('is 200 ok when the database answers', () => {
        const { httpStatus, body } = summarizeHealth({ db: { ok: true, latencyMs: 4 } });
        expect(httpStatus).toBe(200);
        expect(body).toMatchObject({ status: 'ok', version, db: { ok: true, latencyMs: 4, error: null }, migrationsPending: 0, migrationError: null, maintenance: false });
        expect(typeof body.uptimeSeconds).toBe('number');
    });

    it('is 503 degraded when the database is down, and says why', () => {
        const { httpStatus, body } = summarizeHealth({ db: { ok: false, error: 'connect ECONNREFUSED' } });
        expect(httpStatus).toBe(503);
        expect(body.status).toBe('degraded');
        expect(body.db).toEqual({ ok: false, latencyMs: null, error: 'connect ECONNREFUSED' });
    });

    it('surfaces pending migrations and maintenance without failing the probe', () => {
        const { httpStatus, body } = summarizeHealth({ db: { ok: true }, migrationsPending: 2, migrationError: new Error('boom'), maintenance: true });
        expect(httpStatus).toBe(200);
        expect(body).toMatchObject({ migrationsPending: 2, migrationError: 'Error: boom', maintenance: true });
    });

    it('answers without a database URL instead of hanging', async () => {
        const saved = process.env.MONGODB_URL;
        delete process.env.MONGODB_URL;
        try {
            await expect(checkDb()).resolves.toEqual({ ok: false, error: 'MONGODB_URL is not set' });
        } finally {
            if (saved !== undefined) process.env.MONGODB_URL = saved;
        }
    });

    it('bounds a probe that never resolves', async () => {
        await expect(withTimeout(new Promise(() => {}), 10, 'probe')).rejects.toThrow('probe timed out after 10ms');
    });
});
