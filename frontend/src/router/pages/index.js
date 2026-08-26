export default [
    {
        path: '/:cid/pages',
        name: 'Pages',
        meta: {
            title: 'Pages',
            requiresAuth: true,
        },
        component: () => import(/* webpackChunkName: "pages-space" */ '@/views/Pages/PagesSpace.vue'),
    },
];
