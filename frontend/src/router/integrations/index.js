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
]
