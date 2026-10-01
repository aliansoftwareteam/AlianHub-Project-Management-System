/* eslint-env browser */
const fs = require('fs');
const { median, summarise } = require('./stats');

const VIEWPORT = { width: 1440, height: 900 };
const LIST_ROW = '.lv2__row:not(.is-sub)';
const BOARD_CARD = '.kanban-card';
const LIST_SCROLLER = '#list_scroll';
const STATUS_PICKER = 'Select Task Status';
const TASK_PANEL = '[role="dialog"][aria-label="Task detail"]';
const TASK_PANEL_CONTENT = `${TASK_PANEL} .task-status-name`;
const SCROLL_MS = 3000;
const LOAD_TIMEOUT_MS = 60000;
const STATUS_CHANGES = 3;
const PAGE_LOAD_REQUESTS = 120;
const INTERACTION_REQUESTS = 100;

/* Returns null when Playwright's Chromium is not on this machine; the measurement never downloads it. */
async function launchBrowser() {
    let chromium;
    try {
        ({ chromium } = require('@playwright/test'));
    } catch (error) {
        return null;
    }
    if (!fs.existsSync(chromium.executablePath())) return null;
    return chromium.launch();
}

/* Runs in the page before the app. It looks once per frame and reports the start of the frame after the one that first
 * showed the thing: by then the browser has laid out and painted it, so the time is at most one frame (17 ms) late and
 * never early. It reads performance.now(), not the frame's own timestamp, which is the scheduled time and runs up to
 * seconds early while the page is busy rendering. The clock starts at navigation and the numbers carry no round trip
 * to this script. The conditions live here because the app's content security policy refuses code passed in as text. */
const instrument = ({ userId, companyId, selectors }) => {
    localStorage.setItem('userId', userId);
    localStorage.setItem('selectedCompany', companyId);
    localStorage.setItem('isLogging', 'true');
    ['shell', 'project', 'board', 'list'].forEach((screen) => localStorage.setItem(`ah.tour.skipped.${screen}`, '1'));
    sessionStorage.setItem('ah.gs.dismissed', '1');

    const visible = (selector) => [...document.querySelectorAll(selector)].some((node) => node.getClientRects().length > 0);
    const afterPaint = (report) => requestAnimationFrame(() => report(performance.now()));
    const firstSeen = {};
    // A page shows one view, so the watch ends at the first match and costs later frames nothing.
    const look = () => {
        const found = selectors.filter(visible);
        if (!found.length) requestAnimationFrame(look);
        else afterPaint((now) => found.forEach((selector) => { firstSeen[selector] = now; }));
    };
    requestAnimationFrame(look);

    const conditions = {
        statusLabelChanged: ({ taskId, before }) => {
            const control = document.querySelector(`.lv2__row[data-task-nav="${taskId}"] .lv2__status`);
            return !control || control.getAttribute('aria-label') !== before;
        },
        shown: ({ selector }) => visible(selector),
    };
    const until = (condition, args) => new Promise((resolve) => {
        const check = () => (conditions[condition](args) ? afterPaint(resolve) : requestAnimationFrame(check));
        requestAnimationFrame(check);
    });

    const nextClick = () => new Promise((resolve) => {
        document.addEventListener('click', (event) => resolve(event.timeStamp), { capture: true, once: true });
    });

    /* Where the time before `seenAt` went: the page's scripts, the wait before the view asks for its tasks, the
     * answer, then drawing. The view's queries are the first burst; later ones (subtask progress) are not waited for. */
    const timeline = (seenAt) => {
        const [navigation] = performance.getEntriesByType('navigation');
        const queries = performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/api/v1/task/find') && entry.startTime < seenAt);
        const sent = queries.length ? Math.min(...queries.map((entry) => entry.startTime)) : null;
        const burst = queries.filter((entry) => entry.startTime <= sent + 100);
        return {
            scriptsReady: navigation ? navigation.domContentLoadedEventEnd : null,
            queriesSent: sent,
            queriesAnswered: burst.length ? Math.max(...burst.map((entry) => entry.responseEnd)) : null,
        };
    };

    window.__scale = { firstSeen, until, nextClick, timeline };
};

