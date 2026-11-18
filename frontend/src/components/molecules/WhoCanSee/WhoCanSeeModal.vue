<template>
    <Teleport to="body">
        <div v-if="modelValue" class="wcs__back" @click.self="close">
            <div ref="dialog" class="ah-card wcs" role="dialog" aria-modal="true" tabindex="-1" :aria-label="$t('WhoCanSee.title')">
                <div class="ah-card__head wcs__head">
                    <h3 class="ah-h3">{{ $t('WhoCanSee.title') }}</h3>
                    <button type="button" class="wcs__icon" :title="$t('WhoCanSee.close')" :aria-label="$t('WhoCanSee.close')" @click="close">
                        <ShellIcon name="x" :size="15" />
                    </button>
                </div>
                <div class="ah-card__body wcs__body">
                    <p class="wcs__item">
                        <span class="wcs__kind">{{ $t(`WhoCanSee.kind_${kind}`) }}</span>
                        <b>{{ data?.title || title }}</b>
                    </p>

                    <div v-if="loading" class="ah-small wcs__state">{{ $t('WhoCanSee.loading') }}</div>
                    <div v-else-if="failed" class="ah-small wcs__state">{{ $t('WhoCanSee.failed') }}</div>
                    <template v-else-if="data">
                        <p class="ah-small wcs__count">{{ $t('WhoCanSee.people_count', { count: peopleCount }) }}</p>

                        <section v-for="(link, index) in data.links" :key="`link-${index}`" class="wcs__group">
                            <div class="wcs__group-head">
                                <ShellIcon name="globe" :size="16" class="wcs__group-ico" />
                                <div class="wcs__group-copy">
                                    <div class="wcs__group-title">{{ $t(`WhoCanSee.link_${link.kind}`) }}</div>
                                    <div class="ah-small">{{ $t(`WhoCanSee.link_${link.kind}_hint`) }}</div>
                                    <div class="ah-small wcs__meta">
                                        <span v-if="link.fromParent">{{ $t('WhoCanSee.link_from_parent') }}</span>
                                        <span v-if="link.hasPassword">{{ $t('WhoCanSee.link_password') }}</span>
                                        <span v-if="link.expiresAt">{{ $t('WhoCanSee.link_expires', { date: formatDate(link.expiresAt) }) }}</span>
                                    </div>
                                </div>
                                <span class="wcs__can">{{ $t('WhoCanSee.can_view') }}</span>
                            </div>
                        </section>

                        <section v-for="group in data.groups" :key="`${group.reason}-${group.can}`" class="wcs__group">
                            <div class="wcs__group-head">
                                <ShellIcon :name="REASON_ICONS[group.reason] || 'users'" :size="16" class="wcs__group-ico" />
                                <div class="wcs__group-copy">
                                    <div class="wcs__group-title">{{ $t(`WhoCanSee.reason_${group.reason}`) }}</div>
                                    <div class="ah-small">{{ reasonHint(group) }}</div>
                                    <div class="ah-small wcs__meta">{{ $t(`WhoCanSee.can_${kind}_${group.can}`) }}</div>
                                </div>
                                <span class="wcs__can" :class="`is-${group.can}`">{{ $t(`WhoCanSee.can_${group.can}`) }}</span>
                            </div>
                            <ul class="wcs__people">
                                <li v-for="userId in shownPeople(group)" :key="userId" class="wcs__person">
                                    <UserProfile decorative :data="{ title: nameOf(userId), image: getUser(userId)?.Employee_profileImageURL }" width="24px" :showDot="false" :isBorder="false" thumbnail="30x30" />
                                    <span class="wcs__name">{{ nameOf(userId) }}</span>
                                </li>
                            </ul>
                            <button v-if="group.userIds.length > PREVIEW" type="button" class="wcs__more" @click="toggle(group)">
                                {{ expanded[groupKey(group)] ? $t('WhoCanSee.show_fewer') : $t('WhoCanSee.show_all', { count: group.userIds.length }) }}
                            </button>
                        </section>

                        <p class="ah-small wcs__note">{{ $t('WhoCanSee.enforced_note') }}</p>
                    </template>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import { computed, defineEmits, defineProps, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import { useGetterFunctions } from '@/composable';
import { useFocusTrap } from '@/composable/useFocusTrap';
import { useDialogEscape } from '@/composable/useDialogEscape';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import UserProfile from '@/components/atom/UserProfile/UserProfile.vue';

defineOptions({ name: 'WhoCanSeeModal' });

const PREVIEW = 12;
const REASON_ICONS = {
    personal: 'user',
    author: 'lock',
    admin: 'shield',
    sprint_member: 'user',
    sprint_team: 'users',
    member: 'user',
    team: 'users',
    guest: 'eye',
    role: 'key',
    everyone: 'members',
};

const props = defineProps({
    modelValue: { type: Boolean, default: false },
    kind: { type: String, required: true },
    itemId: { type: String, default: '' },
    title: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue']);

const { t } = useI18n();
const { getUser } = useGetterFunctions();

const data = ref(null);
const loading = ref(false);
const failed = ref(false);
const expanded = ref({});
const dialog = ref(null);

const peopleCount = computed(() => (data.value?.groups || []).reduce((sum, group) => sum + group.userIds.length, 0));

const close = () => emit('update:modelValue', false);
const groupKey = (group) => `${group.reason}-${group.can}`;
const toggle = (group) => { expanded.value = { ...expanded.value, [groupKey(group)]: !expanded.value[groupKey(group)] }; };
const shownPeople = (group) => (expanded.value[groupKey(group)] ? group.userIds : group.userIds.slice(0, PREVIEW));
const nameOf = (userId) => getUser(userId)?.Employee_Name || t('WhoCanSee.unknown_person');
const formatDate = (value) => new Date(value).toLocaleDateString();

const reasonHint = (group) => {
    if (group.reason === 'team' || group.reason === 'sprint_team') {
        return t(`WhoCanSee.reason_${group.reason}_hint`, { teams: group.teamNames.join(', ') });
    }
    if (group.reason === 'everyone' || group.reason === 'guest') return t(`WhoCanSee.reason_${group.reason}_${props.kind}_hint`);
    return t(`WhoCanSee.reason_${group.reason}_hint`);
};

function load() {
    data.value = null;
    failed.value = false;
    expanded.value = {};
    if (!props.itemId) return;
    loading.value = true;
    apiRequest('get', `/api/v2/who-can-see/${props.kind}/${props.itemId}`)
        .then((response) => {
            if (response.data?.status) data.value = response.data.data;
            else failed.value = true;
        })
        .catch(() => { failed.value = true; })
        .finally(() => { loading.value = false; });
}

const isOpen = computed(() => props.modelValue);
useFocusTrap(dialog, isOpen);
useDialogEscape(isOpen, close);

watch(() => [props.modelValue, props.kind, props.itemId], ([open]) => {
    if (open) load();
}, { immediate: true });
</script>

<style scoped>
.wcs__back {
    position: fixed; inset: 0; z-index: 1100;
    background: rgba(0, 0, 0, .32);
    display: flex; align-items: flex-start; justify-content: center;
    padding: 72px 16px 16px;
}
.wcs {
    width: 480px; max-width: 100%; max-height: calc(100vh - 96px);
    display: flex; flex-direction: column;
    background: var(--surface); box-shadow: var(--shadow-modal);
}
.wcs:focus { outline: none; }
.wcs__head { flex: none; }
.wcs__body { overflow-y: auto; }
.wcs__icon { background: none; border: 0; padding: 4px; color: var(--ink-2); cursor: pointer; border-radius: var(--r-chip); }
.wcs__icon:hover { color: var(--ink); background: var(--surface-hover); }
.wcs__item { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; min-width: 0; font-size: 13px; color: var(--ink-2); }
.wcs__item b { color: var(--ink); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wcs__kind { flex: none; padding: 1px 7px; border-radius: var(--r-chip); background: var(--surface-2); border: 1px solid var(--hairline); font-size: 11.5px; }
.wcs__state, .wcs__count { margin: 8px 0 4px; }
.wcs__group { padding: 12px 0; border-top: 1px solid var(--hairline); }
.wcs__group-head { display: flex; align-items: flex-start; gap: 11px; }
.wcs__group-ico { flex: none; margin-top: 2px; color: var(--ink-2); }
.wcs__group-copy { flex: 1 1 auto; min-width: 0; }
.wcs__group-title { font-size: 13.5px; font-weight: 500; color: var(--ink); }
.wcs__meta { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 2px; color: var(--ink-2); }
.wcs__can {
    flex: none; padding: 2px 8px; border-radius: var(--r-chip);
    font-size: 11.5px; font-weight: 500; white-space: nowrap;
    background: var(--surface-2); color: var(--ink-2); border: 1px solid var(--hairline);
}
.wcs__can.is-edit { background: var(--brand-tint); color: var(--brand-deep); border-color: var(--brand-border); }
.wcs__can.is-manage { background: var(--ok-bg); color: var(--ok-ink); border-color: transparent; }
.wcs__people { list-style: none; margin: 10px 0 0 27px; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 14px; }
.wcs__person { display: flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; }
.wcs__name { font-size: 12.5px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wcs__more { margin: 8px 0 0 27px; padding: 0; background: none; border: 0; color: var(--brand); font-size: 12.5px; cursor: pointer; }
.wcs__note { margin: 12px 0 0; padding-top: 10px; border-top: 1px solid var(--hairline); color: var(--ink-2); }

@media (max-width: 480px) {
    .wcs__back { padding: 12px; align-items: stretch; }
    .wcs { max-height: none; }
    .wcs__people, .wcs__more { margin-left: 0; }
}
</style>
