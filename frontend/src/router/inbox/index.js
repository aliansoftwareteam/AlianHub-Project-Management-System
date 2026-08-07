export default [
    {
        // ?tab= carries which tab is open, so a tab is linkable and survives a reload.
        path: '/:cid/inbox',
        name: 'inbox',
        meta: {
            title: "Inbox",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "inbox" */ '@/views/Inbox/Inbox.vue'),
    },
];
