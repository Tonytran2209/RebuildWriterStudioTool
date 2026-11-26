import type { ReactNode } from 'react';
import type { AppConfig, DocumentFile, WorkflowRuleId } from '../types';
import { compileWorkflowRules, getWorkflowRuleSetting } from '../lib/workflowRules';
import { useI18n } from '../lib/i18n';
import { GATES } from './model';
import { I } from './ui';
import { CACHEABLE_ROLES, GATE_DOCUMENT_CONTRACT, ROLE_LABEL_VI, ROLE_ORDER, isBrandContext, kbRoleOf, primaryPlaybookId, ruleRoleOf, storageGroupInfo, type GateRole } from '../../shared/gateDocuments';
import { GATE_SETTINGS, resolveGateSettings, type GateSetting } from '../../shared/gateSettings';

interface Props { config: AppConfig; files: DocumentFile[]; onChange: (config: AppConfig) => void }

const Sec = ({ title, desc, children }: { title: string; desc: string; children: ReactNode }) => <section><h2>{title}</h2><p className="desc">{desc}</p>{children}</section>;

/** The three Gates and the team-note rule each one used before primary Playbooks. */
const GATE_STEPS: Array<{ gate: number; rule: WorkflowRuleId; step: 2 | 3 | 4 }> = [{ gate: 0, rule: 'core-idea', step: 2 }, { gate: 1, rule: 'outline', step: 3 }, { gate: 2, rule: 'draft', step: 4 }];
const preStyle = { whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--f2)', background: 'var(--bg2)', borderRadius: 6, padding: 8, marginTop: 6, maxHeight: 320, overflow: 'auto' } as const;

