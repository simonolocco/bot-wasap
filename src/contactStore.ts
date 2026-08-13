import fs from 'node:fs';
import path from 'node:path';

export type ConsentStatus = 'unknown' | 'opted_in' | 'opted_out';

export type ContactMessage = {
  direction: 'incoming' | 'outgoing';
  text: string;
  at: string;
};

const MAX_STORED_MESSAGES = 30;

export type Contact = {
  id: string;
  phone: string;
  countryCode: string;
  name: string;
  publicName: string;
  isMyContact: boolean;
  isBusiness: boolean;
  labels: string[];
  consentStatus: ConsentStatus;
  consentSource: string | null;
  consentAt: string | null;
  optOutAt: string | null;
  notes: string;
  lastMessages: ContactMessage[];
  createdAt: string;
  updatedAt: string;
};

type ImportedRow = Record<string, unknown>;

const DATA_DIR = path.join(process.cwd(), 'data');
const CONTACTS_FILE = path.join(DATA_DIR, 'campaign_contacts.json');
const contacts = new Map<string, Contact>();

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function bool(value: unknown): boolean {
  return ['true', '1', 'si', 'sí', 'yes'].includes(text(value).toLowerCase());
}

function parseLabels(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const raw = text(value);
  if (!raw || raw === '[]') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [raw];
  } catch {
    return raw.split(',').map(x => x.trim()).filter(Boolean);
  }
}

export function normalizePhone(phoneValue: unknown, countryCodeValue?: unknown): string {
  let phone = text(phoneValue).replace(/\D/g, '');
  if (phone.startsWith('00')) phone = phone.slice(2);
  const countryCode = text(countryCodeValue).replace(/\D/g, '');
  if (countryCode && phone && !phone.startsWith(countryCode)) phone = `${countryCode}${phone}`;
  return phone;
}

function saveContacts() {
  ensureDataDir();
  fs.writeFileSync(CONTACTS_FILE, JSON.stringify(Array.from(contacts.values()), null, 2));
}

