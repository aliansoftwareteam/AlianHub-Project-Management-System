// Tests that fail under a moved clock for a reason that is not a bug. Keep this short, give each
// entry its reason, and prefer fixing the test.
module.exports = {
    backend: [
        // tests/fixtures/testCert.js dates its certificate from Date.now(); OpenSSL checks it against the
        // real clock, so under a moved clock the certificate is not yet valid and every https read fails.
        'tests/agent-skill-declared-reads-run\\.test\\.js',
        'tests/agent-skill-read-replay\\.test\\.js'
    ],
    frontend: []
};
