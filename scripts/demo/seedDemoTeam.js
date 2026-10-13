const { ACCOUNTS_PATH } = require('./lib/env');
const { assertLocalTarget } = require('./lib/guard');
const { parseArgs, run } = require('./lib/cli');

run(async () => {
    const argv = process.argv.slice(2);
    assertLocalTarget(process.env, argv);
    const { seedDemoTeam } = require('./lib/seed');
    const report = await seedDemoTeam({ company: parseArgs(argv).company, accountsPath: ACCOUNTS_PATH });

    const lines = [
        '',
        `Demo team in ${report.companyName || 'company'} (${report.companyId})`,
        ...report.team.map((m) => `  ${m.name.padEnd(14)} ${m.title.padEnd(20)} ${`${m.role} (roleType ${m.roleType})`.padEnd(22)} ${m.email}`),
        '',
        `Created: ${Object.entries(report.created).map(([what, n]) => `${what} ${n}`).join(', ')}`,
        `Project: QA Sandbox (${report.projectId}), active sprint "${report.sprintName}"`,
        ...report.warnings.map((warning) => `Warning: ${warning}`),
        `Credentials: ${ACCOUNTS_PATH} (mode 600)`,
        '',
    ];
    process.stdout.write(`${lines.join('\n')}\n`);
});
