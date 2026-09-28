import { inject, provide, ref } from 'vue';

const VIEW_SETTINGS = Symbol('viewSettings');

const EMPTY_COLUMNS = () => ({ order: [], shown: [], hidden: [] });

const contextOf = ({ sort, columns, setSort, setColumns }) => ({ sort, columns, setSort, setColumns });

export const provideViewSettings = (savedViews) => provide(VIEW_SETTINGS, contextOf(savedViews));

/* The open view's sort and column state. Outside a project page it falls back to state of
   its own, so a view mounted elsewhere still sorts and chooses columns for the session. */
export function useViewSettings() {
    const provided = inject(VIEW_SETTINGS, null);
    if (provided) return provided;
    const sort = ref(null);
    const columns = ref(EMPTY_COLUMNS());
    return contextOf({
        sort,
        columns,
        setSort: (value) => { sort.value = value; },
        setColumns: (value) => { columns.value = value || EMPTY_COLUMNS(); },
    });
}
