<template>
    <div class="d-flex flex-row justify-content-between w-100 p-10px align-items-center bg-light-gray">
        <!-- Left side of the container with the table -->
        <div class="w-50">
            <div class="">
                <!-- Table for displaying system headers and matching user header -->
                <table class="w-100 text-left bg-white">
                    <thead>
                        <tr class="border-gray">
                            <!-- Column for displaying index (A, B, C, etc.) -->
                            <th class="mw-40px w-40px bg-colorlightgray p8px-12px font-size-14 text-left dark-gray">
                                {{ String.fromCharCode(65 + index) }}
                            </th>
                            <!-- Column for displaying user header -->
                            <th
                                class="w-250px bg-colorlightgray p8px-12px font-size-14 text-left m-gray dark-gray position-re overflow-hidden left-white-border arrow">
                                {{ header?.userHeader }}
                            </th>
                            <!-- Dropdown for selecting system header -->
                            <th class="p8px-12px font-size-14 text-left dark-gray border-left-0">
                                <DropDown z-index="9">
                                    <template #button>
                                        <div class="d-flex flex-row justify-content-between align-items-center">
                                            <div>
                                                <button
                                                    class="text-nowrap btn-white border-0 cursor-pointer font-size-14 dark-gray"
                                                    ref="expand_collapse">
                                                    {{ header?.systemHeader }} ▼
                                                </button>
                                            </div>
                                            <div v-if="header?.systemHeader !== $t('headerMapping.no_match_title')">
                                                <button class="bg-transparent border-0 cursor-pointer"
                                                    @click.stop="clearDropdown">
                                                    <img :src=cross_svg alt="cross" class="w-15">
                                                </button>
                                            </div>
                                        </div>
                                    </template>
                                    <template #options>
                                        <!-- Search Box -->
                                        <DropDownOption>
                                            <input type="text" :placeholder="$t('PlaceHolder.search')" v-model="search[index]"
                                                class="p6px-8px border-gray border-radius-4-px font-size-14" />
                                        </DropDownOption>
                                        <!-- Filtered Options -->
                                        <DropDownOption
                                            v-for="(systemHeader, systemHeaderIndex) in filteredSystemHeaders(index)"
                                            :key="systemHeaderIndex" :item="systemHeader"
                                            @click="emitSelectHeader(index, systemHeader), $refs?.expand_collapse?.click()">
                                            <span>{{ systemHeader }}</span>
                                        </DropDownOption>
                                    </template>
                                </DropDown>
                            </th>
                        </tr>
                    </thead>
                    <!-- Body of the table displaying data rows -->
                    <tbody>
                        <tr class="hover-bg-light-blue" v-for="(row, rowIndex) in props.tableData?.slice(0, 3)"
                            :key="rowIndex">
                            <td class="bg-colorlightgray p8px-12px font-size-14 border-gray top-bottom-white-border">{{ rowIndex + 1 }}
                            </td>
                            <td class="p8px-12px font-size-14 border-gray" colspan="2">{{ row[index] || 'N/A' }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
        <!-- Right side of the container for displaying match status -->
        <div class="w-50 p-10px text-center font-size-14 dark-gray border-left-gray-blue d-flex flex-column">
            <div v-if="header?.systemHeader === $t('headerMapping.no_match_title')"
                class="d-flex flex-column align-items-left">
                <!-- Message for no match found -->
                <div class="d-flex flex-row">
                    <img :src="warning_svg" alt="warning" class="w-20 mr-5px">
                    <p class="font-size-14 dark-gray m-0">{{ $t('headerMapping.no_match') }}</p>
                </div>
                <div class="text-left font-size-12 text-gray ml-25px">
                    <p class="m-0">
                        {{ $t('headerMapping.no_match_description') }}
                    </p>
                </div>
                <!-- Actions for "No Match" -->
                <div class="d-flex flex-row ml-25px mt-20px">
                    <button class="outline-primary mr-20px" @click="includeAsCustomField()">
                        {{ $t('headerMapping.custom_field_button') }}
                    </button>
                    <button class="outline-primary" @click="emit('ignore-field', index)">
                        {{ $t('headerMapping.ignore_field_button') }}
                    </button>
                </div>
            </div>
            <!-- Message for matched fields -->
            <div v-else class="align-items-left">
                <div class="d-flex flex-row">
                    <img :src="tick_true_svg" alt="tick_true" class="w-20 mr-5px">
                    <p class="font-size-14 dark-gray m-0">{{ $t('headerMapping.matched_to_field') }} <strong> {{
                        header?.systemHeader }}
                        </strong>
                    </p>
                </div>
                <div class="text-left font-size-12 text-gray ml-25px">
                    <p class="m-0">
                        {{ props?.description }}
                    </p>
                    <!-- Warning for duplicate fields -->
                    <div v-if="isDuplicateField(header?.userHeader)"
                        class="d-flex align-items-center align-items-center mt-10px">
                        <img :src=red_warning alt="warning" class="w-20">
                        <p class="text-danger m-0 font-size-15">
                            {{ $t('headerMapping.duplication_warning') }}
                        </p>
                    </div>
                </div>
                <!-- Actions for "Matched" -->
                <div class="d-flex flex-row ml-25px mt-20px">
                    <!-- Confirm Mapping button, disabled if duplicate -->
                    <button class="btn-primary mr-20px" :disabled="isDuplicateField(header?.userHeader)"
                        :class="{ 'disabled': isDuplicateField(header?.userHeader) }"
                        @click="emit('confirm-field', index)">
                        {{ $t('headerMapping.confirm_map_button') }}
                    </button>
                    <button class="outline-primary" @click="emit('ignore-field', index)">
                        {{ $t('headerMapping.ignore_field_button') }}
                    </button>
                    <!-- Include as Custom Field button, shown for duplicates -->
                    <button v-if="isDuplicateField(header?.userHeader)" class="outline-primary ml-20px"
                        @click="emit('custom-field', header?.userHeader)">
                        {{ $t('headerMapping.custom_field_button') }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { defineProps, defineEmits, ref } from 'vue';
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';

const tick_true_svg = require("@/assets/images/svg/tick-true-green.svg");
const warning_svg = require("@/assets/images/svg/Warning.svg");
const cross_svg = require("@/assets/images/svg/grayCross.svg");
const red_warning = require("@/assets/images/svg/redWarning.svg");

const search = ref([]);

const props = defineProps({
    header: {
        type: Object,
        required: true
    },
    systemHeaders: {
        type: Array,
        required: true
    },
    index: {
        type: Number,
        required: true
    },
    tableData: {
        type: Array,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    duplicates: {
        type: Object,
        required: true
    }
});

const systemHeaders = ref(props.systemHeaders);
const header = ref(props.header);
const index = ref(props.index);

const emit = defineEmits([
    'select-header',
    'ignore-field',
    'confirm-field',
    'reset-dropdown',
    'custom-field'
]);

// Filter system headers based on the search term for each index
const filteredSystemHeaders = (index) => {
    try {
        const term = search.value[index] || '';
        return systemHeaders.value.filter((header) =>
            header.toLowerCase().includes(term.toLowerCase())
        );
    } catch (error) {
        console.error('Error filtering system headers:', error);
        return [];
    }
};

// Emit the selected system header to the parent component
const emitSelectHeader = (index, systemHeader) => {
    try {
        emit('select-header', { index: index, systemHeader: systemHeader });
    } catch (error) {
        console.error('Error emitting select-header event:', error);
    }
};

// Check if a field is duplicate
const isDuplicateField = (field) => {
    try {
        const allDuplicates = Object.values(props.duplicates).flat();
        return allDuplicates.includes(field);
    } catch (error) {
        console.error('Error checking duplicate fields:', error);
        return false;
    }
};

// Clear the dropdown selection
const clearDropdown = () => {
    try {
        emit('reset-dropdown');
    } catch (error) {
        console.error('Error emitting reset-dropdown event:', error);
    }
};

// Include the current field as a custom field
const includeAsCustomField = () => {
    try {
        emit('custom-field', header.value.userHeader);
    } catch (error) {
        console.error('Error emitting custom-field event:', error);
    }
};
</script>


<style scoped>
.top-bottom-white-border {
    border-top: 1px solid white !important;
    border-bottom: 1px solid white !important;
}
.left-white-border {
    border-left: 1px solid white !important;
}
.arrow::before {
    position: absolute;
    right: 0;
    top: 0;
    display: block;
    content: "";
    width: 48px;
    height: 48px;
    background-color: #ffffff;
    z-index: 9;
}

.arrow::after {
    content: "";
    width: 50px;
    height: 48px;
    border-color: #c6d1dd #c6d1dd transparent transparent;  
    transform: rotate(45deg) translate(-6px, 10px);
    border-width: 1px;
    background: #DFE1E6;
    display: block;
    z-index: 10;
    position: absolute;
    top: -3px;
    right: 0;
}

.disabled {
    background: grey;
    cursor: not-allowed;
}
</style>