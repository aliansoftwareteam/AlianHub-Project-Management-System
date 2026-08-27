<template>
    <div v-if="visible" class="frc">
        <div class="frc__head">
            <span class="frc__title">{{ $t('FirstRun.title') }}</span>
            <span class="frc__close" role="button" tabindex="0" :title="$t('FirstRun.dismiss')"
                @click="dismiss" @keyup.enter="dismiss">&times;</span>
        </div>
        <p class="frc__sub">{{ $t('FirstRun.subtitle', { done: doneCount, total: items.length }) }}</p>
        <ul class="frc__list">
            <li v-for="item in items" :key="item.key" class="frc__item" :class="{ 'frc__item--done': item.done }">
                <span class="frc__tick" :class="{ 'frc__tick--done': item.done }">{{ item.done ? '✓' : '' }}</span>
                <span class="frc__label">{{ item.label }}</span>
            </li>
        </ul>
    </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { isFirstRunStepDone, FIRST_RUN_STEPS } from '@/composable/firstRunProgress';

const { t } = useI18n();
const { getters } = useStore();
const route = useRoute();

// Two items are recorded in localStorage when their screen is opened, which is not reactive. This
// component is mounted for the whole session, so without re-reading them on navigation a tick would
// not appear until a reload.
const visitBump = ref(0);
watch(() => route.fullPath, () => { visitBump.value += 1; });

// Per-browser rather than per-user: recording it on the user document would mean a new field on a
// strict schema, and a checklist that reappears on another machine is a much smaller problem than
// a migration.
const STORAGE_KEY = 'alianhub_firstrun_dismissed';
const dismissed = ref(localStorage.getItem(STORAGE_KEY) === '1');

function dismiss () {
    localStorage.setItem(STORAGE_KEY, '1');
    dismissed.value = true;
}

const companyUser = computed(() => getters['settings/companyUserDetail'] || {});
const companyUsers = computed(() => {
    const raw = getters['settings/companyUsers'];
    return Array.isArray(raw) ? raw : [];
});
// allProjects starts life as [] and becomes { data: [...] } once loaded, which is why every other
// getter in that store reads .data. Both shapes have to be handled or this throws on first paint.
const allProjects = computed(() => {
    const raw = getters['projectData/allProjects'];
    if (Array.isArray(raw)) return raw;
    return (raw && Array.isArray(raw.data)) ? raw.data : [];
});

const items = computed(() => ([
    {
        key: 'project',
        label: t('FirstRun.create_project'),
        core: true,
        done: allProjects.value.length > 0,
    },
    {
        key: 'task',
        // lastTaskId only moves off zero once a project's first task is created.
        label: t('FirstRun.create_task'),
        core: true,
        done: allProjects.value.some((p) => Number(p && p.lastTaskId) > 0),
    },
    {
        key: 'invite',
        label: t('FirstRun.invite_teammate'),
        core: true,
        done: companyUsers.value.length > 1,
    },
    {
        key: 'board',
        label: t('FirstRun.try_board'),
        core: false,
        done: visitBump.value >= 0 && isFirstRunStepDone(FIRST_RUN_STEPS.BOARD_VIEW),
    },
    {
        key: 'notifications',
        label: t('FirstRun.check_notifications'),
        core: false,
        done: visitBump.value >= 0 && isFirstRunStepDone(FIRST_RUN_STEPS.NOTIFICATIONS),
    },
]));

const doneCount = computed(() => items.value.filter((i) => i.done).length);

// Owner and Admin only, since a Member cannot do any of these.
//
// Only the three items answered from real data decide whether this appears. The other two are
// recorded in localStorage, so on an established company — where a project, a task and a second
// member have obviously all happened long ago — they would otherwise keep the card alive forever
// and every existing owner would suddenly be shown a getting-started panel.
const visible = computed(() => {
    if (dismissed.value) return false;
    const role = companyUser.value && companyUser.value.roleType;
    if (role !== 1 && role !== 2) return false;
    return items.value.some((i) => i.core && !i.done);
});
</script>

<style scoped>
.frc {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 900;
    width: 290px;
    background: #fff;
    border: 1px solid #e4e7ec;
    border-radius: 8px;
    box-shadow: 0 6px 24px rgba(23, 43, 77, 0.14);
    padding: 14px 16px 12px;
    font-family: Roboto, sans-serif;
}
.frc__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
}
.frc__title {
    font-size: 14.5px;
    font-weight: 600;
    color: #172b4d;
    line-height: 1.3;
}
.frc__close {
    font-size: 20px;
    line-height: 1;
    color: #8c8c8c;
    cursor: pointer;
    padding: 0 2px;
}
.frc__close:hover {
    color: #172b4d;
}
.frc__sub {
    font-size: 12px;
    color: #8c8c8c;
    margin: 4px 0 10px;
}
.frc__list {
    list-style: none;
    margin: 0;
    padding: 0;
}
.frc__item {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    font-size: 13px;
    color: #172b4d;
    padding: 5px 0;
    line-height: 1.4;
}
.frc__item--done .frc__label {
    color: #8c8c8c;
    text-decoration: line-through;
}
.frc__tick {
    flex: 0 0 16px;
    height: 16px;
    margin-top: 1px;
    border: 1.5px solid #d0d5dd;
    border-radius: 50%;
    font-size: 10px;
    line-height: 13px;
    text-align: center;
    color: transparent;
}
.frc__tick--done {
    background: #24c110;
    border-color: #24c110;
    color: #fff;
}
@media (max-width: 767px) {
    .frc {
        display: none;
    }
}
</style>
