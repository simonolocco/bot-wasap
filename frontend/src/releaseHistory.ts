import { APP_VERSION } from './appVersion';

export type ReleaseHistoryEntry = Readonly<{
  version: string;
  releasedAt: string;
  summary: string;
}>;

export const RELEASE_HISTORY = [
  {
    version: APP_VERSION,
    releasedAt: '2026-09-23',
    summary: 'Retiramos Laboratorio y el simulador independiente del panel. Jev sigue activo y sus respuestas se pueden probar desde IA.',
  },
  {
    version: '2.4.0',
    releasedAt: '2026-09-22',
    summary: 'Jev quedó listo para probar y activar, con respuestas completas, límites de uso y cierres silenciosos cuando el cliente agradece.',
  },
  {
    version: '2.3.0',
    releasedAt: '2026-09-22',
    summary: 'Sumamos el simulador de Jev y conectamos sus decisiones con el flujo real de respuestas y derivaciones al asesor.',
  },
  {
    version: '2.2.0',
    releasedAt: '2026-09-14',
    summary: 'Simplificamos la revisión de respuestas de IA, asociamos etiquetas y agregamos la exportación de analíticas a Excel.',
  },
  {
    version: '2.1.0',
    releasedAt: '2026-09-13',
    summary: 'La IA pasó a priorizar respuestas útiles, con previsualizaciones privadas antes de llevar cada cambio a producción.',
  },
  {
    version: '2.0.0',
    releasedAt: '2026-09-07',
    summary: 'Estrenamos la base de IA con información verificada, controles contra respuestas inventadas y una navegación móvil renovada.',
  },
  {
    version: '1.3.0',
    releasedAt: '2026-09-06',
    summary: 'Incorporamos la segmentación por tipo de consulta y seguimientos personalizados con el asesor comercial.',
  },
  {
    version: '1.2.0',
    releasedAt: '2026-08-21',
    summary: 'Agregamos analíticas interactivas del bot, tablas adaptables y mejor manejo de consultas, seguimientos y archivos.',
  },
  {
    version: '1.1.0',
    releasedAt: '2026-08-19',
    summary: 'Rediseñamos el panel comercial y sus vistas de tickets, contactos, pedidos y plantillas.',
  },
  {
    version: '1.0.0',
    releasedAt: '2026-08-14',
    summary: 'Publicamos la primera versión estable con conversaciones, menús, contactos, pedidos y copias de seguridad.',
  },
] as const satisfies readonly ReleaseHistoryEntry[];
