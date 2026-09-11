jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/service.js', () => ({ sendAttachMail: jest.fn((subject, html, to, attachments, cb) => cb({ status: true })) }));

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EVENTS = ['uncaughtException', 'unhandledRejection'];

const loadGuards = () => {
    let guards;
    jest.isolateModules(() => { guards = require('../Config/processGuards'); });
    return guards;
};

let listenersBefore;
let exit;
let consoleError;

beforeEach(() => {
    listenersBefore = Object.fromEntries(EVENTS.map((e) => [e, process.listeners(e)]));
    exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.FATAL_FLUSH_TIMEOUT_MS;
});

afterEach(() => {
    for (const event of EVENTS) {
        for (const listener of process.listeners(event)) {
            if (!listenersBefore[event].includes(listener)) process.removeListener(event, listener);
        }
    }
    exit.mockRestore();
    consoleError.mockRestore();
    jest.useRealTimers();
});

const added = (event) => process.listeners(event).filter((l) => !listenersBefore[event].includes(l));

describe('one fatal path', () => {
    it("index.js's guard setup and mongoConnector.js together leave exactly one listener per event", () => {
        const source = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
        const marker = source.indexOf('const bodyParser');
        expect(marker).toBeGreaterThan(0);
        const rootRequire = (p) => require(p.startsWith('.') ? path.join(ROOT, p) : p);
        jest.isolateModules(() => {
            new Function('require', source.slice(0, marker))(rootRequire);
            require('../utils/mongo-handler/mongoConnector');
            require('../Config/processGuards').install();
        });
        expect(added('uncaughtException')).toHaveLength(1);
        expect(added('unhandledRejection')).toHaveLength(1);
    });

    it('no other server module registers its own handler', () => {
        const registersHandler = (file) => fs.readFileSync(file, 'utf8')
            .split('\n')
            .some((line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && /process\.on\(\s*['"](uncaughtException|unhandledRejection)/.test(line));
        const offenders = [];
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.name === 'node_modules') continue;
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (entry.name.endsWith('.js') && registersHandler(full)) offenders.push(path.relative(ROOT, full));
            }
        };
        ['Config', 'Modules', 'utils', 'middlewares', 'event', 'common-storage'].forEach((d) => fs.existsSync(path.join(ROOT, d)) && walk(path.join(ROOT, d)));
        ['index.js', 'server.js', 'cron.js'].forEach((f) => {
            const full = path.join(ROOT, f);
            if (fs.existsSync(full) && registersHandler(full)) offenders.push(f);
        });
        expect(offenders).toEqual(['Config/processGuards.js']);
    });

    it('install() is idempotent', () => {
        const guards = loadGuards();
        guards.install();
        guards.install();
        expect(added('uncaughtException')).toHaveLength(1);
        expect(added('unhandledRejection')).toHaveLength(1);
    });
});

describe('fatal()', () => {
    it('logs once with the stack, runs every flusher, then exits with 1', async () => {
        const guards = loadGuards();
        const logger = require('../Config/loggerConfig');
        logger.error.mockClear();
        const order = [];
        guards.onFatal('a', async (err, origin) => { order.push(['a', err.message, origin]); });
        guards.onFatal('b', () => new Promise((resolve) => setTimeout(() => { order.push(['b']); resolve(); }, 10)));
        exit.mockImplementation(() => order.push(['exit']));

        await guards.fatal(new Error('boom'), 'uncaughtException');

        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error.mock.calls[0][0]).toMatch(/^\[FATAL\] uncaughtException: Error: boom\n\s+at /);
        expect(order).toEqual([['a', 'boom', 'uncaughtException'], ['b'], ['exit']]);
        expect(exit).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(1);
    });

    it('cuts a hanging flusher off at FATAL_FLUSH_TIMEOUT_MS and still exits', async () => {
        process.env.FATAL_FLUSH_TIMEOUT_MS = '50';
        const guards = loadGuards();
        const quick = jest.fn();
        guards.onFatal('hangs', () => new Promise(() => {}));
        guards.onFatal('quick', quick);
        const started = Date.now();

        await guards.fatal(new Error('boom'));

        expect(Date.now() - started).toBeLessThan(1000);
        expect(quick).toHaveBeenCalled();
        expect(exit).toHaveBeenCalledWith(1);
        expect(consoleError.mock.calls.map((c) => c[0]).join('\n')).toMatch(/cut off after 50ms.*hangs/);
    });

    it('defaults the cap to 3000ms', async () => {
        jest.useFakeTimers();
        const guards = loadGuards();
        guards.onFatal('hangs', () => new Promise(() => {}));
        const done = guards.fatal(new Error('boom'));
        await jest.advanceTimersByTimeAsync(2999);
        expect(exit).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1);
        await done;
        expect(exit).toHaveBeenCalledWith(1);
    });

    it('a throwing flusher does not stop the others', async () => {
        const guards = loadGuards();
        const after = jest.fn();
        guards.onFatal('throws', () => { throw new Error('flush failed'); });
        guards.onFatal('rejects', async () => { throw new Error('async flush failed'); });
        guards.onFatal('after', after);

        await guards.fatal(new Error('boom'));

        expect(after).toHaveBeenCalled();
        expect(exit).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(1);
    });

    it('closing flushers run after the others, so a report can still log', async () => {
        const guards = loadGuards();
        const order = [];
        guards.onFatal('logger', async () => { order.push('logger'); }, { last: true });
        guards.onFatal('report', () => new Promise((resolve) => setTimeout(() => { order.push('report'); resolve(); }, 10)));

        await guards.fatal(new Error('boom'));

        expect(order).toEqual(['report', 'logger']);
    });

    it('a second fatal during flush exits immediately', async () => {
        const guards = loadGuards();
        let release;
        guards.onFatal('slow', () => new Promise((resolve) => { release = resolve; }));

        const first = guards.fatal(new Error('first'));
        await Promise.resolve();
        expect(exit).not.toHaveBeenCalled();

        guards.fatal(new Error('second'));
        expect(exit).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(1);

        release();
        await first;
    });

    it('the installed uncaughtException listener routes into fatal()', async () => {
        const guards = loadGuards();
        const flusher = jest.fn();
        guards.onFatal('f', flusher);
        guards.install();
        await added('uncaughtException')[0](new Error('boom'), 'uncaughtException');
        expect(flusher).toHaveBeenCalledWith(expect.any(Error), 'uncaughtException');
        expect(exit).toHaveBeenCalledWith(1);
    });
});

