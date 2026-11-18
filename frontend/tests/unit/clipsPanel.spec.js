import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const m = vi.hoisted(() => ({
    listClips: vi.fn(), renameClip: vi.fn(), deleteClip: vi.fn(), apiRequest: vi.fn(),
    openRecorder: vi.fn(), resolveUrl: vi.fn(), toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('vue-toast-notification', () => ({ useToast: () => m.toast }));
vi.mock('@/services', () => ({ apiRequest: m.apiRequest }));
vi.mock('@/services/clips', () => ({ listClips: m.listClips, renameClip: m.renameClip, deleteClip: m.deleteClip }));
vi.mock('@/composables/useClipRecorder', () => ({ useClipRecorder: () => ({ openRecorder: m.openRecorder }) }));
vi.mock('@/composable/commonFunction', () => ({ storageHelper: () => ({ handleStorageImageRequest: m.resolveUrl }) }));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ makeUniqueId: () => 'uid' }) }));

import ClipsPanel from '@/components/molecules/Clips/ClipsPanel.vue';

const clips = () => [
    { _id: 'c1', title: 'Standup', mediaType: 'video', url: 'k/a.mp4', durationSec: 65, createdAt: '2026-01-02T10:00:00Z' },
    { _id: 'c2', title: 'Voice memo', mediaType: 'audio', url: 'k/b.webm', convertedTaskId: 't9' },
    { _id: 'c3', title: '', mediaType: 'audio', url: 'k/c.webm' },
];
const ok = (data) => Promise.resolve({ data: { status: true, data } });

let wrapper;
const mountPanel = async (modelValue = true) => {
    wrapper = mount(ClipsPanel, { props: { modelValue }, global: { stubs: { ConvertNoteToTask: { name: 'ConvertNoteToTask', template: '<div class="convert-stub" />', props: ['note', 'attachment', 'dialogTitle'] } } } });
    await wrapper.setProps({ modelValue: false });
    await wrapper.setProps({ modelValue: true });
    await flushPromises();
    return wrapper;
};
const byTitle = (t) => wrapper.findAll('button').find((b) => b.attributes('title') === t);
const rows = () => wrapper.findAll('.cl__row');

beforeEach(() => {
    Object.values(m).forEach((f) => f.mockReset?.());
    m.toast.success = vi.fn(); m.toast.error = vi.fn();
    m.listClips.mockImplementation(() => ok(clips()));
    m.resolveUrl.mockResolvedValue({ url: 'https://cdn/x' });
    m.renameClip.mockImplementation(() => ok());
    m.deleteClip.mockImplementation(() => ok());
    m.apiRequest.mockResolvedValue({});
});
afterEach(() => wrapper?.unmount());

describe('ClipsPanel states', () => {
    it('renders nothing while closed and does not fetch', async () => {
        wrapper = mount(ClipsPanel, { props: { modelValue: false } });
        expect(wrapper.find('.cl__overlay').exists()).toBe(false);
        expect(m.listClips).not.toHaveBeenCalled();
    });

    it('shows the i18n loading key until the list resolves', async () => {
        let done;
        m.listClips.mockReturnValue(new Promise((r) => { done = r; }));
        wrapper = mount(ClipsPanel, { props: { modelValue: false } });
        await wrapper.setProps({ modelValue: true });
        expect(wrapper.find('.cl__state').text()).toBe('Clips.loading');
        done({ data: { status: true, data: [] } });
        await flushPromises();
        expect(wrapper.find('.cl__state').text()).toBe('Clips.empty');
    });

    it('lists clips with title, duration, converted badge and untitled fallback', async () => {
        await mountPanel();
        expect(rows()).toHaveLength(3);
        expect(rows()[0].find('.cl__title').text()).toBe('Standup');
        expect(rows()[0].find('.cl__meta').text()).toContain('1:05');
        expect(rows()[0].find('.cl__type').classes()).toContain('is-video');
        expect(rows()[1].find('.cl__type').classes()).toContain('is-audio');
        expect(rows()[1].find('.cl__converted').text()).toBe('Clips.converted_badge');
        expect(rows()[2].find('.cl__title').text()).toBe('Clips.untitled');
    });

    it('shows the empty key when the server answers with status false (error)', async () => {
        m.listClips.mockResolvedValue({ data: { status: false } });
        await mountPanel();
        expect(wrapper.find('.cl__state').text()).toBe('Clips.empty');
    });

    it('leaves loading and logs when the request fails', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        m.listClips.mockRejectedValue(new Error('x'));
        await mountPanel();
        expect(wrapper.find('.cl__state').text()).toBe('Clips.empty');
        err.mockRestore();
    });
});

