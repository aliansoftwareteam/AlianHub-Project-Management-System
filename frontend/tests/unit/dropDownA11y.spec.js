import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';

const ids = vi.hoisted(() => ({ next: 0 }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ debounce: (fn) => fn, makeUniqueId: () => `u${++ids.next}` }),
}));

import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';

const ROW_MENU = `
    <DropDown mode="menu" id="row" title="Row actions">
        <template #button><img src="dots.svg" alt="More actions"></template>
        <template #options>
            <DropDownOption @click="picked.push('edit')">Edit</DropDownOption>
            <DropDownOption @click="picked.push('duplicate')">Duplicate</DropDownOption>
            <DropDownOption @click="picked.push('delete')">Delete</DropDownOption>
        </template>
    </DropDown>`;

const STATUS_LISTBOX = `
    <DropDown mode="listbox" id="status" title="Status">
        <template #button="{ triggerAttrs }">
            <button type="button" class="status-button" v-bind="triggerAttrs">{{ status }}</button>
        </template>
        <template #options>
            <DropDownOption v-for="name in statuses" :key="name" :selected="name === status" @click="status = name">{{ name }}</DropDownOption>
        </template>
    </DropDown>`;

const HOVER_MENU = `
    <DropDown mode="menu" id="hours" :hover="true">
        <template #button>2h logged</template>
        <template #options>
            <DropDownOption @click="picked.push('tracked')">Tracked 1h</DropDownOption>
            <DropDownOption @click="picked.push('manual')">Manual 1h</DropDownOption>
        </template>
    </DropDown>`;

const LEGACY = `
    <DropDown id="legacy">
        <template #button><span class="legacy-label">Sort</span></template>
        <template #options>
            <DropDownOption @click="picked.push('name')">Name</DropDownOption>
        </template>
    </DropDown>`;

let width = 1280;
const setWidth = (value) => { width = value; };
Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, get: () => width });
Object.defineProperty(document.body, 'clientWidth', { configurable: true, get: () => width });

let wrapper;
const mountUsage = async (template) => {
    wrapper = mount(defineComponent({
        components: { DropDown, DropDownOption },
        setup: () => ({ picked: ref([]), status: ref('Doing'), statuses: ['To do', 'Doing', 'Done'] }),
        template: `<div>${template}</div>`,
    }), { attachTo: '#app' });
    await flushPromises();
    return wrapper;
};

const trigger = () => document.querySelector('[aria-haspopup]');
const popup = () => document.getElementById(trigger().getAttribute('aria-controls'));
const items = () => [...document.querySelectorAll('#my-dropdown [role="menuitem"], #my-dropdown [role="option"]')];
const active = () => document.activeElement;
const press = async (el, key, init = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(event);
    await flushPromises();
    return event;
};
const settle = async () => {
    vi.advanceTimersByTime(150);
    await flushPromises();
};
const isOpen = () => document.querySelector('#my-dropdown .drop-down-menu') !== null;

beforeEach(() => {
    vi.useFakeTimers();
    setWidth(1280);
    document.body.innerHTML = '<div id="my-dropdown"></div><div id="app"></div>';
});

afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
});

describe('a dropdown without a mode', () => {
    it('keeps its old markup: a clickable div trigger and options without roles', async () => {
        await mountUsage(LEGACY);
        expect(document.querySelector('button')).toBeNull();
        expect(document.querySelector('[aria-haspopup]')).toBeNull();
        document.querySelector('.legacy-label').click();
        await flushPromises();
        expect(isOpen()).toBe(true);
        expect(document.querySelector('.drop-down-options').hasAttribute('role')).toBe(false);
        const option = document.querySelector('.drop-down-item');
        expect(option.hasAttribute('role')).toBe(false);
        expect(option.hasAttribute('tabindex')).toBe(false);
    });
});

