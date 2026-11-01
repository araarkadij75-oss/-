import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
export const suites = {
  core: ['static-contract', 'ui-control-integrity', 'runtime-module-isolation'],
  orders: ['order-form-permissions', 'filter-catalog-performance', 'city-preservation', 'ui-control-integrity'],
  staff: ['group-performance', 'order-form-permissions'],
  payroll: ['cross-module-accounting', 'payroll-audit', 'payroll-ui', 'profit-accounting', 'profit-ui'],
  finance: ['cross-module-accounting', 'avito-profit', 'profit-accounting', 'profit-ui', 'payroll-audit'],
  analytics: ['analytics-cash-drill', 'group-performance', 'filter-catalog-performance', 'profit-accounting'],
  imports: ['avito-profit', 'city-preservation', 'data-quality-audit', 'ui-control-integrity'],
  quality: ['quality-monitor', 'data-quality-audit', 'ai-audit', 'server-quality'],
  integrations: ['telegram-errors', 'telegram-privacy', 'telegram-status-reset', 'server-quality'],
  settings: ['order-form-permissions', 'group-performance', 'static-contract'],
  ui: ['ui-control-integrity', 'payroll-ui', 'profit-ui', 'runtime-module-isolation'],
};

const requested = process.argv.slice(2);
if (requested.includes('--list') || !requested.length) {
  console.log('Модули: ' + Object.keys(suites).join(', '));
  console.log('Пример: npm run test:module -- payroll finance');
  process.exit(requested.length ? 0 : 1);
}
for (const name of requested) {
  if (!Object.hasOwn(suites, name)) {
    console.error('Неизвестный модуль: ' + name);
    process.exit(1);
  }
}
const build = spawnSync(process.execPath, ['scripts/build-crm.mjs', '--check'], {cwd, stdio: 'inherit'});
if (build.status !== 0) process.exit(build.status || 1);
const tests = [...new Set(['runtime-module-isolation', 'module-navigation-audit', ...requested.flatMap(name => suites[name])])];
const result = spawnSync(process.execPath, ['--test', ...tests.map(name => `tests/${name}.test.mjs`)], {cwd, stdio: 'inherit'});
process.exit(result.status || (result.error ? 1 : 0));
