#!/usr/bin/env node
/**
 * Windows build patch for DeepSeek Harness.
 *
 * The upstream repo is Linux-first: it ships Linux-only prebuilt native
 * packages (native/landlock-run/packages/linux-{x64,arm64}) and links them as
 * workspace members. On Windows, pnpm cannot link these (UNKNOWN open during
 * the link step) and they are not needed for `dsh web` anyway.
 *
 * This script is applied ONLY for the Windows build so the Linux/Docker (fnOS)
 * image keeps the full upstream workspace config (including the real landlock
 * sandbox). Run it from the deepseek-harness checkout root BEFORE pnpm install.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = process.argv[2] || process.cwd();
const log = (m) => console.log('[win-patch] ' + m);

function read(p) {
  return fs.readFileSync(path.join(root, p), 'utf8');
}
function write(p, s) {
  fs.writeFileSync(path.join(root, p), s);
  log('patched ' + p);
}

// 1) pnpm-workspace.yaml: keep landlock entry but drop the Linux prebuilts,
//    re-include the entry package, and allow the esbuild platform binary build.
{
  const f = 'pnpm-workspace.yaml';
  let s = read(f);
  if (!s.includes('native/landlock-run/packages/entry')) {
    s = s.replace(
      /  - native\/landlock-run\n(  # - native\/landlock-run\/packages\/\*\n)?/,
      "  - native/landlock-run\n  # - native/landlock-run/packages/*\n" +
        '  # Re-include only the entry package (linux sub-deps are patched out below).\n' +
        '  - native/landlock-run/packages/entry\n'
    );
  }
  if (!s.includes('@esbuild/win32-x64')) {
    s = s.replace(
      /(allowBuilds:\n  esbuild: true\n)/,
      "$1  # Windows build needs the platform binary postinstall.\n  '@esbuild/win32-x64': true\n"
    );
  }
  // koffi is only for the Linux landlock FFI; skip it on Windows.
  if (!s.includes('koffi: false') && s.includes('allowBuilds:')) {
    s = s.replace(
      /(  # JSONL durability[\s\S]*?koffi: )\w+/,
      '$1false'
    );
  }
  write(f, s);
}

// 2) entry package.json: drop the Linux-only optionalDependencies so the
//    workspace link step never references the missing linux/arm64+x64 packages.
{
  const f = 'native/landlock-run/packages/entry/package.json';
  const pkg = JSON.parse(read(f));
  if (pkg.optionalDependencies) {
    delete pkg.optionalDependencies[
      '@deepseek-ai/node-addon-landlock-run-linux-arm64'
    ];
    delete pkg.optionalDependencies[
      '@deepseek-ai/node-addon-landlock-run-linux-x64'
    ];
    write(f, JSON.stringify(pkg, null, 2) + '\n');
  }
}

// 3) .npmrc: npmmirror for speed + allow hoisted linking on Windows.
{
  const f = '.npmrc';
  const lines = [
    'registry=https://registry.npmmirror.com/',
    '@npm:registry=https://registry.npmmirror.com/',
    'electron_mirror=https://registry.npmmirror.com/-/binary/electron/',
    'electron_builder_binaries_mirror=https://registry.npmmirror.com/-/binary/electron-builder-binaries/',
  ];
  let s = fs.existsSync(path.join(root, f))
    ? read(f)
    : '';
  for (const l of lines) {
    if (!s.split('\n').some((x) => x.trim() === l)) {
      s += (s.endsWith('\n') || s === '' ? '' : '\n') + l + '\n';
    }
  }
  write(f, s);
}

log('done');
