import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { api } = vi.hoisted(() => ({ api: { apiRequest: vi.fn() } }));
vi.mock('@/services', () => api);
vi.mock('vuex', () => ({ useStore: () => ({ getters: {}, commit: vi.fn(), dispatch: vi.fn() }) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { cid: 'c1' }, query: {} }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: () => ({ id: 'user-1', Employee_Name: 'Asha Rao' }) }),
    useCustomComposable: () => ({ checkPermission: () => true, getWasabiImageLink: async () => '' }),
}));

import PageDocument from '@/components/molecules/Pages/PageDocument.vue';
import PublicShareModal from '@/components/molecules/PublicShare/PublicShareModal.vue';

const PAGE = { _id: 'p1', title: 'Plan', content: { html: '<p>Body</p>' }, visibility: 'project', createdBy: 'user-1' };
const answers = (method, url) => {
    if (String(url).includes('/who-can-see/')) return { data: { status: true, data: { title: 'Plan', groups: [], links: [] } } };
    if (String(url).includes('/public-shares')) return { data: { status: true, data: null } };
    return { status: 200, data: { status: true, data: PAGE } };
};

let wrapper;
const inner = () => document.body.querySelector('.wcs');
const pressEscape = (target) => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return flushPromises();
};
const clickInnerClose = () => {
    inner().querySelector('.wcs__icon').click();
    return flushPromises();
};

beforeEach(() => { api.apiRequest.mockImplementation(async (method, url) => answers(method, url)); });
afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = '';
});

describe('who can see this, over a doc share dialog', () => {
    const outer = () => document.body.querySelector('.pd__share');

    async function openBoth() {
        wrapper = mount(PageDocument, {
            attachTo: document.body.appendChild(document.createElement('div')),
            props: { pageId: 'p1' },
            global: { stubs: { PageBlockEditor: true, PageComments: true, PageComposeRail: true, PagePresenter: true, TaskChipPicker: true, ShellIcon: true, UserProfile: true } },
        });
        await flushPromises();
        await wrapper.findAll('.pd__actions .ah-btn--secondary').find((button) => button.text().includes('Docs.share')).trigger('click');
        await flushPromises();
        const opener = wrapper.find('.pd__who');
        opener.element.focus();
        await opener.trigger('click');
        await flushPromises();
        expect(outer()).not.toBeNull();
        expect(inner()).not.toBeNull();
        return opener.element;
    }

    it('closes by its button and leaves the share dialog open', async () => {
        await openBoth();
        await clickInnerClose();
        expect(inner()).toBeNull();
        expect(outer()).not.toBeNull();
    });

    it('closes on Escape and leaves the share dialog open', async () => {
        await openBoth();
        expect(inner().contains(document.activeElement)).toBe(true);
        await pressEscape(document.activeElement);
        expect(inner()).toBeNull();
        expect(outer()).not.toBeNull();
    });

    it('takes Escape even when focus has left it', async () => {
        await openBoth();
        document.activeElement.blur();
        await pressEscape(document.body);
        expect(inner()).toBeNull();
        expect(outer()).not.toBeNull();
    });

    it('hands focus back to its opener, where the next Escape closes the share dialog', async () => {
        const opener = await openBoth();
        await clickInnerClose();
        expect(document.activeElement).toBe(opener);
        await pressEscape(document.activeElement);
        expect(outer()).toBeNull();
    });
});

describe('who can see this, over the public link dialog', () => {
    const PROJECT = { _id: 'pr1', sprintsObj: { s1: { id: 's1', name: 'Sprint 1' } } };
    const outer = () => document.body.querySelector('.pshare__card');
    const outerClosed = () => (wrapper.emitted('update:modelValue') || []).some(([open]) => open === false);

    async function openBoth() {
        wrapper = mount(PublicShareModal, {
            attachTo: document.body.appendChild(document.createElement('div')),
            props: { projectData: PROJECT, modelValue: false },
            global: { stubs: { ShellIcon: true, UserProfile: true } },
        });
        await wrapper.setProps({ modelValue: true });
        await flushPromises();
        await wrapper.find('.pshare__who').trigger('click');
        await flushPromises();
        expect(outer()).not.toBeNull();
        expect(inner()).not.toBeNull();
    }

    it('closes by its button and leaves the public link dialog open', async () => {
        await openBoth();
        await clickInnerClose();
        expect(inner()).toBeNull();
        expect(outerClosed()).toBe(false);
    });

    it('closes on Escape and leaves the public link dialog open', async () => {
        await openBoth();
        await pressEscape(document.activeElement);
        expect(inner()).toBeNull();
        expect(outerClosed()).toBe(false);
    });

    it('takes Escape even when focus has left it, and the next Escape closes the public link dialog', async () => {
        await openBoth();
        document.activeElement.blur();
        await pressEscape(document.body);
        expect(inner()).toBeNull();
        expect(outerClosed()).toBe(false);

        await pressEscape(document.body);
        expect(outerClosed()).toBe(true);
    });
});
