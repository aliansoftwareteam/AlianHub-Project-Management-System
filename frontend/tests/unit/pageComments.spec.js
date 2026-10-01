import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { threadsOf, applyCommentEvent, mentionQueryAt, insertMention } from '@/components/molecules/Pages/pageComments';
import { renderNotice } from '@/views/Inbox/renderNotice';
import en from '@/locales/en';

const at = (minute) => new Date(Date.UTC(2026, 8, 30, 10, minute)).toISOString();
const row = (id, extra = {}) => ({ _id: id, pageId: 'p1', userId: 'u1', message: id, createdAt: at(Number(id.replace(/\D/g, '')) || 0), ...extra });

describe('doc comment threads', () => {
    it('groups replies under their thread, oldest first', () => {
        const threads = threadsOf([row('r3', { parentId: 'c1' }), row('c2'), row('c1'), row('r1', { parentId: 'c1' })], ['intro']);
        expect(threads.map((t) => t.root._id)).toEqual(['c1', 'c2']);
        expect(threads[0].replies.map((r) => r._id)).toEqual(['r1', 'r3']);
    });

    it('shows a thread whose block is gone at doc level', () => {
        const threads = threadsOf([row('c1', { blockId: 'intro' }), row('c2', { blockId: 'gone' }), row('c3', { blockId: '', blockRemoved: true })], ['intro']);
        expect(threads.map((t) => [t.root._id, t.blockId, t.blockRemoved])).toEqual([['c1', 'intro', false], ['c2', '', true], ['c3', '', true]]);
    });

    it('keeps a block anchor while the block list is not known yet', () => {
        expect(threadsOf([row('c1', { blockId: 'intro' })], null)[0].blockId).toBe('intro');
    });

    it('drops replies whose thread is not there', () => {
        expect(threadsOf([row('r1', { parentId: 'missing' })], [])).toEqual([]);
    });
});

describe('a live comment event', () => {
    it('adds a new comment and replaces an edited one', () => {
        const added = applyCommentEvent([row('c1')], row('c2'));
        expect(added.map((c) => c._id)).toEqual(['c1', 'c2']);
        const edited = applyCommentEvent(added, row('c1', { message: 'edited' }));
        expect(edited.find((c) => c._id === 'c1').message).toBe('edited');
    });

    it('takes a deleted thread away with its replies', () => {
        const list = [row('c1'), row('r1', { parentId: 'c1' }), row('c2')];
        expect(applyCommentEvent(list, row('c1', { isDeleted: true })).map((c) => c._id)).toEqual(['c2']);
    });
});

describe('the mention picker', () => {
    it('opens on an @ at a word start and reads the name typed after it', () => {
        expect(mentionQueryAt('Hi @pri', 7)).toEqual({ start: 3, query: 'pri' });
        expect(mentionQueryAt('@', 1)).toEqual({ start: 0, query: '' });
        expect(mentionQueryAt('mail@example', 12)).toBeNull();
        expect(mentionQueryAt('Hi @pri ya', 10)).toBeNull();
    });

    it('writes the mention in the stored comment form and moves the caret after it', () => {
        expect(insertMention('Hi @pri thanks', 3, 7, { name: 'Priya Shah', id: '6f0000000000000000000a01' }))
            .toEqual({ text: 'Hi @[Priya Shah](6f0000000000000000000a01)  thanks', caret: 43 });
    });
});

describe('the Inbox line for a doc comment', () => {
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });
    const t = i18n.global.t;
    const notice = (key, changeData) => ({ key, changeType: 'doc_comment', message: 'Hi', changeData });

    it('says who did what on which doc, with the title shown as text', () => {
        const html = renderNotice(notice('doc_comment_mention', { pageTitle: '<img src=x onerror=alert(1)>' }), { t, changeText: (x) => x });
        const wrapper = mount({ template: '<p v-html="html"></p>', data: () => ({ html }) });
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>');
        expect(renderNotice(notice('doc_comment_reply', { pageTitle: 'Plan' }), { t, changeText: (x) => x })).toContain('Plan');
    });
});
