import { defineAsyncComponent } from 'vue';

const gridLayout = () => import(/* webpackChunkName: "grid-layout" */ 'grid-layout-plus');

/* Libraries only some screens draw with. They keep their global names, each behind a loader, so
 * the library is fetched the first time a screen renders the component instead of with the app. */
export const LAZY_GLOBAL_LOADERS = {
    ApexChart: () => import(/* webpackChunkName: "charts" */ 'vue3-apexcharts'),
    VDatePicker: () => import(/* webpackChunkName: "date-picker" */ 'v-calendar').then((library) => library.DatePicker),
    GridLayout: () => gridLayout().then((library) => library.GridLayout),
    GridItem: () => gridLayout().then((library) => library.GridItem)
};

export const registerLazyGlobals = (app, loaders = LAZY_GLOBAL_LOADERS) => {
    Object.entries(loaders).forEach(([name, loader]) => app.component(name, defineAsyncComponent(loader)));
};
