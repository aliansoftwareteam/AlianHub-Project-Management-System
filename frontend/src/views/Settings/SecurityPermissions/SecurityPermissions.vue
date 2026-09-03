<template>
    <SpinnerComp :is-spinner="isSpinner || isSpinnerProject" v-if="isSpinner || isSpinnerProject"/>
    <div v-if="loading" class="sp" :class="{ 'sp--locked': !planAllowed }">
        <div v-if="!planAllowed">
            <UpgradePlan
                :buttonText="$t('Upgrades.upgrade_your_plan')"
                :lastTitle="$t('Upgrades.to_unlock_security')"
                :secondTitle="$t('Upgrades.unlimited')"
                :firstTitle="$t('Upgrades.upgrade_to')"
                :message="$t('Upgrades.the_feature_not_available')"
            />
        </div>
        <template v-if="(companyUser && (companyUser.roleType === 1 || companyUser.roleType === 2)) || checkPermission('settings.settings_security_permissions') !== null">
            <div class="sp__body" :class="{ 'sp__body--locked': !planAllowed }">
                <div class="sp__head">
                    <div>
                        <h1 class="ah-h1">{{ props.from ? $t('Permissions.advanced_permission') : $t('SettingsV2.security_title') }}</h1>
                        <div class="ah-small">{{ $t('SettingsV2.security_subtitle', { permissions: totalRules, objects: totalObjects }) }}</div>
                    </div>
                    <div class="ah-tabs sp__mode" role="tablist">
                        <button type="button" class="ah-tab" :class="{ 'is-active': mode === 'simple' }" role="tab" :aria-selected="mode === 'simple'" @click="mode = 'simple'">{{ $t('SettingsV2.mode_simple') }} · <span class="ah-mono">{{ simpleCount }}</span></button>
                        <button type="button" class="ah-tab" :class="{ 'is-active': mode === 'advanced' }" role="tab" :aria-selected="mode === 'advanced'" @click="mode = 'advanced'">{{ $t('SettingsV2.mode_advanced') }} · <span class="ah-mono">{{ totalRules }}</span></button>
                    </div>
                </div>

                <div v-if="!props.from" class="sp__roles">
                    <div v-for="card in roleCards" :key="card.key" class="ah-card sp__role" :class="{ 'is-highlight': card.key === 3 }">
                        <div class="sp__role-name">{{ card.name }}</div>
                        <div class="ah-small sp__role-desc">{{ card.desc }} {{ $t('SettingsV2.people_count', { n: card.count }) }}</div>
                    </div>
                </div>

                <div class="sp__tools">
                    <input type="search" class="ah-input sp__search" v-model="searchValue" :placeholder="$t('PlaceHolder.search')" :aria-label="$t('PlaceHolder.search')" :disabled="!planAllowed" />
                </div>

                <PermissionMatrix
                    :searchValue="searchValue"
                    :withoutOwnerRoles="withoutOwnerRoles"
                    :advancedPermissionBody="advancedPermissionBody"
                    :changeRule="changeRule"
                    :from="from"
                    :planCondition="planAllowed"
                    :mode="mode"
                    :simpleKeys="SIMPLE_KEYS"
                />

                <div class="sp__foot">
                    <span class="ah-small">{{ $t('SettingsV2.destructive_note') }}</span>
                    <button v-if="checkPermission('settings.settings_security_permissions') === true || props.from" type="button" class="ah-btn ah-btn--primary" :disabled="!planAllowed || isSpinner" @click="updateRules">{{ $t('SettingsV2.save_changes') }}</button>
                </div>
            </div>
        </template>
        <div v-else class="ah-empty">{{ $t('SettingsV2.access_denied') }}</div>
    </div>
</template>

