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
    {
        path: '/:cid/connections',
        name: 'Connections',
        meta: {
            title: "Connections",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "IntegrationsHub" */ '@/views/Integrations/ConnectionsPage.vue'),
    },
    {
        path: '/:cid/app-connections',
        name: 'AppConnections',
        meta: {
            titleKey: "AppConnections.title",
            requiresAuth: true
        },
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
