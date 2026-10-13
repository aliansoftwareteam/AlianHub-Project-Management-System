const { execFileSync } = require('node:child_process');
const { MongoClient } = require('mongodb');

const DEFAULT_PORT = 27018;

/* `npm run e2e:db -- --port 27120` starts a second, independent database so parallel
 * runs stop wiping each other's data; 27018 keeps its original container name. */
const optionsFrom = (argv) => {
    const at = argv.indexOf('--port');
    const port = at === -1 ? DEFAULT_PORT : Number(argv[at + 1]);
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 27017) {
        throw new Error('--port must be a free port from 1024 to 65535, and not 27017 (the development database).');
    }
    return {
        port,
        stop: argv.includes('--stop'),
        container: port === DEFAULT_PORT ? 'alianhub-e2e-mongo' : `alianhub-e2e-mongo-${port}`,
        url: `mongodb://127.0.0.1:${port}`,
    };
};

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();

async function waitForPing(url, deadline) {
    for (;;) {
        const client = new MongoClient(url, { serverSelectionTimeoutMS: 1000 });
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
    const { port, stop, container, url } = optionsFrom(process.argv.slice(2));
    const running = docker('ps', '-q', '--filter', `name=^${container}$`);
    if (stop) {
        if (running) docker('stop', container);
        console.log(running ? `Stopped ${container}.` : `${container} was not running.`);
        return;
    }
    if (running) {
        console.log(`${container} is already running on ${port}.`);
    } else {
        docker('run', '-d', '--rm', '--name', container, '-p', `${port}:27017`, 'mongo:7');
        console.log(`Started ${container} on ${port}.`);
    }
    await waitForPing(url, Date.now() + 30000);
    console.log(`\nexport E2E_MONGODB_URL=${url}\n`);
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}

module.exports = { optionsFrom };
