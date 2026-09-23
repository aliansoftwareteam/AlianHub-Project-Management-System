<template>
    <div class="d-flex flex-column align-items-center">
        <div class="text-center w-80 m0-auto">
            <h2 class="m-0">{{ $t('designationMapping.title') }}</h2>
            <p class="font-size-14">
                {{ $t('designationMapping.description') }}
            </p>
        </div>
        <div class="d-flex flex-column align-items-center p-10px scrollable style-scroll">
            <div v-for="(designation, designationIndex) in uniqueUserDesignations" :key="designationIndex"
                class="d-flex align-items-center mb-15px border-bottom-mobiledrop pb-10px">
                <div class="min-width text-center">
                    {{ designation }}
                </div>
                <div class="ml-10px mr-30px">→</div>
                <div class="min-width">
                    <DropDown z-index="9">
                        <template #button>
                            <button
                                class="bg-white border-radius-5-px border-groupBy cursor-pointer font-size-14 dark-gray w-100"
                                ref="expand_collapse_status">
                                <div class="d-flex justify-content-between align-items-center m-5px">
                                    <p class="m-0 color94">
                                        {{ selectedDesignation[designationIndex] ||
                                            $t('valueMapping.status_dropdown_text') }}
                                    </p>
                                    <img :src=dropDownSvg alt="dropDownSvg" class="w-20">
                                </div>
                            </button>
                        </template>
                        <template #options>
                            <DropDownOption>
                                <input type="text" :placeholder="$t('PlaceHolder.search')" v-model="search[designationIndex]"
                                    class="p6px-8px border-gray-blue border-radius-4-px font-size-14" />
                            </DropDownOption>
                            <DropDownOption v-for="(sysDesignation, sysIndex) in filteredDesignations(designationIndex)"
                                :key="sysIndex" :item="sysDesignation"
                                @click="createDesignationMap(designationIndex, sysDesignation), $refs?.expand_collapse_status[designationIndex]?.click()">
                                <span>{{ sysDesignation }}</span>
                            </DropDownOption>
                        </template>
                    </DropDown>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { defineProps, onMounted, computed, ref, defineExpose, defineEmits } from "vue";
import { useStore } from 'vuex';
import DropDown from "@/components/molecules/DropDown/DropDown.vue";
import DropDownOption from "@/components/molecules/DropDownOption/DropDownOption.vue";
import { useI18n } from "vue-i18n";
import { showAlertModal } from "@/components/atom/AlertBox/helper";

const { getters } = useStore();
const dropDownSvg = require("@/assets/images/svg/dropdown_strong.svg");
const { t } = useI18n();

const props = defineProps({
    roleMappedData: {
        type: Array,
        required: true,
    },
});

const systemDesignationsArray = ref([]);
const uniqueUserDesignations = ref([]);
const selectedDesignation = ref([]);
const designationMapping = ref([]);
const search = ref([]);
const emit = defineEmits(['update-data']);

const designations = computed(() => {
    return getters['settings/designations'].filter((x) => !x.isDelete);
});

onMounted(() => {
    systemDesignationsArray.value = designations.value.map(item => item.name);
    getUniqueDesignations();
});

const getUniqueDesignations = () => {
    try {
        const keyMapping = props.roleMappedData[1];
        let designationIndex = Object.keys(keyMapping).find(key => keyMapping[key] === "designation");

        const designations = props.roleMappedData.slice(2).map(row => row[designationIndex]?.trim()).filter(Boolean);

        uniqueUserDesignations.value = [...new Set(designations)];
    } catch (error) {
        console.error(error);
    }
}

const filteredDesignations = (index) => {
    const term = search.value[index] || "";
    return systemDesignationsArray.value.filter((designation) =>
        designation.toLowerCase().includes(term.toLowerCase())
    );
}

const createDesignationMap = (index, selectedSystemDesignation) => {
    try {
        const userDesignation = uniqueUserDesignations.value[index];
        const mappingIndex = designationMapping.value.findIndex(
            (mapping) => mapping.oldDesignation === userDesignation
        );

        if (mappingIndex !== -1) {
            designationMapping.value[mappingIndex].newDesignation = selectedSystemDesignation;
        } else {
            designationMapping.value.push({
                oldDesignation: userDesignation,
                newDesignation: selectedSystemDesignation,
            });
        }
        selectedDesignation.value[index] = selectedSystemDesignation;
    } catch (error) {
        console.error("Error in createDesignationMap", error);
    }
}

const replaceDesignation = () => {
    return new Promise((resolve, reject) => {
        try {
            const unmappedDesignation = uniqueUserDesignations.value.filter((designation) => !designationMapping.value.some(mapping => mapping.oldDesignation === designation));

            if (unmappedDesignation.length > 0) {
                showAlertModal({
                    title: t("alertBox.incomplete_mapping_title"),
                    message: t("alertBox.incomplete_mapping_text"),
                    type: "error",
                    showCancel: false,
                    confirmButtonText: t("alertBox.ok"),
                })
                reject(false);
                return;
            }

            const keyMapping = props.roleMappedData[1];
            let designationIndex = Object.keys(keyMapping).find(key => keyMapping[key] === "designation");

            const designationMappedData = props.roleMappedData.map((row, index) => {
                if (index < 2) return row;

                const currentDesignation = row[designationIndex]?.toLowerCase().trim();
                const designationMappingEntry = designationMapping.value.find(
                    mapping => mapping.oldDesignation.toLowerCase().trim() === currentDesignation
                );
                if (designationMappingEntry) {
                    return { ...row, [designationIndex]: designationMappingEntry.newDesignation };
                }
                return row;
            });
            emit('update-data', { designationMappedData });
            resolve(true);

        } catch (error) {
            reject(false);
            console.error('Error replacing Designation:', error)
        }
    })
}

defineExpose({
    replaceDesignation
});
</script>

<style scoped>
.min-width {
    min-width: 250px;
}

.scrollable {
    overflow-y: auto;
    max-height: 60vh;
    overflow-x: auto;
}
</style>
