import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import './jev-simulator.css';

type ChoiceAnswer = {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number | null;
};

type NoulAnswer = {
  type: 'noul';
  noul: number;
};

type ScoreAnswer = {
  type: 'score';
  score: number;
  probabilities: Record<string, number>;
  confidence: number | null;
  legend: Record<string, string>;
};

type JevSimulation = {
  model: string;
  elapsedMs: number;
  answers: {
    response_type: ChoiceAnswer;
    urgency: ScoreAnswer;
    human_attention: NoulAnswer;
  };
  usage: {
    input_tokens: number;
    output_tokens: number;
    cost: number | null;
  };
  reply: {
    text: string;
    outcome: string;
    label: string;
    responseType: string;
    sendMenuAfter: boolean;
  };
};

type HistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ChatTurn = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  result?: JevSimulation;
};

const scenarios = [
  { label: 'Consulta de producto', text: 'Hola, ¿tenés queso cremoso La Paulina de 4 kg? ¿Cuánto sale la horma?' },
  { label: 'Hacer un pedido', text: 'Quiero pedir 3 cajas de galletitas surtidas y 2 bultos de yerba de un kilo.' },
  { label: 'Estado de entrega', text: 'Buen día, hice un pedido ayer. ¿A qué hora llega hoy a Villa Dolores?' },
  { label: 'Reclamo', text: 'Me llegaron dos cajas rotas y necesito que alguien me dé una solución hoy.' },
  { label: 'Pago y comprobante', text: 'Te mandé el comprobante de la transferencia, ¿me confirmás si ya está acreditada?' },
  { label: 'Pedir un asesor', text: 'Necesito hablar con una persona por favor, es por una compra para mi negocio.' },
  { label: 'Saludo o cierre', text: 'Perfecto, muchas gracias. Que tengas buen día.' },
];

const responseTypeLabels: Record<string, string> = {
  greeting: 'Saludo',
  thanks: 'Agradecimiento',
  business_info: 'Información del negocio',
  address: 'Dirección',
  hours: 'Horarios',
  shipping: 'Envíos',
  minimum_purchase: 'Compra mínima',
  retail: 'Venta minorista',
  catalog: 'Catálogo',
  catalog_problem: 'Problema con el catálogo',
  menu: 'Menú principal',
  order: 'Flujo de pedido',
  order_flow: 'Flujo de pedido',
  product_info: 'Consulta de producto',
  product_advisor: 'Asesor de productos',
  advisor: 'Derivación a asesor',
  human_advisor: 'Derivación a asesor',
  delivery: 'Consulta de entrega',
  complaint: 'Atención de reclamo',
  payment: 'Consulta de pago',
  external_proposal: 'Propuesta externa',
  unclear: 'Pedido de aclaración',
  off_topic: 'Consulta fuera de tema',
  clarify: 'Pedido de aclaración',
  clarification: 'Pedido de aclaración',
  silence: 'Sin respuesta',
  fallback: 'Respuesta general',
  other: 'Respuesta general',
};

let turnSequence = 0;
const historyMessageLimit = 12;
const historyMessageCharacterLimit = 1000;
const historyTotalCharacterLimit = 6000;

function nextTurnId(role: ChatTurn['role']) {
  turnSequence += 1;
  return `${role}-${turnSequence}`;
}

function buildBoundedHistory(turns: ChatTurn[]): HistoryMessage[] {
  const candidates = turns.filter(
    (turn): turn is ChatTurn & { role: 'user' | 'assistant' } => turn.role !== 'system',
  );
  const history: HistoryMessage[] = [];
  let remainingCharacters = historyTotalCharacterLimit;

  for (let index = candidates.length - 1; index >= 0 && history.length < historyMessageLimit && remainingCharacters > 0; index -= 1) {
    const turn = candidates[index];
    const content = turn.content.trim().slice(0, Math.min(historyMessageCharacterLimit, remainingCharacters));
    if (!content) continue;
    remainingCharacters -= content.length;
    history.unshift({ role: turn.role, content });
  }
  return history;
}

