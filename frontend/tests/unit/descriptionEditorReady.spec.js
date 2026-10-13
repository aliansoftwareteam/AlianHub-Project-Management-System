import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shallowMount } from '@vue/test-utils';

const editors = vi.hoisted(() => []);

vi.mock('@editorjs/editorjs', () => ({
    default: class {
        constructor(config) {
            this.config = config;
            this.render = vi.fn(() => Promise.resolve());
            editors.push(this);
        }
    },
}));
vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: {} })) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ params: {}, query: {} }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('vue-toast-notification', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: (key) => key }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, debounce: (fn) => fn }),
}));
vi.mock('@/composable/aiAvailability', () => ({ canUseAi: () => false }));
vi.mock('vuex', async (importOriginal) => ({
    ...(await importOriginal()),
    useStore: () => ({ getters: { 'settings/selectedCompany': {} }, commit: vi.fn() }),
}));

import Description from '@/components/atom/Description/Description.vue';

const mountDescription = () => shallowMount(Description, {
    props: { description: { blocks: [] }, editPermission: true, isMainSpinner: false, from: 'task', task: {}, projectData: {} },
    attachTo: document.body,
    global: { provide: { $clientWidth: 1200, $companyId: 'c1' }, mocks: { $t: (key) => key } },
});

const descriptionEditor = () => editors.find((editor) => editor.config.holder === 'editorjs');

describe('the description editor becoming ready', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        editors.length = 0;
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('pads its own text area and renders the description', () => {
        const wrapper = mountDescription();
        const redactor = document.createElement('div');
        redactor.className = 'codex-editor__redactor';
        wrapper.find('#editorjs').element.appendChild(redactor);

        descriptionEditor().config.onReady();
        vi.advanceTimersByTime(500);

        expect(redactor.style.paddingBottom).toBe('10px');
        expect(descriptionEditor().render).toHaveBeenCalledTimes(1);
        wrapper.unmount();
    });

    it('does nothing when the panel moved to another task before the editor was ready', () => {
        const wrapper = mountDescription();
        const editor = descriptionEditor();
        wrapper.unmount();

        expect(() => editor.config.onReady()).not.toThrow();
        vi.advanceTimersByTime(500);
        expect(editor.render).not.toHaveBeenCalled();
    });
});
