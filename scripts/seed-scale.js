#!/usr/bin/env node
require('./demo/lib/env');
const { assertLocalTarget } = require('./demo/lib/guard');
const { parseArgs, run } = require('./demo/lib/cli');

const table = (rows) => rows.map(([what, n]) => `  ${String(what).padEnd(22)} ${n}`).join('\n');

run(async () => {
    const argv = process.argv.slice(2);
    assertLocalTarget(process.env, argv);
    const args = parseArgs(argv);

    if (args.drop) {
        const { companyId, removed } = await require('./scale/lib/drop').dropScale();
        process.stdout.write(companyId
            ? `\nDropped the scale seed company ${companyId}:\n${table(Object.entries(removed))}\n\n`
            : '\nThere is no scale seed company; nothing was removed.\n\n');
        return;
    }

    if (args.token) {
        const session = await require('./scale/lib/session').issueScaleSession();
        process.stderr.write(`Send "Authorization: Bearer <token>" with "companyid: ${session.companyId}". Expires in ${session.expiresInSeconds / 60} minutes.\n`);
        process.stdout.write(`${session.accessToken}\n`);
        return;
    }

    if (args.tasks === undefined) throw new Error('Pass --tasks <count> (10000 or 50000 for the benchmark sizes), --token or --drop.');
    const report = await require('./scale/lib/seed').seedScale({ tasks: args.tasks, log: (line) => process.stdout.write(`${line}\n`) });
    process.stdout.write([
        '',
        `Scale seed company ${report.companyId}, project ${report.projectId}`,
        'Created this run:',
        table([...Object.entries(report.created), ...Object.entries(report.inserted)]),
        'Stored now:',
        table([['task documents', report.counters.total], ['lists', report.lists.length]]),
        '',
    ].join('\n'));
});
