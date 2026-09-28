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

const HEAD_SEARCH_LISTBOX = `
    <DropDown mode="listbox" id="assignee" title="Assignee">
        <template #button>{{ status }}</template>
        <template #head><input type="text" class="search" v-model="query"></template>
        <template #options>
            <DropDownOption v-for="name in statuses" :key="name" :selected="name === status" @click="status = name">{{ name }}</DropDownOption>
        </template>
    </DropDown>`;

const SEARCH_SLOT_LISTBOX = `
    <DropDown mode="listbox" id="skills" title="Skills">
        <template #button>{{ status }}</template>
        <template #search><input type="search" class="search" v-model="query"></template>
        <template #options>
            <DropDownOption v-for="name in statuses" :key="name" :selected="name === status" @click="status = name">{{ name }}</DropDownOption>
        </template>
    </DropDown>`;

const MARKED_FIELD_MENU = `
    <DropDown mode="menu" id="marked" title="Tags">
        <template #button>Tags</template>
        <template #head><input type="text" class="first"><input type="text" class="marked" data-dropdown-autofocus></template>
        <template #options>
            <DropDownOption @click="picked.push('edit')">Edit</DropDownOption>
        </template>
    </DropDown>`;

const MULTI_LISTBOX = `
    <DropDown mode="listbox" id="labels" title="Labels" multiselectable>
        <template #button>Labels</template>
        <template #options>
            <DropDownOption v-for="name in statuses" :key="name" :selected="chosen.includes(name)" @click="toggle(name)">
                <input type="checkbox" :checked="chosen.includes(name)">{{ name }}
            </DropDownOption>
        </template>
    </DropDown>`;

const FORM_DIALOG = `
    <DropDown mode="dialog" id="savefilter" title="Save filter">
        <template #button>Save filters</template>
        <template #options>
            <input type="text" class="name">
            <select class="scope"><option>Me</option><option>Team</option></select>
            <button type="button" class="save" @click="picked.push('save')">Save</button>
        </template>
    </DropDown>`;

