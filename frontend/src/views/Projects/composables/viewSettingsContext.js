import { inject, provide, ref } from 'vue';

const VIEW_SETTINGS = Symbol('viewSettings');

export const columnVisible = (columns, key, fallback = true) => {
    const column = (columns || []).find((entry) => entry.key === key);
    return column ? column.visible : fallback;
};

export const orderColumns = (keys, columns) => {
    const order = (columns || []).map((entry) => entry.key);
    const rank = (key) => (order.includes(key) ? order.indexOf(key) : order.length + keys.indexOf(key));
    return [...keys].sort((a, b) => rank(a) - rank(b));
};

const contextOf = ({ sort, columns, setSort, setColumns }) => ({
    sort,
    columns,
    setSort,
    setColumns,
    isColumnVisible: (key, fallback = true) => columnVisible(columns.value, key, fallback),
    orderColumns: (keys) => orderColumns(keys, columns.value),
});

export const provideViewSettings = (savedViews) => provide(VIEW_SETTINGS, contextOf(savedViews));

/* The open view's sort and columns for List, Table and Board. Outside a project page it
   falls back to state of its own, so a view mounted elsewhere still sorts. */
export function useViewSettings() {
    const provided = inject(VIEW_SETTINGS, null);
    if (provided) return provided;
    const sort = ref(null);
    const columns = ref([]);
    return contextOf({ sort, columns, setSort: (value) => { sort.value = value; }, setColumns: (value) => { columns.value = value; } });
}
