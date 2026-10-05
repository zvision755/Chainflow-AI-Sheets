'use client';
import { useRef, useState } from 'react';
import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from '../core/types';

type Props = { label: string; width: number; defaultWidth: number; onResize: (width: number) => void };
export function ColumnResizeHandle({ label, width, defaultWidth, onResize }: Props) {
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const resize = (next: number) => onResize(Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(next))));
  const endDrag = () => { drag.current = null; setDragging(false); };
  return <span
    className={'column-resize-handle' + (dragging ? ' dragging' : '')}
    role="separator" tabIndex={0} aria-orientation="vertical"
    aria-label={`调整 ${label} 列宽度`} aria-valuemin={MIN_COLUMN_WIDTH} aria-valuemax={MAX_COLUMN_WIDTH}
    aria-valuenow={width} aria-valuetext={`${width} 像素`}
    title="拖动调整列宽；双击恢复默认；方向键微调"
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointerId: event.pointerId, x: event.clientX, width };
      setDragging(true);
    }}
    onPointerMove={event => {
      const start = drag.current;
      if (start?.pointerId === event.pointerId) resize(start.width + event.clientX - start.x);
    }}
    onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
    onDoubleClick={() => resize(defaultWidth)}
    onKeyDown={event => {
      const step = event.shiftKey ? 80 : 20;
      const next = event.key === 'ArrowLeft' ? width - step : event.key === 'ArrowRight' ? width + step : event.key === 'Home' ? MIN_COLUMN_WIDTH : event.key === 'End' ? MAX_COLUMN_WIDTH : undefined;
      if (next !== undefined) { event.preventDefault(); resize(next); }
    }}
  />;
}
