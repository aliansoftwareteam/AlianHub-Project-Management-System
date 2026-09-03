export default [
    {
        path: '/:cid/pages',
        name: 'Pages',
        meta: {
            title: 'Docs',
            requiresAuth: true,
        },
        component: () => import(/* webpackChunkName: "pages-space" */ '@/views/Pages/PagesSpace.vue'),
    },
    {
        path: '/:cid/pages/:pageId',
        name: 'PageEditor',
        meta: {
            title: 'Docs',
            requiresAuth: true,
        },
        component: () => import(/* webpackChunkName: "pages-space" */ '@/views/Pages/PageEditorView.vue'),
    },
];
