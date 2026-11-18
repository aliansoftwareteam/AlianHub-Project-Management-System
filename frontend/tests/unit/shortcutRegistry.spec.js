import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';

import en from '@/locales/en';
import {
    SHORTCUTS,
    SHORTCUT_GROUPS,
    SHORTCUT_SCOPES,
    ariaKeyShortcuts,
    isEditableTarget,
    isMacPlatform,
    platformKeys,
    setSingleKeyShortcuts,
    shortcutCaps,
    shortcutHint,
    shortcutKey
} from '@/composable/shortcuts';
import { isPaletteShortcut } from '@/components/molecules/AdvanceSearch/paletteKeys';
import KeyHint from '@/components/atom/KeyHint/KeyHint.vue';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const lookup = (key) => key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), en);
const t = (key) => lookup(key);
const entry = (id) => SHORTCUTS.find((s) => s.id === id);

beforeEach(() => setSingleKeyShortcuts(true));
afterEach(() => setSingleKeyShortcuts(true));

describe('the shortcut registry', () => {
    it('gives every shortcut an id, a scope, keys and a label that exists in English', () => {
        const ids = SHORTCUTS.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
        SHORTCUTS.forEach((s) => {
            expect(SHORTCUT_SCOPES, s.id).toContain(s.scope);
            expect(SHORTCUT_GROUPS, s.id).toContain(s.group);
            expect(s.keys.length, s.id).toBeGreaterThan(0);
            expect(typeof lookup(s.label), s.label).toBe('string');
        });
        SHORTCUT_GROUPS.forEach((group) => expect(typeof lookup(`Shortcuts.group_${group}`), group).toBe('string'));
    });

    it('never binds one combination twice in a scope, on either platform', () => {
        [true, false].forEach((mac) => {
            SHORTCUT_SCOPES.forEach((scope) => {
                const combos = SHORTCUTS.filter((s) => s.scope === scope)
                    .map((s) => platformKeys(s, mac).map((step) => step.join('+')).join(' '));
                expect(combos.filter((combo, i) => combos.indexOf(combo) !== i), `${scope} mac=${mac}`).toEqual([]);
            });
        });
    });

    it('lists the keys handled where they live: the palette, the inbox reply and saving a doc', () => {
        const byKeys = Object.fromEntries(SHORTCUTS.map((s) => [s.id, `${s.scope}: ${s.keys.join(' ')}`]));
        expect(byKeys).toMatchObject({
            palette: 'global: mod+k',
            'create-task': 'global: c',
            search: 'global: /',
            help: 'global: ?',
            undo: 'global: mod+z',
            'palette-next': 'palette: ArrowDown',
            'palette-prev': 'palette: ArrowUp',
            'palette-run': 'palette: Enter',
            'palette-new-tab': 'palette: mod+Enter',
            'palette-actions': 'palette: Tab',
            'palette-close': 'palette: Escape',
            'inbox-send-reply': 'inbox: mod+Enter',
            'doc-save': 'docs: mod+s'
        });
    });

    it('writes the modifier as ⌘ on macOS and as Ctrl elsewhere', () => {
        expect(platformKeys(entry('palette'), true)).toEqual([['meta', 'k']]);
        expect(platformKeys(entry('palette'), false)).toEqual([['ctrl', 'k']]);
        expect(shortcutCaps('palette', t, true)).toEqual([['⌘', 'K']]);
        expect(shortcutCaps('palette', t, false)).toEqual([['Ctrl', 'K']]);
        expect(shortcutCaps('go-home', t, true)).toEqual([['G'], ['H']]);
        expect(shortcutCaps('create-another', t, false)).toEqual([['Shift', 'Enter']]);
        expect(shortcutCaps('palette-next', t, false)).toEqual([['↓']]);
        expect(shortcutCaps('nope', t, true)).toEqual([]);
    });

    it('spells a hint for a chip and for aria-keyshortcuts', () => {
        expect(shortcutHint('palette', t, true)).toBe('⌘K');
        expect(shortcutHint('palette', t, false)).toBe('Ctrl+K');
        expect(shortcutHint('create-open', t, true)).toBe('⌘Enter');
        expect(shortcutHint('create-task', t, false)).toBe('C');
        expect(shortcutHint('help', t, true)).toBe('?');
        expect(ariaKeyShortcuts('palette', true)).toBe('Meta+K');
        expect(ariaKeyShortcuts('palette', false)).toBe('Control+K');
        expect(ariaKeyShortcuts('create-task', false)).toBe('C');
    });

    it('shows no hint for a single key once single-key shortcuts are off', () => {
        setSingleKeyShortcuts(false);
        expect(shortcutHint('create-task', t, false)).toBe('');
        expect(shortcutHint('help', t, false)).toBe('');
        expect(ariaKeyShortcuts('create-task', false)).toBeNull();
        expect(shortcutHint('palette', t, false)).toBe('Ctrl+K');
    });

    it('is where the handlers read their key from', () => {
        expect(shortcutKey('palette')).toBe('k');
        expect(shortcutKey('undo')).toBe('z');
        const key = (init) => ({ key: 'k', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target: document.body, ...init });
        expect(isPaletteShortcut(key({ metaKey: true }), { mac: true })).toBe(true);
        expect(isPaletteShortcut(key({ ctrlKey: true }), { mac: false })).toBe(true);
        expect(isPaletteShortcut(key({ key: 'j', metaKey: true }), { mac: true })).toBe(false);
        expect(read('components/molecules/AdvanceSearch/paletteKeys.js')).toContain("shortcutKey('palette')");
        expect(read('components/molecules/UndoToast/UndoToast.vue')).toContain('shortcutKey("undo")');
    });

    it('knows a Mac from its platform string', () => {
        expect(isMacPlatform({ platform: 'MacIntel' })).toBe(true);
        expect(isMacPlatform({ userAgentData: { platform: 'macOS' } })).toBe(true);
        expect(isMacPlatform({ platform: 'Win32' })).toBe(false);
        expect(isMacPlatform({ platform: 'Linux x86_64' })).toBe(false);
    });

    it('counts the Editor.js editor as a place where someone is typing', () => {
        const holder = document.createElement('div');
        holder.innerHTML = '<div class="codex-editor"><div class="ce-toolbar"><button type="button" class="tool">+</button></div></div><button type="button" class="outside">x</button>';
        document.body.appendChild(holder);
        expect(isEditableTarget(holder.querySelector('.tool'))).toBe(true);
        expect(isEditableTarget(holder.querySelector('.outside'))).toBe(false);
        holder.remove();
    });
});

describe('the key chip', () => {
    it('is one kbd on the shared token class, hidden from assistive technology', () => {
        const chip = mount(KeyHint, { props: { shortcut: 'help' } });
        expect(chip.element.tagName).toBe('KBD');
        expect(chip.classes()).toEqual(expect.arrayContaining(['ah-kbd', 'ah-kbd--hint']));
        expect(chip.attributes('aria-hidden')).toBe('true');
        expect(chip.text()).toBe('?');
    });

    it('is not drawn for a shortcut that is switched off or unknown', () => {
        setSingleKeyShortcuts(false);
        expect(mount(KeyHint, { props: { shortcut: 'create-task' } }).find('kbd').exists()).toBe(false);
        expect(mount(KeyHint, { props: { shortcut: 'nope' } }).find('kbd').exists()).toBe(false);
    });

    it('is hidden on a device that cannot hover', () => {
        const css = read('assets/css/tokens.css').replace(/\s+/g, ' ');
        expect(css).toContain('@media (hover: none) { .ah-kbd--hint { display: none; } }');
    });
});
