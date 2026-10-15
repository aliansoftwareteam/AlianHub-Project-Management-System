/* Plays one GitHub pull request into the demo workspace through the app's own sync (App connections runner),
 * the way tests/app-connections-github.test.js drives it: the GitHub API is a stand-in `get` that answers
 * with the pull request given, so nothing reaches github.com and no real token exists.
 * Run as a child process with MONGODB_URL and CLOUD_STORAGE_ENC_KEY set; reads one JSON argument:
 * { companyId, projectId, connectedBy, repo, pull }. */
const request = JSON.parse(process.argv[2]);

async function main() {
    const { SCHEMA_TYPE } = require('../../Config/schemaType');
    const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
    const R = require('../../Modules/Integrations/helpers/integrationsRules');
    const runner = require('../../Modules/Integrations/appConnections/runner');
    const { companyId, projectId, connectedBy, repo, pull } = request;
    const T = SCHEMA_TYPE.INTEGRATION_CONNECTIONS;

    let connection = await MongoDbCrudOpration(companyId, { type: T, data: [{ type: 'github', deletedStatusKey: { $ne: 1 } }] }, 'findOne');
    if (!connection) {
        const since = new Date(Date.now() - 60 * 60 * 1000);
        connection = await MongoDbCrudOpration(companyId, {
            type: T,
            data: {
                type: 'github', name: 'GitHub', config: R.sealConfig('github', { token: 'demo-video-placeholder' }), secretsVersion: R.SECRETS_VERSION,
                enabled: true, createdBy: connectedBy, connectedBy, connectedAt: since,
                repos: [{ repo, projectIds: [String(projectId)], sync: { cursor: since.toISOString() } }],
            },
        }, 'save');
    }
    const get = async (url) => {
        if (!url.startsWith(`https://api.github.com/repos/${repo}/pulls?`)) return { status: 404, headers: {}, body: '{}' };
        return { status: 200, headers: {}, body: JSON.stringify([pull]) };
    };
    const result = await runner.syncConnection({ companyId, connection, get });
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().then(() => process.exit(0), (error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exit(1);
});
