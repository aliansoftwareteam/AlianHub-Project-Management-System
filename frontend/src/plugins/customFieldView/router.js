export default [
    {
        path: "custom-field",
        name: "Custom-Fields",
        meta: {
            title: "Custom Field Manager",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: Custom-Fields */ './component/organisms/FieldBuilder/FieldBuilder.vue')
    },
];
