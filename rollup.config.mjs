import { babel } from '@rollup/plugin-babel'
import replace from '@rollup/plugin-replace'
import commonjs from '@rollup/plugin-commonjs'
import terser from '@rollup/plugin-terser'
import { nodeResolve } from '@rollup/plugin-node-resolve'

const NODE_ENV = process.env.NODE_ENV

const config = {
  input: 'lib/index.js',
  output: {
    format: 'umd',
    name: 'Superpipe',
    // The entry mixes a default export with named type re-exports; expose
    // the callable default as the UMD global (`Superpipe(...)`) instead of
    // a namespace (`Superpipe.default(...)`).
    exports: 'default',
  },

  plugins: [
    nodeResolve(),
    commonjs(),
    babel({
      babelHelpers: 'bundled',
      babelrc: false,
      presets: [
        [
          '@babel/env',
          {
            targets: {
              browsers: [
                '> 0.25%',
                'not dead',
              ],
            },
            modules: false,
          },
        ],
      ],
      exclude: '**/node_modules/**',
    }),
    replace({ 'process.env.NODE_ENV': JSON.stringify(NODE_ENV) }),
  ],
}

if (NODE_ENV === 'production') {
  config.plugins.push(terser({
    compress: {
      pure_getters: true,
      unsafe: true,
      unsafe_comps: true,
    },
  }))
}

export default config
