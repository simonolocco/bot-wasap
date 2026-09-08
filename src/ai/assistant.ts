import { z } from 'zod';
import { BUSINESS_ADDRESS, BUSINESS_SCHEDULE, MAIN_MENU_OPTIONS, normalizeText } from '../botMenu';
import { catalogReady, searchCatalog, type Catalog, type Product } from './catalog';
import { AiProviderError, type Complete, parseJson } from './openRouter';

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
  reply: z.string().max(3500).optional(),
});

export const intentJsonSchema = z.toJSONSchema(intentSchema);

export type Intent = z.infer<typeof intentSchema>;
export type Turn = { role: 'user' | 'assistant'; content: string };
export type Answer = {
  text: string;
  outcome: 'answered' | 'clarify' | 'handoff' | 'unavailable' | 'paused';
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
  if (['menu', 'opciones', 'ver menu', 'ver opciones', 'volver', 'cancelar'].includes(normalized)) return false;
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
    text: 'Trabajamos con retiro coordinado en Córdoba Capital (Av. Juan B. Justo 5048). Podés enviar tu pedido con anticipación y retirarlo, o coordinar el traslado mediante un comisionista o transporte de tu confianza. No tenemos reparto propio directo con cobertura confirmada a otras localidades.',
    source: 'Preguntas frecuentes · envíos y logística',
  },
  address: { text: BUSINESS_ADDRESS, source: 'Dirección del bot' },
  hours: { text: BUSINESS_SCHEDULE, source: 'Horarios del bot' },
  minimum: {
    text: 'Atendemos compras mayoristas y minoristas. No exigimos un monto mínimo de dinero para comprar; comercializamos por pieza o bulto cerrado (media horma, pieza entera o caja cerrada).',
    source: 'Preguntas frecuentes · compra mínima y condiciones',
    needsHuman: true,
  },
  retail: {
    text: 'Sí, atendemos tanto a mayoristas como a particulares. La mayoría de los productos se comercializa desde media horma y algunas piezas grandes tienen porciones para consumo familiar. No tenemos mínimo en dinero.',
    source: 'Preguntas frecuentes · venta minorista',
  },
  payments: {
    text: 'Aceptamos efectivo y transferencias bancarias para retiros coordinados. Para otros medios de pago o planes de cuotas, podés consultarlo con nuestro asesor.',
    source: 'Información sobre medios de pago',
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

const COMPLAINT_PATTERN = /no se p(ue|eu)de trabajar|pesim[ao]|una verguenza|una porqueria|estafa|estafadores|desastre|nadie responde|vino mal|el pedido vino|falta mercaderia|hace dias que espero|horrible atencion/i;
const EXTERNAL_PATTERN = /curriculum|cv\b|puesto de trabajo|busco trabajo|oportunidad laboral|propuesta de publicidad|radio impacto|distribuidor de productos|distribuidor fargo|snacks buffalo|somos una iglesia|donacion|donaciones|ofrecer mis servicios/i;
const DISTANT_LOCATION_PATTERN = /moreno|santiago del estero|chaco|mendoza|rosario|tucuman|jujuy|mar del plata|berazategui|entre rios|caba\b|buenos aires|bs as|gonzales catan|virrey del pino|bialet masse|calamuchita|yacanto|malague[nñ]o|dean funes|venado tuerto|ciudadela|martinez|lanus|san isidro|rio\b|marcos juarez|catamarca|salta|san juan|la rioja|santa fe/i;
const GIBBERISH_PATTERN = /^([.?¿!,\s]+|[a-zA-Z]{1,2}|dfd|kl|ver\*|jajaja+|jejeje+|\[mensaje .* recibido\])$/i;
const ADVISOR_PATTERN = /necesito un asesor|asesor comercial|quiero un asesor|hablar con un asesor|asesor humano|necesito asesor/i;
const MORE_INFO_PATTERN = /^(ver mas info|quiero mas info|mas info|imfo|info|ver mas info buenas tardes)$/i;
const MINIMUM_PATTERN = /^(cuanto es la compra minima|hay compra minima|compra minima|la compra de cuanto debe ser|compra minima por mayor de cuanto es|cual es la mimina compra mayorista)$/i;
const CATALOG_PROBLEM_PATTERN = /no puedo abrir|no me deja ver|no abre|paseme por pdf|pasamelo por pdf|no puedo entrar ala aplicacion/i;

const system = `Sos el asistente oficial de Distribuidora Abasto del Campo (Córdoba Capital, Argentina).
Tu canal es WhatsApp. Tu tono es cordial, profesional, conciso y en español argentino natural con voseo (usá "podés", "tenés", "te comento", "avisanos").

REGLAS DE NEGOCIO:
1. UBICACIÓN Y HORARIOS:
   - Local y depósito: Av. Juan B. Justo 5048, Córdoba Capital.
   - Horarios: Lunes a Viernes de 8:00 a 17:00 hs, Sábados de 8:00 a 13:00 hs.
2. ENVÍOS Y LOGÍSTICA:
   - Se trabaja con RETIRO en el local o despacho coordinado con COMISIONISTA o transporte de confianza del cliente.
   - NO hay reparto propio directo a domicilio con cobertura garantizada a otras provincias o localidades alejadas.
   - Si consultan por envíos a otras ciudades/provincias (Moreno, Rosario, Bs As, Santiago del Estero, etc.): aclará amablemente que estamos en Córdoba Capital, que se puede retirar o coordinar con comisionista, y ofrecé el contacto de Mauricio para coordinar.
3. COMPRA MÍNIMA Y CLIENTES:
   - Atendemos a MAYORISTAS y PARTICULARES.
   - NO hay monto mínimo en pesos. Se comercializa por bulto/pieza cerrada (media horma, pieza entera de fiambre, caja de manteca).
4. QUEJAS Y RECLAMOS:
   - Si el cliente expresa molestia, enojo o problemas con un pedido ("no se puede trabajar así", "vino mal"): NUNCA envíes la dirección física ni menús. Mostrá empatía inmediata y derivalo con prioridad a Mauricio con su enlace de WhatsApp. Marcar complaint=true y human=true.
5. MENSAJES EXTERNOS Y FUERA DE LUGAR:
   - Si ofrecen productos (Snacks Buffalo, Fargo, publicidad), buscan trabajo (CV) o piden donaciones: aclará que este WhatsApp es exclusivo para ventas a clientes y derivalos amablemente al asesor. Marcar externalProposal=true y human=true.
6. PRECIOS Y CATÁLOGO:
   - NUNCA inventes precios, descuentos ni números.
   - Si consultan precio de un producto puntual, extraé productQuery y tier (mayorista o minorista).
   - Si piden el catálogo o la lista completa, marcar catalog=true.

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
  "social": "greeting" | "thanks" | "goodbye" | "none",
  "unknown": boolean,
  "reply": string (respuesta redactada para el cliente en español argentino)
}`;

export function renderAnswer(
  intent: Intent,
  catalog: Catalog,
  now = new Date(),
  userMessage = ''
): Pick<Answer, 'text' | 'outcome' | 'sources' | 'products'> {
  const normMsg = normalizeText(userMessage);

  // 1. Complaint / Dissatisfaction Check (HIGHEST PRIORITY - never leak address!)
  if (intent.complaint || COMPLAINT_PATTERN.test(normMsg)) {
    return {
      text: `Lamentamos muchísimo el inconveniente y entendemos tu molestia. Queremos solucionarlo de inmediato: por favor comunicate directamente con Mauricio, nuestro asesor comercial, para que revise tu situación de forma prioritaria: ${advisorUrl()}`,
      outcome: 'handoff',
      sources: ['Atención prioritaria de reclamos', 'Contacto directo del asesor'],
      products: [],
    };
  }

  // 2. External Proposals / B2B sales / CV / Donations
  if (intent.externalProposal || EXTERNAL_PATTERN.test(normMsg)) {
    return {
      text: `¡Hola! Este canal de WhatsApp es exclusivo para atención a clientes y ventas de Distribuidora Abasto del Campo (quesos, fiambres y lácteos en Córdoba).\n\nPara propuestas comerciales de proveedores, postulaciones laborales o solicitudes institucionales, por favor canalizá tu mensaje con nuestro asesor comercial: ${advisorUrl()}`,
      outcome: 'handoff',
      sources: ['Filtro de mensajes externos y derivación comercial'],
      products: [],
    };
  }

  // 3. Human advisor request
  if (intent.human || /necesito un asesor|asesor|humano|persona\b|hablar con alguien/i.test(normMsg)) {
    return {
      text: `¡Por supuesto! Podés comunicarte directamente con Mauricio, nuestro asesor comercial, en este enlace: ${advisorUrl()}. ¡Te va a atender enseguida!`,
      outcome: 'handoff',
      sources: ['Contacto directo del asesor comercial'],
      products: [],
    };
  }

  // 4. Out-of-area shipping / other cities & provinces
  const mentionsOtherCity = DISTANT_LOCATION_PATTERN.test(normMsg);
  if (intent.locationDistance || (intent.topics.includes('shipping') && mentionsOtherCity)) {
    return {
      text: `Nuestra distribuidora y depósito físico están en *Córdoba Capital* (Av. Juan B. Justo 5048).\n\nNo contamos con reparto directo propio a esa localidad. Trabajamos habitualmente con retiro en nuestro local o podemos coordinar el despacho con un comisionista o transporte de tu confianza que retire por acá.\n\nPara consultar si es factible coordinar un envío especial a tu zona, podés consultar directamente con Mauricio, nuestro asesor comercial: ${advisorUrl()}`,
      outcome: 'handoff',
      sources: ['Ubicación en Córdoba Capital', 'Condiciones de retiro y comisionistas'],
      products: [],
    };
  }

  // 5. "Ver más info" / "más info" (single coherent response, no concatenated blocks!)
  if (
    /^(ver mas info|quiero mas info|mas info|imfo|info|ver mas info buenas tardes)$/i.test(normMsg) ||
    (intent.topics.includes('information') && intent.topics.includes('shipping') && !intent.productQuery)
  ) {
    return {
      text: `¡Hola! Bienvenido/a a *Distribuidora Abasto del Campo* 👋\n\nSomos distribuidores mayoristas y minoristas de quesos, fiambres y lácteos en *Córdoba Capital* (Av. Juan B. Justo 5048).\n\n• *Venta mayorista y minorista:* no exigimos monto mínimo en dinero; comercializamos por pieza o bulto cerrado (media horma, pieza entera, caja cerrada).\n• *Retiro y logística:* podés retirar por nuestro depósito o coordinar el traslado mediante un comisionista o transporte de tu confianza.\n• *Horarios:* Lunes a Viernes de 8:00 a 17:00 hs y Sábados de 8:00 a 13:00 hs.\n\n¿Te gustaría consultar el catálogo digital de precios, consultar por un producto puntual o hablar con nuestro asesor comercial Mauricio: ${advisorUrl()}?`,
      outcome: 'answered',
      sources: ['Información general de la distribuidora', 'Ubicación y horarios', 'Modalidad de venta'],
      products: [],
    };
  }

  // 6. Catalog Opening Problem
  if (
    intent.topics.includes('catalog_problem') ||
    /no puedo abrir|no me deja ver|no abre|paseme por pdf|pasamelo por pdf|no puedo entrar ala aplicacion/i.test(normMsg)
  ) {
    const links = catalogLinks();
    return {
      text: `Te comparto los enlaces de nuestros catálogos digitales:\n${links || 'Catálogos disponibles online'}\n\n💡 *Consejo:* Podés probar abriendo el enlace desde el navegador web de tu celular (Google Chrome o Safari).\n\nSi seguís con inconvenientes para abrirlo, nuestro asesor comercial Mauricio puede enviarte el archivo PDF directamente por WhatsApp: ${advisorUrl()}`,
      outcome: 'handoff',
      sources: ['Soporte de catálogo digital', 'Enlaces de catálogo configurados'],
      products: [],
    };
  }

  // 7. Full catalog request
  if (intent.catalog && !intent.productQuery) {
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
    sources.push(facts[topic].source);
    needsHuman ||= !!facts[topic].needsHuman;
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
      } else if (products.length > 5) {
        pieces.push('Hay varias presentaciones. ¿Qué marca y tamaño buscás?');
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
      'Para armar el pedido, elegí «Nuevo Pedido» (opción 4) y enviá la lista con cantidades, productos y marcas. Esta consulta no confirma ni modifica un pedido.'
    );
    sources.push('Instrucciones del flujo de pedidos');
  }
  if (intent.unknown) {
    pieces.push('No tengo información confirmada para resolver esa consulta.');
    needsHuman = true;
  }
  if (!pieces.length && intent.social !== 'none') {
    pieces.push(
      intent.social === 'greeting'
        ? '¡Hola! Bienvenido/a a *Distribuidora Abasto del Campo* 👋 ¿En qué podemos ayudarte hoy?'
        : '¡Gracias por escribirnos! Estamos a tu disposición.'
    );
  }
  if (!pieces.length) {
    pieces.push('¿Podés contarme un poco más sobre tu consulta?');
    outcome = 'clarify';
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

  // Fast pre-filter for gibberish/single character noise / empty normalized text
  if (!norm || GIBBERISH_PATTERN.test(norm) || /^[.?¿!,\s]+$/.test(raw)) {
    return {
      ...base,
      text: `¡Hola! No llegué a comprender tu consulta. En Distribuidora Abasto del Campo podemos ayudarte con precios de quesos y fiambres, catálogo, horarios, ubicación en Córdoba o armado de pedidos.\n\n¿En qué podemos ayudarte? Si querés hablar con un asesor, podés escribirle a Mauricio: ${advisorUrl()}`,
      outcome: 'clarify',
      sources: ['Aclaración de consulta', 'Información general'],
      elapsedMs: Date.now() - started,
    };
  }

  // Fast pre-filter for direct complaints (never leak address)
  if (COMPLAINT_PATTERN.test(norm)) {
    const rendered = renderAnswer({ complaint: true } as Intent, catalog, new Date(), raw);
    return { ...base, ...rendered, elapsedMs: Date.now() - started };
  }

  // Fast pre-filter for external proposals
  if (EXTERNAL_PATTERN.test(norm)) {
    const rendered = renderAnswer({ externalProposal: true } as Intent, catalog, new Date(), raw);
    return { ...base, ...rendered, elapsedMs: Date.now() - started };
  }

  // Fast pre-filter for direct advisor request
  if (ADVISOR_PATTERN.test(norm)) {
    const rendered = renderAnswer({ human: true } as Intent, catalog, new Date(), raw);
    return { ...base, ...rendered, elapsedMs: Date.now() - started };
  }

  // Fast pre-filter for "mas info" / "Ver más info"
  if (MORE_INFO_PATTERN.test(norm)) {
    const rendered = renderAnswer({ topics: ['information'] } as Intent, catalog, new Date(), raw);
    return { ...base, ...rendered, elapsedMs: Date.now() - started };
  }

  // Fast pre-filter for out-of-area shipping
  if (DISTANT_LOCATION_PATTERN.test(norm)) {
    const rendered = renderAnswer({ topics: ['shipping'], locationDistance: true } as Intent, catalog, new Date(), raw);
    return { ...base, ...rendered, elapsedMs: Date.now() - started };
  }

  // Fast pre-filter for compra mínima
  if (MINIMUM_PATTERN.test(norm)) {
    const rendered = renderAnswer({ topics: ['minimum'] } as Intent, catalog, new Date(), raw);
    return { ...base, ...rendered, elapsedMs: Date.now() - started };
  }

  // Fast pre-filter for problems opening catalog
  if (CATALOG_PROBLEM_PATTERN.test(norm)) {
    const rendered = renderAnswer({ topics: ['catalog_problem'] } as Intent, catalog, new Date(), raw);
    return { ...base, ...rendered, elapsedMs: Date.now() - started };
  }

  try {
    const history = (input.history ?? []).slice(-8).map(turn => ({ role: turn.role, content: turn.content.slice(0, 2500) }));
    
    // Check if user is answering tier ("mayorista" / "minorista") to a previous product question
    let contextProductQuery = '';
    if (['mayorista', 'minorista', 'por mayor', 'por menor', 'para revender', 'particular', 'para mi casa'].includes(norm)) {
      for (let i = history.length - 1; i >= 0; i--) {
        const prev = normalizeText(history[i].content);
        if (prev.includes('cremoso')) { contextProductQuery = 'cremoso'; break; }
        if (prev.includes('manteca')) { contextProductQuery = 'manteca'; break; }
        if (prev.includes('sardo')) { contextProductQuery = 'sardo'; break; }
        if (prev.includes('tybo') || prev.includes('barra')) { contextProductQuery = 'tybo'; break; }
        if (prev.includes('muzzarella') || prev.includes('muzarella')) { contextProductQuery = 'muzzarella'; break; }
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

    // Safety guards against model classification quirks on complaints or out-of-area shipping:
    if (COMPLAINT_PATTERN.test(norm)) {
      intent.complaint = true;
      intent.topics = intent.topics.filter(t => t !== 'address');
    }
    if (DISTANT_LOCATION_PATTERN.test(norm)) {
      intent.locationDistance = true;
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
      text: `En este momento no puedo consultar la información. ${handoff()}`,
      outcome: 'unavailable',
      errorCode: error instanceof AiProviderError ? error.code : 'provider',
      elapsedMs: Date.now() - started,
    };
  }
}
