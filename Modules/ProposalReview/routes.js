const ctrl = require('./controller');

exports.init = (app) => {
    // Start a proposal-review job for one project + sprint. Returns { reviewId }.
    app.post('/api/v1/proposal-review', ctrl.start);

    // Emergency stop — cancel a running job by id.
    app.post('/api/v1/proposal-review/stop', ctrl.stop);

    // SSE progress stream. Unauthenticated by design (EventSource cannot send
    // headers); the random 24-char reviewId acts as a bearer capability. Path is
    // intentionally a distinct prefix ("proposal-review-progress") so it is
    // never confused with the POST endpoints above.
    app.get('/api/v1/proposal-review-progress/:reviewId', ctrl.events);
};
