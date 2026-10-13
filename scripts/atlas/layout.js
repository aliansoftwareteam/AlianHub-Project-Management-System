/* global window, document, getComputedStyle, NodeFilter, requestAnimationFrame -- collectLayout and the box readers run in the page */

const TARGET_MIN = 24;
const TARGET_CLEARANCE = 12;
const COVER_SHARE = 0.4;
const EDGE_TOLERANCE = 1;
const WIDEST = 3;
const LISTED = 12;
const INTERACTIVE = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="menuitem"]';

const STATE_CLASS = /^(is-|has-|router-link|v-|active$|open$|show$|selected$|disabled$|focus)/;
const GENERATED_ID = /\d{4,}|[0-9a-f]{8}-[0-9a-f]{4}/i;
const HELPER_CLASS = /(^|[-_])(sr-only|visually-hidden|visuallyhidden|screen-reader(-text)?|offscreen)$/i;
const ZERO_CLIP = /^rect\((0(px)?[ ,]*){4}\)$/;

const own = (element) => {
    if (element.id && !GENERATED_ID.test(element.id)) return `${element.tag}#${element.id}`;
    const classes = (element.classes || []).filter((name) => !STATE_CLASS.test(name)).slice(0, 2);
    return `${element.tag}${classes.map((name) => `.${name}`).join('')}${element.role ? `[role=${element.role}]` : ''}`;
};

const isBare = (element) => !(element.id && !GENERATED_ID.test(element.id)) && !(element.classes || []).some((name) => !STATE_CLASS.test(name));

function shortSelector(element) {
    if (!element) return '';
    return isBare(element) && element.parent ? `${own(element.parent)} > ${own(element)}` : own(element);
}

// A wrapper with one offending child only passes the width on; the last of that chain is what to fix.
function widestOffenders(offenders) {
    const childrenOf = (index) => offenders.filter((offender) => offender.parent === index);
    return offenders.filter((offender) => offender.parent === -1)
        .sort((a, b) => b.right - a.right)
        .slice(0, WIDEST)
        .map((outer) => {
            let inner = outer;
            for (let children = childrenOf(inner.index); children.length === 1; children = childrenOf(inner.index)) [inner] = children;
            return { selector: shortSelector(outer.el), right: outer.right, ...(inner === outer ? {} : { inner: shortSelector(inner.el) }) };
        });
}

function overflowOf({ viewport, scopes }) {
    const result = { document: null, sideways: [], cut: [] };
    for (const scope of scopes) {
        const by = Math.round(scope.scrollWidth - (scope.kind === 'document' ? viewport.width : scope.clientWidth));
        if (by <= EDGE_TOLERANCE) continue;
        const widest = widestOffenders(scope.offenders);
        if (scope.kind === 'document') result.document = { by, widest };
        if (scope.kind === 'scroll') result.sideways.push({ selector: shortSelector(scope.el), by, page: Boolean(scope.tall), widest });
        if (scope.kind === 'cut' && widest.length) result.cut.push({ selector: shortSelector(scope.el), by, widest });
    }
    return result;
}

const distanceTo = (x, y, box) => Math.hypot(Math.max(box.left - x, 0, x - (box.left + box.width)), Math.max(box.top - y, 0, y - (box.top + box.height)));

// A closed drawer waits left of the screen; that is where it belongs, not a control gone missing.
const parkedLeft = (box) => box.left + box.width <= 0;

const nested = (a, b) => a.ancestors.includes(b.index) || b.ancestors.includes(a.index);

/* What has scrolled out of its container sits, by its box, under whatever lies beyond, and what
 * scrolls passes what does not: neighbours are controls that move together. */
function smallTargets(all) {
    const controls = all.filter((control) => control.onScreen !== false);
    return controls.flatMap((control) => {
        if (control.inline || (control.width >= TARGET_MIN && control.height >= TARGET_MIN)) return [];
        const x = control.left + control.width / 2;
        const y = control.top + control.height / 2;
        const near = controls.find((other) => other !== control && other.layer === control.layer && other.scroller === control.scroller && !nested(control, other) && distanceTo(x, y, other) < TARGET_CLEARANCE);
        return near ? [{ selector: shortSelector(control.el), width: Math.round(control.width), height: Math.round(control.height), near: shortSelector(near.el) }] : [];
    });
}

function cutControls(controls) {
    return controls.flatMap((control) => {
        if (!control.clip || parkedLeft(control)) return [];
        const centre = control.left + control.width / 2;
        if (centre >= control.clip.left && centre <= control.clip.right) return [];
        return [{ selector: shortSelector(control.el), left: Math.round(control.left), right: Math.round(control.left + control.width), edge: Math.round(centre < control.clip.left ? control.clip.left : control.clip.right) }];
    });
}