function Icon({ name, size = 18 }: {
  name: 'spark' | 'reset' | 'send' | 'person' | 'bot' | 'shield' | 'route' | 'clock' | 'coins' | 'menu';
  size?: number;
}) {
  const paths = {
    spark: <><path d="m12 3 1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4L12 3Z" /><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z" /></>,
    reset: <><path d="M4 7v5h5" /><path d="M5.5 16a8 8 0 1 0 .8-9.2L4 9" /></>,
    send: <><path d="m21 3-7.5 18-4-7-7-4L21 3Z" /><path d="m9.5 14 4-4" /></>,
    person: <><circle cx="12" cy="8" r="3" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></>,
    bot: <><rect x="5" y="7" width="14" height="11" rx="3" /><path d="M12 3v4M8.5 12h.01M15.5 12h.01M9 15h6" /></>,
    shield: <><path d="M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>,
    route: <><circle cx="6" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="M8 6h4a4 4 0 0 1 4 4 4 4 0 0 1-4 4H8a2 2 0 0 0-2 2" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    coins: <><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v4c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 10v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4M5 14v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4" /></>,
    menu: <><path d="M5 7h14M5 12h14M5 17h14" /></>,
  } as const;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function humanize(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function responseLabel(result: JevSimulation) {
  const choice = result.reply.responseType || result.answers.response_type.choice;
  return result.reply.label || responseTypeLabels[choice] || humanize(choice);
}

function formatCost(cost: number | null) {
  if (cost === null || !Number.isFinite(cost)) return 'No informado';
  if (cost < 0.0001) return '< US$ 0,0001';
  return `US$ ${cost.toLocaleString('es-AR', { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`;
}

function percentage(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function confidenceFor(result: JevSimulation) {
  const answer = result.answers.response_type;
  return percentage(answer.confidence ?? answer.probabilities[answer.choice] ?? null);
}

function urgencyLabel(result: JevSimulation) {
  const key = String(Math.max(0, Math.min(2, Math.round(result.answers.urgency.score))));
  return result.answers.urgency.legend[key] ?? ['Puede esperar', 'Atender pronto', 'Atención inmediata'][Number(key)];
}

function attentionLabel(value: number) {
  if (value >= .67) return 'Derivar a una persona';
  if (value >= .4) return 'Conviene revisar';
  return 'Puede responder solo';
}

function EmptyInspector() {
  return (
    <div className="jev-inspector-empty">
      <span className="jev-inspector-empty-icon"><Icon name="route" size={22} /></span>
      <strong>Esperando la primera respuesta</strong>
      <p>Cuando hables con Jev, acá vas a ver qué tipo de respuesta eligió, con qué confianza y cuánto costó.</p>
    </div>
  );
}

function ResponseInspector({ result }: { result: JevSimulation }) {
  const confidence = confidenceFor(result);
  const attention = percentage(result.answers.human_attention.noul) ?? 0;
  const model = result.model.replace(/^typesafe\//, '').replace(/-\d{8}$/, '');

  return (
    <div className="jev-inspector-content" aria-live="polite">
      <div className="jev-route-stamp">
        <span>Respuesta elegida</span>
        <strong>{responseLabel(result)}</strong>
        <small>{result.reply.outcome ? humanize(result.reply.outcome) : 'Simulación completada'}</small>
      </div>

      <dl className="jev-decision-list">
        <div>
          <dt><span><Icon name="route" size={15} /> Confianza</span><b>{confidence === null ? '—' : `${confidence}%`}</b></dt>
          <dd><i style={{ width: `${confidence ?? 0}%` }} /></dd>
        </div>
        <div>
          <dt><span><Icon name="clock" size={15} /> Urgencia</span><b>{result.answers.urgency.score.toLocaleString('es-AR', { maximumFractionDigits: 1 })} / 2</b></dt>
          <dd><i className="is-amber" style={{ width: `${Math.max(0, Math.min(100, result.answers.urgency.score * 50))}%` }} /></dd>
          <small>{urgencyLabel(result)}</small>
        </div>
        <div>
          <dt><span><Icon name="person" size={15} /> Atención humana</span><b>{attention}%</b></dt>
          <dd><i className="is-rose" style={{ width: `${attention}%` }} /></dd>
          <small>{attentionLabel(result.answers.human_attention.noul)}</small>
        </div>
      </dl>

      {result.reply.sendMenuAfter && (
        <div className="jev-menu-note"><Icon name="menu" size={16} /><span>Después de esta respuesta también mostraría el menú.</span></div>
      )}

      <div className="jev-run-facts">
        <span><small>Modelo</small><b>{model}</b></span>
        <span><small>Tiempo</small><b>{(result.elapsedMs / 1000).toLocaleString('es-AR', { maximumFractionDigits: 2 })} s</b></span>
        <span><small>Tokens</small><b>{(result.usage.input_tokens + result.usage.output_tokens).toLocaleString('es-AR')}</b></span>
        <span><small>Costo</small><b>{formatCost(result.usage.cost)}</b></span>
      </div>
    </div>
  );
}

export default function JevSimulatorView() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [message, setMessage] = useState('');
  const [lastResult, setLastResult] = useState<JevSimulation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const feedEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const remaining = useMemo(() => 4000 - message.length, [message]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [turns, loading, error]);

  function selectScenario(text: string) {
    if (loading) return;
    setMessage(text);
    setError('');
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function resetChat() {
    if (loading) return;
    setTurns([]);
    setMessage('');
    setLastResult(null);
    setError('');
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const outgoing = message.trim();
    if (!outgoing || loading) return;

    const history = buildBoundedHistory(turns);
    const userTurnId = nextTurnId('user');

    setTurns(current => [...current, { id: userTurnId, role: 'user', content: outgoing }]);
    setMessage('');
    setError('');
    setLoading(true);

    try {
      const result = await api<JevSimulation>('/api/jev/simulate', {
        method: 'POST',
        body: JSON.stringify({ message: outgoing, history }),
      });
      const replyText = result.reply.text.trim();
      setLastResult(result);
      setTurns(current => [
        ...current,
        replyText
          ? { id: nextTurnId('assistant'), role: 'assistant', content: replyText, result }
          : {
              id: nextTurnId('system'),
              role: 'system',
              content: 'Jev decidió no enviar una respuesta para este mensaje. Esto puede pasar con cierres, agradecimientos o mensajes que no requieren una acción.',
              result,
            },
      ]);
    } catch (reason) {
      setTurns(current => current.filter(turn => turn.id !== userTurnId));
      setMessage(outgoing);
      setError(reason instanceof Error ? reason.message : 'Jev no pudo responder. Intentá nuevamente.');
    } finally {
      setLoading(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <div className="jev-simulator">
      <header className="jev-lab-header">
        <div className="jev-lab-copy">
          <span className="jev-kicker"><Icon name="spark" size={15} /> Laboratorio Jev</span>
          <h2>Conversá como si fueras un cliente</h2>
          <p>Probá consultas realistas sin datos personales, seguí la charla y mirá exactamente qué respondería Jev antes de activarlo.</p>
        </div>
        <div className="jev-lab-status" aria-label="Estado del simulador">
          <span className="jev-live-dot"><i /> Disponible</span>
          <div><small>Modelo de prueba</small><strong>Jev 1.13</strong><span>vía OpenRouter</span></div>
        </div>
      </header>

      <section className="jev-scenarios" aria-labelledby="jev-scenarios-title">
        <div className="jev-scenarios-title">
          <span id="jev-scenarios-title">Casos para probar</span>
          <small>Elegí uno y después seguí escribiendo como el mismo cliente.</small>
        </div>
        <div className="jev-scenario-list">
          {scenarios.map(scenario => (
            <button
              key={scenario.label}
              type="button"
              disabled={loading}
              className={message === scenario.text ? 'active' : ''}
              aria-pressed={message === scenario.text}
              onClick={() => selectScenario(scenario.text)}
            >
              {scenario.label}
            </button>
          ))}
        </div>
      </section>

      <div className="jev-workbench">
        <section className="jev-chat" aria-label="Chat de prueba con Jev">
          <header className="jev-chat-header">
            <div className="jev-contact-avatar"><Icon name="person" size={19} /></div>
            <div className="jev-chat-title">
              <strong>Cliente de prueba</strong>
              <span><i /> Jev responde con las reglas del negocio</span>
            </div>
            <button type="button" className="jev-reset-button" disabled={loading || (turns.length === 0 && !message)} onClick={resetChat}>
              <Icon name="reset" size={15} /><span>Nueva charla</span>
            </button>
          </header>

          <div className="jev-chat-feed" aria-live="polite" aria-busy={loading}>
            {turns.length === 0 && (
              <div className="jev-welcome">
                <span className="jev-bot-avatar"><Icon name="bot" size={18} /></span>
                <div>
                  <strong>Jev está listo para la prueba</strong>
                  <p>Escribí como si fueras un cliente o elegí un caso de arriba. Podés continuar la conversación durante todos los mensajes que quieras.</p>
                </div>
              </div>
            )}

            {turns.map(turn => turn.role === 'system' ? (
              <div className="jev-system-message" key={turn.id} role="note">
                <span>Sin mensaje enviado</span>
                <p>{turn.content}</p>
                {turn.result && <small>{responseLabel(turn.result)}</small>}
              </div>
            ) : (
              <article className={`jev-chat-turn is-${turn.role}`} key={turn.id}>
                <span className="jev-turn-avatar"><Icon name={turn.role === 'assistant' ? 'bot' : 'person'} size={15} /></span>
                <div className="jev-turn-content">
                  <div className="jev-message-bubble">{turn.content}</div>
                  {turn.role === 'assistant' && turn.result && (
                    <div className="jev-response-tag">
                      <Icon name="route" size={12} />
                      <span>{responseLabel(turn.result)}</span>
                      {turn.result.reply.sendMenuAfter && <b>+ menú</b>}
                    </div>
                  )}
                </div>
              </article>
            ))}

            {loading && (
              <article className="jev-chat-turn is-assistant jev-typing" role="status">
                <span className="jev-turn-avatar"><Icon name="bot" size={15} /></span>
                <div className="jev-message-bubble" aria-label="Jev está escribiendo"><i /><i /><i /></div>
              </article>
            )}

            {error && (
              <div className="jev-chat-error" role="alert">
                <strong>No se pudo obtener la respuesta</strong>
                <span>{error} Tu mensaje quedó listo para volver a enviarlo.</span>
              </div>
            )}
            <div ref={feedEndRef} />
          </div>

          <form className="jev-composer" onSubmit={sendMessage}>
            <label htmlFor="jev-chat-message" className="jev-sr-only">Mensaje del cliente</label>
            <div className="jev-composer-field">
              <textarea
                id="jev-chat-message"
                ref={textareaRef}
                value={message}
                onChange={event => { setMessage(event.target.value.slice(0, 4000)); setError(''); }}
                onKeyDown={handleComposerKeyDown}
                disabled={loading}
                rows={2}
                maxLength={4000}
                placeholder="Escribí el próximo mensaje del cliente…"
                autoComplete="off"
              />
              <span className={remaining < 200 ? 'near-limit' : ''}>{message.length.toLocaleString('es-AR')} / 4.000</span>
            </div>
            <button className="jev-send-button" type="submit" disabled={loading || !message.trim()} aria-label="Enviar mensaje a Jev">
              {loading ? <span className="spinner" /> : <Icon name="send" size={18} />}
              <span>Enviar</span>
            </button>
            <small className="jev-composer-hint">Enter para enviar · Shift + Enter para otra línea</small>
          </form>
        </section>

        <aside className="jev-inspector" aria-label="Detalle de la última respuesta">
          <header>
            <div><span>Última decisión</span><strong>Qué hizo Jev</strong></div>
            {lastResult && <span className="jev-complete-pill"><i /> Lista</span>}
          </header>
          {lastResult ? <ResponseInspector result={lastResult} /> : <EmptyInspector />}
          <footer>
            <Icon name="shield" size={16} />
            <p><strong>Solo es una simulación.</strong> No envía mensajes por WhatsApp ni cambia pedidos o contactos. El texto y el contexto de la prueba se procesan en OpenRouter.</p>
          </footer>
        </aside>
      </div>
    </div>
  );
}
