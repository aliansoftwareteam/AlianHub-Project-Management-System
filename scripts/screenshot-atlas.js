const fs = require('fs');
const path = require('path');
const { SCREENS } = require('./atlas-manifest');
const { fileName, parseFileName, parseArgs, timestamp } = require('./atlas/naming');
const { paramsOf, resolveRoute } = require('./atlas/routes');
const { readToken, userIdOf } = require('./atlas/session');
const { resolveParams } = require('./atlas/params');
const { decide } = require('./atlas/readOnly');
const { galleryHtml } = require('./atlas/gallery');

const ROOT = path.resolve(__dirname, '..');
const NAVIGATION_TIMEOUT_MS = 45000;
const STEP_TIMEOUT_MS = 10000;
const SETTLE_QUIET_MS = 800;
const SETTLE_LIMIT_MS = 20000;
const SOCKET_PATH = '/socket.io/';
const SHELL = '.ah-app';
const SHELL_TIMEOUT_MS = 30000;
const BLOCKED_BODY = JSON.stringify({ status: false, statusText: 'Blocked', message: 'The screenshot atlas is read-only.' });

const firstLine = (error) => String((error && error.message) || error).split('\n')[0];

function selectScreens(only) {
    if (!only) return SCREENS;
    const unknown = only.filter((name) => !SCREENS.some((screen) => screen.name === name));
    if (unknown.length) throw new Error(`Unknown screen: ${unknown.join(', ')}. Known: ${SCREENS.map((screen) => screen.name).join(', ')}.`);
    return SCREENS.filter((screen) => only.includes(screen.name));
}

async function launch() {
    const { chromium } = require('@playwright/test');
    try {
        return await chromium.launch();
    } catch (error) {
        if (/Executable doesn't exist/.test(String(error && error.message))) {
            throw new Error('Playwright\'s Chromium is not installed here. It is a download of about 150 MB: npx playwright install chromium');
        }
        throw error;
    }
}

/* An aborted request looks like a lost connection to the app, which then shows its offline
 * banner and queues the write for later. A refusal with a status does neither. */
async function guard(context, baseUrl, blocked) {
    await context.route('**/*', (route) => {
        const request = route.request();
        const verdict = decide({ method: request.method(), url: request.url() }, { baseUrl });
        if (verdict.allow) return route.continue();
        blocked.add(verdict.reason);
        return route.fulfill({ status: 403, contentType: 'application/json', body: BLOCKED_BODY });
    });
}

async function newContext(browser, { baseUrl, theme, size, variant, session, blocked }) {
    const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: 1,
        colorScheme: theme,
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
    });
    const stored = [['ah.theme', theme]];
    if (variant) stored.push(['ah.variant', variant]);
    if (session) {
        stored.push(['userId', session.uid], ['selectedCompany', session.cid], ['isLogging', 'true']);
        await context.addCookies([{ name: 'accessToken', value: session.token, url: baseUrl }]);
    }
    await context.addInitScript((entries) => {
        try {
            for (const [key, value] of entries) window.localStorage.setItem(key, value);
        } catch {}
    }, stored);
    await guard(context, baseUrl, blocked);
    return context;
}

function settle(page) {
    return new Promise((resolve) => {
        const inFlight = new Set();
        let quiet = null;
        const finish = () => {
            clearTimeout(quiet);
            clearTimeout(limit);
            page.off('request', onStart);
            page.off('requestfinished', onEnd);
            page.off('requestfailed', onEnd);
            resolve();
        };
        const arm = () => {
            clearTimeout(quiet);
            if (!inFlight.size) quiet = setTimeout(finish, SETTLE_QUIET_MS);
        };
        const onStart = (request) => {
            if (request.url().includes(SOCKET_PATH)) return;
            inFlight.add(request);
            clearTimeout(quiet);
        };
        const onEnd = (request) => {
            inFlight.delete(request);
            arm();
        };
        const limit = setTimeout(finish, SETTLE_LIMIT_MS);
        page.on('request', onStart);
        page.on('requestfinished', onEnd);
        page.on('requestfailed', onEnd);
        arm();
    });
}

async function runStep(page, step) {
    if (step.action === 'press') return page.keyboard.press(step.key);
    const target = page.locator(step.selector).first();
    if (step.action === 'click') return target.click({ timeout: STEP_TIMEOUT_MS });
    if (step.action === 'hover') return target.hover({ timeout: STEP_TIMEOUT_MS });
    if (step.action === 'scrollTo') return target.scrollIntoViewIfNeeded({ timeout: STEP_TIMEOUT_MS });
    if (step.action === 'waitFor') return target.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    throw new Error(`Unknown step "${step.action}"`);
}

// The shell draws only once the socket has answered, and that wait makes no request settle() can see.
async function shellOrSignIn(page) {
    try {
        await page.locator(SHELL).first().waitFor({ state: 'visible', timeout: SHELL_TIMEOUT_MS });
    } catch {
        if (routeOf(page.url()).startsWith('/login')) throw new Error('The session was refused: the app went to sign-in.');
        throw new Error('The app shell did not appear.');
    }
}

const routeOf = (url) => (new URL(url).hash || '#/').slice(1).split('?')[0].replace(/\/$/, '') || '/';

