/* The main/helpers files stay CommonJS so jest can load them. Babel's runtime transform would
 * otherwise add `import` lines to them, webpack then treats them as ES modules and refuses their
 * module.exports at start-up. */
module.exports = {
  webpack: (config) => {
    for (const rule of config.module.rules) {
      const use = rule.use;
      if (use && typeof use.loader === 'string' && use.loader.includes('babel-loader')) {
        use.options = { ...use.options, sourceType: 'unambiguous' };
      }
    }
    return config;
  },
};
