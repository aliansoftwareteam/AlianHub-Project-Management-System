const fs = require('fs');

const HOW = 'Set ATLAS_TOKEN to a session token, or ATLAS_TOKEN_FILE (or --token-file) to a file that holds one. '
    + 'For a demo account: npm run -s demo:token -- --email <demo email> (docs/QA-DEMO-TEAM.md).';

function readToken({ env = process.env, tokenFile = null, readFile = fs.readFileSync } = {}) {
    const inline = String(env.ATLAS_TOKEN || '').trim();
    if (inline) return inline;
    const file = tokenFile || env.ATLAS_TOKEN_FILE;
    if (!file) throw new Error(`No session. ${HOW}`);
    const fromFile = String(readFile(file, 'utf8')).trim();
    if (!fromFile) throw new Error(`The token file is empty. ${HOW}`);
    return fromFile;
}

// The app keeps the signed-in user's id beside the cookie, and the token already names that user.
function userIdOf(token) {
    try {
        const claims = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
        if (claims && claims.uid) return String(claims.uid);
    } catch {}
    throw new Error('That is not a session token for a user: it names no user id.');
}

module.exports = { readToken, userIdOf };
