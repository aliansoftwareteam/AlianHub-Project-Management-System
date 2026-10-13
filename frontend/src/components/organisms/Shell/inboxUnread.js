import { computed } from "vue";
import { useStore } from "vuex";

const positive = (value) => Math.max(0, Number(value) || 0);

// The same per-user counters the Inbox watches for new arrivals; mentions are kept apart
// from other notifications on the server, so the unread total is their sum.
export function useInboxUnread() {
    const { getters } = useStore();
    const unread = computed(() => {
        const counts = getters["users/myCounts"]?.data || {};
        return positive(counts.notification_counts) + positive(counts.mention_counts);
    });
    const badge = computed(() => (unread.value > 99 ? "99+" : String(unread.value)));
    return { unread, badge };
}
