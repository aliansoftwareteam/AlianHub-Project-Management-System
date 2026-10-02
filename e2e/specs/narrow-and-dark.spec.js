/* eslint-env browser */
const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun } = require('../support/pages');

const NARROW = { width: 390, height: 844 };

/* An entry skips what its selector matches (the element or anything inside it) on the screens it names, or on every screen.
 * Each one says why the element is exempt. A failure that is a product bug is fixed in the product, not listed here. */
const NARROW_ALLOW = [];
const DARK_ALLOW = [];

const WIDEST_FIRST = 3;
const LIGHTEST_BACKGROUND = '#e6e6e6';
const NEAR_BLACK_TEXT = 0.02;
const DARK_BACKGROUND = 0.1;

const SCREENS = [
    { name: 'Home', open: async (page, c) => { await go(page, c, ''); } },
    { name: 'Inbox', open: async (page, c) => { await go(page, c, '/inbox'); } },
    { name: 'Inbox, approval tab', open: async (page, c) => { await go(page, c, '/inbox?tab=approval'); } },
    { name: 'Project List', open: async (page, c) => { await go(page, c, projectPath(c, 'ProjectListView')); } },
    { name: 'Project Board', open: async (page, c) => { await go(page, c, projectPath(c, 'ProjectKanban')); } },
    { name: 'Project Table', open: async (page, c) => { await go(page, c, projectPath(c, 'TableView')); } },
    { name: 'Project Calendar', open: async (page, c) => { await go(page, c, projectPath(c, 'Calendar')); } },
    { name: 'Project Gantt', open: async (page, c) => { await go(page, c, projectPath(c, 'GanttView')); } },
    { name: 'Project details', open: async (page, c) => { await go(page, c, projectPath(c, 'ProjectDetail')); } },
    {
        name: 'Task panel',
        open: async (page, c) => {
            await go(page, c, `/project/${c.project._id}/s/${c.task.sprintId}?task=${c.task._id}`);
            await expect(page.getByRole('dialog', { name: 'Task detail' })).toBeVisible();
            await settle(page);
        },
    },
    { name: 'Everything', open: async (page, c) => { await go(page, c, '/everything'); } },
    { name: 'Goals', open: async (page, c) => { await go(page, c, '/goals'); } },
    { name: 'Docs', open: async (page, c) => { await go(page, c, '/pages'); } },
    { name: 'Chat', open: async (page, c) => { await go(page, c, '/chat'); } },
    { name: 'Timesheet', open: async (page, c) => { await go(page, c, '/timesheet/user'); } },
    { name: 'Members', open: async (page, c) => { await go(page, c, '/settings/members'); } },
    { name: 'Settings, My profile', open: async (page, c) => { await go(page, c, '/settings/my-profile'); } },
    { name: 'Settings, AI routing policy', open: async (page, c) => { await go(page, c, '/settings/routing-policy'); } },
    { name: 'Settings, General (AI switch)', open: async (page, c) => { await go(page, c, '/settings/setting'); } },
    { name: 'Connect your AI', open: async (page, c) => { await go(page, c, '/ai/connect'); } },
    {
        name: 'Quick create dialog',
        open: async (page, c) => {
            await go(page, c, '');
            await page.evaluate(() => document.activeElement && document.activeElement.blur());
            await page.keyboard.press('c');
            await expect(page.getByRole('dialog', { name: 'New task' })).toBeVisible();
            await settle(page);
        },
    },
    {
        name: 'Add view menu',
        open: async (page, c) => {
            await go(page, c, projectPath(c, 'ProjectListView'));
            const add = page.locator('.ph2__tab--add');
            await add.scrollIntoViewIfNeeded();
            await add.click();
            await expect(page.getByRole('dialog').first()).toBeVisible();
            await settle(page);
        },
    },
];

const projectPath = (c, tab) => `/project/${c.project._id}/p?tab=${tab}`;

async function settle(page) {
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);
}

async function go(page, c, route) {
    await page.goto(`/#/${c.companyId}${route}`);
    await expect(page.getByRole('main').first()).toBeVisible();
    await expect(page.locator('.ah-state')).toHaveCount(0);
    await settle(page);
}

