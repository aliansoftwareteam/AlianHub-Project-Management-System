const http = require('node:http');

/* A stand-in for GitLab's GET /api/v4/user, so social sign-in runs end to end without a network.
 * The access token carries the identity it stands for; anything else is refused as GitLab would. */

const TOKEN_PREFIX = 'e2e-gitlab.';

function gitlabToken({ id, email = null, confirmed = true }) {
    const identity = { id, email, confirmed };
    return `${TOKEN_PREFIX}${Buffer.from(JSON.stringify(identity)).toString('base64url')}`;
}

function identityOf(authorization) {
    const token = String(authorization || '').replace(/^Bearer\s+/i, '');
    if (!token.startsWith(TOKEN_PREFIX)) return null;
    try {
        return JSON.parse(Buffer.from(token.slice(TOKEN_PREFIX.length), 'base64url').toString('utf8'));
    } catch {
        return null;
    }
}

function answer(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
}

function handle(req, res) {
    if (req.method !== 'GET' || req.url !== '/api/v4/user') return answer(res, 404, { message: '404 Not Found' });
    const identity = identityOf(req.headers.authorization);
    if (!identity) return answer(res, 401, { message: '401 Unauthorized' });
    return answer(res, 200, {
        id: identity.id,
        username: `user${identity.id}`,
        name: `User ${identity.id}`,
        state: 'active',
        email: identity.email || undefined,
        confirmed_at: identity.email && identity.confirmed ? '2024-01-01T00:00:00.000Z' : null,
    });
}

function startGitlabStub() {
    return new Promise((resolve, reject) => {
        const server = http.createServer(handle);
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({
                url: `http://127.0.0.1:${port}/api/v4`,
                stop: () => new Promise((done) => server.close(() => done())),
            });
        });
    });
}

module.exports = { gitlabToken, startGitlabStub };
