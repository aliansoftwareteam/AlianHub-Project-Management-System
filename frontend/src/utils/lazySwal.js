import { notifyLoadFailure } from '@/config/lazyShell';

const loadSwal = () => import(/* webpackChunkName: "sweetalert" */ 'sweetalert2').then((module) => module.default);

/* The dialog library is fetched the first time a confirmation is asked for, not with the shell. */
export default {
    fire: (...options) => loadSwal().then(
        (Swal) => Swal.fire(...options),
        (error) => {
            notifyLoadFailure();
            throw error;
        }
    )
};
