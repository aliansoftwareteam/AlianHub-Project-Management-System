// Husky bootstrap — runs from the package.json "prepare" script.
// Production/CI installs omit devDependencies, so husky isn't present there;
// requiring it directly made `npm install` fail on the deploy server
// (sh: husky: not found, exit 127). Skip silently in that case — git hooks
// are a dev-machine concern only.
if (process.env.NODE_ENV === 'production' || process.env.CI === 'true') {
    process.exit(0);
}
try {
    const { default: husky } = await import('husky');
    console.log(husky());
} catch {
    // husky not installed (devDependencies omitted) — nothing to set up.
}
