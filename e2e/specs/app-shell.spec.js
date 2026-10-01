const { test, expect } = require('../support/test');

/* The suite blocks service workers (playwright.config.js); this file is the one place they run. */
test.use({ serviceWorkers: 'allow' });

const heldPaths = (page) => page.evaluate(async () => {
    const paths = [];
    for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) paths.push(new URL(request.url).pathname);
    }
    return paths;
});

test.describe('the app shell', () => {
    test('opens the sign-in page with no network and holds nothing but files of the build', async ({ page, context }) => {
        await page.goto('/#/login');
        await expect(page.locator('#email')).toBeVisible();
        await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));

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
