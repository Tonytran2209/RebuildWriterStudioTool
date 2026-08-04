import { useState, useRef } from 'react';
import type { ActionDataSource, ActionSourceType, ManualRow } from '../../types';
import { extractDocumentText } from '../../lib/fileText';

// ── helpers ──────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 9); }

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function csvPreview(text: string, maxRows = 4): string {
  return text.split('\n').slice(0, maxRows).join('\n');
}

function countRows(text: string) { return text.split('\n').filter(Boolean).length; }

function toCSV(columns: string[], rows: ManualRow[]): string {
  return [columns.join(','), ...rows.map(r => r.cells.join(','))].join('\n');
}

function extractSheetId(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m?.[1] ?? null;
}

// ── mode definitions ──────────────────────────────────────────────────────────

const MODES: { id: ActionSourceType; icon: string; label: string; hint: string }[] = [
  { id: 'file',      icon: '📁', label: 'File Upload',    hint: 'CSV, XLSX, JSON, PDF' },
  { id: 'paste',     icon: '📋', label: 'Paste Data',     hint: 'CSV, JSON, văn bản thuần' },
  { id: 'url',       icon: '🔗', label: 'URL / API',      hint: 'REST API, RSS feed' },
  { id: 'gsheet',    icon: '📊', label: 'Google Sheets',  hint: 'Link public spreadsheet' },
  { id: 'manual',    icon: '✏️', label: 'Nhập thủ công',  hint: 'Bảng dữ liệu tự tạo' },
  { id: 'supabase',  icon: '🗄️', label: 'Supabase Query', hint: 'SQL SELECT từ DB' },
  { id: 'airtable',  icon: '🔌', label: 'Airtable',       hint: 'API Key + Base ID' },
];

const SOURCE_ICONS: Record<ActionSourceType, string> = {
  file: '📁', paste: '📋', url: '🔗', gsheet: '📊', manual: '✏️', supabase: '🗄️', airtable: '🔌',
};

// ── sub-forms ─────────────────────────────────────────────────────────────────

