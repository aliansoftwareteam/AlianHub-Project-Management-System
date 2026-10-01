/* eslint-env browser */
const fs = require('node:fs');
const path = require('node:path');
const { test, expect, asRole } = require('../support/test');
const { SCREENS } = require('../../scripts/atlas-manifest');
const { coreShots } = require('../../scripts/atlas/core');
const { parseSize } = require('../../scripts/atlas/naming');
const { resolveRoute } = require('../../scripts/atlas/routes');
const { decide } = require('../../scripts/atlas/readOnly');
const { SHELL, SHELL_TIMEOUT_MS, settle, runStep } = require('../../scripts/atlas/browser');
const { NOW, freezeTimestamps } = require('../../scripts/visual/freeze');
const { MASKED, captureCss } = require('../../scripts/visual/masks');
const { ARTIFACT, PROPOSED_DIR, baselineDir } = require('../../scripts/visual/settings');

const BLOCKED_BODY = JSON.stringify({ status: false, statusText: 'Blocked', message: 'The screenshot check is read-only.' });
const SOCKET_PATH = '/socket.io/';
const TEXT_BODY = /json|text\/plain/;
const BODY_FONT = 'Inter Tight';
const AT_REST_ATTEMPTS = 8;
const AT_REST_GAP_MS = 250;
const SHOT = { animations: 'disabled', caret: 'hide', scale: 'css', type: 'png' };

const jsonBodyOf = (request) => {
    try {
        return request.postDataJSON();
    } catch {
        return null;
    }
};

/* Nothing a screen does may reach the database: the next screenshot must see the seed, whatever
 * ran before it. Data requests come back with their run-time stamps frozen. */
async function holdStill(context, { baseURL, startedAt }) {
    await context.route('**/*', async (route) => {
        const request = route.request();
        const verdict = decide({ method: request.method(), url: request.url(), body: jsonBodyOf(request) }, { baseUrl: baseURL });
        if (!verdict.allow) return route.fulfill({ status: 403, contentType: 'application/json', body: BLOCKED_BODY });
        const data = ['xhr', 'fetch'].includes(request.resourceType()) && request.url().startsWith(`${baseURL}/`) && !request.url().includes(SOCKET_PATH);
        if (!data) return route.continue();
        try {
            const response = await route.fetch();
            if (!TEXT_BODY.test(response.headers()['content-type'] || '')) return await route.fulfill({ response });
            const body = freezeTimestamps(await response.text(), { from: startedAt, to: Date.now() });
            return await route.fulfill({ response, body });
        } catch {
            // The page closed while the request was in flight.
            return route.abort().catch(() => {});
        }
    });
}

const firstRunDone = ({ theme }) => {
    localStorage.setItem('ah.theme', theme);
    for (const screen of ['shell', 'project', 'board', 'list']) localStorage.setItem(`ah.tour.skipped.${screen}`, '1');
    sessionStorage.setItem('ah.gs.dismissed', '1');
};

const fontsAndImages = (page) => page.evaluate(async (family) => {
    await document.fonts.ready;
    await Promise.all([...document.images].filter((image) => !image.complete).map((image) => new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
    })));
    const faces = [...document.fonts];
    const named = (face) => face.family.replace(/["']/g, '');
    return {
        bodyFont: faces.some((face) => named(face) === family && face.status === 'loaded'),
        failed: [...new Set(faces.filter((face) => face.status === 'error').map(named))],
    };
}, BODY_FONT);

async function atRest(page, options) {
    let previous = await page.screenshot(options);
    for (let attempt = 0; attempt < AT_REST_ATTEMPTS; attempt += 1) {
        await page.waitForTimeout(AT_REST_GAP_MS);
        const next = await page.screenshot(options);
        if (next.equals(previous)) return next;
        previous = next;
    }
    throw new Error('The screen never came to rest: two screenshots in a row kept differing.');
}

function propose(file, image) {
    fs.mkdirSync(PROPOSED_DIR, { recursive: true });
    fs.writeFileSync(path.join(PROPOSED_DIR, file), image);
}

async function compare(page, file) {
    const options = { ...SHOT, mask: MASKED.map((entry) => page.locator(entry.selector)) };
    const baseline = path.join(baselineDir(), file);
    const known = fs.existsSync(baseline);

    if (!known || process.env.VISUAL_UPDATE) {
        const image = await atRest(page, options);
        if (!known || !fs.readFileSync(baseline).equals(image)) propose(file, image);
        test.skip(!known, `No baseline for ${file} yet. This run proposes one in its ${ARTIFACT} artifact.`);
        return;
    }

    try {
        await expect(page).toHaveScreenshot([file], { mask: options.mask });
        fs.rmSync(path.join(PROPOSED_DIR, file), { force: true });
    } catch (error) {
        propose(file, await page.screenshot(options));
        throw error;
    }
}

test.use(asRole('owner'));

const routeParams = (state) => ({
    cid: state.companyId,
    projectId: state.projects.shared._id,
    sprintId: state.tasks[0].sprintId,
    taskId: state.tasks[0]._id,
    pageId: state.visual.pageId,
    dashboardId: state.visual.dashboardId,
});

const groups = new Map();
for (const shot of coreShots()) {
    const key = `${shot.theme} ${shot.size}`;
    groups.set(key, [...(groups.get(key) || []), shot]);
}

for (const [group, shots] of groups) {
    const [{ theme, size }] = shots;
    const { width, height } = parseSize(size);

    test.describe(group, () => {
        test.use({ viewport: { width, height }, colorScheme: theme });

        for (const shot of shots) {
            const screen = SCREENS.find((candidate) => candidate.name === shot.screen);

            test(shot.screen, async ({ page, context, state, baseURL }) => {
                const { path: route, missing } = resolveRoute(screen.route, routeParams(state));
                expect(missing, 'the seed has a record for every parameter of the route').toEqual([]);

                await holdStill(context, { baseURL, startedAt: state.visual.startedAt });
                await page.clock.install({ time: new Date(NOW) });
                await page.addInitScript(firstRunDone, { theme });

                await page.goto(`/#${route}`);
                await page.locator(SHELL).first().waitFor({ state: 'visible', timeout: SHELL_TIMEOUT_MS });
                await page.addStyleTag({ content: captureCss() });
                await settle(page);
                for (const step of screen.steps || []) await runStep(page, step);
                if (screen.steps) await settle(page);

                const fonts = await fontsAndImages(page);
                expect(fonts, 'the web fonts loaded; a miss here is the network, not the design').toEqual({ bodyFont: true, failed: [] });

                await compare(page, shot.file);
            });
        }
    });
}
