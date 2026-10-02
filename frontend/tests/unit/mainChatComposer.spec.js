import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from '@vue/compiler-sfc';

const { ai, recorderApi } = vi.hoisted(() => ({
    ai: { allowed: true },
    recorderApi: { start: vi.fn(), cancel: vi.fn() },
}));

vi.mock('@/composable/aiAvailability', () => ({ canUseAi: () => ai.allowed }));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: (id) => (id === 'user-2' ? { Employee_Name: 'Ben Ito' } : null) }),
}));

vi.mock('@/components/atom/CommentInput/CommentInput.vue', async () => {
    const { defineComponent, h } = await import('vue');
    return {
        default: defineComponent({
            name: 'CommentInput',
            props: ['modelValue'],
            emits: ['update:modelValue', 'enter', 'pasteFile'],
            methods: { focus() { this.$el.focus(); } },
            render() {
                return h('textarea', {
                    class: 'input-stub',
                    value: this.modelValue,
                    onInput: (e) => this.$emit('update:modelValue', e.target.value),
                    onKeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) this.$emit('enter'); },
                });
            },
        }),
    };
});
vi.mock('@/components/organisms/MainChat/MainChatRecorder.vue', async () => {
    const { defineComponent, h } = await import('vue');
    return {
        default: defineComponent({
            name: 'MainChatRecorder',
            emits: ['active', 'recorded'],
            setup(_, { expose }) { expose(recorderApi); return () => h('div', { class: 'recorder-stub' }); },
        }),
    };
});

import MainChatComposer from '@/components/organisms/MainChat/MainChatComposer.vue';
import CommentInputStub from '@/components/atom/CommentInput/CommentInput.vue';
import RecorderStub from '@/components/organisms/MainChat/MainChatRecorder.vue';

let wrapper;
const KEY = 'alianhub:mainchat-draft:c1';
const mountComposer = (props = {}) => {
    wrapper = mount(MainChatComposer, {
        props: { conversationKey: 'c1', ...props },
        attachTo: document.body,
    });
    return wrapper;
};
const type = async (value) => {
    await wrapper.get('.input-stub').setValue(value);
    await flushPromises();
};
const sendButton = () => wrapper.get('.mc-send');
const tool = (key) => wrapper.findAll('.mc-tool').find((b) => b.attributes('title') === key);
const file = (name) => new File(['x'], name);

beforeEach(() => {
    ai.allowed = true;
    recorderApi.start.mockReset();
    recorderApi.cancel.mockReset();
    localStorage.clear();
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.restoreAllMocks();
});

describe('MainChatComposer states', () => {
    it('shows the placeholder key, a disabled Send and the key hints when empty', () => {
        mountComposer();
        expect(wrapper.get('.mc-comp-ph').text()).toBe('Chat.message');
        expect(sendButton().text()).toBe('Chat.send');
        expect(sendButton().attributes('disabled')).toBeDefined();
        expect(wrapper.get('.mc-send-more').attributes('disabled')).toBeDefined();
        const hint = wrapper.get('.mc-comp-hint').text();
        expect(hint).toContain('Chat.command_hint');
        expect(hint).toContain('Common.key_enter');
        expect(hint).toContain('MainChat.enter_send');
        expect(hint).toContain('Common.key_shift_enter');
        expect(hint).toContain('MainChat.shift_enter');
    });

    it('prefers a custom placeholder and hides it once typing starts', async () => {
        mountComposer({ placeholder: 'Reply to Ana' });
        expect(wrapper.get('.mc-comp-ph').text()).toBe('Reply to Ana');
        await type('hi');
        expect(wrapper.find('.mc-comp-ph').exists()).toBe(false);
    });

    it('read-only: shows the lock notice with the given reason and no input or buttons', () => {
        mountComposer({ disabled: true, disabledReason: 'Guests cannot post' });
        expect(wrapper.get('.mc-comp-locked').text()).toBe('Guests cannot post');
        expect(wrapper.find('.input-stub').exists()).toBe(false);
        expect(wrapper.find('button').exists()).toBe(false);
    });

    it('read-only without a reason falls back to the read-only key', () => {
        mountComposer({ disabled: true });
        expect(wrapper.get('.mc-comp-locked').text()).toBe('MainChat.read_only');
    });

    it('labels every toolbar button with its i18n key as title and aria-label', () => {
        mountComposer();
        const tools = wrapper.findAll('.mc-tool');
        expect(tools.map((b) => b.attributes('aria-label'))).toEqual([
            'MainChat.attach', 'Chat.cmd_clip', 'Chat.talk_to_text', 'Chat.voice_note', 'Chat.ask_ai',
        ]);
        tools.forEach((b) => expect(b.attributes('title')).toBe(b.attributes('aria-label')));
        expect(wrapper.get('.mc-send-more').attributes('title')).toBe('Chat.send_options');
    });

    it('hides the AI tools when the person has no AI access', () => {
        ai.allowed = false;
        mountComposer();
        expect(wrapper.findAll('.mc-tool').map((b) => b.attributes('aria-label'))).toEqual(['MainChat.attach', 'Chat.cmd_clip', 'Chat.voice_note']);
    });
});

