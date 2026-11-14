import { toCustomize } from '../ai/customize';

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
    // The GitHub sync moved into Integrations; a sign-in that returns here keeps its query and finishes there.
    {
        path: '/:cid/app-connections',
        name: 'AppConnections',
        redirect: (to) => ({ name: 'IntegrationsHub', params: { cid: to.params.cid }, query: { ...to.query, section: 'github' } }),
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
