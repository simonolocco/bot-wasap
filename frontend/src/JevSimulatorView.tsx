import { FormEvent, useMemo, useState } from 'react';
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
    intent: ChoiceAnswer;
    urgency: ScoreAnswer;
    human_attention: NoulAnswer;
  };
  usage: {
    input_tokens: number;
    output_tokens: number;
    cost: number | null;
  };
};

const intentLabels: Record<string, string> = {
  order: 'Pedido',
  product_info: 'Productos y precios',
  delivery: 'Entrega',
  complaint: 'Reclamo',
  payment: 'Pago o comprobante',
  advisor: 'Hablar con asesor',
  other: 'Otro',
};

const presets = [
  { label: 'Reclamo', text: 'Me llegaron dos cajas rotas y necesito que alguien me dé una solución hoy.' },
  { label: 'Precios', text: 'Hola, ¿cuánto está la caja de mermelada y tienen stock para esta semana?' },
  { label: 'Entrega', text: 'Hice el pedido ayer. ¿Saben a qué hora llega a Villa Dolores?' },
  { label: 'Pedido', text: 'Quiero repetir el pedido de la semana pasada y agregar tres cajas de galletitas.' },
];

function Icon({ name, size = 18 }: { name: 'spark' | 'route' | 'clock' | 'person' | 'play' | 'shield'; size?: number }) {
  const paths = {
    spark: <><path d="m12 3 1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4L12 3Z" /><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z" /></>,
    route: <><circle cx="6" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="M8 6h4a4 4 0 0 1 4 4v0a4 4 0 0 1-4 4H8a2 2 0 0 0-2 2v0" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    person: <><circle cx="12" cy="8" r="3" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></>,
    play: <><path d="m9 7 8 5-8 5V7Z" /></>,
    shield: <><path d="M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>,
  } as const;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function formatCost(cost: number | null) {
  if (cost === null || !Number.isFinite(cost)) return 'No informado';
  if (cost < 0.0001) return '< US$ 0,0001';
  return `US$ ${cost.toLocaleString('es-AR', { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`;
}

function percent(value: number) {
  return Math.max(0, Math.min(100, Math.round((Number(value) || 0) * 100)));
}

function confidenceCopy(confidence: number | null) {
  if (confidence === null) return 'Confianza no informada';
  if (confidence >= .8) return 'Decisión definida';
  if (confidence >= .55) return 'Decisión moderada';
  return 'Resultado repartido';
}

function ProbabilityRows({
  probabilities,
  labels,
  selected,
}: {
  probabilities: Record<string, number>;
  labels: Record<string, string>;
  selected?: string;
}) {
  const entries = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <p className="jev-probability-empty">Distribución no informada por el modelo.</p>;
  return (
    <div className="jev-probability-list">
      {entries.map(([key, value]) => (
        <div className={`jev-probability-row ${selected === key ? 'is-selected' : ''}`} key={key}>
          <div className="jev-probability-copy">
            <span>{labels[key] ?? key}</span>
            <strong>{percent(value)}%</strong>
          </div>
          <div className="jev-probability-track" role="progressbar" aria-label={`${labels[key] ?? key}: ${percent(value)}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent(value)}>
            <i style={{ width: `${percent(value)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyResult() {
  return (
    <div className="jev-empty-result">
      <div className="jev-empty-mark" aria-hidden="true"><span>J</span><i /><i /></div>
      <div>
        <strong>La decisión aparece acá</strong>
        <p>Jev evaluará las tres preguntas en paralelo y mostrará la probabilidad de cada resultado.</p>
      </div>
      <div className="jev-empty-lanes" aria-hidden="true">
        <span><Icon name="route" /> Intención</span>
        <span><Icon name="clock" /> Urgencia</span>
        <span><Icon name="person" /> Asesor</span>
      </div>
    </div>
  );
}

function SimulationResult({ result }: { result: JevSimulation }) {
  const attention = result.answers.human_attention.noul;
  const urgencyLabels = Object.fromEntries(Object.entries(result.answers.urgency.legend).map(([key, value]) => [key, value]));
  const urgencySelected = String(Math.round(result.answers.urgency.score));

  return (
    <div className="jev-result" aria-live="polite">
      <header className="jev-result-header">
        <div>
          <span className="jev-section-label">Resultado de la simulación</span>
          <strong>{intentLabels[result.answers.intent.choice] ?? result.answers.intent.choice}</strong>
        </div>
        <span className="jev-result-state">{confidenceCopy(result.answers.intent.confidence)}</span>
      </header>

      <section className="jev-decision-card jev-decision-intent">
        <div className="jev-decision-heading">
          <span className="jev-decision-icon"><Icon name="route" /></span>
          <div><small>Decisión 01</small><h3>Intención principal</h3></div>
          <b>{result.answers.intent.confidence === null ? 'Confianza no informada' : `${percent(result.answers.intent.confidence)}% confianza`}</b>
        </div>
        <ProbabilityRows probabilities={result.answers.intent.probabilities} labels={intentLabels} selected={result.answers.intent.choice} />
      </section>

      <div className="jev-decision-grid">
        <section className="jev-decision-card">
          <div className="jev-decision-heading">
            <span className="jev-decision-icon amber"><Icon name="clock" /></span>
            <div><small>Decisión 02</small><h3>Urgencia</h3></div>
          </div>
          <div className="jev-score-readout"><strong>{result.answers.urgency.score.toFixed(2)}</strong><span>sobre 2</span></div>
          <ProbabilityRows probabilities={result.answers.urgency.probabilities} labels={urgencyLabels} selected={urgencySelected} />
        </section>

        <section className="jev-decision-card">
          <div className="jev-decision-heading">
            <span className="jev-decision-icon rose"><Icon name="person" /></span>
            <div><small>Decisión 03</small><h3>Atención humana</h3></div>
          </div>
          <div className="jev-human-answer">
            <strong>{percent(attention)}%</strong>
            <span>{attention >= .5 ? 'Sí necesita asesor' : 'Puede seguir el flujo automático'}</span>
          </div>
          <ProbabilityRows
            probabilities={{ yes: attention, no: 1 - attention }}
            labels={{ yes: 'Necesita asesor', no: 'Flujo automático' }}
            selected={attention >= .5 ? 'yes' : 'no'}
          />
        </section>
      </div>

      <footer className="jev-run-meta">
        <span><b>Modelo</b>{result.model.replace(/-\d{8}$/, '')}</span>
        <span><b>Tiempo</b>{(result.elapsedMs / 1000).toLocaleString('es-AR', { maximumFractionDigits: 2 })} s</span>
        <span><b>Entrada</b>{result.usage.input_tokens.toLocaleString('es-AR')} tokens</span>
        <span><b>Costo</b>{formatCost(result.usage.cost)}</span>
      </footer>
    </div>
  );
}

export default function JevSimulatorView() {
  const [message, setMessage] = useState(presets[0].text);
  const [result, setResult] = useState<JevSimulation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const remaining = useMemo(() => 4000 - message.length, [message]);

  async function simulate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (message.trim().length < 3 || loading) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      setResult(await api<JevSimulation>('/api/jev/simulate', {
        method: 'POST',
        body: JSON.stringify({ message: message.trim() }),
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo completar la simulación.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="jev-simulator">
      <section className="jev-hero">
        <div className="jev-hero-copy">
          <span className="jev-kicker"><Icon name="spark" size={15} /> Laboratorio de decisiones</span>
          <h2>Probá una decisión antes de automatizarla</h2>
          <p>Pegá un mensaje de cliente y observá cómo Jev clasifica la intención, estima la urgencia y decide si conviene la atención de una persona.</p>
        </div>
        <div className="jev-model-card">
          <span className="jev-model-pulse"><i /></span>
          <div><small>Modelo activo</small><strong>Jev 1.13</strong><span>vía OpenRouter</span></div>
        </div>
      </section>

      <div className="jev-workbench">
        <form className="jev-input-panel" onSubmit={simulate}>
          <header>
            <div><span className="jev-section-label">Entrada de prueba</span><h3>Mensaje del cliente</h3></div>
            <span className="jev-mode-badge"><i /> Solo simulación</span>
          </header>

          <div className="jev-presets" aria-label="Ejemplos rápidos">
            {presets.map(preset => (
              <button key={preset.label} type="button" disabled={loading} className={message === preset.text ? 'active' : ''} onClick={() => { setMessage(preset.text); setResult(null); setError(''); }}>
                {preset.label}
              </button>
            ))}
          </div>

          <label className="jev-message-field">
            <span>Escribí o pegá un mensaje real</span>
            <textarea
              value={message}
              onChange={event => { setMessage(event.target.value.slice(0, 4000)); setResult(null); setError(''); }}
              disabled={loading}
              rows={8}
              minLength={3}
              maxLength={4000}
              placeholder="Ejemplo: Quiero saber si tienen stock y cuánto demora la entrega…"
              required
            />
            <small className={remaining < 200 ? 'near-limit' : ''}>{message.length.toLocaleString('es-AR')} / 4.000</small>
          </label>

          {error && <div className="jev-error" role="alert">{error}</div>}

          <button className="button primary jev-run-button" type="submit" disabled={loading || message.trim().length < 3}>
            {loading ? <><span className="spinner" /> Jev está evaluando…</> : <><Icon name="play" /> Evaluar mensaje</>}
          </button>

          <div className="jev-privacy-note">
            <Icon name="shield" size={17} />
            <p><strong>No ejecuta acciones.</strong> El mensaje se envía a OpenRouter para esta prueba y no se guarda en AbastoBot.</p>
          </div>
        </form>

        <section className={`jev-output-panel ${loading ? 'is-loading' : ''}`} aria-busy={loading}>
          {result ? <SimulationResult result={result} /> : <EmptyResult />}
          {loading && <div className="jev-loading-wash"><span className="spinner large" /><strong>Evaluando tres decisiones en paralelo</strong></div>}
        </section>
      </div>
    </div>
  );
}
