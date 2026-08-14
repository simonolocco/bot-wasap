export type MenuOptionId = 'horarios' | 'direccion' | 'lista_precio' | 'hacer_pedido' | 'asesor' | 'preguntas_frecuentes';

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
  process.env.CATALOG_MINORISTA_URL ?? 'https://drive.google.com/file/d/1_mQxhP0oKDIJdBonfHSD2YudV3pqtHRQ/view';

export const MENU_HEADER_TEXT = '👋 ¡Hola! Bienvenido';
// export const MENU_HEADER_IMAGE = 'https://example.com/logo.jpg'; // Descomentar y poner URL real si se desea imagen

export const MAIN_MENU_OPTIONS: MenuOption[] = [
  { id: 'horarios', label: '📅 Horarios', number: '1', keywords: ['horario', 'horarios', '1'] },
  { id: 'direccion', label: '📍 Dirección', number: '2', keywords: ['direccion', 'ubicacion', '2'] },
  { id: 'lista_precio', label: '💲 Precios', number: '3', keywords: ['lista', 'precios', 'catalogo', '3'] },
  { id: 'hacer_pedido', label: '📝 Nuevo Pedido', number: '4', keywords: ['hacer pedido', '4'] },
  { id: 'asesor', label: '👤 Asesor Humano', number: '5', keywords: ['asesor', 'comercial', '5'] },
  { id: 'preguntas_frecuentes', label: '❓ Preguntas frecuentes', number: '6', keywords: ['preguntas frecuentes', 'preguntas', 'faq', '6'] },
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
export const BUSINESS_ADDRESS = '📍 *Dirección*\n━━━━━━━━━━━━\nAv. Juan B. Justo 5048\nCórdoba, Argentina\n\n🗺️ *Ver en mapa:*\nhttps://maps.app.goo.gl/gCfNiJEz9Q7k4LzS6';

export const FAQ_GENERAL = [
  '❓ *¿Venden minorista?*',
  '',
  '¡También podés comprar para tu hogar! 🏡',
  '',
  'Atendemos tanto a clientes mayoristas como minoristas. La mayoría de nuestros productos se comercializan desde media horma y, en el caso de piezas de mayor tamaño, también contamos con porciones adaptadas al consumo familiar.',
  '',
  'Si tenés alguna consulta sobre un producto, podés contactarte con nuestro asesor humano y con gusto te ayudaremos.',
  '',
  '━━━━━━━━━━━━',
  '',
  '❓ *¿Hacen envíos?*',
  '',
  'Trabajamos con retiro coordinado para que puedas recibir tu pedido de la forma más cómoda.',
  '',
  'Podés enviarnos tu pedido con anticipación y retirarlo listo, o coordinar el traslado mediante un comisionista, servicio de traslado o transporte de confianza.',
  '',
  'De esta manera evitás esperas y nos aseguramos de tener tu pedido preparado para agilizar tus tiempos.',
].join('\n');

export const MENU_PROMPT = '¿En qué podemos ayudarte hoy? 👇';
export const FOLLOW_UP_MENU_HEADER_TEXT = '¿En qué más podemos ayudarte?';
export const FOLLOW_UP_MENU_PROMPT = [
  'Elegí una de las opciones para realizar otra consulta 👇',
  '',
  'Si necesitás ayuda con algo que no aparece en el menú, podés elegir la opción de 👤 Asesor Humano.',
].join('\n');
export const MENU_SECTION_TITLE = 'Seleccioná una opción';
export const MENU_BUTTON_LABEL = 'Abrir Menú';

export const FAQ_OTHER_YES_ID = 'faq_other_yes';
export const FAQ_OTHER_NO_ID = 'faq_other_no';
export const FAQ_OTHER_PROMPT = '\u00bfTu pregunta no aparece ac\u00e1? Eleg\u00ed una opci\u00f3n:';
export const SUPPORT_TICKET_PROMPT = 'Perfecto. Escrib\u00ed tu pregunta en el pr\u00f3ximo mensaje y un asesor te va a responder. El bot queda pausado hasta que terminemos la atenci\u00f3n.';
export const ORDER_INSTRUCTIONS = [
  '\ud83e\uddfe Armemos tu pedido',
  '━━━━━━━━━━━━',
  'Envi\u00e1 en un mensaje la lista de productos que necesit\u00e1s.',
  'La voy a compartir completa con nuestro asesor, sin modificarla.',
  'Escrib\u00ed todo en un solo mensaje, una l\u00ednea por producto.',
  '',
  '\ud83d\udca1 Ejemplo:',
  '- 2 unidades de cremoso Ca\u00f1ada Negra',
  '- 1 pieza de jam\u00f3n cocido Lario',
  '- 2 unidades de mayonesa Danica 3xkg',
  '',
  'Por favor, detall\u00e1 la cantidad (si son unidades o cajas), el producto y la marca.',
  'Para no cometer errores en el armado.',
  '',
  'Envi\u00e1 tu lista ahora \ud83d\udc47',
].join('\n');

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
  lista_precio: 'Ver lista de precios y ofertas',
  hacer_pedido: 'Enviar productos para armar pedido',
  asesor: 'Derivarme a un asesor humano',
  preguntas_frecuentes: '',
};

const MENU_ALIASES: Record<MenuOptionId, string[]> = {
  horarios: ['horario de atencion', 'cuando atienden', 'cuando abren'],
  direccion: ['ubicacion', 'donde estan', 'como llego'],
  lista_precio: ['lista de precios', 'catalogos', 'catalogo de precios', 'ofertas'],
  hacer_pedido: ['nuevo pedido', 'hacer un pedido', 'quiero pedir', 'quiero hacer un pedido'],
  asesor: ['asesor humano', 'hablar con alguien', 'hablar con un asesor', 'persona', 'humano'],
  preguntas_frecuentes: ['pregunta frecuente', 'preguntas', 'faq'],
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
    '',
    '📌 Tené en cuenta que los precios pueden actualizarse según disponibilidad de stock y vigencia de promociones.',
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

  const directMatch = MAIN_MENU_OPTIONS.find((opt) => [
    ...opt.keywords,
    ...MENU_ALIASES[opt.id],
    normalizeText(opt.label),
  ].some((kw) => normalized === normalizeText(kw)));
  if (directMatch) return directMatch.id;

  return MAIN_MENU_OPTIONS.find((opt) => [
    ...MENU_ALIASES[opt.id],
    normalizeText(opt.label),
  ].some((kw) => kw.length >= 5 && normalized.includes(normalizeText(kw))))?.id;
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
        ...(MENU_OPTION_DESCRIPTIONS[opt.id] ? { description: MENU_OPTION_DESCRIPTIONS[opt.id] } : {}),
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