const isHiddenHelper = ({ classes = [], clip = '', clipPath = '', position = '', width = Infinity, height = Infinity }) => classes.some((name) => HELPER_CLASS.test(name))
    || ZERO_CLIP.test(clip)
    || /^inset\((50|100)%\)$/.test(clipPath)
    || ((position === 'absolute' || position === 'fixed') && width <= 1 && height <= 1);

function clippedText(texts) {
    return texts
        .filter((text) => (text.visible.width <= 0 || text.visible.height <= 0) && !parkedLeft(text) && !(text.chain || []).some(isHiddenHelper))
        .map((text) => ({ selector: shortSelector(text.el), text: text.text }));
}

function coveringLayers(layers, viewport) {
    return layers.flatMap((layer) => {
        if (layer.pointerEvents === 'none') return [];
        const share = (Math.min(layer.bottom, viewport.height) - Math.max(layer.top, 0)) / viewport.height;
        const width = Math.round(Math.min(layer.right, viewport.width) - Math.max(layer.left, 0));
        if (share <= COVER_SHARE || width <= viewport.width / 2) return [];
        return [{ selector: shortSelector(layer.el), position: layer.position, share: Math.round(share * 100) / 100, width }];
    }).sort((a, b) => b.share - a.share);
}

function layoutFindings(raw) {
    const overflow = overflowOf(raw);
    const lists = {
        sideways: overflow.sideways,
        cut: overflow.cut,
        cutControls: cutControls(raw.controls),
        smallTargets: smallTargets(raw.controls),
        clippedText: clippedText(raw.texts),
        covering: coveringLayers(raw.layers, raw.viewport),
    };
    const counts = { overflow: overflow.document ? 1 : 0 };
    const listed = {};
    for (const [name, list] of Object.entries(lists)) {
        counts[name] = list.length;
        listed[name] = list.slice(0, LISTED);
    }
    return { counts, overflow: overflow.document, ...listed };
}

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function summaryOf(layout) {
    if (!layout) return '';
    const { counts } = layout;
    const pagePans = layout.sideways.filter((scroller) => scroller.page).length;
    return [
        layout.overflow && `document ${layout.overflow.by}px too wide`,
        pagePans && `${plural(pagePans, 'page scroller')} panning sideways`,
        counts.cut && plural(counts.cut, 'cut container'),
        counts.cutControls && `${plural(counts.cutControls, 'control')} cut off`,
        counts.smallTargets && plural(counts.smallTargets, 'small target'),
        counts.clippedText && plural(counts.clippedText, 'clipped text'),
        counts.covering && plural(counts.covering, 'covering layer'),
    ].filter(Boolean).join(', ');
}

/* Runs in the page, so it can use nothing from this file but its argument. It only gathers
 * boxes and styles; the rules above decide, where a test can reach them. */
