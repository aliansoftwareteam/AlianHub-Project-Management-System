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
const company = (fields = {}) => ({
    _id: COMPANY_ID, Cst_CompanyName: 'Acme', Cst_profileImage: '', Cst_Phone: '', Cst_State: '', Cst_City: '', Cst_Country: 'United States',
    Cst_DialCode: US, Cst_LogTimeDays: '8', Cst_countryCode: 'US', ...fields
});

const open = async (stored, editPermission = true) => {
    getters['settings/companies'] = [stored];
    getters['settings/companyDateFormat'] = { dateFormat: 'DD/MM/YYYY' };
    const wrapper = mount(SettingCompanyDetails, { props: { editPermission }, global: { provide: { customerUpdate: () => {} } } });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await flushPromises();
    return wrapper;
};

const dayBoxes = (wrapper) => wrapper.findAll('input[data-day]');
const checked = (wrapper) => dayBoxes(wrapper).filter((box) => box.element.checked).map((box) => Number(box.attributes('data-day')));
const toggle = async (wrapper, day, on) => {
    const box = wrapper.find(`input[data-day="${day}"]`);
    box.element.checked = on;
    await box.trigger('change');
};
const save = async (wrapper) => {
    await wrapper.find('#blue-btn-savecompany').trigger('click');
    await flushPromises();
};

describe('Settings > General company working days', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        apiRequest.mockResolvedValue({ status: 200, data: { _id: COMPANY_ID } });
    });

    it('shows Monday to Friday for a company that never chose', async () => {
        const wrapper = await open(company());
        expect(checked(wrapper)).toEqual([1, 2, 3, 4, 5]);
        wrapper.unmount();
    });

    it('shows the company\'s stored week', async () => {
        const wrapper = await open(company({ workingDays: [0, 1, 2, 3, 4] }));
        expect(checked(wrapper)).toEqual([1, 2, 3, 4, 0]);
        wrapper.unmount();
    });

    it('saves a changed week, even when nothing else changed', async () => {
        const wrapper = await open(company());
        await toggle(wrapper, 6, true);
        await save(wrapper);
        expect(apiRequest).toHaveBeenCalled();
        const [method, , body] = apiRequest.mock.calls[0];
        expect(method).toBe('put');
        expect(body.updateObject.workingDays).toEqual([1, 2, 3, 4, 5, 6]);
        wrapper.unmount();
    });

    it('does not save when the week and everything else is unchanged', async () => {
        const wrapper = await open(company({ workingDays: [1, 2, 3, 4, 5] }));
        await save(wrapper);
        expect(apiRequest).not.toHaveBeenCalled();
        wrapper.unmount();
    });

    it('is read-only for someone who cannot edit the company', async () => {
        const wrapper = await open(company(), false);
        expect(dayBoxes(wrapper).length).toBe(7);
        expect(dayBoxes(wrapper).every((box) => box.element.disabled)).toBe(true);
        wrapper.unmount();
    });
});
