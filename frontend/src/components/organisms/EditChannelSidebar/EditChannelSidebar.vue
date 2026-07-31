<template>
    <div>
        <Sidebar
            :title="$t('Channel.edit_channel')"
            :visible="visible"
            @update:visible="inProgress ? '' : $emit('update:visible', $event)"
            width="610px;"
        >
            <template #body>
                <div class="bg-light-gray h-100 p-10px">
                    <div class="position-ab d-flex align-items-center justify-content-center z-index-7 w-100 h-100 bg-dark-gray3" v-if="inProgress">
                        <Spinner :isSpinner="true"/>
                    </div>
                    <div class="bg-white border-radius-8-px p-15px webkit-avilable">
                        <!-- CHANNEL NAME -->
                        <div class="d-flex align-items-center">
                            <label class="text-nowrap mr-10px">{{$t('Channel.channel_name')}}<span class="red">*</span></label>
                            <div class="position-re w-100">
                                <input
                                    type="text"
                                    v-model.trim="channelName.value"
                                    :placeholder="$t(`PlaceHolder.enter_channel_name`)"
                                    class="form-control webkit-avilable"
                                    @keyup="checkErrors({
                                        'field': channelName,
                                        'name': channelName.name,
                                        'validations': channelName.rules,
                                        'type': channelName.type,
                                        'event': $event.event
                                    })"
                                >
                                <div class="red position-ab font-size-11 error__text-channelname" v-if="channelName.error">{{channelName.error}}</div>
                            </div>
                        </div>

                        <!-- ICON — same two ways in as the create sidebar: pick a glyph,
                             or upload an image. -->
                        <div>
                            <div class="d-flex white mt-2 justify-content-between">
                                <div class="border position-re border-radius-10-px bg-light-gray d-flex align-items-center justify-content-center mr-10px icons__wrapper-div">
                                    <img v-if="hasIcon" class="position-ab create__channel-remove" @click="clearIcon()" :src="deletered" alt="">
                                    <template v-if="icon?.url">
                                        <!-- A freshly picked file is a data: URL and renders as-is.
                                             An image already on the channel is a STORAGE PATH, so it
                                             has to be signed first — the create sidebar only ever
                                             sees the former and can get away with a plain <img>. -->
                                        <img v-if="isBrowsableUrl" :src="icon.url" alt="" class="border-radius-10-px w-100 h-100 icon__img">
                                        <WasabiImageComp v-else :data="{ url: icon.url }" class="border-radius-10-px w-100 h-100 icon__img"/>
                                    </template>
                                    <FontAwesomeIcon v-else-if="icon?.iconName" :icon="icon" size="xl" class="gray81"/>
                                </div>
                                <div class="w-80">
                                    <span class="black font-weight-bold">{{$t('Channel.icons')}}</span>
                                    <div class="d-flex flex-wrap white overflow-y-scroll style-scroll" style="height: 150px;">
                                        <div
                                            v-for="(item, index) in icons"
                                            :key="index"
                                            class="m-6px"
                                            :class="(icon && item?.iconName === icon?.iconName) ? ['icon_bg border-radius-5-px'] : null"
                                        >
                                            <div class="d-flex justify-content-center align-items-center icon_wrapper" @click="setIcon(item)">
                                                <FontAwesomeIcon :icon="item" size="lg" class="gray81"/>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="text-center mt-10px">
                                <span>{{$t('Channel.or')}}</span>
                                <div class="d-flex align-items-center mt-10px text-nowrap">
                                    <input
                                        type="text"
                                        :placeholder="uploadFileName || $t('Channel.choose_to_upload')"
                                        class="form-control webkit-avilable"
                                        readonly
                                    />
                                    <button class="btn-primary p0x-10px" @click="$refs.fileInputUser.click()">{{$t('Templates.upload')}}</button>
                                    <input
                                        type="file"
                                        ref="fileInputUser"
                                        class="d-none"
                                        name="img"
                                        @change="previewImage"
                                        accept="image/x-png,image/jpeg,image/jpg"
                                    />
                                </div>
                            </div>
                        </div>

                        <!-- MEMBERS
                             Only a private channel has a membership list; a public one is
                             open to the whole company, so editing assignees there would
                             change a value nothing reads. Say so instead of offering a
                             control that does nothing. -->
                        <div class="mt-2">
                            <span class="font-weight-bold d-block">{{$t('Channel.only_share_with')}}</span>
                            <div v-if="isPrivate" class="d-flex align-items-center mt-10px">
                                <Assignee
                                    class="assignee-data"
                                    :users="assigneeUsers"
                                    :options="[...userGetter, ...teams.map((x) => 'tId_'+x._id)]"
                                    :imageWidth="clientWidth > 1024 ? '30px' : '25px'"
                                    :num-of-users="clientWidth > 1024 ? 4 : 2"
                                    @selected="changeAssignee('add', $event)"
                                    @removed="changeAssignee('remove', $event)"
                                    :isDisplayTeam="true"
                                />
                            </div>
                            <span v-else class="d-block font-size-13 mt-5px gray63">{{$t('Channel.public_members_hint')}}</span>
                        </div>

                        <!-- SEND MESSAGE -->
                        <div class="d-flex mt-2">
                            <div class="w-95">
                                <span class="font-weight-bold">{{$t('Channel.send_messages')}}</span>
                                <span class="d-block font-size-13 mt-5px">{{$t('Channel.allowmsg2')}}.</span>
                            </div>
                            <Toggle v-model="sendMessage" width="30" activeColor="#3845B3"/>
                        </div>

                        <div class="d-flex justify-content-end mt-2">
                            <button class="btn-primary" @click="save()">{{$t('MainChat.save')}}</button>
                        </div>
                    </div>
                </div>
            </template>
        </Sidebar>
    </div>
