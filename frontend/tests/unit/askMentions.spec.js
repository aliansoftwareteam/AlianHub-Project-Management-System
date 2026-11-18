import { describe, expect, it } from 'vitest';
import { contextPayload, groupMentions, mentionAt, mentionItems, recentMentions, rememberMention, MAX_CONTEXT, RECENT_LIMIT } from '@/views/Ai/askComposer';

const memoryStore = () => {
    const data = {};
    return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
};

describe('mention parsing', () => {
    it('opens on a bare @ and on an @word at the caret', () => {
        expect(mentionAt('@', 1)).toEqual({ query: '', start: 0, end: 1 });
        expect(mentionAt('how is @plat', 12)).toEqual({ query: 'plat', start: 7, end: 12 });
        expect(mentionAt('mail me@example.com', 19)).toBeNull();
    });
});

describe('picker rows', () => {
    it('keeps the kinds the box knows and drops rows without an id or title', () => {
        const out = mentionItems({ items: [
            { kind: 'project', id: 'p1', title: 'Ops' },
            { kind: 'list', id: 'l1', title: 'Sprint 4', sub: 'Ops' },
            { kind: 'person', id: 'u1', title: 'Grace Kim' },
            { kind: 'comment', id: 'c1', title: 'x' },
            { kind: 'task', id: '', title: 'no id' }
        ] });
        expect(out.map((i) => i.kind)).toEqual(['project', 'list', 'person']);
        expect(out[1]).toEqual({ kind: 'list', id: 'l1', title: 'Sprint 4', sub: 'Ops' });
        expect(mentionItems(null)).toEqual([]);
    });

    it('groups by kind in picker order, with flat indexes for the keyboard', () => {
        const { items, groups } = groupMentions([
            { kind: 'person', id: 'u1', title: 'Grace' },
            { kind: 'task', id: 't1', title: 'Fix export' },
            { kind: 'project', id: 'p1', title: 'Ops' },
            { kind: 'task', id: 't2', title: 'Ship' }
        ]);
        expect(items.map((i) => i.id)).toEqual(['p1', 't1', 't2', 'u1']);
        expect(groups.map((g) => g.kind)).toEqual(['project', 'task', 'person']);
        expect(groups[1].items.map((r) => r.index)).toEqual([1, 2]);
    });

    it('puts matching recent picks first, and leaves out repeats and attached chips', () => {
        const { items } = groupMentions(
            [{ kind: 'task', id: 't1', title: 'Fix export' }, { kind: 'task', id: 't2', title: 'Fix login' }, { kind: 'task', id: 't3', title: 'Fix chart' }],
            { first: [{ kind: 'task', id: 't2', title: 'Fix login' }, { kind: 'task', id: 't9', title: 'Unrelated' }], taken: [{ kind: 'task', id: 't3' }], query: 'fix' }
        );
        expect(items.map((i) => i.id)).toEqual(['t2', 't1']);
    });
});

describe('payload', () => {
    it('sends kind and id only, at most the cap', () => {
        const chips = Array.from({ length: MAX_CONTEXT + 2 }, (_, i) => ({ kind: 'task', id: `t${i}`, title: `T${i}` }));
        const out = contextPayload([{ kind: 'project', id: 'p1', title: 'Ops' }, { kind: 'bogus', id: 'x' }, ...chips]);
        expect(out[0]).toEqual({ kind: 'project', id: 'p1' });
        expect(out).toHaveLength(MAX_CONTEXT);
        expect(out.every((c) => Object.keys(c).join() === 'kind,id')).toBe(true);
    });
});

describe('recent picks', () => {
    it('keeps the latest picks per company, newest first, without repeats', () => {
        const store = memoryStore();
        rememberMention('c1', { kind: 'project', id: 'p1', title: 'Ops' }, store);
        rememberMention('c1', { kind: 'task', id: 't1', title: 'Fix' }, store);
        rememberMention('c1', { kind: 'project', id: 'p1', title: 'Ops' }, store);
        rememberMention('c2', { kind: 'task', id: 't2', title: 'Other' }, store);
        expect(recentMentions('c1', store).map((i) => i.id)).toEqual(['p1', 't1']);
        expect(recentMentions('c2', store).map((i) => i.id)).toEqual(['t2']);
        for (let i = 0; i < RECENT_LIMIT + 3; i += 1) rememberMention('c1', { kind: 'task', id: `x${i}`, title: `X${i}` }, store);
        expect(recentMentions('c1', store)).toHaveLength(RECENT_LIMIT);
    });

    it('reads as empty when storage is missing, broken or holds junk', () => {
        expect(recentMentions('c1', null)).toEqual([]);
        expect(recentMentions('c1', { getItem: () => { throw new Error('blocked'); } })).toEqual([]);
        expect(recentMentions('c1', { getItem: () => '{not json' })).toEqual([]);
        expect(() => rememberMention('c1', { kind: 'task', id: 't', title: 'T' }, { getItem: () => '{}', setItem: () => { throw new Error('full'); } })).not.toThrow();
    });
});
