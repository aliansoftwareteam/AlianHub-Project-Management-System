export default [
    {
        path: '/:cid/projects/:projectId/pages',
        name: 'ProjectPages',
        meta: {
            title: 'Pages',
            requiresAuth: true,
        },
        component: () => import(/* webpackChunkName: "pages-space" */ '@/views/Pages/PagesSpace.vue'),
    },
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