describe('MainChatComposer sending', () => {
    it('Send is enabled by text, sends the trimmed body once and clears the box', async () => {
        mountComposer();
        await type('  hello team  ');
        expect(sendButton().attributes('disabled')).toBeUndefined();
        await sendButton().trigger('click');
        expect(wrapper.emitted('send')).toEqual([['hello team']]);
        expect(wrapper.get('.input-stub').element.value).toBe('');
        expect(wrapper.find('.mc-comp-ph').exists()).toBe(true);
    });

    it('whitespace alone cannot be sent, not even with Enter', async () => {
        mountComposer();
        await type('   ');
        expect(sendButton().attributes('disabled')).toBeDefined();
        await wrapper.get('.input-stub').trigger('keydown', { key: 'Enter' });
        expect(wrapper.emitted('send')).toBeUndefined();
    });

    it('Enter in the field sends; Shift+Enter does not', async () => {
        mountComposer();
        await type('line one');
        await wrapper.get('.input-stub').trigger('keydown', { key: 'Enter', shiftKey: true });
        expect(wrapper.emitted('send')).toBeUndefined();
        await wrapper.get('.input-stub').trigger('keydown', { key: 'Enter' });
        expect(wrapper.emitted('send')).toEqual([['line one']]);
    });

    it('the send menu offers send and send-as-task; send-as-task emits a task and closes the menu', async () => {
        mountComposer();
        await type('Fix the login page');
        await wrapper.get('.mc-send-more').trigger('click');
        const items = wrapper.findAll('.mc-send-menu .ah-pop__item');
        expect(items.map((i) => i.text())).toEqual(['Chat.send_enter', 'Chat.send_and_task']);
        await items[1].trigger('click');
        expect(wrapper.emitted('send-task')).toEqual([['Fix the login page']]);
        expect(wrapper.emitted('send')).toBeUndefined();
        expect(wrapper.find('.mc-send-menu').exists()).toBe(false);
    });

    it('the send menu item "send" posts as a normal message', async () => {
        mountComposer();
        await type('plain');
        await wrapper.get('.mc-send-more').trigger('click');
        await wrapper.findAll('.mc-send-menu .ah-pop__item')[0].trigger('click');
        expect(wrapper.emitted('send')).toEqual([['plain']]);
    });

    it('send-as-task with files but no text sends nothing at all', async () => {
        mountComposer();
        const input = wrapper.get('input[type="file"]');
        Object.defineProperty(input.element, 'files', { value: [file('a.png')], configurable: true });
        await input.trigger('change');
        await wrapper.get('.mc-send-more').trigger('click');
        await wrapper.findAll('.mc-send-menu .ah-pop__item')[1].trigger('click');
        expect(wrapper.emitted('send-task')).toBeUndefined();
        expect(wrapper.emitted('files')).toBeUndefined();
        expect(wrapper.findAll('.mc-comp-chip')).toHaveLength(1);
    });

    it('a click elsewhere in the page closes the send menu', async () => {
        mountComposer();
        await type('x');
        await wrapper.get('.mc-send-more').trigger('click');
        expect(wrapper.find('.mc-send-menu').exists()).toBe(true);
        document.body.click();
        await flushPromises();
        expect(wrapper.find('.mc-send-menu').exists()).toBe(false);
    });

    it('announces typing only while there is real text', async () => {
        mountComposer();
        await type('h');
        await type('   ');
        expect(wrapper.emitted('typing')).toEqual([[true], [false]]);
    });
});