</template>

<script setup>
/**
 * Edit an existing main-chat channel: name, members, and who may post.
 *
 * Writes through the same `PATCH /sprint/:id` + `updateSprint` handler the project
 * sprint list uses, with `mainChat: true` so the project history / folder-cascade
 * side effects stay switched off. One request for all fields rather than one per
 * field, so the channel cannot end up half-updated.
 *
 * The private/public flag is deliberately NOT editable here: flipping it has to move
 * the company's channel quota between its private and public buckets, which is a
 * separate concern from editing a channel.
 */
import { computed, defineProps, defineEmits, inject, ref, watch } from "vue";
import { useStore } from "vuex";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { useValidation } from "@/composable/Validation";
import { useCustomComposable } from "@/composable";
// The memoized registration + lookup, rather than re-adding the icon packs the way
// the create sidebar does at module scope.
import { ensureFaIcons, findFaIcon } from "@/utils/faIcons";
import Sidebar from "@/components/molecules/Sidebar/Sidebar.vue";
import Spinner from "@/components/atom/SpinnerComp/SpinnerComp.vue";
import Toggle from "@/components/atom/Toggle/Toggle.vue";
import Assignee from "@/components/molecules/Assignee/Assignee.vue";
import WasabiImageComp from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
import { storageQueryBuilder } from "@/utils/storageQueryBuild.js";
import * as env from "@/config/env";
import { apiRequest, apiRequestWithoutCompnay } from "@/services";

const props = defineProps({
    visible: { type: Boolean, default: false },
    // The channel (sprint) document being edited.
    channel: { type: Object, default: () => ({}) },
});

const emit = defineEmits(["update:visible", "saved"]);

const { t } = useI18n();
const { getters, commit } = useStore();
const $toast = useToast();
const { checkAllFields, checkErrors } = useValidation();
const { checkBucketStorage } = useCustomComposable();

const projectData = inject("selectedProject");
const companyId = inject("$companyId");
const clientWidth = inject("$clientWidth");

const deletered = require("@/assets/images/svg/deletered.svg");

const teams = computed(() => getters["settings/teams"]);
const userGetter = computed(() => getters["settings/companyUsers"].map((x) => x.userId));

const icons = ensureFaIcons();

