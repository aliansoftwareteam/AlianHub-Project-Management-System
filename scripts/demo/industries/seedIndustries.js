#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT } = require('../lib/env');
const { parseArgs, run } = require('../lib/cli');
const { assertTarget, emailFor } = require('./lib/guard');
const { SCENARIOS } = require('./scenarios');

const CREDENTIALS_PATH = path.join(ROOT, '.demo-industries.local.json');
const DEFAULT_OWNER = { firstName: 'Demo', lastName: 'Visitor', domain: 'industries' };
const FILE_MODE = 0o600;

const out = (line = '') => process.stdout.write(`${line}\n`);

const chosen = (only) => {
    if (!only || only === true) return SCENARIOS;
    const keys = String(only).split(',').map((key) => key.trim()).filter(Boolean);
    const unknown = keys.filter((key) => !SCENARIOS.some((scenario) => scenario.key === key));
    if (unknown.length) throw new Error(`Unknown industry: ${unknown.join(', ')}. Known: ${SCENARIOS.map((s) => s.key).join(', ')}.`);
    return SCENARIOS.filter((scenario) => keys.includes(scenario.key));
};

/* The parts a company built while a flag was off lacks now that the flag is on. */
const missingLayers = (layers = {}, features) => [
    features.dispatcher && !layers.dispatcher ? 'the dispatcher' : '',
    features.dispatcher && features.workflows && !layers.workflows ? 'the workflows' : '',
].filter(Boolean);

const saveCredentials = (entry) => {
    if (fs.existsSync(CREDENTIALS_PATH)) fs.chmodSync(CREDENTIALS_PATH, FILE_MODE);
    fs.writeFileSync(CREDENTIALS_PATH, `${JSON.stringify(entry, null, 2)}\n`, { mode: FILE_MODE });
};

/* The account every demo company belongs to: --owner, else DEMO_EMAIL, else one the command makes. */
async function resolveOwner(adapter, args) {
    const email = String(args.owner || process.env.DEMO_EMAIL || emailFor(DEFAULT_OWNER.domain, DEFAULT_OWNER)).trim().toLowerCase();
    const existing = await adapter.findUserByEmail(email);
    if (existing) return { userId: String(existing._id), email, name: existing.Employee_Name || email, created: false };
    const password = process.env.DEMO_EMAIL && email === String(process.env.DEMO_EMAIL).trim().toLowerCase() && process.env.DEMO_PASSWORD
        ? process.env.DEMO_PASSWORD
        : crypto.randomBytes(12).toString('base64url');
    const { firstName, lastName } = DEFAULT_OWNER;
    const userId = await adapter.createUser({ firstName, lastName, email, password });
    // A visitor lands on the industry, not on the workspace set-up checklist.
    await adapter.dismissChecklist(userId);
    if (password !== process.env.DEMO_PASSWORD) saveCredentials({ email, password, note: 'The demo account npm run demo:industries made. Sign in with it at the normal login screen.' });
    return { userId, email, name: `${firstName} ${lastName}`, created: true };
}

run(async () => {
    const argv = process.argv.slice(2);
    assertTarget(process.env, argv);
    const args = parseArgs(argv);
    const scenarios = chosen(args.only);

    if (args.list) {
        out('');
        SCENARIOS.forEach((scenario) => out(`  ${scenario.key.padEnd(12)} ${scenario.company.name.padEnd(22)} ${scenario.industry}`));
        out('');
        return;
    }

    const adapter = require('./lib/adapter');
    const { buildShowcase, findShowcaseCompanies } = require('./lib/build');
    const { dropShowcase } = require('./lib/drop');
    const keys = new Set(scenarios.map((scenario) => scenario.key));
    const existing = (await findShowcaseCompanies(adapter)).filter((company) => keys.has(company.demoShowcase.key));

    if (args.drop || args.reset) {
        for (const company of existing) {
            const result = await dropShowcase({ companyId: company._id, adapter });
            out(`Removed ${result.name} (${result.companyId}): ${Object.entries(result.removed).map(([what, n]) => `${what} ${n}`).join(', ')}`);
        }
        if (args.drop) return;
    }

    const owner = await resolveOwner(adapter, args);
    const present = args.reset ? [] : existing;
    const built = [];
    for (const scenario of scenarios) {
        const have = present.find((company) => company.demoShowcase.key === scenario.key);
        if (have && have.demoShowcase.guidePageId) {
            const missing = missingLayers(have.demoShowcase.layers, adapter.features());
            out(`${scenario.company.name} is already here (${have._id}); --reset rebuilds it${missing.length ? ` and adds ${missing.join(' and ')}` : ''}.`);
            continue;
        }
        // A company without its guide stopped halfway through an earlier run.
        if (have) await dropShowcase({ companyId: have._id, adapter });
        const result = await buildShowcase({ scenario, owner, adapter, log: out });
        built.push({ scenario, ...result });
    }

    out('');
    out(`Demo account: ${owner.email}${owner.created ? ` (made now; password in ${path.relative(ROOT, CREDENTIALS_PATH)} unless it is DEMO_PASSWORD)` : ''}`);
    built.forEach(({ scenario, companyId }) => out(`  ${scenario.company.name.padEnd(22)} ${companyId}`));
    out('Restart a running server so it reads the new members.');
    out('');
});