describe('ClipsPanel controls', () => {
    it('close button and backdrop click ask the parent to close', async () => {
        await mountPanel();
        await byTitle('Reminders.close').trigger('click');
        await wrapper.find('.cl__overlay').trigger('click');
        expect(wrapper.emitted('update:modelValue')).toEqual([[false], [false]]);
    });

    it('search filters by title, shows no_results, and closing it clears the term', async () => {
        await mountPanel();
        await byTitle('Clips.search').trigger('click');
        const input = wrapper.find('input.cl__searchinput');
        expect(input.attributes('placeholder')).toBe('Clips.search_placeholder');
        await input.setValue('stand');
        expect(rows()).toHaveLength(1);
        await input.setValue('zzz');
        expect(wrapper.find('.cl__state').text()).toBe('Clips.no_results');
        await byTitle('Clips.search').trigger('click');
        expect(rows()).toHaveLength(3);
    });

    it('play resolves the storage key to a url and mounts a video, then hides it', async () => {
        await mountPanel();
        await byTitle('Clips.play').trigger('click');
        await flushPromises();
        expect(wrapper.find('video').attributes('src')).toBe('https://cdn/x');
        expect(byTitle('Clips.hide')).toBeTruthy();
        await byTitle('Clips.hide').trigger('click');
        expect(wrapper.find('video').exists()).toBe(false);
    });

    it('falls back to the raw url when resolving fails, and uses audio for audio clips', async () => {
        m.resolveUrl.mockRejectedValue(new Error('x'));
        await mountPanel();
        await rows()[1].find('.cl__main').trigger('click');
        await flushPromises();
        expect(wrapper.find('audio').attributes('src')).toBe('k/b.webm');
    });

    it('record new calls the recorder', async () => {
        await mountPanel();
        const btn = wrapper.find('.cl__new');
        expect(btn.text()).toBe('Clips.record_new');
        await btn.trigger('click');
        expect(m.openRecorder).toHaveBeenCalledTimes(1);
    });

    it('options menu offers rename / copy link / delete and toggles on a second click', async () => {
        await mountPanel();
        const opts = rows()[0].findAll('button').find((b) => b.attributes('title') === 'Clips.options');
        await opts.trigger('click');
        expect(wrapper.findAll('.cl__mitem').map((b) => b.text())).toEqual(['Clips.rename', 'Clips.copy_link', 'Clips.delete']);
        await opts.trigger('click');
        expect(wrapper.find('.cl__menu').exists()).toBe(false);
    });
});

describe('ClipsPanel rename', () => {
    const openRename = async () => {
        await rows()[0].findAll('button').find((b) => b.attributes('title') === 'Clips.options').trigger('click');
        await wrapper.findAll('.cl__mitem')[0].trigger('click');
        await flushPromises();
    };

    it('Enter commits the new title optimistically and sends it', async () => {
        await mountPanel();
        await openRename();
        const input = wrapper.find('input.cl__renameinput');
        expect(input.attributes('placeholder')).toBe('Clips.rename_placeholder');
        await input.setValue('  Retro  ');
        await input.trigger('keyup', { key: 'Enter' });
        expect(rows()[0].find('.cl__title').text()).toBe('Retro');
        expect(m.renameClip).toHaveBeenCalledWith('c1', 'Retro');
    });

    it('reverts the title and shows the error toast when the server rejects it', async () => {
        m.renameClip.mockResolvedValue({ data: { status: false } });
        await mountPanel();
        await openRename();
        const input = wrapper.find('input.cl__renameinput');
        await input.setValue('Retro');
        await input.trigger('keyup', { key: 'Enter' });
        await flushPromises();
        expect(rows()[0].find('.cl__title').text()).toBe('Standup');
        expect(m.toast.error).toHaveBeenCalledWith('Clips.rename_failed', expect.anything());
    });

    it('an empty or unchanged name leaves the clip alone', async () => {
        await mountPanel();
        await openRename();
        await wrapper.find('input.cl__renameinput').setValue('   ');
        await wrapper.find('input.cl__renameinput').trigger('blur');
        expect(m.renameClip).not.toHaveBeenCalled();
        expect(rows()[0].find('.cl__title').text()).toBe('Standup');
    });
});

