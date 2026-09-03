const { wantsSpa, spaFallback } = require('../Config/spaFallback');

const req = (path, { method = 'GET', html = true } = {}) => ({ method, path, accepts: (t) => (t === 'html' ? html : false) });

describe('SPA fallback — deep links and hard refreshes', () => {
    it('serves client routes a browser asks for as a page', () => {
        expect(wantsSpa(req('/6a8ee973d625fca52e519a12'))).toBe(true);
        expect(wantsSpa(req('/6a8ee973d625fca52e519a12/settings/notifications'))).toBe(true);
        expect(wantsSpa(req('/login'))).toBe(true);
    });

    it('never swallows the API, MCP, SCIM, sockets or the health check', () => {
        for (const p of ['/api/v2/tasks', '/api/v1/project/x', '/mcp', '/mcp/manifest', '/scim/v2/Users', '/socket.io/?EIO=4', '/health']) {
            expect(wantsSpa(req(p))).toBe(false);
        }
    });

    it('lets a missing asset 404 instead of answering with HTML', () => {
        expect(wantsSpa(req('/js/app.deadbeef.js'))).toBe(false);
        expect(wantsSpa(req('/img/logo.png'))).toBe(false);
    });

    it('only answers GETs that want HTML', () => {
        expect(wantsSpa(req('/x', { method: 'POST' }))).toBe(false);
        expect(wantsSpa(req('/x', { html: false }))).toBe(false);
    });

    it('as middleware, sends the file or passes through', () => {
        const mw = spaFallback('/dist/index.html');
        const res = { sendFile: jest.fn() }; const next = jest.fn();
        mw(req('/cid/planner'), res, next);
        expect(res.sendFile).toHaveBeenCalledWith('/dist/index.html');
        expect(next).not.toHaveBeenCalled();
        mw(req('/api/v2/x'), res, next);
        expect(next).toHaveBeenCalledTimes(1);
    });
});
