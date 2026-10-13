import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('vue-router', () => ({ useRoute: () => ({ params: { cid: 'c1' } }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('vuex', () => ({ useStore: () => ({ getters: { 'settings/companyUsers': [] } }) }));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: () => ({ ghostUser: true }) }),
    useCustomComposable: () => ({ checkPermission: () => true, checkBucketStorage: () => true, getWasabiImageLink: async () => '' }),
}));
vi.mock('@/composable/aiAvailability', () => ({ canUseAi: () => false }));
vi.mock('@/services', () => ({ apiRequest: vi.fn(async () => ({ data: {} })) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/molecules/AiSelection/AiSelectionPanel.vue', () => ({ default: { name: 'AiSelectionPanel', render: () => null } }));

import PageBlockEditor from '@/components/molecules/Pages/PageBlockEditor.vue';

// jsdom does no layout; Editor.js asks for these when it starts, places the toolbar and the caret, and takes a mouse press.
Range.prototype.getBoundingClientRect = () => ({ top: 10, bottom: 30, left: 20, right: 40, width: 20, height: 20 });
Range.prototype.getClientRects = () => [];
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
document.elementFromPoint = () => document.querySelector('.ce-paragraph');

afterEach(() => { document.body.innerHTML = ''; });

async function readyEditor(seed = {}) {
    const wrapper = mount(PageBlockEditor, { attachTo: document.body.appendChild(document.createElement('div')), props: { seed, editorKey: 'k1', pageId: 'p1' } });
    await vi.waitFor(() => expect(wrapper.emitted('ready')).toBeTruthy(), { timeout: 8000 });
    return wrapper;
}

function caretInto(block) {
    block.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    block.focus();
    const caret = document.createRange();
    caret.selectNodeContents(block);
    caret.collapse(false);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(caret);
    document.dispatchEvent(new Event('selectionchange'));
}

function typeSlash(block) {
    const keydown = new KeyboardEvent('keydown', { key: '/', code: 'Slash', keyCode: 191, bubbles: true, cancelable: true });
    block.dispatchEvent(keydown);
    block.dispatchEvent(new InputEvent('input', { data: '/', inputType: 'insertText', bubbles: true }));
    block.dispatchEvent(new KeyboardEvent('keyup', { key: '/', code: 'Slash', keyCode: 191, bubbles: true }));
    return keydown;
}

const blockMenu = () => document.querySelector('.ce-toolbox .ce-popover--opened, .ce-popover--opened');

describe('typing / in a doc', () => {
    it('opens the block menu in an empty block', async () => {
        const wrapper = await readyEditor();
        const block = document.querySelector('.ce-paragraph');
        expect(blockMenu()).toBeNull();
        caretInto(block);
        const keydown = typeSlash(block);
        expect(keydown.defaultPrevented).toBe(true);
        await vi.waitFor(() => expect(blockMenu()).not.toBeNull(), { timeout: 4000 });
        wrapper.unmount();
    });
});
