import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';

import { splitProjectViews } from '@/views/Projects/composables/projectViewBar';
import { useTaskEmptyState } from '@/views/Projects/composables/useTaskEmptyState';

const view = (keyName, _id, extra = {}) => ({ keyName, name: keyName, _id, viewStatus: true, ...extra });
const LIST = '6a97261fb28e840202058560';
const GANTT = '6a97261fb28e840202058561';

/* Every project that has ever had a Board view carries a ProjectKanban entry with no `_id`:
   createProject copied the company's view-catalogue row, and a catalogue with no Board row
   matched nothing and stored the raw template entry. Reading `_id.length` off it threw inside
   getChange(), which assigns the view bar and the task list, so the whole project rendered
   blank. */
describe('splitProjectViews', () => {
    it('lists the other views and does not throw on an entry with no _id', () => {
        const entries = [view('ProjectListView', LIST), { keyName: 'ProjectKanban', name: 'Board', viewStatus: true }, view('GanttView', GANTT)];

        let result;
        expect(() => { result = splitProjectViews(entries); }).not.toThrow();
        expect(result.views.map((v) => v.keyName)).toEqual(['ProjectListView', 'GanttView']);
        expect(result.embeds).toEqual([]);
    });

    it('tolerates a null _id, a null entry and a missing array', () => {
        for (const entries of [undefined, null, {}, [null], [undefined], [{ keyName: 'X', _id: null }]]) {
            expect(() => splitProjectViews(entries)).not.toThrow();
            expect(splitProjectViews(entries).views).toEqual([]);
        }
    });

    it('keeps the 24-character ids in the tab bar and the 6-character ones in the embeds', () => {
        const embed = { name: 'Figma', _id: 'ab12cd', id: 'ab12cd', type: 'Figma' };
        const { views, embeds } = splitProjectViews([view('ProjectListView', LIST), embed]);

        expect(views.map((v) => v.keyName)).toEqual(['ProjectListView']);
        expect(embeds.map((v) => v.name)).toEqual(['Figma']);
    });

    it('adds a member\'s private views and drops the ones the project already has', () => {
        const userTabs = [
            { uniqueId: 'u1', id: GANTT, keyName: 'GanttView', name: 'Gantt View' },
            { uniqueId: 'u2', id: 'ff00aa', name: 'My embed' },
        ];
        const { views, embeds } = splitProjectViews([view('GanttView', GANTT)], userTabs);

        expect(views.map((v) => v.keyName)).toEqual(['GanttView']);
        expect(embeds.map((v) => v.name)).toEqual(['My embed']);
    });

    it('drops the dead legacy Gantt and Timeline keyNames', () => {
        const entries = [view('Gantt', LIST), view('Timeline', GANTT), view('GanttView', '6a97261fb28e840202058562')];

        expect(splitProjectViews(entries).views.map((v) => v.keyName)).toEqual(['GanttView']);
    });

    it('pins sort ahead of the rest', () => {
        const entries = [view('ProjectListView', LIST), view('GanttView', GANTT, { isPin: true })];

        expect(splitProjectViews(entries).views.map((v) => v.keyName)).toEqual(['GanttView', 'ProjectListView']);
    });
});

/* A render crash used to reach the user as "Nothing matches your filters", so they went
   looking for a filter that was never set: the views picked that copy on lastTaskId alone. */
describe('useTaskEmptyState', () => {
    const emptyState = (project, searchedTask) => {
        let state;
        mount(defineComponent({
            setup() { state = useTaskEmptyState(project); return () => null; },
        }), { global: { provide: searchedTask === undefined ? {} : { searchedTask } } });
        return state;
    };

    it('does not blame a filter when none is applied', () => {
        const state = emptyState(ref({ lastTaskId: 4 }), ref(false));

        expect(state.emptyTitleKey.value).toBe('EmptyState.no_visible_tasks_title');
        expect(state.emptyMessageKey.value).toBe('EmptyState.no_visible_tasks_msg');
    });

    it('offers to clear the filter while one narrows the list', () => {
        const searchedTask = ref(true);
        const state = emptyState(ref({ lastTaskId: 4 }), searchedTask);

        expect(state.emptyTitleKey.value).toBe('EmptyState.no_match_title');
        expect(state.emptyMessageKey.value).toBe('EmptyState.no_match_msg');

        searchedTask.value = false;
        expect(state.emptyTitleKey.value).toBe('EmptyState.no_visible_tasks_title');
    });

    it('says the project has no tasks yet before its first one exists', () => {
        expect(emptyState(ref({ lastTaskId: 0 }), ref(true)).emptyTitleKey.value).toBe('EmptyState.no_tasks_title');
        expect(emptyState(ref(undefined), undefined).emptyTitleKey.value).toBe('EmptyState.no_tasks_title');
    });
});
