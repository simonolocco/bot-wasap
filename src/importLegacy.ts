/** One-off JSON -> PostgreSQL import. Safe to run multiple times. */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { closePool, query, transaction } from './db/pool';
import { upsertContact } from './db/repository';

function load<T>(name: string, fallback: T): T {
  const file = path.join(process.cwd(), 'data', name);
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return fallback; }
}
const asDate = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : new Date().toISOString();

async function main() {
  const counters = { contacts: 0, messages: 0, orders: 0, templates: 0, campaigns: 0 };
  for (const legacy of load<any[]>('campaign_contacts.json', [])) {
    const phone = String(legacy.phone ?? legacy.id ?? '').replace(/\D/g, ''); if (phone.length < 8) continue;
    await transaction(async client => {
      const contact = await upsertContact(client, phone, legacy.name || legacy.publicName, { markIncoming: false });
      const messages = Array.isArray(legacy.lastMessages) ? legacy.lastMessages : [];
      const lastMessageAt = messages.length > 0 ? asDate(messages[messages.length - 1]?.at) : null;
      await client.query(`UPDATE contacts SET public_name=$2,is_my_contact=$3,is_business=$4,labels=$5::jsonb,consent_status=$6,consent_source=$7,consent_at=$8,opt_out_at=$9,notes=$10,first_seen_at=$11,updated_at=$12,last_message_at=COALESCE($13,last_message_at) WHERE id=$1`,
        [contact.id, String(legacy.publicName ?? ''), Boolean(legacy.isMyContact), Boolean(legacy.isBusiness), JSON.stringify(Array.isArray(legacy.labels) ? legacy.labels : []), ['unknown','opted_in','opted_out'].includes(legacy.consentStatus) ? legacy.consentStatus : 'unknown', legacy.consentSource || null, legacy.consentAt || null, legacy.optOutAt || null, String(legacy.notes ?? ''), asDate(legacy.createdAt), asDate(legacy.updatedAt), lastMessageAt]);
      for (let index = 0; index < messages.length; index++) {
        const message = messages[index]; const at = asDate(message.at); const direction = message.direction === 'outgoing' ? 'outgoing' : 'incoming';
        await client.query(`INSERT INTO messages (contact_id,direction,body,message_type,outbound_key,delivery_status,created_at,sent_at) VALUES ($1,$2,$3,'text',$4,$5,$6,$7) ON CONFLICT (outbound_key) DO NOTHING`,
          [contact.id, direction, String(message.text ?? ''), `legacy:${phone}:${index}:${at}`, direction === 'outgoing' ? 'sent' : null, at, direction === 'outgoing' ? at : null]);
        counters.messages++;
      }
      await client.query(`UPDATE contacts SET last_message_at=(SELECT max(created_at) FROM messages WHERE contact_id=$1),
        last_incoming_at=(SELECT max(created_at) FROM messages WHERE contact_id=$1 AND direction='incoming'),
        last_outgoing_at=(SELECT max(created_at) FROM messages WHERE contact_id=$1 AND direction='outgoing'), unread_count=0, updated_at=now() WHERE id=$1`, [contact.id]);
      counters.contacts++;
    });
  }
  const state = load<any>('conversation_state.json', {});
  const names = new Map<string, string>(Array.isArray(state.chatNames) ? state.chatNames.filter((entry: unknown) => Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') : []);
  for (const chatId of new Set([...(state.greetedChats ?? []), ...(state.awaitingOrderDetail ?? []), ...names.keys()])) {
    const phone = String(chatId).replace(/\D/g, ''); if (phone.length < 8) continue;
    await transaction(async client => {
      const contact = await upsertContact(client, phone, names.get(chatId), { markIncoming: false });
      await client.query(`INSERT INTO bot_sessions (contact_id,greeted,awaiting_order_detail,display_name) VALUES ($1,$2,$3,$4) ON CONFLICT (contact_id) DO UPDATE SET greeted=EXCLUDED.greeted,awaiting_order_detail=EXCLUDED.awaiting_order_detail,display_name=EXCLUDED.display_name,updated_at=now()`, [contact.id, (state.greetedChats ?? []).includes(chatId), (state.awaitingOrderDetail ?? []).includes(chatId), names.get(chatId) ?? '']);
    });
  }
  for (const order of load<any[]>('orders.json', [])) {
    const phone = String(order.chat_id ?? '').replace(/\D/g, ''); let contactId: string | null = null;
    if (phone.length >= 8) contactId = (await query<{ id: string }>('SELECT id FROM contacts WHERE phone=$1', [phone])).rows[0]?.id ?? null;
    await query(`INSERT INTO orders (id,contact_id,customer_name,detail,items,grand_total,status,accepted,accepted_at,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`, [Number(order.id), contactId, order.customer_name || null, String(order.detail ?? ''), JSON.stringify(Array.isArray(order.items) ? order.items : []), Number(order.grandTotal ?? 0), ['pending_customer','submitted','canceled','accepted'].includes(order.status) ? order.status : 'submitted', Boolean(order.accepted), order.accepted_at || null, asDate(order.created_at)]);
    counters.orders++;
  }
  await query(`SELECT setval(pg_get_serial_sequence('orders','id'), COALESCE((SELECT max(id) FROM orders), 1), true)`);
  const templateIds = new Map<string, string>();
  for (const template of load<any[]>('campaign_templates.json', [])) {
    await query(`INSERT INTO templates (meta_name,language,category,body,variables,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) ON CONFLICT (meta_name) DO NOTHING`, [String(template.metaName), String(template.language || 'es_AR'), template.category === 'UTILITY' ? 'UTILITY' : 'MARKETING', String(template.body || ''), JSON.stringify(Array.isArray(template.variables) ? template.variables : []), ['draft','pending','approved','paused','rejected'].includes(template.status) ? template.status : 'draft', asDate(template.createdAt), asDate(template.updatedAt)]);
    const saved = await query<{ id: string }>('SELECT id FROM templates WHERE meta_name=$1', [String(template.metaName)]); if (template.id && saved.rows[0]) templateIds.set(String(template.id), saved.rows[0].id); counters.templates++;
  }
  for (const campaign of load<any[]>('campaigns.json', [])) {
    const legacyKey = String(campaign.id ?? `campaign:${campaign.createdAt ?? ''}:${campaign.templateId ?? ''}`);
    await query(`INSERT INTO campaigns (legacy_key,template_id,mode,status,filters,total,sent,skipped,failed,errors,created_at,finished_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10::jsonb,$11,$12) ON CONFLICT (legacy_key) WHERE legacy_key IS NOT NULL DO NOTHING`, [legacyKey, templateIds.get(String(campaign.templateId ?? '')) ?? null, campaign.mode === 'live' ? 'live' : campaign.mode === 'dry-run' ? 'dry_run' : 'draft', ['dry_run','queued','running','completed','failed','canceled'].includes(campaign.status) ? campaign.status : 'draft', '{}', Number(campaign.total ?? 0), Number(campaign.sent ?? 0), Number(campaign.skipped ?? 0), Number(campaign.failed ?? 0), JSON.stringify(Array.isArray(campaign.errors) ? campaign.errors : []), asDate(campaign.createdAt), campaign.finishedAt || null]);
    counters.campaigns++;
  }
  console.log('[import-legacy] Importación finalizada:', counters);
}
main().then(closePool).catch(async error => { console.error('[import-legacy] Error:', error); await closePool(); process.exit(1); });
