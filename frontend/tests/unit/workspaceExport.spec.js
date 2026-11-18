import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/components/organisms/WorkspaceImport/WorkspaceImportDialog.vue', () => ({ __esModule: true, default: { name: 'WorkspaceImportDialog', render: () => null } }));

import ImportExport from '@/views/Settings/ImportExport/ImportExport.vue';
import { EXPORTS, EXPORTS_WORKSPACE } from '@/config/env';

const ROLE = { owner: 1, admin: 2, member: 3, guest: 0 };
const store = (roleType) => createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } } });
const mountAs = (role) => mount(ImportExport, { global: { plugins: [store(ROLE[role])] } });

const job = (over) => ({ _id: 'j1', type: 'workspace', format: 'xlsx', status: 'done', fileName: 'workspace-tasks.xlsx', total: 12, createdAt: '2026-09-28T10:00:00.000Z', ...over });

let listed;

beforeEach(() => {
    listed = [job(), job({ _id: 'j0', type: 'tasks', fileName: 'project.csv' })];
    apiRequest.mockImplementation(async (method, url) => {
        if (method === 'get' && url === EXPORTS) return { data: { status: true, data: listed } };
        if (method === 'post' && url === EXPORTS_WORKSPACE) return { data: { status: true, data: job({ _id: 'j2', status: 'queued', fileName: 'workspace-new.csv' }) } };
        if (method === 'get' && url.endsWith('/download')) return { data: 'file' };
        return { data: { status: false } };
    });
});

afterEach(() => { vi.useRealTimers(); });

describe('Settings → Import & export', () => {
    it.each(['member', 'guest'])('shows a %s nothing to act on and asks the server nothing', async (role) => {
        const wrapper = mountAs(role);
        await flushPromises();
        expect(wrapper.find('[data-test="iex-denied"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="iex-export"]').exists()).toBe(false);
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it.each(['owner', 'admin'])('lists an %s\'s workspace exports only, with a download for a finished one', async (role) => {
        const wrapper = mountAs(role);
        await flushPromises();
        const rows = wrapper.findAll('.iex__job');
        expect(rows).toHaveLength(1);
        expect(rows[0].text()).toContain('workspace-tasks.xlsx');
        expect(rows[0].text()).toContain('ImportExport.status_done');
        expect(rows[0].find('[data-test="iex-download"]').exists()).toBe(true);
    });

    it('starts an export in the chosen format and follows it until it is ready', async () => {
        vi.useFakeTimers();
        listed = [];
        const wrapper = mountAs('owner');
        await flushPromises();
        expect(wrapper.find('[data-test="iex-none"]').exists()).toBe(true);

        await wrapper.find('#iex-format').setValue('csv');
        await wrapper.find('[data-test="iex-export"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', EXPORTS_WORKSPACE, { format: 'csv' });
        const row = () => wrapper.find('.iex__job');
        expect(row().attributes('data-status')).toBe('queued');
        expect(row().find('[data-test="iex-download"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="iex-export"]').attributes('disabled')).toBeDefined();

        listed = [job({ _id: 'j2', fileName: 'workspace-new.csv' })];
        await vi.advanceTimersByTimeAsync(3000);
        await flushPromises();
        expect(row().attributes('data-status')).toBe('done');
        expect(row().find('[data-test="iex-download"]').exists()).toBe(true);
    });

    it('shows why a job failed', async () => {
        listed = [job({ status: 'failed', error: 'Only an owner or admin can export the workspace.' })];
        const wrapper = mountAs('admin');
        await flushPromises();
        expect(wrapper.find('.iex__job').text()).toContain('ImportExport.status_failed');
        expect(wrapper.find('.iex__job').text()).toContain('Only an owner or admin');
    });

    it('downloads through the export route', async () => {
        URL.createObjectURL = vi.fn(() => 'blob:x');
        URL.revokeObjectURL = vi.fn();
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        const wrapper = mountAs('owner');
        await flushPromises();
        await wrapper.find('[data-test="iex-download"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('get', `${EXPORTS}/j1/download`, null, null, { responseType: 'blob' });
    });
});