function collectLayout({ interactive, edge, limit }) {
    const root = document.documentElement;
    const viewport = { width: root.clientWidth, height: window.innerHeight };
    const styles = new Map();
    const boxes = new Map();
    const styleOf = (element) => styles.get(element) || styles.set(element, getComputedStyle(element)).get(element);
    const boxOf = (element) => boxes.get(element) || boxes.set(element, element.getBoundingClientRect()).get(element);
    const classesOf = (element) => (typeof element.className === 'string' ? element.className : element.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    const plain = (element) => ({ tag: element.tagName.toLowerCase(), id: element.id || '', classes: classesOf(element), role: element.getAttribute('role') || '' });
    const describe = (element) => ({ ...plain(element), parent: element.parentElement && element.parentElement !== document.body ? plain(element.parentElement) : null });
    const scrolls = (value) => value === 'auto' || value === 'scroll';
    const clips = (value) => value === 'hidden' || value === 'clip';
    const shown = (element) => {
        const box = boxOf(element);
        return box.width > 0 && box.height > 0 && element.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    };
    const documentPans = root.scrollWidth > viewport.width + edge;

    /* What is left of a box once every ancestor that hides its overflow has cut it. An ancestor
     * that scrolls can bring the box into view, so from there on its own box stands in. */
    const visiblePart = (start, box, startSkips, scrolledOutCounts = false) => {
        const part = { left: box.left, right: box.right, top: box.top, bottom: box.bottom, goneX: null, goneY: null, fixed: false };
        let skipping = startSkips;
        part.layer = null;
        for (let node = start; node && node !== root; node = node.parentElement) {
            const style = styleOf(node);
            if (skipping && style.position === 'static' && style.transform === 'none') continue;
            skipping = false;
            const frame = boxOf(node);
            if (!part.scroller && (scrolls(style.overflowX) || scrolls(style.overflowY))) part.scroller = node;
            if (!part.goneX) {
                if (scrolledOutCounts && scrolls(style.overflowX)) Object.assign(part, { left: Math.max(part.left, frame.left), right: Math.min(part.right, frame.right) });
                else if (scrolls(style.overflowX)) Object.assign(part, { left: frame.left, right: frame.right, scrollsX: true });
                else if (clips(style.overflowX)) Object.assign(part, { left: Math.max(part.left, frame.left), right: Math.min(part.right, frame.right) });
                if (part.right - part.left <= 0) part.goneX = node;
            }
            if (!part.goneY) {
                if (scrolledOutCounts && scrolls(style.overflowY)) Object.assign(part, { top: Math.max(part.top, frame.top), bottom: Math.min(part.bottom, frame.bottom) });
                else if (scrolls(style.overflowY)) Object.assign(part, { top: frame.top, bottom: frame.bottom });
                else if (clips(style.overflowY)) Object.assign(part, { top: Math.max(part.top, frame.top), bottom: Math.min(part.bottom, frame.bottom) });
                if (part.bottom - part.top <= 0) part.goneY = node;
            }
            if (style.position === 'fixed') {
                Object.assign(part, { fixed: true, layer: node });
                break;
            }
            if (style.position === 'absolute') skipping = true;
        }
        return part;
    };

    const offendersIn = (scope, right) => {
        const found = [];
        const walk = (node, parent) => {
            for (const child of node.children) {
                if (found.length >= limit) return;
                const style = styleOf(child);
                if (style.display === 'none' || style.position === 'fixed') continue;
                const box = boxOf(child);
                let index = parent;
                if (box.width > 0 && box.height > 0 && box.right > right + edge && style.visibility !== 'hidden') {
                    index = found.length;
                    found.push({ index, parent, el: describe(child), left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width) });
                }
                if (style.overflowX === 'visible') walk(child, index);
            }
        };
        walk(scope, -1);
        return found;
    };

    const scopes = [];
    if (documentPans) scopes.push({ kind: 'document', el: plain(root), clientWidth: viewport.width, scrollWidth: root.scrollWidth, offenders: offendersIn(root, viewport.width) });
    const layers = [];
    for (const element of document.body.querySelectorAll('*')) {
        const style = styleOf(element);
        if (style.display === 'none') continue;
        const fixedOrSticky = style.position === 'fixed' || style.position === 'sticky';
        const wider = element.scrollWidth > element.clientWidth + edge && element.clientWidth > 0;
        if (!fixedOrSticky && !wider) continue;
        if (!shown(element)) continue;
        const box = boxOf(element);
        if (fixedOrSticky) layers.push({ el: describe(element), position: style.position, top: box.top, bottom: box.bottom, left: box.left, right: box.right, pointerEvents: style.pointerEvents });
        if (!wider || scopes.length >= limit) continue;
        const right = box.left + element.clientLeft + element.clientWidth;
        const scope = { el: describe(element), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
        if (scrolls(style.overflowX)) {
            scopes.push({ ...scope, kind: 'scroll', tall: scrolls(style.overflowY) && box.height >= viewport.height / 2, offenders: offendersIn(element, right) });
        } else if (clips(style.overflowX) && style.textOverflow !== 'ellipsis' && box.width >= viewport.width / 2) {
            scopes.push({ ...scope, kind: 'cut', offenders: offendersIn(element, right) });
        }
    }

    const targets = [...document.body.querySelectorAll(interactive)].filter((element) => shown(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true' && boxOf(element).width > 1 && boxOf(element).height > 1);
    const indexOf = new Map(targets.map((element, index) => [element, index]));
    const ids = new Map();
    const idOf = (element) => (element ? ids.get(element) || ids.set(element, ids.size + 1).get(element) : 0);
    const controls = targets.map((element, index) => {
        const box = boxOf(element);
        const style = styleOf(element);
        const ancestors = [];
        for (let node = element.parentElement; node; node = node.parentElement) if (indexOf.has(node)) ancestors.push(indexOf.get(node));
        const part = style.position === 'fixed' ? { left: box.left, right: box.right, fixed: true, layer: element } : visiblePart(element.parentElement, box, style.position === 'absolute');
        let clip = part.scrollsX ? null : { left: part.left, right: part.right };
        if (clip && (part.fixed || !documentPans)) clip = { left: Math.max(clip.left, 0), right: Math.min(clip.right, viewport.width) };
        if (part.fixed && (box.right <= 0 || box.left >= viewport.width)) clip = null;
        const now = style.position === 'fixed' ? box : visiblePart(element.parentElement, box, style.position === 'absolute', true);
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        const onScreen = x >= Math.max(now.left, 0) && x <= Math.min(now.right, viewport.width) && y >= Math.max(now.top, 0) && y <= Math.min(now.bottom, viewport.height);
        const inText = style.display === 'inline' && [...element.parentElement.childNodes].some((node) => node.nodeType === 3 && node.nodeValue.trim());
        return { index, el: describe(element), left: box.left, top: box.top, width: box.width, height: box.height, inline: inText, ancestors, clip, layer: idOf(part.layer), scroller: idOf(part.scroller), onScreen };
    });

    const texts = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node && texts.length < limit; node = walker.nextNode()) {
        const content = node.nodeValue.trim();
        const parent = node.parentElement;
        if (!content || !parent || /^(script|style|noscript|option|title)$/i.test(parent.tagName)) continue;
        if (!parent.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
        range.selectNodeContents(node);
        const box = range.getBoundingClientRect();
        if (!(box.width > 0 && box.height > 0)) continue;
        const part = visiblePart(parent, box, false);
        if (!part.goneX && !part.goneY) continue;
        const stop = part.goneX || part.goneY;
        const chain = [];
        for (let link = parent; link && link !== root; link = link.parentElement) {
            const style = styleOf(link);
            const frame = boxOf(link);
            chain.push({ classes: classesOf(link), clip: style.clip, clipPath: style.clipPath, position: style.position, width: frame.width, height: frame.height });
            if (link === stop) break;
        }
        texts.push({ el: describe(parent), text: content.slice(0, 40), left: box.left, width: box.width, visible: { width: part.goneX ? 0 : part.right - part.left, height: part.goneY ? 0 : part.bottom - part.top }, chain });
    }

    return { viewport, scopes, controls, texts, layers };
}

const BIGGEST = 5;

function cssImpact({ total, changed }) {
    const delta = (pair) => ({ width: Math.round(pair.after.width - pair.before.width), height: Math.round(pair.after.height - pair.before.height) });
    const resized = changed.map((pair) => ({ pair, ...delta(pair) })).filter((change) => change.width || change.height);
    return {
        total,
        resized: resized.length,
        shifted: changed.length - resized.length,
        biggest: resized
            .sort((a, b) => (Math.abs(b.width) + Math.abs(b.height)) - (Math.abs(a.width) + Math.abs(a.height)))
            .slice(0, BIGGEST)
            .map((change) => ({ selector: shortSelector(change.pair.el), width: change.width, height: change.height })),
    };
}

/* Both run in the page. The boxes are kept on the elements themselves, so an element the app
 * adds or drops between the two readings is left out instead of shifting every index. */
function rememberBoxes() {
    window.__atlasBoxes = new Map([...document.body.querySelectorAll('*')].map((element) => [element, element.getBoundingClientRect()]));
}

function changedBoxes({ limit }) {
    const plain = (element) => ({ tag: element.tagName.toLowerCase(), id: element.id || '', classes: (element.getAttribute('class') || '').split(/\s+/).filter(Boolean), role: element.getAttribute('role') || '' });
    const changed = [];
    for (const [element, before] of window.__atlasBoxes) {
        if (!element.isConnected || (!before.width && !before.height)) continue;
        const after = element.getBoundingClientRect();
        if (['left', 'top', 'width', 'height'].every((side) => Math.abs(after[side] - before[side]) < 0.5)) continue;
        if (changed.length < limit) changed.push({ el: { ...plain(element), parent: element.parentElement ? plain(element.parentElement) : null }, before: before.toJSON(), after: after.toJSON() });
    }
    const total = window.__atlasBoxes.size;
    delete window.__atlasBoxes;
    return { total, changed };
}

async function patchCss(page, css) {
    await page.evaluate(rememberBoxes);
    await page.addStyleTag({ content: css });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return cssImpact(await page.evaluate(changedBoxes, { limit: 2000 }));
}

const measureLayout = async (page) => layoutFindings(await page.evaluate(collectLayout, { interactive: INTERACTIVE, edge: EDGE_TOLERANCE, limit: 400 }));

module.exports = { cssImpact, patchCss, shortSelector, widestOffenders, overflowOf, smallTargets, cutControls, clippedText, coveringLayers, layoutFindings, summaryOf, collectLayout, measureLayout };
