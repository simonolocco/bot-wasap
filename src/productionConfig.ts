export type ProductionConfigIssue = {
  key: string;
  message: string;
};

type Environment = Record<string, string | undefined>;

const PLACEHOLDER = /replace|your_|example\.com|0000000|yyyymmdd|change_me|reemplazar|completar/i;

function clean(env: Environment, key: string) {
  return (env[key] ?? '').trim();
}

function isMissing(value: string) {
  return !value || PLACEHOLDER.test(value);
}

export function validateProductionEnv(env: Environment): ProductionConfigIssue[] {
  const issues: ProductionConfigIssue[] = [];
  const required = [
    'PUBLIC_DOMAIN',
    'APP_IMAGE_TAG',
    'POSTGRES_IMAGE_TAG',
    'POSTGRES_PASSWORD',
    'META_VERIFY_TOKEN',
    'META_APP_SECRET',
    'WHATSAPP_PHONE_ID',
    'WHATSAPP_CLOUD_TOKEN',
    'FORWARD_ORDER_NUMBER',
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD_HASH',
    'SESSION_SECRET',
    'MEDIA_S3_BUCKET',
    'MEDIA_S3_ENDPOINT',
    'BACKUP_S3_BUCKET',
    'BACKUP_S3_ENDPOINT',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'POSTGRES_ARCHIVE_COMMAND',
  ];

  for (const key of required) {
    if (isMissing(clean(env, key))) issues.push({ key, message: 'falta un valor real de producción' });
  }

  const exact = (key: string, expected: string) => {
    const value = clean(env, key).toLowerCase();
    if (value !== expected) issues.push({ key, message: `debe ser ${expected}` });
  };
  exact('WHATSAPP_TRANSPORT', 'cloud');
  exact('ALLOW_UNSIGNED_WEBHOOKS', 'false');
  exact('MEDIA_STORAGE_DRIVER', 's3');
  exact('POSTGRES_ARCHIVE_MODE', 'on');

  const domain = clean(env, 'PUBLIC_DOMAIN');
  if (!isMissing(domain) && (!/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain) || domain.includes('://'))) {
    issues.push({ key: 'PUBLIC_DOMAIN', message: 'debe ser sólo el hostname público, sin https:// ni rutas' });
  }

  for (const key of ['APP_IMAGE_TAG', 'POSTGRES_IMAGE_TAG']) {
    const value = clean(env, key);
    if (!isMissing(value) && (!/^[a-z0-9][a-z0-9_.-]{6,127}$/i.test(value) || /^(latest|local)$/i.test(value))) {
      issues.push({ key, message: 'debe ser un tag inmutable, por ejemplo el commit de 7 caracteres' });
    }
  }

  const minimumLengths: Record<string, number> = {
    POSTGRES_PASSWORD: 20,
    META_VERIFY_TOKEN: 16,
    META_APP_SECRET: 24,
    WHATSAPP_CLOUD_TOKEN: 50,
    SESSION_SECRET: 32,
    AWS_ACCESS_KEY_ID: 12,
    AWS_SECRET_ACCESS_KEY: 24,
  };
  for (const [key, minimum] of Object.entries(minimumLengths)) {
    const value = clean(env, key);
    if (!isMissing(value) && value.length < minimum) issues.push({ key, message: `debe tener al menos ${minimum} caracteres` });
  }

  if (!isMissing(clean(env, 'ADMIN_PASSWORD_HASH')) && !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(clean(env, 'ADMIN_PASSWORD_HASH'))) {
    issues.push({ key: 'ADMIN_PASSWORD_HASH', message: 'debe ser un hash bcrypt válido' });
  }
  for (const key of ['WHATSAPP_PHONE_ID', 'FORWARD_ORDER_NUMBER']) {
    const value = clean(env, key);
    if (!isMissing(value) && !/^\d{8,24}$/.test(value.replace(/^\+/, ''))) issues.push({ key, message: 'debe contener únicamente un identificador o número válido' });
  }
  for (const key of ['MEDIA_S3_ENDPOINT', 'BACKUP_S3_ENDPOINT']) {
    const value = clean(env, key);
    if (!isMissing(value)) {
      try {
        const endpoint = new URL(value);
        if (endpoint.protocol !== 'https:') throw new Error('not https');
      } catch {
        issues.push({ key, message: 'debe ser una URL HTTPS válida' });
      }
    }
  }

  const archiveCommand = clean(env, 'POSTGRES_ARCHIVE_COMMAND');
  if (!isMissing(archiveCommand) && !/\bwal-g\s+wal-push\s+%p\b/.test(archiveCommand)) {
    issues.push({ key: 'POSTGRES_ARCHIVE_COMMAND', message: 'debe ejecutar wal-g wal-push %p' });
  }

  const boundedInteger = (key: string, fallback: number, minimum: number, maximum: number) => {
    const raw = clean(env, key);
    const value = raw ? Number(raw) : fallback;
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      issues.push({ key, message: `debe ser un entero entre ${minimum} y ${maximum}` });
    }
  };
  boundedInteger('WORKER_CONCURRENCY', 16, 4, 64);
  boundedInteger('DB_POOL_MAX', 20, 10, 100);
  boundedInteger('AUTO_RESPONSE_MAX_DELAY_SECONDS', 120, 30, 120);
  boundedInteger('POSTGRES_ARCHIVE_TIMEOUT', 300, 60, 300);

  return issues;
}
