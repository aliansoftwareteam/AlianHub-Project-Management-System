import { CUSTOMIZE_ROUTE, toCustomize } from '../ai/customize';

export default [
    {
        path: '/:cid/integrations',
        name: 'IntegrationsHub',
        meta: {
            title: "Integrations & Automation",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "IntegrationsHub" */ '@/views/Integrations/IntegrationsHub.vue'),
    },
    { path: '/:cid/connections', name: 'Connections', redirect: toCustomize() },
    {
        path: '/:cid/app-connections',
        name: 'AppConnections',
        meta: {
            titleKey: "AppConnections.title",
            requiresAuth: true
        },
        // A GitHub sign-in started here before the page moved still comes back here to finish, until task 079 retires it.
        beforeEnter: (to) => (to.query.github ? true : { name: CUSTOMIZE_ROUTE, params: { cid: to.params.cid } }),
        component: () => import(/* webpackChunkName: "IntegrationsHub" */ '@/views/Integrations/AppConnections.vue'),
    },
    {
        path: '/:cid/external-data',
        name: 'ExternalData',
        meta: {
            title: "External data & agents",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "IntegrationsHub" */ '@/views/Integrations/ExternalData.vue'),
    },
]
