const WRITABLE_KEYS = {
    root: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITLAB_CLIENT_ID', 'GITLAB_CLIENT_SECRET'],
    frontend: ['VUE_APP_GOOGLE_CLIENT_ID', 'VUE_APP_GITHUB_CLIENT_ID', 'VUE_APP_GITLAB_CLIENT_ID', 'VUE_APP_IS_GOOGLE_LOGIN', 'VUE_APP_IS_GITHUB_LOGIN', 'VUE_APP_IS_GITLAB_LOGIN'],
};
const BOOLEAN_KEYS = ['VUE_APP_IS_GOOGLE_LOGIN', 'VUE_APP_IS_GITHUB_LOGIN', 'VUE_APP_IS_GITLAB_LOGIN'];
const MAX_VALUE_LENGTH = 512;
// The value is written inside double quotes in a .env file: a quote, backslash, `$`,
// whitespace or newline would let a caller close the value and inject another variable.
const SAFE_VALUE = /^[A-Za-z0-9._~+/=:@-]*$/;

const fail = (error) => ({ ok: false, error });

function validateOAuthUpdate(pathType, variables) {
    const allowed = WRITABLE_KEYS[pathType];
    if (!allowed) return fail(`pathType must be one of: ${Object.keys(WRITABLE_KEYS).join(', ')}.`);
    if (!Array.isArray(variables) || variables.length === 0) return fail('variables must be a non-empty array.');
    if (variables.length > allowed.length) return fail('Too many variables.');

    const seen = new Set();
    const clean = [];
    for (const entry of variables) {
        const name = entry && entry.variableName;
        if (typeof name !== 'string' || !allowed.includes(name)) return fail(`${String(name)} cannot be changed here.`);
        if (seen.has(name)) return fail(`${name} is listed twice.`);
        seen.add(name);

        let value = entry.variableValue;
        if (BOOLEAN_KEYS.includes(name)) {
            if (value === true || value === 'true') value = 'true';
            else if (value === false || value === 'false') value = 'false';
            else return fail(`${name} must be true or false.`);
        }
        if (typeof value !== 'string') return fail(`${name} must be a string.`);
        if (value.length > MAX_VALUE_LENGTH) return fail(`${name} is too long.`);
        if (!SAFE_VALUE.test(value)) return fail(`${name} contains characters that are not allowed.`);
        clean.push({ variableName: name, variableValue: value });
    }
    return { ok: true, variables: clean };
}

function maskOAuthCred(backendEnv = {}, frontendEnv = {}) {
    return {
        clientId: backendEnv.GOOGLE_CLIENT_ID || '',
        clientSecretSet: Boolean(backendEnv.GOOGLE_CLIENT_SECRET),
        isGoogleLogin: frontendEnv.VUE_APP_IS_GOOGLE_LOGIN === 'true',
        githubClientId: backendEnv.GITHUB_CLIENT_ID || '',
        githubClientSecretSet: Boolean(backendEnv.GITHUB_CLIENT_SECRET),
        isGithubLogin: frontendEnv.VUE_APP_IS_GITHUB_LOGIN === 'true',
        gitlabClientId: backendEnv.GITLAB_CLIENT_ID || '',
        gitlabClientSecretSet: Boolean(backendEnv.GITLAB_CLIENT_SECRET),
        isGitlabLogin: frontendEnv.VUE_APP_IS_GITLAB_LOGIN === 'true',
    };
}

module.exports = { WRITABLE_KEYS, validateOAuthUpdate, maskOAuthCred };
