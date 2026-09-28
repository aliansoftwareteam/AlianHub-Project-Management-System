import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest, getters, stub } = vi.hoisted(() => ({
    apiRequest: vi.fn(async () => ({ status: 200, data: {} })),
    getters: {},
    stub: (name) => ({ default: { name, render: () => null } })
}));

const ids = vi.hoisted(() => ({ next: 0 }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ debounce: (fn) => fn, makeUniqueId: () => `m${++ids.next}` })
}));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vuex', () => ({ useStore: () => ({ getters, commit: vi.fn() }) }));
vi.mock('@/composable/Validation.js', () => ({ useValidation: () => ({ checkErrors: vi.fn() }) }));
vi.mock('@/components/molecules/Sidebar/Sidebar.vue', () => stub('Sidebar'));

import ProjectSourceSelect from '@/components/molecules/ProjectSourceSelect/ProjectSourceSelect.vue';
import PhoneCountry from '@/components/molecules/CountryPhoneNumberDropdown/PhoneCountry.vue';
import SettingMilestoneStatus from '@/components/molecules/Setting/SettingMilestoneStatus.vue';
import SettingMilestoneWeeklyRange from '@/components/molecules/Setting/SettingMilestoneWeeklyRange.vue';
import allCountries from '@/components/molecules/CountryPhoneNumberDropdown/allCountry.js';

const settle = async (ms = 20) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await flushPromises();
};

const key = async (target, name, keyCode) => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'keyCode', { value: keyCode });
    target.dispatchEvent(event);
    await flushPromises();
};

const panel = () => document.querySelector('#my-dropdown');

let wrapper;
const mountAttached = (component, options = {}) => {
    wrapper = mount(component, { attachTo: document.body, ...options });
    return wrapper;
};

describe('Batch molecules A dropdowns expose menu and listbox semantics', () => {
    beforeAll(() => {
        Element.prototype.scrollIntoView = vi.fn();
        const target = document.createElement('div');
        target.id = 'my-dropdown';
        document.body.appendChild(target);
    });

    afterEach(async () => {
        wrapper?.unmount();
        wrapper = undefined;
        await settle(120);
    });

    it('the project source field is a listbox that marks the current source', async () => {
        mountAttached(ProjectSourceSelect, { props: { modelValue: 'fiverr' } });
        const trigger = wrapper.find('button[aria-haspopup="listbox"]');
        expect(trigger.exists()).toBe(true);
        expect(trigger.attributes('aria-expanded')).toBe('false');

        await trigger.trigger('click');
        await settle();

        expect(trigger.attributes('aria-expanded')).toBe('true');
        const options = [...panel().querySelectorAll('[role="listbox"] [role="option"]')];
        expect(options).toHaveLength(3);
        expect(options.map((el) => el.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    });

    it('the phone country picker picks exactly the focused country with Enter', async () => {
        mountAttached(PhoneCountry, { props: { preferredCountries: ['US'], enabledCountryCode: true } });
        await settle();
        const trigger = wrapper.find('button[aria-haspopup="listbox"]');
        expect(trigger.exists()).toBe(true);

        trigger.element.focus();
        await key(trigger.element, 'Enter', 13);
        await settle();

        expect(trigger.attributes('aria-expanded')).toBe('true');
        const selected = panel().querySelector('[role="option"][aria-selected="true"]');
        expect(selected).not.toBeNull();
        expect(document.activeElement).toBe(selected);

        await key(document.activeElement, 'ArrowDown', 40);
        await key(document.activeElement, 'ArrowDown', 40);
        await key(document.activeElement, 'Enter', 13);
        await settle(120);

        const picks = wrapper.emitted('onSelect').slice(1).map(([country]) => country);
        expect(picks).toEqual([allCountries[1]]);
        expect(trigger.attributes('aria-expanded')).toBe('false');
    });

    it('a milestone status row menu is a named menu that closes after an action', async () => {
        getters['settings/projectMilestoneStatus'] = [
            { name: 'Beta', value: 'beta', backgroundColor: '#123456', isPast: false, isFuture: false, isDefault: false, isCount: 0 }
        ];
        mountAttached(SettingMilestoneStatus, { props: { editPermission: true } });
        await settle();
        const trigger = wrapper.find('button[aria-haspopup="menu"]');
        expect(trigger.exists()).toBe(true);
        expect(trigger.find('img').attributes('alt')).toBe('Milestone.status_actions');

        await trigger.trigger('click');
        await settle();

        const items = [...panel().querySelectorAll('[role="menu"] [role="menuitem"]')];
        expect(items).toHaveLength(2);
        items[0].click();
        await settle(120);

        expect(trigger.attributes('aria-expanded')).toBe('false');
        expect(wrapper.find('input.milestone__value-input').element.value).toBe('Beta');
    });

    it('the weekly range picker is a listbox that picks from the keyboard', async () => {
        getters['settings/milestoneweeklyrange'] = 'Mon - Sun';
        mountAttached(SettingMilestoneWeeklyRange, { props: { editPermission: true } });
        await settle();
        const trigger = wrapper.find('button[aria-haspopup="listbox"]');
        expect(trigger.exists()).toBe(true);

        trigger.element.focus();
        await key(trigger.element, 'Enter', 13);
        await settle();

        const options = [...panel().querySelectorAll('[role="listbox"] [role="option"]')];
        expect(options.map((el) => el.getAttribute('aria-selected'))).toEqual(['true', 'false']);
        expect(document.activeElement).toBe(options[0]);

        await key(options[0], 'ArrowDown', 40);
        await key(document.activeElement, 'Enter', 13);
        await settle(120);

        expect(trigger.text()).toBe('Sun - Mon');
        expect(trigger.attributes('aria-expanded')).toBe('false');
    });
});
