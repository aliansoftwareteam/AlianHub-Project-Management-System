import { describe, expect, it, vi } from 'vitest';
import { hydrateDocImages } from '@/components/molecules/Pages/docImages';

const rootOf = (html) => {
    const root = document.createElement('div');
    root.innerHTML = html;
    return root;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('hydrateDocImages', () => {
    it('adds an image to each stored figure and fills it with the signed address', async () => {
        const root = rootOf('<figure data-image-key="a/1.png"><figcaption>First</figcaption></figure><figure data-image-key="b/2.png"></figure>');
        const resolveUrl = vi.fn((key) => `https://cdn.test/${key}?sig=1`);
        hydrateDocImages(root, resolveUrl);
        await settle();
        const images = root.querySelectorAll('figure img');
        expect(images).toHaveLength(2);
        expect(images[0].getAttribute('src')).toBe('https://cdn.test/a/1.png?sig=1');
        expect(images[1].getAttribute('src')).toBe('https://cdn.test/b/2.png?sig=1');
        expect(resolveUrl).toHaveBeenCalledTimes(2);
    });

    it('uses the caption as the alt text and puts the image before it', () => {
        const root = rootOf('<figure data-image-key="k"><figcaption>Release plan</figcaption></figure>');
        hydrateDocImages(root, () => '');
        const figure = root.querySelector('figure');
        expect(figure.firstChild.tagName).toBe('IMG');
        expect(figure.firstChild.alt).toBe('Release plan');
    });

    it('leaves the alt empty when there is no caption', () => {
        const root = rootOf('<figure data-image-key="k"></figure>');
        hydrateDocImages(root, () => '');
        expect(root.querySelector('img').alt).toBe('');
    });

    it('keeps right-to-left captions as they were written', () => {
        const root = rootOf('<figure data-image-key="k"><figcaption>خطة الإصدار</figcaption></figure>');
        hydrateDocImages(root, () => '');
        expect(root.querySelector('img').alt).toBe('خطة الإصدار');
    });

    it('skips a figure that already shows its image', () => {
        const root = rootOf('<figure data-image-key="k"><img src="old.png"></figure>');
        const resolveUrl = vi.fn(() => 'new.png');
        hydrateDocImages(root, resolveUrl);
        expect(resolveUrl).not.toHaveBeenCalled();
        expect(root.querySelectorAll('img')).toHaveLength(1);
        expect(root.querySelector('img').getAttribute('src')).toBe('old.png');
    });

    it('ignores figures that carry no stored key', () => {
        const root = rootOf('<figure><figcaption>Plain</figcaption></figure>');
        const resolveUrl = vi.fn();
        hydrateDocImages(root, resolveUrl);
        expect(resolveUrl).not.toHaveBeenCalled();
        expect(root.querySelector('img')).toBeNull();
    });

    it('accepts an address that arrives later', async () => {
        const root = rootOf('<figure data-image-key="k"></figure>');
        hydrateDocImages(root, () => Promise.resolve('late.png'));
        expect(root.querySelector('img').getAttribute('src')).toBeNull();
        await settle();
        expect(root.querySelector('img').getAttribute('src')).toBe('late.png');
    });

    it('leaves the image without a source when signing fails or answers nothing', async () => {
        const root = rootOf('<figure data-image-key="a"></figure><figure data-image-key="b"></figure>');
        const answers = { a: () => Promise.reject(new Error('denied')), b: () => '' };
        hydrateDocImages(root, (key) => answers[key]());
        await settle();
        const [first, second] = root.querySelectorAll('img');
        expect(first.getAttribute('src')).toBeNull();
        expect(second.getAttribute('src')).toBeNull();
    });

    it('does nothing without a root', () => {
        expect(() => hydrateDocImages(null, vi.fn())).not.toThrow();
        expect(() => hydrateDocImages(undefined, vi.fn())).not.toThrow();
    });
});
