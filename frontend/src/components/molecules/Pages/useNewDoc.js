import { computed, inject } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useStore } from 'vuex';
import { useToast } from 'vue-toast-notification';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { isOwnerOrAdmin } from '@/utils/roles';
import { identitiesOf } from '@/components/molecules/ProjectTree/projectTreeModel';
import { docRoute } from './docRoute';
import { roleWritesDocs } from './useDocRights';

/* Mirrors the rule POST /api/v2/pages applies (canCreatePageIn in Modules/Pages/helpers/pageAccess.js):
 * a guest starts no doc; for everyone else a project that is not private belongs to everyone who sees
 * it, a private one to its people and teams, and owners and admins reach everything. A doc with no
 * project is the company's. No role key is consulted, on the server or here. */
export function canCreateDocIn(project, { userId, roleType, teams } = {}) {
    if (!roleWritesDocs(roleType)) return false;
    if (!project || !project._id) return true;
    if (isOwnerOrAdmin(roleType) || project.isPrivateSpace !== true) return true;
    const mine = identitiesOf(userId, teams);
    return (project.AssigneeUserId || []).map(String).some((id) => mine.has(id));
}

/* The project a page of the app is showing, or '' on a page that belongs to none. */
export function routeProjectId(route) {
    const name = String(route?.name || '');
    if (!name.startsWith('Project') || name === 'Projects') return '';
    return String(route.params?.id || '');
}

export function useNewDoc() {
    const { t } = useI18n();
    const route = useRoute();
    const router = useRouter();
    const { getters } = useStore();
    const $toast = useToast();
    const userId = inject('$userId', null);
    const companyId = inject('$companyId', null);

    const me = computed(() => ({
        userId: userId?.value,
        roleType: getters['settings/companyUserDetail']?.roleType,
        teams: getters['settings/teams'],
    }));

    const canCreateIn = (project) => canCreateDocIn(project, me.value);

    const refuse = (message) => $toast.error(message || t('Toast.something_went_wrong'), { position: 'top-right' });

    async function createIn(projectId = '') {
        try {
            const response = await apiRequest('post', env.PAGES, {
                title: t('Docs.untitled'),
                ...(projectId ? { projectId: String(projectId) } : {}),
            });
            const page = response.data?.status ? response.data.data : null;
            if (!page?._id) {
                refuse(response.data?.statusText);
                return null;
            }
            router.push(docRoute(route?.params?.cid || companyId?.value, page._id));
            return page;
        } catch (error) {
            console.error('ERROR in create doc: ', error);
            refuse(error?.response?.data?.statusText);
            return null;
        }
    }

    return { canCreateIn, createIn };
}
