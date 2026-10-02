<template>
    <section class="al" :aria-label="t('Projects.archived_lists')">
        <h3 class="ah-label al__title">{{ t('Projects.archived_lists') }}</h3>
        <ul class="al__rows">
            <li v-for="list in lists" :key="list.id" class="al__row" data-test="archived-list">
                <ShellIcon name="book" :size="14" class="al__icon" />
                <span class="al__name" :title="list.path">{{ list.path }}</span>
                <button
                    v-if="mayRestore(list)"
                    type="button"
                    class="ah-btn ah-btn--secondary ah-btn--sm al__restore"
                    :disabled="busy === list.id"
                    :aria-busy="busy === list.id ? 'true' : 'false'"
                    :aria-label="t('Projects.restore_list', { list: list.name })"
                    @click="restore(list)"
                >{{ t('Projects.restore') }}</button>
            </li>
        </ul>
    </section>
</template>

<script setup>
/**
 * The archived lists of the project in view, shown while "Show Archive" is on, each with Restore.
 *
 * Props
 *   project   Object   the lists' project; handed, because the page that provides `selectedProject` cannot inject it
 *   lists     Array    archivedListsOf(project), narrowed to the lists this person may see
 */
import { defineProps, inject, ref } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { useCustomComposable } from '@/composable';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { listMenuRights } from '@/views/Projects/composables/listMenu';
import { setSprintStatus } from '@/views/Projects/sprintActions';

const LIVE = 0;
const TOAST = { position: 'top-right' };

const props = defineProps({
    project: { type: Object, required: true },
    lists: { type: Array, default: () => [] }
});

const { t } = useI18n();
const store = useStore();
const $toast = useToast();
const companyId = inject('$companyId', null);
const { checkPermission } = useCustomComposable();

const busy = ref('');

const check = (key) => checkPermission(key, props.project?.isGlobalPermission);
const mayRestore = (list) => listMenuRights({ project: props.project, list, check }).restore;

async function restore(list) {
    if (busy.value) return;
    busy.value = list.id;
    const result = await setSprintStatus(store, {
        companyId: companyId?.value,
        project: props.project,
        sprint: { id: list.id, name: list.name, folderId: list.folderId },
        status: LIVE
    });
    busy.value = '';
    if (result.ok) $toast.success(t('Projects.list_restored', { list: list.name }), TOAST);
    else $toast.error(result.message || t('Toast.something_went_wrong'), TOAST);
}
</script>

<style scoped>
.al { padding: var(--sp-5) var(--sp-7); border-bottom: 1px solid var(--hairline); background: var(--surface); color: var(--ink); font-family: var(--font-ui); }
.al__title { margin: 0 0 var(--sp-3); color: var(--ink-2); }
.al__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
.al__row { display: flex; align-items: center; gap: var(--sp-4); min-height: var(--row-h); }
.al__icon { flex: none; color: var(--ink-2); }
.al__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-md); }
.al__restore { flex: none; }
</style>
