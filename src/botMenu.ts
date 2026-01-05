export type MenuOptionId = 'horarios' | 'direccion' | 'lista_precio' | 'hacer_pedido' | 'asesor';

export type MenuOption = {
  id: MenuOptionId;
  label: string;
  number: string;
  keywords: string[];
};

const DISTRIBUTOR_NAME = process.env.DISTRIBUTOR_NAME ?? 'Distribuidora Abasot del campo';
const BOT_FRIENDLY_NAME = process.env.BOT_FRIENDLY_NAME ?? 'AbastoBot';

const CATALOG_MAYORISTA_URL =
  process.env.CATALOG_MAYORISTA_URL ?? 'https://catalogo.mi-distribuidora.com/catalogo-mayorista.html';
const CATALOG_MINORISTA_URL =
  process.env.CATALOG_MINORISTA_URL ?? 'https://catalogo.mi-distribuidora.com/catalogo-minorista.html';

export const MENU_HEADER_TEXT = '👋 ¡Hola! Bienvenido';
// export const MENU_HEADER_IMAGE = 'https://example.com/logo.jpg'; // Descomentar y poner URL real si se desea imagen

export const MAIN_MENU_OPTIONS: MenuOption[] = [
  { id: 'horarios', label: '📅 Horarios', number: '1', keywords: ['horario', 'horarios', '1'] },
  { id: 'direccion', label: '📍 Dirección', number: '2', keywords: ['direccion', 'ubicacion', '2'] },
  { id: 'lista_precio', label: '💲 Precios', number: '3', keywords: ['lista', 'precios', 'catalogo', '3'] },
  { id: 'hacer_pedido', label: '📝 Nuevo Pedido', number: '4', keywords: ['hacer pedido', '4'] },
  { id: 'asesor', label: '👤 Asesor Humano', number: '5', keywords: ['asesor', 'comercial', '5'] },
];

export const BUSINESS_SCHEDULE = [
  '🕒 *Nuestros Horarios*',
  '━━━━━━━━━━━━',
  '*Lunes:* 8:15 a 16:00',
  '*Martes:* 8:15 a 16:00',
  '*Miércoles:* 8:15 a 16:00',
  '*Jueves:* 8:15 a 16:00',
  '*Viernes:* 8:15 a 16:00',
  '*Sábado:* 08:15 - 12:45',
  '*Domingo:* Cerrado',
].join('\n');
export const BUSINESS_ADDRESS = '📍 *Dirección*\n━━━━━━━━━━━━\nAv. Juan B. Justo00000 5048\nCórdoba, Argentina\n\n🗺️ *Ver en mapa:*\nhttps://maps.app.goo.gl/gCfNiJEz9Q7k4LzS6';

export const MENU_PROMPT = '¿En qué podemos ayudarte hoy? 👇';
export const MENU_SECTION_TITLE = 'Seleccioná una opción';
export const MENU_BUTTON_LABEL = 'Abrir Menú';

const NUMBER_EMOJIS: Record<string, string> = {
  '1': '\u0031\uFE0F\u20E3',
  '2': '\u0032\uFE0F\u20E3',
  '3': '\u0033\uFE0F\u20E3',
  '4': '\u0034\uFE0F\u20E3',
  '5': '\u0035\uFE0F\u20E3',
};

const MENU_OPTION_DESCRIPTIONS: Record<MenuOptionId, string> = {
  horarios: 'Consultar horarios de atencion',
  direccion: 'Ver direccion y zona de entrega',
  lista_precio: 'Descargar la lista actualizada',
  hacer_pedido: 'Enviar productos para armar pedido',
  asesor: 'Derivarme a un asesor humano',
};

export function buildMenuBody(): string {
  // Description used in the body of the interactive message (below the header, above the button)
  return 'Elegí una opción del menú para comenzar.';
}

export function buildMenuText(): string {
  return buildMenuBody();
}

export function formatPriceListMessage(): string {
  return [
    '📂 *Listas de Precios*',
    '━━━━━━━━━━━━',
    'Acá tenés los catálogos actualizados:',
    '',
    `🏭 *Mayorista:*\n${CATALOG_MAYORISTA_URL}`,
    '',
    `🛒 *Minorista:*\n${CATALOG_MINORISTA_URL}`,
  ].join('\n');
}

export function normalizeText(input: string | undefined | null): string {
  if (!input) return '';
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveOptionIdFromText(text: string | undefined | null): MenuOptionId | undefined {
  const normalized = normalizeText(text);
  if (!normalized) return undefined;

  const firstToken = normalized.split(' ')[0];
  const byNumber = MAIN_MENU_OPTIONS.find((opt) => opt.number === firstToken);
  if (byNumber) return byNumber.id;

  const directMatch = MAIN_MENU_OPTIONS.find((opt) => opt.keywords.some((kw) => normalized === kw));
  if (directMatch) return directMatch.id;

  return MAIN_MENU_OPTIONS.find((opt) => normalized.includes(opt.label.toLowerCase()))?.id;
}

export function buildMenuListSections(): Array<{
  title: string;
  rows: Array<{ id: string; title: string; description?: string }>;
}> {
  return [
    {
      title: MENU_SECTION_TITLE,
      rows: MAIN_MENU_OPTIONS.map((opt) => ({
        id: opt.id,
        title: opt.label,
        description: MENU_OPTION_DESCRIPTIONS[opt.id],
      })),
    },
  ];
}

export function buildGreetingIntro(displayName: string): string {
  return [
    `👋 ¡Hola *${displayName}*!`,
    `Soy *${BOT_FRIENDLY_NAME}*, tu asistente virtual de ${DISTRIBUTOR_NAME} 🚛`,
    '',
    'Estoy acá para ayudarte a gestionar tus pedidos y consultas de forma rápida.',
  ].join('\n');
}

export function buildGreetingMessage(displayName: string): string {
  return [buildGreetingIntro(displayName), buildMenuBody()].join('\n');
}
