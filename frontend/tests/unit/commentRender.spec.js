import { describe, expect, it, vi } from 'vitest';
import { shallowMount } from '@vue/test-utils';

vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: {} })) }));
vi.mock('@/store/index', () => ({ default: {} }));
vi.mock('@/composable/projects', () => ({ useProjects: () => ({ getDateType: () => '' }) }));
vi.mock('@/composable/commonFunction', () => ({ storageHelper: () => ({ handleStorageImageRequest: vi.fn() }) }));
vi.mock('@/composable', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useConvertDate: () => ({ convertDateFormat: () => '' }),
        useGetterFunctions: () => ({ getUser: () => ({ Employee_Name: 'Max Member' }) }),
    };
});

import Comment from '@/components/organisms/Comment/Comment.vue';

const MARKUP = '<img src=x onerror="alert(1)"><a href="javascript:alert(2)">x</a>';

const mountWith = (message) => shallowMount(Comment, {
    props: {
        showOptions: false,
        message: { _id: 'm1', userId: 'user-2', createdAt: 1, updatedAt: 1, type: 'text', ...message },
    },
});

const unsafe = (wrapper) => wrapper.element.querySelectorAll('img, script, a[href^="javascript"], [onerror]');

describe('Comment rendering', () => {
    it('shows a stored message with markup as text', () => {
        const wrapper = mountWith({ message: MARKUP });
        expect(unsafe(wrapper)).toHaveLength(0);
        expect(wrapper.find('pre').text()).toBe(MARKUP);
    });

    it('shows a stored link message with markup as text and keeps its URL linked', () => {
        const wrapper = mountWith({ type: 'link', message: `${MARKUP} https://example.com` });
        expect(unsafe(wrapper)).toHaveLength(0);
        const anchors = wrapper.findAll('pre a');
        expect(anchors).toHaveLength(1);
        expect(anchors[0].attributes('href')).toBe('https://example.com');
    });

    it('shows a quoted reply with markup as text', () => {
        const wrapper = mountWith({ message: 'ok', hasReply: true, reply_type: 'text', reply_userId: 'user-3', reply_message: MARKUP });
        expect(unsafe(wrapper)).toHaveLength(0);
        expect(wrapper.find('.message_replay pre').text()).toBe(MARKUP);
    });

    it('shows text the web app stored escaped once, with mentions bold', () => {
        const wrapper = mountWith({ message: '&lt;b&gt;hi&lt;/b&gt; @[Max Member](abcd1234)' });
        const pre = wrapper.find('pre');
        expect(pre.text()).toBe('<b>hi</b> @Max Member');
        expect(pre.find('b.mentioned').text()).toBe('@Max Member');
    });
});
