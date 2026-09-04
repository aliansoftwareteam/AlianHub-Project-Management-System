<template>
    <div class="pev">
        <div class="ah-toolbar">
            <button type="button" class="pev__back" :title="$t('Docs.back_to_docs')" @click="back">
                <ShellIcon name="arrowLeft" :size="15" />
            </button>
            <span class="pev__crumb">
                <template v-if="projectName">{{ projectName }} / </template>{{ $t('Docs.breadcrumb_docs') }} /
            </span>
            <span class="pev__crumb-title">{{ title || $t('Docs.untitled') }}</span>
            <span v-if="page && page.isWiki" class="ah-chip" :class="reviewChipClass(page.reviewState)">{{ $t(reviewLabelKey(page.reviewState)) }}</span>
            <span class="ah-toolbar__spacer"></span>
            <span v-if="editorName" class="pev__editing">
                <span class="ah-avatar ah-avatar--sm">{{ editorInitials }}</span>
                <span class="ah-small">{{ $t('Projects.page_edited_by', { who: editorName, when: relativeTime(page.updatedAt, t) }) }}</span>
            </span>
            <button type="button" class="ah-btn ah-btn--sm ah-btn--outline" @click="doc && doc.askAi()">
                <ShellIcon name="ai" :size="13" />{{ $t('Docs.ask_about_doc') }}
            </button>
            <button type="button" class="ah-btn ah-btn--sm ah-btn--secondary" @click="doc && doc.present()">
                <ShellIcon name="play" :size="11" />{{ $t('Docs.present') }}
            </button>
            <button type="button" class="ah-btn ah-btn--sm ah-btn--secondary" @click="doc && doc.openShare()">
                <ShellIcon name="share" :size="13" />{{ $t('Docs.share') }}
            </button>
        </div>

        <div class="pev__body">
            <div class="pev__doc">
                <PageDocument
                    ref="doc"
                    :page-id="pageId"
                    :project-data="projectData"
                    layout="page"
                    @loaded="onLoaded"
                    @saved="onLoaded"
                    @outline="outline = $event"
                    @deleted="back"
                />
            </div>
            <aside class="pev__aside">
                <div class="ah-label">{{ $t('Docs.on_this_page') }}</div>
                <div v-if="!outline.length" class="ah-small">{{ $t('Docs.no_headings') }}</div>
                <nav v-else class="pev__outline">
                    <button
                        v-for="(heading, index) in outline"
                        :key="heading.id || index"
                        type="button"
                        class="pev__outline-item"
                        :class="`pev__outline-item--l${heading.level}`"
                        @click="doc && doc.scrollToHeading(heading.id)"
                    >{{ heading.text }}</button>
                </nav>
            </aside>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useStore } from 'vuex';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import PageDocument from '@/components/molecules/Pages/PageDocument.vue';
import { useGetterFunctions } from '@/composable';
import { relativeTime, initials, reviewChipClass, reviewLabelKey } from '@/components/molecules/Pages/docsFormat';

defineOptions({ name: 'PageEditorView' });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const store = useStore();
const { getUser } = useGetterFunctions();

const doc = ref(null);
const page = ref(null);
const outline = ref([]);

const pageId = computed(() => String(route.params.pageId || ''));
const title = computed(() => (page.value ? page.value.title : ''));
const projectData = computed(() => {
    const all = store.getters['projectData/allProjects'];
    const id = page.value && page.value.ProjectID ? String(page.value.ProjectID) : '';
    return ((all && all.data) || []).find((p) => String(p._id) === id) || {};
});
const projectName = computed(() => projectData.value.ProjectName || '');
const editorName = computed(() => {
    if (!page.value || !page.value.updatedBy) return '';
    const user = getUser(String(page.value.updatedBy));
    return user && !user.ghostUser ? user.Employee_Name : '';
});
const editorInitials = computed(() => initials(editorName.value));

function onLoaded(value) {
    page.value = value;
}

function back() {
    router.push({ name: 'Pages', params: { cid: route.params.cid } });
}

onMounted(() => {
    const all = store.getters['projectData/allProjects'];
    if (!(all && all.data && all.data.length)) {
        store.dispatch('projectData/setProjects', { roleType: store.getters['settings/companyUserDetail']?.roleType })
            .catch((error) => console.error('ERROR in load projects for doc: ', error));
    }
});
</script>

<style scoped>
.pev { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--surface); font-family: var(--font-ui); }
.pev__back {
    width: 30px; height: 30px; border-radius: 7px; border: 0; background: transparent; padding: 0;
    color: var(--ink-2); display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
}
.pev__back:hover { background: var(--surface-hover); color: var(--ink); }
.pev__crumb { font-size: 12.5px; color: var(--ink-2); white-space: nowrap; }
.pev__crumb-title { font: 600 12.5px var(--font-ui); color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40vw; }
.pev__editing { display: inline-flex; align-items: center; gap: 6px; }
.pev__body { flex: 1; min-height: 0; display: flex; }
.pev__doc { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.pev__aside {
    width: 250px; flex: none;
    border-left: 1px solid var(--hairline); background: var(--surface-2);
    padding: 20px 18px; display: flex; flex-direction: column; gap: 12px; font-size: 12.5px;
    overflow-y: auto;
}
.pev__outline { display: flex; flex-direction: column; gap: 5px; }
.pev__outline-item {
    border: 0; background: transparent; padding: 2px 0; text-align: left; cursor: pointer;
    font: 400 12.5px/1.4 var(--font-ui); color: var(--ink-2);
}
.pev__outline-item:hover { color: var(--brand); }
.pev__outline-item--l1 { font-weight: 600; color: var(--ink); }
.pev__outline-item--l3 { padding-left: 12px; }

@media (max-width: 1279px) {
    .pev__aside { display: none; }
    .pev__editing { display: none; }
}
@media (max-width: 767px) {
    .pev__crumb { display: none; }
}
</style>
