/* Uploaded images are stored by key; each reader asks the server to sign it, which is where access is checked. */
export function hydrateDocImages(root, resolveUrl) {
    if (!root) return;
    root.querySelectorAll('figure[data-image-key]').forEach((figure) => {
        if (figure.querySelector('img')) return;
        const img = document.createElement('img');
        const caption = figure.querySelector('figcaption');
        img.alt = caption ? caption.textContent : '';
        figure.insertBefore(img, figure.firstChild);
        Promise.resolve(resolveUrl(figure.getAttribute('data-image-key')))
            .then((src) => { if (src) img.src = src; })
            .catch(() => {});
    });
}