<script setup>
    import { useStore } from "vuex";
    import { useToast } from 'vue-toast-notification';
    import { useCustomComposable } from '@/composable';
    import { ref, computed, watch, onMounted } from "vue";
    import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
    import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
    import PermissionMatrix from '@/components/molecules/Setting/PermissionMatrix.vue';
    import { useI18n } from "vue-i18n";
    const { t } = useI18n();
    import { apiRequest } from "../../../services/index";
    import * as env from '@/config/env';
    defineOptions({ name: "SecurityPermissionsView" });
    const SIMPLE_KEYS = ["project_list", "public_projects", "project_create", "task_create", "task_status", "task_assignee", "task_comment", "task_delete", "project_delete", "user_timesheet", "settings_invite_member"];
    const mode = ref("simple");
    const oldRules = ref([]);
    const loading = ref(true);
    const searchValue = ref("");
    // Opens on the full list, as it always has. The shortlist is one click away for anyone who
    // wants it, but changing what an existing admin sees on load is not worth the surprise.
    const isSpinner = ref(false);
    const showAllTasks = ref(true);
    const showAllProjects = ref(true);
    const advancedPermissionBody = ref([]);
    const allowAdminForPrivateSpace = ref(true);
    //store
    const $toast = useToast();
    const { getters, commit } = useStore();
    const rulesInterval = ref(null);
    const { checkPermission } = useCustomComposable();

    const props = defineProps({
        from:{
            type:String,
            default:''
        },
        projectData:{
            type:Object,
            default:() => {}
        },
        isSpinnerProject:{
            type:Boolean,
        }
    })
    //computed
    const withoutOwnerRoles = computed(() => {
        return getters["settings/withoutOwnerRoles"].filter((x) => !x.isDelete);
    });
    const rawRules = computed(() => {
        if(props?.from === 'project_rules'){
            return getters["settings/projectRawRules"];
        }else{
            return getters["settings/rawRules"];
        }
    });
    const rules = computed(() => {
        if(props?.from === 'project_rules'){
            return getters["settings/projectRules"];
        }else{
            return getters["settings/rules"];
        }
    });
    const currentCompany = computed(() => getters["settings/selectedCompany"])
    const companyUser = ref(getters['settings/companyUserDetail']);
    //watch
    watch(() => rawRules.value, (val) => {
        if (val.length) {
            getRulesData(JSON.parse(JSON.stringify(val)))
        }
    })

    watch(() => rules.value, (val) => {
        if (val.length) {
            getRulesData(JSON.parse(JSON.stringify(val)))
        }
    })

    //onMounted
    onMounted(() => {
        let count = 0;
        isSpinner.value = true;
        loading.value = false;
        rulesInterval.value = setInterval(() => {
            count++;
            if (rawRules.value && Object.keys(rawRules.value).length) {
                clearInterval(rulesInterval.value);
                getRulesData(JSON.parse(JSON.stringify(rawRules.value)));
            } else if (count > 6) {
                clearInterval(rulesInterval.value);
            }
            loading.value = true;
            isSpinner.value = false;
        }, 500);
    })
    
    const getRulesData = (rules) => {
        let bodyData = [];
        let response = rules.map((doc) => ({ ...doc }));

        response.filter((x) => x.isParent).forEach((data) => {
            if (data.key !== "toggle") {
                bodyData = [...bodyData, data, ...response.filter((x) => x.parentId === data._id).sort((a, b) => a.priorityIndex > b.priorityIndex ? 1 : -1)];
            } else {
                allowAdminForPrivateSpace.value = data.allowAdminForPrivateSpace !== undefined ? data.allowAdminForPrivateSpace === false ? false : data.allowAdminForPrivateSpace : true;
                showAllProjects.value = data.showAllProjects !== undefined ? data.showAllProjects === false ? false : data.showAllProjects : true;
                showAllTasks.value = data.showAllTasks !== undefined ? data.showAllTasks === false ? false : data.showAllTasks : true;
            }
        })

        bodyData.forEach((rule) => {
            withoutOwnerRoles.value.forEach((role) => {
                if (!rule.roles.filter((x) => x.key === role.key).length) {
                    changeRule(null, rule, role);
                }
            })
        })


        advancedPermissionBody.value = bodyData;
        oldRules.value = JSON.parse(JSON.stringify(advancedPermissionBody.value));
    };

    const changeRule = (value, rule, role) => {
        const highlightRow = (id) => {
            let element = document.getElementById(id);
            if (element) {
                element.classList.toggle("highlightRow");
                setTimeout(() => {
                    element.classList.toggle("highlightRow");
                }, 500);
            }
        };

        if (rule.roles && rule.roles.length) {
            let index = rule.roles.findIndex((x) => x.key === role.key);
            if (index !== -1) {
                rule.roles[index].permission = value;
                highlightRow(`${rule.name.replaceAll(' ', '_')}${rule.key}`);
            } else {
                rule.roles.push({
                    key: role.key,
                    permission: value
                })
            }

            if (rule.isParent) {
                if (value !== null) {
                    rule.roles.filter((y) => y.key === role.key)[0].permission = value;
                } else {
                    advancedPermissionBody.value.filter((x) => x.parentId === rule._id).forEach((subRule) => {
                        changeRule(value, subRule, role);
                    })
                }
            } else {
                advancedPermissionBody.value.filter((x) => x._id === rule.parentId).forEach((parentRule) => {
                    let parentValue = null;
                    if (parentRule.roles.length && parentRule.roles.filter((y) => y.key === role.key).length) {
                        parentValue = parentRule.roles.filter((y) => y.key === role.key)[0].permission

                        if (parentValue === null && value === false) {
                            parentRule.roles.filter((y) => y.key === role.key)[0].permission = value;
                            highlightRow(`${parentRule.name.replaceAll(' ', '_')}${parentRule.key}`);
                        } else if (parentValue === null && value === true) {
                            parentRule.roles.filter((y) => y.key === role.key)[0].permission = value;
                            highlightRow(`${parentRule.name.replaceAll(' ', '_')}${parentRule.key}`);
                        } else if (parentValue === false && value === true) {
                            parentRule.roles.filter((y) => y.key === role.key)[0].permission = value;
                            highlightRow(`${parentRule.name.replaceAll(' ', '_')}${parentRule.key}`);
                        }
                    }
                })
            }
        } else {
            rule.roles.push({
                key: role.key,
                permission: value,
            })
        }
    };

    const maxLimit = computed(() => {
        if(currentCompany.value.planFeature.aiRequest === undefined){
            return 0;
        }
        if(currentCompany.value.planFeature.aiRequest === null){
            return null;
        }else{
           return currentCompany.value.planFeature.aiRequest;
        }
    })

    const minLimit = computed(() => {
        if(currentCompany.value.planFeature.aiRequest === undefined){
            return 0;
        }
        if(currentCompany.value.planFeature.aiRequest === null){
            return -1;
        }else{
           return 0;
        }
    })

    const updateRules = () => {
        if(props?.from ? currentCompany.value?.planFeature?.projectWisePermisson : currentCompany.value?.planFeature?.globalPermison){
            if(props?.from === ''){
                isSpinner.value = true;
                let token = advancedPermissionBody.value.find((x) => x.key === 'per_user_generate_limit');
                let isValid = validatePermissions(token, minLimit.value, maxLimit.value);
                if(isValid){
                    advancedPermissionBody.value.forEach((rule) => {
                        withoutOwnerRoles.value.forEach((role) => {
                            if (!rule.roles.filter((x) => x.key === role.key).length) {
                                changeRule(null, rule, role);
                            }
                        })
                    })

                    let promises = [];

                    let count = 0;
                    advancedPermissionBody.value.forEach((rule) => {
                        let ind = oldRules.value.findIndex((x) => x.key === rule.key);
                        const hasChanges = JSON.stringify(oldRules.value[ind]?.roles) === JSON.stringify(rule.roles);

                        if(hasChanges){
                            return;
                        }

                        if (ind !== -1) {
                            count++;
                            promises.push(
                                apiRequest("put",env.RULES,{
                                    type: "updateOne",
                                    key: "$set",
                                    updateObject:{roles:rule.roles},
                                    id:rule._id
                                }).then(() => {
                                }).catch((error) => {
                                    console.error("error in update rules",error);
                                })
                            );
                        }
                    });
                    Promise.allSettled(promises).then(() => {
                        isSpinner.value = false;
                        if (count > 0) {
                            try {
                                apiRequest("post",env.CACHECLEAR,{cacheKey: 'rule:',isPrefix:true});
                                apiRequest("post",env.CACHECLEAR,{cacheKey: `UserProjectData:`,isPrefix:true});
                            } catch (error) {
                                console.error("Error in cacheClear",error);
                            }
                            $toast.success(t('Toast.Permission_updated_successfully'), { position: 'top-right' });
                        } else {
                            $toast.success(t('Toast.Nothing_to_update'), { position: 'top-right' });
                        }
                    }).catch((error) => {
                        isSpinner.value = false;
                        console.error("ERROR in update permission: ", error);
                        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
                    });
                }else{
                    isSpinner.value = false;
                    $toast.error(t('Toast.Per_User_Generate_Limit_value_is_not_valid'), { position: 'top-right' });
                }
            }else{
                isSpinner.value = true;
                advancedPermissionBody.value.forEach((rule) => {
                    withoutOwnerRoles.value.forEach((role) => {
                        if (!rule.roles.filter((x) => x.key === role.key).length) {
                            changeRule(null, rule, role);
                        }
                    })
                })
        
                let promises = [];
        
                let count = 0;
                advancedPermissionBody.value.forEach((rule) => {
                    let ind = oldRules.value.findIndex((x) => x.key === rule.key);
        
                    if (ind !== -1) {
                        count++;
                        promises.push(
                            apiRequest("put",`${env.PROJECTRULES}/update`,{updateObject: {roles:rule.roles}, key : '$set', id: rule._id, projectId: rule.projectId}).then((res) => {
                                if(res.data){
                                    commit("settings/mutateProjectRules", {
                                        projectId : rule.projectId,
                                        data: {...res.data, _id: res.data._id},
                                        op: "modified",
                                    })
                                }
                            })
                        );
                    }
                });
                Promise.allSettled(promises).then(() => {
                    apiRequest("post",env.CACHECLEAR,{cacheKey: `UserProjectData:`,isPrefix:true});
                    isSpinner.value = false;
                    if (count > 0) {
                        $toast.success(t('Toast.Permission_updated_successfully'), { position: 'top-right' });
                    } else {
                        $toast.success(t('Toast.Nothing_to_update'), { position: 'top-right' });
                    }
                }).catch((error) => {
                    isSpinner.value = false;
                    console.error("ERROR in update permission: ", error);
                    $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
                });
            }
        }
    };

    function validatePermissions(token, minLimit, maxLimit) {
        if (!token) {
            return true;
        }

        for (let x of token.roles) {
            if (typeof x.permission === 'number') {
                if (!Number.isInteger(x.permission)) {
                    return false;
                }
                const permission = parseInt(x.permission.toLocaleString('fullwide', { useGrouping: false }));
                if (maxLimit === null) {
                    if (permission < minLimit || isNaN(permission)) {
                        return false;
                    }
                } else {
                    if (isNaN(permission) || permission > maxLimit || permission < minLimit) {
                        return false;
                    }
                }
            }else if (x.permission !== null && typeof x.permission !== 'boolean') {
                return false;
            }
        }
        return true;
    }
</script>

<style scoped>
@import "./style.css";
</style>