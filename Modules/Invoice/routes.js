const ctrl = require('./controller');
const projectInvoices = require('./controller/projectInvoices');

exports.init = (app) => {
    app.post('/api/v1/invoice/find', ctrl.getInvoice);

    // Client invoices raised against a project (handoff 19c).
    app.get('/api/v2/invoices', projectInvoices.listInvoices);
    app.post('/api/v2/invoices/draft-from-milestone', projectInvoices.draftFromMilestone);
    app.post('/api/v2/invoices/draft-from-month', projectInvoices.draftFromMonth);
    app.get('/api/v2/invoices/:id', projectInvoices.getInvoice);
    app.put('/api/v2/invoices/:id', projectInvoices.updateInvoice);
    app.post('/api/v2/invoices/:id/send', projectInvoices.sendInvoice);
    app.post('/api/v2/invoices/:id/paid', projectInvoices.markInvoicePaid);
}
