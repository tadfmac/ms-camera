import resolve from 'rollup-plugin-node-resolve';
import commonJS from 'rollup-plugin-commonjs'
//import pkg from './package.json';
import json from 'rollup-plugin-json';
import { terser } from 'rollup-plugin-terser';
import builtins from 'rollup-plugin-node-builtins';

const production = process.env.NODE_ENV !== 'development';

export default [
  {
    input: 'libsrc/mediasoup-client-module.js',
    output: [
      { file: 'www/lib/mediasoup-client-esm.js', format: 'es' }
    ],
    plugins: [
      builtins(),
      json(),
      resolve({
        browser: true,
        preferBuiltins: false
      }),
      commonJS({
        include: 'node_modules/**'
      }),
		  production && terser() // minify in production
    ]
  },
  {
    input: 'libsrc/socketio-client-module.js',
    output: [
      { file: 'www/lib/socketio-client-esm.js', format: 'es' }
    ],
    plugins: [
      builtins(),
      json(),
      resolve({
        browser: true,
        preferBuiltins: false
      }),
      commonJS({
        include: 'node_modules/**'
      }),
      production && terser() // minify in production
    ]
  },

];
