export default [
    {
        path: '/:cid/custom-reports',
        name: 'CustomReport',
        meta: {
            title: "Custom Report",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "CustomReports" */ '@/views/CustomReports/CustomReports.vue'),
    },
]
