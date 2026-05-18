const ctrl = require('./controller');

exports.init = (app) => {
    // Read the caller's company retention setting + last-run stats.
    // Visible to any authenticated user in the company so we can render a
    // disabled/read-only state for non-owners; mutation endpoints below
    // enforce the owner check.
    app.get('/api/v1/screenshot-retention', ctrl.getSettings);

    // Preview how many trackshots would be deleted at a given retention
    // window. Used by the "are you sure?" dialog before flipping the toggle
    // on. Owner-only.
    app.get('/api/v1/screenshot-retention/preview', ctrl.previewDeletion);

    // Update the policy (enabled flag and/or maxAgeMonths). Owner-only.
    app.put('/api/v1/screenshot-retention', ctrl.updateSettings);
};
