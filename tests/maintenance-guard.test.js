const { shouldBlock, maintenanceGuard } = require('../Modules/Instance/maintenance');
const { state } = require('../Config/instanceState');

describe('maintenance mode', () => {
    afterEach(() => { state.maintenance = false; });

    it('blocks nothing while off', () => {
        for (const p of ['/api/v2/tasks', '/api/v1/project/x', '/health', '/']) expect(shouldBlock(p, false)).toBe(false);
    });

    it('while on, refuses the API but keeps the health probe, the console and the SPA reachable', () => {
        expect(shouldBlock('/api/v2/tasks', true)).toBe(true);
        expect(shouldBlock('/api/v1/project/x', true)).toBe(true);
        expect(shouldBlock('/api/v2/instance/backups/x/restore', true)).toBe(false);
        expect(shouldBlock('/api/v2/instance/health', true)).toBe(false);
        expect(shouldBlock('/health', true)).toBe(false);
        expect(shouldBlock('/', true)).toBe(false);
        expect(shouldBlock('/js/app.js', true)).toBe(false);
    });

    it('answers 503 JSON with a maintenance flag the banner can read', () => {
        state.maintenance = true;
        const res = { status: jest.fn().mockReturnThis(), send: jest.fn() };
        const next = jest.fn();
        maintenanceGuard({ path: '/api/v2/tasks' }, res, next);
        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.send).toHaveBeenCalledWith(expect.objectContaining({ status: false, maintenance: true }));
        expect(next).not.toHaveBeenCalled();
        maintenanceGuard({ path: '/health' }, res, next);
        expect(next).toHaveBeenCalledTimes(1);
    });
});
