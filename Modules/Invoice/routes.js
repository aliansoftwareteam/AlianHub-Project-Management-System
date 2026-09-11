const ctrl = require('./controller');
const projectInvoices = require('./controller/projectInvoices');
const { requireInstanceAdmin } = require('../Instance/guard');

exports.init = (app) => {
    // No code records which company a subscription invoice belongs to, so the collection cannot be tenant-scoped.
    app.post('/api/v1/invoice/find', requireInstanceAdmin, ctrl.getInvoice);

    // Client invoices raised against a project (handoff 19c).
    app.get('/api/v2/invoices', projectInvoices.listInvoices);
    app.post('/api/v2/invoices/draft-from-milestone', projectInvoices.draftFromMilestone);
    app.post('/api/v2/invoices/draft-from-month', projectInvoices.draftFromMonth);
    app.get('/api/v2/invoices/:id', projectInvoices.getInvoice);
    app.put('/api/v2/invoices/:id', projectInvoices.updateInvoice);
    app.post('/api/v2/invoices/:id/send', projectInvoices.sendInvoice);
    app.post('/api/v2/invoices/:id/paid', projectInvoices.markInvoicePaid);
    app.delete('/api/v2/invoices/:id', projectInvoices.deleteInvoice);
}
