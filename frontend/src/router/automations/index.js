export default [
    {
        path: '/:cid/automations',
        name: 'Automations',
        meta: {
            title: "Automations",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "Automations" */ '@/views/Automations/AutomationsPage.vue'),
    },
]
