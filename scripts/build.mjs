// Build script: bundles the extension, the standalone eyes bundle and the MCP bridge.
import { build } from 'esbuild';
import { cp, mkdir, rm, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const ext = path.join(dist, 'extension');

await rm(dist, { recursive: true, force: true });
await mkdir(ext, { recursive: true });

const common = {
  bundle: true,
  sourcemap: 'inline',
  logLevel: 'warning',
  legalComments: 'none',
};

await Promise.all([
  // Content script: classic script (no ES modules allowed), runs in every page.
  build({
    ...common,
    entryPoints: [path.join(root, 'src/extension/content.ts')],
    outfile: path.join(ext, 'content.js'),
    format: 'iife',
    target: 'chrome120',
  }),
  // Service worker: ES module.
  build({
    ...common,
    entryPoints: [path.join(root, 'src/extension/background.ts')],
    outfile: path.join(ext, 'background.js'),
    format: 'esm',
    target: 'chrome120',
  }),
  build({
    ...common,
    entryPoints: [path.join(root, 'src/extension/options.ts')],
    outfile: path.join(ext, 'options.js'),
    format: 'iife',
    target: 'chrome120',
  }),
  // Standalone eyes: injected over CDP in headless / VPS / worker modes and in tests.
  build({
    ...common,
    sourcemap: false,
    entryPoints: [path.join(root, 'src/eyes/standalone.ts')],
    outfile: path.join(dist, 'eyes.iife.js'),
    format: 'iife',
    target: 'chrome120',
  }),
  // MCP bridge: single-file Node program, no runtime dependencies.
  build({
    ...common,
    sourcemap: false,
    entryPoints: [path.join(root, 'src/bridge/main.ts')],
    outfile: path.join(dist, 'bridge/klippy-mcp.js'),
    platform: 'node',
    format: 'esm',
    target: 'node20',
    banner: {
      js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
    external: ['bufferutil', 'utf-8-validate'],
  }),
]);

await cp(path.join(root, 'src/extension/manifest.json'), path.join(ext, 'manifest.json'));
await cp(path.join(root, 'src/extension/options.html'), path.join(ext, 'options.html'));
await chmod(path.join(dist, 'bridge/klippy-mcp.js'), 0o755);

console.log('built ->', path.relative(root, dist));
