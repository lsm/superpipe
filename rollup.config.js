import babel from 'rollup-plugin-babel'
import replace from 'rollup-plugin-replace'
import commonjs from 'rollup-plugin-commonjs'
import { uglify } from 'rollup-plugin-uglify'
import nodeResolve from 'rollup-plugin-node-resolve'

const NODE_ENV = process.env.NODE_ENV

const config = {
  input: 'src/index.js',
  output: {
    format: 'umd',
    name: 'Superpipe',
  },

  plugins: [
    nodeResolve(),
    babel({
      babelrc: false,
      presets: [
        [
          'env',
          {
            targets: {
              browsers: [
                'last 1 version',
                '> 1%',
                'maintained node versions',
                'not dead',
              ],
            },
            modules: false,
          },
        ],
      ],
      plugins: [ 'external-helpers', 'transform-object-rest-spread' ],
      exclude: '**/node_modules/**',
    }),
    replace({ 'process.env.NODE_ENV': JSON.stringify(NODE_ENV) }),
    commonjs(),
  ],
}

if (NODE_ENV === 'production') {
  config.plugins.push(uglify({
    compress: {
      pure_getters: true,
      unsafe: true,
      unsafe_comps: true,
      warnings: false,
    },
  }))
}

export default config
