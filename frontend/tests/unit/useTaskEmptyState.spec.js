import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import { taskEmptyStateKind, useTaskEmptyState } from '@/views/Projects/composables/useTaskEmptyState';
import en from '@/locales/en';

const kind = (over = {}) => taskEmptyStateKind({ showArchived: false, lastTaskId: 7, searched: false, ...over });

function mountComposable({ project, searchedTask, showArchived }) {
    const Probe = defineComponent({
        setup: () => useTaskEmptyState(project),
        template: '<div />',
    });
    const wrapper = mount(Probe, {
        global: { provide: { searchedTask, showArchived } },
    });
    return wrapper.vm;
}

describe('taskEmptyStateKind', () => {
    it('says the project has no tasks only when none was ever created', () => {
        expect(kind({ lastTaskId: 0 })).toBe('no_tasks');
        expect(kind({ lastTaskId: undefined })).toBe('no_tasks');
        expect(kind({ lastTaskId: 1 })).not.toBe('no_tasks');
    });

    it('blames a filter only when one is actually narrowing the list', () => {
        expect(kind({ searched: true })).toBe('no_match');
        expect(kind({ searched: false })).toBe('no_visible_tasks');
    });

    it('reads the archive toggle before searchedTask, which the toggle alone sets', () => {
        expect(kind({ showArchived: true, searched: true })).toBe('no_archived');
        expect(kind({ showArchived: true, searched: false })).toBe('no_archived');
    });

    it('keeps the archive answer on a project that never held a task', () => {
        expect(kind({ showArchived: true, lastTaskId: 0 })).toBe('no_archived');
    });
});

describe('useTaskEmptyState', () => {
    const project = ref({ lastTaskId: 12 });

    it('sends the archive toggle to the archive copy, not the filter copy', () => {
        const vm = mountComposable({ project, searchedTask: ref(true), showArchived: ref(true) });
        expect(vm.emptyTitleKey).toBe('EmptyState.no_archived_title');
        expect(vm.emptyMessageKey).toBe('EmptyState.no_archived_msg');
    });

    it('still sends a real search with no hits to the filter copy', () => {
        const vm = mountComposable({ project, searchedTask: ref(true), showArchived: ref(false) });
        expect(vm.emptyTitleKey).toBe('EmptyState.no_match_title');
    });

    it('admits it does not know why an unfiltered list is empty', () => {
        const vm = mountComposable({ project, searchedTask: ref(false), showArchived: ref(false) });
        expect(vm.emptyMessageKey).toBe('EmptyState.no_visible_tasks_msg');
    });

    it('falls back to the never-had-tasks copy with nothing provided', () => {
        const Probe = defineComponent({
            setup: () => useTaskEmptyState(ref({})),
            template: '<div />',
        });
        expect(mount(Probe).vm.emptyTitleKey).toBe('EmptyState.no_tasks_title');
    });

    it('resolves every key it can produce against en.js', () => {
        ['no_tasks', 'no_match', 'no_visible_tasks', 'no_archived'].forEach((k) => {
            expect(en.EmptyState[`${k}_title`]).toBeTruthy();
            expect(en.EmptyState[`${k}_msg`]).toBeTruthy();
        });
    });

    it('never tells the user work is hidden when it cannot know that', () => {
        expect(en.EmptyState.no_match_msg).not.toMatch(/There is work in this project/);
        expect(en.EmptyState.no_archived_msg).not.toMatch(/^Nothing is archived/);
    });
});
