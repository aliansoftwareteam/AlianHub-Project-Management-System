/* global window, document, getComputedStyle -- used inside functions that run in the page */
const fs = require('fs');
const path = require('path');
const { SCREENS } = require('./atlas-manifest');
const { fileName, parseFileName, parseArgs, timestamp } = require('./atlas/naming');
const { paramsOf, resolveRoute } = require('./atlas/routes');
const { readToken, userIdOf } = require('./atlas/session');
const { resolveParams } = require('./atlas/params');
const { decide } = require('./atlas/readOnly');
const { galleryHtml } = require('./atlas/gallery');
const { newBudget, noteBudget, roomToLoad } = require('./atlas/pace');

const ROOT = path.resolve(__dirname, '..');
const NAVIGATION_TIMEOUT_MS = 45000;
const STEP_TIMEOUT_MS = 10000;
const QUIET_MS = 1000;
const QUIET_LIMIT_MS = 20000;
const BUSY_LIMIT_MS = 12000;
const BUSY_POLL_MS = 250;
const BUSY = '[class*="skeleton"], [class*="skelaton"], [class*="spinner"], .lds-roller, [aria-busy="true"]';
const SOCKET_PATH = '/socket.io/';
const SHELL = '.ah-app';
const SHELL_TIMEOUT_MS = 30000;
const ATTEMPTS = 3;
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

function jsonBodyOf(request) {
    try {
        return request.postDataJSON();
    } catch {
        return null;
    }
}

/* An aborted request looks like a lost connection to the app, which then shows its offline
 * banner and queues the write for later. A refusal with a status does neither. */
async function guard(context, baseUrl, blocked) {
    await context.route('**/*', (route) => {
        const request = route.request();
        const verdict = decide({ method: request.method(), url: request.url(), body: jsonBodyOf(request) }, { baseUrl });
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

function networkQuiet(page) {
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
            if (!inFlight.size) quiet = setTimeout(finish, QUIET_MS);
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
        const limit = setTimeout(finish, QUIET_LIMIT_MS);
        page.on('request', onStart);
        page.on('requestfinished', onEnd);
        page.on('requestfailed', onEnd);
        arm();
    });
}

const showsBusy = (page) => page.evaluate((selector) => [...document.querySelectorAll(selector)].some((element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden';
}), BUSY);

// A view can pause longer than the quiet window before it asks for its rows, so a skeleton on screen outranks a quiet network.
async function settle(page) {
    await networkQuiet(page);
    const deadline = Date.now() + BUSY_LIMIT_MS;
    while (await showsBusy(page)) {
        if (Date.now() > deadline) return { note: 'still showing a loading state' };
        await page.waitForTimeout(BUSY_POLL_MS);
    }
    await networkQuiet(page);
    return {};
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

class RateLimited extends Error {
    constructor() {
        super('The server\'s rate limit cut this screen short.');
    }
}

class SessionRefused extends Error {
    constructor() {
        super('The session was refused: the app went to sign-in. A demo token lasts an hour.');
    }
}

const routeOf = (url) => (new URL(url).hash || '#/').slice(1).split('?')[0].replace(/\/$/, '') || '/';

// The shell draws only once the socket has answered, and that wait makes no request networkQuiet() can see.
async function shellOrSignIn(page) {
    try {
        await page.locator(SHELL).first().waitFor({ state: 'visible', timeout: SHELL_TIMEOUT_MS });
    } catch {
        if (routeOf(page.url()).startsWith('/login')) throw new SessionRefused();
        throw new Error('The app shell did not appear.');
    }
}

async function capture(context, { baseUrl, screen, route, file, budget }) {
    const page = await context.newPage();
    let limited = false;
    page.on('response', (response) => {
        if (!response.url().startsWith(`${baseUrl}/`)) return;
        noteBudget(budget, response.headers());
        if (response.status() === 429) limited = true;
    });
    try {
        await page.goto(`${baseUrl}/#${route}`, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
        if (screen.auth !== false) await shellOrSignIn(page);
        let { note } = await settle(page);
        for (const step of screen.steps || []) await runStep(page, step);
        if ((screen.steps || []).length) ({ note } = await settle(page));
        await page.evaluate(() => document.fonts.ready.then(() => true));

        const landed = routeOf(page.url());
        if (limited) throw new RateLimited();
        if (screen.auth !== false && landed.startsWith('/login')) throw new SessionRefused();
        await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
        const wanted = route.split('?')[0].replace(/\/$/, '') || '/';
        const notes = [landed === wanted ? null : `landed on ${landed}`, note].filter(Boolean);
        return notes.length ? { note: notes.join('; ') } : {};
    } finally {
        await page.close();
    }
}

async function captureWithRetry(context, job) {
    for (let attempt = 1; ; attempt += 1) {
        await roomToLoad(job.budget);
        try {
            return await capture(context, job);
        } catch (error) {
            if (error instanceof SessionRefused || attempt >= ATTEMPTS) throw error;
            if (error instanceof RateLimited) await roomToLoad(job.budget, { reserve: Infinity });
        }
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

/* The folder is the record: every shot on disk is listed, so a run that was cut short
 * still gets a gallery from the next one. atlas.json only adds the notes. */
function writeIndex(outDir, { meta, shots, failures }) {
    const notes = new Map(shots.filter((shot) => shot.note).map((shot) => [shot.file, shot.note]));
    const order = SCREENS.map((screen) => screen.name);
    const listed = fs.readdirSync(outDir).filter(parseFileName)
        .map((file) => ({ ...parseFileName(file), file, ...(notes.has(file) ? { note: notes.get(file) } : {}) }))
        .sort((a, b) => order.indexOf(a.screen) - order.indexOf(b.screen) || a.size.localeCompare(b.size) || a.theme.localeCompare(b.theme));
    const onDisk = new Set(listed.map(keyOf));
    const stillFailing = failures.filter((failure) => !onDisk.has(keyOf(failure)));
    fs.writeFileSync(path.join(outDir, 'atlas.json'), `${JSON.stringify({ ...meta, shots: listed, failures: stillFailing }, null, 2)}\n`);
    fs.writeFileSync(path.join(outDir, 'index.html'), galleryHtml({
        title: `Screenshot atlas${meta.variant ? ` (variant ${meta.variant})` : ''}`,
        shots: listed,
        failures: stillFailing,
        meta: [meta.version && `build ${meta.version}`, meta.baseUrl, meta.createdAt],
    }));
    return listed.length;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const screens = selectScreens(args.only);
    const outDir = path.resolve(args.out || path.join(ROOT, 'artifacts', 'atlas', `${timestamp()}${args.variant ? `-variant-${args.variant}` : ''}`));

    const budget = newBudget();
    let session = null;
    let params = {};
    let problems = {};
    if (screens.some((screen) => screen.auth !== false)) {
        const token = readToken({ tokenFile: args.tokenFile });
        const uid = userIdOf(token);
        const wanted = [...new Set(screens.flatMap((screen) => paramsOf(screen.route)))];
        ({ params, problems } = await resolveParams({ baseUrl: args.baseUrl, token, uid, wanted, companyHint: args.company, projectHint: args.project, budget }));
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
                        const result = await captureWithRetry(screen.auth === false ? signedOut : signedIn, { baseUrl: args.baseUrl, screen, route, file: path.join(outDir, file), budget });
                        shots.push({ ...entry, file, ...result });
                        process.stdout.write(`ok    ${file}${result.note ? `  (${result.note})` : ''}\n`);
                    } catch (error) {
                        if (error instanceof SessionRefused && !shots.some((shot) => SCREENS.find((known) => known.name === shot.screen).auth !== false)) throw error;
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
