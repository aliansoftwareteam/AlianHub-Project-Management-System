export default [
    {
        path: '/:cid/project/:id/billing',
        name: 'Billing',
        meta: {
            title: 'Billing',
            requiresAuth: true,
        },
        component: () => import(/* webpackChunkName: "billing" */ '@/views/Billing/Billing.vue'),
    },
];
