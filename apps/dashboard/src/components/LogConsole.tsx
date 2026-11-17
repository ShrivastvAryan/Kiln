'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import {
  ArrowDown,
  Check,
  Clock,
  Copy,
  Download,
  Maximize2,
  Minimize2,
  Search,
  TerminalSquare,
  WrapText,
  X,
} from 'lucide-react';
import type { LogLine } from '@deployx/shared/types';
import { useCopy } from '@/hooks/misc';
import { parseAnsi, stripAnsi } from '@/lib/ansi';
import { cn, formatClock } from '@/lib/format';

interface Props {
  lines: LogLine[];
  connected: boolean;
  loaded: boolean;
  active: boolean;
  filename: string;
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'));
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-amber-400/30 text-amber-100">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}

const Row = memo(function Row({
  line,
  showTime,
  wrap,
  query,
}: {
  line: LogLine;
  showTime: boolean;
  wrap: boolean;
  query: string;
}) {
  const segments = useMemo(() => parseAnsi(line.m), [line.m]);
  return (
    <div
      className={cn(
        'group flex gap-3 border-l-2 px-3 py-px hover:bg-white/[0.03]',
        line.s === 'stderr' ? 'border-rose-500/70 bg-rose-500/[0.06]' : 'border-transparent',
      )}
    >
      <span className="w-10 shrink-0 text-right text-stone-600 select-none group-hover:text-stone-500">{line.n}</span>
      {showTime && <span className="shrink-0 text-stone-600 select-none">{formatClock(line.t)}</span>}
      <span
        className={cn(
          'min-w-0 flex-1',
          wrap ? 'break-all whitespace-pre-wrap' : 'whitespace-pre',
          line.s === 'system' ? 'text-brand-300' : line.s === 'stderr' ? 'text-rose-200' : 'text-stone-300',
        )}
      >
        {line.s === 'system' && <span className="mr-1.5 text-brand-500 select-none">›</span>}
        {query ? (
          <Highlight text={stripAnsi(line.m)} query={query} />
        ) : (
          segments.map((s, i) => (
            <span
              key={i}
              style={{ color: s.color }}
              className={cn(s.bold && 'font-semibold', s.dim && 'opacity-60', s.underline && 'underline')}
            >
              {s.text}
            </span>
          ))
        )}
      </span>
    </div>
  );
});

function ToolButton({
  onClick,
  label,
  active,
  children,
}: {
  onClick: () => void;
  label: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md transition-colors cursor-pointer',
        active ? 'bg-white/10 text-stone-100' : 'text-stone-500 hover:bg-white/5 hover:text-stone-200',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Virtualised terminal: only visible rows are mounted, so it stays smooth with 25k+ lines.
 * Auto-follows output while scrolled to the bottom; scrolling up pauses following.
 */
export function LogConsole({ lines, connected, loaded, active, filename }: Props) {
  const virtuoso = useRef<VirtuosoHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [showTime, setShowTime] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [query, setQuery] = useState('');
  const { copied, copy } = useCopy();

  const visible = useMemo(() => {
    if (!query) return lines;
    const q = query.toLowerCase();
    return lines.filter((l) => stripAnsi(l.m).toLowerCase().includes(q));
  }, [lines, query]);

  const errorCount = useMemo(() => lines.filter((l) => l.s === 'stderr').length, [lines]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFullscreen(false);
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [fullscreen]);

  const asText = () =>
    lines.map((l) => `${new Date(l.t).toISOString()} [${l.s}] ${stripAnsi(l.m)}`).join('\n');

  const download = () => {
    const blob = new Blob([asText()], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const scrollToBottom = () =>
    virtuoso.current?.scrollToIndex({ index: visible.length - 1, behavior: 'smooth', align: 'end' });

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden border border-stone-800 bg-[#0c0a09] text-stone-300 shadow-inner',
        fullscreen ? 'fixed inset-0 z-50 rounded-none' : 'relative h-[460px] rounded-xl sm:h-[560px]',
      )}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-stone-800 bg-[#141110] px-3 py-2">
        <div className="mr-auto flex items-center gap-2 text-[13px]">
          <TerminalSquare className="size-4 text-stone-500" />
          <span className="font-medium text-stone-200">Build logs</span>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
              active && connected
                ? 'bg-emerald-500/10 text-emerald-400'
                : connected
                  ? 'bg-stone-800 text-stone-400'
                  : 'bg-rose-500/10 text-rose-400',
            )}
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                active && connected ? 'animate-pulse bg-emerald-400' : connected ? 'bg-stone-500' : 'bg-rose-400',
              )}
            />
            {!connected ? 'Reconnecting' : active ? 'Streaming' : 'Complete'}
          </span>
        </div>

        <div className="relative order-last w-full sm:order-none sm:w-56">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-stone-500" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder="Filter logs…"
            aria-label="Filter logs"
            className="h-7 w-full rounded-md border border-stone-800 bg-black/40 pr-7 pl-8 text-xs text-stone-200 placeholder:text-stone-600 focus:border-brand-500/60 focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear filter"
              className="absolute top-1/2 right-2 -translate-y-1/2 text-stone-500 hover:text-stone-200 cursor-pointer"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          <ToolButton label="Show timestamps" active={showTime} onClick={() => setShowTime((v) => !v)}>
            <Clock className="size-3.5" />
          </ToolButton>
          <ToolButton label="Wrap lines" active={wrap} onClick={() => setWrap((v) => !v)}>
            <WrapText className="size-3.5" />
          </ToolButton>
          <ToolButton label={copied ? 'Copied!' : 'Copy all logs'} onClick={() => copy(asText())}>
            {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
          </ToolButton>
          <ToolButton label="Download logs" onClick={download}>
            <Download className="size-3.5" />
          </ToolButton>
          <ToolButton label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={() => setFullscreen((v) => !v)}>
            {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </ToolButton>
        </div>
      </div>

      {/* Body */}
      <div className="relative min-h-0 flex-1 font-mono text-[12.5px] leading-[1.7]">
        {!loaded ? (
          <div className="grid h-full place-items-center text-stone-500">
            <span className="flex items-center gap-2 text-xs">
              <span className="size-3 animate-spin rounded-full border-2 border-stone-700 border-t-brand-400" />
              Connecting to log stream…
            </span>
          </div>
        ) : visible.length === 0 ? (
          <div className="grid h-full place-items-center text-xs text-stone-500">
            {query ? `No lines match "${query}"` : active ? 'Waiting for output…' : 'No logs recorded.'}
          </div>
        ) : (
          <Virtuoso
            ref={virtuoso}
            data={visible}
            computeItemKey={(_, l) => l.n}
            followOutput={(isAtBottom) => (isAtBottom && !query ? 'auto' : false)}
            atBottomStateChange={setAtBottom}
            atBottomThreshold={40}
            initialTopMostItemIndex={visible.length - 1}
            increaseViewportBy={400}
            className="py-2"
            itemContent={(_, line) => <Row line={line} showTime={showTime} wrap={wrap} query={query} />}
          />
        )}

        {!atBottom && visible.length > 0 && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 left-1/2 inline-flex -translate-x-1/2 animate-slide-up items-center gap-1.5 rounded-full border border-stone-700 bg-stone-900/95 px-3 py-1.5 text-xs text-stone-200 shadow-lg backdrop-blur hover:bg-stone-800 cursor-pointer"
          >
            <ArrowDown className="size-3.5" />
            {active ? 'Follow live output' : 'Jump to end'}
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-stone-800 bg-[#141110] px-3 py-1.5 font-mono text-[11px] text-stone-500">
        <span>
          {query ? `${visible.length} of ${lines.length} lines` : `${lines.length.toLocaleString()} lines`}
          {errorCount > 0 && <span className="ml-3 text-rose-400">{errorCount} stderr</span>}
        </span>
        <span className="hidden sm:inline">{fullscreen ? 'Esc to exit' : 'SSE · Redis pub/sub'}</span>
      </div>
    </div>
  );
}