async function makeContext() {
    const state = readState();
    const owner = await loginAs('owner', { state });
    const project = await createProject(owner.api, { name: `NARROW DARK ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
    const task = await createTask(owner.api, { project, name: 'A task with a longer name than the screen is wide on a phone', user: state.users.owner, companyOwnerId: owner.uid });
    await createTask(owner.api, { project, name: `Second ${uniqueSuffix()}`, user: state.users.owner, companyOwnerId: owner.uid });
    return { companyId: state.companyId, project, task, api: owner.api };
}

const dropProject = (c) => c.api.put(`/api/v1/project/${c.project._id}`, { updateObject: { deletedStatusKey: 1 } });

const sidewaysScroll = ({ allow }) => {
    const width = window.innerWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    if (scrollWidth <= width + 1) return { scrollWidth, width, offenders: [] };

    const name = (el) => {
        const classes = [...el.classList].slice(0, 2).map((c) => `.${c}`).join('');
        return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${classes}`;
    };
    const clipped = (el) => {
        for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.position === 'fixed' || style.overflowX !== 'visible') return true;
        }
        return false;
    };

    const offenders = [];
    for (const el of document.body.querySelectorAll('*')) {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.position === 'fixed') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.right <= width + 1 || clipped(el)) continue;
        if (allow.some((selector) => el.closest(selector))) continue;
        offenders.push({ name: name(el), right: Math.round(rect.right), elementWidth: Math.round(rect.width), text: (el.textContent || '').trim().slice(0, 30) });
    }
    offenders.sort((a, b) => b.right - a.right || b.elementWidth - a.elementWidth);
    return { scrollWidth, width, offenders, allowed: offenders.length === 0 && allow.length > 0 };
};

