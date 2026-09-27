/** 打包并依次运行 test/ 下的数据层测试（Node + fake-indexeddb，无需浏览器） */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const outDir = join('node_modules', '.cache', 'gbfossilprep-tests');
mkdirSync(outDir, { recursive: true });

const tests = readdirSync('test').filter((f) => f.endsWith('.test.ts') || f.endsWith('.test.tsx'));
if (tests.length === 0) {
  console.error('test/ 下没有测试文件');
  process.exit(1);
}

let failed = 0;
for (const t of tests) {
  const out = join(outDir, `${t.replace(/\.tsx?$/, '')}.mjs`);
  await build({
    entryPoints: [join('test', t)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: out,
    loader: { '.tsx': 'tsx', '.ts': 'ts' },
    // 优先解析 ESM 入口，避免 MUI CJS 的 default 互操作把组件包成命名空间对象
    mainFields: ['module', 'main'],
    // 图标深路径只会命中 CJS，重定向到 esm 目录
    alias: { '@mui/icons-material': '@mui/icons-material/esm' },
    // jsdom 含动态 require，保持外部依赖由 node 运行时解析
    external: ['jsdom'],
    logLevel: 'warning',
  });
  console.log(`\n=== ${t} ===`);
  const r = spawnSync(process.execPath, [out], { stdio: 'inherit' });
  if (r.status !== 0) failed = 1;
}
process.exit(failed);