const ACTION_LISTBOX = `
    <DropDown mode="listbox" id="watchers" title="Watchers" multiselectable>
        <template #button>Watchers</template>
        <template #options>
            <DropDownOption v-for="name in statuses" :key="name" :selected="chosen.includes(name)" @click="toggle(name)">
                {{ name }}
                <template v-if="name === 'Doing'">
                    <button type="button" class="rename" data-option-action aria-label="Rename Doing" @click.stop="picked.push('rename')"></button>
                    <button type="button" class="remove" data-option-action aria-label="Remove Doing" @click.stop="picked.push('remove')"></button>
                </template>
                <button v-if="name === 'Done'" type="button" class="unmarked" aria-label="Unmarked" @click.stop="picked.push('unmarked')"></button>
            </DropDownOption>
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
        setup: () => {
            const chosen = ref([]);
            const toggle = (name) => {
                chosen.value = chosen.value.includes(name) ? chosen.value.filter((n) => n !== name) : [...chosen.value, name];
            };
            return { picked: ref([]), status: ref('Doing'), statuses: ['To do', 'Doing', 'Done'], query: ref(''), chosen, toggle };
        },
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
const search = () => document.querySelector('#my-dropdown .search');
const mouseClick = async (el) => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    await flushPromises();
};

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

describe('a search field in the panel', () => {
    const PLACES = [['#head', HEAD_SEARCH_LISTBOX], ['#search', SEARCH_SLOT_LISTBOX]];

    it.each(PLACES)('in %s takes focus when the listbox opens from the keyboard', async (_, template) => {
        await mountUsage(template);
        await press(trigger(), 'Enter');
        expect(active()).toBe(search());
    });

    it.each(PLACES)('in %s takes focus when the listbox opens from the mouse', async (_, template) => {
        await mountUsage(template);
        await mouseClick(trigger());
        expect(active()).toBe(search());
    });

    it('keeps typed keys, Space, Home and End in the field', async () => {
        await mountUsage(HEAD_SEARCH_LISTBOX);
        await press(trigger(), 'Enter');
        for (const key of ['a', ' ', 'Home', 'End']) {
            const event = await press(search(), key);
            expect(event.defaultPrevented).toBe(false);
            expect(active()).toBe(search());
        }
        expect(isOpen()).toBe(true);
    });

    it('ArrowDown moves into the first option and ArrowUp into the last', async () => {
        await mountUsage(SEARCH_SLOT_LISTBOX);
        await press(trigger(), 'Enter');
        await press(search(), 'ArrowDown');
        expect(active()).toBe(items()[0]);
        search().focus();
        await press(search(), 'ArrowUp');
        expect(active()).toBe(items()[2]);
    });

    it('is part of the arrow-key ring: up from the first option and down from the last return to it', async () => {
        await mountUsage(HEAD_SEARCH_LISTBOX);
        await press(trigger(), 'Enter');
        await press(search(), 'ArrowDown');
        await press(active(), 'ArrowUp');
        expect(active()).toBe(search());
        await press(search(), 'ArrowUp');
        await press(active(), 'ArrowDown');
        expect(active()).toBe(search());
    });

    it('Escape from the field closes and returns focus to the trigger', async () => {
        await mountUsage(HEAD_SEARCH_LISTBOX);
        await press(trigger(), 'Enter');
        await press(search(), 'Escape');
        expect(active()).toBe(trigger());
        await settle();
        expect(isOpen()).toBe(false);
    });

    it('from the #search slot sits above the list, outside its role element', async () => {
        await mountUsage(SEARCH_SLOT_LISTBOX);
        await press(trigger(), 'Enter');
        const list = popup();
        expect(list.getAttribute('role')).toBe('listbox');
        expect(list.contains(search())).toBe(false);
        expect(search().compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(list.parentElement.contains(search())).toBe(true);
    });

    it('gives way to an element marked data-dropdown-autofocus', async () => {
        await mountUsage(MARKED_FIELD_MENU);
        await press(trigger(), 'ArrowDown');
        expect(active()).toBe(document.querySelector('#my-dropdown .marked'));
    });

    it.each(PLACES)('in %s takes focus on the mobile sheet and ArrowDown still reaches the options', async (_, template) => {
        setWidth(390);
        await mountUsage(template);
        trigger().click();
        await flushPromises();
        expect(active()).toBe(search());
        await press(search(), 'ArrowDown');
        expect(active()).toBe(items()[0]);
    });
});

describe('a multiselect listbox', () => {
    it('announces aria-multiselectable', async () => {
        await mountUsage(MULTI_LISTBOX);
        await press(trigger(), 'Enter');
        expect(popup().getAttribute('aria-multiselectable')).toBe('true');
    });

    it('is not what a single-select listbox announces', async () => {
        await mountUsage(STATUS_LISTBOX);
        await press(trigger(), 'Enter');
        expect(popup().hasAttribute('aria-multiselectable')).toBe(false);
    });

    it('stays open while several options are picked from the keyboard and the mouse', async () => {
        await mountUsage(MULTI_LISTBOX);
        await press(trigger(), 'Enter');
        // Vue skips a handler attached at the same instant the event started, and fake timers freeze Date.now().
        await settle();
        await press(active(), 'Enter');
        await press(active(), 'ArrowDown');
        await press(active(), ' ');
        await mouseClick(items()[2]);
        await settle();
        expect(isOpen()).toBe(true);
        expect(wrapper.vm.chosen).toEqual(['To do', 'Doing', 'Done']);
        expect(items().map((item) => item.getAttribute('aria-selected'))).toEqual(['true', 'true', 'true']);
    });

    it('makes a checkbox inside an option presentational, so focus stays on the option', async () => {
        await mountUsage(MULTI_LISTBOX);
        await press(trigger(), 'Enter');
        const boxes = [...document.querySelectorAll('#my-dropdown input[type="checkbox"]')];
        expect(boxes).toHaveLength(3);
        boxes.forEach((box) => {
            expect(box.getAttribute('tabindex')).toBe('-1');
            expect(box.getAttribute('aria-hidden')).toBe('true');
        });
    });
});

describe('a dialog dropdown holding a form', () => {
    const panel = () => document.querySelector('#my-dropdown .drop-down-menu');
    const field = (name) => document.querySelector(`#my-dropdown .${name}`);

    it('announces a dialog on the trigger and labels the panel with it', async () => {
        await mountUsage(FORM_DIALOG);
        const button = trigger();
        expect(button.tagName).toBe('BUTTON');
        expect(button.getAttribute('aria-haspopup')).toBe('dialog');
        expect(button.getAttribute('aria-expanded')).toBe('false');
        button.click();
        await flushPromises();
        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(popup()).toBe(panel());
        expect(panel().getAttribute('role')).toBe('dialog');
        expect(panel().getAttribute('aria-labelledby')).toBe(button.id);
        expect(document.querySelector('#my-dropdown .drop-down-options').hasAttribute('role')).toBe(false);
    });

    it('takes an aria-label instead of the trigger when one is given', async () => {
        await mountUsage(FORM_DIALOG.replace('mode="dialog"', 'mode="dialog" aria-label="Name this filter"'));
        trigger().click();
        await flushPromises();
        expect(panel().getAttribute('aria-label')).toBe('Name this filter');
        expect(panel().hasAttribute('aria-labelledby')).toBe(false);
    });

    it.each([['keyboard', (el) => press(el, 'Enter')], ['mouse', mouseClick]])('focuses the first field when opened from the %s', async (_, openWith) => {
        await mountUsage(FORM_DIALOG);
        await openWith(trigger());
        expect(active()).toBe(field('name'));
    });

    it('keeps Tab and Shift+Tab inside the panel across the fields and the button', async () => {
        await mountUsage(FORM_DIALOG);
        await press(trigger(), 'Enter');
        const order = [];
        for (let i = 0; i < 3; i++) {
            const event = await press(active(), 'Tab');
            expect(event.defaultPrevented).toBe(true);
            order.push(active().className);
        }
        expect(order).toEqual(['scope', 'save', 'name']);
        const event = await press(active(), 'Tab', { shiftKey: true });
        expect(event.defaultPrevented).toBe(true);
        expect(active()).toBe(field('save'));
        expect(isOpen()).toBe(true);
    });

    it('leaves arrow keys, Space and Enter to the fields and buttons', async () => {
        await mountUsage(FORM_DIALOG);
        await press(trigger(), 'Enter');
        await settle();
        for (const key of ['ArrowDown', 'ArrowUp', 'Home', ' ', 'Enter']) {
            const event = await press(field('name'), key);
            expect(event.defaultPrevented).toBe(false);
            expect(active()).toBe(field('name'));
        }
        field('save').focus();
        field('save').click();
        await settle();
        expect(wrapper.vm.picked).toEqual(['save']);
        expect(isOpen()).toBe(true);
    });

    it('Escape closes and returns focus to the trigger', async () => {
        await mountUsage(FORM_DIALOG);
        await press(trigger(), 'Enter');
        await press(field('scope'), 'Escape');
        expect(active()).toBe(trigger());
        await settle();
        expect(isOpen()).toBe(false);
    });

    it('is a modal dialog with the same trap on the mobile sheet', async () => {
        setWidth(390);
        await mountUsage(FORM_DIALOG);
        trigger().click();
        await flushPromises();
        expect(panel().getAttribute('role')).toBe('dialog');
        expect(panel().getAttribute('aria-modal')).toBe('true');
        expect(active()).toBe(field('name'));
        field('save').focus();
        const event = await press(field('save'), 'Tab');
        expect(event.defaultPrevented).toBe(true);
        expect(panel().contains(active())).toBe(true);
    });
});

