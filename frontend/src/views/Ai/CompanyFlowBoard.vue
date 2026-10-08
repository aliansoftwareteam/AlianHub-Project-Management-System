<template>
    <section class="cv-panel" data-test="flow-board">
        <h2 class="ah-h3">{{ $t('CompanyView.flow_title') }}</h2>
        <p class="ah-small">{{ $t('CompanyView.flow_lead', { days: data?.stuckDays ?? 3 }) }}</p>
        <div v-if="loading" class="ah-empty">{{ $t('CompanyView.loading') }}</div>
        <EmptyState v-else-if="failed" :title="$t('CompanyView.load_failed')" :action-label="$t('CompanyView.retry')" @action="$emit('retry')" />
        <p v-else-if="!lanes.length && !unroutedCount" class="ah-small" data-test="flow-empty">{{ $t('CompanyView.flow_empty') }}</p>
        <div v-else class="cv-lanes">
            <article v-if="unroutedCount" class="ah-card cv-lane" data-lane="unrouted">
                <div class="cv-lane__name">{{ $t('CompanyView.flow_unrouted') }}</div>
                <p class="ah-small">{{ $t('CompanyView.flow_unrouted_hint') }}</p>
                <TaskList :bucket="data.unrouted" />
            </article>
            <article v-for="lane in lanes" :key="lane.key" class="ah-card cv-lane" :data-lane="lane.key">
                <div class="cv-lane__name">{{ lane.name }}</div>
                <div v-for="bucket in BUCKETS" :key="bucket" class="cv-bucket" :data-bucket="bucket">
                    <div class="cv-bucket__head">
                        <span class="ah-label">{{ $t(`CompanyView.flow_${bucket}`) }}</span>
                        <span class="ah-chip ah-mono" :class="bucket === 'stuck' && lane[bucket].count ? 'ah-chip--danger' : ''">{{ lane[bucket].count }}</span>
                    </div>
                    <TaskList :bucket="lane[bucket]" :show-why="bucket === 'held'" />
                </div>
            </article>
        </div>
    </section>
</template>

<script setup>
import { computed, defineComponent, h } from "vue";
import { useI18n } from "vue-i18n";
import EmptyState from "@/components/atom/EmptyState/EmptyState.vue";

defineOptions({ name: "CompanyFlowBoard" });

const BUCKETS = Object.freeze(["waiting", "queued", "held", "stuck"]);

const props = defineProps({
    data: { type: Object, default: null },
    loading: { type: Boolean, default: false },
    failed: { type: Boolean, default: false }
});
defineEmits(["retry"]);

const lanes = computed(() => props.data?.roles || []);
const unroutedCount = computed(() => props.data?.unrouted?.count || 0);

const TaskList = defineComponent({
    name: "CompanyTaskList",
    props: { bucket: { type: Object, required: true }, showWhy: { type: Boolean, default: false } },
    setup(listProps) {
        const { t } = useI18n();
        return () => {
            const { items, count } = listProps.bucket;
            if (!count) return h("p", { class: "cv-none ah-small" }, t("CompanyView.flow_none"));
            return h("ul", { class: "cv-tasks" }, [
                ...items.map((item) => h("li", { class: "cv-task", key: item.taskId }, [
                    h("span", { class: "cv-task__key ah-mono" }, item.taskKey),
                    h("span", { class: "cv-task__name" }, item.taskName),
                    h("span", { class: "cv-task__project ah-small" }, item.project),
                    listProps.showWhy && item.why ? h("span", { class: "ah-chip" }, t(`CompanyView.held_${item.why}`)) : null
                ])),
                count > items.length ? h("li", { class: "cv-more ah-small" }, t("CompanyView.flow_more", { n: count - items.length })) : null
            ]);
        };
    }
});
</script>
