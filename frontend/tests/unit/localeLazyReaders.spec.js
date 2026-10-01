import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { config, mount } from '@vue/test-utils';
import axios, { AxiosError } from 'axios';

vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({})) }));

import { i18n, switchLocale } from '@/locales/main';
import en from '@/locales/en';
import { addView } from '@/components/molecules/EmbedView/helper';
import { installBusyHandling } from '@/services/busy';
import { useValidation } from '@/composable/Validation';

config.global.plugins = [i18n];

let fr;
beforeAll(async () => {
    fr = (await import('@/locales/fr')).default;
});

beforeEach(async () => {
    await switchLocale('en');
});

const requiredError = async () => {
    const Probe = defineComponent({ setup: () => useValidation(), render: () => null });
    const wrapper = mount(Probe);
    const field = { value: '' };
    await wrapper.vm.checkErrors({ field, name: 'Email', validations: 'required' });
    wrapper.unmount();
    return field.error;
};

const busyMessage = () => {
    const instance = axios.create({
        adapter: (request) => Promise.reject(new AxiosError('Request failed with status code 429', AxiosError.ERR_BAD_REQUEST, request, null, {
            status: 429, statusText: 'Too Many Requests', headers: {}, config: request, data: ''
        }))
    });
    installBusyHandling(instance);
    return instance.post('/anything').then(() => '', (error) => error.message);
};

describe('messages read outside a component, around a lazily loaded language', () => {
    it('starts with English alone in the instance', () => {
        expect(i18n.global.availableLocales).toEqual(['en']);
    });

    it('a module that kept the translator when it was loaded speaks the new language', async () => {
        expect((await addView({ pid: 'p1' }, { _id: 'v1' })).statusText).toBe(en.Toast.View_added_successfully);

        await switchLocale('fr');
        expect(fr.Toast.View_added_successfully).not.toBe(en.Toast.View_added_successfully);
        expect((await addView({ pid: 'p1' }, { _id: 'v1' })).statusText).toBe(fr.Toast.View_added_successfully);
    });

    it('a module that asks the instance each time speaks the new language', async () => {
        expect(i18n.global.t('generalErrorMessage.fieldIsRequired')).toBe(en.generalErrorMessage.fieldIsRequired);

        await switchLocale('fr');
        expect(i18n.global.t('generalErrorMessage.fieldIsRequired')).toBe(fr.generalErrorMessage.fieldIsRequired);
        expect(i18n.global.t('Common.server_busy_retry_in', { n: 3 }, 3)).toBe(fr.Common.server_busy_retry_in.split(' | ')[1].replace('{n}', '3'));
    });

    it('the request layer words a busy server before and after the load', async () => {
        expect(await busyMessage()).toBe(en.Common.server_busy);

        await switchLocale('fr');
        expect(await busyMessage()).toBe(fr.Common.server_busy);
    });

    it('validation messages follow the loaded language', async () => {
        expect(await requiredError()).toBe(`${en.errorPage.The} ${en.errorPage.email.toLowerCase()} ${en.generalErrorMessage.fieldIsRequired}`);

        await switchLocale('fr');
        expect(await requiredError()).toBe(`${fr.errorPage.The} ${fr.errorPage.email.toLowerCase()} ${fr.generalErrorMessage.fieldIsRequired}`);
    });

    it('a key the loaded language lacks reads as English, and says so when asked', async () => {
        await switchLocale('ja');

        expect(i18n.global.te('generalErrorMessage.fieldIsRequired')).toBe(false);
        expect(i18n.global.t('generalErrorMessage.fieldIsRequired')).toBe(en.generalErrorMessage.fieldIsRequired);
    });
});