const inProgress = ref(false);
const channelName = ref({ error: "", value: "", rules: "required | min: 3", name: "channel name" });
const assigneeUsers = ref([]);
const sendMessage = ref(true);
const icon = ref({});
const uploadFileName = ref("");

const isPrivate = computed(() => !!(props.channel && props.channel.private));
const hasIcon = computed(() => !!(icon.value && (icon.value.url || icon.value.iconName)));
const isBrowsableUrl = computed(() => {
    const url = String((icon.value && icon.value.url) || "");
    return url.startsWith("data:") || url.includes("http");
});

/**
 * Seed the form when the sidebar opens.
 *
 * Keyed on `visible` only, not on the channel: deep-watching the channel would
 * reset the form under the user if the cached sprint changed mid-edit.
 */
watch(() => props.visible, (open) => {
    if (!open) return;
    const channel = props.channel || {};
    channelName.value = { ...channelName.value, value: channel.name || "", error: "" };
    assigneeUsers.value = [...(channel.AssigneeUserId || [])];
    sendMessage.value = channel.sendMessage !== false;
    seedIcon(channel);
}, { immediate: true });

/**
 * Rebuild the editable icon from what is stored on the channel.
 *
 * The create flow spreads the chosen icon onto the sprint, so a glyph arrives back
 * as just `{ type, prefix, iconName }` — the `icon` path array Font Awesome needs to
 * render is stripped before saving. findFaIcon puts the full definition back.
 */
function seedIcon(channel) {
    uploadFileName.value = "";

    if (channel.type === "image" && channel.url) {
        icon.value = { url: channel.url, type: "image" };
        return;
    }

    if (channel.type === "icon" && channel.iconName) {
        const definition = findFaIcon(channel.iconName, channel.prefix);
        icon.value = definition ? { ...definition, type: "icon" } : {};
        return;
    }

    icon.value = {};
}

function setIcon(picked) {
    icon.value = { ...picked, type: "icon" };
    uploadFileName.value = "";
}

function clearIcon() {
    icon.value = {};
    uploadFileName.value = "";
}

function previewImage(event) {
    const files = Array.from(event.target.files || []);
    const file = files[0];
    // Reset the input so re-picking the same file after a remove still fires @change.
    event.target.value = null;
    if (!file) return;

    if (checkBucketStorage(files.map((f) => f?.size), { gettersVal: getters }) !== true) return;

    const extension = String(file.name).split(".").pop().toLowerCase();
    if (!["jpg", "jpeg", "png", "gif"].includes(extension)) {
        $toast.error(t("Toast.Please_select_an_image_file"), { position: "top-right" });
        return;
    }

    const reader = new FileReader();
    reader.onload = (data) => {
        icon.value = { file, url: data.target.result, type: "image" };
    };
    reader.readAsDataURL(file);
    uploadFileName.value = file.name;
}

/** Store a newly picked image where the create flow puts channel icons. */
async function uploadIconFile(file) {
    const randomNumber = parseInt(Date.now() * Math.random());
    let fileName;

    if (env.STORAGE_TYPE && env.STORAGE_TYPE === "server") {
        const originalName = file.name;
        const lastDotIndex = originalName.lastIndexOf(".");
        const namePart = originalName.substring(0, lastDotIndex).replaceAll(" ", "_");
        const extension = originalName.substring(lastDotIndex + 1);
        fileName = `${namePart}_${randomNumber}.${extension}`.replaceAll(/[^a-zA-Z0-9_\-./]/g, "_");
    } else {
        const parts = file.name.split(".");
        fileName = `${parts[0].replaceAll(" ", "_")}_${randomNumber}.${parts[1]}`;
    }

    const projectId = (projectData && projectData.value && projectData.value._id) || (props.channel && props.channel.projectId);
    const formData = new FormData();
    formData.append("path", `chats/${projectId}/channelImages/${fileName}`);
    formData.append("companyId", companyId.value);
    formData.append("file", file);

    const response = await apiRequestWithoutCompnay("post", storageQueryBuilder("upload").route, formData, "form");
    return (response && response.data && response.data.status) ? response.data.statusText : "";
}

