<template>
    <div class="p-20px pb-0px">
        <div>
            <div class="d-flex justify-content-between">
                <h3>{{ $t('userSelection.title') }}</h3>
                <div v-if="userLimitReached" class="border-radius-5-px border-primary blue p-5px d-flex">
                    <img :src=warning alt="warning icon" class="w-15 mr-5px">
                    <p class="m-0">
                        {{ $t(userLimitErrorMessage) }}
                    </p>
                </div>
            </div>
            <p>{{ $t('userSelection.description') }}</p>
            <div class="mb-5px mt-5px d-flex" v-if="tableData.some(row => isEmailMatched(row))">
                <img :src=gray_warning alt="warning icon" class="w-20 mr-10px ml-10px">
                <p class="gray m-0">
                    {{ $t('userSelection.duplicate_email_error') }}
                </p>
            </div>
            <div class="mb-10px mt-5px d-flex" v-if="tableData.some(row => !isValidEmail(row[userEmailIndex]))">
                <img :src=red_warning alt="warning icon" class="w-20 mr-10px ml-10px">
                <p class="red m-0">
                    {{ $t('userSelection.invalid_fields') }}
                </p>
            </div>
        </div>
        <!-- Scrollable table displaying the user data -->
        <div class="scrollable style-scroll">
            <table class="text-center border-collapse w-100">
                <thead class="position-sti sticky-header z-index-1">
                    <tr class="header-top-border">
                        <th v-for="(header, index) in staticHeaders" :key="index"
                            class="p-8px bg-colorlightgray font-weight-700 bordergray text-center">
                            {{ header }}
                        </th>
                        <th
                            class="p-8px bg-colorlightgray font-weight-700 bordergray text-center d-flex justify-content-center gap-5px">
                            {{ $t('valueMapping.user_dropdown_text') }}
                            <CheckboxComponent :id="'select-all-check'" v-model="selectAllChecked"
                                @click="handleSelectAll(false)" :customClass="'bg-white'" />
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(row, rowIndex) in tableData" :key="'row' + rowIndex"
                        :class="{ 'highlight-gray': isEmailMatched(row) }">
                        <td v-for="(col, colIndex) in row" :key="'col' + colIndex"
                            :title="tableData[rowIndex][colIndex]" :class="{
                                'invalid-email': staticHeaders[colIndex] === 'User Email' && !isValidEmail(col) || staticHeaders[colIndex] === 'Role' && isRoleValid(row),
                            }" class="p-5px bordergray">
                            <input v-if="staticHeaders[colIndex] === 'User Email'"
                                v-model="tableData[rowIndex][colIndex]" class="p-5px border-0 text-center w-100" :class="{
                                    'highlight-gray': isEmailMatched(row),
                                    'invalid-email': staticHeaders[colIndex] === 'User Email' && !isValidEmail(col)
                                }" type="text" />
                            <div v-else-if="staticHeaders[colIndex] === 'Role'">
                                <DropDown :zIndex="8">
                                    <template #button>
                                        <button
                                            class="bg-white border-0 cursor-pointer font-size-14 dark-gray w-100 drop-down-icon"
                                            :style="{ backgroundImage: `url(${dropDownSvg})` }" :class="{
                                                'highlight-gray': isEmailMatched(row),
                                                'invalid-email': isRoleValid(row)
                                            }" :disabled="isEmailMatched(row)" ref="expand_collapse_role">
                                            <div class="d-flex justify-content-center align-items-center m-5px">
                                                <p class="m-0 color94">
                                                    {{ col || "Select a Role" }}
                                                </p>
                                            </div>
                                        </button>
                                    </template>
                                    <template #options>
                                        <DropDownOption>
                                            <input type="text" :placeholder="$t('PlaceHolder.search')" v-model="search[colIndex]"
                                                class="p6px-8px border-gray-blue border-radius-4-px font-size-14" />
                                        </DropDownOption>
                                        <DropDownOption v-for="(sysRole, sysIndex) in filteredRoles(colIndex)"
                                            :key="sysIndex" :item="sysRole"
                                            @click="updateRole(sysRole, rowIndex, colIndex,), $refs?.expand_collapse_role[rowIndex]?.click()">
                                            <span>{{ sysRole }}</span>
                                        </DropDownOption>
                                    </template>
                                </DropDown>
                            </div>
                            <div v-else-if="staticHeaders[colIndex] === 'Designation'">
                                <DropDown :zIndex="8">
                                    <template #button>
                                        <button
                                            class="bg-white border-0 cursor-pointer font-size-14 dark-gray w-100 drop-down-icon"
                                            :style="{ backgroundImage: `url(${dropDownSvg})` }" :class="{
                                                'highlight-gray': isEmailMatched(row),
                                            }" :disabled="isEmailMatched(row)" ref="expand_collapse_designation">
                                            <div class="d-flex justify-content-center align-items-center m-5px">
                                                <p class="m-0 color94">
                                                    {{ col || "Select a Designation" }}
                                                </p>
                                            </div>
                                        </button>
                                    </template>
                                    <template #options>
                                        <DropDownOption>
                                            <input type="text" :placeholder="$t('PlaceHolder.search')" v-model="search[colIndex]"
                                                class="p6px-8px border-gray-blue border-radius-4-px font-size-14" />
                                        </DropDownOption>
                                        <DropDownOption
                                            v-for="(sysDesignation, sysIndex) in filteredDesignations(colIndex)"
                                            :key="sysIndex" :item="sysDesignation"
                                            @click="updateDesignation(sysDesignation, rowIndex, colIndex), $refs?.expand_collapse_designation[rowIndex]?.click()">
                                            <span>{{ sysDesignation }}</span>
                                        </DropDownOption>
                                    </template>
                                </DropDown>
                            </div>
                        </td>
                        <td class="p-5px bordergray text-webkit-center">
                            <CheckboxComponent :id="'checkbox' + rowIndex" v-model="mappedData[rowIndex].isChecked"
                                :value="true" :disabled="shouldDisableCheckbox(row, rowIndex)" />
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
<script setup>
import { ref, onMounted, defineEmits, defineExpose, computed, watch } from 'vue';
import { memberData } from '@/views/Settings/Members/helperMember';
import CheckboxComponent from '@/components/atom/Checkbox/CheckboxComponent.vue';
import { useStore } from 'vuex';
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const { getters } = useStore();
const currentCompany = computed(() => getters["settings/selectedCompany"]);
const userLimit = computed(() => currentCompany.value.planFeature.users);
const { getCompanyUsers } = memberData();
const companyUsers = ref([]);
const employeeEmails = ref([]);
const staticHeaders = ref([]);
const headerKeys = ref([]);
const tableData = ref([]);
const mappedData = ref([]);
const selectAllChecked = ref(false);
const search = ref([]);
const systemRolesArray = ref([]);

