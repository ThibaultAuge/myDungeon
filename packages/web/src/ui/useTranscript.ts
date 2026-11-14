import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranscriptPage } from '@agent-office/shared';
import { useOffice } from '../store.ts';
import { EMPTY_DIALOGUE, mergeLatest, prependOlder, type DialogueState } from './dialogue.ts';

/** How often the open conversation is re-read. The server answers 304 when nothing changed. */
const POLL_MS = 2000;
/** No transcript yet: the server then lists every project folder, so look less often. */
const POLL_EMPTY_MS = 10_000;

export type TranscriptStatus = 'loading' | 'ready' | 'empty' | 'signin' | 'error';

function transcriptUrl(sessionId: string, agentId: string, before?: number): string {
  const q = new URLSearchParams({ session: sessionId, agent: agentId });
  if (before !== undefined) q.set('before', String(before));
  return `/api/transcript?${q.toString()}`;
}

/** The conversation of one agent: latest page polled, older pages loaded on demand. */
export function useTranscript(sessionId: string, agentId: string) {
  const [state, setState] = useState<DialogueState>(EMPTY_DIALOGUE);
  const [status, setStatus] = useState<TranscriptStatus>('loading');
  const [loadingOlder, setLoadingOlder] = useState(false);
  const etag = useRef<string | null>(null);
  const current = useRef(state);
  current.current = state;
  /** Bumped on every agent change: answers for a previous agent are dropped. */
  const generation = useRef(0);

  useEffect(() => {
    const gen = ++generation.current;
    etag.current = null;
    setState(EMPTY_DIALOGUE);
    setStatus('loading');
    let timer: number | undefined;
    const ctrl = new AbortController();

    const poll = async () => {
      let delay = POLL_MS;
      if (!document.hidden) {
        try {
          const headers: Record<string, string> = etag.current ? { 'If-None-Match': etag.current } : {};
          const res = await fetch(transcriptUrl(sessionId, agentId), { cache: 'no-store', headers, signal: ctrl.signal });
          if (gen !== generation.current) return;
          if (res.status === 304) {
            setStatus('ready');
          } else if (res.ok) {
            const page = (await res.json()) as TranscriptPage;
            if (gen !== generation.current) return;
            etag.current = res.headers.get('ETag');
            setState((prev) => mergeLatest(prev, page));
            setStatus('ready');
            if (useOffice.getState().loginFailed) useOffice.setState({ loginFailed: false });
          } else if (res.status === 401) {
            // Signed out (server restart, expiry): after signing in again, the page must be
            // fetched in full, not answered 304 against the tag seen before.
            etag.current = null;
            setStatus('signin');
          } else if (res.status === 404) {
            etag.current = null;
            setStatus('empty');
            delay = POLL_EMPTY_MS;
          } else {
            setStatus('error');
          }
        } catch {
          if (ctrl.signal.aborted || gen !== generation.current) return;
          setStatus('error');
        }
      }
      timer = window.setTimeout(poll, delay);
    };
    void poll();
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [sessionId, agentId]);

  const busy = useRef(false);
  const loadOlder = useCallback(async () => {
    const from = current.current.older;
    if (from === null || busy.current) return;
    const gen = generation.current;
    busy.current = true;
    setLoadingOlder(true);
    try {
      const res = await fetch(transcriptUrl(sessionId, agentId, from), { cache: 'no-store' });
      if (res.ok && gen === generation.current) {
        const page = (await res.json()) as TranscriptPage;
        if (gen === generation.current) setState((prev) => prependOlder(prev, page));
      }
    } catch {
      /* the next attempt (scroll or button) retries */
    } finally {
      busy.current = false;
      setLoadingOlder(false);
    }
  }, [sessionId, agentId]);

  return { ...state, status, loadingOlder, loadOlder };
}
