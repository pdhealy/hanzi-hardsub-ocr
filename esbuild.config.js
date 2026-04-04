// esbuild build configuration for YouTube Chinese Reader extension
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');

const sharedConfig = {
  bundle: true,
  minify: false,
  sourcemap: true,
  target: ['chrome120'],
  format: 'iife',
};

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

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

  // Offscreen OCR bundle — direct ONNX Runtime Web pipeline
  const offscreenBuild = esbuild.context({
    ...sharedConfig,
    entryPoints: ['extension/background/offscreen-ocr.js'],
    outfile: 'extension/background/offscreen-ocr.bundle.js',
    platform: 'browser',
  });

  const [contentCtx, popupCtx, offscreenCtx] = await Promise.all([
    contentBuild, popupBuild, offscreenBuild,
  ]);

  if (isWatch) {
    await Promise.all([contentCtx.watch(), popupCtx.watch(), offscreenCtx.watch()]);
    console.log('Watching for changes...');
  } else {
    await Promise.all([
      contentCtx.rebuild(),
      popupCtx.rebuild(),
      offscreenCtx.rebuild(),
    ]);
    await Promise.all([contentCtx.dispose(), popupCtx.dispose(), offscreenCtx.dispose()]);

    // Copy binary assets that cannot be bundled
    // onnxruntime-web >=1.24 ships only threaded WASM variants
    copyFile(
      'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
      'extension/libs/ort/ort-wasm-simd-threaded.wasm'
    );
    copyFile(
      'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
      'extension/libs/ort/ort-wasm-simd-threaded.mjs'
    );
    // JSEP variants (WebGPU/WebNN) intentionally NOT copied.
    // The offscreen document sets an explicit wasmPaths map that points only to
    // the non-JSEP WASM.  Having the 24MB jsep.wasm present on disk caused ORT
    // to attempt JSEP initialisation in the offscreen context, which has no
    // WebGPU support and no cross-origin isolation — resulting in a >120s hang.

    console.log('Build complete.');
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
