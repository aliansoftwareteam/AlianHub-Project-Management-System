import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';

const { error, fire } = vi.hoisted(() => ({ error: vi.fn(), fire: vi.fn(() => Promise.resolve({ isConfirmed: true })) }));
vi.mock('vue-toast-notification', () => ({ useToast: () => ({ error }) }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('sweetalert2', () => ({ default: { fire } }));

import { lazyShellPart } from '@/config/lazyShell';
import { SHELL_PART_LOADERS } from '@/config/shellParts';
import lazySwal from '@/utils/lazySwal';

describe('the shell parts that load on demand', () => {
    beforeEach(() => vi.clearAllMocks());

    it('keeps the names the shell draws', () => {
        expect(Object.keys(SHELL_PART_LOADERS)).toEqual(['CommandPalette', 'QuickCreateTask', 'TaskTemplateDialogHost', 'AiFieldFillDialog', 'NotepadPanel', 'ClipsPanel', 'ClipRecorder', 'TalkToTextPopover']);
    });

    it('draws the part once its chunk has arrived', async () => {
        const Part = defineComponent({ render: () => h('p', { class: 'part' }, 'ready') });
        const Host = defineComponent({ components: { Part: lazyShellPart(() => Promise.resolve(Part)) }, template: '<Part />' });
        const host = mount(Host);
        expect(host.find('.part').exists()).toBe(false);
        await flushPromises();
        expect(host.find('.part').text()).toBe('ready');
        expect(error).not.toHaveBeenCalled();
    });

    it('shows the general error message when the chunk does not arrive', async () => {
        const Host = defineComponent({ components: { Part: lazyShellPart(() => Promise.reject(new Error('Loading chunk 7 failed'))) }, template: '<Part />' });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mount(Host, { global: { config: { errorHandler: () => {} } } });
        await flushPromises();
        expect(error).toHaveBeenCalledWith('generalErrorMessage.something_went_wrong');
        warn.mockRestore();
    });
});

describe('the confirmation dialog', () => {
    beforeEach(() => vi.clearAllMocks());

    it('is fetched on the first ask and hands the options and the answer through', async () => {
        const options = { title: 'Sure?' };
        await expect(lazySwal.fire(options)).resolves.toEqual({ isConfirmed: true });
        expect(fire).toHaveBeenCalledWith(options);
    });
});
