<template>
    <div class="mbv">
        <template v-if="canSeeMembers">
            <Teleport v-if="toolbarReady" to="#top_section">
                <span class="ah-mono mbv__seats">{{ $t('MembersV2.seats', { count: activeCount, plan: seatLabel }) }}</span>
                <button v-if="canInvite" type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="inviteOpen = !inviteOpen">
                    <ShellIcon name="plus" :size="14" /> {{ $t('MembersV2.invite') }}
                </button>
            </Teleport>

            <section v-if="canInvite && inviteOpen" class="mbv__invite">
                <div class="mbv__invite-row">
                    <div class="mbv__chips" :class="{ 'is-error': errors.email }" @click="focusEmail">
                        <span v-for="mail in emails" :key="mail" class="ah-chip">
                            {{ mail }}
                            <button type="button" class="mbv__chip-x" :aria-label="$t('MembersV2.remove')" @click.stop="removeEmail(mail)">×</button>
                        </span>
                        <input
                            ref="emailInput"
                            v-model.trim="emailDraft"
                            class="mbv__chip-input"
                            type="email"
                            :placeholder="emails.length ? '' : $t('MembersV2.invite_emails_ph')"
                            @keydown="onEmailKey"
                            @blur="commitEmail()"
                            @input="errors.email = ''"
                        />
                    </div>
                    <select v-model="role" class="ah-input mbv__select" :class="{ 'ah-input--error': errors.role }" :aria-label="$t('MembersV2.invite_role')" @change="onRolePicked">
                        <option :value="null" disabled>{{ $t('MembersV2.invite_role') }}</option>
                        <option v-for="r in inviteRoles" :key="r.key" :value="r.key">{{ r.name }}</option>
                    </select>
                    <select v-model="designation" class="ah-input mbv__select" :class="{ 'ah-input--error': errors.designation }" :aria-label="$t('MembersV2.invite_designation')" @change="errors.designation = ''">
                        <option :value="null" disabled>{{ $t('MembersV2.invite_designation') }}</option>
                        <option v-for="d in designationList" :key="d.key" :value="d.key">{{ d.name }}</option>
                    </select>
                    <button type="button" class="ah-btn ah-btn--primary" :disabled="sending" @click="sendInvites()">
                        {{ sending ? $t('MembersV2.invite_sending') : $t('MembersV2.invite_send') }}
                    </button>
                </div>

                <div v-if="errors.email" class="ah-field__error">{{ errors.email }}</div>
                <div v-else-if="errors.role" class="ah-field__error">{{ errors.role }}</div>
                <div v-else-if="errors.designation" class="ah-field__error">{{ errors.designation }}</div>

                <p class="mbv__meaning">
                    <template v-if="roleMeaning"><strong>{{ roleName(role) }}:</strong> {{ roleMeaning }}</template>
                    <span v-if="lastInviteLink" class="mbv__link-wrap">
                        {{ $t('MembersV2.invite_or_link') }}
                        <button type="button" class="mbv__link" @click="copyLink(lastInviteLink)">{{ shortLink(lastInviteLink) }}</button>
                    </span>
                    <span v-else class="mbv__muted">{{ $t('MembersV2.no_link_yet') }}</span>
                </p>
            </section>

            <div class="mbv__bar">
                <div class="ah-tabs">
                    <button type="button" class="ah-tab" :class="{ 'is-active': tab === 0 }" @click="tab = 0">
                        {{ $t('MembersV2.tab_all') }}<span class="ah-mono mbv__tab-n">{{ activeList.length }}</span>
                    </button>
                    <button type="button" class="ah-tab" :class="{ 'is-active': tab === 1 }" @click="tab = 1">
                        {{ $t('MembersV2.tab_removed') }}<span class="ah-mono mbv__tab-n">{{ removedList.length }}</span>
                    </button>
                </div>
                <div class="mbv__search">
                    <ShellIcon name="search" :size="15" />
                    <input v-model.trim="search" class="mbv__search-input" type="search" :placeholder="$t('MembersV2.search_ph')" />
                </div>
            </div>

            <section class="ah-card mbv__table">
                <div class="mbv__row mbv__row--head" :style="gridStyle">
                    <span class="ah-label">{{ $t('MembersV2.col_person') }}</span>
                    <span class="ah-label">{{ $t('MembersV2.col_role') }}</span>
                    <span v-if="ssoOn" class="ah-label">{{ $t('MembersV2.col_signin') }}</span>
                    <span class="ah-label">{{ $t('MembersV2.col_last_active') }}</span>
                    <span></span>
                </div>

                <div v-for="item in visibleList" :key="item.requestId || item._id" class="mbv__row" :class="{ 'is-pending': item.status !== 2 }" :style="gridStyle">
                    <div class="mbv__person">
                        <img v-if="item.Employee_profileImageURL" class="ah-avatar" :src="item.Employee_profileImageURL" :alt="item.Employee_Name" />
                        <span v-else-if="item.status === 2" class="ah-avatar">{{ initial(item) }}</span>
                        <span v-else class="mbv__avatar-pending" aria-hidden="true"></span>
                        <div class="mbv__person-text">
                            <div class="mbv__name">{{ item.Employee_Name || item.userEmail }}</div>
                            <div v-if="item.status === 2" class="mbv__mail">{{ item.userEmail }}</div>
                            <div v-else class="mbv__mail">
                                {{ $t('MembersV2.invited_on', { date: invitedOn(item) }) }} ·
                                <button type="button" class="mbv__link" @click="resend(item)">{{ $t('MembersV2.resend') }}</button>
                            </div>
                        </div>
                    </div>

                    <div class="mbv__role">
                        <select
                            v-if="canChangeRole(item)"
                            class="mbv__role-select"
                            :value="item.roleType"
                            :aria-label="$t('MembersV2.role_of', { name: item.Employee_Name || item.userEmail })"
                            @change="changeRole(item, Number($event.target.value))"
                        >
                            <option v-for="r in inviteRoles" :key="r.key" :value="r.key">{{ r.name }}</option>
                        </select>
                        <span v-else>{{ roleName(item.roleType) }}</span>
                    </div>

                    <div v-if="ssoOn" class="mbv__signin">
                        <template v-if="item.status === 2">
                            <span class="ah-dot" :class="usesSso(item) ? 'ah-dot--ok' : 'ah-dot--warn'"></span>
                            <span>{{ usesSso(item) ? $t('MembersV2.signin_sso', { name: ssoName }) : $t('MembersV2.signin_password') }}</span>
                        </template>
                        <span v-else class="mbv__muted">—</span>
                    </div>

                    <div class="mbv__seen ah-mono">{{ lastActive(item) }}</div>

                    <div class="mbv__actions">
                        <button
                            v-if="canRemove(item)"
                            type="button"
                            class="ah-btn ah-btn--ghost ah-btn--sm mbv__dots"
                            :aria-label="$t('MembersV2.remove')"
                            @click.stop="menuFor = menuFor === item.requestId ? '' : item.requestId"
                        >
                            <ShellIcon name="dots" :size="16" />
                        </button>
                        <div v-if="menuFor === item.requestId" class="ah-pop mbv__pop" @click.stop>
                            <button v-if="item.status !== 2" type="button" class="ah-pop__item" @click="copyLink(inviteLink(item)), menuFor = ''">
                                <ShellIcon name="link" :size="15" /> {{ $t('MembersV2.copy_link') }}
                            </button>
                            <button v-if="tab === 1" type="button" class="ah-pop__item" @click="resend(item), menuFor = ''">
                                <ShellIcon name="mail" :size="15" /> {{ $t('MembersV2.resend') }}
                            </button>
                            <button v-else type="button" class="ah-pop__item mbv__danger" @click="removeMember(item)">
                                <ShellIcon name="trash" :size="15" /> {{ $t('MembersV2.remove') }}
                            </button>
                        </div>
                    </div>
                </div>

                <div v-if="!visibleList.length" class="ah-empty mbv__empty">
                    {{ search ? $t('MembersV2.empty_search') : $t('MembersV2.empty_all') }}
                </div>
            </section>
        </template>
        <AppState v-else kind="forbidden" />
    </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import Swal from "sweetalert2";
