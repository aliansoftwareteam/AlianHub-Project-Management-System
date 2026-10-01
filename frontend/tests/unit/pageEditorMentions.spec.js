import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { push, users } = vi.hoisted(() => ({
    push: vi.fn(),
    users: {
        '64b7f0c2a1b2c3d4e5f60a01': { Employee_Name: 'Ann Lee' },
        '64b7f0c2a1b2c3d4e5f60a02': { Employee_Name: 'Bob Stone' },
    },
}));

vi.mock('@editorjs/editorjs', () => ({
    default: class {
        constructor(opts) { this.opts = opts; setTimeout(() => opts.onReady && opts.onReady(), 0); }
        async save() { return { blocks: [] }; }
        async render() {}
        destroy() {}
    },
}));
vi.mock('@editorjs/header', () => ({ default: class {} }));
vi.mock('@editorjs/nested-list', () => ({ default: class {} }));
vi.mock('@editorjs/checklist', () => ({ default: class {} }));
vi.mock('@editorjs/marker', () => ({ default: class {} }));
vi.mock('@editorjs/code', () => ({ default: class {} }));
vi.mock('@editorjs/inline-code', () => ({ default: class {} }));
vi.mock('@editorjs/embed', () => ({ default: class {} }));
vi.mock('@editorjs/table', () => ({ default: class {} }));
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { cid: 'c1' } }), useRouter: () => ({ push }) }));
vi.mock('vuex', () => ({
    useStore: () => ({
        getters: {
            'settings/companyUsers': [
                { userId: '64b7f0c2a1b2c3d4e5f60a01', status: 2, isDelete: false },
                { userId: '64b7f0c2a1b2c3d4e5f60a02', status: 2, isDelete: false },
                { userId: '64b7f0c2a1b2c3d4e5f60a09', status: 2, isDelete: false, isAgent: true },
            ],
        },
    }),
}));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: (id) => users[id] || { ghostUser: true } }),
    useCustomComposable: () => ({ checkPermission: () => true, checkBucketStorage: () => true, getWasabiImageLink: async () => '' }),
}));
vi.mock('@/services', () => ({
    apiRequest: vi.fn(async (method, url) => {
        if (String(url).includes('/pages?scope=all')) return { data: { status: true, data: [{ _id: '64b7f0c2a1b2c3d4e5f60d01', title: 'Annual plan' }] } };
        if (String(url).includes('/task/find')) return { data: [] };
        return { data: {} };
    }),
}));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import PageBlockEditor from '@/components/molecules/Pages/PageBlockEditor.vue';

// jsdom does no layout, so a Range has no box to place the picker by.
Range.prototype.getBoundingClientRect = () => ({ top: 10, bottom: 30, left: 20, right: 40, width: 20, height: 20 });

afterEach(() => { document.body.innerHTML = ''; });

async function editorWithText(text) {
    const wrapper = mount(PageBlockEditor, { attachTo: document.body.appendChild(document.createElement('div')), props: { seed: {}, editorKey: 'k1', pageId: 'p1' } });
    await flushPromises();
    const paragraph = document.createElement('div');
    paragraph.setAttribute('contenteditable', 'true');
    paragraph.textContent = text;
    wrapper.get('.pbe__holder').element.appendChild(paragraph);
    const caret = document.createRange();
    caret.setStart(paragraph.firstChild, text.length);
    caret.collapse(true);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(caret);
    paragraph.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(document.querySelectorAll('.dmp__row').length).toBeGreaterThan(0), { timeout: 4000 });
    return { wrapper, paragraph };
}

const press = (target, key) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

describe('typing @ in a doc', () => {
    it('offers matching people and docs, never agents', async () => {
        const { wrapper } = await editorWithText('Ask @an');
        const rows = [...document.querySelectorAll('.dmp__name')].map((row) => row.textContent.trim());
        expect(rows).toEqual(['Ann Lee', 'Annual plan']);
        wrapper.unmount();
    });

    it('turns the typed @query into a mention on Enter, without a new line', async () => {
        const { wrapper, paragraph } = await editorWithText('Ask @an');
        const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        paragraph.dispatchEvent(enter);
        expect(enter.defaultPrevented).toBe(true);
        const mention = paragraph.querySelector('span.mention');
        expect(mention.dataset).toMatchObject({ mention: 'user', id: '64b7f0c2a1b2c3d4e5f60a01' });
        expect(mention.textContent).toBe('@Ann Lee');
        expect(paragraph.textContent).toBe('Ask @Ann Lee\u00a0');
        await flushPromises();
        expect(document.querySelector('.dmp')).toBeNull();
        wrapper.unmount();
    });

    it('moves between results with the arrow keys and closes on Escape', async () => {
        const { wrapper, paragraph } = await editorWithText('Ask @an');
        press(paragraph, 'ArrowDown');
        await flushPromises();
        expect(document.querySelector('.dmp__row.is-active .dmp__name').textContent.trim()).toBe('Annual plan');
        press(paragraph, 'Escape');
        await flushPromises();
        expect(document.querySelector('.dmp')).toBeNull();
        expect(paragraph.querySelector('.mention')).toBeNull();
        wrapper.unmount();
    });

    it('opens a doc mention when it is clicked', async () => {
        const { wrapper, paragraph } = await editorWithText('Ask @annual');
        press(paragraph, 'Enter');
        paragraph.querySelector('.mention').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await flushPromises();
        expect(push).toHaveBeenCalledWith({ name: 'PageEditor', params: { cid: 'c1', pageId: '64b7f0c2a1b2c3d4e5f60d01' } });
        wrapper.unmount();
    });
});
