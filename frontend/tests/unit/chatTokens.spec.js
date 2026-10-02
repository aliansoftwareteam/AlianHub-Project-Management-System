/* Chat (the conversation, its right-hand panes, the channel list and the meeting notes page), read
   from the stylesheets: every size follows the look, the classic look still computes the sizes
   it had, and on a phone no control is under the touch floor. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
    ENV, LEGACY_CLASS, LOOKS, classesIn, computed, declarations, declared, fixedFontSizes, hexColours, inkThreeText,
    literalColours, onPhone, px, read, styleOf, templateOf, unsetWithoutFallback, withoutMedia,
} from '../tokenSheets';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const CHAT = 'components/organisms/MainChat/style.css';
const SIDEBAR = 'views/Chat/style.css';
const NOTES = 'views/Chat/CallNotes.vue';
const ASK = 'components/organisms/MainChat/MainChatAsk.vue';
const BODY = 'components/organisms/MainChat/MainChatMessageBody.vue';
const CONVERTED = [CHAT, SIDEBAR, NOTES, ASK, BODY];
const COMPONENTS = ['components/organisms/MainChat', 'views/Chat']
    .flatMap((dir) => fs.readdirSync(path.join(SRC, dir)).filter((name) => name.endsWith('.vue')).map((name) => `${dir}/${name}`));

/* The conversation sets the avatar tokens on its root; the classic look restates them there. */
const own = (selector) => Object.fromEntries(Object.entries(declarations(withoutMedia(styleOf(CHAT)), selector)).filter(([name]) => name.startsWith('--')));
const inChat = (look) => ({ ...ENV[look], ...own('.mc-shell'), ...(look === 'classic' ? own(':root[data-variant="classic"] .mc-shell') : {}) });
const size = (rel, selector, property, look) => px(declared(rel, selector, property), inChat(look));
const text = (rel, selector, property, look) => computed(declared(rel, selector, property), inChat(look));
const phoneSize = (rel, selector, property) => px(onPhone(rel, selector, property), inChat('phone'));

describe('the chat stylesheets', () => {
    it.each(CONVERTED)('%s names no hex colour', (rel) => {
        expect(hexColours(rel)).toEqual([]);
    });

    it.each(CONVERTED)('%s paints from the colour tokens, but for the sheet scrim', (rel) => {
        expect(literalColours(rel, { scrims: ['.mts-backdrop'] })).toEqual([]);
    });

    it.each(CONVERTED)('%s sets no font size a look cannot change', (rel) => {
        expect(fixedFontSizes(rel)).toEqual([]);
    });

    it.each(CONVERTED)('%s reads no token the classic look un-sets without a fallback', (rel) => {
        expect(unsetWithoutFallback(rel)).toEqual([]);
    });

    it.each(CONVERTED)('%s never sets text in --ink-3', (rel) => {
        expect(inkThreeText(rel)).toEqual([]);
    });

    it('no chat component carries a legacy size or colour class', () => {
        expect(COMPONENTS.length).toBeGreaterThan(18);
        COMPONENTS.forEach((rel) => {
            expect(classesIn(templateOf(rel)).filter((name) => LEGACY_CLASS.test(name)), rel).toEqual([]);
        });
    });

    it('the rules of the meeting notes page that nothing used are gone', () => {
        expect(styleOf(SIDEBAR)).not.toMatch(/\.cn-[a-z]/);
        expect(read(NOTES)).not.toMatch(/class="[^"]*\bcn-[a-z]/);
    });

    it('the message menu opens as a themed panel', () => {
        expect(read('components/organisms/MainChat/MainChatMessage.vue')).toMatch(/<DropDown mode="menu" themed /);
    });
});

