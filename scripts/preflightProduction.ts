import 'dotenv/config';
import { validateProductionEnv } from '../src/productionConfig';

const issues = validateProductionEnv(process.env);

if (issues.length > 0) {
  console.error('Producción bloqueada: la configuración todavía no es segura.');
  for (const issue of issues) console.error(`- ${issue.key}: ${issue.message}`);
  console.error('No se mostró ningún valor ni secreto. Corregí el .env y repetí npm run production:preflight.');
  process.exit(1);
}

console.log('Preflight de producción: OK');
console.log('Meta Cloud, PostgreSQL, almacenamiento S3, backups y WAL archivado están configurados explícitamente.');