describe('the trigger', () => {
    it('is a real button that announces a menu and the panel it controls (click)', async () => {
        await mountUsage(ROW_MENU);
        const button = trigger();
        expect(button.tagName).toBe('BUTTON');
        expect(button.getAttribute('type')).toBe('button');
        expect(button.getAttribute('aria-haspopup')).toBe('menu');
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(button.querySelector('button')).toBeNull();
        button.click();
        await flushPromises();
        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(popup()).not.toBeNull();
        expect(popup().getAttribute('role')).toBe('menu');
    });

    it('is the call site\'s own button when it binds triggerAttrs, with no second button around it', async () => {
        await mountUsage(STATUS_LISTBOX);
        expect(document.querySelectorAll('button')).toHaveLength(1);
        const button = trigger();
        expect(button.classList.contains('status-button')).toBe(true);
        expect(button.getAttribute('aria-haspopup')).toBe('listbox');
        expect(button.getAttribute('aria-expanded')).toBe('false');
        button.click();
        await flushPromises();
        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(popup().getAttribute('role')).toBe('listbox');
    });

    it('carries the same attributes in hover mode', async () => {
        await mountUsage(HOVER_MENU);
        const button = trigger();
        expect(button.tagName).toBe('BUTTON');
        expect(button.getAttribute('aria-haspopup')).toBe('menu');
        expect(button.getAttribute('aria-expanded')).toBe('false');
        button.focus();
        await flushPromises();
        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(popup().getAttribute('role')).toBe('menu');
    });

    it('carries the same attributes on the mobile sheet', async () => {
        setWidth(390);
        await mountUsage(ROW_MENU);
        const button = trigger();
        expect(button.tagName).toBe('BUTTON');
        expect(button.getAttribute('aria-haspopup')).toBe('menu');
        button.click();
        await flushPromises();
        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(document.querySelector('.mobile-view')).not.toBeNull();
        expect(popup().getAttribute('role')).toBe('menu');
    });
});

