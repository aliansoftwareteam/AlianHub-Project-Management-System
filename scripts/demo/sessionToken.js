const { ACCOUNTS_PATH } = require('./lib/env');
const { assertLocalTarget } = require('./lib/guard');
const { parseArgs, run } = require('./lib/cli');

run(async () => {
    const argv = process.argv.slice(2);
    assertLocalTarget(process.env, argv);
    const { issueSessionToken } = require('./lib/session');
    const { accessToken, companyId, expiresInSeconds } = await issueSessionToken({ email: parseArgs(argv).email, accountsPath: ACCOUNTS_PATH });
    process.stderr.write(`Send "Authorization: Bearer <token>" with "companyid: ${companyId}". Expires in ${expiresInSeconds / 60} minutes.\n`);
    process.stdout.write(`${accessToken}\n`);
});
