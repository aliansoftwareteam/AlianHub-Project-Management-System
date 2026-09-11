const { execFileSync } = require('node:child_process');
const { MongoClient } = require('mongodb');

const CONTAINER = 'alianhub-e2e-mongo';
const URL = 'mongodb://127.0.0.1:27018';

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();

async function waitForPing(deadline) {
    for (;;) {
        const client = new MongoClient(URL, { serverSelectionTimeoutMS: 1000 });
        try {
            await client.connect();
            await client.db('admin').command({ ping: 1 });
            return;
        } catch (error) {
            if (Date.now() > deadline) throw error;
            await new Promise((resolve) => setTimeout(resolve, 500));
        } finally {
            await client.close().catch(() => {});
        }
    }
}

async function main() {
    if (docker('ps', '-q', '--filter', `name=^${CONTAINER}$`)) {
        console.log(`${CONTAINER} is already running on 27018.`);
    } else {
        docker('run', '-d', '--rm', '--name', CONTAINER, '-p', '27018:27017', 'mongo:7');
        console.log(`Started ${CONTAINER} on 27018.`);
    }
    await waitForPing(Date.now() + 30000);
    console.log(`\nexport E2E_MONGODB_URL=${URL}\n`);
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
