<template>
    <div v-if="entry && body" class="hcat" data-test="home-catalog-card" :data-card="cardKey" :style="{ height: `${entry.size.h * ROW_PX}px` }">
        <DashboardCard
            :title="$t(entry.titleKey)"
            :scope="$t(entry.scopeKey)"
            :show-refresh="true"
            :show-remove="true"
            :link-label="link ? $t(entry.link.labelKey) : ''"
            :link-to="link"
            :empty-text="entry.emptyKey ? $t(entry.emptyKey) : ''"
            :empty-action="entry.emptyActionKey && link ? $t(entry.emptyActionKey) : ''"
            @refresh="refreshKey++"
            @retry="refreshKey++"
            @remove="$emit('remove')"
            @empty-action="link && router.push(link)"
        >
            <component
                :is="body"
                :cardUID="`home-${cardKey}`"
                :componentId="cardKey"
                :cardData="cardData"
                :filterData="[]"
                :refreshTrigger="refreshKey"
                :companyUserDetail="companyUserDetail"
                :allProjectsArrayFilter="projects"
                :taskStatusArray="taskStatusArray"
            />
        </DashboardCard>
    </div>
</template>

<script setup>
import { computed, inject, ref, unref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import DashboardCard from "@/components/organisms/DashboardCard/DashboardCard.vue";
import { catalogEntry } from "@/plugins/dashboard/cardCatalog";
import { cardComponent } from "@/plugins/dashboard/cardRegistry";

defineOptions({ name: "HomeCatalogCard" });
const props = defineProps({ cardKey: { type: String, required: true } });
defineEmits(["remove"]);

const ROW_PX = 30;

const router = useRouter();
const { getters } = useStore();
const companyId = inject("$companyId", "");
const refreshKey = ref(0);

const entry = computed(() => catalogEntry(props.cardKey));
const body = computed(() => cardComponent(props.cardKey));
const cardData = computed(() => (entry.value && entry.value.period !== null ? { timerange: entry.value.period } : {}));
const link = computed(() => {
    const target = entry.value?.link;
    if (!target || !router.hasRoute(target.name)) return null;
    return { name: target.name, params: { cid: unref(companyId) } };
});

const companyUserDetail = computed(() => getters["settings/companyUserDetail"]);
const taskStatusArray = computed(() => getters["settings/AllTaskStatus"]);
const projects = computed(() => getters["projectData/onlyActiveProjects"]?.data || []);
</script>

<style scoped>
.hcat { min-width: 0; max-height: 520px; }
@media (max-width: 767px) {
    .hcat { max-height: 440px; }
}
</style>
