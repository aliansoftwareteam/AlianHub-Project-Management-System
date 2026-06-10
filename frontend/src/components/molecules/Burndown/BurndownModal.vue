<template>
    <div v-if="modelValue" class="burndown__overlay" @click.self="$emit('update:modelValue', false)">
        <div class="burndown__card">
            <div class="d-flex align-items-center justify-content-between burndown__head">
                <span class="font-size-16 font-weight-700">{{ $t('Projects.burndown') }}</span>
                <span class="cursor-pointer font-size-16 burndown__close" @click="$emit('update:modelValue', false)">&#10005;</span>
            </div>
            <div class="d-flex align-items-center burndown__controls">
                <span class="font-size-13 font-weight-500 mr-10px">{{ $t('Projects.select_sprint') }}:</span>
                <select v-model="selectedSprintId" class="burndown__select font-size-13">
                    <option v-for="sprint in sprintOptions" :key="'bd-'+sprint.id" :value="sprint.id">
                        {{ sprint.folderName ? sprint.folderName + ' / ' : '' }}{{ sprint.name }}
                    </option>
                </select>
            </div>
            <div v-if="isLoading" class="gray81 font-size-13 burndown__empty">{{ $t('Projects.searching') }}</div>
            <div v-else-if="!days.length" class="gray81 font-size-13 burndown__empty">{{ $t('Projects.no_burndown_data') }}</div>
            <ApexChart
                v-else
                type="line"
                height="320"
                :options="chartOptions"
                :series="chartSeries"
            />
        </div>
    </div>
</template>

<script setup>
// PACKAGES
import { computed, defineProps, ref, watch } from "vue";

// UTILS
import { apiRequest } from '@/services';

const props = defineProps({
    projectData: {
        type: Object,
        required: true
    },
    modelValue: {
        type: Boolean,
        default: false
    }
});

defineEmits(['update:modelValue']);

const selectedSprintId = ref('');
const days = ref([]);
const isLoading = ref(false);

// Project documents already carry every sprint: top-level `sprintsObj` plus
// per-folder `sprintsfolders[*].sprintsObj` — no extra fetch needed.
const sprintOptions = computed(() => {
    const options = [];
    Object.values(props.projectData?.sprintsObj || {}).forEach((sprint) => {
        if (sprint?.id) options.push({ id: sprint.id, name: sprint.name || 'Sprint' });
    });
    Object.values(props.projectData?.sprintsfolders || {}).forEach((folder) => {
        Object.values(folder?.sprintsObj || {}).forEach((sprint) => {
            if (sprint?.id) options.push({ id: sprint.id, name: sprint.name || 'Sprint', folderName: folder.folderName || '' });
        });
    });
    return options;
});

watch(() => props.modelValue, (open) => {
    if (open) {
        if (!selectedSprintId.value && sprintOptions.value.length) {
            selectedSprintId.value = sprintOptions.value[0].id;
        } else if (selectedSprintId.value) {
            fetchBurndown();
        }
    }
});

watch(selectedSprintId, () => {
    if (props.modelValue && selectedSprintId.value) {
        fetchBurndown();
    }
});

function fetchBurndown() {
    isLoading.value = true;
    days.value = [];
    apiRequest('post', '/api/v2/sprints/burndown', { sprintId: selectedSprintId.value })
    .then((response) => {
        days.value = response.data?.status ? (response.data.data?.days || []) : [];
    })
    .catch((error) => {
        console.error('ERROR in fetch burndown: ', error);
    })
    .finally(() => {
        isLoading.value = false;
    });
}

const chartSeries = computed(() => [
    { name: 'Remaining', data: days.value.map((day) => day.remainingCount) },
    { name: 'Ideal', data: days.value.map((day) => day.ideal) },
]);

const chartOptions = computed(() => ({
    chart: { toolbar: { show: false }, zoom: { enabled: false } },
    stroke: { width: [3, 2], curve: 'straight', dashArray: [0, 6] },
    colors: ['#7b68ee', '#bdbdbd'],
    xaxis: { categories: days.value.map((day) => day.date), labels: { rotate: -45, hideOverlappingLabels: true } },
    yaxis: { min: 0, forceNiceScale: true, labels: { formatter: (value) => Math.round(value) } },
    legend: { position: 'top' },
    tooltip: { y: { formatter: (value) => `${Math.round(value)}` } },
}));
</script>

<style scoped>
.burndown__overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
}
.burndown__card {
    background: #fff;
    border-radius: 10px;
    width: min(720px, 92vw);
    padding: 16px 20px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
}
.burndown__head {
    margin-bottom: 12px;
}
.burndown__close {
    color: #9a9a9a;
}
.burndown__close:hover {
    color: #e84a4a;
}
.burndown__controls {
    margin-bottom: 10px;
}
.burndown__select {
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 6px 8px;
    background: #fff;
    min-width: 220px;
}
.burndown__empty {
    padding: 40px 0;
    text-align: center;
}
</style>
