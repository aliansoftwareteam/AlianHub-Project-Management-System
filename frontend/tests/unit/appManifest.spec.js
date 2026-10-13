import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const PUBLIC = path.resolve(__dirname, '../../public');
const read = (file) => fs.readFileSync(path.join(PUBLIC, file), 'utf8');
const manifest = () => JSON.parse(read('manifest.webmanifest'));
const html = () => read('index.html');
const tokens = () => fs.readFileSync(path.resolve(__dirname, '../../src/assets/css/tokens.css'), 'utf8');

const canvasOf = (selector) => {
    const block = tokens().split(selector)[1] || '';
    return (/--canvas:\s*(#[0-9a-f]{6})/i.exec(block) || [])[1];
};

const pngSize = (file) => {
    const bytes = fs.readFileSync(path.join(PUBLIC, file));
    expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
    return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
};

describe('web app manifest', () => {
    it('names the app and opens it standalone from the root', () => {
        const m = manifest();
        expect(m.name).toBeTruthy();
        expect(m.short_name.length).toBeLessThanOrEqual(12);
        expect(m.description).toBeTruthy();
        expect(m).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone' });
    });

    it('does not point at a workspace or at the API', () => {
        const text = read('manifest.webmanifest');
        expect(text).not.toMatch(/\/api\//);
        expect(text).not.toMatch(/[0-9a-f]{24}/i);
        expect(manifest().shortcuts).toBeUndefined();
    });

    it('lists 192 and 512 pixel icons, plain and maskable, that exist at those sizes', () => {
        const icons = manifest().icons;
        for (const purpose of ['any', 'maskable']) {
            for (const sizes of ['192x192', '512x512']) {
                const icon = icons.find((entry) => entry.purpose === purpose && entry.sizes === sizes);
                expect(icon, `${purpose} ${sizes}`).toBeTruthy();
                expect(icon.type).toBe('image/png');
                expect(pngSize(icon.src)).toBe(sizes);
            }
        }
    });

    it('takes its colours from the light canvas token', () => {
        const light = canvasOf(':root {');
        expect(light).toBeTruthy();
        expect(manifest().background_color.toLowerCase()).toBe(light.toLowerCase());
        expect(manifest().theme_color.toLowerCase()).toBe(light.toLowerCase());
    });
});

describe('index.html', () => {
    it('links the manifest and a 180 pixel touch icon from the build', () => {
        expect(html()).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest">/);
        expect(html()).toMatch(/<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png">/);
        expect(pngSize('icons/apple-touch-icon.png')).toBe('180x180');
    });

    it('sets the browser chrome colour for light and for dark from the canvas tokens', () => {
        const metas = [...html().matchAll(/<meta name="theme-color" media="\(prefers-color-scheme: (light|dark)\)" content="(#[0-9a-f]{6})">/gi)]
            .map(([, scheme, colour]) => [scheme, colour.toLowerCase()]);
        expect(Object.fromEntries(metas)).toEqual({
            light: canvasOf(':root {').toLowerCase(),
            dark: canvasOf(':root[data-theme="dark"] {').toLowerCase(),
        });
        expect(html().match(/name="theme-color"/g)).toHaveLength(2);
    });
});
