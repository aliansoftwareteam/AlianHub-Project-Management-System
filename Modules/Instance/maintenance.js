const { state } = require('../../Config/instanceState');

/* Pure: while a restore runs, every API call is refused except the health probe
 * and the console driving the restore; static files and the SPA still load so the
 * banner can show. */
function shouldBlock(path, maintenance = state.maintenance) {
    if (!maintenance) return false;
    if (!path.startsWith('/api/')) return false;
    if (path === '/api/health' || path.startsWith('/api/v2/instance')) return false;
    return true;
}

const maintenanceGuard = (req, res, next) => (shouldBlock(req.path)
    ? res.status(503).send({ status: false, statusText: 'Maintenance in progress. Try again in a few minutes.', maintenance: true })
    : next());

module.exports = { shouldBlock, maintenanceGuard };
