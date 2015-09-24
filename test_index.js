module.exports = process.env.SUPERPIPE_COV ? require('./lib-cov/superpipe') : require('./lib/superpipe');
