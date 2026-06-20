export default [
    {
        path: '/:cid/reports/variance',
        name: 'VarianceReport',
        meta: {
            title: "Variance Report",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "VarianceReport" */ '@/views/VarianceReport/VarianceReport.vue'),
    },
]
