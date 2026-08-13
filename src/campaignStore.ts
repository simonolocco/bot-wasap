import fs from 'node:fs';
import path from 'node:path';

export type TemplateStatus = 'draft' | 'pending' | 'approved' | 'paused' | 'rejected';
export type TemplateCategory = 'MARKETING' | 'UTILITY';

export type MessageTemplate = {
  id: string;
  metaName: string;
  language: string;
  category: TemplateCategory;
  body: string;
  variables: string[];
  status: TemplateStatus;
  createdAt: string;
  updatedAt: string;
};

export type CampaignStatus = 'dry_run' | 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

export type CampaignRecord = {
  id: string;
  templateId: string;
  mode: 'dry-run' | 'live';
  contactIds: string[];
  status: CampaignStatus;
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  errors: string[];
  createdAt: string;
  finishedAt: string | null;
};

const DATA_DIR = path.join(process.cwd(), 'data');
const TEMPLATES_FILE = path.join(DATA_DIR, 'campaign_templates.json');
const CAMPAIGNS_FILE = path.join(DATA_DIR, 'campaigns.json');
const templates = new Map<string, MessageTemplate>();
const campaigns = new Map<string, CampaignRecord>();

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadFile<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function saveTemplates() {
  ensureDataDir();
  fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(Array.from(templates.values()), null, 2));
}

function saveCampaigns() {
  ensureDataDir();
  fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify(Array.from(campaigns.values()), null, 2));
}

for (const template of loadFile<MessageTemplate[]>(TEMPLATES_FILE, [])) {
  if (template?.id && template.metaName) templates.set(template.id, template);
}
for (const campaign of loadFile<CampaignRecord[]>(CAMPAIGNS_FILE, [])) {
  if (campaign?.id) campaigns.set(campaign.id, campaign);
}

export function listTemplates(): MessageTemplate[] {
  return Array.from(templates.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getTemplate(id: string): MessageTemplate | null {
  return templates.get(id) ?? null;
}

export function saveTemplate(input: Partial<MessageTemplate> & Pick<MessageTemplate, 'metaName' | 'language' | 'category' | 'body'>): MessageTemplate {
  const now = new Date().toISOString();
  const id = input.id ?? `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const previous = templates.get(id);
  const template: MessageTemplate = {
    id,
    metaName: input.metaName.trim(),
    language: input.language.trim() || 'es_AR',
    category: input.category,
    body: input.body.trim(),
    variables: Array.isArray(input.variables) ? input.variables.map(x => String(x).trim()).filter(Boolean) : [],
    status: input.status ?? previous?.status ?? 'draft',
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  templates.set(id, template);
  saveTemplates();
  return template;
}

export function deleteTemplate(id: string): boolean {
  const deleted = templates.delete(id);
  if (deleted) saveTemplates();
  return deleted;
}

export function listCampaigns(): CampaignRecord[] {
  return Array.from(campaigns.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createCampaign(input: Omit<CampaignRecord, 'createdAt' | 'finishedAt' | 'sent' | 'skipped' | 'failed' | 'errors'>): CampaignRecord {
  const campaign: CampaignRecord = {
    ...input,
    sent: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  campaigns.set(campaign.id, campaign);
  saveCampaigns();
  return campaign;
}

export function updateCampaign(id: string, patch: Partial<CampaignRecord>): CampaignRecord | null {
  const campaign = campaigns.get(id);
  if (!campaign) return null;
  Object.assign(campaign, patch);
  saveCampaigns();
  return campaign;
}
