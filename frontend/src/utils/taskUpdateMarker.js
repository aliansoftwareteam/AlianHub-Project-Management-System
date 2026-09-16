// getRandomValues rather than randomUUID: the latter is missing on plain-http self-hosted installs.
const bytes = crypto.getRandomValues(new Uint8Array(16));
const TAB_ID = `tab-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;

export const tabUpdateMarker = (timeStamp) => ({ user: TAB_ID, timeStamp });

export const isOwnTabUpdate = (marker) => marker?.user === TAB_ID;
