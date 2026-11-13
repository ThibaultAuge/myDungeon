import { useEffect, useState } from 'react';
import { useOffice } from './store.ts';

/** Server-aligned clock refreshed every second, for elapsed-time labels. */
export function useNow(): number {
  const offset = useOffice((s) => s.serverOffset);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now + offset;
}
