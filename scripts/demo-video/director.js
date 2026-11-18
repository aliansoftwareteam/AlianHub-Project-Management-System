/* eslint-env browser */
const { SHELL, SHELL_TIMEOUT_MS } = require('../atlas/browser');

const SOCKET_PATH = '/socket.io/';
const TYPE_DELAY_MS = 40;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - ((-2 * x + 2) ** 3) / 2);

/* Waits until no request has been in flight for `quietMs`, at most `limitMs`. */
function quiet(page, quietMs = 500, limitMs = 6000) {
    return new Promise((resolve) => {
        const inFlight = new Set();
        let timer = null;
        const done = () => {
            clearTimeout(timer);
            clearTimeout(limit);
            page.off('request', onStart);
            page.off('requestfinished', onEnd);
            page.off('requestfailed', onEnd);
            resolve();
        };
        const arm = () => {
            clearTimeout(timer);
            if (!inFlight.size) timer = setTimeout(done, quietMs);
        };
        const onStart = (request) => {
            if (request.url().includes(SOCKET_PATH)) return;
            inFlight.add(request);
            clearTimeout(timer);
        };
        const onEnd = (request) => {
            inFlight.delete(request);
            arm();
        };
        const limit = setTimeout(done, limitMs);
        page.on('request', onStart);
        page.on('requestfinished', onEnd);
        page.on('requestfailed', onEnd);
        arm();
    });
}

/* Drives one recorded page like a person would, and keeps the caption cues and scene marks for the subtitles. */
class Director {
    constructor(page, { videoStart, baseURL, companyId }) {
        this.page = page;
        this.videoStart = videoStart;
        this.baseURL = baseURL;
        this.companyId = companyId;
        this.t0 = null;
        this.cues = [];
        this.marks = [];
        this.pos = { x: 720, y: 450 };
        this.shown = null;
    }

    begin() {
        this.t0 = Date.now();
        this.offset = (this.t0 - this.videoStart) / 1000;
    }

    t() {
        return (Date.now() - this.t0) / 1000;
    }

    mark(name) {
        this.marks.push({ name, at: this.t() });
    }

    async caption(text, sub = '', { top = false } = {}) {
        this.endCue();
        if (text) this.cues.push({ start: this.t(), end: null, text, sub });
        this.shown = text ? { text, sub, top } : null;
        await this.page.evaluate(([a, b, c]) => window.__demo.caption(a, b, c), [text || '', sub, top]);
    }

    endCue() {
        const open = this.cues.find((cue) => cue.end === null);
        if (open) open.end = this.t();
    }

    async card(options) {
        await this.page.evaluate((o) => window.__demo.card(o), options || {});
    }

    async toasts(on) {
        await this.page.evaluate((o) => window.__demo.toasts(o), on);
    }

    async hold(ms) {
        await sleep(ms);
    }

    async until(second) {
        const wait = (second - this.t()) * 1000;
        if (wait > 0) await sleep(wait);
    }

    async moveTo(x, y, duration = 550) {
        const from = { ...this.pos };
        const steps = Math.max(8, Math.round(duration / 16));
        for (let i = 1; i <= steps; i += 1) {
            const k = ease(i / steps);
            await this.page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k);
            await sleep(duration / steps);
        }
        this.pos = { x, y };
    }

    async centreOf(locator) {
        const target = locator.first();
        await target.waitFor({ state: 'visible', timeout: 20000 });
        await target.scrollIntoViewIfNeeded().catch(() => {});
        const box = await target.boundingBox();
        if (!box) throw new Error('target has no box');
        return { x: Math.round(box.x + Math.min(box.width / 2, 120)), y: Math.round(box.y + box.height / 2) };
    }

    async point(locator, duration) {
        const { x, y } = await this.centreOf(locator);
        await this.moveTo(x, y, duration);
    }

    async click(locator, { pause = 220, duration } = {}) {
        await this.point(locator, duration);
        await sleep(90);
        await this.page.mouse.down();
        await sleep(70);
        await this.page.mouse.up();
        await sleep(pause);
    }

    async type(text, delay = TYPE_DELAY_MS) {
        await this.page.keyboard.type(text, { delay });
    }

    async scroll(locator, dy, { steps = 12, pause = 30 } = {}) {
        if (locator) await this.point(locator, 400);
        for (let i = 0; i < steps; i += 1) {
            await this.page.mouse.wheel(0, dy / steps);
            await sleep(pause);
        }
    }

    async settle(quietMs, limitMs) {
        await quiet(this.page, quietMs, limitMs);
    }

    /* In-app navigation by the hash, so the overlay and caption stay put. */
    async go(route, { limitMs = 8000 } = {}) {
        await this.page.evaluate((hash) => { window.location.hash = hash; }, `#/${this.companyId}${route}`);
        await this.page.locator(SHELL).waitFor({ state: 'visible', timeout: SHELL_TIMEOUT_MS });
        await this.settle(400, limitMs);
    }

    /* A full reload under a short fade; the caption is put back once the page is up again. */
    async reload() {
        await this.page.evaluate(() => window.__demo.fade(true));
        await sleep(260);
        await this.page.reload();
        await this.page.evaluate(() => window.__demo.fade(true));
        await this.page.locator(SHELL).waitFor({ state: 'visible', timeout: SHELL_TIMEOUT_MS });
        await this.settle(500, 8000);
        if (this.shown) await this.page.evaluate(([a, b, c]) => window.__demo.caption(a, b, c), [this.shown.text, this.shown.sub, this.shown.top]);
        await this.page.mouse.move(this.pos.x, this.pos.y);
        await this.page.evaluate(() => window.__demo.fade(false));
        await sleep(260);
    }

    finish() {
        this.endCue();
        return { offset: this.offset, duration: this.t(), cues: this.cues, marks: this.marks };
    }
}

module.exports = { Director, quiet, sleep };
