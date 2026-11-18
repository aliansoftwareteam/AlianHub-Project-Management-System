export default [
    {
        path: '/:cid/automations',
        name: 'Automations',
        meta: {
            title: "Automations",
            requiresAuth: true
        },
        props: (route) => ({ openTemplates: route.query.templates === '1', templateProjectId: String(route.query.project || '') }),
        component: () => import(/* webpackChunkName: "Automations" */ '@/views/Automations/AutomationsPage.vue'),
    },
]
