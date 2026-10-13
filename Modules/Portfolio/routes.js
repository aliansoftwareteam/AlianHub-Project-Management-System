const ctrl = require('./controller');
const { agentsRefused } = require('../Agents/guard');

exports.init = (app) => {
    // JWT + companyId enforced in setMiddleware (prefix /api/v1/portfolio).
    app.post('/api/v1/portfolio', agentsRefused('portfolio.edit'), ctrl.createPortfolio);
    app.get('/api/v1/portfolio', ctrl.listPortfolios);
    // Registered before the bare ':id' routes so "rollup" / "summary" aren't swallowed.
    app.post('/api/v1/portfolio/summary', agentsRefused('ai.spend'), ctrl.getPortfolioSummary);
    app.get('/api/v1/portfolio/:id/rollup', ctrl.getRollup);
    app.put('/api/v1/portfolio/:id', agentsRefused('portfolio.edit'), ctrl.updatePortfolio);
    app.delete('/api/v1/portfolio/:id', ctrl.deletePortfolio);
};