describe('chat reads the tokens', () => {
    it.each([
        [CHAT, '.mc-shell', '--mc-av', 'var(--avatar-size)'],
        [CHAT, '.mc-shell', '--mc-av-font', 'var(--avatar-font)'],
        [CHAT, '.mc-head', 'height', 'var(--toolbar-h)'],
        [CHAT, '.mc-head', 'padding', '0 var(--page-pad-x, 16px)'],
        [CHAT, '.mc-icon-btn', 'width', 'var(--control-h, 30px)'],
        [CHAT, '.mc-icon-btn', 'height', 'var(--control-h, 30px)'],
        [CHAT, '.mc-av', 'width', 'var(--mc-av, var(--avatar-size))'],
        [CHAT, '.mc-av', 'font-size', 'var(--mc-av-font, var(--avatar-font))'],
        [CHAT, '.mc-msg-gutter', 'width', 'var(--mc-av, var(--avatar-size))'],
        [CHAT, '.mc-skel-b--av', 'width', 'var(--mc-av, var(--avatar-size))'],
        [CHAT, '.mc-msg', 'font-size', 'var(--fs-md, 12.5px)'],
        [CHAT, '.mc-msg', 'padding', 'var(--sp-2) var(--sp-3) var(--sp-1)'],
        [CHAT, '.mc-msg-body', 'line-height', 'var(--lh-body, 1.5)'],
        [CHAT, '.mc-msg-body--card', 'padding', 'var(--card-pad-y, 10px) var(--card-pad-x, 12px)'],
        [CHAT, '.mc-act', 'height', 'var(--control-h-sm, 24px)'],
        [CHAT, '.mc-act--task', 'border-color', 'var(--brand-border)'],
        [CHAT, '.mc-msg .mc-rx .reaction-bar__chip', 'height', 'max(var(--chip-h), var(--hit-min))'],
        [CHAT, '.mc-msg .mc-rx .reaction-bar__chip', 'font', 'var(--fw-strong, 500) var(--chip-font)/1 var(--font-ui)'],
        [CHAT, '.mc-comp-box', 'padding', 'var(--card-pad-y, 10px) var(--card-pad-x, 12px)'],
        [CHAT, '.mc-comp .write-message', 'font', '400 var(--fs-md, 12.5px)/var(--lh-body, 1.5) var(--font-ui)'],
        [CHAT, '.mc-note', 'padding', 'var(--card-pad-y, 10px) var(--card-pad-x, 12px)'],
        [CHAT, '.mc-srch-input', 'height', 'var(--control-h-lg, 36px)'],
        [CHAT, '.mc-thread-foot', 'min-height', 'var(--control-h, 28px)'],
        [CHAT, '.mc-tile--video::after', 'color', 'var(--rail-ink-strong)'],
        [SIDEBAR, '.cs', 'width', 'var(--sidebar-w)'],
        [SIDEBAR, '.cs-top', 'height', 'var(--toolbar-h)'],
        [SIDEBAR, '.cs-row', 'min-height', 'max(var(--hit-min), calc(var(--row-h) - var(--sp-2)))'],
        [SIDEBAR, '.cs-row', 'font', '400 var(--fs-md, 12.5px)/var(--lh-tight, 1.2) var(--font-ui)'],
        [SIDEBAR, '.cs-search', 'height', 'var(--control-h-lg, 34px)'],
        [NOTES, '.cn__body', 'padding', 'var(--page-pad-y, 20px) var(--page-pad-x, 24px)'],
        [NOTES, '.cn__summary', 'padding', 'var(--card-pad-y, 14px) var(--card-pad-x, 16px)'],
    ])('%s: %s { %s } is %s', (rel, selector, property, expected) => {
        expect(declared(rel, selector, property)).toBe(expected);
    });
});

