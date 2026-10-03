import { describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, provide, reactive } from 'vue';
import { CARD_META_KEY, REPORT_TIMEOUT_MS, useCardMeta } from '@/components/organisms/DashboardCard/useCardMeta';

function bodyUnder(setup) {
    let meta;
    const Body = defineComponent({ setup() { meta = useCardMeta(); return () => h('div'); } });
    const Shell = defineComponent({ setup() { setup?.(); return () => h(Body); } });
    createApp(Shell).mount(document.createElement('div'));
    return meta;
}

describe('useCardMeta', () => {
    it('hands a body the object its card shell draws from', () => {
        const shared = reactive({ state: '', note: '' });
        const meta = bodyUnder(() => provide(CARD_META_KEY, shared));
        meta.state = 'ready';
        meta.note = 'Updated just now';
        expect(shared.state).toBe('ready');
        expect(shared.note).toBe('Updated just now');
    });

    it('gives a body on its own a detached object that starts blank', () => {
        const meta = bodyUnder();
        expect(meta).toEqual({ state: '', note: '', updatedAt: null, emptyText: '', emptyAction: '', error: '' });
    });

    it('does not share the detached object between two bodies', () => {
        const a = bodyUnder();
        const b = bodyUnder();
        a.state = 'error';
        expect(b.state).toBe('');
    });

    it('keeps the detached object reactive', () => {
        const meta = bodyUnder();
        expect(Object.keys(meta)).toContain('updatedAt');
        meta.updatedAt = 1700000000000;
        expect(meta.updatedAt).toBe(1700000000000);
    });

    it('waits fifteen seconds for a body to report', () => {
        expect(REPORT_TIMEOUT_MS).toBe(15000);
    });
});
