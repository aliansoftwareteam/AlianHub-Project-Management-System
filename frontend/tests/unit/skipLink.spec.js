import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import SkipLink from '@/components/atom/SkipLink/SkipLink.vue';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = fs.readFileSync(path.resolve(HERE, '../../src/App.vue'), 'utf8');

const mounted = [];
afterEach(() => {
    mounted.splice(0).forEach((w) => w.unmount());
    document.body.innerHTML = '';
});

describe('the skip link', () => {
    it('is the first thing App renders, ahead of the banners and the rail', () => {
        const template = APP.slice(APP.indexOf('<template>') + '<template>'.length);
        expect(template).toMatch(/^\s*<div>\s*<SkipLink\s*\/>/);
        expect(APP).toMatch(/<main[^>]*id="ah-main"/);
    });

    it('is a link to the main region, named from the locale', () => {
        const wrapper = mount(SkipLink, { attachTo: document.body });
        mounted.push(wrapper);
        const link = wrapper.find('a');
        expect(link.attributes('href')).toBe('#ah-main');
        expect(link.text()).toBe('Shell.skip_to_content');
    });

    it('moves focus to main without touching the hash route', async () => {
        const main = document.createElement('main');
        main.id = 'ah-main';
        document.body.appendChild(main);
        const wrapper = mount(SkipLink, { attachTo: document.body });
        mounted.push(wrapper);
        const before = window.location.hash;
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        wrapper.find('a').element.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(window.location.hash).toBe(before);
        expect(document.activeElement).toBe(main);
        expect(main.getAttribute('tabindex')).toBe('-1');
    });
});