describe('an option holding its own action, marked data-option-action', () => {
    const control = (name) => document.querySelector(`#my-dropdown .${name}`);
    const openOnDoing = async () => {
        await mountUsage(ACTION_LISTBOX);
        await press(trigger(), 'Enter');
        await settle();
        await press(active(), 'ArrowDown');
        expect(active()).toBe(items()[1]);
    };

    it('ArrowRight moves from the option to its actions in order, ArrowLeft walks back to the option', async () => {
        await openOnDoing();
        let event = await press(active(), 'ArrowRight');
        expect(event.defaultPrevented).toBe(true);
        expect(active()).toBe(control('rename'));
        await press(active(), 'ArrowRight');
        expect(active()).toBe(control('remove'));
        await press(active(), 'ArrowRight');
        expect(active()).toBe(control('remove'));
        await press(active(), 'ArrowLeft');
        expect(active()).toBe(control('rename'));
        event = await press(active(), 'ArrowLeft');
        expect(event.defaultPrevented).toBe(true);
        expect(active()).toBe(items()[1]);
    });

    it.each(['Enter', ' '])('%j runs the focused action without picking its option, and the panel stays open', async (key) => {
        await openOnDoing();
        await press(active(), 'ArrowRight');
        await press(active(), 'ArrowRight');
        const event = await press(active(), key);
        expect(event.defaultPrevented).toBe(true);
        expect(wrapper.vm.picked).toEqual(['remove']);
        expect(wrapper.vm.chosen).toEqual([]);
        await settle();
        expect(isOpen()).toBe(true);
    });

    it('Space released on an action does not click it a second time', async () => {
        await openOnDoing();
        await press(active(), 'ArrowRight');
        const keyup = new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true });
        active().dispatchEvent(keyup);
        expect(keyup.defaultPrevented).toBe(true);
    });

    it('ArrowDown and ArrowUp from an action move to the options around its own option', async () => {
        await openOnDoing();
        await press(active(), 'ArrowRight');
        await press(active(), 'ArrowDown');
        expect(active()).toBe(items()[2]);
        await press(active(), 'ArrowUp');
        await press(active(), 'ArrowRight');
        await press(active(), 'ArrowUp');
        expect(active()).toBe(items()[0]);
    });

    it('Escape on an action returns focus to its option; Escape again closes', async () => {
        await openOnDoing();
        await press(active(), 'ArrowRight');
        const event = await press(active(), 'Escape');
        expect(event.defaultPrevented).toBe(true);
        expect(active()).toBe(items()[1]);
        await settle();
        expect(isOpen()).toBe(true);
        await press(active(), 'Escape');
        expect(active()).toBe(trigger());
        await settle();
        expect(isOpen()).toBe(false);
    });

    it('Tab on an action still closes and hands focus back to the trigger', async () => {
        await openOnDoing();
        await press(active(), 'ArrowRight');
        const event = await press(active(), 'Tab');
        expect(event.defaultPrevented).toBe(false);
        expect(active()).toBe(trigger());
        await settle();
        expect(isOpen()).toBe(false);
    });

    it('leaves an option with no marked action alone on ArrowRight', async () => {
        await openOnDoing();
        await press(active(), 'ArrowDown');
        expect(active()).toBe(items()[2]);
        const event = await press(active(), 'ArrowRight');
        expect(event.defaultPrevented).toBe(false);
        expect(active()).toBe(items()[2]);
    });
});
