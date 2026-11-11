import { useMemo, useState } from 'react';

type Row = { text: string; old?: number; next?: number; kind: 'context' | 'remove' | 'add' };

function compare(before: string, after: string) {
  const split = (text: string) => text.replace(/\r\n?/g, '\n').split('\n');
  const a = split(before);
  const b = split(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const width = endB - start + 1;
  const cells = (endA - start + 1) * width;
  const table = cells <= 500_000 ? new Uint32Array(cells) : null;
  if (table) {
    for (let i = endA - 1; i >= start; i--) {
      for (let j = endB - 1; j >= start; j--) {
        const index = (i - start) * width + j - start;
        table[index] = a[i] === b[j] ? 1 + table[index + width + 1] : Math.max(table[index + width], table[index + 1]);
      }
    }
  }
  const rows: Row[] = [];
  let i = start, j = start;
  while (i < endA || j < endB) {
    const index = (i - start) * width + j - start;
    if (table && i < endA && j < endB && a[i] === b[j]) {
      rows.push({ text: a[i], old: ++i, next: ++j, kind: 'context' });
    } else if (i < endA && (j === endB || !table || table[index + width] >= table[index + 1])) {
      rows.push({ text: a[i], old: ++i, kind: 'remove' });
    } else {
      rows.push({ text: b[j], next: ++j, kind: 'add' });
    }
  }
  return { rows, simplified: !table };
}

export function MergeLineDiff({ local, remote, draft }: { local: string; remote: string; draft: string }) {
  const [source, setSource] = useState<'local' | 'remote'>('local');
  const [limit, setLimit] = useState(300);
  const { rows, simplified } = useMemo(() => compare(source === 'local' ? local : remote, draft), [source, local, remote, draft]);
  return (
    <div className="flex min-h-0 flex-1 flex-col text-xs">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-2 dark:border-slate-700">
        {(['local', 'remote'] as const).map((side) => (
          <button key={side} type="button" aria-pressed={source === side}
            className={`rounded-md px-2 py-1 ${source === side ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200' : ''}`}
            onClick={() => { setSource(side); setLimit(300); }}>
            {side === 'local' ? '本地 → 草稿' : '远端 → 草稿'}
          </button>
        ))}
        {simplified && <span>变更较多，按整段对比</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto font-mono">
        {!rows.length && <p className="p-3">没有内容差异。</p>}
        {rows.slice(0, limit).map((row, index) => (
          <div key={index} className={`flex min-w-full w-max gap-2 px-2 py-0.5 ${row.kind === 'add' ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' : row.kind === 'remove' ? 'bg-rose-50 text-rose-900 dark:bg-rose-950 dark:text-rose-200' : ''}`}>
            <span className="w-10 text-right">{row.old}</span><span className="w-10 text-right">{row.next}</span>
            <span className="w-3" aria-label={row.kind === 'add' ? '新增' : row.kind === 'remove' ? '删除' : '未改动'}>{row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' '}</span>
            <span className="whitespace-pre">{row.text}</span>
          </div>
        ))}
        {rows.length > limit && <button type="button" className="p-2 underline" onClick={() => setLimit((n) => n + 300)}>显示更多差异</button>}
      </div>
    </div>
  );
}
