const ctrl = require('./controller');
const projectInvoices = require('./controller/projectInvoices');
const { requireInstanceAdmin } = require('../Instance/guard');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { READ, requireProjectAccess, projectIdsFrom } = require('../../Config/projectAccess');

/* An invoice is its project's: it is read and changed by a person who can open that project, read off the stored invoice. */
const ofInvoice = projectIdsFrom({ records: [[SCHEMA_TYPE.PROJECT_INVOICES, (req) => req.params.id]] });
const readsProject = (projectIds) => requireProjectAccess({ mode: READ, projectIds });
const changesProject = (projectIds) => requireProjectAccess({ projectIds, passMissing: () => true });

exports.init = (app) => {
    // No code records which company a subscription invoice belongs to, so the collection cannot be tenant-scoped.
    app.post('/api/v1/invoice/find', requireInstanceAdmin, ctrl.getInvoice);

    // Client invoices raised against a project (handoff 19c).
    app.get('/api/v2/invoices', readsProject((req) => req.query && req.query.projectId), projectInvoices.listInvoices);
    app.post('/api/v2/invoices/draft-from-milestone', changesProject((req) => req.body && req.body.projectId), projectInvoices.draftFromMilestone);
    app.post('/api/v2/invoices/draft-from-month', changesProject((req) => req.body && req.body.projectId), projectInvoices.draftFromMonth);
    app.get('/api/v2/invoices/:id', readsProject(ofInvoice), projectInvoices.getInvoice);
    app.put('/api/v2/invoices/:id', changesProject(ofInvoice), projectInvoices.updateInvoice);
    app.post('/api/v2/invoices/:id/send', changesProject(ofInvoice), projectInvoices.sendInvoice);
    app.post('/api/v2/invoices/:id/paid', changesProject(ofInvoice), projectInvoices.markInvoicePaid);
    app.delete('/api/v2/invoices/:id', changesProject(ofInvoice), projectInvoices.deleteInvoice);
}
