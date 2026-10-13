import { computed } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useGetterFunctions } from "@/composable";
import { ROLE_GUEST, isOwnerOrAdmin } from "@/utils/roles";

const SEAT_ACTIVE = 2;

export function useGoalPeople() {
    const { getters } = useStore();
    const { t } = useI18n();
    const { getUser } = useGetterFunctions();

    const personOf = (id) => {
        const user = id ? getUser(String(id)) : null;
        const name = user?.Employee_Name || t("Goals.someone");
        return { id: String(id || ""), name, image: user?.Employee_profileImageURL || "", initial: (name.trim().charAt(0) || "?").toUpperCase() };
    };

    /* The server refuses a goal shared with, or handed to, anyone without a live seat. */
    const members = computed(() => (getters["settings/companyUsers"] || [])
        .filter((seat) => seat?.userId && seat.isDelete !== true && (seat.status === undefined || seat.status === SEAT_ACTIVE))
        .map((seat) => ({ ...personOf(seat.userId), guest: seat.roleType === ROLE_GUEST }))
        .sort((a, b) => a.name.localeCompare(b.name)));

    const myRole = computed(() => getters["settings/companyUserDetail"]?.roleType);
    const isGuest = computed(() => myRole.value === ROLE_GUEST);
    const isPrivileged = computed(() => isOwnerOrAdmin(myRole.value));

    return { personOf, members, isGuest, isPrivileged };
}