async function capture(context, { baseUrl, screen, route, file }) {
    const page = await context.newPage();
    try {
        await page.goto(`${baseUrl}/#${route}`, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
        if (screen.auth !== false) await shellOrSignIn(page);
        await settle(page);
        for (const step of screen.steps || []) await runStep(page, step);
        if ((screen.steps || []).length) await settle(page);
        await page.evaluate(() => document.fonts.ready.then(() => true));

        const landed = routeOf(page.url());
        if (screen.auth !== false && landed.startsWith('/login')) throw new Error('The session was refused: the app went to sign-in.');
        await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
        const wanted = route.split('?')[0].replace(/\/$/, '') || '/';
        return landed === wanted ? {} : { landedOn: landed };
    } finally {
        await page.close();
    }
}

async function appVersion(baseUrl) {
    try {
        const body = await (await fetch(`${baseUrl}/version`)).json();
        return (body && body.data && body.data.version) || null;
    } catch {
        return null;
    }
}

const keyOf = (entry) => `${entry.screen}|${entry.theme}|${entry.size}`;

function mergeWithEarlierRun(outDir, shots, failures) {
    let earlier = {};
    try {
        earlier = JSON.parse(fs.readFileSync(path.join(outDir, 'atlas.json'), 'utf8'));
    } catch {}
    const attempted = new Set([...shots, ...failures].map(keyOf));
    const kept = (list) => (list || []).filter((entry) => !attempted.has(keyOf(entry)));
    return { shots: [...kept(earlier.shots), ...shots], failures: [...kept(earlier.failures), ...failures] };
}

function writeIndex(outDir, { meta, shots, failures }) {
    const onDisk = new Set(fs.readdirSync(outDir).filter(parseFileName));
    const order = SCREENS.map((screen) => screen.name);
    const listed = shots.filter((shot) => onDisk.has(shot.file)).sort((a, b) => order.indexOf(a.screen) - order.indexOf(b.screen) || a.size.localeCompare(b.size) || a.theme.localeCompare(b.theme));
    fs.writeFileSync(path.join(outDir, 'atlas.json'), `${JSON.stringify({ ...meta, shots: listed, failures }, null, 2)}\n`);
    fs.writeFileSync(path.join(outDir, 'index.html'), galleryHtml({
        title: `Screenshot atlas${meta.variant ? ` (variant ${meta.variant})` : ''}`,
        shots: listed,
        failures,
        meta: [meta.version && `build ${meta.version}`, meta.baseUrl, meta.createdAt],
    }));
    return listed.length;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const screens = selectScreens(args.only);
    const outDir = path.resolve(args.out || path.join(ROOT, 'artifacts', 'atlas', `${timestamp()}${args.variant ? `-variant-${args.variant}` : ''}`));

    let session = null;
    let params = {};
    let problems = {};
    if (screens.some((screen) => screen.auth !== false)) {
        const token = readToken({ tokenFile: args.tokenFile });
        const uid = userIdOf(token);
        const wanted = [...new Set(screens.flatMap((screen) => paramsOf(screen.route)))];
        ({ params, problems } = await resolveParams({ baseUrl: args.baseUrl, token, uid, wanted, companyHint: args.company, projectHint: args.project }));
        session = { token, uid, cid: params.cid };
    }

    fs.mkdirSync(outDir, { recursive: true });
    const shots = [];
    const failures = [];
    const blocked = new Set();
    const browser = await launch();
    try {
        for (const theme of args.themes) {
            for (const size of args.sizes) {
                const shared = { baseUrl: args.baseUrl, theme, size, variant: args.variant, blocked };
                const signedIn = session ? await newContext(browser, { ...shared, session }) : null;
                const signedOut = await newContext(browser, shared);
                for (const screen of screens) {
                    const entry = { screen: screen.name, theme, size: size.label };
                    const { path: route, missing } = resolveRoute(screen.route, params);
                    if (!route) {
                        failures.push({ ...entry, reason: `Nothing to open: ${missing.map((name) => problems[name] || `no ${name.replace(/Id$/, '')} in this workspace`).join('; ')}` });
                        continue;
                    }
                    const file = fileName(entry);
                    try {
                        const result = await capture(screen.auth === false ? signedOut : signedIn, { baseUrl: args.baseUrl, screen, route, file: path.join(outDir, file) });
                        shots.push({ ...entry, file, ...result });
                        process.stdout.write(`ok    ${file}${result.landedOn ? `  (landed on ${result.landedOn})` : ''}\n`);
                    } catch (error) {
                        failures.push({ ...entry, reason: firstLine(error) });
                        process.stdout.write(`FAIL  ${file}  ${firstLine(error)}\n`);
                    }
                }
                if (signedIn) await signedIn.close();
                await signedOut.close();
            }
        }
    } finally {
        await browser.close();
    }

    const merged = mergeWithEarlierRun(outDir, shots, failures);
    const meta = {
        baseUrl: args.baseUrl,
        version: await appVersion(args.baseUrl),
        createdAt: new Date().toISOString(),
        variant: args.variant,
        blocked: [...blocked].sort(),
    };
    const count = writeIndex(outDir, { meta, ...merged });

    process.stdout.write(`\n${shots.length} captured, ${failures.length} failed this run; ${count} in the gallery.\n`);
    if (blocked.size) process.stdout.write(`Refused as writes (${blocked.size}):\n${[...blocked].sort().map((reason) => `  ${reason}`).join('\n')}\n`);
    process.stdout.write(`${path.join(outDir, 'index.html')}\n`);
    return failures.length ? 1 : 0;
}

if (require.main === module) {
    main().then((code) => process.exit(code)).catch((error) => {
        process.stderr.write(`\n${firstLine(error)}\n\n`);
        process.exit(1);
    });
}

module.exports = { selectScreens, routeOf };
