/* The consent screen and per-workspace client approval are slice S3. Until then an authorization can only
 * complete here, and only in a test process: NODE_ENV is read on every request, nothing else turns it on,
 * and tests/conventions/oauth-test-consent.test.js holds both to that. */

const TEST_CONSENT_HEADER = 'x-oauth-test-consent';

const testConsentEnabled = () => process.env.NODE_ENV === 'test';

/* Answers { userId, companyId, approved } for a signed-in member who said yes or no, or null to fall
 * through to "consent not available". The session check is the app's own: bearer JWT, companyid header,
 * live membership. An API token is not a person consenting. */
const testConsent = (req, res) => new Promise((resolve) => {
    if (!testConsentEnabled()) return resolve(null);
    const answer = String(req.headers[TEST_CONSENT_HEADER] || '');
    if (answer !== 'approve' && answer !== 'deny') return resolve(null);
    // The session check answers a refusal itself, sometimes after its own promise has settled.
    res.once('finish', () => resolve({ answered: true }));
    const { verifyJWTTokenWithCV2 } = require('../../Config/jwt');
    return Promise.resolve(verifyJWTTokenWithCV2(req, res, () => {
        if (req.apiToken || !req.uid) {
            res.status(403).json({ error: 'access_denied', error_description: 'an API token cannot consent' });
            return;
        }
        resolve({ userId: String(req.uid), companyId: String(req.headers.companyid), approved: answer === 'approve' });
    })).catch(() => {
        if (!res.headersSent) res.status(401).json({ error: 'access_denied', error_description: 'not signed in' });
    });
});

module.exports = { testConsent, testConsentEnabled, TEST_CONSENT_HEADER };
