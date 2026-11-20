import { readdirSync, readFileSync } from 'node:fs';
export function readMigrations() {
  return readdirSync('server/migrations').filter(name => /^\d+_.*\.sql$/.test(name)).sort().map(name => [Number(name.split('_')[0]), name.replace(/^\d+_|\.sql$/g, ''), readFileSync(`server/migrations/${name}`, 'utf8')]);
}