describe('chat in the dense default', () => {
    it('a message is set in the 13px row type, with the 22px avatar', () => {
        expect(text(CHAT, '.mc-msg', 'font-size', 'dense')).toBe('13px');
        expect(text(CHAT, '.mc-msg-body', 'line-height', 'dense')).toBe('1.4');
        expect(text(CHAT, '.mc-msg-time', 'font-size', 'dense')).toBe('11.5px');
        expect(size(CHAT, '.mc-av', 'width', 'dense')).toBe(22);
        expect(text(CHAT, '.mc-av', 'font-size', 'dense')).toBe('10px');
    });

    it('a message row is tighter than it was', () => {
        expect(text(CHAT, '.mc-msg', 'padding', 'dense')).toBe('4px 6px 2px');
        expect(text(CHAT, '.mc-msg', 'gap', 'dense')).toBe('7px');
        expect(text(CHAT, '.mc-msg', 'margin', 'dense')).toBe('0 -6px');
        expect(text(CHAT, '.mc-feed', 'padding', 'dense')).toBe('12px 16px 6px');
    });

    it('the header is as tall as every other toolbar, and its buttons are 26px controls', () => {
        expect(size(CHAT, '.mc-head', 'height', 'dense')).toBe(44);
        expect(size(SIDEBAR, '.cs-top', 'height', 'dense')).toBe(44);
        expect(size(CHAT, '.mc-info-top', 'height', 'dense')).toBe(44);
        expect(size(CHAT, '.mc-icon-btn', 'width', 'dense')).toBe(26);
        expect(size(CHAT, '.mc-head-ai', 'height', 'dense')).toBe(26);
    });

    it('cards are padded 10 by 12', () => {
        ['.mc-msg-body--card', '.mc-comp-box', '.mc-note', '.mc-comp-locked'].forEach((selector) => {
            expect(text(CHAT, selector, 'padding', 'dense'), selector).toBe('10px 12px');
        });
        expect(text(NOTES, '.cn__summary', 'padding', 'dense')).toBe('10px 12px');
        expect(text(NOTES, '.cn__item', 'padding', 'dense')).toBe('10px 12px');
    });

    it('the composer writes in the message type', () => {
        expect(text(CHAT, '.mc-comp .write-message', 'font', 'dense')).toBe('400 13px/1.4 var(--font-ui)');
        expect(text(CHAT, '.mc-comp-ph', 'font', 'dense')).toBe(text(CHAT, '.mc-comp .write-message', 'font', 'dense'));
        expect(size(CHAT, '.mc-tool', 'height', 'dense')).toBe(26);
        expect(size(CHAT, '.mc-send', 'height', 'dense')).toBe(26);
    });

    it('fields are 32px controls', () => {
        expect(size(CHAT, '.mc-srch-input', 'height', 'dense')).toBe(32);
        expect(size(SIDEBAR, '.cs-search', 'height', 'dense')).toBe(32);
    });

    it('a channel row is as tall as a project tree row and set in the row type', () => {
        expect(size(SIDEBAR, '.cs-row', 'min-height', 'dense')).toBe(28);
        expect(text(SIDEBAR, '.cs-row', 'font', 'dense')).toBe('400 13px/1.2 var(--font-ui)');
    });

    it('the thread footer and the reactions sit on the small steps', () => {
        expect(size(CHAT, '.mc-thread-foot', 'min-height', 'dense')).toBe(26);
        expect(text(CHAT, '.mc-thread-foot', 'font', 'dense')).toBe('500 11.5px/1.2 var(--font-ui)');
        expect(text(CHAT, '.mc-msg .mc-rx .reaction-bar__chip', 'font', 'dense')).toBe('500 11px/1 var(--font-ui)');
        expect(size(CHAT, '.mc-av--20', 'width', 'dense')).toBe(18);
    });

    it('radii take the dense steps', () => {
        expect(text(CHAT, '.mc-msg', 'border-radius', 'dense')).toBe('6px');
        expect(text(CHAT, '.mc-comp-box', 'border-radius', 'dense')).toBe('6px');
        expect(text(CHAT, '.mc-act', 'border-radius', 'dense')).toBe('3px');
        expect(text(CHAT, '.mc-icon-btn', 'border-radius', 'dense')).toBe('4px');
    });

    it('nothing puts a density on chat, so a compact view elsewhere does not reach it', () => {
        COMPONENTS.forEach((rel) => expect(read(rel), rel).not.toMatch(/data-density/));
    });
});

