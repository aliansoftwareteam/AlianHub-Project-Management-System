import { apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";
import { setSingleKeyShortcuts, shortcutPrefs } from "@/composable/shortcuts";

export async function saveSingleKeyShortcuts(userId, on) {
    const previous = shortcutPrefs.singleKeys;
    setSingleKeyShortcuts(on);
    try {
        return await apiRequestWithoutCompnay("put", env.USER_UPATE, {
            userId,
            updateObject: { $set: { "accessibilityPreferences.singleKeyShortcuts": on !== false } },
            newObj: { returnDocument: "after" }
        });
    } catch (error) {
        setSingleKeyShortcuts(previous);
        throw error;
    }
}
