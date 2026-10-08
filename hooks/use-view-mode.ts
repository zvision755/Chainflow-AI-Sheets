'use client';
import { useEffect, useState } from 'react';

export type ViewPreference = 'auto' | 'mobile' | 'desktop';
export const VIEW_STORAGE = 'chainflow-view-preference-v1';
export function useViewMode() {
  const [preference, setPreference] = useState<ViewPreference>('auto');
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    try {
      const saved = localStorage.getItem(VIEW_STORAGE);
      if (saved === 'mobile' || saved === 'desktop') setPreference(saved);
    } catch { /* The view remains usable when browser storage is disabled. */ }
    return () => query.removeEventListener('change', update);
  }, []);
  function choose(value: ViewPreference) {
    setPreference(value);
    try { localStorage.setItem(VIEW_STORAGE, value); } catch { /* Session preference still applies. */ }
  }
  return { preference, mobile: preference === 'mobile' || (preference === 'auto' && narrow), choose };
}
