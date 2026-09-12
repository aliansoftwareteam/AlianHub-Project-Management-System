import Store from '@/store/index';
import { isOwnerOrAdmin } from '@/utils/roles';

// The workflow builder is an Owner's and an Admin's screen, because the API
// behind it is: `/api/v2/workflows` refuses everybody else. A member who follows
// a link to it is sent home rather than shown a page that can only fail.
//
// The role arrives with the company user, which App.vue loads after the router
// has already started, so a direct hit on the URL has to wait for it rather than
// read an empty store and call an Owner a member.

const ROLE_WAIT_MS = 5000;

const roleOf = (store) => store.getters['settings/companyUserDetail']?.roleType;

const whenRoleKnown = (store, timeoutMs = ROLE_WAIT_MS) => new Promise((resolve) => {
    const known = roleOf(store);
    if (known !== undefined && known !== null) { resolve(known); return; }
    let stop = () => {};
    const timer = setTimeout(() => { stop(); resolve(roleOf(store)); }, timeoutMs);
    stop = store.watch(() => roleOf(store), (value) => {
        if (value === undefined || value === null) return;
        clearTimeout(timer);
        stop();
        resolve(value);
    });
});

export const ownerOrAdminOnly = async (to, store = Store) => {
    const roleType = await whenRoleKnown(store);
    if (isOwnerOrAdmin(Number(roleType))) return true;
    return { name: 'Home', params: { cid: to.params.cid } };
};

export default [
    {
        path: '/:cid/workflows',
        name: 'WorkflowBuilder',
        meta: { title: 'Workflow builder', requiresAuth: true },
        beforeEnter: (to) => ownerOrAdminOnly(to),
        component: () => import(/* webpackChunkName: "workflows" */ '@/views/Workflows/WorkflowBuilderPage.vue'),
    },
];
