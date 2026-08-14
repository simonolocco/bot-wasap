import assert from 'node:assert/strict';
import { validateProductionEnv } from '../src/productionConfig';

const valid = {
  PUBLIC_DOMAIN: 'bot.example.org',
  APP_IMAGE_TAG: 'abcdef1',
  POSTGRES_IMAGE_TAG: 'abcdef1',
  POSTGRES_PASSWORD: 'a-very-long-database-password',
  META_VERIFY_TOKEN: 'verify-token-with-length',
  META_APP_SECRET: '12345678901234567890123456789012',
  WHATSAPP_PHONE_ID: '123456789012345',
  WHATSAPP_CLOUD_TOKEN: 'x'.repeat(80),
  WHATSAPP_TRANSPORT: 'cloud',
  ALLOW_UNSIGNED_WEBHOOKS: 'false',
  FORWARD_ORDER_NUMBER: '5493512345678',
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD_HASH: '$2b$12$ZfhkAvQVprwIjp2gttyYk.OZqkMNKEzUjP0ZwEknbRcHHRolgRwVm',
  SESSION_SECRET: 'a'.repeat(48),
  MEDIA_STORAGE_DRIVER: 's3',
  MEDIA_S3_BUCKET: 'bot-media',
  MEDIA_S3_ENDPOINT: 'https://s3.example.org',
  BACKUP_S3_BUCKET: 'bot-backups',
  BACKUP_S3_ENDPOINT: 'https://s3.example.org',
  AWS_ACCESS_KEY_ID: 'access-key-id-123',
  AWS_SECRET_ACCESS_KEY: 'secret-access-key-with-enough-length',
  POSTGRES_ARCHIVE_MODE: 'on',
  POSTGRES_ARCHIVE_COMMAND: 'wal-g wal-push %p',
  POSTGRES_ARCHIVE_TIMEOUT: '300',
  WORKER_CONCURRENCY: '16',
  DB_POOL_MAX: '20',
  AUTO_RESPONSE_MAX_DELAY_SECONDS: '120',
};

assert.deepEqual(validateProductionEnv(valid), []);
assert(validateProductionEnv({ ...valid, WHATSAPP_TRANSPORT: 'mock' }).some(issue => issue.key === 'WHATSAPP_TRANSPORT'));
assert(validateProductionEnv({ ...valid, MEDIA_STORAGE_DRIVER: 'local' }).some(issue => issue.key === 'MEDIA_STORAGE_DRIVER'));
assert(validateProductionEnv({ ...valid, POSTGRES_ARCHIVE_MODE: 'off' }).some(issue => issue.key === 'POSTGRES_ARCHIVE_MODE'));
assert(validateProductionEnv({ ...valid, APP_IMAGE_TAG: 'latest' }).some(issue => issue.key === 'APP_IMAGE_TAG'));
assert(validateProductionEnv({ ...valid, BACKUP_S3_ENDPOINT: 'http://insecure.example.org' }).some(issue => issue.key === 'BACKUP_S3_ENDPOINT'));
assert(validateProductionEnv({ ...valid, SESSION_SECRET: 'short' }).some(issue => issue.key === 'SESSION_SECRET'));

console.log('production config tests: OK');
