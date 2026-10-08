import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import fs from 'fs';
import path from 'path';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));

import RolePlaybookEditor from '@/views/Ai/RolePlaybookEditor.vue';

const role = (over = {}) => ({ blueprint: 'it-company', slug: 'bug-triager', name: 'Bug Triager', department: 'Engineering', default: 'built-in', body: 'built-in', edited: false, ...over });
const answer = (roles, canEdit = true) => Promise.resolve({ data: { status: true, data: { roles, canEdit, maxLength: 30000 } } });
const mountIt = async () => {
    const wrapper = mount(RolePlaybookEditor, { global: { mocks: { $t: (key, values) => (values ? `${key}:${JSON.stringify(values)}` : key) } } });
    await flushPromises();
    return wrapper;
};

beforeEach(() => apiRequest.mockReset());

describe('the role playbook editor in the AI settings', () => {
    it('hides itself, with no error, while role playbooks are off on the server', async () => {
        apiRequest.mockReturnValueOnce(Promise.resolve({ data: { status: true, data: { on: false, roles: [] } } }));
        const wrapper = await mountIt();
        expect(wrapper.find('[data-test="role-playbooks"]').exists()).toBe(false);
        expect(apiRequest).toHaveBeenCalledTimes(1);
    });

    it('shows the built-in text and offers no restore until it is edited', async () => {
        apiRequest.mockReturnValueOnce(answer([role(), role({ slug: 'tech-lead', name: 'Tech Lead' })]));
        const wrapper = await mountIt();
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/agents/roles');
        expect(wrapper.find('[data-test="role-playbook-text"]').element.value).toBe('built-in');
        expect(wrapper.find('[data-test="role-playbook-state"]').text()).toBe('RolePlaybooks.default_chip');
        expect(wrapper.find('[data-test="role-playbook-restore"]').attributes('disabled')).toBeDefined();
        expect(wrapper.find('[data-test="role-playbook-save"]').attributes('disabled')).toBeDefined();
    });

    it('saves the changed text for the chosen role', async () => {
        apiRequest.mockReturnValueOnce(answer([role()]));
        const wrapper = await mountIt();
        await wrapper.find('[data-test="role-playbook-text"]').setValue('tuned');
        apiRequest.mockReturnValueOnce(answer([role({ body: 'tuned', edited: true })]));
        await wrapper.find('[data-test="role-playbook-save"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenLastCalledWith('put', '/api/v2/agents/roles/it-company/bug-triager/playbook', { body: 'tuned' });
        expect(wrapper.find('[data-test="role-playbook-state"]').text()).toBe('RolePlaybooks.edited_chip');
        expect(wrapper.find('[data-test="role-playbook-notice"]').text()).toBe('RolePlaybooks.saved');
    });

    it('restores the built-in text', async () => {
        apiRequest.mockReturnValueOnce(answer([role({ body: 'tuned', edited: true })]));
        const wrapper = await mountIt();
        apiRequest.mockReturnValueOnce(answer([role()]));
        await wrapper.find('[data-test="role-playbook-restore"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenLastCalledWith('delete', '/api/v2/agents/roles/it-company/bug-triager/playbook', undefined);
        expect(wrapper.find('[data-test="role-playbook-text"]').element.value).toBe('built-in');
        expect(wrapper.find('[data-test="role-playbook-notice"]').text()).toBe('RolePlaybooks.restored');
    });

    it('shows the server\'s reason when a save is refused', async () => {
        apiRequest.mockReturnValueOnce(answer([role()]));
        const wrapper = await mountIt();
        await wrapper.find('[data-test="role-playbook-text"]').setValue('tuned');
        apiRequest.mockReturnValueOnce(Promise.resolve({ data: { status: false, statusText: 'Owner/admin only.' } }));
        await wrapper.find('[data-test="role-playbook-save"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="role-playbook-error"]').text()).toBe('Owner/admin only.');
    });

    it('is read only for someone who cannot edit', async () => {
        apiRequest.mockReturnValueOnce(answer([role()], false));
        const wrapper = await mountIt();
        expect(wrapper.find('[data-test="role-playbook-text"]').attributes('readonly')).toBeDefined();
        expect(wrapper.find('[data-test="role-playbook-save"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="role-playbook-restore"]').exists()).toBe(false);
    });

    it('holds no bare text, colour or legacy class, and its keys exist in English', () => {
        const SRC = path.resolve(__dirname, '../../src');
        const source = fs.readFileSync(path.join(SRC, 'views/Ai/RolePlaybookEditor.vue'), 'utf8');
        const en = fs.readFileSync(path.join(SRC, 'locales/en.js'), 'utf8');
        expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|bg-white/);
        const keys = [...source.matchAll(/RolePlaybooks\.([a-z_]+)/g)].map((m) => m[1]);
        expect(keys.length).toBeGreaterThan(8);
        keys.forEach((key) => expect(en).toContain(`        ${key}: "`));
    });
});
