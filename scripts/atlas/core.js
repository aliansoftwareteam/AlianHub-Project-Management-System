const { SCREENS } = require('../atlas-manifest');
const { THEMES, fileName } = require('./naming');

const DESKTOP = '1440x900';
const PHONE = '390x844';

const coreScreens = (screens = SCREENS) => screens.filter((screen) => screen.core);

const sizesOf = (screen) => (screen.phone ? [DESKTOP, PHONE] : [DESKTOP]);

const inCore = (screen, size) => Boolean(screen.core) && sizesOf(screen).includes(size);

function coreShots(screens = SCREENS) {
    return coreScreens(screens).flatMap((screen) => sizesOf(screen).flatMap((size) => THEMES.map((theme) => {
        const shot = { screen: screen.name, theme, size };
        return { ...shot, file: fileName(shot) };
    })));
}

module.exports = { DESKTOP, PHONE, coreScreens, sizesOf, inCore, coreShots };
