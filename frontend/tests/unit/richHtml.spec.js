import { describe, expect, it } from 'vitest';
import { richHtml } from '@/utils/richHtml';

const parse = (html) => {
    const box = document.createElement('div');
    box.innerHTML = html;
    return box;
};

describe('richHtml', () => {
    it('removes scripts, event handlers, iframes and forms', () => {
        const out = parse(richHtml('<p>a<script>alert(1)</script></p><img src="https://x.test/a.png" onerror="alert(2)"><iframe src="https://x.test"></iframe><form><input></form><svg onload="alert(3)"></svg>'));
        expect(out.querySelectorAll('script, iframe, form, input, svg')).toHaveLength(0);
        expect(out.querySelector('[onerror], [onload]')).toBeNull();
        expect(out.querySelector('img').getAttribute('src')).toBe('https://x.test/a.png');
    });

    it('drops links and images whose address is not an allowed scheme', () => {
        const out = parse(richHtml('<a href="javascript:alert(1)">a</a><a href=" JaVaScRiPt:alert(1)">b</a><a href="data:text/html,x">c</a><img src="javascript:alert(1)"><img src="data:text/html,x"><a href="vbscript:x">d</a>'));
        out.querySelectorAll('a').forEach((a) => expect(a.hasAttribute('href')).toBe(false));
        out.querySelectorAll('img').forEach((img) => expect(img.hasAttribute('src')).toBe(false));
    });

    it('keeps http, https and mailto links and marks them noopener', () => {
        const out = parse(richHtml('<a href="https://x.test/p" target="_blank">a</a><a href="http://x.test">b</a><a href="mailto:a@x.test">c</a>'));
        const links = [...out.querySelectorAll('a')];
        expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://x.test/p', 'http://x.test', 'mailto:a@x.test']);
        links.forEach((a) => expect(a.getAttribute('rel')).toBe('noopener noreferrer'));
    });

    it('keeps data image sources', () => {
        const out = parse(richHtml('<img src="data:image/png;base64,AAAA">'));
        expect(out.querySelector('img').getAttribute('src')).toBe('data:image/png;base64,AAAA');
    });

    it('removes style expressions and keeps only plain colours and alignment', () => {
        const out = parse(richHtml('<p style="background:url(javascript:alert(1));color:red">a</p><span style="color: rgb(230, 0, 0); position: fixed; background-color: #ffff00">b</span><p style="width:expression(alert(1))">c</p><p style="text-align:center">d</p>'));
        const [first, span, third, fourth] = out.querySelectorAll('p, span');
        expect(first.getAttribute('style')).toBe('color:red');
        expect(span.getAttribute('style')).toBe('color:rgb(230, 0, 0);background-color:#ffff00');
        expect(third.hasAttribute('style')).toBe(false);
        expect(fourth.getAttribute('style')).toBe('text-align:center');
    });

    it('keeps the markup the editors produce', () => {
        const editorHtml = '<h2>Title</h2><p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <code>c</code></p>'
            + '<ul><li>one</li></ul><ol><li>two</li></ol><blockquote>q</blockquote><pre class="ql-syntax">x</pre>'
            + '<p class="ql-align-center">centre</p><table><tbody><tr><th>h</th><td>d</td></tr></tbody></table><hr>'
            + '<aside class="callout callout--info" data-tone="info">note</aside><p class="task-block" data-task-id="t1">T</p>';
        const out = parse(richHtml(editorHtml));
        ['h2', 'strong', 'em', 'u', 's', 'code', 'ul li', 'ol li', 'blockquote', 'pre', 'table th', 'table td', 'hr', 'aside'].forEach((sel) => {
            expect(out.querySelector(sel)).not.toBeNull();
        });
        expect(out.querySelector('p.ql-align-center').textContent).toBe('centre');
        expect(out.querySelector('aside').getAttribute('data-tone')).toBe('info');
        expect(out.querySelector('p.task-block').getAttribute('data-task-id')).toBe('t1');
    });

    it('treats empty and non-string values as empty text', () => {
        expect(richHtml(null)).toBe('');
        expect(richHtml(undefined)).toBe('');
        expect(richHtml(12)).toBe('12');
    });
});
