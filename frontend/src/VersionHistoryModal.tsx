import { useSheetFocus } from './useSheetFocus';
import { RELEASE_HISTORY } from './releaseHistory';
import './version-history.css';

const releaseDateFormatter = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatReleaseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return releaseDateFormatter.format(new Date(Date.UTC(year, month - 1, day)));
}

export default function VersionHistoryModal({ onClose }: { onClose: () => void }) {
  const modalRef = useSheetFocus(true, onClose);
  return (
    <div className="modal-backdrop" role="presentation" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        id="version-history-dialog"
        ref={modalRef}
        className="modal-sheet version-history-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-history-title"
        aria-describedby="version-history-description"
      >
        <header className="sheet-header">
          <div className="sheet-header-left">
            <p className="eyebrow">Bitácora del proyecto</p>
            <h2 id="version-history-title">Historial de versiones</h2>
            <p id="version-history-description">Cambios principales publicados en AbastoBot.</p>
          </div>
          <button type="button" className="sheet-close-btn" aria-label="Cerrar historial de versiones" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <ol className="release-timeline" aria-label="Versiones publicadas">
          {RELEASE_HISTORY.map((release, index) => (
            <li key={release.version} className={`release-entry ${index === 0 ? 'current' : ''}`} aria-current={index === 0 ? 'true' : undefined}>
              <time dateTime={release.releasedAt}>{formatReleaseDate(release.releasedAt)}</time>
              <div className="release-entry-copy">
                <div className="release-version-line">
                  <h3>v{release.version}</h3>
                  {index === 0 && <span className="release-current-badge">Versión actual</span>}
                </div>
                <p>{release.summary}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