describe('roles', () => {
    it('a menu exposes menuitems that take roving focus', async () => {
        await mountUsage(ROW_MENU);
        await press(trigger(), 'ArrowDown');
        expect(items()).toHaveLength(3);
        items().forEach((item) => {
            expect(item.getAttribute('role')).toBe('menuitem');
            expect(item.getAttribute('tabindex')).toBe('-1');
            expect(item.hasAttribute('aria-selected')).toBe(false);
        });
    });

    it('a listbox exposes options and marks the current value selected', async () => {
        await mountUsage(STATUS_LISTBOX);
        await press(trigger(), 'ArrowDown');
        expect(items().map((item) => item.getAttribute('role'))).toEqual(['option', 'option', 'option']);
        expect(items().map((item) => item.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    });
});

describe('keys on the trigger', () => {
    it('ArrowDown opens and focuses the first item', async () => {
        await mountUsage(ROW_MENU);
        await press(trigger(), 'ArrowDown');
        expect(isOpen()).toBe(true);
        expect(active()).toBe(items()[0]);
    });

    it('ArrowUp opens and focuses the last item', async () => {
        await mountUsage(ROW_MENU);
        await press(trigger(), 'ArrowUp');
        expect(active()).toBe(items()[2]);
    });

    it.each(['Enter', ' '])('%j opens and focuses the first item without a native click', async (key) => {
        await mountUsage(ROW_MENU);
        const event = await press(trigger(), key);
        expect(event.defaultPrevented).toBe(true);
        expect(isOpen()).toBe(true);
        expect(active()).toBe(items()[0]);
    });

    it('opening a listbox focuses the selected option', async () => {
        await mountUsage(STATUS_LISTBOX);
        await press(trigger(), 'Enter');
        expect(active().textContent.trim()).toBe('Doing');
    });

    it('Escape closes an open dropdown', async () => {
        await mountUsage(ROW_MENU);
        trigger().click();
        await flushPromises();
        await press(trigger(), 'Escape');
        await settle();
        expect(isOpen()).toBe(false);
    });
});

describe('keys inside the panel', () => {
    it('ArrowDown and ArrowUp move focus and wrap around', async () => {
        await mountUsage(ROW_MENU);
        await press(trigger(), 'ArrowDown');
        await press(active(), 'ArrowDown');
        expect(active()).toBe(items()[1]);
        await press(active(), 'ArrowDown');
        await press(active(), 'ArrowDown');
        expect(active()).toBe(items()[0]);
        await press(active(), 'ArrowUp');
        expect(active()).toBe(items()[2]);
        await press(active(), 'ArrowUp');
        expect(active()).toBe(items()[1]);
    });

    it('Home and End jump to the first and last item', async () => {
        await mountUsage(ROW_MENU);
        await press(trigger(), 'ArrowDown');
        await press(active(), 'End');
        expect(active()).toBe(items()[2]);
        await press(active(), 'Home');
        expect(active()).toBe(items()[0]);
    });

    it.each(['Enter', ' '])('%j activates a menuitem, closes the menu and returns focus to the trigger', async (key) => {
        await mountUsage(ROW_MENU);
        await press(trigger(), 'ArrowDown');
        await press(active(), 'ArrowDown');
        const event = await press(active(), key);
        expect(event.defaultPrevented).toBe(true);
        expect(wrapper.vm.picked).toEqual(['duplicate']);
        expect(active()).toBe(trigger());
        await settle();
        expect(isOpen()).toBe(false);
    });

    it.each(['Enter', ' '])('%j picks a listbox option and marks it selected', async (key) => {
        await mountUsage(STATUS_LISTBOX);
        await press(trigger(), 'ArrowDown');
        await press(active(), 'ArrowDown');
        await press(active(), key);
        expect(wrapper.vm.status).toBe('Done');
        expect(items().map((item) => item.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);
    });

    it('Escape closes and returns focus to the trigger', async () => {
        await mountUsage(ROW_MENU);
        await press(trigger(), 'ArrowDown');
        await press(active(), 'Escape');
        expect(active()).toBe(trigger());
        await settle();
        expect(isOpen()).toBe(false);
    });

    it('Escape returns focus to the call site\'s own button', async () => {
        await mountUsage(STATUS_LISTBOX);
        await press(trigger(), 'ArrowDown');
        await press(active(), 'Escape');
        expect(active()).toBe(document.querySelector('.status-button'));
    });

    it('Tab closes and hands focus back to the trigger, so the browser moves on from there', async () => {
        await mountUsage(ROW_MENU);
        await press(trigger(), 'ArrowDown');
        const event = await press(active(), 'Tab');
        expect(event.defaultPrevented).toBe(false);
        expect(active()).toBe(trigger());
        await settle();
        expect(isOpen()).toBe(false);
    });
});

describe('a hover dropdown', () => {
    it('opens on focus without taking focus from the trigger', async () => {
        await mountUsage(HOVER_MENU);
        trigger().focus();
        await flushPromises();
        expect(isOpen()).toBe(true);
        expect(active()).toBe(trigger());
    });

    it.each(['Enter', ' '])('%j moves focus into the open menu', async (key) => {
        await mountUsage(HOVER_MENU);
        trigger().focus();
        await flushPromises();
        await press(trigger(), key);
        expect(isOpen()).toBe(true);
        expect(active()).toBe(items()[0]);
    });

    it('Escape closes it and focus back on the trigger does not reopen it', async () => {
        await mountUsage(HOVER_MENU);
        await press(trigger(), 'Enter');
        await press(active(), 'Escape');
        await settle();
        expect(active()).toBe(trigger());
        expect(isOpen()).toBe(false);
    });
});

describe('the mobile sheet', () => {
    beforeEach(() => setWidth(390));

    it('has a labelled close button', async () => {
        await mountUsage(ROW_MENU);
        trigger().click();
        await flushPromises();
        const close = document.querySelector('#my-dropdown .mobile-title-header button');
        expect(close).not.toBeNull();
        expect(close.getAttribute('type')).toBe('button');
        expect(close.getAttribute('aria-label')).toBe('Common.close');
        close.click();
        await settle();
        expect(isOpen()).toBe(false);
    });

    it('moves focus into the sheet when it opens and keeps it there on Tab and Shift+Tab', async () => {
        await mountUsage(ROW_MENU);
        trigger().click();
        await flushPromises();
        const sheet = document.querySelector('#my-dropdown .mobile-view');
        expect(sheet.getAttribute('aria-modal')).toBe('true');
        expect(sheet.contains(active())).toBe(true);
        const close = sheet.querySelector('.mobile-title-header button');
        close.focus();
        let event = await press(close, 'Tab');
        expect(event.defaultPrevented).toBe(true);
        expect(sheet.contains(active())).toBe(true);
        event = await press(active(), 'Tab', { shiftKey: true });
        expect(event.defaultPrevented).toBe(true);
        expect(sheet.contains(active())).toBe(true);
        expect(isOpen()).toBe(true);
    });

    it('closes on Escape and returns focus to the trigger', async () => {
        await mountUsage(ROW_MENU);
        await press(trigger(), 'Enter');
        await press(active(), 'Escape');
        expect(active()).toBe(trigger());
        await settle();
        expect(isOpen()).toBe(false);
    });
});

describe('the outside-click listener', () => {
    it('closes the panel when the click lands on an SVG element', async () => {
        const errors = [];
        const onError = (event) => { errors.push(event.error); event.preventDefault(); };
        window.addEventListener('error', onError);
        await mountUsage(LEGACY);
        document.querySelector('.legacy-label').click();
        await flushPromises();
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        document.body.appendChild(svg);
        svg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await settle();
        window.removeEventListener('error', onError);
        expect(errors).toEqual([]);
        expect(isOpen()).toBe(false);
    });
});