function loadContacts() {
  try {
    if (!fs.existsSync(CONTACTS_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8')) as unknown;
    if (!Array.isArray(raw)) return;
    for (const value of raw) {
      const contact = value as Partial<Contact>;
      if (!contact.id || !contact.phone) continue;
      contacts.set(contact.id, {
        id: contact.id,
        phone: contact.phone,
        countryCode: contact.countryCode ?? '',
        name: contact.name ?? '',
        publicName: contact.publicName ?? '',
        isMyContact: Boolean(contact.isMyContact),
        isBusiness: Boolean(contact.isBusiness),
        labels: Array.isArray(contact.labels) ? contact.labels.map(text).filter(Boolean) : [],
        consentStatus: contact.consentStatus ?? 'unknown',
        consentSource: contact.consentSource ?? null,
        consentAt: contact.consentAt ?? null,
        optOutAt: contact.optOutAt ?? null,
        notes: contact.notes ?? '',
        lastMessages: Array.isArray(contact.lastMessages) ? contact.lastMessages.slice(-MAX_STORED_MESSAGES) : [],
        createdAt: contact.createdAt ?? new Date().toISOString(),
        updatedAt: contact.updatedAt ?? new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('[contacts] No se pudo cargar campaign_contacts.json:', error);
  }
}

loadContacts();

export function listContacts(): Contact[] {
  return Array.from(contacts.values()).sort((a, b) => {
    const aName = a.name || a.publicName || a.phone;
    const bName = b.name || b.publicName || b.phone;
    return aName.localeCompare(bName, 'es');
  });
}

export function getContact(id: string): Contact | null {
  return contacts.get(id) ?? null;
}

export function importContacts(rows: ImportedRow[], source: string): { imported: number; created: number; updated: number; skipped: number } {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const row of rows) {
    const phone = normalizePhone(row.phone_number ?? row.formatted_phone, row.country_code);
    if (!phone || phone.length < 8) {
      skipped++;
      continue;
    }

    const previous = contacts.get(phone);
    const contact: Contact = {
      id: phone,
      phone,
      countryCode: text(row.country_code),
      name: text(row.saved_name),
      publicName: text(row.public_name),
      isMyContact: bool(row.is_my_contact),
      isBusiness: bool(row.is_business),
      labels: parseLabels(row.labels),
      consentStatus: previous?.consentStatus ?? 'unknown',
      consentSource: previous?.consentSource ?? null,
      consentAt: previous?.consentAt ?? null,
      optOutAt: previous?.optOutAt ?? null,
      notes: previous?.notes ?? '',
      lastMessages: previous?.lastMessages ?? [],
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    contacts.set(phone, contact);
    if (previous) updated++;
    else created++;
  }

  saveContacts();
  return { imported: created + updated, created, updated, skipped };
}

export function recordContactMessage(
  phoneValue: unknown,
  profileName: string | undefined,
  direction: ContactMessage['direction'],
  messageText: string,
): Contact | null {
  const phone = normalizePhone(phoneValue);
  if (!phone || phone.length < 8) return null;

  const now = new Date().toISOString();
  const previous = contacts.get(phone);
  const message: ContactMessage = {
    direction,
    text: String(messageText || `[Mensaje ${direction === 'incoming' ? 'recibido' : 'enviado'}]`).slice(0, 2000),
    at: now,
  };
  const contact: Contact = previous ?? {
    id: phone,
    phone,
    countryCode: phone.startsWith('54') ? '54' : '',
    name: '',
    publicName: '',
    isMyContact: false,
    isBusiness: false,
    labels: [],
    consentStatus: 'unknown',
    consentSource: null,
    consentAt: null,
    optOutAt: null,
    notes: '',
    lastMessages: [],
    createdAt: now,
    updatedAt: now,
  };

  if (profileName?.trim() && !contact.name) contact.name = profileName.trim();
  contact.lastMessages = [...contact.lastMessages, message].slice(-MAX_STORED_MESSAGES);
  contact.updatedAt = now;
  contacts.set(phone, contact);
  saveContacts();
  return contact;
}

export function updateContact(id: string, patch: Partial<Pick<Contact, 'name' | 'publicName' | 'notes' | 'consentStatus' | 'consentSource'>>): Contact | null {
  const contact = contacts.get(id);
  if (!contact) return null;
  const now = new Date().toISOString();
  if (patch.name !== undefined) contact.name = text(patch.name);
  if (patch.publicName !== undefined) contact.publicName = text(patch.publicName);
  if (patch.notes !== undefined) contact.notes = text(patch.notes);
  if (patch.consentSource !== undefined) contact.consentSource = text(patch.consentSource) || null;
  if (patch.consentStatus !== undefined) {
    contact.consentStatus = patch.consentStatus;
    if (patch.consentStatus === 'opted_in') {
      contact.consentAt = now;
      contact.optOutAt = null;
    }
    if (patch.consentStatus === 'opted_out') contact.optOutAt = now;
  }
  contact.updatedAt = now;
  saveContacts();
  return contact;
}

export function updateContactsConsent(ids: string[], status: ConsentStatus, source: string): number {
  let changed = 0;
  for (const id of ids) {
    if (updateContactWithoutSave(id, { consentStatus: status, consentSource: source })) changed++;
  }
  if (changed > 0) saveContacts();
  return changed;
}

function updateContactWithoutSave(id: string, patch: Pick<Contact, 'consentStatus' | 'consentSource'>): Contact | null {
  const contact = contacts.get(id);
  if (!contact) return null;
  const now = new Date().toISOString();
  contact.consentStatus = patch.consentStatus;
  contact.consentSource = text(patch.consentSource) || null;
  contact.updatedAt = now;
  if (patch.consentStatus === 'opted_in') {
    contact.consentAt = now;
    contact.optOutAt = null;
  }
  if (patch.consentStatus === 'opted_out') contact.optOutAt = now;
  return contact;
}

export function getContactStats() {
  const all = listContacts();
  return {
    total: all.length,
    optedIn: all.filter(c => c.consentStatus === 'opted_in').length,
    unknown: all.filter(c => c.consentStatus === 'unknown').length,
    optedOut: all.filter(c => c.consentStatus === 'opted_out').length,
    withName: all.filter(c => Boolean(c.name || c.publicName)).length,
  };
}
