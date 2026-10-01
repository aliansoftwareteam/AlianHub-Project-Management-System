import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const api = vi.hoisted(() => ({ list: [], bodies: {}, calls: [], refuse: null }));

vi.mock('@/services', () => ({
    apiRequest: vi.fn((method, url, body) => {
        api.calls.push({ method, url, body });
        if (api.refuse && api.refuse(method, url)) return Promise.resolve({ data: { status: false, statusText: 'No.' } });
        const versionId = (url.split('/versions/')[1] || '').split('/')[0];
        if (method === 'get' && !versionId) return Promise.resolve({ data: { status: true, data: api.list } });
        if (method === 'get') return Promise.resolve({ data: api.bodies[versionId] ? { status: true, data: api.bodies[versionId] } : { status: false, statusText: 'Version not found.' } });
        if (method === 'post' && url.endsWith('/restore')) return Promise.resolve({ data: { status: true, data: { _id: 'p1', title: api.bodies[versionId].title } } });
        if (method === 'post') return Promise.resolve({ data: { status: true, data: { _id: 'v9', savedBy: 'user-1', savedAt: '2026-10-01T10:00:00Z', reason: 'manual', name: (body && body.name) || '', title: 'Plan' } } });
        return Promise.resolve({ data: { status: true, data: { ...api.list.find((row) => row._id === versionId), name: body.name } } });
    }),
}));
vi.mock('vue-router', () => ({ useRoute: () => ({ params: {} }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: (id) => ({ Employee_Name: id === 'user-1' ? 'Me' : 'Priya Shah' }) }),
    useCustomComposable: () => ({ getWasabiImageLink: vi.fn(async () => 'https://files.example/signed.png') }),
}));

import PageHistory from '@/components/molecules/Pages/PageHistory.vue';

const para = (id, text) => ({ id, type: 'paragraph', data: { text } });
const CURRENT = [para('a', 'Intro'), para('b', 'Scope is huge'), para('e', 'Budget')];

const mountPanel = async (props = {}) => {
    const wrapper = mount(PageHistory, {
        props: { pageId: 'p1', currentTitle: 'Plan', currentBlocks: CURRENT, ...props },
        attachTo: document.body,
    });
    await flushPromises();
    return wrapper;
};
const calls = (method, tail) => api.calls.filter((call) => call.method === method && call.url.endsWith(tail));
const blocks = (wrapper, kind) => wrapper.findAll(`.ph__block--${kind}`);