const red_warning = require("@/assets/images/svg/redWarning.svg");
const gray_warning = require("@/assets/images/svg/grayWarning.svg");
const warning = require("@/assets/images/svg/Warning.svg");
const dropDownSvg = require("@/assets/images/svg/dropdown_strong.svg");

const rolesGetter = computed(() => {
    return getters['settings/roles'];
});
const designationsGetter = computed(() => {
    return getters['settings/designations'].filter((x) => !x.isDelete);
});

const props = defineProps({
    designationMappedData: {
        type: Array,
        required: true,
    },
    guestCount: {
        type: Number,
        required: true,
    }
});

const emit = defineEmits(['update-data']);

// Initialize mappedData once in onMounted
onMounted(() => {
    try {
        systemRolesArray.value = rolesGetter?.value.filter(role => !role.isDelete && role.name !== 'Owner').map(role => role.name);
        companyUsers.value = getCompanyUsers();

        employeeEmails.value = companyUsers.value
            .map(user => user.Employee_Email)
            .filter(email => email !== undefined);

        if (!props.designationMappedData || props.designationMappedData.length < 2) {
            throw new Error('Invalid designationMappedData data: Must contain at least headers and data rows.');
        }

        staticHeaders.value = Object.values(props.designationMappedData[0]); // First row as headers
        headerKeys.value = Object.values(props.designationMappedData[1]); // Second row as keys for data
        tableData.value = props.designationMappedData.slice(2); // Remaining rows as table data

        // Initialize mappedData with isChecked = false
        mappedData.value = tableData.value.map((row) => {
            const mappedRow = {};
            headerKeys.value.forEach((header, index) => {
                mappedRow[header] = row[index];
            });
            mappedRow.isChecked = false;
            return mappedRow;
        });
        setTimeout(() => {
            handleSelectAll(true)
        });
    } catch (error) {
        console.error('Error during onMounted setup:', error);
    }
});

