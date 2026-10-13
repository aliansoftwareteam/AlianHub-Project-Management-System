<template>
    <div>
        <div
            class="d-flex flex-row align-items-center text-center set-header-row-bordergray ml-30px mt-30px mr-30px justify-content-between border-radius-8-px set-header-row-bg-lightgray">
            <p class="pl-15px">{{ $t('importCsvAndSetHeader.header_row_question') }}</p>

            <button v-if="!isSelecting" @click="startSelecting" class="set-header-row-btn-primary mr-15px">{{
                $t('importCsvAndSetHeader.select_another_button') }}</button>
            <button v-if="isSelecting" @click="confirmSelection" class="set-header-row-btn-primary mr-15px">{{
                $t('importCsvAndSetHeader.confirm_row_btt') }}</button>
        </div>
        <div class="p-30px">
            <table class="w-100 border-collapse text-left">
                <thead>
                    <tr>
                        <span class="p-8px text-center position-ab left-0px"></span>
                        <th class="p-8px set-header-row-bg-lightgray set-header-row-font-weight-700 set-header-row-bordergray text-center"
                            v-for="(header, colIndex) in staticHeaders" :key="'header' + colIndex">
                            {{ header }}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <!-- Render the first 5 rows of data -->
                    <tr v-for="(row, rowIndex) in data.slice(0, 5) " :key="'row' + rowIndex">
                        <span class="text-left p-8px position-ab left-0px">
                            <!-- Radio button for selecting the header row -->
                            <input v-if="isSelecting" type="radio" name="header-row" :value="getOriginalRowIndex(row)"
                                :checked="getOriginalRowIndex(row) === selectedHeaderRow"
                                @change="selectHeaderRow(getOriginalRowIndex(row))" />
                            <!-- Arrow indicator for the currently selected header row -->
                            <span v-if="!isSelecting && getOriginalRowIndex(row) === selectedHeaderRow"
                                class="set-header-row-blue set-header-row-font-size-21">
                                <img :src=rightArrow alt="left arrow" class="w-25">
                            </span>
                        </span>
                        <td class="text-center p-8px set-header-row-bordergray" v-for="(value, colIndex) in row.slice(0, 5)"
                            :key="'cell-' + colIndex">
                            <span class="d-inline-block flex-break-word mw-290px">
                                {{ value }}
                            </span>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>

<script setup>
import { showAlertModal } from '@/components/atom/AlertBox/helper';
import { ref, defineEmits, computed } from 'vue';
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const rightArrow = require("@/assets/images/svg/right_arrow_blue.svg");
const emit = defineEmits(['update-data', 'update-selection-status']);

const props = defineProps({
    headers: {
        type: Array,
        required: true,
    },
    tableData: {
        type: Array,
        required: true,
    },
});

const data = [props.headers, ...props.tableData];

// Compute static headers (e.g., A, B, C, ...) based on the number of columns but limit it to 5 
const staticHeaders = computed(() => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const maxHeaders = props.headers.slice(0, 5);
    return maxHeaders.map((_, index) => alphabet[index]);
});

const selectedHeaderRow = ref(0);
const isSelecting = ref(false);

// Function to start the header row selection process
const startSelecting = () => {
    isSelecting.value = true;
    emit('update-selection-status', isSelecting.value);
};

// Helper function to check if all elements in a row are strings
const areAllElementsStrings = (row) => {
    return row.every(cell => typeof cell === 'string');
};

// Function to confirm the selected header row
const confirmSelection = () => {
    const selectedRow = data[selectedHeaderRow.value];

    if (!areAllElementsStrings(selectedRow)) {
        showAlertModal({
            title: t("alertBox.improper_header_selection_title"),
            message: t("alertBox.improper_header_selection_text"),
            type: 'error',
            showCancel: false,
        })
        return
    }

    isSelecting.value = false;
    separateHeaderRow();
    emit('update-selection-status', isSelecting.value);
};

// Function to update the selected header row index
const selectHeaderRow = (rowIndex) => {
    selectedHeaderRow.value = rowIndex;
};

// Function to find the original index of a row in the data array
const getOriginalRowIndex = (row) => {
    return data.findIndex(originalRow => originalRow === row);
};

// Function to separate the selected header row from the rest of the data
const separateHeaderRow = () => {
    if (selectedHeaderRow.value >= 0) {
        const headers = data[selectedHeaderRow.value];
        const tableData = data.filter((_, index) => index !== selectedHeaderRow.value);
        emit('update-data', { headers: headers, tableData: tableData });
    } else {
        return
    }
};

</script>

<style scoped>
.set-header-row-font-size-21 {
    font-size: 21px;
}
.set-header-row-font-weight-700 {
    font-weight: 700 !important;
}
.set-header-row-bg-lightgray {
    background-color: var(--fill);
}
.set-header-row-blue {
    color: var(--brand) !important;
}
.set-header-row-bordergray {
    border: 1px solid var(--border);
}
.set-header-row-btn-primary {
    cursor: pointer;
    background: var(--brand);
    border-radius: 4px;
    color: var(--on-brand);
    border: none;
    height: 30px;
    font-family: var(--font-ui);
}
</style>
