import esbuild from 'esbuild';

const prod = process.argv[2] === 'production';

const ctx = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', 'node:child_process', 'node:fs', 'node:path'],
  format: 'cjs',
  target: 'es2020',
  logLevel: 'info',
  outfile: 'main.js',
  sourcemap: prod ? false : 'inline',
  minify: prod,
  platform: 'node',
  treeShaking: true,
});

if (prod) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.watch();
}