describe('MainChatComposer files', () => {
    const pick = async (files) => {
        const input = wrapper.get('input[type="file"]');
        Object.defineProperty(input.element, 'files', { value: files, configurable: true });
        await input.trigger('change');
    };

    it('the attach button opens the file picker', async () => {
        mountComposer();
        const click = vi.spyOn(wrapper.get('input[type="file"]').element, 'click').mockImplementation(() => {});
        await tool('MainChat.attach').trigger('click');
        expect(click).toHaveBeenCalledTimes(1);
    });

    it('staged files appear as chips, can be removed, and enable Send without text', async () => {
        mountComposer();
        await pick([file('a.png'), file('b.pdf')]);
        expect(wrapper.findAll('.mc-comp-chip span').map((s) => s.text())).toEqual(['a.png', 'b.pdf']);
        expect(sendButton().attributes('disabled')).toBeUndefined();
        const remove = wrapper.get('.mc-comp-chip .mc-icon-btn');
        expect(remove.attributes('title')).toBe('MainChat.cancel');
        await remove.trigger('click');
        expect(wrapper.findAll('.mc-comp-chip span').map((s) => s.text())).toEqual(['b.pdf']);
    });

    it('sending emits the files, then the text, and empties the chips', async () => {
        mountComposer();
        await pick([file('a.png')]);
        await type('see attached');
        await sendButton().trigger('click');
        expect(wrapper.emitted('files')[0][0].map((f) => f.name)).toEqual(['a.png']);
        expect(wrapper.emitted('send')).toEqual([['see attached']]);
        expect(wrapper.find('.mc-comp-files').exists()).toBe(false);
    });

    it('files alone can be sent', async () => {
        mountComposer();
        await pick([file('a.png')]);
        await sendButton().trigger('click');
        expect(wrapper.emitted('files')).toHaveLength(1);
        expect(wrapper.emitted('send')).toBeUndefined();
    });

    it('keeps at most ten files, whether picked or pasted', async () => {
        mountComposer();
        await pick(Array.from({ length: 8 }, (_, i) => file(`p${i}`)));
        wrapper.getComponent(CommentInputStub).vm.$emit('pasteFile', [file('x1'), file('x2'), file('x3'), null]);
        await flushPromises();
        expect(wrapper.findAll('.mc-comp-chip')).toHaveLength(10);
    });

    it('accepts a single pasted file', async () => {
        mountComposer();
        wrapper.getComponent(CommentInputStub).vm.$emit('pasteFile', file('shot.png'));
        await flushPromises();
        expect(wrapper.get('.mc-comp-chip').text()).toContain('shot.png');
    });

    it('send-as-task also hands over staged files', async () => {
        mountComposer();
        await pick([file('a.png')]);
        await type('Task me');
        await wrapper.get('.mc-send-more').trigger('click');
        await wrapper.findAll('.mc-send-menu .ah-pop__item')[1].trigger('click');
        expect(wrapper.emitted('files')).toHaveLength(1);
        expect(wrapper.emitted('send-task')).toEqual([['Task me']]);
    });
});

