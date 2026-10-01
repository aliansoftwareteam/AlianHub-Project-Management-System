import { defineAsyncComponent } from 'vue';

export const DASHBOARD_CARD_LOADERS = {
    CalendarComponent: () => import(/* webpackChunkName: "dashboard-cards" */ './component/CalendarComponent.vue'),
    CalendarTaskDisplayComponent: () => import(/* webpackChunkName: "dashboard-cards" */ './component/CalendarTaskDisplayComponent.vue'),
    DisplayComponent: () => import(/* webpackChunkName: "dashboard-cards" */ './component/DisplayComponent.vue'),
    MainLabledComponent: () => import(/* webpackChunkName: "dashboard-cards" */ './component/MainLabledComponent.vue'),
    QueueListComponent: () => import(/* webpackChunkName: "dashboard-cards" */ './component/QueueListComponent.vue'),
    SingleQueueListComponent: () => import(/* webpackChunkName: "dashboard-cards" */ './component/SingleQueueListComponent.vue')
};

const PROVIDED = ['CalendarComponent', 'QueueListComponent'];

export default {
    install(app) {
        Object.entries(DASHBOARD_CARD_LOADERS).forEach(([name, loader]) => {
            const component = defineAsyncComponent(loader);
            app.component(name, component);
            if (PROVIDED.includes(name)) app.provide(name, component);
        });
    }
};
