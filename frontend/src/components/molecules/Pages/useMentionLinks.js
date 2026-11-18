import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useToast } from 'vue-toast-notification';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { LINK_TYPES, mentionOf } from './docMentions';

const linkTargetOf = (event) => {
    const node = event.target && event.target.closest ? event.target.closest('span.mention[data-mention]') : null;
    const mention = node ? mentionOf(node) : null;
    return mention && LINK_TYPES.includes(mention.type) ? mention : null;
};

/* Doc and task mentions open what they name. The task is fetched first, so one the reader
 * cannot open answers the same as one that is gone. */
export function useMentionLinks({ beforeLeave = () => true } = {}) {
    const { t } = useI18n();
    const route = useRoute();
    const router = useRouter();
    const $toast = useToast();

    function routeToTask(task) {
        if (!task || !task._id) return;
        const params = { cid: route.params.cid, id: String(task.ProjectID), taskId: String(task._id) };
        if (task.sprintId) {
            router.push({ name: 'ProjectSprintTask', params: { ...params, sprintId: String(task.sprintId) }, query: { detailTab: 'task-detail-tab' } });
        } else {
            router.push({ name: 'Project', params: { cid: params.cid, id: params.id } });
        }
    }

    const fetchTask = (taskId) => apiRequest('get', `${env.TASK}/${taskId}`)
        .then((response) => (response && response.status === 200 && response.data && response.data._id ? response.data : null))
        .catch(() => null);

    async function openMention({ type, id }) {
        if (!beforeLeave()) return;
        if (type === 'doc') {
            router.push({ name: 'PageEditor', params: { cid: route.params.cid, pageId: id } });
            return;
        }
        const task = await fetchTask(id);
        if (task) routeToTask(task);
        else $toast.info(t('Docs.mention_unavailable'), { position: 'top-right' });
    }

    function onMentionClick(event) {
        const target = linkTargetOf(event);
        if (!target) return false;
        event.preventDefault();
        openMention(target);
        return true;
    }

    function onMentionKeydown(event) {
        if (event.key !== 'Enter' && event.key !== ' ') return false;
        const target = linkTargetOf(event);
        if (!target || event.target !== event.target.closest('span.mention')) return false;
        event.preventDefault();
        event.stopPropagation();
        openMention(target);
        return true;
    }

    return { openMention, onMentionClick, onMentionKeydown, routeToTask, fetchTask };
}
