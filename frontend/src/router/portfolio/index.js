export default [
    {
        path: '/:cid/portfolio',
        name: 'Portfolio',
        meta: {
            title: "Portfolio",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "Portfolio" */ '@/views/Portfolio/Portfolio.vue'),
    },
]