function FileForm({ onAdd }: { onAdd: (sources: ActionDataSource[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');

  const handle = async (list: FileList | null) => {
    if (!list) return;
    setReading(true);
    setError('');
    try {
      const extracted: ActionDataSource[] = [];
      for (const f of Array.from(list)) {
        const ext = f.name.split('.').pop()?.toLowerCase() ?? 'csv';
        const content = (await extractDocumentText(f)).trim();
        if (!content) throw new Error(`${f.name} không có nội dung văn bản để AI phân tích.`);
        extracted.push({
          id: uid(), name: f.name, sourceType: 'file', addedAt: now(), contentUpdatedAt: now(),
          fileType: ext, size: formatBytes(f.size), content,
          preview: csvPreview(content), rowCount: countRows(content),
        });
      }
      onAdd(extracted);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
      if (ref.current) ref.current.value = '';
    }
  };

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); handle(e.dataTransfer.files); }}
      onClick={() => !reading && ref.current?.click()}
      className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all
        bg-emerald-50/30 border-emerald-200 hover:border-emerald-500 ${dragging ? 'scale-[0.99] opacity-75' : ''}`}
    >
      <div className="text-3xl mb-2">📁</div>
      <p className="text-xs font-bold text-slate-700">{reading ? 'Đang trích xuất nội dung...' : 'Kéo thả hoặc nhấp để chọn file'}</p>
      <p className="text-[11px] text-slate-400 mt-1">CSV · XLSX · JSON · PDF · TXT · XML</p>
      <input ref={ref} type="file" multiple accept=".csv,.xlsx,.json,.pdf,.txt,.xml,.tsv" className="hidden" onChange={e => handle(e.target.files)} />
      {error && <p className="text-[11px] text-red-600 mt-2">{error}</p>}
    </div>
  );
}

function PasteForm({ onAdd }: { onAdd: (s: ActionDataSource) => void }) {
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [fmt, setFmt] = useState<'csv' | 'json' | 'text'>('csv');

  const save = () => {
    if (!content.trim()) return;
    onAdd({
      id: uid(), name: name || `Paste ${fmt.toUpperCase()} ${shortDate()}`,
      sourceType: 'paste', addedAt: now(), contentUpdatedAt: now(), content,
      preview: csvPreview(content), rowCount: countRows(content),
    });
    setName(''); setContent('');
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Tên nguồn dữ liệu..." className={input} />
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl shrink-0">
          {(['csv','json','text'] as const).map(f => (
            <button key={f} onClick={() => setFmt(f)}
              className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all ${fmt === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <textarea
        value={content} onChange={e => setContent(e.target.value)}
        placeholder={fmt === 'csv' ? 'keyword,volume,difficulty\ncontent marketing,8100,45\n...'
          : fmt === 'json' ? '[{"keyword":"content marketing","volume":8100}]'
          : 'Nhập dữ liệu văn bản thuần...'}
        rows={7}
        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-mono text-slate-800 outline-none focus:ring-2 focus:ring-slate-800 resize-none placeholder:text-slate-300"
      />
      <div className="flex justify-between items-center">
        <span className="text-[11px] text-slate-400">{countRows(content)} dòng · {content.length} ký tự</span>
        <button onClick={save} disabled={!content.trim()} className={btn}>Lưu nguồn dữ liệu</button>
      </div>
    </div>
  );
}

function UrlForm({ onAdd }: { onAdd: (s: ActionDataSource) => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [headerKey, setHeaderKey] = useState('');
  const [headerVal, setHeaderVal] = useState('');
  const [headers, setHeaders] = useState<Record<string, string>>({});
  const [fetching, setFetching] = useState(false);
  const [preview, setPreview] = useState('');
  const [fetchedContent, setFetchedContent] = useState('');

  const addHeader = () => {
    if (!headerKey) return;
    setHeaders(h => ({ ...h, [headerKey]: headerVal }));
    setHeaderKey(''); setHeaderVal('');
  };

  const fetchPreview = async () => {
    if (!url) return;
    setFetching(true);
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setFetchedContent(text);
      setPreview(text.slice(0, 500));
    } catch (e: any) {
      setPreview(`Lỗi: ${e.message}`);
    } finally { setFetching(false); }
  };

  const save = () => {
    if (!url) return;
    onAdd({
      id: uid(), name: name || url, sourceType: 'url', addedAt: now(),
      url, headers: Object.keys(headers).length ? headers : undefined,
      contentUpdatedAt: now(), content: fetchedContent || undefined, preview: preview || url,
    });
    setName(''); setUrl(''); setHeaders({}); setPreview(''); setFetchedContent('');
  };

  return (
    <div className="space-y-3">
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Tên nguồn dữ liệu (tuỳ chọn)" className={input} />
      <div className="flex gap-2">
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://api.example.com/keywords" className={`${input} flex-1 font-mono text-[11px]`} />
        <button onClick={fetchPreview} disabled={!url || fetching} className="px-3 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 rounded-xl transition-all shrink-0 disabled:opacity-50">
          {fetching ? '...' : 'Test'}
        </button>
      </div>

      {/* Custom headers */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Headers (Authorization, API-Key...)</p>
        <div className="flex gap-2">
          <input value={headerKey} onChange={e => setHeaderKey(e.target.value)} placeholder="Key" className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-slate-800" />
          <input value={headerVal} onChange={e => setHeaderVal(e.target.value)} placeholder="Value" className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-slate-800" />
          <button onClick={addHeader} className="px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded-xl">+</button>
        </div>
        {Object.entries(headers).map(([k, v]) => (
          <div key={k} className="flex items-center gap-2 text-[11px] font-mono bg-slate-100 rounded-lg px-3 py-1">
            <span className="text-slate-600 font-bold">{k}:</span>
            <span className="text-slate-500 flex-1 truncate">{v}</span>
            <button onClick={() => setHeaders(h => { const n={...h}; delete n[k]; return n; })} className="text-slate-400 hover:text-red-500">×</button>
          </div>
        ))}
      </div>

      {preview && (
        <pre className="bg-slate-900 text-emerald-400 text-[10px] font-mono rounded-xl p-3 overflow-x-auto max-h-32">{preview}</pre>
      )}
      <div className="flex justify-end">
        <button onClick={save} disabled={!url} className={btn}>Lưu URL source</button>
      </div>
    </div>
  );
}

function GSheetForm({ onAdd }: { onAdd: (s: ActionDataSource) => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [preview, setPreview] = useState('');
  const [sheetContent, setSheetContent] = useState('');
  const [error, setError] = useState('');

  const sheetId = extractSheetId(url);
  const csvUrl = sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv` : null;

  const fetchPreview = async () => {
    if (!csvUrl) { setError('URL không hợp lệ — cần link Google Sheets công khai.'); return; }
    setFetching(true); setError('');
    try {
      const res = await fetch(csvUrl);
      if (!res.ok) throw new Error('Không thể tải — đảm bảo sheet được chia sẻ công khai.');
      const text = await res.text();
      setSheetContent(text);
      setPreview(csvPreview(text, 5));
    } catch (e: any) { setError(e.message); }
    finally { setFetching(false); }
  };

  const save = () => {
    if (!sheetId) return;
    onAdd({
      id: uid(), name: name || `Google Sheets — ${sheetId.slice(0, 8)}`,
      sourceType: 'gsheet', addedAt: now(),
      url: csvUrl!, contentUpdatedAt: now(), content: sheetContent || undefined, preview: preview || 'Google Sheets data source',
      rowCount: sheetContent ? countRows(sheetContent) : undefined,
    });
    setName(''); setUrl(''); setPreview(''); setSheetContent('');
  };

  return (
    <div className="space-y-3">
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-[11px] text-blue-800">
        Sheet phải được <strong>chia sẻ công khai</strong> (Anyone with the link → Viewer). <br />
        Paste link dạng: <code className="font-mono">docs.google.com/spreadsheets/d/...</code>
      </div>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Tên nguồn dữ liệu..." className={input} />
      <div className="flex gap-2">
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." className={`${input} flex-1 font-mono text-[11px]`} />
        <button onClick={fetchPreview} disabled={!sheetId || fetching} className="px-3 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all disabled:opacity-50 shrink-0">
          {fetching ? '...' : 'Import'}
        </button>
      </div>
      {sheetId && <p className="text-[10px] text-slate-400 font-mono">Sheet ID: {sheetId}</p>}
      {error && <p className="text-[11px] text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>}
      {preview && (
        <pre className="bg-slate-900 text-emerald-400 text-[10px] font-mono rounded-xl p-3 overflow-x-auto max-h-28">{preview}</pre>
      )}
      <div className="flex justify-end">
        <button onClick={save} disabled={!sheetId} className={btn}>Lưu Google Sheets source</button>
      </div>
    </div>
  );
}

function ManualForm({ onAdd }: { onAdd: (s: ActionDataSource) => void }) {
  const [name, setName] = useState('');
  const [columns, setColumns] = useState<string[]>(['Từ khóa', 'Volume', 'Độ khó']);
  const [rows, setRows] = useState<ManualRow[]>([{ id: uid(), cells: ['', '', ''] }]);

  const addRow = () => setRows(r => [...r, { id: uid(), cells: columns.map(() => '') }]);
  const removeRow = (id: string) => setRows(r => r.filter(x => x.id !== id));
  const updateCell = (rowId: string, ci: number, val: string) =>
    setRows(r => r.map(x => x.id === rowId ? { ...x, cells: x.cells.map((c, i) => i === ci ? val : c) } : x));
  const updateCol = (ci: number, val: string) =>
    setColumns(c => c.map((v, i) => i === ci ? val : v));
  const addCol = () => { setColumns(c => [...c, `Cột ${c.length + 1}`]); setRows(r => r.map(x => ({ ...x, cells: [...x.cells, ''] }))); };
  const removeCol = (ci: number) => { setColumns(c => c.filter((_, i) => i !== ci)); setRows(r => r.map(x => ({ ...x, cells: x.cells.filter((_, i) => i !== ci) }))); };

  const save = () => {
    const content = toCSV(columns, rows);
    onAdd({
      id: uid(), name: name || `Bảng thủ công ${shortDate()}`,
      sourceType: 'manual', addedAt: now(),
      columns, rows, content, contentUpdatedAt: now(), preview: csvPreview(content, 4),
      rowCount: rows.length,
    });
    setName(''); setRows([{ id: uid(), cells: columns.map(() => '') }]);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Tên bảng..." className={`${input} flex-1`} />
        <button onClick={addCol} className="px-3 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 rounded-xl shrink-0">+ Cột</button>
        <button onClick={addRow} className="px-3 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 rounded-xl shrink-0">+ Hàng</button>
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-xl">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {columns.map((col, ci) => (
                <th key={ci} className="p-0 min-w-[100px]">
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <input value={col} onChange={e => updateCol(ci, e.target.value)}
                      className="flex-1 font-bold text-slate-700 bg-transparent outline-none min-w-0" />
                    {columns.length > 1 && (
                      <button onClick={() => removeCol(ci)} className="text-slate-300 hover:text-red-400 shrink-0">×</button>
                    )}
                  </div>
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(row => (
              <tr key={row.id} className="group">
                {row.cells.map((cell, ci) => (
                  <td key={ci} className="p-0">
                    <input value={cell} onChange={e => updateCell(row.id, ci, e.target.value)}
                      className="w-full px-2 py-1.5 text-slate-700 bg-transparent outline-none focus:bg-blue-50/50"
                      placeholder="—" />
                  </td>
                ))}
                <td className="w-8 text-center">
                  <button onClick={() => removeRow(row.id)} className="text-slate-200 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between items-center">
        <span className="text-[11px] text-slate-400">{rows.length} hàng · {columns.length} cột</span>
        <button onClick={save} className={btn}>Lưu bảng dữ liệu</button>
      </div>
    </div>
  );
}

function SupabaseForm({ onAdd }: { onAdd: (s: ActionDataSource) => void }) {
  const [name, setName] = useState('');
  const [query, setQuery] = useState('SELECT * FROM keywords LIMIT 100;');

  const save = () => {
    if (!query.trim()) return;
    onAdd({
      id: uid(), name: name || `Supabase Query ${shortDate()}`,
      sourceType: 'supabase', addedAt: now(),
      query, preview: query,
    });
    setName(''); setQuery('SELECT * FROM keywords LIMIT 100;');
  };

  return (
    <div className="space-y-3">
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-3 text-[11px] text-slate-300">
        Query sẽ được Railway backend thực thi trên Supabase project đã kết nối. Chỉ dùng <code className="text-emerald-400">SELECT</code>.
      </div>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Tên query..." className={input} />
      <textarea
        value={query} onChange={e => setQuery(e.target.value)} rows={6}
        className="w-full bg-slate-900 text-emerald-400 border border-slate-700 rounded-xl px-4 py-3 text-xs font-mono outline-none focus:ring-2 focus:ring-emerald-600 resize-none"
      />
      <div className="flex justify-end">
        <button onClick={save} disabled={!query.trim()} className={btn}>Lưu Supabase Query</button>
      </div>
    </div>
  );
}

function AirtableForm({ onAdd }: { onAdd: (s: ActionDataSource) => void }) {
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [base, setBase] = useState('');
  const [table, setTable] = useState('');

  const save = () => {
    if (!apiKey || !base || !table) return;
    onAdd({
      id: uid(), name: name || `Airtable — ${table}`,
      sourceType: 'airtable', addedAt: now(),
      airtableKey: apiKey, airtableBase: base, airtableTable: table,
      preview: `Airtable: ${base} / ${table}`,
    });
    setName(''); setApiKey(''); setBase(''); setTable('');
  };

  return (
    <div className="space-y-3">
      <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-3 text-[11px] text-yellow-800">
        API Key được lưu mã hóa, chỉ Railway backend mới đọc được để fetch dữ liệu khi AI generate.
      </div>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Tên nguồn dữ liệu..." className={input} />
      <input value={apiKey} onChange={e => setApiKey(e.target.value)} type="password" placeholder="Airtable Personal Access Token (pat...)" className={`${input} font-mono text-[11px]`} />
      <div className="grid grid-cols-2 gap-2">
        <input value={base} onChange={e => setBase(e.target.value)} placeholder="Base ID (app...)" className={`${input} font-mono text-[11px]`} />
        <input value={table} onChange={e => setTable(e.target.value)} placeholder="Tên table" className={input} />
      </div>
      <div className="flex justify-end">
        <button onClick={save} disabled={!apiKey || !base || !table} className={btn}>Lưu Airtable source</button>
      </div>
    </div>
  );
}

// ── shared styles ─────────────────────────────────────────────────────────────

const input = 'bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-slate-800 transition-all w-full placeholder:text-slate-400';
const btn = 'px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-semibold rounded-xl transition-all';
const now = () => new Date().toISOString();
const shortDate = () => new Date().toLocaleDateString('vi-VN');

// ── main component ────────────────────────────────────────────────────────────

interface Props {
  sources: ActionDataSource[];
  onChange: (sources: ActionDataSource[]) => void;
}

export default function ActionPlanTab({ sources = [], onChange }: Props) {
  const [mode, setMode] = useState<ActionSourceType>('file');

  const addSource = (s: ActionDataSource) => onChange([s, ...sources]);
  const addSources = (newSources: ActionDataSource[]) => onChange([...newSources, ...sources]);
  const removeSource = (id: string) => onChange(sources.filter(s => s.id !== id));

  return (
    <div className="space-y-4">
      {/* Mode selector */}
      <div>
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Chọn cách nhập dữ liệu</p>
        <div className="grid grid-cols-4 gap-2">
          {MODES.map(m => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`flex flex-col items-center gap-1 py-2.5 px-2 rounded-xl border text-center transition-all ${
                mode === m.id
                  ? 'bg-slate-900 border-slate-900 text-white shadow-md'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-slate-400 hover:shadow-sm'
              }`}
            >
              <span className="text-base leading-none">{m.icon}</span>
              <span className={`text-[10px] font-bold leading-tight ${mode === m.id ? 'text-white' : 'text-slate-700'}`}>{m.label}</span>
              <span className={`text-[9px] leading-tight ${mode === m.id ? 'text-slate-400' : 'text-slate-400'}`}>{m.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Active form */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
        {mode === 'file'     && <FileForm     onAdd={addSources} />}
        {mode === 'paste'    && <PasteForm    onAdd={addSource} />}
        {mode === 'url'      && <UrlForm      onAdd={addSource} />}
        {mode === 'gsheet'   && <GSheetForm   onAdd={addSource} />}
        {mode === 'manual'   && <ManualForm   onAdd={addSource} />}
        {mode === 'supabase' && <SupabaseForm onAdd={addSource} />}
        {mode === 'airtable' && <AirtableForm onAdd={addSource} />}
      </div>

      {/* Saved sources list */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
        <div className="flex items-center justify-between mb-3 px-1">
          <h4 className="text-xs font-bold text-slate-800">
            Nguồn dữ liệu Action Plan
            <span className="text-slate-400 font-normal ml-1">({sources.length})</span>
          </h4>
          {sources.length > 0 && (
            <span className="text-[10px] text-emerald-600 font-semibold bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-md">
              AI có thể đọc {sources.length} nguồn
            </span>
          )}
        </div>

        {sources.length === 0 ? (
          <div className="text-center py-10">
            <div className="text-3xl mb-2">📂</div>
            <p className="text-xs text-slate-400">Chưa có nguồn dữ liệu nào.</p>
            <p className="text-[11px] text-slate-300 mt-0.5">Chọn cách nhập ở trên và thêm dữ liệu.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {sources.map(s => (
              <div key={s.id} className="group flex items-start gap-3 bg-white border border-slate-200 rounded-xl p-3 hover:shadow-sm transition-all">
                <span className="text-base mt-0.5 shrink-0">{SOURCE_ICONS[s.sourceType]}</span>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-800 truncate">{s.name}</span>
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-md shrink-0 ${
                      s.sourceType === 'file'      ? 'bg-emerald-100 text-emerald-700' :
                      s.sourceType === 'paste'     ? 'bg-blue-100 text-blue-700' :
                      s.sourceType === 'url'       ? 'bg-violet-100 text-violet-700' :
                      s.sourceType === 'gsheet'    ? 'bg-green-100 text-green-700' :
                      s.sourceType === 'manual'    ? 'bg-amber-100 text-amber-700' :
                      s.sourceType === 'supabase'  ? 'bg-slate-700 text-white' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {s.sourceType}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono truncate">
                    {s.preview?.split('\n')[0]}
                  </p>
                  <div className="flex items-center gap-3 text-[10px] text-slate-400">
                    {s.rowCount && <span>{s.rowCount} dòng</span>}
                    {s.size && <span>{s.size}</span>}
                    <span>{new Date(s.addedAt).toLocaleDateString('vi-VN')}</span>
                  </div>
                </div>
                <button
                  onClick={() => removeSource(s.id)}
                  className="text-slate-200 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all mt-0.5 shrink-0"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
