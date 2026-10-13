import { inject, provide, ref } from 'vue';
import { VIEW_DENSITIES } from './savedViewSettings';

const VIEW_SETTINGS = Symbol('viewSettings');

const EMPTY_COLUMNS = () => ({ order: [], shown: [], hidden: [] });

const contextOf = ({ sort, columns, workloadUnit, density, setSort, setColumns, setWorkloadUnit, setDensity }) => ({ sort, columns, workloadUnit, density, setSort, setColumns, setWorkloadUnit, setDensity });

export const provideViewSettings = (savedViews) => provide(VIEW_SETTINGS, contextOf(savedViews));

/* The open view's sort, column, workload-unit and density state. Outside a project page it falls back to
   state of its own, so a view mounted elsewhere still keeps them for the session. */
export function useViewSettings() {
    const provided = inject(VIEW_SETTINGS, null);
    if (provided) return provided;
    const sort = ref(null);
    const columns = ref(EMPTY_COLUMNS());
    const workloadUnit = ref('hours');
    const density = ref(VIEW_DENSITIES[0]);
    return contextOf({
        sort,
        columns,
        workloadUnit,
        density,
        setSort: (value) => { sort.value = value; },
        setColumns: (value) => { columns.value = value || EMPTY_COLUMNS(); },
        setWorkloadUnit: (value) => { workloadUnit.value = value; },
        setDensity: (value) => { density.value = VIEW_DENSITIES.includes(value) ? value : VIEW_DENSITIES[0]; },
    });
}
