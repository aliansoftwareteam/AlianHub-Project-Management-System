import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequestWithoutCompnay } = vi.hoisted(() => ({ apiRequestWithoutCompnay: vi.fn() }));

vi.mock('@/services', () => ({ apiRequestWithoutCompnay }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import InstanceCspCard from '@/views/Settings/Instance/InstanceCspCard.vue';

const ROUTE = '/api/v2/instance/csp';
const LAST = '2026-09-18T10:00:00.000Z';

const summary = (over = {}) => ({
    mode: 'report',
    header: 'Content-Security-Policy-Report-Only',
    policy: "default-src 'self'; script-src 'self'",
    reportPath: '/api/v2/csp-report',
    days: 7,
    total: 12,
    hosts: [
        { blockedHost: 'inline', directive: 'style-src-elem', count: 9, lastSeen: LAST },
        { blockedHost: 'cdn.example.com', directive: 'img-src', count: 3, lastSeen: LAST },
    ],
    directives: [{ directive: 'style-src-elem', count: 9 }, { directive: 'img-src', count: 3 }],
    ...over,
});

const mountWith = async (data) => {
    apiRequestWithoutCompnay.mockImplementation((type, url) => (type === 'get' && url === ROUTE
        ? Promise.resolve({ data: { status: true, data } })
        : Promise.reject(new Error(`unexpected ${type} ${url}`))));
    const wrapper = mount(InstanceCspCard);
    await flushPromises();
    return wrapper;
};

describe('InstanceCspCard', () => {
    beforeEach(() => { apiRequestWithoutCompnay.mockReset(); });

    it('reads the summary once and changes nothing', async () => {
        await mountWith(summary());
        expect(apiRequestWithoutCompnay.mock.calls.map(([type, url]) => [type, url])).toEqual([['get', ROUTE]]);
    });

    it.each([['off', ''], ['report', 'ah-chip--warn'], ['enforce', 'ah-chip--ok']])('shows the %s mode and the variable that sets it', async (mode, chip) => {
        const wrapper = await mountWith(summary({ mode }));
        const label = wrapper.find('[data-test="csp-mode"]');
        expect(label.text()).toBe(`ContentSecurity.mode_${mode}`);
        expect(label.classes().filter((name) => name.startsWith('ah-chip--'))).toEqual(chip ? [chip] : []);
        expect(wrapper.find('[data-test="csp-mode-help"]').text()).toContain('CSP_MODE');
    });

    it('lists the most blocked sources with their directive, count and last report', async () => {
        const wrapper = await mountWith(summary());
        const rows = wrapper.findAll('[data-test="csp-host-row"]');
        expect(rows).toHaveLength(2);
        expect(rows[0].text()).toContain('inline');
        expect(rows[0].text()).toContain('style-src-elem');
        expect(rows[0].text()).toContain('9');
        expect(rows[0].text()).toContain(new Date(LAST).toLocaleString());
        expect(rows[1].text()).toContain('cdn.example.com');
    });

    it('lists the directives that blocked something', async () => {
        const wrapper = await mountWith(summary());
        expect(wrapper.findAll('[data-test="csp-directive-row"]').map((row) => row.text())).toEqual(['style-src-elem9', 'img-src3']);
    });

    it('says so when nothing was reported', async () => {
        const wrapper = await mountWith(summary({ total: 0, hosts: [], directives: [] }));
        expect(wrapper.find('[data-test="csp-empty"]').text()).toBe('ContentSecurity.empty');
        expect(wrapper.find('[data-test="csp-host-row"]').exists()).toBe(false);
    });

    it('explains the empty list while the policy is off', async () => {
        const wrapper = await mountWith(summary({ mode: 'off', header: null, total: 0, hosts: [], directives: [] }));
        expect(wrapper.find('[data-test="csp-empty"]').text()).toBe('ContentSecurity.off_note');
    });

    it('shows the policy the server sends', async () => {
        const wrapper = await mountWith(summary());
        expect(wrapper.find('[data-test="csp-policy"]').text()).toBe("default-src 'self';\nscript-src 'self'");
    });

    it('shows the server error in place of the lists', async () => {
        apiRequestWithoutCompnay.mockRejectedValue({ response: { data: { statusText: 'Only the instance owner can do this.' } } });
        const wrapper = mount(InstanceCspCard);
        await flushPromises();
        expect(wrapper.find('[data-test="csp-error"]').text()).toContain('Only the instance owner can do this.');
        expect(wrapper.find('[data-test="csp-mode"]').exists()).toBe(false);
    });
});
