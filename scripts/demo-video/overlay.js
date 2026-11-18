/* eslint-env browser */
/* Runs in every recorded page (addInitScript): a visible cursor that follows the mouse, a caption bar,
 * full-screen title and end cards, a fade for reloads, toasts hidden unless a scene shows them, and the
 * harness address shown as the public demo address. */
function installOverlay({ hostToHide, publicHost }) {
    const css = `
        #demo-cursor { position: fixed; left: 0; top: 0; width: 26px; height: 26px; z-index: 2147483647; pointer-events: none;
            transform: translate(-100px, -100px); filter: drop-shadow(0 2px 3px rgba(0, 0, 0, .35)); }
        #demo-cursor .ring { position: absolute; left: -14px; top: -14px; width: 28px; height: 28px; border-radius: 50%;
            background: rgba(100, 115, 232, .35); transform: scale(0); opacity: 0; transition: transform .25s ease-out, opacity .35s ease-out; }
        #demo-cursor.down .ring { transform: scale(1); opacity: 1; transition: none; }
        #demo-caption { position: fixed; left: 50%; bottom: 44px; transform: translate(-50%, 12px); z-index: 2147483646; pointer-events: none;
            max-width: 1100px; padding: 14px 28px; border-radius: 14px; background: rgba(17, 19, 34, .86); color: #fff;
            font: 600 26px/1.3 Inter, "Segoe UI", system-ui, sans-serif; letter-spacing: -.01em; text-align: center;
            box-shadow: 0 10px 30px rgba(0, 0, 0, .25); opacity: 0; transition: opacity .35s ease, transform .35s ease; }
        #demo-caption.on { opacity: 1; transform: translate(-50%, 0); }
        #demo-caption.top { bottom: auto; top: 64px; }
        #demo-caption small { display: block; margin-top: 4px; font-weight: 500; font-size: 17px; opacity: .75; }
        #demo-card { position: fixed; inset: 0; z-index: 2147483645; display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 18px; background: #fff; color: #111322; font-family: Inter, "Segoe UI", system-ui, sans-serif; opacity: 0; pointer-events: none;
            transition: opacity .45s ease; }
        #demo-card.on { opacity: 1; }
        #demo-card.on ~ #demo-cursor { visibility: hidden; }
        #demo-card img { width: 132px; height: 132px; }
        #demo-card .kicker { font: 600 20px/1 Inter, system-ui, sans-serif; letter-spacing: .14em; text-transform: uppercase; color: #6473e8; }
        #demo-card .title { font: 700 56px/1.1 Inter, system-ui, sans-serif; letter-spacing: -.02em; text-align: center; max-width: 1100px; }
        #demo-card .sub { font: 500 26px/1.4 Inter, system-ui, sans-serif; color: #4b4f63; text-align: center; max-width: 1000px; }
        #demo-fade { position: fixed; inset: 0; z-index: 2147483644; background: #fff; opacity: 0; pointer-events: none; transition: opacity .25s ease; }
        #demo-fade.on { opacity: 1; }
        html:not([data-demo-toasts]) .v-toast, html:not([data-demo-toasts]) .ah-undo-toast-region { visibility: hidden !important; }
        ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
    `;
    const cursorSvg = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M3 2 L3 21 L8.2 16.4 L11.6 24 L15 22.5 L11.7 15 L18.5 15 Z" fill="#111322" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';

    const ready = () => {
        if (document.getElementById('demo-cursor')) return;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
        const cursor = document.createElement('div');
        cursor.id = 'demo-cursor';
        cursor.innerHTML = `<div class="ring"></div>${cursorSvg}`;
        const caption = document.createElement('div');
        caption.id = 'demo-caption';
        const card = document.createElement('div');
        card.id = 'demo-card';
        const fade = document.createElement('div');
        fade.id = 'demo-fade';
        document.body.append(fade, card, caption, cursor);
        const last = window.__demoState || {};
        if (last.x !== undefined) cursor.style.transform = `translate(${last.x}px, ${last.y}px)`;
    };

    const state = window.__demoState = { x: undefined, y: undefined };
    const saved = sessionStorage.getItem('demo.cursor');
    if (saved) Object.assign(state, JSON.parse(saved));
    window.addEventListener('mousemove', (event) => {
        state.x = event.clientX;
        state.y = event.clientY;
        const cursor = document.getElementById('demo-cursor');
        if (cursor) cursor.style.transform = `translate(${state.x}px, ${state.y}px)`;
        sessionStorage.setItem('demo.cursor', JSON.stringify(state));
    }, true);
    window.addEventListener('mousedown', () => document.getElementById('demo-cursor')?.classList.add('down'), true);
    window.addEventListener('mouseup', () => setTimeout(() => document.getElementById('demo-cursor')?.classList.remove('down'), 120), true);

    const swapHost = (root) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (node.nodeValue.includes(hostToHide)) node.nodeValue = node.nodeValue.split(hostToHide).join(publicHost);
        }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
    else ready();
    document.addEventListener('DOMContentLoaded', () => {
        new MutationObserver((changes) => {
            for (const change of changes) {
                if (change.type === 'characterData' && change.target.nodeValue.includes(hostToHide)) swapHost(change.target.parentNode || document.body);
                for (const node of change.addedNodes || []) if (node.nodeType === 1 || node.nodeType === 3) swapHost(node.nodeType === 3 ? node.parentNode || document.body : node);
            }
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });

    const escape = (text) => String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    window.__demo = {
        caption(text, sub, top) {
            ready();
            const el = document.getElementById('demo-caption');
            el.classList.toggle('top', Boolean(top));
            if (!text) { el.classList.remove('on'); return; }
            el.innerHTML = `${escape(text)}${sub ? `<small>${escape(sub)}</small>` : ''}`;
            el.classList.add('on');
        },
        card({ kicker = '', title = '', sub = '', logo = false } = {}) {
            ready();
            const el = document.getElementById('demo-card');
            if (!title && !logo) { el.classList.remove('on'); return; }
            el.innerHTML = `${logo ? '<img src="/logo.png" alt="">' : ''}${kicker ? `<div class="kicker">${escape(kicker)}</div>` : ''}<div class="title">${escape(title)}</div>${sub ? `<div class="sub">${escape(sub)}</div>` : ''}`;
            el.classList.add('on');
        },
        fade(on) {
            ready();
            document.getElementById('demo-fade').classList.toggle('on', Boolean(on));
        },
        toasts(on) {
            if (on) document.documentElement.setAttribute('data-demo-toasts', '');
            else document.documentElement.removeAttribute('data-demo-toasts');
        },
    };
}

module.exports = { installOverlay };
