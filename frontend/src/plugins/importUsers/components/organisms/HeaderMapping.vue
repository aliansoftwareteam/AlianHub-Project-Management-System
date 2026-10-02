<template>
    <div>
        <div>
            <h3>{{ $t('headerMapping.title') }}</h3>
        </div>
        <div class="ml-10px mr-10px mh-60vh overflow-y-auto mt-20px d-flex flex-column scrollable-container">
            <div v-for="(header, index) in headerData" :key="index"
                class="d-flex justify-content-between border-radius-5-px header-mapping-bg-white">
                <!-- If the header is ignored, display IgnoredField component -->
                <template v-if="header?.isIgnored">
                    <IgnoredField :header="header?.userHeader" @editIgnoredField="toggleIgnoreField(index)" />
                </template>
                <!-- If the header is confirmed, display ConfirmField component -->
                <template v-else-if="header?.isConfirmed">
                    <ConfirmField :header="header" @edit-confirmed-field="toggleConfirmField(index)" />
                </template>
                <template v-else>
                    <!-- Default rendering when header is neither ignored nor confirmed -->
                    <HeaderEditing :header="header" :index="index" :systemHeaders="systemHeaders"
                        @select-header="selectHeader" :tableData="props?.tableData" @ignore-field="toggleIgnoreField"
                        :description="getDescription(header?.systemHeader)" @confirm-field="toggleConfirmField"
                        :duplicates="duplicateValues" @reset-dropdown="resetDropdown(index)" />
                </template>
            </div>
        </div>
    </div>
</template>

<script setup>
import { defineProps, ref, onMounted, watch, defineEmits } from 'vue';

import HeaderEditing from '../molecules/HeaderEditing.vue';
import IgnoredField from '../../../importTasks/components/atoms/IgnoredField.vue';
import ConfirmField from '../../../importTasks/components/atoms/ConfirmField.vue';
import { useI18n } from "vue-i18n";
import { showAlertModal } from '@/components/atom/AlertBox/helper';


const { t } = useI18n();
const headerData = ref([]);
const duplicateValues = ref({});
const emit = defineEmits(['update-data']);

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

// Predefined keywords for system headers matching
let keywordsArray = [
    {
        header: "User Email",
        key: 'Employee_Email',
        required: true,
        keywords: ["email", "userEmail", "emailId", "emailAddress"],
        description: t("importUserKeywords.user_email_description"),
    },
    {
        header: "Role",
        key: 'roleType',
        required: true,
        keywords: ["role", "jobRole", "position", "title", "responsibility"],
        description: t("importUserKeywords.user_role_description"),
    },
    {
        header: "Designation",
        key: 'designation',
        required: true,
        keywords: ["designation", "positionTitle", "jobTitle", "rank", "officialTitle"],
        description: t("importUserKeywords.user_email_description"),
    }
];

const systemHeaders = keywordsArray.map((item) => item.header);

// Initialize header data when the component is mounted
onMounted(() => {
    try {

        // Map headers and match them with system headers using keywords
        headerData.value = props.headers?.map((header) => {
            let bestMatch = null;
            let systemKey = null;
            let isRequired = false;

            // Iterate through keywords and check for matches
            keywordsArray.forEach(({ header: defaultHeader, keywords, key, required }) => {
                const match = keywords.some((keyword) =>
                    header.toLowerCase().includes(keyword.toLowerCase())
                );
                if (match) {
                    bestMatch = defaultHeader;
                    systemKey = key;
                    isRequired = required;
                }
            });
            return {
                userHeader: header,
                systemHeader: bestMatch || t("headerMapping.no_match_title"),
                systemKey: systemKey || `custom_${header}`,
                isRequired,
                isConfirmed: false,
                isIgnored: false,
                isCustomField: false,
            };
        });

        // Check for duplicate system headers
        findDuplicateSystemHeaders(headerData?.value);
    } catch (error) {
        console.error('Error during onMounted initialization:', error);
    }
});

// Watch for changes in header data and find duplicates when it changes
watch(
    headerData,
    () => {
        findDuplicateSystemHeaders(headerData.value);
    },
    { deep: true }
);

// Function to select system header for a user-defined header
const selectHeader = (val) => {
    try {
        const index = val.index;
        const systemHeader = val.systemHeader;
        headerData.value[index].systemHeader = systemHeader;
        headerData.value[index].systemKey = keywordsArray.find((item) => item.header === systemHeader)?.key;
        findDuplicateSystemHeaders(headerData.value);
    } catch (error) {
        console.error('Error selecting header:', error);
    }
};

// Function to find duplicate system headers and handle ignored headers
function findDuplicateSystemHeaders(headerData) {
    try {
        const headerMap = {};
        const ignoreSet = new Set();
        const duplicates = {};

        // First pass: populate the headerMap
        headerData.forEach(({ userHeader, systemHeader, isIgnored }) => {
            if (!headerMap[systemHeader]) {
                headerMap[systemHeader] = [];
            }
            headerMap[systemHeader].push({ userHeader, isIgnored });
        });

        // Identify systemHeaders to ignore
        for (const [systemHeader, entries] of Object.entries(headerMap)) {
            const falseCount = entries.filter((entry) => !entry.isIgnored).length;
            if (falseCount === 1) {
                ignoreSet.add(systemHeader);
            }
        }

        // Second pass: Check for duplicates while skipping ignored systemHeaders
        for (const [systemHeader, entries] of Object.entries(headerMap)) {
            if (ignoreSet.has(systemHeader)) continue;

            const userHeaders = entries.map((entry) => entry.userHeader);

            if (userHeaders.length > 1) {
                duplicates[systemHeader] = userHeaders;
            }
        }

        duplicateValues.value = duplicates;
        return duplicates;
    } catch (error) {
        console.error('Error finding duplicate headers:', error);
    }
}

