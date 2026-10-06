const rateLimit = require('express-rate-limit');
const ctrl = require('./controller');
const publicForm = require('./publicForm');
const formUpload = require('./helpers/formUpload');

// The public form is unauthenticated, so cap it by IP: reading is cheap but
// scriptable, and every submission writes a task. Matched to the public-share
// limits rather than invented.
const publicReadLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
const publicWriteLimiter = rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

exports.init = (app) => {
    // Authenticated form management. Guarded as a prefix in setMiddleware, which
    // is what puts req.uid on the request — the handlers take the author from
    // there and never from the body.
    //
    // /fields is declared before /:id so it is not read as a form id.
    app.get('/api/v2/forms/fields', ctrl.listBindableFields);
    app.post('/api/v2/forms/:id/publish', ctrl.publishForm);
    app.get('/api/v2/forms/:id/submissions', ctrl.listSubmissions);
    app.get('/api/v2/forms/:id', ctrl.getForm);
    app.put('/api/v2/forms/:id', ctrl.updateForm);
    app.delete('/api/v2/forms/:id', ctrl.deleteForm);
    app.get('/api/v2/forms', ctrl.listForms);
    app.post('/api/v2/forms', ctrl.createForm);

    // PUBLIC — server-rendered, no login. Deliberately NOT under /api/v2/forms:
    // that prefix requires a token, and these must not.
    app.get('/form/:token', publicReadLimiter, publicForm.renderForm);
    // formUpload.parse is a pass-through for a non-multipart post, so a form
    // with no file question is unaffected by it.
    app.post('/form/:token', publicWriteLimiter, formUpload.parse, publicForm.submitForm);
}
