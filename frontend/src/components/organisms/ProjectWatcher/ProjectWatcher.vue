<template>
    <div>
        <Sidebar
            :title="$t('Members.watchers')"
            :visible="openSidebar"
            @update:visible="$emit('update:openSidebar', !openSidebar)"
        >
            <template #body>
                <div class="pw">
                    <div class="ah-label">{{ $t('Watcher.list_of_watcher') }}</div>
                    <div class="pw__modes">
                        <label
                            v-for="mode in watchModes"
                            :key="mode.value"
                            class="pw__mode"
                            :class="{ 'is-active': watchType === mode.value, 'is-locked': !canChange }"
                        >
                            <input
                                type="radio"
                                name="watch-type"
                                :value="mode.value"
                                :disabled="!canChange"
                                v-model="watchType"
                                @change="changeWatchType()"
                            />
                            <span>{{ $t(mode.label) }}</span>
                        </label>
                    </div>
                    <p v-if="!canChange" class="ah-small pw__note">{{ $t('Members.watch_note') }}</p>

                    <input type="text" v-model="search" class="ah-input" :placeholder="$t('PlaceHolder.search_here')">

                    <div class="pw__list ah-scroll">
                        <template v-if="filterUsers?.length">
                            <TransitionGroup>
                                <div
                                    v-for="user in filterUsers"
                                    :key="user.id"
                                    class="pw__row"
                                    :class="{ 'is-watching': user.watcher }"
                                    @click="addWatchers(user.id, 'add')"
                                >
                                    <UserProfile
                                        width="30px"
                                        :thumbnail="'30x30'"
                                        :showDot="false"
                                        class="pw__avatar"
                                        :data="{ image: getUser(user.id)?.Employee_profileImageURL, title: getUser(user.id)?.Employee_Name }"
                                    />
                                    <div class="pw__who">
                                        <span class="pw__name">{{ getUser(user.id)?.Employee_Name }}</span>
                                        <span class="pw__role">
                                            <template v-if="getUser(user.id)?.companyOwnerId === user.id">{{ $t('Watcher.owner') }}</template>
                                            <template v-else>{{ designations.find((x) => x.key === getUser(user.id)?.designation)?.name }}</template>
                                        </span>
                                    </div>
                                    <span v-if="user.watcher" class="ah-chip ah-chip--brand">{{ $t('Members.watching') }}</span>
                                    <button
                                        v-if="user.id === userId && user?.watcher"
                                        type="button"
                                        class="pw__x"
                                        :aria-label="$t('Members.remove')"
                                        @click.stop="addWatchers(user.id, 'remove')"
                                    >&#215;</button>
                                </div>
                            </TransitionGroup>
                        </template>
                        <p v-else class="ah-empty">{{ $t('Members.no_watchers') }}</p>
                    </div>
                </div>
            </template>
        </Sidebar>
    </div>
</template>

<script setup>
// PACKAGES
import { useStore } from 'vuex';
import { computed, inject, onMounted, ref, watch } from 'vue';
import { useCustomComposable, useGetterFunctions } from '@/composable';
import * as env from '@/config/env';

// COMPONENTS
import Sidebar from "@/components/molecules/Sidebar/Sidebar.vue"
import UserProfile from "@/components/atom/UserProfile/UserProfile.vue"
import { useToast } from 'vue-toast-notification';
import { apiRequest } from '@/services';

// UTILS
const userId = inject("$userId")
const companyId = inject('$companyId');
const {getters,commit} = useStore();
const {getUser} = useGetterFunctions();
const {debounce} = useCustomComposable();
const $toast = useToast();

const watchModes = [
    { value: 'all_activity', label: 'Members.watch_all' },
    { value: 'participating_mentions', label: 'Members.watch_participating' },
    { value: 'ignore', label: 'Members.watch_ignore' },
];

const designations = computed(() => getters["settings/designations"]);
const companyOwnerId = computed(() => getters["settings/companyOwnerDetail"]?.userId);

defineEmits(['update:openSidebar']);

const props = defineProps({
    openSidebar: {
        type: Boolean,
        default: false
    },
    watchers: {
        type: Object,
        default: () => {}
    },
    options: {
        type: Array,
        default: () => []
    },
    includeOwner: {
        type: Boolean,
        default: true
    },
    projectId: {
        type: String,
        required: true
    }
})

const inProcess = ref(false);
const search = ref("");
const watchType = ref('participating_mentions');
const users = ref([]);

watch([() => props.watchers, () => props.options], () => {
    handleWatchers();
})

const filterUsers = ref(users.value);
const canChange = computed(() => filterUsers.value.map((x) => x.id)?.includes(userId.value));


watch([search, users], debounce(() => {
    if(search.value?.trim()) {
        filterUsers.value = users.value?.filter((x) => x.Employee_Name?.trim()?.toLowerCase().includes(search.value?.trim()?.toLowerCase()));
    } else {
        filterUsers.value = users.value;
    }
}), 1000)

