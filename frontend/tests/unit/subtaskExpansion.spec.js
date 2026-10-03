import { describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, provide } from 'vue';
import { SUBTASK_EXPANSION, createSubtaskExpansion, useSubtaskExpansion } from '@/views/Projects/ListView/subtaskExpansion';

function runIn(setup) {
    let result;
    const Child = defineComponent({ setup() { result = useSubtaskExpansion(); return () => h('div'); } });
    const Root = defineComponent({ setup() { setup?.(); return () => h(Child); } });
    const app = createApp(Root);
    app.mount(document.createElement('div'));
    return { result, app };
}

describe('createSubtaskExpansion', () => {
    it('starts with every parent row closed', () => {
        const state = createSubtaskExpansion();
        expect(state.expandedIds.value).toEqual([]);
        expect(state.autoExpandedIds.value).toEqual([]);
    });

    it('gives each call its own lists', () => {
        const a = createSubtaskExpansion();
        const b = createSubtaskExpansion();
        a.expandedIds.value.push('t1');
        expect(b.expandedIds.value).toEqual([]);
    });
});

describe('useSubtaskExpansion', () => {
    it('shares the list that owns it, so a row keeps its state when its group is rebuilt', () => {
        const owned = createSubtaskExpansion();
        owned.expandedIds.value.push('task-9');
        const { result } = runIn(() => provide(SUBTASK_EXPANSION, owned));
        expect(result).toBe(owned);
        expect(result.expandedIds.value).toEqual(['task-9']);
    });

    it('falls back to a private state when no list is above it', () => {
        const { result } = runIn();
        expect(result.expandedIds.value).toEqual([]);
        expect(result.autoExpandedIds.value).toEqual([]);
    });

    it('does not share the fallback between two rows', () => {
        const one = runIn().result;
        const two = runIn().result;
        one.expandedIds.value.push('x');
        expect(two.expandedIds.value).toEqual([]);
    });
});
