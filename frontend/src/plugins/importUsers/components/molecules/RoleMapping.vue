<template>
    <div class="d-flex flex-column align-items-center">
        <div class="text-center w-80 m0-auto">
            <h2 class="m-0">{{ $t('roleMapping.title') }}</h2>
            <p class="font-size-14">
                {{ $t('roleMapping.description') }}
            </p>
        </div>
        <div class="d-flex flex-column align-items-center p-10px scrollable style-scroll">
            <div v-for="(role, roleIndex) in uniqueUserRoles" :key="roleIndex"
                class="d-flex align-items-center mb-15px border-bottom-mobiledrop pb-10px">
                <div class="min-width text-center">
                    {{ role }}
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
                                        {{ selectedRole[roleIndex] || $t('valueMapping.status_dropdown_text') }}
                                    </p>
                                    <img :src=dropDownSvg alt="dropDownSvg" class="w-20">
                                </div>
                            </button>
                        </template>
                        <template #options>
                            <DropDownOption>
                                <input type="text" placeholder="Search" v-model="search[roleIndex]"
                                    class="p6px-8px border-gray-blue border-radius-4-px font-size-14" />
                            </DropDownOption>
                            <DropDownOption v-for="(sysRole, sysIndex) in filteredRoles(roleIndex)" :key="sysIndex"
                                :item="sysRole"
                                @click="createRoleMap(roleIndex, sysRole), $refs?.expand_collapse_status[roleIndex]?.click()">
                                <span>{{ sysRole }}</span>
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
import { apiRequest } from "@/services";
import * as env from '@/config/env';
import { ROLE_GUEST } from "@/utils/roles";

const { getters } = useStore();
const dropDownSvg = require("@/assets/images/svg/dropdown_strong.svg");
const { t } = useI18n();

const props = defineProps({
    userTable: {
        type: Array,
        required: true,
    },
});

const systemRolesArray = ref([]);
const uniqueUserRoles = ref([]);
const selectedRole = ref([]);
const roleMapping = ref([]);
const search = ref([]);
const guestCount = ref(0);

const emit = defineEmits(['update-data']);

const currentCompany = computed(() => getters['settings/selectedCompany']);

const rolesGetter = computed(() => {
    return getters['settings/roles'];
});

onMounted(() => {
    systemRolesArray.value = rolesGetter.value.filter(role => !role.isDelete && role.name.toLowerCase() !== 'owner').map(role => role.name);
    getUniqueRoles();
    checkRolePermission();
});

const checkRolePermission = async () => {
    const guestUserLimit = currentCompany.value?.planFeature?.guestUser;

    if(guestUserLimit === null) {
        return;
    }

    let obj = {
        roleType: ROLE_GUEST,
    };

    try {
        const resp = await apiRequest("post", `${env.API_MEMBERS}/count`, { query: obj });

        if (resp.data && resp.data.length > 0) {
            guestCount.value = resp.data[0].totalCount || 0;

            if (guestCount.value >= guestUserLimit) {
                systemRolesArray.value = systemRolesArray.value.filter(
                    role => role.toLowerCase() !== "guests"
                );
            }
        }
    } catch (error) {
        console.error("Error checking role permissions:", error);
    }
}

const getUniqueRoles = () => {
    try {
        const keyMapping = props.userTable[1];
        let roleIndex = Object.keys(keyMapping).find(key => keyMapping[key] === "roleType");

        const roles = props.userTable.slice(2).map(row => row[roleIndex]?.trim()).filter(Boolean);

        uniqueUserRoles.value = [...new Set(roles)];
    } catch (error) {
        console.error(error);
    }
}

const filteredRoles = (index) => {
    const term = search.value[index] || "";
    return systemRolesArray.value.filter((role) =>
        role.toLowerCase().includes(term.toLowerCase())
    );
}

const createRoleMap = (index, selectedSystemRole) => {
    try {
        const userRole = uniqueUserRoles.value[index];
        const mappingIndex = roleMapping.value.findIndex(
            (mapping) => mapping.oldRole === userRole
        );

        if (mappingIndex !== -1) {
            roleMapping.value[mappingIndex].newRole = selectedSystemRole;
        } else {
            roleMapping.value.push({
                oldRole: userRole,
                newRole: selectedSystemRole,
            });
        }
        selectedRole.value[index] = selectedSystemRole;
    } catch (error) {
        console.error("Error in createRoleMap", error);
    }
}

const replaceRole = () => {
    return new Promise((resolve, reject) => {
        try {
            const unmappedRole = uniqueUserRoles.value.filter((role) => !roleMapping.value.some(mapping => mapping.oldRole === role));

            if (unmappedRole.length > 0) {
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

            const keyMapping = props.userTable[1];
            let roleIndex = Object.keys(keyMapping).find(key => keyMapping[key] === "roleType");

            const roleMappedData = props.userTable.map((row, index) => {
                if (index < 2) return row; // Keep headers unchanged

                // Ensure role comparison is case-insensitive and trimmed
                const currentRole = row[roleIndex]?.toLowerCase().trim();
                const roleMappingEntry = roleMapping.value.find(
                    mapping => mapping.oldRole.toLowerCase().trim() === currentRole
                );
                if (roleMappingEntry) {
                    return { ...row, [roleIndex]: roleMappingEntry.newRole };
                }
                return row;
            });
            emit('update-data', { roleMappedData: roleMappedData, guestCount: guestCount.value });
            resolve(true);

        } catch (error) {
            reject(false);
            console.error('Error replacing Role:', error)
        }
    })
}

defineExpose({
    replaceRole
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