describe('chat in the classic look', () => {
    it.each([
        [CHAT, '.mc-head', 'gap', '10px'],
        [CHAT, '.mc-head', 'padding', '0 16px'],
        [CHAT, '.mc-head', 'font-size', '13px'],
        [CHAT, '.mc-head-hash', 'font', '600 15px/1 var(--font-ui)'],
        [CHAT, '.mc-head-name', 'font', '600 13px/1.2 var(--font-ui)'],
        [CHAT, '.mc-head-sub', 'font', '400 11.5px/1.2 var(--font-ui)'],
        [CHAT, '.mc-head-ai', 'height', '30px'],
        [CHAT, '.mc-head-ai', 'padding', '0 8px'],
        [CHAT, '.mc-head-ai', 'border-radius', '7px'],
        [CHAT, '.mc-icon-btn', 'width', '30px'],
        [CHAT, '.mc-icon-btn', 'border-radius', '7px'],
        [CHAT, '.mc-av', 'width', '26px'],
        [CHAT, '.mc-av', 'font-size', '10px'],
        [CHAT, '.mc-av--20', 'width', '20px'],
        [CHAT, '.mc-av--28', 'width', '28px'],
        [CHAT, '.mc-av--34', 'width', '34px'],
        [CHAT, '.mc-av--44', 'width', '44px'],
        [CHAT, '.mc-msg-gutter', 'width', '26px'],
        [CHAT, '.mc-feed', 'padding', '14px 16px 8px'],
        [CHAT, '.mc-older button', 'height', '28px'],
        [CHAT, '.mc-older button', 'font', '500 12px/1 var(--font-ui)'],
        [CHAT, '.mc-day', 'margin', '12px 0 10px'],
        [CHAT, '.mc-day span', 'font', '500 10.5px/1 var(--font-mono)'],
        [CHAT, '.mc-empty', 'padding', '18px'],
        [CHAT, '.mc-empty', 'border-radius', '10px'],
        [CHAT, '.mc-jump', 'height', '30px'],
        [CHAT, '.mc-jump', 'right', '18px'],
        [CHAT, '.mc-msg', 'gap', '9px'],
        [CHAT, '.mc-msg', 'padding', '6px 8px 4px'],
        [CHAT, '.mc-msg', 'margin', '0 -8px'],
        [CHAT, '.mc-msg', 'border-radius', '9px'],
        [CHAT, '.mc-msg', 'font-size', '12.5px'],
        [CHAT, '.mc-msg-stack', 'gap', '3px'],
        [CHAT, '.mc-msg-meta', 'gap', '5px'],
        [CHAT, '.mc-msg-meta', 'line-height', '1.3'],
        [CHAT, '.mc-msg-time', 'font-size', '12px'],
        [CHAT, '.mc-msg-body', 'line-height', '1.5'],
        [CHAT, '.mc-msg-body--card', 'padding', '10px 12px'],
        [CHAT, '.mc-quote', 'padding-left', '9px'],
        [CHAT, '.mc-act', 'height', '24px'],
        [CHAT, '.mc-act', 'padding', '0 8px'],
        [CHAT, '.mc-act', 'border-radius', '6px'],
        [CHAT, '.mc-act', 'font', '500 11px/1 var(--font-ui)'],
        [CHAT, '.mc-msg-tools button', 'width', '26px'],
        [CHAT, '.mc-picker .mc-picker-emoji', 'width', '28px'],
        [CHAT, '.mc-picker .mc-picker-emoji', 'font-size', '16px'],
        [CHAT, '.mc-menu-item', 'font-size', '13px'],
        [CHAT, '.mc-tile', 'border-radius', '9px'],
        [CHAT, '.mc-file', 'padding', '8px 10px'],
        [CHAT, '.mc-file-ic', 'width', '34px'],
        [CHAT, '.mc-file-ic', 'font', '600 9.5px/1 var(--font-mono)'],
        [CHAT, '.mc-note', 'padding', '10px 12px'],
        [CHAT, '.mc-note-play', 'width', '30px'],
        [CHAT, '.mc-note-time', 'font', '500 11px/1 var(--font-mono)'],
        [CHAT, '.mc-comp', 'padding', '10px 16px 8px'],
        [CHAT, '.mc-comp-box', 'padding', '10px 12px'],
        [CHAT, '.mc-comp-box', 'border-radius', '10px'],
        [CHAT, '.mc-comp .write-message', 'font', '400 12.5px/1.5 var(--font-ui)'],
        [CHAT, '.mc-tool', 'height', '26px'],
        [CHAT, '.mc-tool', 'padding', '0 7px'],
        [CHAT, '.mc-tool', 'font', '500 11px/1 var(--font-ui)'],
        [CHAT, '.mc-send', 'height', '28px'],
        [CHAT, '.mc-send', 'padding', '0 10px'],
        [CHAT, '.mc-send', 'border-radius', '7px 0 0 7px'],
        [CHAT, '.mc-comp-hint', 'font-size', '11px'],
        [CHAT, '.mc-rec', 'min-height', '30px'],
        [CHAT, '.mc-info-top', 'padding', '0 10px 0 16px'],
        [CHAT, '.mc-info-body', 'padding', '14px 16px'],
        [CHAT, '.mc-info-body', 'gap', '16px'],
        [CHAT, '.mc-info-name', 'font', '600 14px/1.2 var(--font-ui)'],
        [CHAT, '.mc-info-pin', 'padding', '8px 10px'],
        [CHAT, '.mc-info-pin', 'border-radius', '8px'],
        [CHAT, '.mc-info-doc .mc-file-ic', 'width', '26px'],
        [CHAT, '.mc-srch-box', 'padding', '10px 16px 0'],
        [CHAT, '.mc-srch-input', 'padding', '0 30px 0 10px'],
        [CHAT, '.mc-srch-row', 'padding', '8px'],
        [CHAT, '.mc-srch-file .mc-file-ic', 'width', '24px'],
        [CHAT, '.mc-sum', 'top', '60px'],
        [CHAT, '.mc-sum', 'padding', '12px 14px'],
        [CHAT, '.mc-sum-item', 'padding', '8px 10px'],
        [CHAT, '.mts', 'padding', '16px 18px'],
        [CHAT, '.mts', 'gap', '12px'],
        [CHAT, '.mts-source', 'padding', '8px 10px'],
        [CHAT, '.mc-thread-foot', 'min-height', '28px'],
        [CHAT, '.mc-thread-foot', 'padding', '2px 8px 2px 4px'],
        [CHAT, '.mc-thread-foot', 'font', '500 12px/1.2 var(--font-ui)'],
        [CHAT, '.mc-thread-note', 'padding', '16px'],
        [SIDEBAR, '.cv-back', 'width', '36px'],
        [SIDEBAR, '.cv-back', 'border-radius', '8px'],
        [SIDEBAR, '.cv-busy', 'padding', '24px 20px'],
        [SIDEBAR, '.cv-empty-card', 'padding', '28px 24px'],
        [SIDEBAR, '.cs-top', 'padding', '0 10px 0 16px'],
        [SIDEBAR, '.cs-title', 'font', '600 13.5px/1.2 var(--font-ui)'],
        [SIDEBAR, '.cs-icon', 'width', '28px'],
        [SIDEBAR, '.cs-search', 'margin', '0 10px 8px'],
        [SIDEBAR, '.cs-search-input', 'font', '400 12.5px/1 var(--font-ui)'],
        [SIDEBAR, '.cs-list', 'padding', '4px 10px 16px'],
        [SIDEBAR, '.cs-list', 'gap', '14px'],
        [SIDEBAR, '.cs-cat-name', 'font', '500 11px/1.2 var(--font-ui)'],
        [SIDEBAR, '.cs-cat-name', 'padding', '6px 9px 2px'],
        [SIDEBAR, '.cs-row', 'min-height', '30px'],
        [SIDEBAR, '.cs-row', 'padding', '6px 9px'],
        [SIDEBAR, '.cs-row', 'gap', '7px'],
        [SIDEBAR, '.cs-row', 'border-radius', '7px'],
        [SIDEBAR, '.cs-row', 'font', '400 12.5px/1.2 var(--font-ui)'],
        [SIDEBAR, '.cs-new', 'height', '30px'],
        [SIDEBAR, '.cs-new', 'font', '600 12.5px/1 var(--font-ui)'],
        [SIDEBAR, '.cs-empty', 'font', '400 12px/1.45 var(--font-ui)'],
        [NOTES, '.cn__body', 'padding', '20px 24px'],
        [NOTES, '.cn__summary', 'padding', '14px 16px'],
        [NOTES, '.cn__transcript', 'font', '400 12.5px/1.6 var(--font-mono)'],
        [NOTES, '.cn__item', 'padding', '11px 14px'],
        [NOTES, '.cn__item-title', 'font', '500 13px/1.35 var(--font-ui)'],
    ])('%s: %s { %s } is still %s', (rel, selector, property, former) => {
        expect(text(rel, selector, property, 'classic')).toBe(former);
    });

    /* Both drew a 1px border outside a content-box height of 34px and 32px. */
    it('the two bordered fields are sized by their border box and measure what they did', () => {
        expect(declared(CHAT, '.mc-srch-input', 'box-sizing')).toBe('border-box');
        expect(declared(SIDEBAR, '.cs-search', 'box-sizing')).toBe('border-box');
        expect(size(CHAT, '.mc-srch-input', 'height', 'classic')).toBe(34 + 2);
        expect(size(SIDEBAR, '.cs-search', 'height', 'classic')).toBe(32 + 2);
    });

    it('the header and the sidebar head stay as tall as the classic toolbar', () => {
        expect(size(CHAT, '.mc-head', 'height', 'classic')).toBe(52);
        expect(size(SIDEBAR, '.cs-top', 'height', 'classic')).toBe(52);
    });
});

