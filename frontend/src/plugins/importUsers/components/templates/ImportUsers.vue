<template>
    <div>
        <Modal v-model="showModal" :title="$t('importUserButton.import_users')" :header="true" :footer="true" :styles="modalStyles"
            @close="closeModal" :headerClasses="'p-20px blue font-size-18'">
            <template #body>
                <component :is="steps[currentStep].component" v-bind="steps[currentStep].props" @next-step="handleNext"
                    @update-data="handleStepDataUpdate" ref="childRef" />
            </template>
            <template #footer>
                <div class="d-flex justify-content-end p-10px">
                    <button class="outline-secondary" @click="handleBack">
                        {{ $t('importTaskButton.back_button') }}
                    </button>
                    <button class="btn-primary ml-10px" @click="handleNext">
                        {{ $t('importTaskButton.next_button') }}
                    </button>
                </div>
            </template>
        </Modal>
    </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import Modal from '@/components/atom/Modal/Modal.vue';
import { showAlertModal } from '@/components/atom/AlertBox/helper';
import { useI18n } from "vue-i18n";
import ImportCsv from '../../../importTasks/components/atoms/ImportCsv.vue';
import SetHeaderRow from '../../../importTasks/components/atoms/SetHeaderRow.vue';
import HeaderMapping from '../organisms/HeaderMapping.vue';
import RoleMapping from '../molecules/RoleMapping.vue';
import DesignationMapping from '../molecules/DesignationMapping.vue';
import ReviewMapping from '../organisms/ReviewMapping.vue';

const showModal = ref(false);
const stepData = ref({});
const currentStep = ref(0);
const childRef = ref();
const { t } = useI18n();
const disableProceedButton = ref(false);

const emit = defineEmits(['toggle-importUser-modal', 'importUserSubmit']);

const modalStyles = {
    width: '100%',
    maxWidth: '1300px !important',
    backgroundColor: '#fff',
    borderRadius: '10px',
};

const props = defineProps({
    showImportModal: {
        type: Boolean,
        required: true
    }
})

watch(() => props.showImportModal, (newValue) => {
    if (newValue) {
        showModal.value = true;
    }
});

const steps = ref([
    { title: 'Step 0: Upload CSV', component: ImportCsv, props: { fromImportUsers: true } },
    { title: 'Step 1: Review Header', component: SetHeaderRow, props: { headers: stepData.value.headers, tableData: stepData.value.tableData } },
    { title: 'Step 2: Header Mapping', component: HeaderMapping, props: { headers: stepData.value.headers, tableData: stepData.value.tableData } },
    { title: 'Step 3: Role Mapping', component: RoleMapping, props: { userTable: stepData.value.userTable } },
    { title: 'Step 4: Designation Mapping', component: DesignationMapping, props: { roleMappedData: stepData.value.roleMappedData } },
    { title: 'Step 5: Review Mapping', component: ReviewMapping, props: { designationMappedData: stepData.value.designationMappedData, guestCount: stepData.value.guestCount } },
])

const handleStepDataUpdate = (data) => {
    try {
        stepData.value = { ...stepData.value, ...data };
        steps.value[1].props = { headers: stepData.value.headers, tableData: stepData.value.tableData };
        steps.value[2].props = { headers: stepData.value.headers, tableData: stepData.value.tableData };
        steps.value[3].props = { userTable: stepData.value.userTable };
        steps.value[4].props = { roleMappedData: stepData.value.roleMappedData, guestCount: stepData.value.guestCount };
        steps.value[5].props = { designationMappedData: stepData.value.designationMappedData, guestCount: stepData.value.guestCount };
    } catch (error) {
        console.error("Error updating step data:", error);
    }
}

const closeModal = () => {
    showAlertModal({
        title: t("alertBox.close_modal_title"),
        message: t("alertBox.close_modal_text"),
        type: 'warning',
        showCancel: true,
        cancelButtonText: t("alertBox.no"),
        confirmButtonText: t("alertBox.yes"),
    }).then(() => {
        showModal.value = false;
        resetStepData();
        emit('toggle-importUser-modal', false);
    }).catch(() => {
        return;
    })
};

// Resets step data and modal state
const resetStepData = () => {
    try {
        stepData.value = { headers: [], tableData: [] };
        currentStep.value = 0;
        disableProceedButton.value = false;
    } catch (error) {
        console.error("Error resetting step data:", error);
    }
};

const nextStepChecks = () => {
    try {
        if (currentStep.value < steps.value.length - 1) {
            currentStep.value++;
        } else {
            showModal.value = false;
        }
    } catch (error) {
        console.error("Error proceeding to next step:", error);
    }
}

const handleNext = async (val = false) => {
    try {
        if (val?.auto) {
            nextStepChecks();
        } else {
            if (currentStep.value === 0) {
                showAlertModal({
                    title: t("alertBox.valid_csv_title"),
                    message: t("alertBox.valid_csv_text"),
                    type: 'error',
                    showCancel: false,
                    confirmButtonText: t("alertBox.ok"),
                })
                return;
            } else if (currentStep.value === 1) {
                nextStepChecks();
            } else if (currentStep.value === 2) {
                const isValid = await childRef.value?.validateData();
                if (isValid) {
                    nextStepChecks();
                }
            } else if (currentStep.value === 3) {
                await childRef.value?.replaceRole();
                nextStepChecks();
            } else if (currentStep.value === 4) {
                await childRef.value?.replaceDesignation();
                nextStepChecks();
            } else if (currentStep.value === 5) {
                childRef.value?.getFinalData()
                    .then(() => {
                        showModal.value = false;
                        emit("importUserSubmit", stepData.value?.transformedData || []);
                        resetStepData();
                    })
                    .catch((error) => {
                        console.error("Error in field mapping:", error);
                    })
            } else {
                nextStepChecks();
            }
        }
    } catch (error) {
        console.error("Error during step execution:", error);
    }
}

const handleBack = () => {
    try {
        if (currentStep.value > 0) {
            showAlertModal({
                title: t("alertBox.go_back_title"),
                message: t("alertBox.go_back_text"),
                type: "warning",
                cancelButtonText: t("alertBox.cancel"),
                confirmButtonText: t("alertBox.confirm"),
            }).then(() => {
                currentStep.value--;
                disableProceedButton.value = false;
            }).catch(() => {
                return
            })
        } else {
            closeModal();
        }
    } catch (error) {
        console.error("Error going back to the previous step:", error);
    }
};


</script>