describe('ClipsPanel copy link and delete', () => {
    it('copy link writes the resolved url to the clipboard and confirms', async () => {
        const writeText = vi.fn().mockResolvedValue();
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        await mountPanel();
        await rows()[0].findAll('button').find((b) => b.attributes('title') === 'Clips.options').trigger('click');
        await wrapper.findAll('.cl__mitem')[1].trigger('click');
        await flushPromises();
        expect(writeText).toHaveBeenCalledWith('https://cdn/x');
        expect(m.toast.success).toHaveBeenCalledWith('Clips.copied', expect.anything());
    });

    it('shows the failure toast when the clipboard refuses', async () => {
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('no')) }, configurable: true });
        await mountPanel();
        await rows()[0].findAll('button').find((b) => b.attributes('title') === 'Clips.options').trigger('click');
        await wrapper.findAll('.cl__mitem')[1].trigger('click');
        await flushPromises();
        expect(m.toast.error).toHaveBeenCalledWith('Clips.copy_failed', expect.anything());
    });

    const askDelete = async () => {
        await rows()[0].findAll('button').find((b) => b.attributes('title') === 'Clips.options').trigger('click');
        await wrapper.findAll('.cl__mitem')[2].trigger('click');
    };

    it('delete asks first; cancel keeps the clip, confirm removes the row', async () => {
        await mountPanel();
        await askDelete();
        expect(wrapper.find('.cl__ctitle').text()).toBe('Clips.confirm_delete_title');
        expect(wrapper.find('.cl__cdesc').text()).toBe('Notepad.confirm_delete_desc');
        const [cancel, confirm] = wrapper.findAll('.cl__cbtn');
        expect(cancel.text()).toBe('Projects.cancel');
        await cancel.trigger('click');
        expect(rows()).toHaveLength(3);
        expect(m.deleteClip).not.toHaveBeenCalled();
        await askDelete();
        await wrapper.findAll('.cl__cbtn')[1].trigger('click');
        await flushPromises();
        expect(m.deleteClip).toHaveBeenCalledWith('c1');
        expect(rows()).toHaveLength(2);
        expect(confirm.text()).toBe('Clips.delete');
    });

    it('keeps the row and shows the error toast when the server refuses the delete', async () => {
        m.deleteClip.mockResolvedValue({ data: { status: false } });
        await mountPanel();
        await askDelete();
        await wrapper.findAll('.cl__cbtn')[1].trigger('click');
        await flushPromises();
        expect(rows()).toHaveLength(3);
        expect(m.toast.error).toHaveBeenCalledWith('Toast.something_went_wrong', expect.anything());
    });
});

describe('ClipsPanel convert to task', () => {
    it('opens the dialog with the clip title and recording attachment, then marks the clip converted', async () => {
        await mountPanel();
        await byTitle('Clips.convert_action').trigger('click');
        const dlg = wrapper.findComponent({ name: 'ConvertNoteToTask' });
        expect(dlg.exists()).toBe(true);
        expect(dlg.props('dialogTitle')).toBe('Clips.convert_title');
        expect(dlg.props('note').title).toBe('Standup');
        expect(dlg.props('attachment')).toMatchObject({ filename: 'Standup.mp4', type: 'video', url: 'k/a.mp4' });
        dlg.vm.$emit('converted', { taskId: 77 });
        await flushPromises();
        expect(wrapper.findComponent({ name: 'ConvertNoteToTask' }).exists()).toBe(false);
        expect(rows()[0].find('.cl__converted').text()).toBe('Clips.converted_badge');
    });

    it('closing the dialog leaves the clip unconverted', async () => {
        await mountPanel();
        await byTitle('Clips.convert_action').trigger('click');
        wrapper.findComponent({ name: 'ConvertNoteToTask' }).vm.$emit('close');
        await flushPromises();
        expect(wrapper.find('.convert-stub').exists()).toBe(false);
        expect(rows()[0].find('.cl__converted').exists()).toBe(false);
    });
});

describe('ClipsPanel i18n', () => {
    it('template has no bare visible text, title or placeholder', () => {
        const src = readFileSync(resolve(__dirname, '../../src/components/molecules/Clips/ClipsPanel.vue'), 'utf8');
        const tpl = src.slice(src.indexOf('<template>'), src.indexOf('</template>\n\n<script')).replace(/<!--[\s\S]*?-->/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '');
        const bareAttr = tpl.match(/\s(?:title|placeholder|aria-label|alt)="[^"]+"/g) || [];
        const bareText = (tpl.match(/>[^<>{}]*[A-Za-z]{2,}[^<>{}]*</g) || []);
        expect(bareAttr).toEqual([]);
        expect(bareText).toEqual([]);
    });
});