describe('chat in the other looks', () => {
    it.each([
        ['a', '13px', 24, 30, 52, 34],
        ['c', '14px', 28, 34, 56, 40],
    ])('%s: message type %s, avatar %i, icon button %i, header %i, channel row %i', (look, type, avatar, button, header, row) => {
        expect(text(CHAT, '.mc-msg', 'font-size', look)).toBe(type);
        expect(size(CHAT, '.mc-av', 'width', look)).toBe(avatar);
        expect(size(CHAT, '.mc-icon-btn', 'width', look)).toBe(button);
        expect(size(CHAT, '.mc-head', 'height', look)).toBe(header);
        expect(size(SIDEBAR, '.cs-row', 'min-height', look)).toBe(row);
    });

    it.each(LOOKS)('the gutter of a follow-on message and the skeleton match the avatar in %s', (look) => {
        expect(size(CHAT, '.mc-msg-gutter', 'width', look)).toBe(size(CHAT, '.mc-av', 'width', look));
        expect(size(CHAT, '.mc-skel-b--av', 'width', look)).toBe(size(CHAT, '.mc-av', 'width', look));
    });
});

describe('chat on a phone', () => {
    const FLOOR = px('var(--hit-min)', ENV.phone);

    it('the floor is 40px', () => {
        expect(FLOOR).toBe(40);
    });

    it.each([
        [CHAT, '.mc-icon-btn', 'width'], [CHAT, '.mc-icon-btn', 'height'],
        [CHAT, '.mc-head-ai', 'height'], [CHAT, '.mc-head-ai', 'min-width'],
        [CHAT, '.mc-msg-tools button', 'width'], [CHAT, '.mc-msg-tools button', 'height'],
        [CHAT, '.mc-picker .mc-picker-emoji', 'width'], [CHAT, '.mc-picker .mc-picker-emoji', 'height'],
        [CHAT, '.mc-note-play', 'width'], [CHAT, '.mc-note-play', 'height'],
        [CHAT, '.mc-comp-chip .mc-icon-btn', 'height'],
        [CHAT, '.mc-srch-clear', 'height'], [CHAT, '.mc-srch-unpin', 'height'],
        [CHAT, '.mc-older button', 'height'], [CHAT, '.mc-jump', 'height'], [CHAT, '.mc-srch-input', 'height'],
        [CHAT, '.mc-info-doc', 'min-height'], [CHAT, '.mc-cmd .ah-pop__item', 'min-height'], [CHAT, '.mc-send-menu .ah-pop__item', 'min-height'],
        [CHAT, '.mc-act', 'min-height'], [CHAT, '.mc-thread-foot', 'min-height'],
        [CHAT, '.mc-tool', 'height'], [CHAT, '.mc-send', 'height'], [CHAT, '.mc-send-more', 'height'], [CHAT, '.mc-send-more', 'width'],
        [SIDEBAR, '.cv-back', 'width'], [SIDEBAR, '.cv-back', 'height'],
        [SIDEBAR, '.cs-icon', 'height'], [SIDEBAR, '.cs-icon--sm', 'height'], [SIDEBAR, '.cs-new', 'height'],
        [SIDEBAR, '.cv--mobile .cs-search', 'height'],
    ])('%s: %s { %s } is at the floor', (rel, selector, property) => {
        expect(phoneSize(rel, selector, property)).toBe(FLOOR);
    });

    it('a channel row keeps the 44px it had', () => {
        expect(phoneSize(SIDEBAR, '.cv--mobile .cs-row', 'min-height')).toBe(44);
    });

    it('controls that read the floor directly follow it', () => {
        ['.mc-failed-note button', '.mc-info-more'].forEach((selector) => {
            expect(size(CHAT, selector, 'min-height', 'phone'), selector).toBe(FLOOR);
        });
        expect(size(CHAT, '.mc-msg .mc-rx .reaction-bar__chip', 'height', 'phone')).toBe(FLOOR);
        expect(phoneSize(CHAT, '.mc-msg .mc-rx .reaction-bar__chip', 'min-width')).toBe(FLOOR);
    });

    it('a message that is mine keeps its bubble', () => {
        expect(onPhone(CHAT, '.mc-msg.is-me .mc-msg-body', 'background')).toBe('var(--brand)');
        expect(onPhone(CHAT, '.mc-msg.is-me .mc-msg-body', 'color')).toBe('var(--on-brand)');
    });
});

