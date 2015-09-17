module.exports = process.env.SUPERPIPE_COV ? require('./lib-cov/plumber') : require('./lib/plumber');
