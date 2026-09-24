import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, nextTick, ref } from 'vue';
import { focusableIn, useFocusTrap, wrapTab } from '@/composable/useFocusTrap';

// jsdom lays nothing out, so every element would read as hidden.
const realRects = Element.prototype.getClientRects;
beforeEach(() => { Element.prototype.getClientRects = () => [{}]; });
afterEach(() => {
    Element.prototype.getClientRects = realRects;
    document.body.innerHTML = '';
});

const tab = (target, shiftKey = false) => {
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
};

const Host = defineComponent({
    setup() {
        const open = ref(false);
        const panel = ref(null);
        useFocusTrap(panel, open);
        return { open, panel };
    },
    template: `
        <div>
            <button id="opener" @click="open = true">open</button>
            <button id="behind">behind</button>
            <div v-if="open" ref="panel" tabindex="-1" id="panel">
                <button id="first">first</button>
                <input id="middle" />
                <button id="disabled" disabled>off</button>
                <button id="skipped" tabindex="-1">skipped</button>
                <button id="last" @click="open = false">close</button>
            </div>
        </div>`,
});

describe('focusableIn', () => {
    it('lists tabbable controls in order and skips disabled or tabindex -1 ones', () => {
        document.body.innerHTML = '<div id="r"><button id="a">a</button><button disabled>x</button><span tabindex="-1">y</span><a href="#" id="b">b</a><div aria-hidden="true"><button>z</button></div></div>';
        expect(focusableIn(document.getElementById('r')).map((el) => el.id)).toEqual(['a', 'b']);
    });
});

describe('wrapTab', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="r" tabindex="-1"><button id="a">a</button><button id="b">b</button></div><button id="out">out</button>';
    });
    const root = () => document.getElementById('r');

    it('moves Tab from the last control back to the first', () => {
        const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
        Object.defineProperty(event, 'target', { value: document.getElementById('b') });
        expect(wrapTab(event, root())).toBe(true);
        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement.id).toBe('a');
    });

    it('moves Shift+Tab from the first control, or from the container, to the last', () => {
        for (const from of ['a', 'r']) {
            const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true });
            Object.defineProperty(event, 'target', { value: document.getElementById(from) });
            expect(wrapTab(event, root())).toBe(true);
            expect(document.activeElement.id).toBe('b');
        }
    });

    it('leaves focus that is outside the container, and events already handled, alone', () => {
        const outside = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
        Object.defineProperty(outside, 'target', { value: document.getElementById('out') });
        expect(wrapTab(outside, root())).toBe(false);

        const handled = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
        handled.preventDefault();
        Object.defineProperty(handled, 'target', { value: document.getElementById('b') });
        expect(wrapTab(handled, root())).toBe(false);
    });
});

describe('useFocusTrap', () => {
    it('moves focus into the panel on open, keeps Tab inside, and returns focus to the opener on close', async () => {
        const wrapper = mount(Host, { attachTo: document.body });
        const opener = document.getElementById('opener');
        opener.focus();
        await wrapper.find('#opener').trigger('click');
        await nextTick();
        await nextTick();

        expect(document.activeElement.id).toBe('panel');

        const last = document.getElementById('last');
        last.focus();
        expect(tab(last).defaultPrevented).toBe(true);
        expect(document.activeElement.id).toBe('first');

        expect(tab(document.getElementById('first'), true).defaultPrevented).toBe(true);
        expect(document.activeElement.id).toBe('last');

        const middle = document.getElementById('middle');
        middle.focus();
        expect(tab(middle).defaultPrevented).toBe(false);

        await wrapper.find('#last').trigger('click');
        await nextTick();
        expect(document.getElementById('panel')).toBeNull();
        expect(document.activeElement.id).toBe('opener');

        expect(tab(document.getElementById('behind')).defaultPrevented).toBe(false);
        wrapper.unmount();
    });

    it('does not pull focus back when the user has already moved it elsewhere', async () => {
        const wrapper = mount(Host, { attachTo: document.body });
        document.getElementById('opener').focus();
        await wrapper.find('#opener').trigger('click');
        await nextTick();
        await nextTick();
        document.getElementById('behind').focus();
        wrapper.vm.open = false;
        await nextTick();
        expect(document.activeElement.id).toBe('behind');
        wrapper.unmount();
    });
});