function handleWatchers() {
    watchType.value = props.watchers?.[userId.value] || 'participating_mentions';
    let allUsers = JSON.parse(JSON.stringify(props.options)) || [];
    if(props.includeOwner && !allUsers.includes(companyOwnerId.value)) {
        allUsers.push(companyOwnerId.value);
    }
    users.value = [];

    allUsers.forEach((uid) => {
        let obj = {
            ...getUser(uid),
            watcher: false,
        };

        if(Object.keys(props.watchers || {})?.includes(uid)) {
            obj.watcher=true;
        }
        if (!getUser(uid).ghostUser) {
            users.value.push({...obj});
        }
    })
    users.value = users.value.sort((a, b) => 
        (a.Employee_Name?.trim()?.toLowerCase() || "").localeCompare(b.Employee_Name?.trim()?.toLowerCase() || "")
    );
}

function addWatchers(uid, type) {
    if(uid !== userId.value || ((type === "add" && props?.watchers?.[userId.value]) || (type === "remove" && !props?.watchers?.[userId.value]))) return;

    let updateObj = {};
    if(type === "add") {
        updateObj = {[`watchers.${uid}`]: watchType.value}
        updateProject(updateObj, `Watchers ${type === "add" ? 'added' : 'removed'} successfully`);
    } else {
        updateObj = {[`watchers.${uid}`]: 1}
        updateProject(updateObj, `Watchers ${type === "add" ? 'added' : 'removed'} successfully`,{},{},'$unset');
    }
}

function changeWatchType() {
    const user = getUser(userId.value);
    const userData = {
        id: user.id,
        Employee_Name: user.Employee_Name,
        companyOwnerId: user.companyOwnerId
    }
    let historyObj = { 
        key : "Project_Watchers"
    }
    if(watchType.value === 'all_activity'){
        historyObj.message = `<b>${userData.Employee_Name}</b> has watchers activity as a <b>All Activity</b> </b>`
    }else if(watchType.value === 'participating_mentions') {
        historyObj.message = `<b>${userData.Employee_Name}</b> has watchers activity as a <b>Participating and @mentions</b> </b>`
    }else{
        historyObj.message = `<b>${userData.Employee_Name}</b> has watchers activity as a <b>Ignore</b> </b>`
    }
    let updateObj = {[`watchers.${userId.value}`]: watchType.value}
    updateProject(updateObj, `Watch type updated successfully`,historyObj,userData)
}

async function updateProject(updateObj = null, successMessage = '',historyObj = {},userData = {},key = '') {
    if(inProcess.value) return;
    inProcess.value = true;
    if(!updateProject) return;
    let reqbody = {updateObject: updateObj}
    if (key) {
        reqbody.key =  key
    }
    try {
        await apiRequest("put",`/api/v1/${env.PROJECTACTIONS}/${props.projectId}`,reqbody);
        commit('projectData/projectLocalUpdate', {itemData: {watchType: watchType.value},projectId:props.projectId,key:"ProjectWatcher",subKey:key ? key : '$set',userId: userId.value});
        inProcess.value = false;
        if(historyObj && Object.keys(historyObj).length > 0){
            apiRequest("post", env.HANDLE_HISTORY, {
                "type": 'project',
                "companyId": companyId.value,
                "projectId": props.projectId,
                "taskId": null,
                "object": historyObj,
                "userData": userData
            })
        }
        $toast.success(successMessage, {position: "top-right"})
    } catch (error) {
        console.error("Error update project watcher",error);
    }
}

onMounted(() => {
    handleWatchers();
})

</script>

<style scoped>
.pw {
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100%;
    padding: 16px;
    background: var(--surface);
    color: var(--ink);
    font: var(--text-body);
}
.pw__modes { display: flex; flex-direction: column; gap: 4px; }
.pw__mode {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 9px 11px;
    border: 1px solid var(--hairline);
    border-radius: 9px;
    cursor: pointer;
    transition: border-color var(--t-state) var(--ease), background var(--t-state) var(--ease);
}
.pw__mode.is-active { border-color: var(--brand); background: var(--brand-tint); color: var(--brand); font-weight: 600; }
.pw__mode.is-locked { cursor: not-allowed; opacity: .6; }
.pw__mode input { margin: 0; accent-color: var(--brand); }
.pw__note { margin: 0; }

.pw__list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.pw__row {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 9px;
    border-radius: 8px;
    cursor: pointer;
    transition: background var(--t-state) var(--ease);
}
.pw__row:hover { background: var(--surface-hover); }
.pw__avatar { object-fit: cover; border-radius: 50%; flex: none; }
.pw__who { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.pw__name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pw__role { font-size: 11.5px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pw__x {
    border: 0;
    background: transparent;
    color: var(--ink-3);
    font-size: 15px;
    line-height: 1;
    padding: 0 3px;
    cursor: pointer;
}
.pw__x:hover { color: var(--danger); }

.v-enter-active, .v-leave-active { transition: opacity var(--t-state) var(--ease); }
.v-enter-from, .v-leave-to { opacity: 0; }
</style>
