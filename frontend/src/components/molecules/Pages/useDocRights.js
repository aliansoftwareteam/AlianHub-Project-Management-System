import { computed } from 'vue';
import { useStore } from 'vuex';
import { ROLE_GUEST } from '@/utils/roles';

/* Mirrors DOC_READ_ONLY_ROLES in Modules/Pages/helpers/pageAccess.js: these roles read docs, and start,
   delete, restore or sign off none. The server decides; this only keeps what it would refuse off the screen. */
const READ_ONLY_ROLES = [ROLE_GUEST];

export const roleWritesDocs = (roleType) => !READ_ONLY_ROLES.includes(roleType);

export function useDocRights() {
    const store = useStore();
    const writesDocs = computed(() => roleWritesDocs(store?.getters?.['settings/companyUserDetail']?.roleType));
    return { writesDocs };
}
