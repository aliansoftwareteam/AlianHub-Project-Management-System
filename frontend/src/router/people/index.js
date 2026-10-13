export default [
    {
        path: '/:cid/people',
        name: 'PeopleDirectory',
        meta: {
            title: "People",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "people" */ '@/views/People/PeopleDirectory.vue'),
    }
];
