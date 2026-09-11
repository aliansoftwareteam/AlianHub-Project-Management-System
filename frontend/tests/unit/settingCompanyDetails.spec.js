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
vi.mock('@/composable/Validation.js', () => ({ useValidation: () => ({ checkErrors: vi.fn(), checkAllFields: vi.fn(async () => true) }) }));
vi.mock('@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue', () => stub('WasabiImage'));
vi.mock('@/components/atom/CroppingTool/CroppingTool.vue', () => stub('CroppingTool'));
vi.mock('@/components/molecules/Sidebar/Sidebar.vue', () => stub('Sidebar'));

import SettingCompanyDetails from '@/components/molecules/Setting/SettingCompanyDetails.vue';

const COMPANY_ID = 'company-1';

// The shapes Modules/Setup/createCompany.js and Modules/Company/controller.js store before anyone opens Settings.
const fromSetupWizard = {
    _id: COMPANY_ID, Cst_CompanyName: 'Acme', Cst_Phone: 'N/A', Cst_Country: 'N/A', Cst_City: '', Cst_State: '',
    Cst_DialCode: { name: '', dialCode: '', code: '' }, Cst_LogTimeDays: '8'
};
const fromCreateCompany = {
    _id: COMPANY_ID, Cst_CompanyName: 'Acme', Cst_Phone: '', Cst_Country: '', Cst_City: '', Cst_State: '',
    Cst_DialCode: {}, Cst_countryCode: '', Cst_stateCode: ''
};

const open = async (company) => {
    getters['settings/companies'] = [company];
    getters['settings/companyDateFormat'] = { dateFormat: 'DD/MM/YYYY' };
    const errors = [];
    const wrapper = mount(SettingCompanyDetails, {
        props: { editPermission: true },
        global: { provide: { customerUpdate: () => {} }, config: { errorHandler: (error) => errors.push(error) } }
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await flushPromises();
    return { wrapper, errors };
};

describe('Settings > General company details on a fresh company', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it.each([['the setup wizard', fromSetupWizard], ['the create-company screen', fromCreateCompany]])(
        'opens a company made by %s with a real dial code country selected',
        async (_source, company) => {
            const { wrapper, errors } = await open(company);
            expect(errors.map(String)).toEqual([]);
            expect(wrapper.find('.activeCountrydialCode').text()).toBe('+1');
            expect(wrapper.find('.vti__flag').classes()).toContain('us');
            wrapper.unmount();
        }
    );

    it('saves a fresh company with the dial code country it shows', async () => {
        const { wrapper, errors } = await open(fromSetupWizard);
        apiRequest.mockResolvedValue({ status: 200, data: { _id: COMPANY_ID } });

        const phoneInput = wrapper.find('input[placeholder="eg. 000-000-0000"]');
        await phoneInput.setValue('4155552671');
        await phoneInput.trigger('keyup');
        await wrapper.find('#blue-btn-savecompany').trigger('click');
        await flushPromises();

        expect(errors.map(String)).toEqual([]);
        expect(apiRequest).toHaveBeenCalled();
        const [method, , body] = apiRequest.mock.calls[0];
        expect(method).toBe('put');
        expect(body.updateObject.Cst_Phone).toBe('4155552671');
        expect(body.updateObject.Cst_DialCode).toMatchObject({ isoCode: 'US', dialCode: '1' });
        wrapper.unmount();
    });
});
