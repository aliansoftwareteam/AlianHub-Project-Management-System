<template>
    <aside class="cs">
        <div class="cs-top">
            <span class="cs-title">{{ $t('ChatV2.title') }}</span>
            <button
                v-if="canCreateChannel"
                type="button"
                class="cs-icon"
                :title="$t('ChatV2.new_channel')"
                @click="$emit('new-channel')"
            ><ShellIcon name="plus" :size="15" /></button>
        </div>

        <label class="cs-search">
            <ShellIcon name="search" :size="14" />
            <input
                v-model="query"
                type="search"
                class="cs-search-input"
                :placeholder="$t('ChatV2.search')"
                :aria-label="$t('ChatV2.search')"
            />
        </label>

        <div class="cs-list ah-scroll">
            <section class="cs-group">
                <div class="cs-group-head">
                    <span class="ah-label">{{ $t('ChatV2.direct') }}</span>
                    <button
                        v-if="people.length"
                        type="button"
                        class="cs-icon cs-icon--sm"
                        :class="{ 'is-on': showPeople }"
                        :title="$t('ChatV2.new_message')"
                        @click="showPeople = !showPeople"
                    ><ShellIcon name="plus" :size="13" /></button>
                </div>

                <button
                    v-for="chat in visibleDirect"
                    :key="chat.id"
                    type="button"
                    class="cs-row"
                    :class="{ 'is-active': isActive(chat.id), 'has-unread': chat.unread > 0 }"
                    @click="$emit('select', { kind: 'direct', item: chat })"
                >
                    <span class="ah-dot" :class="chat.isDnd ? 'ah-dot--danger' : 'ah-dot--ok'"></span>
                    <span class="cs-row-name">{{ chat.name }}<span v-if="chat.isDnd" class="cs-row-dnd"> · DND</span></span>
                    <span v-if="chat.unread" class="cs-count">{{ chat.unread > 99 ? '99+' : chat.unread }}</span>
                </button>

                <template v-if="showPeople || query.trim()">
                    <button
                        v-for="person in visiblePeople"
                        :key="person.id"
                        type="button"
                        class="cs-row cs-row--muted"
                        :class="{ 'is-active': isActive(person.id) }"
                        @click="$emit('select', { kind: 'person', item: person })"
                    >
                        <span class="ah-dot" :class="person.isDnd ? 'ah-dot--danger' : 'ah-dot--ok'"></span>
                        <span class="cs-row-name">{{ person.name }}</span>
                    </button>
                </template>

                <p v-if="!visibleDirect.length && !visiblePeople.length" class="cs-empty">
                    {{ query.trim() ? $t('ChatV2.no_matches') : $t('ChatV2.no_direct') }}
                </p>
            </section>

            <section v-for="group in visibleGroups" :key="group.project._id" class="cs-group">
                <div class="cs-group-head">
                    <span class="ah-label">{{ groups.length > 1 ? group.project.ProjectName : $t('ChatV2.channels') }}</span>
                </div>

                <template v-for="category in group.categories" :key="category.id">
                    <div v-if="category.channels.length" class="cs-cat">
                        <span v-if="group.categories.length > 1 || group.channels.length" class="cs-cat-name">{{ category.name }}</span>
                        <ChannelRow
                            v-for="channel in category.channels"
                            :key="channel.id"
                            :channel="channel"
                            :active="isActive(channel.id)"
                            @select="$emit('select', { kind: 'channel', item: channel })"
                        />
                    </div>
                </template>

                <ChannelRow
                    v-for="channel in group.channels"
                    :key="channel.id"
                    :channel="channel"
                    :active="isActive(channel.id)"
                    @select="$emit('select', { kind: 'channel', item: channel })"
                />

                <p v-if="!group.all.length" class="cs-empty">
                    {{ query.trim() ? $t('ChatV2.no_matches') : $t('ChatV2.no_channels') }}
                </p>
            </section>

            <button
                v-if="canCreateChannel && groups.length"
                type="button"
                class="cs-new"
                @click="$emit('new-channel')"
            ><ShellIcon name="plus" :size="14" /> {{ $t('ChatV2.new_channel') }}</button>

            <p v-else-if="!groups.length && !loading" class="cs-empty">{{ $t('ChatV2.no_channels') }}</p>
        </div>
    </aside>
</template>

<script setup>
import { computed, defineProps, defineEmits, h, ref } from 'vue';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';

defineOptions({ name: 'ChatSidebar' });

const props = defineProps({
    groups: { type: Array, default: () => [] },
    direct: { type: Array, default: () => [] },
    people: { type: Array, default: () => [] },
    selectedId: { type: String, default: '' },
    canCreateChannel: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
});

defineEmits(['select', 'new-channel']);

const query = ref('');
const showPeople = ref(false);

const term = computed(() => query.value.trim().toLowerCase());
const matches = (name) => !term.value || String(name || '').toLowerCase().includes(term.value);

const isActive = (id) => !!props.selectedId && String(props.selectedId) === String(id);

const visibleDirect = computed(() => props.direct.filter((c) => matches(c.name)));
const visiblePeople = computed(() => props.people.filter((p) => matches(p.name)));

const visibleGroups = computed(() => props.groups.map((group) => {
    const keep = (c) => matches(c.name) || matches(c.folderName);
    const categories = group.categories.map((cat) => ({ ...cat, channels: matches(cat.name) ? cat.channels : cat.channels.filter(keep) }));
    const channels = group.channels.filter(keep);
    return { ...group, categories, channels, all: [...categories.flatMap((c) => c.channels), ...channels] };
}));

const ChannelRow = {
    name: 'ChatSidebarChannelRow',
    props: { channel: { type: Object, required: true }, active: { type: Boolean, default: false } },
    emits: ['select'],
    setup(rowProps, { emit }) {
        return () => h('button', {
            type: 'button',
            class: ['cs-row', { 'is-active': rowProps.active, 'has-unread': rowProps.channel.unread > 0 }],
            title: rowProps.channel.purpose || rowProps.channel.name,
            onClick: () => emit('select'),
        }, [
            h('span', { class: 'cs-hash' }, '#'),
            h('span', { class: 'cs-row-name' }, rowProps.channel.name),
            rowProps.channel.private ? h(ShellIcon, { name: 'lock', size: 11, class: 'cs-lock' }) : null,
            rowProps.channel.unread ? h('span', { class: 'cs-count' }, rowProps.channel.unread > 99 ? '99+' : String(rowProps.channel.unread)) : null,
        ]);
    },
};
</script>
