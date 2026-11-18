/* eslint-env browser */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { signInThroughForm } = require('../../e2e/support/pages');
const { SHELL, SHELL_TIMEOUT_MS } = require('../atlas/browser');
const { Director, sleep } = require('./director');
const { installOverlay } = require('./overlay');
const { PASSWORD } = require('./seed');
const { captionPngs } = require('./captions');

const SIZE = { width: 1440, height: 900 };
const PUBLIC_HOST = 'https://demo.alianhub.com';

const log = (message) => process.stdout.write(`${message}\n`);

const hasFfmpeg = () => {
    try {
        execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
        return true;
    } catch (error) {
        return false;
    }
};

const ffmpeg = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });

const stamp = (seconds) => {
    const ms = Math.max(0, Math.round(seconds * 1000));
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};

const srtOf = (cues) => cues.filter((cue) => cue.end - cue.start > 0.2)
    .map((cue, at) => `${at + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}${cue.sub ? ` ${cue.sub}` : ''}\n`).join('\n');

async function storageFor(browser, world) {
    const context = await browser.newContext({ baseURL: world.baseURL, viewport: SIZE });
    try {
        const page = await context.newPage();
        await signInThroughForm(page, { email: world.owner.email, password: PASSWORD, companyId: world.companyId });
        return await context.storageState();
    } finally {
        await context.close();
    }
}

async function film({ browser, world, storageState, name, scene, rawDir }) {
    const context = await browser.newContext({
        baseURL: world.baseURL, viewport: SIZE, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', storageState,
        recordVideo: { dir: rawDir, size: SIZE },
    });
    await context.addInitScript(() => {
        localStorage.setItem('ah.theme', 'light');
        for (const screen of ['shell', 'project', 'board', 'list']) localStorage.setItem(`ah.tour.skipped.${screen}`, '1');
        sessionStorage.setItem('ah.gs.dismissed', '1');
    });
    await context.addInitScript(installOverlay, { hostToHide: world.baseURL, publicHost: PUBLIC_HOST });
    const page = await context.newPage();
    const videoStart = Date.now();
    const d = new Director(page, { videoStart, baseURL: world.baseURL, companyId: world.companyId });
    page.on('pageerror', (error) => log(`[${name}] page error: ${error.message}`));
    await page.goto(`/#/${world.companyId}`);
    await page.evaluate(() => window.__demo.fade(true));
    await page.locator(SHELL).waitFor({ state: 'visible', timeout: SHELL_TIMEOUT_MS });
    await d.settle(800, 10000);
    await sleep(1500);
    await page.mouse.move(d.pos.x, d.pos.y);
    await page.evaluate(() => window.__demo.fade(false));
    await sleep(300);
    try {
        await scene(d, world);
    } catch (error) {
        await page.screenshot({ path: path.join(rawDir, `${name}-failure.png`) }).catch(() => {});
        await context.close().catch(() => {});
        throw error;
    }
    const timing = d.finish();
    await context.close();
    const video = await page.video().path();
    return { video, ...timing };
}

/* Captions as images under the video, for the vertical cut (this ffmpeg may lack the subtitles filter). */
async function vertical({ source, cues, target, workDir }) {
    const pngs = await captionPngs(cues, workDir);
    const inputs = ['-i', source];
    pngs.forEach((png) => inputs.push('-i', png.file));
    const chain = ['[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:4,eq=brightness=-0.18[bg]', '[0:v]scale=1080:-2[fg]', '[bg][fg]overlay=0:(H-h)/2-140[base0]'];
    pngs.forEach((png, at) => {
        chain.push(`[base${at}][${at + 1}:v]overlay=(W-w)/2:H-h-230:enable='between(t,${png.start.toFixed(2)},${png.end.toFixed(2)})'[base${at + 1}]`);
    });
    ffmpeg([...inputs, '-filter_complex', chain.join(';'), '-map', `[base${pngs.length}]`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21', '-r', '30', target]);
}

function finishVideo({ name, take, out, poster }) {
    const files = [];
    const srt = path.join(out, `${name}.srt`);
    fs.writeFileSync(srt, srtOf(take.cues));
    files.push(srt);
    const webm = path.join(out, `${name}.webm`);
    if (!hasFfmpeg()) {
        fs.copyFileSync(take.video, webm);
        files.push(webm);
        return { files, skipped: 'ffmpeg is not installed: the webm is untrimmed, and no mp4, vertical cut or poster was made' };
    }
    const range = ['-ss', take.offset.toFixed(3), '-t', take.duration.toFixed(3)];
    ffmpeg([...range, '-i', take.video, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '33', '-deadline', 'good', '-cpu-used', '5', '-row-mt', '1', '-an', webm]);
    files.push(webm);
    const mp4 = path.join(out, `${name}.mp4`);
    ffmpeg(['-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', mp4]);
    files.push(mp4);
    const png = path.join(out, `${name}-poster.png`);
    ffmpeg(['-ss', String(poster), '-i', mp4, '-frames:v', '1', png]);
    files.push(png);
    return { files, mp4 };
}

function reviewFrames({ name, mp4, marks, duration }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `demo-video-${name}-frames-`));
    const points = marks.map((mark, at) => {
        const next = marks[at + 1] ? marks[at + 1].at : duration;
        return { name: mark.name, at: mark.at + (next - mark.at) * 0.7 };
    });
    for (const point of points) ffmpeg(['-ss', point.at.toFixed(2), '-i', mp4, '-frames:v', '1', '-vf', 'scale=960:-2', path.join(dir, `${point.at.toFixed(1).padStart(5, '0')}-${point.name}.png`)]);
    return dir;
}

async function record({ world, out, only }) {
    fs.mkdirSync(out, { recursive: true });
    const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-video-raw-'));
    const browser = await chromium.launch();
    const report = [];
    try {
        const storageState = await storageFor(browser, world);
        const takes = [
            ['promo-60s', () => require('./promo')],
            ['how-to-use', () => require('./howTo')],
        ].filter(([name]) => !only || name.startsWith(only));
        for (const [name, load] of takes) {
            const { scene, POSTER_AT } = load();
            log(`recording ${name}`);
            const take = await film({ browser, world, storageState, name, scene, rawDir });
            log(`${name}: ${take.duration.toFixed(1)}s, scenes ${take.marks.map((m) => `${m.name}@${m.at.toFixed(1)}`).join(' ')}`);
            const done = finishVideo({ name, take, out, poster: POSTER_AT });
            if (done.mp4 && name === 'promo-60s') {
                const target = path.join(out, `${name}-vertical.mp4`);
                await vertical({ source: done.mp4, cues: take.cues, target, workDir: rawDir });
                done.files.push(target);
            }
            if (done.mp4) log(`review frames: ${reviewFrames({ name, mp4: done.mp4, marks: take.marks, duration: take.duration })}`);
            report.push({ name, duration: take.duration, files: done.files, skipped: done.skipped });
        }
    } finally {
        await browser.close();
    }
    for (const entry of report) log(`${entry.name} (${entry.duration.toFixed(1)}s):\n  ${entry.files.join('\n  ')}${entry.skipped ? `\n  ${entry.skipped}` : ''}`);
    log(`raw recordings kept in ${rawDir}`);
    return report;
}

module.exports = { record };
