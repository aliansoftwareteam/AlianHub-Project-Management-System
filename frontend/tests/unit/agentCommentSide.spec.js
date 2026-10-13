import { describe, expect, it, vi } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import { ref } from 'vue';

const VIEWER = 'viewer-1';

vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: {} })), apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/store/index', () => ({ default: {} }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('vue-toast-notification', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/composable/projects', () => ({ useProjects: () => ({ getDateType: () => '' }) }));
vi.mock('@/composable/commonFunction', () => ({ storageHelper: () => ({ handleStorageImageRequest: vi.fn() }) }));
vi.mock('@/composable', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useCustomComposable: () => ({ makeUniqueId: () => 'id' }),
        useConvertDate: () => ({ convertDateFormat: () => '' }),
        useGetterFunctions: () => ({ getUser: () => ({ Employee_Name: 'Max Member' }) }),
    };
});

import { isAgentComment, isOnViewerSide } from '@/utils/commentSide';
import { showUserInfo } from '@/views/Projects/Comments/helper';
import Comment from '@/components/organisms/Comment/Comment.vue';
import MainChatMessage from '@/components/organisms/MainChat/MainChatMessage.vue';

const mine = { _id: 'm1', userId: VIEWER, type: 'text', message: 'hi', createdAt: '2026-09-23T10:00:05Z', updatedAt: '2026-09-23T10:00:05Z' };
const agentForMe = { ...mine, _id: 'm2', actorType: 'agent', agentId: 'a1', message: 'done', createdAt: '2026-09-23T10:00:20Z', updatedAt: '2026-09-23T10:00:20Z' };
const decorate = (row) => ({ ...row, sent: isOnViewerSide(row, VIEWER) });

describe('which side of the thread a comment sits on', () => {
    it('keeps the viewer\'s own comments on their side', () => {
        expect(isOnViewerSide(mine, VIEWER)).toBe(true);
        expect(isOnViewerSide({ ...mine, userId: 'someone-else' }, VIEWER)).toBe(false);
    });

    it('puts an agent comment made for the viewer on the agent\'s side', () => {
        expect(isAgentComment(agentForMe)).toBe(true);
        expect(isOnViewerSide(agentForMe, VIEWER)).toBe(false);
        expect(isOnViewerSide({ ...mine, isAgent: true }, VIEWER)).toBe(false);
    });

    it('does not fold an agent comment into the viewer\'s run, so its author shows', () => {
        expect(showUserInfo(decorate(agentForMe), decorate(mine))).toBe(true);
        expect(showUserInfo(decorate({ ...agentForMe, _id: 'm3' }), decorate(agentForMe))).toBe(false);
    });
});

describe('Comment with an agent row for the viewer', () => {
    const mountComment = (message) => shallowMount(Comment, {
        props: { message, showUser: true, showOptions: true, showMessageTime: true },
        global: {
            provide: { $userId: ref(VIEWER), $companyId: ref('c1') },
            stubs: {
                DropDown: { template: '<div class="dd"><slot name="button" /><slot name="options" /></div>' },
                DropDownOption: { template: '<button class="dd-option"><slot /></button>' },
            },
        },
    });

    it('renders on the left with the author shown', () => {
        const wrapper = mountComment(decorate(agentForMe));
        expect(wrapper.find('.message').classes()).not.toContain('right-message');
        expect(wrapper.find('.show__user').text()).not.toBe('');
    });

    it('still lets the person it was posted for delete it, but not edit it', () => {
        const options = mountComment(decorate(agentForMe)).findAll('.dd-option').map((option) => option.text());
        expect(options).toContain('Projects.delete');
        expect(options).not.toContain('Comments.edit');
    });

    it('leaves the viewer\'s own comment on the right', () => {
        expect(mountComment(decorate(mine)).find('.message').classes()).toContain('right-message');
    });
});

describe('MainChatMessage with an agent row for the viewer', () => {
    const mountMessage = (message) => shallowMount(MainChatMessage, {
        props: { message, senderName: 'Max Member' },
        global: { mocks: { $t: (key) => key } },
    });

    it('is not drawn as the viewer\'s own bubble', () => {
        const root = mountMessage({ ...agentForMe, sent: true }).find('.mc-msg');
        expect(root.classes()).toContain('is-agent');
        expect(root.classes()).not.toContain('is-me');
    });

    it('keeps the viewer\'s own message as their bubble', () => {
        expect(mountMessage({ ...mine, sent: true }).find('.mc-msg').classes()).toContain('is-me');
    });
});
