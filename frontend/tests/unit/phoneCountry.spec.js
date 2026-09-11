import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';

vi.mock('@/composable', () => ({ useCustomComposable: () => ({ makeUniqueId: () => 'id', debounce: (fn) => fn }) }));

import PhoneCountry from '@/components/molecules/CountryPhoneNumberDropdown/PhoneCountry.vue';
import allCountries from '@/components/molecules/CountryPhoneNumberDropdown/allCountry.js';

const ENTER = 13;
const DOWN = 40;

const press = async (keyCode, times = 1) => {
    for (let i = 0; i < times; i++) {
        const event = new KeyboardEvent('keydown', { bubbles: true });
        Object.defineProperty(event, 'keyCode', { value: keyCode });
        document.dispatchEvent(event);
        await nextTick();
    }
    await flushPromises();
};

const typeSearch = async (text) => {
    const input = document.querySelector('.countrycode__dropdown input');
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await flushPromises();
};

let wrapper;

const openDropdown = async () => {
    wrapper = mount(PhoneCountry, { props: { preferredCountries: ['US'], enabledCountryCode: true } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await wrapper.find('.dropdown').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('onSelect')).toHaveLength(1);
    return {
        selections: () => (wrapper.emitted('onSelect') || []).slice(1).map(([country]) => country),
        dialCode: () => wrapper.find('.activeCountrydialCode').text()
    };
};

describe('PhoneCountry keyboard selection', () => {
    beforeAll(() => {
        Element.prototype.scrollIntoView = vi.fn();
        const target = document.createElement('div');
        target.id = 'my-dropdown';
        document.body.appendChild(target);
    });

    afterEach(() => { wrapper?.unmount(); wrapper = undefined; });

    it('selects the first match, never undefined, when Enter follows a search that shrank the list below the highlight', async () => {
        const { selections, dialCode } = await openDropdown();
        await press(DOWN, 5);
        await typeSearch('ind');
        const matches = allCountries.filter((country) => country.name.toLowerCase().includes('ind'));
        expect(matches.length).toBeLessThan(6);

        await press(ENTER);

        expect(selections()).toEqual([matches[0]]);
        expect(dialCode()).toBe(`+${matches[0].dialCode}`);
    });

    it('highlights the first match after the search changes', async () => {
        await openDropdown();
        await press(DOWN, 5);
        await typeSearch('ind');

        expect(document.querySelector('#item0').classList).toContain('bg-blue');
    });

    it('keeps the current country when Enter finds no match', async () => {
        const { selections, dialCode } = await openDropdown();
        await typeSearch('zzzz');

        await press(ENTER);

        expect(selections()).toEqual([]);
        expect(dialCode()).toBe('+1');
    });

    it('reports only the highlighted country, once, on Enter', async () => {
        const { selections } = await openDropdown();
        await press(DOWN, 2);

        await press(ENTER);

        expect(selections()).toEqual([allCountries[1]]);
    });

    it('reports only the clicked country, once, on click', async () => {
        const { selections } = await openDropdown();

        document.querySelector('#item3').click();
        await flushPromises();

        expect(selections()).toEqual([allCountries[2]]);
    });
});
