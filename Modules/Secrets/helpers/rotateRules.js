const R = require('../../Integrations/helpers/integrationsRules');
const { fieldOfHandle } = require('../../Integrations/helpers/secretHandles');

/* A value typed into the rotate form gets the check its kind gets where it is first saved: the integration
 * catalogue's format for that field (which is also what keeps a Teams or Zapier hook on a public https host),
 * and for a webhook the strength of the secret the server would have generated. */

const WEBHOOK_SECRET = /^[\x21-\x7e]{32,256}$/;

async function rotateProblem({ companyId, secret, value }) {
    const text = String(value).trim();
    if (secret.kind === 'webhook') {
        return WEBHOOK_SECRET.test(text) ? null : { statusCode: 400, message: 'A webhook signing secret must be 32 to 256 characters with no spaces.' };
    }
    if (secret.kind !== 'integration') return null;
    const field = await fieldOfHandle({ companyId, handle: secret.handle });
    if (!field) return { statusCode: 409, message: 'No connected integration uses this secret, so it cannot be rotated. Revoke it instead.' };
    const problem = R.secretFieldProblem(field.type, field.key, text);
    return problem ? { statusCode: 400, message: problem } : null;
}

module.exports = { rotateProblem };
