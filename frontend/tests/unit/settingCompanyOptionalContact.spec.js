import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest, getters, stub } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    getters: {},
    stub: (name) => ({ default: { name, render: () => null } })
}));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('vuex', () => ({ useStore: () => ({ getters, commit: vi.fn() }) }));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ makeUniqueId: () => 'id', debounce: (fn) => fn }) }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue', () => stub('WasabiImage'));
vi.mock('@/components/atom/CroppingTool/CroppingTool.vue', () => stub('CroppingTool'));
vi.mock('@/components/molecules/Sidebar/Sidebar.vue', () => stub('Sidebar'));

import SettingCompanyDetails from '@/components/molecules/Setting/SettingCompanyDetails.vue';

const COMPANY_ID = 'company-1';
const US = { name: 'United States', isoCode: 'US', dialCode: '1' };

const fromSetupWizard = {
    _id: COMPANY_ID, Cst_CompanyName: 'Acme', Cst_Phone: 'N/A', Cst_Country: 'N/A', Cst_City: '', Cst_State: '',
    Cst_DialCode: { name: '', dialCode: '', code: '' }, Cst_LogTimeDays: '8'
};
const withoutContact = {
    _id: COMPANY_ID, Cst_CompanyName: 'Acme', Cst_Country: 'United States', Cst_DialCode: US,
    Cst_LogTimeDays: '8', Cst_countryCode: 'US'
};
const emptyContact = { ...withoutContact, Cst_Phone: '', Cst_State: '', Cst_City: '' };

const open = async (company) => {
    getters['settings/companies'] = [company];
    getters['settings/companyDateFormat'] = { dateFormat: 'DD/MM/YYYY' };
    const wrapper = mount(SettingCompanyDetails, {
        props: { editPermission: true },
        global: { provide: { customerUpdate: () => {} } }
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await flushPromises();
    return wrapper;
};

const rename = async (wrapper) => {
    const name = wrapper.find('input[placeholder="general.enter_company_individual"]');
    await name.setValue('Acme Ltd');
    await name.trigger('keyup');
};

const typePhone = async (wrapper, value) => {
    const input = wrapper.find('input[placeholder="Settings.phone_placeholder"]');
    await input.setValue(value);
    await input.trigger('keyup');
};

const save = async (wrapper) => {
    await wrapper.find('#blue-btn-savecompany').trigger('click');
    await flushPromises();
};

const errorsShown = (wrapper) => wrapper.findAll('.invalid-feedback').map((node) => node.text()).filter(Boolean);

describe('Settings > General company phone, state and city are optional', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        apiRequest.mockResolvedValue({ status: 200, data: { _id: COMPANY_ID } });
    });

    it.each([
        ['the setup wizard placeholders', fromSetupWizard],
        ['empty values', emptyContact],
        ['no values at all', withoutContact],
    ])('saves a company with %s for phone, state and city', async (_label, company) => {
        const wrapper = await open(company);
        await rename(wrapper);
        await save(wrapper);

        expect(errorsShown(wrapper)).toEqual([]);
        expect(apiRequest).toHaveBeenCalled();
        const [method, , body] = apiRequest.mock.calls[0];
        expect(method).toBe('put');
        expect(body.updateObject).toMatchObject({ Cst_CompanyName: 'Acme Ltd', Cst_Phone: '', Cst_State: '', Cst_City: '' });
        wrapper.unmount();
    });

    it('shows the stored placeholder phone as empty', async () => {
        const wrapper = await open(fromSetupWizard);
        expect(wrapper.find('input[placeholder="Settings.phone_placeholder"]').element.value).toBe('');
        wrapper.unmount();
    });

    it.each([['too short for the country', '123'], ['not digits', 'call me']])('still refuses a phone that is %s', async (_label, phone) => {
        const wrapper = await open(emptyContact);
        await typePhone(wrapper, phone);
        await save(wrapper);

        expect(apiRequest).not.toHaveBeenCalled();
        expect(errorsShown(wrapper).length).toBeGreaterThan(0);
        wrapper.unmount();
    });

    it('saves a valid phone', async () => {
        const wrapper = await open(emptyContact);
        await typePhone(wrapper, '4155552671');
        await save(wrapper);

        expect(errorsShown(wrapper)).toEqual([]);
        expect(apiRequest.mock.calls[0][2].updateObject.Cst_Phone).toBe('4155552671');
        wrapper.unmount();
    });
});