/* axe's target-size rule (WCAG 2.5.8): a control is at least 24 by 24 px, or its centre is at
   least 12px from the nearest edge of every other control. */
describe('chat controls keep a 24px target on a desktop', () => {
    const FLOOR = 24;

    it.each(LOOKS)('--hit-min is the floor in %s', (look) => {
        expect(px('var(--hit-min)', ENV[look])).toBeGreaterThanOrEqual(FLOOR);
    });

    it.each(LOOKS)('icon buttons, message tools and composer tools are full targets in %s', (look) => {
        [
            [CHAT, '.mc-icon-btn', 'width'], [CHAT, '.mc-icon-btn', 'height'], [CHAT, '.mc-head-ai', 'height'],
            [CHAT, '.mc-msg-tools button', 'width'], [CHAT, '.mc-msg-tools button', 'height'],
            [CHAT, '.mc-picker .mc-picker-emoji', 'width'], [CHAT, '.mc-act', 'height'],
            [CHAT, '.mc-tool', 'height'], [CHAT, '.mc-tool', 'min-width'], [CHAT, '.mc-send', 'height'],
            [CHAT, '.mc-send-more', 'width'], [CHAT, '.mc-send-more', 'height'],
            [CHAT, '.mc-older button', 'height'], [CHAT, '.mc-jump', 'height'], [CHAT, '.mc-note-play', 'width'],
            [CHAT, '.mc-thread-foot', 'min-height'], [CHAT, '.mc-failed-note button', 'min-height'], [CHAT, '.mc-info-more', 'min-height'],
            [CHAT, '.mc-comp-chip .mc-icon-btn', 'width'], [CHAT, '.mc-srch-clear', 'width'], [CHAT, '.mc-srch-unpin', 'width'],
            [CHAT, '.mc-msg .mc-rx .reaction-bar__chip', 'height'],
            [SIDEBAR, '.cs-icon', 'width'], [SIDEBAR, '.cs-icon--sm', 'width'], [SIDEBAR, '.cs-icon--sm', 'height'],
            [SIDEBAR, '.cs-row', 'min-height'], [SIDEBAR, '.cs-new', 'height'],
        ].forEach(([rel, selector, property]) => {
            expect(size(rel, selector, property, look), `${selector} ${property}`).toBeGreaterThanOrEqual(FLOOR);
        });
    });

    it.each(LOOKS)('the clear button fits inside the search field in %s', (look) => {
        const field = size(CHAT, '.mc-srch-input', 'height', look);
        const clear = size(CHAT, '.mc-srch-clear', 'height', look);
        expect(clear).toBeLessThanOrEqual(field);
        expect(size(CHAT, '.mc-srch-clear', 'top', look)).toBe(px('var(--sp-4)', ENV[look]) + (field - clear) / 2);
        expect(parseFloat(text(CHAT, '.mc-srch-input', 'padding', look).split(' ')[1])).toBeGreaterThanOrEqual(clear);
    });
});

