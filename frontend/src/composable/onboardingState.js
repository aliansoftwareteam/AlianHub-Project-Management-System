import { reactive } from "vue";
import { apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";

/* What this page has saved since the user list was loaded. The Home checklist and the tour
   read the user record through the store, which is not refetched after each write. */
const written = reactive({ flags: {}, toursOffered: [] });

export const onboardingRecord = (stored = {}) => ({
    ...stored,
    ...written.flags,
    toursOffered: Array.from(new Set([...(stored.toursOffered || []), ...written.toursOffered]))
});

export function saveOnboarding(patch) {
    const { tourOffered, ...flags } = patch;
    Object.assign(written.flags, flags);
    if (tourOffered && !written.toursOffered.includes(tourOffered)) written.toursOffered.push(tourOffered);
    return apiRequestWithoutCompnay("put", env.USER_ONBOARDING, patch)
        .catch((error) => console.error("onboarding save failed", error));
}

export function resetOnboardingRecord() {
    written.flags = {};
    written.toursOffered = [];
}
