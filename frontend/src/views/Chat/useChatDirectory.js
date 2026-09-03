import { computed, ref } from 'vue';
import { useStore } from 'vuex';
import { useGetterFunctions, useCustomComposable } from '@/composable';

const ACTIVE = (row) => Number((row && row.deletedStatusKey) || 0) === 0;

/**
 * Everything the chat sidebar lists — direct messages, channels grouped by project and
 * category, people not messaged yet — derived straight from the mainChat store so one
 * sidebar can show all of it at once.
 */
export function useChatDirectory({ projects, userId, canStartDirect }) {
    const { getters, dispatch } = useStore();
    const { getUser } = useGetterFunctions();
    const { changeText } = useCustomComposable();

    const loading = ref(false);
    const loaded = new Set();

    const myCounts = computed(() => (getters['users/myCounts'] && getters['users/myCounts'].data) || {});
    const roleType = computed(() => (getters['settings/companyUserDetail'] || {}).roleType);
    const isAdmin = computed(() => roleType.value === 1 || roleType.value === 2);
    const usersLoaded = computed(() => (getters['users/users'] || []).length > 0);

    function isActiveUser(id) {
        if (!id) return false;
        if (!usersLoaded.value) return true;
        return !((getUser(id) || {}).ghostUser);
    }

    async function loadProject(project) {
        if (!project || loaded.has(project._id)) return;
        loaded.add(project._id);
        const jobs = [];
        if (!getters['mainChat/mainChatSprints'][project._id]) {
            jobs.push(dispatch('mainChat/setChatSprints', { projectId: project._id }));
        }
        if (!project.default && !getters['mainChat/mainChatFolders'][project._id]) {
            jobs.push(dispatch('mainChat/setChatFolders', { projectId: project._id }));
        }
        await Promise.allSettled(jobs);
    }

    async function loadAll() {
        loading.value = true;
        try {
            await Promise.all((projects.value || []).map(loadProject));
        } finally {
            loading.value = false;
        }
    }

    function sprintsOf(projectId) {
        return (getters['mainChat/mainChatSprints'][projectId] || [])
            .filter((s) => String(s.projectId) === String(projectId) && ACTIVE(s));
    }

    function unreadForChannel(sprintId) {
        let total = 0;
        Object.keys(myCounts.value).forEach((key) => {
            if (key.startsWith('task_') && key.endsWith('_comments') && key.includes(`_${sprintId}_`)) {
                total += Number(myCounts.value[key] || 0);
            }
        });
        return total;
    }

    function canSeeChannel(sprint) {
        if (!sprint.private) return true;
        if (isAdmin.value) return true;
        return (sprint.AssigneeUserId || []).includes(userId.value);
    }

    const channelProjects = computed(() => (projects.value || []).filter((p) => !p.default));
    const directProject = computed(() => (projects.value || []).find((p) => p.default) || null);

    /** [{ project, categories: [{ id, name, channels }], channels }] */
    const channelGroups = computed(() => channelProjects.value.map((project) => {
        const folders = (getters['mainChat/mainChatFolders'][project._id] || [])
            .filter((f) => String(f.projectId) === String(project._id) && ACTIVE(f));
        const folderName = {};
        folders.forEach((f) => { folderName[f._id] = f.name; });

        const toChannel = (sprint) => ({
            ...sprint,
            id: sprint._id,
            projectId: project._id,
            folderName: sprint.folderId ? (folderName[sprint.folderId] || '') : '',
            unread: unreadForChannel(sprint._id),
        });

        const channels = sprintsOf(project._id).filter(canSeeChannel).map(toChannel)
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

        const categories = folders.map((f) => ({
            id: f._id,
            name: f.name,
            channels: channels.filter((c) => String(c.folderId || '') === String(f._id)),
        }));
        const loose = channels.filter((c) => !c.folderId || !folderName[c.folderId]);

        return { project, categories, channels: loose, all: channels };
    }));

    const allChannels = computed(() => channelGroups.value.flatMap((g) => g.all));

    function peerIdOf(chat) {
        if (!chat) return '';
        if (chat.receiverId) return String(chat.receiverId);
        return String((chat.AssigneeUserId || []).find((x) => String(x) !== String(userId.value)) || '');
    }

    const directMessages = computed(() => {
        const project = directProject.value;
        if (!project) return [];
        const rows = (getters['mainChat/chats'] && getters['mainChat/chats'].data) || [];
        return rows
            .filter((chat) => String(chat.ProjectID) === String(project._id) && ACTIVE(chat))
            .map((chat) => {
                const peerId = peerIdOf(chat);
                const peer = getUser(peerId) || {};
                return {
                    ...chat,
                    id: chat._id,
                    receiverId: peerId,
                    name: peer.Employee_Name || chat.TaskName || '',
                    image: peer.Employee_profileImageURL || '',
                    isDnd: !!peer.isDnd,
                    preview: chat.message && chat.message !== 'general.message_deleted' ? changeText(String(chat.message), '', '') : '',
                    unread: Number(myCounts.value[`task_${project._id}_${chat.sprintId}_${chat._id}_comments`] || 0),
                };
            })
            .filter((chat) => isActiveUser(chat.receiverId))
            .sort((a, b) => {
                if (a.lastMessage && b.lastMessage) return new Date(b.lastMessage) - new Date(a.lastMessage);
                if (a.lastMessage) return -1;
                if (b.lastMessage) return 1;
                return a.name.localeCompare(b.name);
            });
    });

    /** People without a conversation yet — only offered when the reader may start one. */
    const people = computed(() => {
        if (!canStartDirect.value || !directProject.value) return [];
        const known = new Set(directMessages.value.map((c) => c.receiverId));
        return (getters['users/users'] || [])
            .filter((u) => String(u._id) !== String(userId.value) && !known.has(String(u._id)) && isActiveUser(u._id))
            .map((u) => ({
                id: u._id,
                receiverId: u._id,
                name: u.Employee_Name || '',
                image: u.Employee_profileImageURL || '',
                isDnd: !!u.isDnd,
                newChat: true,
                AssigneeUserId: [u._id],
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    });

    const totalUnread = computed(() => allChannels.value.reduce((n, c) => n + c.unread, 0)
        + directMessages.value.reduce((n, c) => n + c.unread, 0));

    /** The first sprint of the direct-message project — new conversations hang off it. */
    function directSprint() {
        const project = directProject.value;
        if (!project) return null;
        return sprintsOf(project._id)[0] || null;
    }

    function findChannel(id) {
        return allChannels.value.find((c) => String(c.id) === String(id)) || null;
    }

    function findDirect(id) {
        return directMessages.value.find((c) => String(c.id) === String(id)) || null;
    }

    function findPerson(id) {
        return people.value.find((p) => String(p.id) === String(id)) || null;
    }

    return {
        loading,
        loadAll,
        loadProject,
        channelGroups,
        allChannels,
        directMessages,
        people,
        totalUnread,
        directProject,
        channelProjects,
        directSprint,
        findChannel,
        findDirect,
        findPerson,
        sprintsOf,
    };
}
