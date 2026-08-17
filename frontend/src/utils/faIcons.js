// AHE-3834 — Font Awesome registration for chat channel icons.
//
// Previously ChatListItem.vue ran `library.add(far, fab, fas)`, `dom.watch()`,
// and built a ~2000-entry icon array inside `<script setup>` — i.e. ONCE PER
// CONVERSATION ROW. This centralizes it to a single lazy, memoized registration
// shared by every row (and any other chat consumer).

import { library, dom } from "@fortawesome/fontawesome-svg-core";
import { far } from "@fortawesome/free-regular-svg-icons";
import { fab } from "@fortawesome/free-brands-svg-icons";
import { fas } from "@fortawesome/free-solid-svg-icons";

let iconList = null;

// Register the icon packs + build the lookup list exactly once. Cheap no-op on
// every call after the first.
export function ensureFaIcons() {
    if (iconList) return iconList;
    library.add(far, fab, fas);
    dom.watch();
    iconList = [...new Set([
        ...Object.values(far),
        ...Object.values(fab),
        ...Object.values(fas),
    ])];
    return iconList;
}

// Resolve a stored { iconName, prefix } to its Font Awesome icon definition.
export function findFaIcon(iconName, prefix) {
    return ensureFaIcons().find((x) => x.iconName === iconName && x.prefix === prefix);
}
