const { ACCOUNTS_PATH } = require('./lib/env');
const { assertLocalTarget } = require('./lib/guard');
const { parseArgs, run } = require('./lib/cli');

run(async () => {
    const argv = process.argv.slice(2);
    assertLocalTarget(process.env, argv);
    const { unseedDemoTeam } = require('./lib/unseed');
    const results = await unseedDemoTeam({ company: parseArgs(argv).company, accountsPath: ACCOUNTS_PATH });

    const companies = Object.entries(results);
    if (!companies.length) {
        process.stdout.write('No demo team is recorded in .demo-accounts.local.json; nothing to remove.\n');
        return;
    }
    companies.forEach(([companyId, removed]) => {
        process.stdout.write(`\nRemoved from ${companyId}:\n${Object.entries(removed).map(([what, n]) => `  ${what.padEnd(20)} ${n}`).join('\n')}\n`);
    });
});
