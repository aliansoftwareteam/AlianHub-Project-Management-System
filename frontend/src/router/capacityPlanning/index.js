export default [
    {
        path: '/:cid/reports/capacity',
        name: 'CapacityPlanning',
        meta: {
            title: "Capacity Planning",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "CapacityPlanning" */ '@/views/CapacityPlanning/CapacityPlanning.vue'),
    },
]