const scrollFrames = ({ selector, ms }) => new Promise((resolve) => {
    const scroller = document.querySelector(selector);
    const range = scroller.scrollHeight - scroller.clientHeight;
    const gaps = [];
    const started = performance.now();
    let last = started;
    let direction = 1;
    const frame = (now) => {
        gaps.push(now - last);
        last = now;
        if (scroller.scrollTop >= range) direction = -1;
        if (scroller.scrollTop <= 0) direction = 1;
        scroller.scrollTop += direction * 60;
        if (now - started < ms) requestAnimationFrame(frame);
        else resolve({ fps: (gaps.length * 1000) / (now - started), worstFrameMs: Math.max(...gaps), rangePx: range });
    };
    requestAnimationFrame(frame);
});

/* Milliseconds from the click the app receives until each named condition has been painted. */
async function timeClick(page, { click, conditions }) {
    const clicked = page.evaluate(() => window.__scale.nextClick());
    const shown = conditions.map(([name, payload]) => page.evaluate((wanted) => window.__scale.until(wanted.name, wanted.payload), { name, payload }));
    await click();
    const at = await clicked;
    return Promise.all(shown.map(async (frame) => (await frame) - at));
}

async function pageWeight(page) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('HeapProfiler.collectGarbage');
    const { metrics } = await cdp.send('Performance.getMetrics');
    await cdp.detach();
    const read = (name) => (metrics.find((metric) => metric.name === name) || { value: null }).value;
    return { nodes: read('Nodes'), heapMb: Math.round((read('JSHeapUsedSize') / 1048576) * 10) / 10 };
}

async function loadView({ context, url, selector, loads, room }) {
    const samples = [];
    const timelines = [];
    let page;
    for (let n = 0; n < loads; n += 1) {
        if (page) await page.close();
        await room(PAGE_LOAD_REQUESTS);
        page = await context.newPage();
        await page.goto(url, { waitUntil: 'commit' });
        const seen = await page.waitForFunction((wanted) => window.__scale && window.__scale.firstSeen[wanted], selector, { timeout: LOAD_TIMEOUT_MS });
        samples.push(await seen.jsonValue());
        timelines.push(await page.evaluate((seenAt) => window.__scale.timeline(seenAt), samples[n]));
    }
    await page.waitForLoadState('networkidle').catch(() => {});
    const shown = await page.locator(selector).count();
    const middle = (key) => Math.round(median(timelines.map((timeline) => timeline[key])));
    const timeline = { scriptsReady: middle('scriptsReady'), queriesSent: middle('queriesSent'), queriesAnswered: middle('queriesAnswered') };
    return { page, samples, shown, timeline, weight: await pageWeight(page) };
}

async function changeStatus(page, statuses) {
    const row = page.locator(LIST_ROW).first();
    const taskId = await row.getAttribute('data-task-nav');
    const control = () => page.locator(`.lv2__row[data-task-nav="${taskId}"] button.lv2__status`);
    const picker = page.getByRole('dialog', { name: STATUS_PICKER });
    const nameOf = (label) => (/^Status: (.+), change$/.exec(label || '') || [])[1];
    const samples = [];
    const requests = [];

    const pick = async (status) => {
        const before = await control().getAttribute('aria-label');
        await control().click();
        const option = picker.getByRole('option', { name: status });
        await option.waitFor();
        const saved = page.waitForResponse((response) => response.url().includes('/api/v2/tasks') && response.request().method() === 'PATCH');
        samples.push(...await timeClick(page, { click: () => option.click(), conditions: [['statusLabelChanged', { taskId, before }]] }));
        const response = await saved;
        await response.finished();
        const timing = response.request().timing();
        requests.push(timing.responseEnd - timing.requestStart);
        await picker.waitFor({ state: 'hidden' });
    };

    const original = nameOf(await control().getAttribute('aria-label'));
    const other = statuses.map((status) => status.name).find((name) => name !== original);
    for (let n = 0; n < STATUS_CHANGES; n += 1) {
        await pick(other);
        await pick(original);
    }
    return { samples, requests };
}

async function openTaskPanel(page) {
    const title = page.locator(LIST_ROW).first().locator('.lv2__name');
    const [panel, content] = await timeClick(page, { click: () => title.click(), conditions: [['shown', { selector: TASK_PANEL }], ['shown', { selector: TASK_PANEL_CONTENT }]] });
    await page.locator('.ah-detail__scrim').click({ position: { x: 5, y: 5 } });
    await page.locator(TASK_PANEL).waitFor({ state: 'hidden' });
    return { panel, content };
}

