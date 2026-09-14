import { z } from 'zod';
import { BUSINESS_ADDRESS, BUSINESS_SCHEDULE, MAIN_MENU_OPTIONS, isMenuCommandText, normalizeText } from '../botMenu';
import { catalogReady, searchCatalog, type Catalog, type Product } from './catalog';
import { AiProviderError, type Complete, parseJson } from './openRouter';
import { isTypoGreeting, isUnintelligibleQuestion } from './inputQuality';

export const topics = [
  'shipping',
  'address',
  'hours',
  'minimum',
  'retail',
  'payments',
  'holiday',
  'catalog_problem',
  'information',
] as const;

export const intentSchema = z.object({
  topics: z.array(z.enum(topics)).max(9),
  productQuery: z.string().max(160),
  tier: z.enum(['mayorista', 'minorista', 'unknown']),
  catalog: z.boolean(),
  human: z.boolean(),
  order: z.boolean(),
  stock: z.boolean(),
  social: z.enum(['greeting', 'thanks', 'goodbye', 'none']),
  unknown: z.boolean(),
  complaint: z.boolean().optional(),
  externalProposal: z.boolean().optional(),
  locationDistance: z.boolean().optional(),
  /** Deliberate silence: no reply bubble should be sent. */
  silence: z.boolean().optional(),
  reply: z.string().max(3500).optional(),
});

// OpenRouter's strict structured-output providers require every property in
// `required`. Keep the parser tolerant of optional fields from older models.
const generatedIntentSchema = z.toJSONSchema(intentSchema);
export const intentJsonSchema = { ...generatedIntentSchema,
  required: Object.keys(generatedIntentSchema.properties ?? {}), additionalProperties: false };

export type Intent = z.infer<typeof intentSchema>;
export type Turn = { role: 'user' | 'assistant'; content: string };
export type Answer = {
  text: string;
  outcome: 'answered' | 'clarify' | 'handoff' | 'unavailable' | 'paused' | 'silence';
  sources: string[];
  products: Product[];
  model: string;
  tokens: number;
  elapsedMs: number;
  intent?: Intent;
  errorCode?: string;
};

export function assistantEnabled(env = process.env): boolean {
  return env.AI_ASSISTANT_ENABLED === 'true' && ['development', 'test'].includes(env.NODE_ENV ?? '');
}
export function shouldUseAssistant(
  incoming: { text?: string; type: string; selectedOptionId?: string; buttonReplyId?: string },
  awaitingOrder = false
) {
  if (awaitingOrder || incoming.type !== 'text' || !incoming.text?.trim() || incoming.selectedOptionId || incoming.buttonReplyId)
    return false;
  const normalized = normalizeText(incoming.text);
  if (['volver', 'cancelar'].includes(normalized) || isMenuCommandText(normalized)) return false;
  return !MAIN_MENU_OPTIONS.some(option => [option.number, normalizeText(option.label), ...option.keywords].includes(normalized));
}
export function advisorUrl() {
  const number = (process.env.FORWARD_ORDER_NUMBER ?? '5493517565641').replace(/\D/g, '');
  return `https://wa.me/${number}`;
}