export default function WorkflowRules({ config, files, onChange }: Props) {
  const { tr } = useI18n();
  const values = resolveGateSettings(config) as unknown as Record<string, number | boolean | string>;
  const rule = (id: WorkflowRuleId) => getWorkflowRuleSetting(config, id);
  const save = (id: WorkflowRuleId, patch: Partial<ReturnType<typeof getWorkflowRuleSetting>>) => {
    const current = rule(id);
    onChange({ ...config, workflowRules: { ...config.workflowRules, [id]: { ...current, ...patch, version: current.version + 1 } } });
  };
  const setSetting = (id: string, value: number | boolean | string) => onChange({ ...config, gateSettings: { ...config.gateSettings, [id]: value } });
  const access = (step: number) => config.stepConfigs[step]?.fileAccess;
  const rulesFor = (step: number) => files.filter(f => f.category === 'rules' && (access(step)?.rules ?? []).includes(f.id));
  const kbFor = (step: number) => files.filter(f => f.category === 'kb' && (access(step)?.kb ?? []).includes(f.id));
  const setPrimary = (step: number, id: string) => onChange({ ...config, stepConfigs: { ...config.stepConfigs, [step]: { ...config.stepConfigs[step], primaryPlaybookId: id || undefined } } });
  /** Documents of a Gate in the order and role the backend sends them. */
  const docsFor = (step: number) => [
    ...rulesFor(step).map(f => ({ name: f.name, role: ruleRoleOf(f, config, step) })),
    ...kbFor(step).map(f => ({ name: f.name, role: kbRoleOf(f) })),
    { name: tr('Content Plan của bài', "Article's Content Plan"), role: 'CONTENT_PLAN' as GateRole },
  ].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  const words = Math.max(800, config.stepConfigs[4]?.maxDraftWords ?? config.stepConfigs[4]?.maxDraftCharacters ?? 1500);
  const setWords = (value: number) => onChange({ ...config, stepConfigs: { ...config.stepConfigs, 4: { ...config.stepConfigs[4], maxDraftWords: Math.min(10000, Math.max(800, value || 1500)) } } });

  const control = (s: GateSetting) => {
    const value = values[s.id];
    const label = tr(s.vi, s.en);
    if (s.kind === 'boolean') return <button role="switch" aria-checked={Boolean(value)} aria-label={label} className={`toggle${value ? ' on' : ''}`} onClick={() => setSetting(s.id, !value)} />;
    // Uncontrolled until blur, so typing "1" on the way to "120" is not clamped mid-edit; the key resets it after a save.
    if (s.kind === 'text') return <input key={String(value)} className="inp" style={{ width: 180 }} aria-label={label} defaultValue={String(value)} maxLength={60} onBlur={e => { if (e.target.value.trim() !== value) setSetting(s.id, e.target.value) }} />;
    return <input key={String(value)} className="inp" style={{ width: 90 }} type="number" min={s.min} max={s.max} aria-label={label} defaultValue={Number(value)} onBlur={e => { const next = Number(e.target.value); if (Number.isFinite(next) && next !== value) setSetting(s.id, next) }} />;
  };
  const settingRow = (s: GateSetting) => <div key={s.id} className="box-row" style={{ flexWrap: 'wrap' }}>
    <div className="grow" style={{ minWidth: 200 }}>{tr(s.vi, s.en)}<div className="s">{tr(s.hintVi, s.hintEn)}{s.kind === 'number' ? ` (${s.min}–${s.max})` : ''}</div></div>
    {control(s)}
  </div>;

  // Settings from the old rule editor that still change prompts but have no control here any more.
  const legacy = (['source-grounding', 'core-idea', 'outline', 'draft', 'quality-persistence'] as WorkflowRuleId[]).filter(id => {
    const saved = config.workflowRules?.[id];
    if (!saved) return false;
    const hasStageText = Object.values(saved.stageOverrides ?? {}).some(stage => Boolean(stage?.instruction?.trim()));
    const ungatedNote = !GATE_STEPS.some(n => n.rule === id) && Boolean(saved.customInstruction?.trim());
    return saved.enforcement === 'guided' || saved.appliesTo?.batch === false || hasStageText || ungatedNote;
  });
  const resetLegacy = () => onChange({ ...config, workflowRules: Object.fromEntries(Object.entries(config.workflowRules ?? {}).map(([id, saved]) => {
    if (!saved) return [id, saved];
    const stageOverrides = Object.fromEntries(Object.entries(saved.stageOverrides ?? {}).map(([stage, o]) => [stage, { parameters: o?.parameters }]));
    const keepNote = GATE_STEPS.some(n => n.rule === id);
    return [id, { ...saved, enforcement: 'strict', appliesTo: { manual: true, batch: true }, stageOverrides, customInstruction: keepNote ? saved.customInstruction : '', version: saved.version + 1 }];
  })) });

  const fixed = [
    { icon: 'shield-check', vi: 'Đối chứng nguồn', en: 'Source grounding', dVi: 'AI chỉ dùng Content Plan và tài liệu Storage cấp cho gate; số liệu và dẫn chứng chỉ lấy từ Evidence, không bịa.', dEn: 'AI uses only the Content Plan and the Storage documents given to the gate; facts come from Evidence only, never invented.' },
    { icon: 'list-check', vi: 'Quality Gate ở G3', en: 'G3 Quality Gate', dVi: 'Kiểm tra cấu trúc, số từ, độ bao phủ, bảo mật và link, rồi AI Review chấm theo Standards của G3. Bài đạt ngưỡng ở Settings › Pipeline mới thành AI Approved.', dEn: 'Checks structure, word count, coverage, confidentiality and links, then AI Review scores against the G3 Standards. Only drafts at the Settings › Pipeline threshold become AI Approved.' },
    { icon: 'user-check', vi: 'Duyệt outline Editorial', en: 'Editorial outline approval', dVi: 'Bài Editorial dừng sau G2 cho đến khi có người duyệt outline.', dEn: 'Editorial articles stop after G2 until a person approves the outline.' },
    { icon: 'language', vi: 'Bài viết bằng tiếng Anh', en: 'Articles in English', dVi: 'Nội dung bài luôn tạo bằng tiếng Anh; giao diện mới dịch sang tiếng Việt.', dEn: 'Article content is always generated in English; only the UI is translated.' },
  ];

  return <>
    <Sec title={tr('Thiết lập theo Gate', 'Settings per Gate')} desc={tr('File MD chỉ chứa lời văn: Playbook nói cách tạo output, Standards là checklist AI tự duyệt và sửa, Domain Knowledge là Brand context và Evidence. Mọi con số và công tắc đặt ở đây; áp dụng cho lượt chạy tiếp theo.', 'MD files hold wording only: Playbooks say how to produce the output, Standards are the checklist AI reviews and fixes against, Domain Knowledge is Brand context and Evidence. Every number and switch is set here and applies to the next run.')}>
      {GATE_STEPS.map(n => {
        const gate = GATES[n.gate];
        const primary = primaryPlaybookId(config, n.step);
        const note = rule(n.rule).customInstruction;
        const standards = rulesFor(n.step).filter(f => storageGroupInfo(f).group === 'Standards');
        const brand = kbFor(n.step).filter(f => isBrandContext(f));
        const guessed = rulesFor(n.step).filter(f => storageGroupInfo(f).guessed);
        const settings = GATE_SETTINGS.filter(s => s.step === n.step);
        const docs = docsFor(n.step);
        const lastCached = docs.reduce((last, d, i) => CACHEABLE_ROLES.has(d.role) ? i : last, -1);
        const prompt = compileWorkflowRules(config, n.step, 'batch');
        return <div key={n.rule} className="box" style={{ marginBottom: 12 }}>
          <div className="box-row" style={{ flexWrap: 'wrap' }}>
            <span className={`tag t-${gate.color}`}>{gate.short}</span><b className="grow">{gate.label}</b>
          </div>
          <div className="box-row" style={{ flexWrap: 'wrap' }}>
            <div className="grow" style={{ minWidth: 200 }}>{tr('Playbook chính', 'Primary Playbook')}<div className="s">{tr('Cách AI tạo output ở Gate này. Chỉ chọn được file Rules đã tick cho Gate.', 'How AI produces this Gate\'s output. Only Rules files ticked for the Gate can be chosen.')}</div></div>
            <select className="inp" style={{ width: 280, maxWidth: '100%' }} aria-label={`${tr('Playbook chính cho', 'Primary Playbook for')} ${gate.label}`} value={primary ?? ''} onChange={e => setPrimary(n.step, e.target.value)}>
              <option value="">{tr('Chưa chọn Playbook chính', 'No primary Playbook')}</option>
              {rulesFor(n.step).filter(f => storageGroupInfo(f).group === 'Playbooks' || f.id === primary).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div className="box-row" style={{ flexWrap: 'wrap' }}>
            <div className="grow" style={{ minWidth: 200 }}>Standards<div className="s">{standards.length ? standards.map(f => f.name).join(', ') : tr('Chưa tick file Standards nào: AI không có checklist để tự duyệt ở Gate này.', 'No Standards ticked: AI has no checklist to review this Gate against.')}</div></div>
            <span className={`tag t-${standards.length ? 'green' : 'gray'}`}>{standards.length}</span>
          </div>
          <div className="box-row" style={{ flexWrap: 'wrap' }}>
            <div className="grow" style={{ minWidth: 200 }}>Brand context<div className="s">{brand.length ? brand.map(f => f.name).join(', ') : tr('Chưa tick Domain Knowledge loại positioning, usp hoặc brand voice.', 'No Domain Knowledge of type positioning, usp or brand voice ticked.')}</div></div>
            <span className={`tag t-${brand.length ? 'green' : 'gray'}`}>{brand.length}</span>
          </div>
          {guessed.length > 0 && <div className="box-row" style={{ flexWrap: 'wrap' }}><I n="alert-triangle" /><div className="grow" style={{ minWidth: 200 }}>{tr('Nhóm đang được đoán theo tên file', 'Groups guessed from file names')}<div className="s">{guessed.map(f => `${f.name} → ${storageGroupInfo(f).group}`).join(' · ')}. {tr('Mở file trong Storage và xác nhận nhóm.', 'Open each file in Storage and confirm its group.')}</div></div></div>}
          {settings.filter(s => s.level === 'basic').map(settingRow)}
          {n.step === 4 && <div className="box-row" style={{ flexWrap: 'wrap' }}>
            <div className="grow" style={{ minWidth: 200 }}>{tr('Số từ mục tiêu', 'Target words')}<div className="s">{tr('Độ dài bài tiếng Anh; QC chấp nhận khoảng ±15%.', 'English article length; QC accepts about ±15%.')} (800–10000)</div></div>
            <input className="inp" style={{ width: 90 }} type="number" min={800} max={10000} step={100} aria-label={tr('Số từ tiếng Anh mục tiêu', 'Target English words')} value={words} onChange={e => setWords(Number(e.target.value))} />
          </div>}
          <div className="box-row" style={{ display: 'block' }}>
            <details><summary style={{ cursor: 'pointer', color: 'var(--f2)' }}>{tr('Nâng cao', 'Advanced')}</summary>
              <div style={{ marginTop: 6 }}>{settings.filter(s => s.level === 'advanced').map(settingRow)}</div>
              {primary
                ? note.trim() && <p className="s" style={{ marginTop: 8 }}>{tr('Ghi chú cũ của team không còn được gửi vì Gate đã có Playbook chính. Chép vào file nếu cần:', 'The old team note is no longer sent because this Gate has a primary Playbook. Copy it into the file if needed:')} <i>{note}</i></p>
                : <textarea className="inp" rows={2} style={{ height: 'auto', padding: 8, resize: 'vertical', marginTop: 8, width: '100%' }} aria-label={`${tr('Ghi chú cho', 'Note for')} ${gate.label}`} placeholder={tr('Ghi chú tạm cho Gate (nên chuyển vào Playbook chính)', 'Temporary note for this Gate (better moved into the primary Playbook)')} value={note} onChange={e => save(n.rule, { customInstruction: e.target.value })} />}
            </details>
            <details style={{ marginTop: 6 }}><summary style={{ cursor: 'pointer', color: 'var(--f3)', fontSize: 12 }}>{tr('Xem prompt AI nhận ở gate này', 'See what AI receives at this gate')}</summary>
              <pre style={preStyle}>{[prompt.systemPrompt, prompt.taskGuidance, GATE_DOCUMENT_CONTRACT, `${tr('Tài liệu gửi theo thứ tự', 'Documents in send order')}:\n${docs.map((d, i) => `- ${ROLE_LABEL_VI[d.role]}: ${d.name}${i === lastCached ? `\n  ── ${tr('điểm cache: phần trên giống nhau giữa các bài', 'cache point: everything above is shared by every article')} ──` : ''}`).join('\n')}`].filter(Boolean).join('\n\n')}</pre>
            </details>
          </div>
        </div>;
      })}
    </Sec>

    <Sec title={tr('Áp dụng cho mọi Gate', 'Every Gate')} desc={tr('Thiết lập nâng cao dùng chung cho cả pipeline.', 'Advanced settings shared by the whole pipeline.')}>
      <div className="box">{GATE_SETTINGS.filter(s => s.step === 0).map(settingRow)}</div>
    </Sec>

    <Sec title={tr('Luôn bật', 'Always on')} desc={tr('Các bảo vệ chất lượng này luôn chạy ở mọi bài, không cần cài đặt.', 'These quality safeguards always run on every article; nothing to set.')}>
      <div className="box">{fixed.map(f => <div key={f.en} className="box-row"><I n={f.icon} /><div className="grow">{tr(f.vi, f.en)}<div className="s">{tr(f.dVi, f.dEn)}</div></div><span className="tag t-green">{tr('Luôn bật', 'On')}</span></div>)}</div>
      {legacy.length > 0 && <div className="box" style={{ marginTop: 12 }}><div className="box-row" style={{ flexWrap: 'wrap' }}><I n="history" /><div className="grow" style={{ minWidth: 220 }}>{tr('Có tuỳ chỉnh nâng cao từ phiên bản cũ', 'Advanced customizations from the old editor')}<div className="s">{tr('Chế độ Guided, tắt quy tắc cho batch hoặc câu lệnh sửa riêng từng bước vẫn đang áp dụng. Đặt lại để dùng quy tắc mặc định (giữ ghi chú của team).', 'Guided mode, rules turned off for batch, or rewritten stage text still apply. Reset to the default rules (team notes are kept).')}</div></div><button className="btn" onClick={resetLegacy}><I n="restore" />{tr('Đặt lại mặc định', 'Reset to defaults')}</button></div></div>}
    </Sec>
  </>;
}
