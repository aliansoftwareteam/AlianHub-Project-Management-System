import { computed } from "vue";
import { useInboxUnread } from "./inboxUnread";
import { useChatUnread } from "./chatUnread";

const badgeOf = (n) => (n > 99 ? "99+" : String(n));

/* The red counts the navigation shows by place; a place tucked into More lends its count to the More button. */
export function useNavUnread() {
    const inbox = useInboxUnread();
    const chat = useChatUnread();
    const byKey = computed(() => ({
        inbox: { n: inbox.unread.value, label: "Shell.inbox_unread" },
        chat: { n: chat.unread.value, label: "Shell.chat_unread" },
    }));

    const counterOf = (key) => {
        const counter = byKey.value[key];
        return counter && counter.n > 0 ? { ...counter, badge: badgeOf(counter.n) } : null;
    };

    const tuckedCount = (items) => {
        const n = (items || []).reduce((total, item) => total + ((counterOf(item.key) || {}).n || 0), 0);
        return n > 0 ? { n, badge: badgeOf(n) } : null;
    };

    return { counterOf, tuckedCount };
}
