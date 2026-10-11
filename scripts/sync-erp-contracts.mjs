#!/usr/bin/env node
// Sincroniza con el ERP (https://github.com/elvisromano14/erp-galaxy) lo que la app comparte con el backend:
//   · contrato OpenAPI y tipos generados  → src/vendor/erp/
//   · lógica de dominio (totales, RIF, …) → src/vendor/erp-domain/   (mismo código que calcula el servidor)
// y fija el commit del ERP en erp-contract.json.
//
//   node scripts/sync-erp-contracts.mjs [--erp <ruta al repo del ERP>]          copia y actualiza el pin
//   node scripts/sync-erp-contracts.mjs --check --erp <ruta>                    falla si lo vendorizado difiere
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const erpArg = args.indexOf('--erp');
const erp = path.resolve(erpArg >= 0 ? args[erpArg + 1] : (process.env.ERP_PATH ?? path.join(root, '..', 'Web', 'mini-erp')));

const FILES = [
  ['packages/api-client/openapi.json', 'src/vendor/erp/openapi.json'],
  ['packages/api-client/src/schema.d.ts', 'src/vendor/erp/schema.d.ts'],
  ...['index', 'decimal', 'totals', 'costing', 'rif'].map((f) => [`packages/domain/src/${f}.ts`, `src/vendor/erp-domain/${f}.ts`]),
];

if (!existsSync(path.join(erp, 'packages', 'api-client'))) {
  console.error(`No encuentro el repositorio del ERP en ${erp} (use --erp <ruta> o ERP_PATH).`);
  process.exit(2);
}

let diffs = 0;
for (const [from, to] of FILES) {
  const src = path.join(erp, from);
  const dst = path.join(root, to);
  if (check) {
    if (!existsSync(dst) || !readFileSync(src).equals(readFileSync(dst))) { console.error(`✘ desactualizado: ${to}`); diffs++; }
  } else {
    mkdirSync(path.dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    console.log(`✔ ${to}`);
  }
}

if (check) {
  if (diffs) { console.error('\nEjecute `pnpm contracts:sync` y confirme los cambios.'); process.exit(1); }
  console.log('Contratos del ERP al día.');
} else {
  let commit = 'desconocido';
  try { commit = execFileSync('git', ['-C', erp, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* sin git */ }
  writeFileSync(path.join(root, 'erp-contract.json'), JSON.stringify({ repo: 'https://github.com/elvisromano14/erp-galaxy', commit }, null, 2) + '\n');
  console.log(`Fijado ERP @ ${commit}`);
}
