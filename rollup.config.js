import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import typescript from 'rollup-plugin-typescript';

export default {
    input: 'src/index.ts',
    plugins: [resolve(), commonjs(), typescript({ typescript: require('typescript') })],
    external: ['prettier', 'svelte'],
    output: {
        file: 'plugin.js',
        format: 'esm',
        sourcemap: true,
    },
};
