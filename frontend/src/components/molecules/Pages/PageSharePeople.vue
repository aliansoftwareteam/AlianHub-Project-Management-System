<template>
    <section class="psp" data-test="doc-share-people">
        <div class="psp__head">
            <ShellIcon name="members" :size="16" class="psp__ico" />
            <div class="psp__copy">
                <div class="psp__label">{{ $t('Docs.share_people') }}</div>
                <div class="ah-small">{{ $t('Docs.share_people_hint') }}</div>
            </div>
            <button type="button" class="ah-btn ah-btn--sm ah-btn--secondary" :aria-expanded="picking" :disabled="busy" data-test="doc-share-add" @click="picking = !picking">
                <ShellIcon name="plus" :size="13" />{{ $t('Docs.share_add_people') }}
            </button>
        </div>

        <p v-if="!people.length" class="ah-small psp__none" data-test="doc-share-none">{{ $t('Docs.share_none') }}</p>
        <ul v-else class="psp__list">
            <li v-for="person in people" :key="person.userId" class="psp__row" data-test="doc-share-person" :data-user="person.userId">
                <span class="ah-avatar ah-avatar--sm" aria-hidden="true">
                    <img v-if="person.image" :src="person.image" alt="" />
                    <template v-else>{{ person.initial }}</template>
                </span>
                <span class="psp__name">{{ person.name }}</span>
                <span v-if="!person.active" class="ah-chip ah-chip--sm ah-chip--warn">{{ $t('Docs.share_inactive') }}</span>
                <select
                    class="ah-input psp__role"
                    :value="person.role"
                    :disabled="busy"
                    :aria-label="$t('Docs.share_role_label', { name: person.name })"
                    data-test="doc-share-role"
                    @change="setRole(person.userId, $event.target.value)"
                >
                    <option value="viewer">{{ $t('Docs.share_role_viewer') }}</option>
                    <option value="editor">{{ $t('Docs.share_role_editor') }}</option>
                </select>
                <button
                    type="button"
                    class="psp__remove"
                    :disabled="busy"
                    :title="$t('Docs.share_remove', { name: person.name })"
                    :aria-label="$t('Docs.share_remove', { name: person.name })"
                    data-test="doc-share-remove"
                    @click="unshare(person.userId)"
                >
                    <ShellIcon name="x" :size="13" />
                </button>
            </li>
        </ul>

        <p v-if="atLimit" class="ah-small psp__none">{{ $t('Docs.share_limit', { n: limit }) }}</p>
        <GoalPeoplePicker v-if="picking" class="psp__picker" :people="choices" :model-value="namedIds" @update:model-value="pick" />
    </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import GoalPeoplePicker from '@/views/Goals/GoalPeoplePicker.vue';
import { useGoalPeople } from '@/views/Goals/useGoalPeople';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

defineOptions({ name: 'PageSharePeople' });

const props = defineProps({
    pageId: { type: String, required: true },
});
const emit = defineEmits(['changed']);

const { t } = useI18n();
const $toast = useToast();
const { personOf, members } = useGoalPeople();

const shares = ref([]);
const limit = ref(0);
const busy = ref(false);
const picking = ref(false);

const people = computed(() => shares.value.map((share) => ({ ...personOf(share.userId), userId: String(share.userId), role: share.role, active: share.active !== false })));
const namedIds = computed(() => shares.value.map((share) => String(share.userId)));
const atLimit = computed(() => limit.value > 0 && shares.value.length >= limit.value);
const choices = computed(() => (atLimit.value ? members.value.filter((person) => namedIds.value.includes(person.id)) : members.value));

const url = (userId) => `${env.PAGES}/${props.pageId}/shares${userId ? `/${userId}` : ''}`;

function take(response) {
    if (!response.data?.status) {
        $toast.error(response.data?.statusText || t('Docs.share_failed'), { position: 'top-right' });
        return;
    }
    shares.value = response.data.data?.people || [];
    limit.value = Number(response.data.data?.limit) || 0;
    emit('changed', shares.value.length);
}

function send(method, userId, body) {
    busy.value = true;
    return apiRequest(method, url(userId), body)
        .then(take)
        .catch(() => $toast.error(t('Docs.share_failed'), { position: 'top-right' }))
        .finally(() => { busy.value = false; });
}

const setRole = (userId, role) => send('put', userId, { role });
const unshare = (userId) => send('delete', userId);

function pick(ids) {
    const added = ids.find((id) => !namedIds.value.includes(id));
    const dropped = namedIds.value.find((id) => !ids.includes(id));
    if (added) return send('put', added, { role: 'viewer' });
    if (dropped) return unshare(dropped);
    return null;
}

onMounted(() => send('get'));
</script>

<style scoped>
.psp { display: flex; flex-direction: column; gap: 8px; padding: 12px 0; border-top: 1px solid var(--hairline); }
.psp__head { display: flex; flex-wrap: wrap; align-items: center; gap: 11px; }
.psp__ico { flex: none; color: var(--ink-2); }
.psp__copy { flex: 1 1 160px; min-width: 0; }
.psp__label { font-size: 13.5px; font-weight: 500; color: var(--ink); }
.psp__none { margin: 0; color: var(--ink-2); }
.psp__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.psp__row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
.psp__name { flex: 1 1 120px; min-width: 0; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ah-input.psp__role { flex: none; width: auto; appearance: auto; }
.psp__remove {
    display: inline-grid; place-items: center; flex: none;
    border: 0; background: none; padding: 4px; border-radius: var(--r-chip);
    color: var(--ink-2); cursor: pointer;
}
.psp__remove:hover:not(:disabled) { color: var(--ink); background: var(--fill); }
.psp__remove:focus-visible { outline: none; box-shadow: var(--focus); }
.psp__picker { border-top: 1px solid var(--hairline); padding-top: 8px; }
</style>