const roleIndex = computed(() => headerKeys.value.indexOf('roleType'));
const guestUserLimit = computed(() => currentCompany.value?.planFeature?.guestUser);

// If guestUserLimit is null, allow unlimited guests
const allowedGuestCount = computed(() => {
    return guestUserLimit.value != null
        ? guestUserLimit.value - props.guestCount
        : Infinity;
});

const guestRows = computed(() => {
    if (roleIndex.value === -1) return [];
    return tableData.value
        .map((row, index) => ({ role: row[roleIndex.value], index }))
        .filter(r => r.role?.toLowerCase() === 'guests');
});

const isGuestLimitReached = computed(() => {
    return guestRows.value.length >= allowedGuestCount.value;
});

// Watch and handle guest role logic
watch(
    [guestRows, isGuestLimitReached],
    () => {
        // If unlimited guests are allowed, do nothing
        if (guestUserLimit.value == null) return;

        const guestIndex = systemRolesArray.value.findIndex(
            role => role.toLowerCase() === 'guests'
        );

        // Remove "Guests" if limit reached
        if (isGuestLimitReached.value) {
            if (guestIndex !== -1) {
                systemRolesArray.value.splice(guestIndex, 1);
            }

            // Clear extra guest roles in the table
            for (let i = guestRows.value.length - 1; i >= allowedGuestCount.value; i--) {
                const rowIndex = guestRows.value[i].index;
                tableData.value[rowIndex][roleIndex.value] = '';
            }
        } else {
            // Add "Guests" back if not already present
            if (guestIndex === -1) {
                systemRolesArray.value.push('Guests');
            }
        }
    },
    { immediate: true, deep: true }
);

const handleSelectAll = (shouldAutoSelect = false) => {
    try {
        // Set the selectAllChecked based on the context
        if (shouldAutoSelect) {
            selectAllChecked.value = true;
        } else {
            selectAllChecked.value = !selectAllChecked.value;
        }

        // Set the initial count based on userLimit
        let count = userLimit.value !== null ? employeeEmails.value.length : 0;
        const maxLimit = userLimit.value !== null ? userLimit.value : 100;

        mappedData.value = mappedData.value.map((row, index) => {
            const isDisabled = shouldDisableCheckbox(tableData.value[index], index, false, true);

            if (count < maxLimit && !isDisabled) {
                count++;
                return {
                    ...row,
                    isChecked: shouldAutoSelect ? true : selectAllChecked.value,
                };
            }
            return row;
        });
    } catch (error) {
        console.error(shouldAutoSelect ? 'Error during autoSelect:' : 'Error selecting all:', error);
    }
};

// Determine if checkbox should be disabled
const shouldDisableCheckbox = (row, index, fromWatcher = false, fromHandleSelect = false) => {
    try {
        const mappedRow = mappedData.value[index];
        const email = row[userEmailIndex.value];

        // Allow already checked checkboxes to remain interactive
        if (!fromWatcher) {
            if (mappedRow && mappedRow.isChecked) return false;
        }

        // If limit is reached, disable all except the checked ones
        if (!fromHandleSelect) {
            if (userLimitReached.value) return true;
        }

        return isEmailMatched(row) || !isValidEmail(email) || isRoleValid(row, index);

    } catch (error) {
        console.error('Error disabling the checkbox', error);
    }
};

// Watch mappedData to update selectAll when all checkboxes are manually checked/unchecked
watch(mappedData, (newData) => {
    const selectableRows = newData.filter((row, index) => !shouldDisableCheckbox(tableData.value[index], index));
    // Count only the rows that are checked
    const checkedCount = selectableRows.filter(row => row.isChecked).length;

    // Determine the required number of checked rows
    const maxCheckable = userLimit.value !== null
        ? Math.min(userLimit.value - employeeEmails.value.length, selectableRows.length) // Case 1: Limited user import
        : Math.min(100, selectableRows.length); // Case 2: Unlimited import (capped at 100)

    // If enough checkboxes are selected, update selectAllChecked
    selectAllChecked.value = checkedCount >= maxCheckable;

}, { deep: true });

// Watch tableData for changes and update isChecked accordingly
watch(tableData, (newTableData, oldData) => {
    if (oldData.length === 0) {
        return;
    }
    newTableData.forEach((row, rowIndex) => {
        // If checkbox should be disabled, set isChecked to false
        if (shouldDisableCheckbox(row, rowIndex, true)) {
            mappedData.value[rowIndex].isChecked = false;
        }
    });
}, { deep: true });

