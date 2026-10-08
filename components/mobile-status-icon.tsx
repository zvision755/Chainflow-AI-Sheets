import { Check, CircleAlert, Clock3, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { labels, type Status } from '../core/types';

export function MobileStatusIcon({ status, error, interactive = false }: { status: Status; error?: string; interactive?: boolean }) {
  if (status === 'idle') return null;
  const Icon = status === 'done' ? Check : status === 'running' ? LoaderCircle : status === 'queued' ? Clock3 : status === 'stale' ? RotateCcw : status === 'cancelled' ? X : CircleAlert;
  const description = `${labels[status]}${error ? `：${error}` : ''}`;
  const icon = <span className={`mobile-status-icon ${status}`} aria-label={description} title={description}><Icon size={15} aria-hidden="true"/></span>;
  return interactive ? <details className="mobile-status-details"><summary aria-label={`查看状态：${description}`}>{icon}</summary><span className="mobile-status-popover" role="status">{description}</span></details> : icon;
}
