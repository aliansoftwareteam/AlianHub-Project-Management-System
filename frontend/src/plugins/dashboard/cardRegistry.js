import { defineAsyncComponent } from 'vue';

/**
 * Card key → the component that renders its body inside DashboardCard.
 * Only cards listed here can be rendered; the catalogue marks the rest as not
 * built yet and the picker refuses to add them.
 */
const COMPONENTS = {
    DueSoonCard: defineAsyncComponent(() => import(/* webpackChunkName: "dash-cards" */ '@/components/organisms/DueSoonCard/DueSoonCard.vue')),
    MyTimeCard: defineAsyncComponent(() => import(/* webpackChunkName: "dash-cards" */ '@/components/organisms/MyTimeCard/MyTimeCard.vue')),
    ProjectPulseCard: defineAsyncComponent(() => import(/* webpackChunkName: "dash-cards" */ '@/components/organisms/ProjectPulseCard/ProjectPulseCard.vue')),
    TeamLoggedVsEtaCard: defineAsyncComponent(() => import(/* webpackChunkName: "dash-cards" */ '@/components/organisms/TeamLoggedVsEtaCard/TeamLoggedVsEtaCard.vue')),
    FreeResourcesCard: defineAsyncComponent(() => import(/* webpackChunkName: "dash-cards" */ '@/components/organisms/FreeResourcesCard/FreeResourcesCard.vue')),
    TasksByStatusCard: defineAsyncComponent(() => import(/* webpackChunkName: "dash-cards" */ '@/components/organisms/TasksByStatusCard/TasksByStatusCard.vue')),
};

export const cardComponent = (key) => COMPONENTS[key] || null;