const userLimitReached = computed(() => {
    const checkedRows = mappedData.value.filter(row => row.isChecked).length;
    if (userLimit.value !== null) {
        return checkedRows >= userLimit.value - employeeEmails.value.length;
    } else {
        return checkedRows >= 100;
    }
});

const userLimitErrorMessage = computed(() => {
    if (userLimit.value !== null) {
        return t('userSelection.user_limit_error');
    } else {
        return t("userSelection.user_limit_100");
    }
});

const isRoleValid = (row) => {
    const roleIndex = headerKeys.value.indexOf('roleType');
    if (row[roleIndex] !== '') {
        return false;
    }
    return true;
}

const userEmailIndex = computed(() => {
    return staticHeaders.value.findIndex(header => header === "User Email");
});

const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

const isEmailMatched = (row) => {
    const email = row[userEmailIndex.value];
    return employeeEmails.value.includes(email);
};

const filteredDesignations = (index) => {
    const systemDesignationsArray = designationsGetter.value.filter((x) => !x.isDelete).map(item => item.name);
    const term = search.value[index] || "";
    return systemDesignationsArray.filter((designation) =>
        designation.toLowerCase().includes(term.toLowerCase())
    );
}

const updateDesignation = (newVal, rowIndex, colIndex) => {
    tableData.value[rowIndex][colIndex] = newVal;
    mappedData.value[rowIndex].designation = newVal;
}

const filteredRoles = (index) => {
    const term = search.value[index] || "";
    return systemRolesArray.value.filter((role) =>
        role.toLowerCase().includes(term.toLowerCase())
    );
}

const updateRole = (newVal, rowIndex, colIndex) => {
    tableData.value[rowIndex][colIndex] = newVal;
    mappedData.value[rowIndex].roleType = newVal;
};

const getFinalData = () => {
    return new Promise((resolve, reject) => {
        try {
            const reqFields = ['Employee_Email', 'roleType', 'designation'];
            if (!mappedData.value.length) {
                throw new Error('No mapped data available to filter.');
            }
            // Create lookup maps for roles and designations
            const rolesMap = Object.fromEntries(rolesGetter.value.map(role => [role.name, role.key]));
            const designationsMap = Object.fromEntries(designationsGetter.value.map(desig => [desig.name, desig.key]));
            // Filter out rows where any required field is missing
            const filteredData = mappedData.value
                .filter(row => !reqFields.some(column => !row[column] || row[column].trim() === "N/A" || row[column].trim() === "null"))
                .map(row => ({
                    ...row,
                    roleType: rolesMap[row.roleType], // Replace roleType with its key
                    designation: designationsMap[row.designation] // Replace designation with its key
                }))
                .filter((row) => row.isChecked === true);
            const transformedData = filteredData.map(row => {
                return {
                    companyId: currentCompany.value._id,
                    companyName: currentCompany.value.Cst_CompanyName,
                    designation: row.designation,
                    isDelete: false,
                    linkId: "",
                    role: row.roleType,
                    sendInvitationTime: "",
                    status: 1,
                    email: row.Employee_Email,
                    userId: "",
                    isRestrict: false,
                    __v: 0,
                    isTrackerUser: false
                };
            });
            emit('update-data', { transformedData });
            resolve(true);
        } catch (error) {
            console.error('Error filtering data in getFinalData:', error);
            reject(error);
        }
    });
};

defineExpose({
    getFinalData,
});

</script>

<style scoped>
.sticky-header {
    top: 0;
}

.scrollable {
    overflow-y: auto;
    max-height: 60vh;
    overflow-x: auto;
}

.gap-5px {
    gap: 5px;
}

.highlight-gray {
    background-color: #d3d3d3 !important;
}

.invalid-email {
    background-color: #FFB3B3 !important;
}

.right-0 {
    right: 0 !important;
}

.drop-down-icon {
    background-size: 20px;
    background-repeat: no-repeat;
    background-position: center right;
}

tr.header-top-border {
    position: relative;
}

tr.header-top-border:after {
    content: '';
    position: absolute;
    height: 1px !important;
    width: 100%;
    background: #CFCFCF;
    top: 0px;
    left: 0;
}
</style>