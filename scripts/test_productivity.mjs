import { spawnSync } from 'node:child_process';
const checks = ['test_server_storage.mjs', 'test_templates.mjs', 'test_recurrence.mjs', 'test_automations.mjs', 'test_projects.mjs', 'test_obligations.mjs', 'test_attention.mjs', 'test_startup.mjs', 'test_productivity_migrations.mjs', 'test_search.mjs'];
for (const check of checks) {
  const result = spawnSync(process.execPath, [`scripts/${check}`], { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`All ${checks.length} isolated productivity/domain checks passed.`);
