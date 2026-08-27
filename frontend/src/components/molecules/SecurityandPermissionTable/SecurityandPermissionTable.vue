<template>
    <div class="permissiontable position-re overflow-auto style-scroll" :class="[{'permissiontableMaxheight': from === 'project_rules'},{'permissiontableMaxheightSetting': from === ''}]">
        <table class="table">
            <thead class="position-sti">
                <tr>
                    <th rowspan="2" class="position-sti ActionInSecurity">{{$t('CustomField.action')}}</th>
                    <th v-for="(item, index) in withoutOwnerRoles.filter((x) => x.key !== 2)" :key="index" class="text-center">
                        {{ item.name}}
                    </th>
                </tr>
                <tr>
                    <th v-for="(item, index) in withoutOwnerRoles.filter((x) => x.key !== 2)" :key="index">
                        <div class="read-write-title d-flex justify-content-around">
                            <div v-for="(permission, pIndex) in permissions" :key="index+'sub_heads_none'+pIndex" class="text-center permissionname border-radius-0">{{ $t(`Permissions.${permission.name}`)}}</div>
                        </div>
                    </th>
                </tr>
            </thead>
            <tbody>
                <SecurityPermissionRowCompo
                    v-for="(item, itemIndex) in aiPlanPermission ? filterdRules : filterdRules.filter((x) => x.dependency !== 'artificial_intelligence')"
                    :key="itemIndex"
                    :bIndex="itemIndex"
                    :item="item"
                    :withoutOwnerRoles="withoutOwnerRoles"
                    :permissions="permissions"
                    :advancedPermissionBody="advancedPermissionBody"
                    :changeRule="changeRule"
                    :id="item.name.replaceAll(' ', '_')+item.key"
                    :style="filterdRules[itemIndex+1] && filterdRules[itemIndex+1].isParent ? 'border-bottom: 1px solid #cfcfcf; transition: all 0.3s ease;' : 'transition: all 0.3s ease;' "
                    :planCondition="props.planCondition"
                />
            </tbody>
        </table>
    </div>
</template>

<script setup>
    import SecurityPermissionRowCompo from '@/components/atom/SecurityPermissionRowCompo/SecurityPermissionRowCompo.vue'
    import { computed } from "vue";
    import { useStore } from "vuex";
    import { useI18n } from "vue-i18n";
    const { t, te } = useI18n();

    // The shortlist behind "show only the common ones". Ninety-nine switches is the reason owners
    // give up on this screen. Every section heading is kept so the groups still read as groups,
    // and each listed child's parent is kept too, because a row's enabled state is worked out by
    // looking its dependency up in the same filtered list.
    const COMMON_PERMISSIONS = [
        'project', 'task', 'settings', 'sheet_settings', 'artificial_intelligence', 'chat',
        'project_list', 'project_create', 'project_delete',
        'task_list', 'task_create', 'task_delete', 'task_assignee', 'task_status', 'show_tasks',
        'settings_invite_member', 'settings_member_list', 'settings_security_permissions',
        'user_timesheet',
    ];

    const props = defineProps({
        searchValue: {
            type: String,
        },
        withoutOwnerRoles: {
            type: Array,
        },
        advancedPermissionBody: {
            type: Array,
        },
        changeRule : {
            type: Function,
        },
        from : {
            type:String,
            default : ''
        },
        planCondition : {
            type:Boolean,
            default : false
        },
        showAll : {
            type:Boolean,
            default : true
        }
    })
    const { getters } = useStore();
    const permissions = computed(() => {
        return getters["settings/permissions"];
    })
    const aiPlanPermission = computed(() => getters["settings/selectedCompany"].planFeature?.aiPermission);

    const filterdRules = computed(() => {
        // Search has to match what is on screen, and the row shows the translated name and the
        // translated description rather than the seeded `name` / `desc` fields.
        const needle = String(props.searchValue || '').toLowerCase();
        const localised = (prefix, key) => (te(`${prefix}.${key}`) ? t(`${prefix}.${key}`) : '');
        let tmp = props.advancedPermissionBody.filter((x) => [
            x.name,
            x.desc,
            localised('SecurityAndPermission', x.key),
            localised('PermissionDesc', x.key),
        ].some((field) => String(field || '').toLowerCase().includes(needle)));

        // Searching means the person is looking for something specific, so it always searches the
        // full set rather than only the shortlist.
        if (!props.showAll && !needle) {
            tmp = tmp.filter((x) => COMMON_PERMISSIONS.includes(x.key));
        }

        tmp.forEach((data) => {
            if(!data.isParent) {
                props.withoutOwnerRoles.forEach((hItem) => {
                    let index = data.roles.findIndex((x) => x.key === hItem.key);

                    if(index > -1) {
                        data.roles[index].disabled = tmp.filter((x) => x.key === data.dependency)[0] ? tmp.filter((x) => x.key === data.dependency)[0].roles.filter((y) => y.key === hItem.key)[0] ? tmp.filter((x) => x.key === data.dependency)[0].roles.filter((y) => y.key === hItem.key)[0].permission === null : false : false
                    }
                })
            }
        })

        return tmp;
    });
</script>

<style src="./style.css"></style>