import axios from "axios";
import AppState from "@/components/molecules/AppState/AppState.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useCustomComposable } from "@/composable";
import { apiRequest, apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";
import { memberData } from "./helperMember.js";

defineOptions({ name: "MembersSettings" });

const { t } = useI18n();
const $toast = useToast();
const { getters, commit } = useStore();
const { checkPermission } = useCustomComposable();
const { getCompanyUsers } = memberData();

const companyId = inject("$companyId");
const userId = inject("$userId");

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

const listing = ref([]);
const tab = ref(0);
const search = ref("");
const inviteOpen = ref(false);
const emails = ref([]);
const emailDraft = ref("");
const emailInput = ref(null);
const role = ref(null);
const designation = ref(null);
const sending = ref(false);
const menuFor = ref("");
const lastInviteLink = ref("");
const ssoConfig = ref(null);
const toolbarReady = ref(false);
const errors = reactive({ email: "", role: "", designation: "" });

const canSeeMembers = computed(() => checkPermission("settings.settings_role_management") !== null
    && checkPermission("settings.settings_designation") !== null
    && checkPermission("settings.settings_member_list") === true);
const canInvite = computed(() => checkPermission("settings.settings_invite_member") === true);
const canEditRoles = computed(() => checkPermission("settings.settings_role_management") === true);

const companies = computed(() => getters["settings/companies"] || []);
const currentCompany = computed(() => getters["settings/selectedCompany"] || {});
const company = computed(() => companies.value.find((c) => c._id === companyId.value) || {});
const rolesGetter = computed(() => getters["settings/roles"] || []);
const inviteRoles = computed(() => (getters["settings/withoutOwnerRoles"] || []).filter((r) => !r.isDelete));
const designationList = computed(() => (getters["settings/designations"] || []).filter((d) => !d.isDelete && d.key !== 0));

const activeList = computed(() => listing.value.filter((u) => !u.isDelete));
const removedList = computed(() => listing.value.filter((u) => u.isDelete));
const activeCount = computed(() => activeList.value.length);
const seatLabel = computed(() => {
    const seats = currentCompany.value?.planFeature?.users;
    return typeof seats === "number" && seats > 0 ? String(seats) : t("MembersV2.unlimited");
});

const visibleList = computed(() => {
    const term = search.value.toLowerCase();
    const source = tab.value === 0 ? activeList.value : removedList.value;
    if (!term) return source;
    return source.filter((u) => `${u.Employee_Name || ""} ${u.userEmail || ""}`.toLowerCase().includes(term));
});

const ssoOn = computed(() => !!(ssoConfig.value && ssoConfig.value.isEnabled && (ssoConfig.value.domains || []).length));
const ssoName = computed(() => ssoConfig.value?.displayName || String(ssoConfig.value?.provider || "").toUpperCase());
const gridStyle = computed(() => ({ gridTemplateColumns: ssoOn.value ? "1fr 132px 132px 92px 34px" : "1fr 132px 92px 34px" }));

const roleMeaning = computed(() => ([0, 1, 2, 3].includes(role.value) ? t(`Members.role_desc.${role.value}`) : ""));

function roleName(key) {
    const hit = rolesGetter.value.find((r) => r.key === key);
    return hit ? hit.name : "—";
}

function initial(item) {
    return (item.Employee_Name || item.userEmail || "?").trim().charAt(0).toUpperCase();
}

function invitedOn(item) {
    const raw = item.createdAt || item.updatedAt;
    if (!raw) return "—";
    return new Date(raw).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function lastActive(item) {
    if (item.status !== 2 || item.lastActive === null || item.lastActive === undefined) return "—";
    const minutes = Math.floor((Date.now() - Number(item.lastActive) * 1000) / 60000);
    if (!Number.isFinite(minutes) || minutes < 0) return "—";
    if (minutes < 1) return t("MembersV2.last_active_now");
    if (minutes < 60) return `${minutes}m`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
    return `${Math.floor(minutes / 1440)}d`;
}

function usesSso(item) {
    const domain = String(item.userEmail || "").split("@")[1];
    return !!domain && (ssoConfig.value?.domains || []).includes(domain.toLowerCase());
}

function inviteLink(item) {
    return `${window.location.origin}/#/invitation?companyId=${companyId.value}-${item.requestId}`;
}

function shortLink(link) {
    return link.replace(/^https?:\/\//, "");
}

function onEmailKey(event) {
    if (["Enter", ",", " "].includes(event.key)) {
        event.preventDefault();
        commitEmail();
    }
}

function focusEmail() {
    if (emailInput.value) emailInput.value.focus();
}

function commitEmail() {
    const value = emailDraft.value.replace(/,$/, "").trim().toLowerCase();
    if (!value) return;
    if (!EMAIL_RE.test(value)) {
        errors.email = t("MembersV2.err_email");
        return;
    }
    if (emails.value.includes(value)) {
        errors.email = t("MembersV2.err_duplicate");
        return;
    }
    emails.value.push(value);
    emailDraft.value = "";
    errors.email = "";
}

function removeEmail(mail) {
    emails.value = emails.value.filter((m) => m !== mail);
}

async function onRolePicked() {
    errors.role = "";
    if (role.value !== 0) return;
    const guestLimit = currentCompany.value?.planFeature?.guestUser;
    try {
        const resp = await apiRequest("post", `${env.API_MEMBERS}/count`, { query: { roleType: 0 } });
        const used = resp.data?.[0]?.totalCount || 0;
        if (guestLimit !== undefined && guestLimit !== null && used >= guestLimit) {
            role.value = null;
            $toast.error(t("Toast.You_have_reached_the_maximum_limit_of_guest_users"), { position: "top-right" });
        }
    } catch (error) {
        console.error("ERROR in guest seat check: ", error);
    }
}

async function sendInvites() {
    commitEmail();
    errors.email = emails.value.length ? "" : t("MembersV2.err_email");
    errors.role = role.value === null || role.value === "" ? t("MembersV2.err_role") : "";
    errors.designation = designation.value === null || designation.value === "" ? t("MembersV2.err_designation") : "";
    if (errors.email || errors.role || errors.designation) return;

    sending.value = true;
    for (const mail of [...emails.value]) {
        // eslint-disable-next-line no-await-in-loop
        const allowed = await canInviteAddress(mail);
        // eslint-disable-next-line no-await-in-loop
        if (allowed) await deliverInvite(mail, designation.value, role.value, false);
    }
    listing.value = getCompanyUsers();
    emails.value = [];
    sending.value = false;
}

async function canInviteAddress(mail) {
    try {
        const resp = await apiRequest("post", env.CHECKSENDINVITATION, { companyId: companyId.value, email: mail });
        if (resp.data?.status && resp.data.furtherProceed) return true;
        $toast.warning(resp.data?.statusText || t("Toast.Something_went_wrong_Please_try_again"), { position: "top-right" });
        return false;
    } catch (error) {
        console.error("ERROR in invite pre-check: ", error);
        $toast.error(t("Toast.Something_went_wrong_Please_try_again"), { position: "top-right" });
        return false;
    }
}

async function deliverInvite(mail, userDesignation, userRole, isResend) {
    try {
        const res = await axios.post(`${env.API_URI}${env.SEND_INVITATION_EMAIL}`, {
            companyId: companyId.value,
            companyName: company.value.Cst_CompanyName,
            email: mail,
            designation: userDesignation,
            role: userRole,
            isResend
        });
        if (res.data?.data) {
            const saved = res.data.data;
            commit("settings/mutateCompanyUsers", {
                data: { ...saved, _id: saved._id, isCurrentUser: saved.userId === userId.value, requestId: saved._id },
                op: isResend ? "modified" : "added"
            });
            lastInviteLink.value = `${window.location.origin}/#/invitation?companyId=${companyId.value}-${saved._id}`;
        }
        if (res.data?.status) $toast.success(t(`Members.${res.data.statusText}`), { position: "top-right" });
        else $toast.error(res.data?.statusText || t("Toast.Something_went_wrong_Please_try_again"), { position: "top-right" });
    } catch (error) {
        console.error("ERROR IN SENDING INVITATION", error);
        $toast.error(t("Toast.Something_went_wrong_Please_try_again"), { position: "top-right" });
    }
}

async function resend(item) {
    await deliverInvite(item.userEmail, item.designation || "", item.roleType, true);
    listing.value = getCompanyUsers();
}

function canChangeRole(item) {
    return canEditRoles.value && item.roleType !== 1 && item.status === 2 && !item.isDelete && !item.isCurrentUser;
}

function canRemove(item) {
    return item.roleType !== 1 && !item.isCurrentUser;
}

async function changeRole(item, roleKey) {
    if (item.roleType === roleKey) return;
    try {
        const response = await apiRequest("put", `${env.API_MEMBERS}`, { id: item.requestId, data: { roleType: roleKey } });
        if (!response.data?.status) return;
        if (response.data.data) {
            const saved = response.data.data;
            commit("settings/mutateCompanyUsers", {
                data: { ...saved, _id: saved._id, isCurrentUser: saved.userId === userId.value, requestId: saved._id },
                op: "modified"
            });
        }
        listing.value = listing.value.map((u) => (u.requestId === item.requestId ? { ...u, roleType: roleKey } : u));
        $toast.success(t("Toast.User_role_changed_successfully"), { position: "top-right" });
    } catch (error) {
        console.error("ERROR in change member role: ", error);
    }
}

async function removeMember(item) {
    menuFor.value = "";
    const confirmed = await Swal.fire({
        title: t("conformationmsg.are_you_sure"),
        text: `${t("conformationmsg.Are_you_sure_you_want_to_delete")} ${item.Employee_Name || item.userEmail}?`,
        showCancelButton: true,
        icon: "warning",
        confirmButtonColor: "#2F3990",
        cancelButtonColor: "#c1121f",
        cancelButtonText: t("Home.no"),
        confirmButtonText: t("Home.yes")
    });
    if (!confirmed.value) return;

    if (item.status !== 2) {
        await cancelInvitation(item);
        return;
    }

    try {
        const response = await apiRequest("put", `${env.API_MEMBERS}`, {
            id: item.requestId,
            data: { isDelete: true, isTrackerUser: false }
        });
        if (!response.data?.status) return;
        if (response.data.data) {
            const saved = response.data.data;
            commit("settings/mutateCompanyUsers", {
                data: { ...saved, _id: saved._id, isCurrentUser: saved.userId === userId.value, requestId: saved._id },
                op: "modified"
            });
        }
        const resp = await apiRequestWithoutCompnay("put", env.USER_UPATE, {
            userId: item.userId,
            updateObject: { $pull: { AssignCompany: companyId.value } },
            newObj: { returnDocument: "after" }
        });
        commit("settings/mutateUsers", { data: resp.data.data, op: "modified" });
        await apiRequest("put", `${env.COMPANYACTIONS}`, {
            updateObject: { "companyData.$[elementIndex].users": -1 },
            key: "$inc",
            arrayFilters: [{ "elementIndex.users": { $exists: true } }]
        });
        if (item.isTrackerUser === true) {
            apiRequest("put", `${env.COMPANYACTIONS}`, { updateObject: { trackerUsers: -1 }, key: "$inc" }).catch((e) => console.error(e));
        }
        apiRequest("post", env.REMOVE_USER_NOTIFICATION, { companyId: companyId.value, userId: item.userId })
            .catch((error) => console.error("ERROR in remove-user notification: ", error));
        listing.value = getCompanyUsers();
        $toast.success(t("Toast.User_removed_successfully"), { position: "top-right" });
    } catch (error) {
        console.error("ERROR in remove member: ", error);
    }
}

async function cancelInvitation(item) {
    try {
        const response = await apiRequest("put", `${env.API_MEMBERS}`, { id: item.requestId, data: { status: 3, isDelete: true } });
        if (!response.data?.status) return;
        if (response.data.data) {
            const saved = response.data.data;
            commit("settings/mutateCompanyUsers", {
                data: { ...saved, _id: saved._id, isCurrentUser: saved.userId === userId.value, requestId: saved._id },
                op: "modified"
            });
        }
        apiRequest("put", `${env.COMPANYACTIONS}`, {
            updateObject: { "companyData.$[elementIndex].users": -1 },
            key: "$inc",
            arrayFilters: [{ "elementIndex.users": { $exists: true } }]
        }).catch((error) => console.error("ERROR in seat count: ", error));
        listing.value = getCompanyUsers();
        $toast.success(t("Toast.Invitation_cancelled_successfully"), { position: "top-right" });
    } catch (error) {
        console.error("ERROR in cancel invitation: ", error);
    }
}

async function copyLink(link) {
    try {
        await navigator.clipboard.writeText(link);
        $toast.success(t("MembersV2.copied"), { position: "top-right" });
    } catch (error) {
        console.error("ERROR in copy invite link: ", error);
    }
}

async function loadSso() {
    try {
        const body = (await apiRequest("get", env.SSO_CONFIG))?.data;
        ssoConfig.value = body?.status ? body.data : null;
    } catch (error) {
        ssoConfig.value = null;
    }
}

const closeMenus = () => { menuFor.value = ""; };

watch(() => getters["settings/companyUsers"], () => { listing.value = getCompanyUsers(); }, { deep: true });

onMounted(() => {
    listing.value = getCompanyUsers();
    toolbarReady.value = !!document.getElementById("top_section");
    document.addEventListener("click", closeMenus);
    loadSso();
});

onBeforeUnmount(() => document.removeEventListener("click", closeMenus));
</script>

<style scoped>
@import "./style.css";
</style>