async function measureBrowser({ browser, base, session, list, loads, room, log = () => {} }) {
    const context = await browser.newContext({ viewport: VIEWPORT });
    await context.addCookies([{ name: 'accessToken', value: session.accessToken, url: base }]);
    await context.addInitScript(instrument, { userId: session.userId, companyId: session.companyId, selectors: [LIST_ROW, BOARD_CARD] });
    const viewUrl = (tab) => `${base}/#/${session.companyId}/project/${session.project._id}/s/${list.id}?tab=${tab}`;
    const metric = (key, label, unit, samples, detail) => {
        const row = { key, label, unit, ...summarise(samples), detail };
        log(`${label}: median ${row.median} ${unit}${detail ? `, ${detail}` : ''}`);
        return row;
    };

    const story = ({ samples, timeline }) => `page scripts ready at ${timeline.scriptsReady} ms, task queries sent at ${timeline.queriesSent} ms and answered by ${timeline.queriesAnswered} ms; first load, with an empty browser cache, ${Math.round(samples[0])} ms`;
    const metrics = [];
    /* One failed interaction must not lose the rest of the run: it is reported as not measured, with the reason. */
    const attempt = async (key, label, unit, take) => {
        try {
            metrics.push(...await take());
        } catch (error) {
            const reason = String(error.message || error).split('\n')[0];
            metrics.push({ key, label, unit, ...summarise([]), detail: `not measured: ${reason}` });
            log(`${label}: not measured: ${reason}`);
        }
    };

    try {
        let listPage = null;
        await attempt('list.firstRows', 'List: first rows visible', 'ms', async () => {
            const view = await loadView({ context, url: viewUrl('ProjectListView'), selector: LIST_ROW, loads, room });
            listPage = view.page;
            return [
                metric('list.firstRows', 'List: first rows visible', 'ms', view.samples, `${view.shown} rows shown; ${story(view)}`),
                metric('list.domNodes', 'List: DOM nodes after load', 'nodes', [view.weight.nodes]),
                metric('list.heap', 'List: JS heap after load', 'MB', [view.weight.heapMb]),
            ];
        });
        if (listPage) {
            await attempt('list.scrollFps', `List: scroll frame rate over ${SCROLL_MS / 1000} s`, 'fps', async () => {
                const scrolls = [];
                for (let n = 0; n < 3; n += 1) scrolls.push(await listPage.evaluate(scrollFrames, { selector: LIST_SCROLLER, ms: SCROLL_MS }));
                await listPage.evaluate((selector) => { document.querySelector(selector).scrollTop = 0; }, LIST_SCROLLER);
                return [metric('list.scrollFps', `List: scroll frame rate over ${SCROLL_MS / 1000} s`, 'fps', scrolls.map((run) => run.fps),
                    `worst frame ${Math.round(Math.max(...scrolls.map((run) => run.worstFrameMs)))} ms, ${Math.round(scrolls[0].rangePx)} px to scroll`)];
            });
            await attempt('list.statusChange', 'List: status change, click to visible change', 'ms', async () => {
                await room(INTERACTION_REQUESTS);
                const status = await changeStatus(listPage, session.project.taskStatusData);
                return [
                    metric('list.statusChange', 'List: status change, click to visible change', 'ms', status.samples),
                    metric('list.statusChangeRequest', 'List: status change, the save request', 'ms', status.requests),
                ];
            });
            await attempt('list.openTaskPanel', 'List: open the task panel, click to panel visible', 'ms', async () => {
                await room(INTERACTION_REQUESTS);
                const opened = [];
                for (let n = 0; n < 3; n += 1) opened.push(await openTaskPanel(listPage));
                return [
                    metric('list.openTaskPanel', 'List: open the task panel, click to panel visible', 'ms', opened.map((run) => run.panel)),
                    metric('list.taskPanelContent', 'List: open the task panel, click to the task shown in it', 'ms', opened.map((run) => run.content)),
                ];
            });
            await listPage.close();
        }
        await attempt('board.firstCards', 'Board: first cards visible', 'ms', async () => {
            const view = await loadView({ context, url: viewUrl('ProjectKanban'), selector: BOARD_CARD, loads, room });
            await view.page.close();
            return [
                metric('board.firstCards', 'Board: first cards visible', 'ms', view.samples, `${view.shown} cards shown; ${story(view)}`),
                metric('board.domNodes', 'Board: DOM nodes after load', 'nodes', [view.weight.nodes]),
                metric('board.heap', 'Board: JS heap after load', 'MB', [view.weight.heapMb]),
            ];
        });
        return metrics;
    } finally {
        await context.close();
    }
}

module.exports = { launchBrowser, measureBrowser };
