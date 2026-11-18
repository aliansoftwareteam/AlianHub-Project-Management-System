/* Task 058: a Tracker timesheet screenshot card shows its image box, with a loading animation, from the first paint.
   The box was sized only on an <img>, so the skeleton WasabiImage draws while it asks for the URL had no height. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { blank } = vi.hoisted(() => ({ blank: (name) => ({ default: { name, render: () => null } }) }));
vi.mock('@/services', () => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({ timeFormat: '12' }) }) }));
vi.mock('@/components/atom/UserProfile/UserProfile.vue', () => blank('UserProfile'));
vi.mock('@/components/atom/PreviewTimelogScreenShot/ScreenShotActivityBar', () => blank('ScreenShotActivityBar'));
vi.mock('@/components/atom/PreviewTimelogScreenShot/PreviewTimelogScreenShot.vue', () => blank('PreviewTimelogScreenShot'));

import { apiRequest } from '@/services';
import ScreenShotDisplay from '@/components/atom/TimesheetView/TrackerTimeSheetView/ScreenShotDisplayComponent.vue';

const css = fs.readFileSync(path.resolve(__dirname, '../../src/components/atom/TimesheetView/TrackerTimeSheetView/ScreenShotDisplayComponent.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
const boxSelector = /([^{}]+)\{[^}]*height:\s*78px/.exec(css)[1].trim();

const AT = new Date(2026, 9, 27, 0, 52).getTime();
const shot = (more = {}) => ({ time: AT, image: 'company-1/tracker/shot.png', userId: 'u1', trackShots: { screenShotTime: AT }, ...more });
const mountCard = (trackshotData) => mount(ScreenShotDisplay, { props: { trackshotData, index: 0, isBorder: false } });
const imageBox = (wrapper) => wrapper.find('.screenShotDisplay__innerImageTimelog');
const scopeOf = (element) => element.getAttributeNames().find((name) => name.startsWith('data-v-'));

describe('a Tracker timesheet screenshot card', () => {
    it('shows a sized, moving skeleton while it asks for the screenshot URL', () => {
        apiRequest.mockReturnValue(new Promise(() => {}));
        const wrapper = mountCard(shot());
        const box = imageBox(wrapper);
        expect(box.element.tagName).toBe('DIV');
        expect(box.classes()).toContain('skelaton-loader');
        expect(box.element.matches(boxSelector)).toBe(true);
        const cardScope = scopeOf(wrapper.find('.screenShotDisplay').element);
        expect(cardScope).toBeTruthy();
        expect(box.element.hasAttribute(cardScope)).toBe(true);
    });

    it('keeps the same box, pulsing, while the screenshot downloads, then shows it', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, statusText: 'https://storage.test/shot-210x118.png' } });
        const wrapper = mountCard(shot());
        await flushPromises();
        const box = imageBox(wrapper);
        expect(box.element.tagName).toBe('IMG');
        expect(box.attributes('src')).toBe('https://storage.test/shot-210x118.png');
        expect(box.element.matches(boxSelector)).toBe(true);
        expect(box.classes()).toContain('skelaton-loader');
        await box.trigger('load');
        expect(box.classes()).not.toContain('skelaton-loader');
    });

    it('pulses a screenshot kept as a full URL until it loads, and opens the preview on click', async () => {
        const wrapper = mountCard(shot({ image: 'https://cdn.test/old-shot.png' }));
        await flushPromises();
        const box = imageBox(wrapper);
        expect(apiRequest).not.toHaveBeenCalled();
        expect(box.element.tagName).toBe('IMG');
        expect(box.attributes('src')).toBe('https://cdn.test/old-shot.png');
        expect(box.attributes('alt')).toBe('TimeTracker.screenshot_preview');
        expect(box.element.matches(boxSelector)).toBe(true);
        expect(box.classes()).toContain('skelaton-loader');
        await box.trigger('load');
        expect(box.classes()).not.toContain('skelaton-loader');
        await box.trigger('click');
        expect(wrapper.emitted('update:getScreenShotForSidebar')).toHaveLength(1);
    });

    it('shows a deleted screenshot as the placeholder, in the same box', () => {
        const box = imageBox(mountCard(shot({ trackShots: { screenShotTime: AT, deleted: true } })));
        expect(box.element.tagName).toBe('IMG');
        expect(box.element.matches(boxSelector)).toBe(true);
        expect(apiRequest).not.toHaveBeenCalled();
    });
});
