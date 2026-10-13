/* eslint-env browser */
const { test, expect, asRole, skipConsoleGuard } = require('../support/test');

/* The suite blocks service workers (playwright.config.js); this file is the one place they run. */
test.use({ serviceWorkers: 'allow' });

const GOES_OFFLINE = 'The test cuts the network on purpose, so the browser logs every request that then fails.';

const workerActive = (page) => page.evaluate(() => navigator.serviceWorker.ready.then(() => true));

const heldPaths = (page) => page.evaluate(async () => {
    const paths = [];
    for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) paths.push(new URL(request.url).pathname);
    }
    return paths;
});

test.describe('the app shell, signed out', () => {
    test('opens the sign-in page with no network and holds nothing but files of the build', async ({ page, context }) => {
        skipConsoleGuard(GOES_OFFLINE);
        await page.goto('/#/login');
        await expect(page.locator('#email')).toBeVisible();
        await workerActive(page);

        const held = await heldPaths(page);
        expect(held).toContain('/index.html');
        expect(held.some((path) => /^\/js\/app\.[0-9a-f]{8}\.js$/.test(path))).toBe(true);
        expect(held.filter((path) => !/^\/(index\.html|manifest\.webmanifest|(js|css|fonts|icons|img)\/)/.test(path))).toEqual([]);

        await context.setOffline(true);
        await page.reload();

        await expect(page.locator('#email')).toBeVisible();
        await expect(page.locator('.auth__banner')).toContainText("You're offline");
    });
});

test.describe('the app shell, signed in', () => {
    test.use(asRole('owner'));

    test('opens on an offline screen with no network and comes back by itself', async ({ page, context, state }) => {
        skipConsoleGuard(GOES_OFFLINE);
        await page.goto(`/#/${state.companyId}`);
        await expect(page.locator('.ah-app')).toBeVisible();
        await workerActive(page);

        await context.setOffline(true);
        await page.reload();
        await expect(page.locator('.ah-state--offline')).toBeVisible();
        expect(await heldPaths(page).then((held) => held.filter((path) => path.startsWith('/api/')))).toEqual([]);

        await context.setOffline(false);
        await expect(page.locator('.ah-app')).toBeVisible();
    });
});
