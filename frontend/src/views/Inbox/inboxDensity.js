import { VIEW_DENSITIES } from '@viewSettings';

export const DENSITY_KEY = 'ah.inbox.density';

const known = (value) => (VIEW_DENSITIES.includes(value) ? value : VIEW_DENSITIES[0]);

export function loadInboxDensity() {
    try {
        return known(window.localStorage.getItem(DENSITY_KEY));
    } catch (e) {
        return VIEW_DENSITIES[0];
    }
}

export function saveInboxDensity(value) {
    const density = known(value);
    try {
        window.localStorage.setItem(DENSITY_KEY, density);
    } catch (e) {
        // Storage can be blocked (private mode): the choice then lasts for this visit only.
    }
    return density;
}
