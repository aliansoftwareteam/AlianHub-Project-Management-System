import { inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { SAVED_SETTINGS_VIEWS } from '@/views/Projects/composables/savedViewSettings';

export const TEMPLATE_VIEW_TYPES = SAVED_SETTINGS_VIEWS;
export const VIEW_TEMPLATES_EVENT = 'viewTemplatesChanged';
export const NAME_LIMIT = 60;

const bodyOf = (response) => {
    const body = response?.data;
    if (!body || body.status === false) throw new Error(body?.statusText || 'Request failed');
    return body;
};

export const errorText = (error, fallback) => error?.response?.data?.statusText || fallback;

export const listViewTemplates = () => apiRequest('get', env.VIEW_TEMPLATES).then((response) => bodyOf(response).data || []);

export const saveViewTemplate = ({ projectId, viewId, name }) => apiRequest('post', env.VIEW_TEMPLATES, { projectId, viewId, name }).then(bodyOf);

export const renameViewTemplate = (templateId, name) => apiRequest('patch', `${env.VIEW_TEMPLATES}/${templateId}`, { name }).then(bodyOf);

export const deleteViewTemplate = (templateId) => apiRequest('delete', `${env.VIEW_TEMPLATES}/${templateId}`).then(bodyOf);

export const addViewFromTemplate = (projectId, { templateId, isPin, isPrivate }) => apiRequest('post', `/api/v1/${env.PROJECTACTIONS}/${projectId}/views`, { templateId, isPin, isPrivate }).then(bodyOf);

/* A template for a kind of view this company's catalogue does not offer cannot be added, so it is not shown. */
export const fittingTemplates = (templates, catalogue) => (templates || []).flatMap((template) => {
    const view = TEMPLATE_VIEW_TYPES.includes(template?.viewType) && (catalogue || []).find((row) => row?.keyName === template.viewType);
    return view ? [{ ...template, viewName: view.name }] : [];
});

export const leftOutText = (leftOut, t) => (leftOut?.length
    ? t('ViewTemplates.added_left_out', { parts: leftOut.map((part) => t(`ViewTemplates.part_${part}`)).join(', ') })
    : '');

export function useViewTemplates() {
    const socket = inject('$socket', ref(null));
    const templates = ref([]);
    let bound = null;

    const load = () => listViewTemplates()
        .then((rows) => { templates.value = rows; })
        .catch((error) => console.error('ERROR in loading the view templates: ', error));

    const onChanged = () => load();

    function unbind() {
        bound?.off?.(VIEW_TEMPLATES_EVENT, onChanged);
        bound = null;
    }

    function bind() {
        const live = socket?.value;
        if (live === bound) return;
        unbind();
        if (!live?.on) return;
        bound = live;
        live.on(VIEW_TEMPLATES_EVENT, onChanged);
    }

    onMounted(() => {
        load();
        bind();
    });
    watch(() => socket?.value, bind);
    onBeforeUnmount(unbind);

    return { templates, load };
}