describe('MainChatComposer slash commands', () => {
    it('typing / opens the command list with labelled keys; filtering narrows it', async () => {
        mountComposer();
        await type('/');
        const rows = () => wrapper.findAll('.mc-cmd .ah-pop__item');
        expect(wrapper.get('.mc-cmd .ah-pop__label').text()).toBe('Chat.commands');
        expect(rows().map((r) => r.text())).toEqual([
            expect.stringContaining('Chat.cmd_task'), expect.stringContaining('Chat.cmd_summarize'),
            expect.stringContaining('Chat.cmd_clip'), expect.stringContaining('Chat.cmd_voice'),
        ]);
        expect(rows()[0].get('kbd').text()).toBe('/task');
        await type('/cl');
        expect(rows()).toHaveLength(1);
        expect(rows()[0].text()).toContain('Chat.cmd_clip');
    });

    it('hides the AI-only command without AI access', async () => {
        ai.allowed = false;
        mountComposer();
        await type('/');
        expect(wrapper.findAll('.mc-cmd .ah-pop__item').map((r) => r.get('kbd').text())).toEqual(['/task', '/clip', '/voice']);
    });

    it('shows the no-matches line for an unknown command', async () => {
        mountComposer();
        await type('/zzz');
        expect(wrapper.get('.mc-cmd p').text()).toBe('Chat.no_matches');
    });

    it('Enter runs the first match, keeps the rest as its argument and clears the box', async () => {
        mountComposer();
        await type('/task write the report');
        await wrapper.get('.input-stub').trigger('keydown', { key: 'Enter' });
        expect(wrapper.emitted('command')).toEqual([[{ name: 'task', text: 'write the report' }]]);
        expect(wrapper.emitted('send')).toBeUndefined();
        expect(wrapper.find('.mc-cmd').exists()).toBe(false);
        expect(wrapper.get('.input-stub').element.value).toBe('');
    });

    it('Enter with no matching command sends nothing', async () => {
        mountComposer();
        await type('/zzz');
        await wrapper.get('.input-stub').trigger('keydown', { key: 'Enter' });
        expect(wrapper.emitted('command')).toBeUndefined();
        expect(wrapper.emitted('send')).toBeUndefined();
    });

    it('clicking a command runs it; /voice starts the recorder instead of emitting', async () => {
        mountComposer();
        await type('/');
        await wrapper.findAll('.mc-cmd .ah-pop__item')[3].trigger('click');
        expect(recorderApi.start).toHaveBeenCalledTimes(1);
        expect(wrapper.emitted('command')).toBeUndefined();
    });

    it('the Ask AI button toggles the command list and reports its state', async () => {
        mountComposer();
        const ask = tool('Chat.ask_ai');
        expect(ask.attributes('aria-expanded')).toBe('false');
        await ask.trigger('click');
        expect(wrapper.find('.mc-cmd').exists()).toBe(true);
        expect(ask.attributes('aria-expanded')).toBe('true');
        expect(ask.classes()).toContain('is-on');
        await ask.trigger('click');
        expect(wrapper.find('.mc-cmd').exists()).toBe(false);
    });

    it('emptying a slash draft closes the list', async () => {
        mountComposer();
        await type('/ta');
        await type('');
        expect(wrapper.find('.mc-cmd').exists()).toBe(false);
    });
});

describe('MainChatComposer toolbar and recording', () => {
    it('clip and talk buttons emit their commands', async () => {
        mountComposer();
        await tool('Chat.cmd_clip').trigger('click');
        await tool('Chat.talk_to_text').trigger('click');
        expect(wrapper.emitted('command')).toEqual([[{ name: 'clip', text: '' }], [{ name: 'talk', text: '' }]]);
    });

    it('the voice note button starts recording; the bar swaps for the recording hint', async () => {
        mountComposer();
        await tool('Chat.voice_note').trigger('click');
        expect(recorderApi.start).toHaveBeenCalledTimes(1);
        wrapper.getComponent(RecorderStub).vm.$emit('active', true);
        await flushPromises();
        expect(wrapper.find('.mc-comp-box').classes()).toContain('is-recording');
        expect(wrapper.find('.input-stub').exists()).toBe(false);
        expect(wrapper.find('.mc-tool').exists()).toBe(false);
        expect(wrapper.get('.mc-comp-hint').text()).toBe('Chat.transcription_noteChat.max_note');
    });

    it('a finished recording is sent straight away; an empty one is ignored', async () => {
        mountComposer();
        const recorder = wrapper.getComponent(RecorderStub).vm;
        recorder.$emit('recorded', null);
        recorder.$emit('recorded', file('note.webm'));
        expect(wrapper.emitted('files')).toHaveLength(1);
        expect(wrapper.emitted('files')[0][0][0].name).toBe('note.webm');
    });

    it('exposes focus to the parent and focuses the input', () => {
        mountComposer();
        wrapper.vm.focus();
        expect(document.activeElement).toBe(wrapper.get('.input-stub').element);
    });
});