beforeEach(() => {
    api.calls.length = 0;
    api.refuse = null;
    api.list = [
        { _id: 'v3', savedBy: 'u2', savedAt: '2026-09-30T10:00:00Z', reason: 'author', name: 'Signed off', title: 'Plan', visibility: 'project' },
        { _id: 'v2', savedBy: 'user-1', savedAt: '2026-09-29T10:00:00Z', reason: 'interval', name: '', title: 'Plan', visibility: 'private' },
        { _id: 'v1', savedBy: 'user-1', savedAt: '2026-09-28T10:00:00Z', reason: 'legacy', name: '', title: 'Draft', visibility: 'project' },
    ];
    api.bodies = {
        v3: { _id: 'v3', title: 'Plan', blocks: [para('a', 'Intro'), para('b', 'Scope is large'), para('d', 'New section')] },
        v2: { _id: 'v2', title: 'Plan', blocks: [para('a', 'Intro'), para('b', 'Scope is small'), para('c', 'Old risks')] },
        v1: { _id: 'v1', title: 'Draft', blocks: [para('a', '<img src=x onerror="steal()">Intro <span class="mention" data-mention="user" data-id="6f0000000000000000000a01">@Old name</span>')] },
    };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('the doc history panel', () => {
    it('is a labelled dialog that lists each version with who, when and its name', async () => {
        const wrapper = await mountPanel();
        const dialog = wrapper.find('.ph');

        expect(dialog.attributes('role')).toBe('dialog');
        expect(dialog.attributes('aria-modal')).toBe('true');
        expect(wrapper.find(`#${dialog.attributes('aria-labelledby')}`).text()).toBe('Docs.history_title');

        const items = wrapper.findAll('.ph__item');
        expect(items).toHaveLength(3);
        expect(items.every((item) => item.element.tagName === 'BUTTON')).toBe(true);
        expect(items[0].text()).toContain('Priya Shah');
        expect(items[0].text()).toContain('Signed off');
        expect(items[0].text()).toContain('Docs.history_reason_author');
        expect(items[1].text()).toContain('Me');
        expect(items[1].text()).toContain('Docs.history_private_time');
        expect(items[0].text()).not.toContain('Docs.history_private_time');
        wrapper.unmount();
    });

    it('opens the newest version and shows what changed against the one before it', async () => {
        const wrapper = await mountPanel();

        expect(wrapper.findAll('.ph__item')[0].attributes('aria-current')).toBe('true');
        expect(calls('get', '/versions/v3')).toHaveLength(1);
        expect(calls('get', '/versions/v2')).toHaveLength(1);

        expect(blocks(wrapper, 'added').map((row) => row.text())).toEqual([expect.stringContaining('New section')]);
        expect(blocks(wrapper, 'removed').map((row) => row.text())).toEqual([expect.stringContaining('Old risks')]);
        const changed = blocks(wrapper, 'changed');
        expect(changed).toHaveLength(1);
        expect(changed[0].find('del').text().trim()).toBe('small');
        expect(changed[0].find('ins').text().trim()).toBe('large');
        expect(wrapper.find('.ph__summary').text()).toContain('Docs.history_summary');
        expect(blocks(wrapper, 'added')[0].find('.ph__mark').text()).toBe('Docs.history_added');
        wrapper.unmount();
    });

    it('compares a version with the doc as it is now', async () => {
        const wrapper = await mountPanel();

        await wrapper.find('.ph__compare [data-compare="current"]').trigger('click');
        await flushPromises();

        const changed = blocks(wrapper, 'changed');
        expect(changed[0].find('del').text().trim()).toBe('large');
        expect(changed[0].find('ins').text().trim()).toBe('huge');
        expect(blocks(wrapper, 'added').map((row) => row.text())).toEqual([expect.stringContaining('Budget')]);
        expect(blocks(wrapper, 'removed').map((row) => row.text())).toEqual([expect.stringContaining('New section')]);
        wrapper.unmount();
    });

    it('opens another version from the list with the keyboard’s own click, and shows the oldest one whole', async () => {
        const wrapper = await mountPanel();

        await wrapper.findAll('.ph__item')[2].trigger('click');
        await flushPromises();

        expect(wrapper.findAll('.ph__item')[2].attributes('aria-current')).toBe('true');
        expect(wrapper.findAll('.ph__item')[0].attributes('aria-current')).toBeUndefined();
        expect(blocks(wrapper, 'same')).toHaveLength(1);
        expect(blocks(wrapper, 'added')).toHaveLength(0);
        expect(wrapper.find('.ph__summary').text()).toBe('Docs.history_first');
        expect(wrapper.find('.ph__detail-title').text()).toContain('Draft');
        wrapper.unmount();
    });

    it('renders an old version through the sanitizer, with mentions relabelled from the id', async () => {
        const wrapper = await mountPanel();
        await wrapper.findAll('.ph__item')[2].trigger('click');
        await flushPromises();

        const body = wrapper.find('.ph__blocks');
        expect(body.html()).not.toContain('onerror');
        expect(body.html()).not.toContain('steal');
        expect(body.find('span.mention').text()).toBe('@Priya Shah');
        wrapper.unmount();
    });

    it('restores a version after asking, and hands the doc back to its parent', async () => {
        const wrapper = await mountPanel();

        await wrapper.find('.ph__restore').trigger('click');
        await flushPromises();

        expect(window.confirm).toHaveBeenCalledWith('Docs.history_restore_confirm');
        expect(calls('post', '/versions/v3/restore')).toHaveLength(1);
        expect(wrapper.emitted('restored')[0][0]).toMatchObject({ _id: 'p1', title: 'Plan' });
        wrapper.unmount();
    });

    it('warns before a version from the doc’s private time is restored into a shared doc', async () => {
        const wrapper = await mountPanel();
        await wrapper.findAll('.ph__item')[1].trigger('click');
        await flushPromises();

        await wrapper.find('.ph__restore').trigger('click');
        await flushPromises();
        expect(window.confirm).toHaveBeenLastCalledWith('Docs.history_restore_private_confirm');

        await wrapper.setProps({ docPrivate: true });
        await wrapper.find('.ph__restore').trigger('click');
        await flushPromises();
        expect(window.confirm).toHaveBeenLastCalledWith('Docs.history_restore_confirm');
        wrapper.unmount();
    });

    it('does not restore when the reader says no, or when leaving unsaved edits is refused', async () => {
        window.confirm.mockReturnValue(false);
        const wrapper = await mountPanel();
        await wrapper.find('.ph__restore').trigger('click');

        window.confirm.mockReturnValue(true);
        await wrapper.setProps({ beforeRestore: () => false });
        await wrapper.find('.ph__restore').trigger('click');
        await flushPromises();

        expect(calls('post', '/restore')).toHaveLength(0);
        expect(wrapper.emitted('restored')).toBeUndefined();
        wrapper.unmount();
    });

    it('names a version in place', async () => {
        const wrapper = await mountPanel();

        await wrapper.find('.ph__rename').trigger('click');
        const field = wrapper.find('.ph__name-input');
        expect(field.attributes('aria-label')).toBe('Docs.history_name_label');
        await field.setValue('Final');
        await wrapper.find('.ph__name-form').trigger('submit');
        await flushPromises();

        expect(calls('put', '/versions/v3')[0].body).toEqual({ name: 'Final' });
        expect(wrapper.findAll('.ph__item')[0].text()).toContain('Final');
        expect(wrapper.find('.ph__name-input').exists()).toBe(false);
        wrapper.unmount();
    });

    it('saves a version with an optional name, after the unsaved edits are saved', async () => {
        const savePending = vi.fn(async () => true);
        const wrapper = await mountPanel({ savePending });

        await wrapper.find('.ph__save-name').setValue('Before review');
        await wrapper.find('.ph__save').trigger('submit');
        await flushPromises();

        expect(savePending).toHaveBeenCalledTimes(1);
        expect(calls('post', '/versions')[0].body).toEqual({ name: 'Before review' });
        expect(calls('get', '/versions')).toHaveLength(2);
        expect(wrapper.find('.ph__save-name').element.value).toBe('');
        wrapper.unmount();
    });

    it('does not save a version when the unsaved edits could not be saved', async () => {
        const wrapper = await mountPanel({ savePending: vi.fn(async () => false) });

        await wrapper.find('.ph__save').trigger('submit');
        await flushPromises();

        expect(calls('post', '/versions')).toHaveLength(0);
        wrapper.unmount();
    });

    it('says so when there is no history yet, and closes from its own button', async () => {
        api.list = [];
        const wrapper = await mountPanel();

        expect(wrapper.find('.ph__empty').text()).toBe('Docs.history_empty');
        expect(wrapper.find('.ph__restore').exists()).toBe(false);
        await wrapper.find('.ph__close').trigger('click');
        expect(wrapper.emitted('close')).toHaveLength(1);
        wrapper.unmount();
    });

    it('moves focus into the dialog when it opens', async () => {
        const wrapper = await mountPanel();
        expect(wrapper.find('.ph').element.contains(document.activeElement)).toBe(true);
        wrapper.unmount();
    });
});