const darkAudit = ({ allow, lightest, nearBlack, darkBackground }) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const paint = canvas.getContext('2d', { willReadFrequently: true });
    const parsed = new Map();
    const rgba = (css) => {
        if (parsed.has(css)) return parsed.get(css);
        let out;
        const plain = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(css);
        if (plain) {
            const alpha = plain[4] === undefined ? 1 : plain[4].endsWith('%') ? parseFloat(plain[4]) / 100 : parseFloat(plain[4]);
            out = [Number(plain[1]), Number(plain[2]), Number(plain[3]), alpha];
        } else {
            paint.clearRect(0, 0, 1, 1);
            paint.fillStyle = '#000';
            paint.fillStyle = css;
            paint.fillRect(0, 0, 1, 1);
            const [r, g, b, a] = paint.getImageData(0, 0, 1, 1).data;
            out = [r, g, b, a / 255];
        }
        parsed.set(css, out);
        return out;
    };
    const luminance = ([r, g, b]) => {
        const lin = (v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const over = (top, bottom) => {
        const alpha = top[3] + bottom[3] * (1 - top[3]);
        if (alpha === 0) return [0, 0, 0, 0];
        return [0, 1, 2].map((i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / alpha).concat(alpha);
    };
    const hex = (c) => `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
    const lightestLuminance = luminance(rgba(lightest));

    const userChosen = (el) => /background|--[\w-]*(bg|colou?r|tint)/i.test(el.getAttribute('style') || '');
    const background = (el) => {
        const layers = [];
        let chosen = false;
        for (let node = el; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.backgroundImage !== 'none') return null;
            const colour = rgba(style.backgroundColor);
            if (colour[3] > 0) {
                layers.push(colour);
                if (userChosen(node)) chosen = true;
                if (colour[3] >= 1) break;
            }
        }
        if (!layers.length || layers[layers.length - 1][3] < 1) return null;
        let result = layers[layers.length - 1];
        for (let i = layers.length - 2; i >= 0; i--) result = over(layers[i], result);
        return chosen ? null : result;
    };
    const visible = (el, style) => {
        if (style.display === 'none' || style.visibility !== 'visible' || parseFloat(style.opacity) === 0) return false;
        let rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return false;
        for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
            const s = getComputedStyle(node);
            if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
            const box = node.getBoundingClientRect();
            rect = { left: Math.max(rect.left, box.left), right: Math.min(rect.right, box.right), top: Math.max(rect.top, box.top), bottom: Math.min(rect.bottom, box.bottom) };
            if (rect.right - rect.left < 1 || rect.bottom - rect.top < 1) return false;
        }
        return true;
    };
    const hasText = (el) => {
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return /^(text|search|email|url|tel|password|number|date|time|)$/.test(el.type || '') && Boolean(el.value);
        return [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    };
    const name = (el) => {
        const classes = [...el.classList].slice(0, 3).map((c) => `.${c}`).join('');
        const own = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${classes}`;
        const parent = el.parentElement;
        return parent && parent !== document.body ? `${parent.tagName.toLowerCase()}${[...parent.classList].slice(0, 2).map((c) => `.${c}`).join('')} > ${own}` : own;
    };
    const skip = 'img, svg, canvas, video, picture, script, style, noscript, option, optgroup, [class*="avatar" i], [class*="initials" i]';

    const found = new Map();
    for (const el of document.body.querySelectorAll('*')) {
        if (el.closest(skip) || allow.some((selector) => el.closest(selector))) continue;
        if (!hasText(el)) continue;
        const style = getComputedStyle(el);
        if (!visible(el, style)) continue;
        const bg = background(el);
        if (!bg) continue;
        const ink = over(rgba(style.color), bg);
        const bgLuminance = luminance(bg);
        let rule = '';
        if (bgLuminance > lightestLuminance) rule = 'light background';
        else if (luminance(ink) < nearBlack && bgLuminance < darkBackground) rule = 'near-black text on dark';
        if (!rule) continue;
        const key = `${rule}|${name(el)}`;
        if (!found.has(key)) found.set(key, { rule, name: name(el), text: (el.value || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30), bg: hex(bg), ink: hex(ink), count: 0 });
        found.get(key).count += 1;
    }
    return [...found.values()];
};

const forScreen = (list, screen) => list.filter((e) => !e.screens || e.screens.includes(screen)).map((e) => e.selector);

test.describe('390 px wide: nothing scrolls sideways', () => {
    test.use({ ...asRole('owner'), viewport: NARROW });
    let c;
    test.beforeAll(async () => { c = await makeContext(); });
    test.afterAll(async () => { if (c) await dropProject(c); });
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    for (const screen of SCREENS) {
        test(screen.name, async ({ page }) => {
            await screen.open(page, c);
            const result = await page.evaluate(sidewaysScroll, { allow: forScreen(NARROW_ALLOW, screen.name) });
            if (result.scrollWidth <= result.width + 1 || result.allowed) return;
            const [widest, ...rest] = result.offenders;
            const detail = widest
                ? `widest ${widest.name} "${widest.text}" reaches ${widest.right}px (${widest.elementWidth}px wide)${rest.length ? `; also ${rest.slice(0, WIDEST_FIRST).map((o) => `${o.name} ${o.right}px`).join(', ')}` : ''}`
                : 'no element reaches past the edge (a pseudo-element or transform?)';
            expect(false, `${screen.name}: the page is ${result.scrollWidth}px wide in a ${result.width}px window: ${detail}`).toBe(true);
        });
    }
});

test.describe('dark mode: no white panels or black text on dark', () => {
    test.use({ ...asRole('owner'), colorScheme: 'dark' });
    let c;
    test.beforeAll(async () => { c = await makeContext(); });
    test.afterAll(async () => { if (c) await dropProject(c); });
    test.beforeEach(async ({ page }) => {
        await skipFirstRun(page);
        await page.addInitScript(() => localStorage.setItem('ah.theme', 'dark'));
    });

    for (const screen of SCREENS) {
        test(screen.name, async ({ page }) => {
            await screen.open(page, c);
            await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
            const found = await page.evaluate(darkAudit, {
                allow: forScreen(DARK_ALLOW, screen.name),
                lightest: LIGHTEST_BACKGROUND,
                nearBlack: NEAR_BLACK_TEXT,
                darkBackground: DARK_BACKGROUND,
            });
            const lines = found.map((f) => `${f.rule}: ${f.name} "${f.text}" ink ${f.ink} on ${f.bg} (${f.count}x)`);
            expect(lines, `${screen.name} in dark mode`).toEqual([]);
        });
    }
});
