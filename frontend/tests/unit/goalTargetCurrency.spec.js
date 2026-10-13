/* Task 047 S-5: a money target starts in the currency of the company, so nobody is stopped at "Choose a currency". */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import GoalTargetForm from '@/views/Goals/GoalTargetForm.vue';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CURRENCIES = [{ code: 'EUR', label: 'EUR · Euro' }, { code: 'INR', label: 'INR · Indian Rupee' }];

const form = (props = {}) => mount(GoalTargetForm, { props: { currencies: CURRENCIES, ...props }, global: { stubs: { GoalSourcePicker: true } } });
const picked = (wrapper) => wrapper.find('[data-test="gtf-currency"]').element.value;
const asMoney = (wrapper) => wrapper.find('[data-test="gtf-kind"]').setValue('currency');

describe('the currency of a new money target', () => {
    it('starts as the currency of the company', async () => {
        const wrapper = form({ defaultCurrency: 'INR' });
        await asMoney(wrapper);
        expect(picked(wrapper)).toBe('INR');
    });

    it('is sent with the target when the person changes nothing else about it', async () => {
        const wrapper = form({ defaultCurrency: 'INR' });
        await asMoney(wrapper);
        await wrapper.find('[data-test="gtf-name"]').setValue('Revenue');
        await wrapper.find('[data-test="gtf-target"]').setValue('5000');
        await wrapper.find('[data-test="gtf"]').trigger('submit');
        expect(wrapper.emitted('save')[0][0]).toMatchObject({ kind: 'currency', currencyCode: 'INR' });
    });

    it('keeps a currency the person already chose', async () => {
        const wrapper = form({ defaultCurrency: 'INR' });
        await asMoney(wrapper);
        await wrapper.find('[data-test="gtf-currency"]').setValue('EUR');
        await wrapper.find('[data-test="gtf-kind"]').setValue('number');
        await asMoney(wrapper);
        expect(picked(wrapper)).toBe('EUR');
    });

    it('stays unchosen when the company has no currency of its own, or one the list does not offer', async () => {
        const none = form();
        await asMoney(none);
        expect(picked(none)).toBe('');
        const unlisted = form({ defaultCurrency: 'JPY' });
        await asMoney(unlisted);
        expect(picked(unlisted)).toBe('');
    });

    it('is handed to the form by the goal panel from the company currencies', () => {
        const panel = fs.readFileSync(path.resolve(HERE, '../../src/views/Goals/GoalPanel.vue'), 'utf8');
        expect(panel).toMatch(/<GoalTargetForm v-if="adding"[^>]*:default-currency="defaultCurrency"/);
        expect(panel).toContain('companyCurrency(store.getters["settings/allCurrencyArray"])');
    });
});
