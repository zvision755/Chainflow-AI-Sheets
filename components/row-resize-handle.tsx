'use client';
import { useRef, useState } from 'react';
import { MAX_ROW_HEIGHT, MIN_ROW_HEIGHT } from '../core/types';

type Props = { label: string; height: number; onResize: (height: number | null) => void };
export function RowResizeHandle({ label, height, onResize }: Props) {
  const drag = useRef<{ pointerId: number; y: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const resize = (next: number) => onResize(Math.max(MIN_ROW_HEIGHT, Math.min(MAX_ROW_HEIGHT, Math.round(next))));
  const endDrag = () => { drag.current = null; setDragging(false); };
  return <span
    className={'row-resize-handle' + (dragging ? ' dragging' : '')}
    role="separator" tabIndex={0} aria-orientation="horizontal"
    aria-label={`调整第 ${label} 行高度`} aria-valuemin={MIN_ROW_HEIGHT} aria-valuemax={MAX_ROW_HEIGHT}
    aria-valuenow={height} aria-valuetext={`${height} 像素`}
    title="拖动调整行高；双击恢复自动；方向键微调"
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointerId: event.pointerId, y: event.clientY, height };
      setDragging(true);
    }}
    onPointerMove={event => {
      const start = drag.current;
      if (start?.pointerId === event.pointerId) resize(start.height + event.clientY - start.y);
    }}
    onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
    onDoubleClick={() => onResize(null)}
    onKeyDown={event => {
      const step = event.shiftKey ? 80 : 20;
      const next = event.key === 'ArrowUp' ? height - step : event.key === 'ArrowDown' ? height + step : event.key === 'Home' ? MIN_ROW_HEIGHT : event.key === 'End' ? MAX_ROW_HEIGHT : undefined;
      if (next !== undefined) { event.preventDefault(); resize(next); }
    }}
  />;
}
