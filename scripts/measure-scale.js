#!/usr/bin/env node
require('./demo/lib/env');
const fs = require('fs');
const os = require('os');
const { assertLocalTarget } = require('./demo/lib/guard');
const { parseArgs, run } = require('./demo/lib/cli');
const { markdownTable } = require('./scale/lib/report');

const DEFAULT_BASE = 'http://localhost:4000';

const wholeNumber = (value, fallback, name) => {
    if (value === undefined) return fallback;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) throw new Error(`--${name} must be a whole number above zero.`);
    return number;
};

const machine = () => {
    const cpus = os.cpus();
    return `${cpus[0].model.trim()}, ${cpus.length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB, ${os.platform()} ${os.release()}`;
};

run(async () => {
    const argv = process.argv.slice(2);
    assertLocalTarget(process.env, argv);
    const args = parseArgs(argv);
    const base = String(args.base || DEFAULT_BASE).replace(/\/+$/, '');
    const runs = wholeNumber(args.runs, 20, 'runs');
    const loads = wholeNumber(args.loads, 5, 'loads');
    const log = (line) => process.stderr.write(`${line}\n`);

    const health = await fetch(`${base}/health`).then((response) => response.json()).catch(() => null);
    if (!health || health.status !== 'ok') throw new Error(`No healthy server at ${base}. Start it, then measure.`);

    const session = await require('./scale/lib/session').issueScaleSession();
    if (!session.project) throw new Error('The scale seed company has no project. Run the seed first.');

    const room = require('./scale/lib/pace').pacer({ base, log });
    const { client, measureApi } = require('./scale/lib/apiProbes');
    const only = typeof args.only === 'string' ? args.only : '';
    if (only && only !== 'everything') throw new Error('--only takes "everything".');
    const api = only ? { metrics: [], size: {} } : await measureApi({ base, session, runs, room, log });
    const metrics = [...api.metrics];

    const { measureEverything, everythingExplainer } = require('./scale/lib/everythingProbes');
    /* A server older than the Everything view still gets its List and Board measured. */
    let everything = { metrics: [], size: {} };
    try {
        everything = await measureEverything({
            base, session, runs, room, log,
            call: client({ base, token: session.accessToken, companyId: session.companyId }),
            explain: args['no-explain'] ? null : await everythingExplainer({ session }),
            viewer: { now: new Date(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
        });
    } catch (error) {
        if (only) throw error;
        log(`Everything: not measured: ${error.message}`);
    }
    metrics.push(...everything.metrics);

    let browserNote = 'skipped with --no-browser';
    if (!args['no-browser']) {
        const { launchBrowser, measureBrowser, measureEverythingPage } = require('./scale/lib/browserProbes');
        const browser = await launchBrowser();
        if (browser) {
            try {
                if (!only) metrics.push(...await measureBrowser({ browser, base, session, list: api.size.list, loads, room, log }));
                if (everything.metrics.length) metrics.push(...await measureEverythingPage({ browser, base, session, loads, room, log }));
                browserNote = `Chromium ${browser.version()}, headless`;
            } finally {
                await browser.close();
            }
        } else {
            browserNote = 'not run: Playwright\'s Chromium is not installed (npx playwright install chromium)';
            log(`Browser timings ${browserNote}.`);
        }
    }

    const results = {
        date: new Date().toISOString().slice(0, 10),
        build: health.version,
        machine: machine(),
        loadAverage: os.loadavg().map((load) => Math.round(load * 100) / 100),
        base,
        tasks: only ? everything.size.tasks : api.size.tasks,
        subtasks: api.size.subtasks,
        list: api.size.list,
        everything: everything.size,
        runs,
        loads,
        browser: browserNote,
        metrics,
    };
    const json = `${JSON.stringify(results, null, 2)}\n`;
    if (typeof args.out === 'string') fs.writeFileSync(args.out, json);

    process.stdout.write(`${markdownTable(results)}\n`);
    if (typeof args.out !== 'string') process.stdout.write(`\n${json}`);
});