describe('unhandled rejections', () => {
    it('are logged and do not exit', async () => {
        const guards = loadGuards();
        const logger = require('../Config/loggerConfig');
        logger.error.mockClear();
        const flusher = jest.fn();
        guards.onFatal('f', flusher);
        guards.install();

        added('unhandledRejection')[0](new Error('rejected'), Promise.resolve());
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error.mock.calls[0][0]).toMatch(/^\[unhandledRejection\] Error: rejected/);
        expect(flusher).not.toHaveBeenCalled();
        expect(exit).not.toHaveBeenCalled();
    });
});

describe('mongoConnector crash report', () => {
    const report = (err) => {
        let connector;
        jest.isolateModules(() => {
            jest.doMock('../Config/config.js', () => ({ NODE_ENV: 'test', ERRORRECIVEREMAIL: 'ops@example.com' }));
            connector = require('../utils/mongo-handler/mongoConnector');
        });
        return connector.crashReport(err).then(() => require('../Modules/service.js').sendAttachMail);
    };
    const named = (name, message, extra = {}) => Object.assign(new Error(message), { name }, extra);

    beforeEach(() => require('../Modules/service.js').sendAttachMail.mockClear());

    it('mails a crash', async () => {
        const send = await report(new TypeError('x is undefined'));
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0]).toBe('CRASHED: Mongo Error in test Environment');
    });

    it('mails the collection-limit error under its own subject', async () => {
        const send = await report(named('MongoServerError', 'cannot create a new collection', { code: 8000 }));
        expect(send.mock.calls[0][0]).toBe('Mongo Collection Error in test Environment');
    });

    it('does not mail a network error', async () => {
        const send = await report(named('MongoNetworkError', 'connection reset'));
        expect(send).not.toHaveBeenCalled();
    });
});

describe('logger flusher', () => {
    it('ends the daily-rotate transports so the fatal line reaches the file', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guards-log-'));
        let logger;
        process.env.LOG_DIR = dir;
        await jest.isolateModulesAsync(async () => {
            jest.unmock('../Config/loggerConfig');
            const guards = require('../Config/processGuards');
            logger = require('../Config/loggerConfig');
            await guards.fatal(new Error('written before exit'));
        });
        delete process.env.LOG_DIR;

        const errorFile = fs.readdirSync(dir).find((f) => f.startsWith('error-'));
        expect(fs.readFileSync(path.join(dir, errorFile), 'utf8')).toMatch(/\[FATAL\] uncaughtException: Error: written before exit/);
        expect(logger.transports.every((t) => t.logStream.writableFinished || t.logStream.finished)).toBe(true);
        expect(exit).toHaveBeenCalledWith(1);
        fs.rmSync(dir, { recursive: true, force: true });
    });
});
