import { describe, expect, it } from 'vitest';
import { commentHtml, commentPlainText } from '@/utils/commentHtml';

const asDom = (html) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host;
};
const unsafeNodes = (host) => host.querySelectorAll('img, script, iframe, svg, style, [onerror], [onclick], [onmouseover]');

describe('commentHtml', () => {
    it('shows markup sent straight to the API as text', () => {
        const raw = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
        const host = asDom(commentHtml(raw));
        expect(unsafeNodes(host)).toHaveLength(0);
        expect(host.textContent).toBe(raw);
    });

    it('shows text the web app stored escaped as the characters the writer typed, once', () => {
        const host = asDom(commentHtml('&lt;b&gt;bold&lt;/b&gt; &amp; &quot;q&quot; &#039;s&#039; &#39;t&#39; &#96;c&#96; &#40;p&#41;'));
        expect(host.querySelector('b')).toBeNull();
        expect(host.textContent).toBe('<b>bold</b> & "q" \'s\' \'t\' `c` (p)');
    });

    it('decodes one level only, so a typed entity stays visible', () => {
        expect(asDom(commentHtml('&amp;lt;b&amp;gt;')).textContent).toBe('&lt;b&gt;');
    });

    it('keeps mentions bold', () => {
        const host = asDom(commentHtml('hi @[Max Member](abcd1234) there'));
        const mention = host.querySelector('b.mentioned');
        expect(mention.textContent).toBe('@Max Member');
        expect(host.textContent).toBe('hi @Max Member there');
    });

    it('keeps line breaks and spacing', () => {
        expect(asDom(commentHtml('a\n  b')).textContent).toBe('a\n  b');
    });

    it('links http and https URLs in a new tab without an opener', () => {
        const host = asDom(commentHtml('see https://example.com/a?b=1&c=2 and http://x.io', { links: true }));
        const anchors = host.querySelectorAll('a');
        expect(anchors).toHaveLength(2);
        expect(anchors[0].getAttribute('href')).toBe('https://example.com/a?b=1&c=2');
        expect(anchors[0].textContent).toBe('https://example.com/a?b=1&c=2');
        expect(anchors[0].getAttribute('target')).toBe('_blank');
        expect(anchors[0].getAttribute('rel')).toBe('noopener noreferrer');
        expect(anchors[1].getAttribute('href')).toBe('http://x.io');
    });

    it('links a URL the web app stored escaped with its real characters', () => {
        const host = asDom(commentHtml('https://example.com/?a=1&amp;b=2', { links: true }));
        expect(host.querySelector('a').getAttribute('href')).toBe('https://example.com/?a=1&b=2');
    });

    it('does not link other schemes', () => {
        const host = asDom(commentHtml('javascript:alert(1) data:text/html,x', { links: true }));
        expect(host.querySelector('a')).toBeNull();
        expect(host.textContent).toBe('javascript:alert(1) data:text/html,x');
    });

    it('keeps a quote in a URL inside the href', () => {
        const host = asDom(commentHtml('https://example.com/"onmouseover="alert(1)"x', { links: true }));
        expect(unsafeNodes(host)).toHaveLength(0);
        const anchor = host.querySelector('a');
        expect(anchor.getAttributeNames().sort()).toEqual(['href', 'rel', 'target']);
        expect(host.textContent).toBe('https://example.com/"onmouseover="alert(1)"x');
    });

    it('leaves URLs as text when links are off', () => {
        expect(asDom(commentHtml('https://example.com')).querySelector('a')).toBeNull();
    });

    it('can render mentions without the bold', () => {
        const host = asDom(commentHtml('@[Max Member](abcd1234) <i>x</i>', { mentionMarkup: false }));
        expect(host.children).toHaveLength(0);
        expect(host.textContent).toBe('@Max Member <i>x</i>');
    });
});

describe('commentPlainText', () => {
    it('gives the decoded text with mentions as names', () => {
        expect(commentPlainText('&lt;b&gt; @[Max Member](abcd1234)')).toBe('<b> @Max Member');
    });
});
