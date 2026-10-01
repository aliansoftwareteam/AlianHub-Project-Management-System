import { inject, provide, ref } from 'vue';

const VIEW_SETTINGS = Symbol('viewSettings');

const EMPTY_COLUMNS = () => ({ order: [], shown: [], hidden: [] });

const contextOf = ({ sort, columns, workloadUnit, setSort, setColumns, setWorkloadUnit }) => ({ sort, columns, workloadUnit, setSort, setColumns, setWorkloadUnit });

export const provideViewSettings = (savedViews) => provide(VIEW_SETTINGS, contextOf(savedViews));

/* The open view's sort, column and workload-unit state. Outside a project page it falls back to
   state of its own, so a view mounted elsewhere still keeps them for the session. */
export function useViewSettings() {
    const provided = inject(VIEW_SETTINGS, null);
    if (provided) return provided;
    const sort = ref(null);
    const columns = ref(EMPTY_COLUMNS());
    const workloadUnit = ref('hours');
    return contextOf({
        sort,
        columns,
        workloadUnit,
        setSort: (value) => { sort.value = value; },
        setColumns: (value) => { columns.value = value || EMPTY_COLUMNS(); },
        setWorkloadUnit: (value) => { workloadUnit.value = value; },
    });
}