/**
 * The icon half of the update.
 *
 * The server SPREADS these fields onto the sprint, so switching kind has to clear
 * the other kind's fields explicitly — otherwise a channel that used to have an
 * uploaded image keeps a stale `url` next to its new glyph. Returns null when an
 * upload failed, so the caller can abort instead of saving a broken icon.
 */
async function buildIconUpdate() {
    const current = { ...(icon.value || {}) };

    if (!current.url && !current.iconName) {
        return { set: {}, unset: { type: "", url: "", iconName: "", prefix: "" } };
    }

    if (current.iconName) {
        return {
            set: { type: "icon", prefix: current.prefix, iconName: current.iconName },
            unset: { url: "" },
        };
    }

    // Only upload when a NEW file was picked; an untouched channel image already has
    // its stored path and re-uploading it would orphan a copy.
    let url = current.url;
    if (current.file) {
        url = await uploadIconFile(current.file);
        if (!url) return null;
    }

    return { set: { type: "image", url }, unset: { iconName: "", prefix: "" } };
}

function changeAssignee(type, event) {
    if (type === "add") {
        if (!assigneeUsers.value.includes(event.id)) assigneeUsers.value.push(event.id);
    } else if (type === "remove") {
        assigneeUsers.value = assigneeUsers.value.filter((x) => x !== event.id);
    }
}

async function save() {
    if (inProgress.value) return;

    const valid = await checkAllFields({ channelName: channelName.value }).catch(() => false);
    if (!valid) return;

    const channel = props.channel || {};
    const id = channel._id || channel.id;
    if (!id) return;

    const set = {
        name: channelName.value.value,
        sendMessage: sendMessage.value,
    };

    // Members only mean anything on a private channel. `watchers` is kept in step
    // with the member list because that is what the create flow writes, and the
    // notification fan-out reads it.
    if (isPrivate.value) {
        set.AssigneeUserId = [...assigneeUsers.value];
        set.watchers = [...assigneeUsers.value];
    }

    inProgress.value = true;
    try {
        const iconUpdate = await buildIconUpdate();
        if (!iconUpdate) {
            $toast.error(t("Toast.something_went_wrong"), { position: "top-right" });
            return;
        }

        const updateObject = { $set: { ...set, ...iconUpdate.set } };
        if (Object.keys(iconUpdate.unset).length) updateObject.$unset = iconUpdate.unset;

        const response = await apiRequest("patch", `${env.SPRINT}/${id}`, {
            companyId: companyId.value,
            projectId: (projectData && projectData.value && projectData.value._id) || channel.projectId,
            folderId: channel.folderId || null,
            type: "updateSprint",
            updateObject,
            mainChat: true,
        });

        if (!response || !response.data || response.data.status !== true) {
            $toast.error((response && response.data && response.data.statusText) || t("Toast.something_went_wrong"), { position: "top-right" });
            return;
        }

        commit("mainChat/mutateChatSprints", { op: "modified", data: response.data.data });
        $toast.success(t("Toast.Channel_updated_successfully"), { position: "top-right" });
        emit("saved", response.data.data);
        emit("update:visible", false);
    } catch (error) {
        console.error("ERROR in update channel: ", error);
        $toast.error(t("Toast.something_went_wrong"), { position: "top-right" });
    } finally {
        inProgress.value = false;
    }
}
</script>

<style scoped>
/* Mirrors the create sidebar's icon-picker sizing (its rules are scoped to that
   component, so they cannot simply be shared). */
.error__text-channelname {
    bottom: -14px;
    left: 0px;
}
.icons__wrapper-div {
    width: 62px;
    height: 62px;
}
.icon__img {
    object-fit: cover;
}
.icon_bg {
    background-color: #ebecf4;
}
.icon_wrapper {
    height: 40px;
    width: 35px;
}
.create__channel-remove {
    right: -6px;
    top: -10px;
    background-color: #ffd6d6;
    padding: 5px;
    border-radius: 5px;
    cursor: pointer;
}
</style>