export function catalogLinks() {
  const links = [
    ['Mayorista', process.env.CATALOG_MAYORISTA_URL],
    ['Minorista', process.env.CATALOG_MINORISTA_URL],
  ];
  return links
    .filter(([, url]) => url && /^https:\/\//.test(url) && !url.includes('mi-distribuidora.com'))
    .map(([label, url]) => `${label}: ${url}`)
    .join('\n');
}

const handoff = () => `Podés consultar a Mauricio, nuestro asesor comercial, para confirmarlo: ${advisorUrl()}`;

export const facts: Record<typeof topics[number], { text: string; source: string; needsHuman?: boolean }> = {
  shipping: {
    text: 'Estamos en Córdoba Capital (Av. Juan B. Justo 5048). Los pedidos se retiran en el local o se despachan con un comisionista o transporte de tu confianza. La cobertura y el costo dependen de la localidad; Mauricio puede confirmarlos.',
    source: 'Preguntas frecuentes · envíos y logística',
  },
  address: { text: BUSINESS_ADDRESS, source: 'Dirección del bot' },
  hours: { text: BUSINESS_SCHEDULE, source: 'Horarios del bot' },
  minimum: {
    text: 'Atendemos compras mayoristas y minoristas. La compra mínima es de 1/2 horma en adelante.',
    source: 'Condición comercial · compra mínima',
  },
  retail: {
    text: 'Sí, atendemos tanto a mayoristas como a particulares. La compra mínima es de 1/2 horma en adelante. Si me indicás qué producto buscás, te ayudo a encontrarlo.',
    source: 'Preguntas frecuentes · venta minorista',
  },
  payments: {
    text: 'No tengo medios de pago ni planes de cuotas confirmados en este canal. Para saber si aceptamos efectivo, transferencia, tarjeta u otra modalidad para tu pedido, consultalo con nuestro asesor comercial.',
    source: 'Confirmación requerida · medios de pago',
    needsHuman: true,
  },
  holiday: {
    text: 'Los horarios especiales de feriados requieren confirmación; no puedo asegurar que se aplique el horario habitual.',
    source: 'Horarios especiales · feriados',
    needsHuman: true,
  },
  catalog_problem: {
    text: 'Podés probar abriendo el enlace del catálogo en el navegador (Google Chrome). Si sigue sin abrir, nuestro asesor puede ayudarte a obtener la lista en PDF directamente.',
    source: 'Enlaces de catálogo configurados',
    needsHuman: true,
  },
  information: {
    text: 'Somos Distribuidora Abasto del Campo, en Córdoba Capital (Av. Juan B. Justo 5048). Atendemos a mayoristas y particulares. Comercializamos quesos, fiambres y lácteos con retiro en local o despacho coordinado por comisionista. ¿En qué podemos ayudarte?',
    source: 'Información general del negocio',
  },
};

const COMPLAINT_PATTERN = /no se p(ue|eu)de trabajar|no pueden? trabajar|pesim[ao]|una verguenza|una porqueria|estafa|estafadores|desastre|nadie responde|vino mal|el pedido vino|falta mercaderia|hace dias que espero|horrible atencion/i;
const EXTERNAL_PATTERN = /curriculum|cv\b|puesto de trabajo|busco trabajo|oportunidad laboral|propuesta de publicidad|radio impacto|distribuidor de productos|distribuidor fargo|snacks buffalo|somos una iglesia|donaci[oó]n|donar|ofrecer mis servicios/i;
/**
 * Matches distant locations only as whole words to prevent false positives on
 * substrings like "rio" inside "precio", "comentario", "escritorio", etc.
 * "Punta del Agua" is a brand name (product, not location) so intentionally excluded.
 */
const DISTANT_LOCATION_WORDS = /\b(moreno|villa allende|santiago del estero|chaco|mendoza|rosario|tucuman|jujuy|mar del plata|berazategui|entre rios|caba|buenos aires|bs as|gonzales catan|virrey del pino|bialet masse|calamuchita|yacanto|malague[nñ]o|dean funes|venado tuerto|ciudadela|martinez|lanus|san isidro|marcos juarez|catamarca|salta|san juan|la rioja|santa fe|icaño)\b/i;
/**
 * Shipping verbs that confirm a message is about delivery, not merely mentioning a city name.
 * Required alongside DISTANT_LOCATION_WORDS to avoid firing on product mentions like "Punta del Agua".
 */
const SHIPPING_VERB = /\b(llega[rn]?|envio|envios|repartos?|envia[rn]?|entrega[rn]?|mandan?|despacha[rn]?|hacen envio|hacen envios|asen envios?|hace[rn]? reparto|hace[rn]? entrega)\b/i;
const GIBBERISH_PATTERN = /^([.?¿!,\s]+|dfd|ver\*|(ja)+|(je)+|hika|hoka)$/i;
/** Reactions, media stubs or genuinely empty input — always silence. */
const REACTION_OR_EMPTY_PATTERN = /^\[mensaje (reaction|sticker|audio|image|video|unsupported|document) recibido\]$/i;
/**
 * Deliberate silence: explicit opt-out or pure acknowledgments with no business question.
 * Note: single-letter messages are handled separately by GIBBERISH_PATTERN → clarify.
 * Silence triggers are checked BEFORE gibberish so "ok"/"dale"/"chau" go to silence not clarify.
 */
const SILENCE_TRIGGERS = /^(no gracias|no me interesa|nada mas|nada más|ok|dale|si|sí|chau|chao|hasta luego|muchas gracias|gracias|muy amable gracias|muy amable|entendido|perfecto|listo|recibido|de nada|buenisimo|bueno|a|ma|kl|ver\*|👍|👍🏻|👍🏼|👍🏿|🙌|🙌🏻|✅|💯)$/i;
export function isLearningQueueNoise(text: string | undefined, pendingQuestion = false) {
  return Boolean(text?.trim()) && SILENCE_TRIGGERS.test(normalizeText(text)) && !pendingQuestion;
}
const ADVISOR_PATTERN = /necesito un asesor|asesor comercial|quiero un asesor|hablar con un asesor|asesor humano|necesito asesor/i;
const MORE_INFO_PATTERN = /^(ver mas info|quiero mas info|mas info|imfo|info|ver mas info buenas tardes|quiero info)$/i;
const MINIMUM_PATTERN = /\b(compra minima|monto minimo|cuanto es lo minimo|minimo de compra|compra de cuanto|hay minimo|cuanto es la compra minima|cual es la mimina)\b/i;
const CATALOG_PROBLEM_PATTERN = /no puedo abrir|no me deja ver|no .{0,10}deja ver|no abre|paseme por pdf|pasamelo por pdf|no puedo entrar ala aplicacion|no puedo.+catalogo|paceme por pdf|no me la deja|no .{0,10}deja.{0,10}ver|no deja/i;
const ADDRESS_PATTERN = /\b(de donde (son|sos|es|eres)|(?:son|sos|eres) de r[ií]o cuarto|donde queda|donde estan|donde se encuentran|donde los encuentro|ubicaci[oó]n|direcci[oó]n|cual es (?:su|el) domicilio|domicilio (?:del|de el|de la) local|en donde se encuentran|a donde esta su local|que zona son)\b/i;
const HOURS_PATTERN = /\b(que horario|horarios?|a que hora|cuando abren|cuando cierran|abren hoy|cierran hoy|hasta que hora|estan abiertos|estan atendiendo)\b/i;
const RETAIL_PATTERN = /\b(venden por mayor|venden por menor|venta al publico|venta al p[uú]blico|mayorista y minorista|mayoristas y particulares|por mayor y por menor|para particulares)\b/i;
const PAYMENT_PATTERN = /\b(medios? de pago|formas? de pago|aceptan efectivo|aceptan transferencia|tarjeta|cuotas?)\b/i;
const GENERIC_SHIPPING_PATTERN = /\b(hacen env[ií]os?|asen envios?|hacen reparto|asen reparto|hacen entregas?|env[ií]an|despachan|mandan a|llegan a|llegan hasta|entregan en|envios a|envio a|retiro en|retirar en|retirar por|traen(?: a)? domicilio|llevan(?: a)? domicilio|reparten(?: a)? domicilio|entregan(?: a)? domicilio|traen a casa|llevan a casa)\b/i;
const BUSINESS_INFO_PATTERN = /\b(qu[eé] venden|qu[eé] productos tienen|qu[eé] comercializan|a qu[eé] se dedican|informaci[oó]n general)\b/i;
const PRODUCT_QUERY_PATTERN = /\b(precio|precios|cu[aá]nto sale|cu[aá]nto cuesta|cu[aá]nto est[aá]|valor por|lista de precio|cremoso|manteca|sardo|tybo|muzzarella|muzarella|provoleta|port salut|jam[oó]n|fiambre|queso|l[aá]cteo|leche|yogur|salamin|salamines|salame|mortadela|panceta|ricota|cheddar)\b/i;
const CATALOG_REQUEST_PATTERN = /\b(lista de precios?|lista completa|catalogo|cat[aá]logo|me pasas? (la )?lista)\b/i;
const SPECIFIC_PRODUCT_PATTERN = /\b(cremoso|manteca|sardo|tybo|muzzarella|muzarella|provoleta|port salut|jam[oó]n|fiambre|queso|l[aá]cteo|leche|yogur|salamin|salamines|salame|mortadela|panceta|ricota|cheddar)\b/i;
const GREETING_PATTERN = /^(hola(?:\s+(buen dia|buenos dias|buenas tardes|buenas noches))?|buen dia|buenos dias|buenas tardes|buenas noches|que tal|como estas)$/i;

function isExternalProposal(norm: string) {
  if (!EXTERNAL_PATTERN.test(norm)) return false;
  // A customer may mention donating the products they are trying to buy. That is
  // still a purchase/order and must not be routed as an institutional request.
  const customerPurchase = /\b(quiero|necesito|comprar|compra|pedido|encargar|encargo|pasame|pasame|venderme|cantidad|unidades?|cajas?|litros?|kilos?|kg|leche|queso|fiambre|manteca|mercaderia)\b/i.test(norm);
  return !(customerPurchase && /\b(donar|donaci[oó]n|donaciones)\b/i.test(norm));
}

export function hasPendingQuestion(history: Turn[]) {
  const recentAssistant = history[history.length - 1];
  if (recentAssistant?.role !== 'assistant') return false;
  const content = normalizeText(recentAssistant.content);
  return recentAssistant.content.includes('?') || /mayorista o minorista|que marca|que tamano|cual producto|pod[eé]s indicarme|queres que|te gustaria/i.test(content);
}

function inferProductQuery(norm: string, catalog: Catalog): string {
  // Remove conversational scaffolding, never the requested brand or size.
  // Falling back to a generic name silently quotes a different product.
  const segments = norm.split(/\b(?:y (?=que horario|horario|donde|hacen|aceptan|necesito un asesor|precio|cuanto)|hacen envios|envian a|mandan a|llegan a)\b/);
  const query = segments.find(segment => SPECIFIC_PRODUCT_PATTERN.test(segment)) ?? segments.find(segment => PRODUCT_QUERY_PATTERN.test(segment)) ?? norm;
  return query
    .replace(/\b(?:hola|buen dia|buenas tardes|buenas|che|por favor|me podes decir|me decis|me pasas|pasame|quiero saber|cual es el|cual es|lista de precios|lista de precio|cuanto sale|cuanto cuesta|cuanto esta|precio de|precio del|precio|precios|tenes|tienen|busco|necesito|quiero|comprar|stock de|stock|disponibilidad de|hay|mayorista|minorista|por mayor|por menor|para revender|para mi casa|particular)\b/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** These messages need semantic interpretation; keyword matches are insufficient. */
function needsInterpretation(norm: string): boolean {
  return /\b(no (?:quiero|necesito|busco|soy|somos|es|son|me mandes|mandes|me pases|pases)|(?:ese|esa|esos|esas|el otro|la otra|los otros|las otras|lo mismo)|(?:recomendas|recomendacion|intolerancia|celiaco|celiaca|embarazada|vencimiento|vence|apto|apta))\b/.test(norm)
    || (norm.split(/\by\b/).filter(part => SPECIFIC_PRODUCT_PATTERN.test(part)).length > 1);
}

const DIETARY_SAFETY_PATTERN = /\b(intoleranc\w*|celiac\w*|alerg\w*|embarazad\w*|apto|apta|sin gluten)\b/i;
const PRODUCT_RECOMMENDATION_PATTERN = /(?=.*\b(recomend(?:as|ame|acion|ar)?|suger(?:is|ime|ir)?)\b)(?=.*\b(queso|fiambre|lacteo|producto)\b)/i;

function localIntent(norm: string, catalog: Catalog, history: Turn[]): Intent | undefined {
  if (needsInterpretation(norm)) return undefined;
  const intent: Intent = { topics: [], productQuery: '', tier: 'unknown', catalog: false,
    human: ADVISOR_PATTERN.test(norm), order: /\b(armar (?:un |el )?pedido|hacer (?:un |el )?pedido|quiero (?:pedir|encargar))\b/.test(norm),
    stock: /\b(stock|disponibilidad|queda|quedan|tenes|tienen)\b/.test(norm) && SPECIFIC_PRODUCT_PATTERN.test(norm), social: 'none', unknown: false };
  const patterns: [typeof topics[number], RegExp][] = [
    ['address', ADDRESS_PATTERN], ['hours', HOURS_PATTERN], ['payments', PAYMENT_PATTERN],
    ['retail', RETAIL_PATTERN], ['shipping', GENERIC_SHIPPING_PATTERN], ['minimum', MINIMUM_PATTERN],
    ['information', BUSINESS_INFO_PATTERN],
  ];
  for (const [topic, pattern] of patterns) if (pattern.test(norm)) intent.topics.push(topic);
  if (/\b(feriado|feriados|navidad|ano nuevo)\b/.test(norm)) intent.topics.push('holiday');
  if (MORE_INFO_PATTERN.test(norm)) intent.topics.push('information');
  if (CATALOG_PROBLEM_PATTERN.test(norm)) intent.topics.push('catalog_problem');
  intent.catalog = CATALOG_REQUEST_PATTERN.test(norm) && !SPECIFIC_PRODUCT_PATTERN.test(norm);
  if (DISTANT_LOCATION_WORDS.test(norm) && SHIPPING_VERB.test(norm)) {
    intent.locationDistance = true;
    if (!intent.topics.includes('shipping')) intent.topics.push('shipping');
  }
  if (GREETING_PATTERN.test(norm) || isTypoGreeting(norm)) intent.social = 'greeting';
  intent.tier = /\b(mayorista|por mayor|para revender)\b/.test(norm) ? 'mayorista'
    : /\b(minorista|por menor|particular|para mi casa)\b/.test(norm) ? 'minorista' : 'unknown';
  if (!intent.catalog && !intent.topics.includes('catalog_problem') && PRODUCT_QUERY_PATTERN.test(norm)) {
    intent.productQuery = inferProductQuery(norm, catalog);
  }
  // Tier replies resolve the customer's last product request without an API call.
  if (/^(mayorista|minorista|por mayor|por menor|para revender|particular|para mi casa)$/.test(norm)) {
    const previous = [...history].reverse().find(turn => turn.role === 'user' && PRODUCT_QUERY_PATTERN.test(normalizeText(turn.content)));
    if (previous) intent.productQuery = inferProductQuery(normalizeText(previous.content), catalog);
  }
  if (!intent.productQuery && PRODUCT_QUERY_PATTERN.test(norm) && !intent.topics.length && !intent.catalog) return { ...intent, unknown: false, productQuery: 'producto consultado' };
  if (intent.productQuery && intent.tier === 'unknown') {
    const previousTier = [...history].reverse().find(turn => turn.role === 'user' && /\b(mayorista|minorista|por mayor|por menor|para revender|particular|para mi casa)\b/.test(normalizeText(turn.content)));
    if (previousTier) intent.tier = /\b(mayorista|por mayor|para revender)\b/.test(normalizeText(previousTier.content)) ? 'mayorista' : 'minorista';
  }
  return intent.topics.length || intent.productQuery || intent.catalog || intent.human || intent.order || intent.social !== 'none' ? intent : undefined;
}

const system = `Sos el asistente oficial de Distribuidora Abasto del Campo (Córdoba Capital, Argentina).
Tu canal es WhatsApp. Tu tono es cordial, profesional, conciso y en español argentino natural con voseo (usá "podés", "tenés", "te comento", "avisanos").

REGLAS DE NEGOCIO:
1. UBICACIÓN Y HORARIOS:
   - Local y depósito: Av. Juan B. Justo 5048, Córdoba Capital.
   - Horarios: Lunes a Viernes de 8:15 a 16:00 hs, Sábados de 8:15 a 12:45 hs. Domingo: cerrado.
2. ENVÍOS Y LOGÍSTICA:
   - La modalidad confirmada es RETIRO en el local o despacho coordinado con COMISIONISTA o transporte de confianza del cliente.
   - Si consultan por envíos a otras ciudades/provincias: aclará que estamos en Córdoba Capital, que se puede retirar o coordinar con comisionista, y ofrecé el contacto de Mauricio.
3. COMPRA MÍNIMA Y CLIENTES:
   - Atendemos a MAYORISTAS y PARTICULARES.
   - La compra mínima confirmada es de 1/2 HORMA EN ADELANTE. Informalo de forma directa tanto en consultas minoristas como al explicar cómo hacer un pedido.
4. QUEJAS Y RECLAMOS:
   - Si el cliente expresa molestia, enojo o problemas con un pedido: NUNCA envíes la dirección física. Mostrá empatía inmediata y derivalo a Mauricio. Marcar complaint=true y human=true.
5. MENSAJES EXTERNOS Y FUERA DE LUGAR:
   - Si ofrecen productos (Snacks Buffalo, Fargo, publicidad), buscan trabajo (CV) o piden donaciones: aclará canal exclusivo para ventas. Marcar externalProposal=true y human=true.
6. PRECIOS Y CATÁLOGO:
   - NUNCA inventes precios, descuentos ni números.
   - Si consultan precio de un producto puntual, extraé productQuery y tier (mayorista o minorista).
   - Si piden el catálogo o la lista completa, marcar catalog=true.
7. SILENCIO DELIBERADO (silence=true):
   - Emoji-reactions, stickers, mensajes de audio/imagen sin texto, opt-out explícito ("no gracias", "no me interesa"), y saludos de cierre sin pregunta ("chau", "hasta luego"): marcar silence=true y NO generes reply.
   - "Sí", "Ok", "Dale" pueden ser respuesta a una pregunta anterior: si el turno anterior hacía una pregunta al cliente (ej: "¿es para mayorista o minorista?"), NO es silencio.
8. CONTEXTO Y NEGACIONES:
   - Interpretá negaciones: "no quiero un asesor" NO es human=true; "no me mandes lista, quiero el precio" NO es catalog=true.
   - Resolvé "ese", "la otra" y respuestas cortas usando el historial. Si hay más de un referente posible, dejá productQuery vacío y unknown=false; no elijas una marca por azar.
   - Conservá marca y tamaño en productQuery. Si preguntan por varios productos diferentes y no se pueden representar sin ambigüedad en una sola búsqueda, pedí aclaración; nunca sustituyas uno por otro.
9. MULTI-TEMA:
   - Si el cliente hace más de una consulta en el mismo mensaje (ej: pregunta por asesor Y precio de un producto), respondé AMBAS partes. No derives únicamente al asesor si hay una pregunta de negocio respondible.
10. PROHIBICIONES ABSOLUTAS:
   - Nunca uses "enseguida", "de inmediato", "ya mismo", "ticket prioritario" ni promesas de entrega.
   - Nunca inventes sucursales, zonas de distribución, precios, stock, horarios de feriados.
   - Nunca respondas trivia general no relacionada con el negocio; si el mensaje es completamente off-topic, marcá unknown=true y guiá brevemente al menú.

11. MENÚ DESPUÉS DE RESPONDER:
   - Después de toda respuesta con texto, el sistema envía automáticamente el menú de opciones en un mensaje separado.
   - No copies las opciones del menú dentro de la respuesta ni digas que el cliente debe pedirlo; cerrá la respuesta de forma natural.

Respondé SIEMPRE en formato JSON estricto con el siguiente esquema:
{
  "topics": array de shipping|address|hours|minimum|retail|payments|holiday|catalog_problem|information,
  "productQuery": string (producto buscado, sin precio ni saludos; vacío si no busca producto),
  "tier": "mayorista" | "minorista" | "unknown",
  "catalog": boolean,
  "human": boolean,
  "order": boolean,
  "stock": boolean,
  "complaint": boolean,
  "externalProposal": boolean,
  "locationDistance": boolean,
  "silence": boolean,
  "social": "greeting" | "thanks" | "goodbye" | "none",
  "unknown": boolean,
  "reply": string (respuesta redactada para el cliente en español argentino, vacío string si silence=true)
}`;

export function renderAnswer(
  intent: Intent,
  catalog: Catalog,
  now = new Date(),
  userMessage = ''
): Pick<Answer, 'text' | 'outcome' | 'sources' | 'products'> {
  const normMsg = normalizeText(userMessage);

  // 0. Deliberate silence — no reply bubble
  if (intent.silence) {
    return { text: '', outcome: 'silence', sources: [], products: [] };
  }

  // 1. Complaint / Dissatisfaction Check (HIGHEST PRIORITY - never leak address!)
  if (intent.complaint || (COMPLAINT_PATTERN.test(normMsg) && !needsInterpretation(normMsg))) {
    return {
      text: `Lamentamos muchísimo el inconveniente y entendemos tu molestia. Queremos solucionarlo: por favor comunicate directamente con Mauricio, nuestro asesor comercial: ${advisorUrl()}`,
      outcome: 'handoff',
      sources: ['Atención de reclamos', 'Contacto directo del asesor'],
      products: [],
    };
  }

  // 2. External Proposals / B2B sales / CV / Donations
  // The message itself is authoritative here. The model flag is intentionally
  // ignored when the text is a customer purchase that happens to mention a
  // donation (for example, buying milk to donate to a school).
  if ((isExternalProposal(normMsg) && !needsInterpretation(normMsg)) || (intent.externalProposal && !/\b(comprar|pedido|encargar)\b.*\bdonar\b/.test(normMsg))) {
    return {
      text: `¡Hola! Este canal de WhatsApp es exclusivo para atención a clientes y ventas de Distribuidora Abasto del Campo (quesos, fiambres y lácteos en Córdoba).\n\nPara propuestas comerciales de proveedores, postulaciones laborales o solicitudes institucionales, canalizá tu mensaje con nuestro asesor comercial: ${advisorUrl()}`,
      outcome: 'handoff',
      sources: ['Filtro de mensajes externos y derivación comercial'],
      products: [],
    };
  }

  // 3. Human advisor request — but only when there is no business question to answer first
  const hasBusinessQuestion = intent.topics.length > 0 || !!intent.productQuery || intent.catalog || intent.stock;
  if ((intent.human || (ADVISOR_PATTERN.test(normMsg) && !needsInterpretation(normMsg))) && !hasBusinessQuestion) {
    return {
      text: `¡Por supuesto! Podés comunicarte directamente con Mauricio, nuestro asesor comercial: ${advisorUrl()}`,
      outcome: 'handoff',
      sources: ['Contacto directo del asesor comercial'],
      products: [],
    };
  }

  // 4. Out-of-area shipping / other cities & provinces
  // Only trigger when shipping verb is also present (prevents false positive on product queries like "precio")
  const mentionsOtherCity = DISTANT_LOCATION_WORDS.test(normMsg);
  const mentionsShippingVerb = SHIPPING_VERB.test(normMsg);
  const isOutOfAreaShipping = intent.locationDistance || (intent.topics.includes('shipping') && mentionsOtherCity && mentionsShippingVerb);
  if (isOutOfAreaShipping && !intent.productQuery && intent.topics.length === 1 && !intent.catalog && !intent.order) {
    return {
      text: `Estamos en *Córdoba Capital* (Av. Juan B. Justo 5048). Para esa localidad no puedo confirmar una entrega directa ni el costo. Podés retirar en nuestro local o coordinar el traslado con un comisionista o transporte de tu confianza. Mauricio te confirma la opción disponible: ${advisorUrl()}`,
      outcome: 'handoff',
      sources: ['Ubicación en Córdoba Capital', 'Condiciones de retiro y comisionistas'],
      products: [],
    };
  }

  // 5. "Ver más info" / "más info" (single coherent response, no concatenated blocks!)
  if (
    MORE_INFO_PATTERN.test(normMsg) ||
    (intent.topics.includes('information') && intent.topics.includes('shipping') && intent.topics.length === 2 && !intent.productQuery && !intent.catalog && !intent.human && !intent.order)
  ) {
    return {
      text: `¡Hola! Bienvenido/a a *Distribuidora Abasto del Campo* 👋\n\nSomos distribuidores mayoristas y minoristas de quesos, fiambres y lácteos en *Córdoba Capital* (Av. Juan B. Justo 5048).\n\n• *Venta mayorista y minorista:* la compra mínima es de 1/2 horma en adelante.\n• *Retiro y logística:* podés retirar por nuestro depósito o coordinar el traslado mediante un comisionista o transporte de tu confianza.\n• *Horarios:* Lunes a Viernes de 8:15 a 16:00 hs y Sábados de 8:15 a 12:45 hs.\n\n¿Te gustaría consultar el catálogo de precios, un producto puntual o hablar con nuestro asesor Mauricio: ${advisorUrl()}?`,
      outcome: 'answered',
      sources: ['Información general de la distribuidora', 'Ubicación y horarios', 'Modalidad de venta'],
      products: [],
    };
  }

  // 6. Catalog Opening Problem
  if (
    (intent.topics.includes('catalog_problem') ||
    /no puedo abrir|no me deja ver|no abre|paseme por pdf|pasamelo por pdf|no puedo entrar ala aplicacion/i.test(normMsg))
    && intent.topics.length <= 1 && !intent.productQuery && !intent.order
  ) {
    const links = catalogLinks();
    return {
      text: `Te comparto los enlaces de nuestros catálogos digitales:\n${links || 'Catálogos disponibles online'}\n\n💡 *Consejo:* Podés probar abriendo el enlace desde el navegador web de tu celular (Google Chrome o Safari).\n\nSi seguís con inconvenientes, consultá con Mauricio para coordinar otra forma de obtener la lista: ${advisorUrl()}`,
      outcome: 'handoff',
      sources: ['Soporte de catálogo digital', 'Enlaces de catálogo configurados'],
      products: [],
    };
  }

  // 7. Full catalog request
  if (intent.catalog && !intent.productQuery && !intent.topics.length && !intent.order) {
    const links = catalogLinks();
    return {
      text: links
        ? `Te comparto los enlaces a nuestras listas y catálogos vigentes:\n\n${links}\n\nCualquier consulta sobre precios, stock o pedidos podés consultarnos o escribirle a nuestro asesor comercial Mauricio: ${advisorUrl()}`
        : `No tengo un enlace de catálogo confirmado en este entorno.\n\nPodés consultar a Mauricio, nuestro asesor comercial, para solicitar la lista completa: ${advisorUrl()}`,
      outcome: links ? 'answered' : 'handoff',
      sources: ['Enlaces de catálogo configurados'],
      products: [],
    };
  }

  // 8. Standard topics / products processing (preserves existing behavior & unit tests)
  const pieces: string[] = [];
  const sources: string[] = [];
  let products: Product[] = [];
  let outcome: Answer['outcome'] = 'answered';
  let needsHuman: boolean = !!intent.human;

  for (const topic of new Set(intent.topics)) {
    pieces.push(facts[topic].text);
    if (topic === 'shipping' && isOutOfAreaShipping) needsHuman = true;
    sources.push(facts[topic].source);
    needsHuman ||= !!facts[topic].needsHuman;
  }

  if (intent.catalog) {
    const links = catalogLinks();
    pieces.push(links ? `Te comparto los catálogos:\n${links}` : 'No tengo un enlace de catálogo confirmado; Mauricio puede facilitarte la lista.');
    sources.push('Enlaces de catálogo configurados');
    needsHuman ||= !links;
  }

  if (intent.productQuery) {
    products = searchCatalog(catalog, intent.productQuery);
    if (!products.length) {
      pieces.push('No encontré ese producto con esa marca o presentación. ¿Podés indicarme el nombre exacto?');
      outcome = 'clarify';
    } else if (!catalogReady(catalog, now)) {
      pieces.push(
        'Encontré referencias de ese producto, pero la lista disponible está sin validar o fuera de vigencia. No puedo confirmarte un precio actualizado.'
      );
      sources.push(`${catalog.name} · precios sin habilitar`);
      needsHuman = true;
    } else if (intent.tier === 'unknown') {
      pieces.push('¿La consulta es para compra mayorista o minorista? Así te indico el precio de la lista correspondiente.');
      outcome = 'clarify';
    } else {
      products = products.filter(p => p.tier === intent.tier && p.unit !== 'sin_confirmar' && p.price !== null);
      if (!products.length) {
        pieces.push('No tengo un precio validado de ese producto para esa lista.');
        needsHuman = true;
      } else if (products.length > 8) {
        pieces.push('Hay varias presentaciones. ¿Qué marca y tamaño buscás exactamente?');
        outcome = 'clarify';
      } else {
        const money = new Intl.NumberFormat('es-AR', {
          style: 'currency',
          currency: 'ARS',
          maximumFractionDigits: 2,
        });
        pieces.push(
          `En la lista ${intent.tier}:\n` +
            products
              .map(
                p =>
                  `• ${p.name} ${p.brand}${p.presentation ? ` (${p.presentation})` : ''}: ${money.format(
                    p.price!
                  )} por ${p.unit}${p.conditions ? `. Condición: ${p.conditions}` : ''}.`
              )
              .join('\n')
        );
        pieces.push(
          `Vigencia de la lista: ${catalog.validFrom} al ${catalog.validUntil}. La disponibilidad se confirma al realizar el pedido.`
        );
        sources.push(...products.map(p => p.source));
      }
    }
  }

  if (intent.stock) {
    pieces.push('No tengo stock en tiempo real; el asesor debe confirmar disponibilidad.');
    needsHuman = true;
  }
  if (intent.order) {
    pieces.push(
      'Para armar el pedido, elegí «Nuevo Pedido» (opción 4) y enviá la lista con cantidades, productos y marcas. La compra mínima es de 1/2 horma en adelante. Esta consulta no confirma ni modifica un pedido.'
    );
    sources.push('Instrucciones del flujo de pedidos');
  }
  if (intent.unknown) {
    pieces.push('No tengo información confirmada para resolver esa consulta. Este canal atiende consultas de Distribuidora Abasto del Campo (quesos, fiambres y lácteos).');
    outcome = 'clarify';
  }
  if (!pieces.length && intent.social !== 'none') {
    pieces.push(
      intent.social === 'greeting'
        ? '¡Hola! Bienvenido/a a *Distribuidora Abasto del Campo* 👋 ¿En qué podemos ayudarte hoy?'
        : '¡Gracias por escribirnos! Estamos a tu disposición.'
    );
  }
  if (!pieces.length) {
    // Off-topic or unrecognized: guide to menu, don't act as general assistant
    pieces.push('Este canal atiende consultas de Distribuidora Abasto del Campo (quesos, fiambres y lácteos). ¿En qué te ayudamos? Podés consultar precios, catálogo, horarios, envíos o contactar a un asesor.');
    outcome = 'clarify';
  }

  // If human advisor was also requested alongside a business question, append link at end (multi-topic)
  if (intent.human && pieces.length > 0 && !needsHuman) {
    pieces.push(`También podés comunicarte directamente con Mauricio, nuestro asesor comercial: ${advisorUrl()}`);
  }

  if (needsHuman) {
    pieces.push(handoff());
    outcome = 'handoff';
  }

  return { text: pieces.join('\n\n'), outcome, sources: [...new Set(sources)], products };
}

export async function answerQuestion(
  input: { message: string; history?: Turn[]; paused?: boolean },
  catalog: Catalog,
  complete: Complete
): Promise<Answer> {
  const started = Date.now();
  const base = { sources: [] as string[], products: [] as Product[], model: '', tokens: 0, elapsedMs: 0 };
  if (input.paused) return { ...base, text: '', outcome: 'paused' };

  const raw = input.message.trim();
  const norm = normalizeText(raw);
  const pendingQuestion = hasPendingQuestion(input.history ?? []);

  // Fast pre-filter: reactions / media stubs → silence (no reply)
  if (REACTION_OR_EMPTY_PATTERN.test(raw)) {
    return { ...base, text: '', outcome: 'silence', elapsedMs: Date.now() - started };
  }

  // Fast pre-filter: deliberate silence triggers (checked before gibberish so "ok"/"dale"/"chau" → silence, not clarify)
  if (/^(no gracias|no me interesa|nada mas|chau|chao|hasta luego|gracias|muchas gracias)$/.test(norm)) return { ...base, text: '', outcome: 'silence', elapsedMs: Date.now() - started };
  if (!norm || (SILENCE_TRIGGERS.test(norm) && !pendingQuestion)) {
    // Exception: if raw message is purely punctuation (., ???) with no normalized content, give clarify
    // since customer may be testing the bot or accidentally sent characters
    const isPurelyPunctuation = !norm && /^[.?¿!,\s]+$/.test(raw);
    if (!isPurelyPunctuation) {
      return { ...base, text: '', outcome: 'silence', elapsedMs: Date.now() - started };
    }
  }

  // Fast pre-filter: gibberish/punctuation only → clarify (not silence: typos deserve a helpful reply)
  if (GIBBERISH_PATTERN.test(norm) || isUnintelligibleQuestion(raw) || /^[.?¿!,\s]+$/.test(raw) || !norm) {
    return {
      ...base,
      text: `¡Hola! No llegué a comprender tu consulta. En Distribuidora Abasto del Campo podemos ayudarte con precios de quesos y fiambres, catálogo, horarios, ubicación en Córdoba o armado de pedidos.\n\n¿En qué podemos ayudarte? Si querés hablar con un asesor, podés escribirle a Mauricio: ${advisorUrl()}`,
      outcome: 'clarify',
      sources: ['Aclaración de consulta', 'Información general'],
      elapsedMs: Date.now() - started,
    };
  }

  // Fast pre-filter for direct complaints (never leak address)
  if (COMPLAINT_PATTERN.test(norm) && !needsInterpretation(norm)) {
    const rendered = renderAnswer({ topics: [], productQuery: '', tier: 'unknown', catalog: false, human: false, order: false, stock: false, social: 'none', unknown: false, complaint: true } as Intent, catalog, new Date(), raw);
    return { ...base, ...rendered, elapsedMs: Date.now() - started };
  }

  // Fast pre-filter for external proposals
  if (isExternalProposal(norm) && !needsInterpretation(norm)) {
    const rendered = renderAnswer({ topics: [], productQuery: '', tier: 'unknown', catalog: false, human: false, order: false, stock: false, social: 'none', unknown: false, externalProposal: true } as Intent, catalog, new Date(), raw);
    return { ...base, ...rendered, elapsedMs: Date.now() - started };
  }

  // Collect all recognized topics before rendering so combined questions retain
  // their product, shipping, hours and advisor parts during provider outages.
  const local = localIntent(norm, catalog, input.history ?? []);
  if (local) {
    return { ...base, ...renderAnswer(local, catalog, new Date(), raw), intent: local, elapsedMs: Date.now() - started };
  }

  try {
    const history = (input.history ?? []).slice(-8).map(turn => ({ role: turn.role, content: turn.content.slice(0, 2500) }));

    // Check if user is answering tier ("mayorista" / "minorista") to a previous product question
    // Context lookup uses actual catalog products, not a hardcoded list
    let contextProductQuery = '';
    const TIER_ANSWER = /^(mayorista|minorista|por mayor|por menor|para revender|particular|para mi casa|los dos)$/;
    if (TIER_ANSWER.test(norm)) {
      for (let i = history.length - 1; i >= 0; i--) {
        const prev = normalizeText(history[i].content);
        for (const p of catalog.products) {
          const pn = normalizeText(p.name);
          if (pn.length >= 4 && prev.includes(pn)) {
            contextProductQuery = p.name;
            break;
          }
        }
        if (contextProductQuery) break;
      }
    }

    const result = await complete(
      [{ role: 'system', content: system }, ...history, { role: 'user', content: raw.slice(0, 2500) }],
      { schema: intentJsonSchema }
    );

    const intent = intentSchema.parse(parseJson(result.content));
    if (!intent.productQuery && contextProductQuery) {
      intent.productQuery = contextProductQuery;
    }

    // Dietary suitability and open-ended recommendations require information
    // that is not present in the commercial catalog (ingredients, allergens,
    // labels and current stock). Never turn the entire sentence into a fake
    // product query such as "qué queso me recomendás".
    if (DIETARY_SAFETY_PATTERN.test(norm)) {
      const safeIntent = { ...intent, topics: [], productQuery: '', catalog: false, human: true, unknown: true };
      return {
        ...base,
        text: `Para una intolerancia, alergia o celiaquía no puedo confirmar desde acá qué producto es apto. Revisá la etiqueta y confirmalo con nuestro asesor antes de comprar: ${advisorUrl()}`,
        outcome: 'handoff',
        sources: ['Confirmación requerida · ingredientes y aptitud alimentaria'],
        products: [], intent: safeIntent, model: result.model, tokens: result.tokens,
        elapsedMs: Date.now() - started,
      };
    }
    if (PRODUCT_RECOMMENDATION_PATTERN.test(norm)) {
      const clarifyIntent = { ...intent, topics: [], productQuery: '', catalog: false, human: false, unknown: true };
      return {
        ...base,
        text: 'Puedo buscar un producto concreto en la lista, pero necesito el nombre o la marca y si la consulta es mayorista o minorista. No puedo confirmar una recomendación libre ni el stock actual.',
        outcome: 'clarify',
        sources: ['Aclaración de producto y lista'],
        products: [], intent: clarifyIntent, model: result.model, tokens: result.tokens,
        elapsedMs: Date.now() - started,
      };
    }

    // Safety guards against model classification quirks:
    if (COMPLAINT_PATTERN.test(norm) && !needsInterpretation(norm)) {
      intent.complaint = true;
      intent.topics = intent.topics.filter(t => t !== 'address');
    }
    if (intent.externalProposal && /\b(comprar|pedido|encargar)\b.*\bdonar\b/.test(norm)) {
      intent.externalProposal = false;
    }
    // Only set locationDistance if shipping verb also present (prevents "precio" false-positive)
    if (DISTANT_LOCATION_WORDS.test(norm) && SHIPPING_VERB.test(norm)) {
      intent.locationDistance = true;
    }
    // Silence overrides model output for reactions and opt-out
    if (REACTION_OR_EMPTY_PATTERN.test(raw) || (SILENCE_TRIGGERS.test(norm) && !pendingQuestion)) {
      intent.silence = true;
    } else {
      // Silence is only valid for the deterministic cases above. A provider can
      // never suppress a substantive customer question by setting silence=true.
      intent.silence = false;
    }

    const rendered = renderAnswer(intent, catalog, new Date(), raw);

    return {
      ...rendered,
      intent,
      model: result.model,
      tokens: result.tokens,
      elapsedMs: Date.now() - started,
    };
  } catch (error: any) {
    if (process.env.NODE_ENV === 'development' && !error?.message?.includes('provider secret') && !Array.isArray(error?.issues)) {
      console.error('[AI Assistant Error]:', error?.message || error);
    }
    return {
      ...base,
      text: 'El servicio de IA no pudo procesar tu mensaje en este momento. Podés reintentarlo. Mientras tanto, puedo responder consultas sobre catálogo, productos, horarios, ubicación y envíos.',
      outcome: 'unavailable',
      errorCode: error instanceof AiProviderError ? error.code : 'provider',
      elapsedMs: Date.now() - started,
    };
  }
}