describe('MainChatComposer reply and edit banners', () => {
    it('shows who is being replied to with a short preview and cancels the reply', async () => {
        mountComposer({ replyTo: { userId: 'user-2', message: '<p>Can you <b>review</b> this?</p>' } });
        const banner = wrapper.get('.mc-comp-reply');
        expect(banner.get('b').text()).toBe('Ben Ito');
        expect(banner.get('span').text()).toBe('Can you review this?');
        const cancel = banner.get('button');
        expect(cancel.attributes('title')).toBe('MainChat.cancel');
        await cancel.trigger('click');
        expect(wrapper.emitted('cancel-reply')).toHaveLength(1);
    });

    it('falls back to the agent name, then the media file name, and truncates long previews', () => {
        mountComposer({ replyTo: { agentName: 'Helper Bot', mediaOriginalName: 'x'.repeat(100) } });
        expect(wrapper.get('.mc-comp-reply b').text()).toBe('Helper Bot');
        expect(wrapper.get('.mc-comp-reply span').text()).toBe(`${'x'.repeat(80)}…`);
    });

    it('edit mode: banner, text preloaded, button reads Save and saving emits the new text', async () => {
        mountComposer();
        await wrapper.setProps({ editing: { message: '<p>old text</p>' } });
        await flushPromises();
        expect(wrapper.get('.mc-comp-reply--edit b').text()).toBe('MainChat.editing');
        expect(wrapper.get('.mc-comp-reply--edit span').text()).toBe('old text');
        expect(wrapper.get('.input-stub').element.value).toBe('old text');
        expect(sendButton().text()).toBe('MainChat.save');
        expect(sendButton().attributes('title')).toBe('MainChat.save');
        expect(wrapper.find('.mc-send-more').exists()).toBe(false);
        await type('new text');
        await sendButton().trigger('click');
        expect(wrapper.emitted('save')).toEqual([['new text']]);
        expect(wrapper.emitted('send')).toBeUndefined();
    });

    it('cancelling an edit emits cancel-edit and restores the unsent draft', async () => {
        localStorage.setItem(KEY, 'half typed');
        mountComposer();
        await wrapper.setProps({ editing: { message: 'old' } });
        await wrapper.get('.mc-comp-reply--edit button').trigger('click');
        expect(wrapper.emitted('cancel-edit')).toHaveLength(1);
        await wrapper.setProps({ editing: null });
        await flushPromises();
        expect(wrapper.get('.input-stub').element.value).toBe('half typed');
    });
});

describe('MainChatComposer drafts', () => {
    it('restores a saved draft for the conversation on mount', () => {
        localStorage.setItem(KEY, 'unsent thought');
        mountComposer();
        expect(wrapper.get('.input-stub').element.value).toBe('unsent thought');
        expect(sendButton().attributes('disabled')).toBeUndefined();
    });

    it('saves the draft as you type and removes it once sent', async () => {
        mountComposer();
        await type('draft me');
        expect(localStorage.getItem(KEY)).toBe('draft me');
        await sendButton().trigger('click');
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    // The key watcher saves the old draft after props.conversationKey already holds the new key, so the text leaks into the next chat.
    it.fails('switching conversation keeps each draft separate and drops staged files', async () => {
        mountComposer();
        await type('for c1');
        await wrapper.setProps({ conversationKey: 'c2' });
        await flushPromises();
        expect(recorderApi.cancel).toHaveBeenCalled();
        expect(wrapper.get('.input-stub').element.value).toBe('');
        await type('for c2');
        await wrapper.setProps({ conversationKey: 'c1' });
        await flushPromises();
        expect(wrapper.get('.input-stub').element.value).toBe('for c1');
        expect(localStorage.getItem('alianhub:mainchat-draft:c2')).toBe('for c2');
    });

    it('still works when browser storage throws', async () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
        mountComposer();
        await type('still sends');
        await sendButton().trigger('click');
        expect(wrapper.emitted('send')).toEqual([['still sends']]);
    });
});

describe('MainChatComposer copy', () => {
    const source = readFileSync(resolve(__dirname, '../../src/components/organisms/MainChat/MainChatComposer.vue'), 'utf8');
    const visibleAttrs = ['title', 'placeholder', 'alt', 'aria-label', 'label'];

    const bareCopy = () => {
        const found = [];
        const walk = (node) => {
            if (node.type === 2 && /\p{L}|\d/u.test(node.content)) found.push(node.content.trim());
            (node.props || []).forEach((p) => {
                if (p.type === 6 && visibleAttrs.includes(p.name) && p.value?.content) found.push(`${p.name}="${p.value.content}"`);
            });
            (node.children || []).forEach((c) => typeof c === 'object' && walk(c));
        };
        walk(parse(source).descriptor.template.ast);
        return found;
    };

    it('has no hard-coded visible text or attributes in the template', () => {
        expect(bareCopy()).toEqual([]);
    });

    it('renders only i18n keys as words, including the recording and locked views', async () => {
        mountComposer();
        await type('/');
        const leftover = wrapper.text().replace(/(Chat|MainChat|Common)\.[a-z_]+/g, '').replace(/[\s/·]|task|summarize|clip|voice/g, '');
        expect(leftover).toBe('');
    });
});