/* The project's Comments tab and the task panel share an older feed. What #1284 left in it on
   fixed colours: the jump button, media borders, the recording bar, the attach sheet and the menu. */
describe('the comment feed inside a project follows the theme', () => {
    const FEED = 'views/Projects/Comments/Comments.vue';
    const FEED_CSS = 'views/Projects/Comments/style.css';
    const MESSAGE = 'components/organisms/Comment/Comment.vue';
    const MESSAGE_CSS = 'components/organisms/Comment/style.css';
    const SHEET = 'components/molecules/MediaConfirmation/MediaConfirmation.vue';
    const feed = templateOf(FEED);
    const tagWith = (template, hook) => (template.match(new RegExp(`<[a-zA-Z]+\\b[^>]*\\b${hook}\\b[^>]*>`, 'g')) || []);

    it.each([FEED_CSS, MESSAGE_CSS, SHEET])('%s names no hex colour', (rel) => {
        expect(hexColours(rel)).toEqual([]);
    });

    it('the jump button is a theme surface with a masked arrow and a name', () => {
        expect(declared(FEED_CSS, '.scroll-bottom-btn', 'background')).toBe('var(--surface)');
        expect(declared(FEED_CSS, '.scroll-bottom-btn', 'border')).toBe('1px solid var(--border)');
        expect(declared(FEED_CSS, '.scroll-bottom-btn', 'color')).toBe('var(--ink-2)');
        const [button] = tagWith(feed, 'scroll-bottom-btn');
        expect(button).not.toMatch(/bg-light-blue/);
        expect(button).toMatch(/:aria-label="\$t\('MainChat\.jump_latest'\)"/);
        expect(feed).toMatch(/<span class="ah-mask-icon" :style="maskOf\(downArrow\)"><\/span>/);
        expect(feed).not.toMatch(/<img :src="downArrow"/);
        expect(read('locales/en.js')).toMatch(/jump_latest: "/);
    });

    it('the recording bar fills in the ok colour over the track', () => {
        const segments = tagWith(feed, 'record__progress');
        expect(segments).toHaveLength(2);
        segments.forEach((segment) => expect(segment).not.toMatch(/\bbg-(green|light-gray)\b/));
        expect(declared(FEED_CSS, '.record__progress--done', 'background')).toBe('var(--ok)');
        expect(declared(FEED_CSS, '.record__progress--left', 'background')).toBe('var(--track)');
    });

    it('a send button that cannot send takes the fill, on either footer', () => {
        expect(declared(FEED_CSS, '.disable__send-button', 'background-color')).toBe('var(--fill) !important');
    });

    it('an image or a clip in a message is outlined in the border token', () => {
        expect(declared(MESSAGE_CSS, '.comment__image', 'border')).toBe('1px solid var(--border)');
        expect(declared(MESSAGE_CSS, '.video_controls', 'border')).toBe('1px solid var(--border)');
    });

    it('the message menu opens as a themed panel', () => {
        expect(read(MESSAGE)).toMatch(/<DropDown mode="menu" themed /);
    });

    it('the attach sheet draws its tiles from tokens', () => {
        const sheet = templateOf(SHEET);
        expect(classesIn(sheet).filter((name) => ['border', 'bg-gray', 'bg-white'].includes(name))).toEqual([]);
        expect(declared(SHEET, '.media__file-value', 'border')).toBe('1px solid var(--border)');
        expect(declared(SHEET, '.media__file-value', 'background')).toBe('var(--surface-2)');
        expect(declared(SHEET, '.media__component-right', 'background')).toBe('var(--fill)');
        expect(declared(SHEET, '.media__component-right', 'color')).toBe('var(--ink-2)');
        expect(sheet).toMatch(/class="ah-mask-icon add__new-image" :style="maskOf\(addNew\)"/);
    });
});
