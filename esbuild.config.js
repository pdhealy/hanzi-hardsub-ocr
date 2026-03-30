// esbuild build configuration for YouTube Chinese Reader extension
const esbuild = require('esbuild');

const isWatch = process.argv.includes('--watch');

const sharedConfig = {
  bundle: true,
  minify: false,
  sourcemap: true,
  target: ['chrome120'],
  format: 'iife',
};

async function build() {
  const contentBuild = esbuild.context({
    ...sharedConfig,
    entryPoints: ['extension/content/content.js'],
    outfile: 'extension/dist/content.bundle.js',
    globalName: undefined,
  });

  const popupBuild = esbuild.context({
    ...sharedConfig,
    entryPoints: ['extension/popup/popup.js'],
    outfile: 'extension/dist/popup.bundle.js',
    globalName: undefined,
  });

  const [contentCtx, popupCtx] = await Promise.all([contentBuild, popupBuild]);

  if (isWatch) {
    await Promise.all([contentCtx.watch(), popupCtx.watch()]);
    console.log('Watching for changes...');
  } else {
    await Promise.all([contentCtx.rebuild(), popupCtx.rebuild()]);
    await Promise.all([contentCtx.dispose(), popupCtx.dispose()]);
    console.log('Build complete.');
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
