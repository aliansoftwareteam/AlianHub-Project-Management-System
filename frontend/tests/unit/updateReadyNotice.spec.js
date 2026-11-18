import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { mount } from '@vue/test-utils';

const shell = vi.hoisted(() => ({ updateReady: null, applyUpdate: vi.fn() }));
vi.mock('@/serviceWorker/registration', async () => {
    const { ref: makeRef } = await import('vue');
    shell.updateReady = makeRef(false);
    return { updateReady: shell.updateReady, applyUpdate: shell.applyUpdate };
});

import UpdateReadyNotice from '@/components/molecules/UpdateReadyNotice/UpdateReadyNotice.vue';

const mountNotice = () => mount(UpdateReadyNotice);
const notice = (wrapper) => wrapper.find('[data-test="update-ready"]');

describe('the "new version" notice', () => {
    beforeEach(() => {
        shell.updateReady.value = false;
        shell.applyUpdate.mockClear();
    });

    it('is absent until a new build is ready for this tab', () => {
        expect(notice(mountNotice()).exists()).toBe(false);
    });

    it('says a new version is ready and offers Reload, as a status the page announces without taking focus', async () => {
        const wrapper = mountNotice();
        shell.updateReady.value = true;
        await wrapper.vm.$nextTick();

        expect(notice(wrapper).text()).toContain('Shell.update_ready');
        expect(notice(wrapper).attributes('role')).toBe('status');
        expect(wrapper.find('[data-test="update-reload"]').text()).toBe('Shell.update_reload');
    });

    it('applies the update on Reload', async () => {
        shell.updateReady.value = true;
        const wrapper = mountNotice();
        await wrapper.find('[data-test="update-reload"]').trigger('click');
        expect(shell.applyUpdate).toHaveBeenCalledTimes(1);
    });

    it('goes away on Later without applying anything', async () => {
        shell.updateReady.value = true;
        const wrapper = mountNotice();
        await wrapper.find('[data-test="update-later"]').trigger('click');
        expect(notice(wrapper).exists()).toBe(false);
        expect(shell.applyUpdate).not.toHaveBeenCalled();
    });

    it('is mounted once, at the root of the app', () => {
        const app = fs.readFileSync(path.resolve(__dirname, '../../src/App.vue'), 'utf8');
        expect(app.match(/<UpdateReadyNotice\s*\/>/g)).toHaveLength(1);
    });
});
