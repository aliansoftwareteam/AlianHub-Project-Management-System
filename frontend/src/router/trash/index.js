export default [
    {
        path: '/:cid/trash',
        name: 'Trash',
        meta: {
            title: 'Trash',
            requiresAuth: true,
        },
        component: () => import(/* webpackChunkName: "trash" */ '@/views/Trash/TrashPage.vue'),
    },
];