// Function to reset the dropdown and clear selection
const resetDropdown = (index) => {
    try {
        headerData.value[index].systemHeader = t("headerMapping.no_match_title");
        findDuplicateSystemHeaders(headerData.value);
    } catch (error) {
        console.error('Error resetting dropdown:', error);
    }
};

// Toggle the 'isIgnored' status for a header
const toggleIgnoreField = (index) => {
    try {
        headerData.value[index].isIgnored = !headerData.value[index].isIgnored;
        findDuplicateSystemHeaders(headerData.value);
    } catch (error) {
        console.error('Error toggling ignore field:', error);
    }
};

// Toggle the 'isConfirmed' status for a header
const toggleConfirmField = (index) => {
    try {
        headerData.value[index].isConfirmed = !headerData.value[index].isConfirmed;
    } catch (error) {
        console.error('Error toggling confirm field:', error);
    }
};

// Function to fetch the description for a system header
const getDescription = (header) => {
    try {
        const match = keywordsArray.find((item) => item.header === header);
        return match ? match?.description : null;
    } catch (error) {
        console.error('Error fetching description:', error);
        return null;
    }
};

// Function to validate data before proceeding
function validateData() {
    return new Promise((resolve) => {
        try {
            const reqFields = ['Role', 'Designation', 'User Email'];
            // Remove the ignored Fields from headerData first 
            const missingRequiredFields = reqFields
                .map((requiredField) => {
                    // Find the corresponding header in headerData
                    const header = headerData.value.filter(
                        (h) => h.systemHeader === requiredField
                    );

                    if (
                        header.length === 0 ||
                        header.every(header => header.isIgnored) ||
                        header.every(header => !header.isConfirmed)
                    ) {
                        return { systemHeader: requiredField };
                    }
                    return null;
                }).filter(Boolean);

            if (missingRequiredFields.length > 0) {
                // Display error popup for missing required fields
                const missingFieldsList = missingRequiredFields
                    .map((field) => field.systemHeader)
                showAlertModal({
                    type: 'error',
                    title: t("alertBox.missing_fields_title"),
                    message: t("alertBox.missing_fields_text"),
                    fields: missingFieldsList,
                    showCancel: false,
                    confirmButtonText: t("alertBox.ok"),
                }).then(() => {
                    resolve(false);
                });
                return;
            } else {
                // Call the function to create data based on user inputs
                createUserTableData()
                    .then((userTable) => {
                        emit('update-data', { userTable });
                        resolve(true);
                    })
                    .catch((error) => {
                        console.error('Error creating user table data:', error);
                        resolve(false);
                    });
            }
        } catch (error) {
            console.error('Error validating data:', error);
            resolve(false);
        }
    });
}

// Function to create the mapped data for further process based on user inputs
const createUserTableData = () => {
    return new Promise((resolve, reject) => {
        try {
            const userHeaders = headerData.value.reduce((acc, header, index) => {
                acc[index] = header.userHeader;
                return acc;
            }, {});

            const userTable = [
                JSON.parse(JSON.stringify(userHeaders)),
                ...props.tableData.map((row) => ({ ...row })),
            ];

            const headerMap = headerData.value.reduce((map, header, index) => {
                if (header.isConfirmed) {
                    map[header.userHeader] = { systemHeader: header.systemHeader, index, systemKey: header.systemKey };
                }
                return map;
            }, {});

            const confirmedIndexes = [];
            const newHeaders = Object.entries(userTable[0])
                .filter(([index, header]) => {
                    if (headerMap[header]) {
                        confirmedIndexes.push(index);
                        return true;
                    }
                    return false;
                })
                .map(([index, header]) => [index, headerMap[header].systemHeader]);

            userTable[0] = Object.fromEntries(newHeaders);

            const systemKeysRow = Object.fromEntries(
                Object.entries(userTable[0]).map(([index]) => {
                    const userHeader = Object.values(userHeaders)[index];
                    return [index, headerMap[userHeader]?.systemKey || null];
                })
            );

            userTable.splice(1, 0, systemKeysRow);

            for (let i = 2; i < userTable.length; i++) {
                userTable[i] = Object.fromEntries(
                    Object.entries(userTable[i]).filter(([index]) => confirmedIndexes.includes(index))
                );
            }

            const indexedData = userTable.map(item => {
                return Object.values(item).reduce((acc, value, index) => {
                    acc[index] = value;
                    return acc;
                }, {});
            });
            resolve(indexedData);
        } catch (error) {
            console.error('Error creating user table data:', error);
            reject(error);
        }
    });
};

defineExpose({
    validateData,
});
</script>

<style scoped>
.scrollable-container {
    gap: 20px;
}
</style>

<style scoped>
.header-mapping-bg-white {
    background-color: var(--surface);
}
</style>
