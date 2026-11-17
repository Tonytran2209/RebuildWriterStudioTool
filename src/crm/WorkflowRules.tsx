import { useMemo, useState } from 'react';
import type { AppConfig, DocumentFile, WorkflowRuleEnforcement, WorkflowRuleId } from '../types';
import { compileWorkflowRules, getStageEffective, getWorkflowRuleSetting, WORKFLOW_RULE_DEFINITIONS } from '../lib/workflowRules';
import { isDocumentReady } from '../lib/documentStatus';
import { useI18n } from '../lib/i18n';
import { I } from './ui';

interface Props { config: AppConfig; files: DocumentFile[]; onChange: (config: AppConfig) => void }

type PhaseId = 'article-spec' | 'quality-gate' | 'knowledge' | 'orchestration';

const PHASES: Array<{ id: PhaseId; number: number; titleVi: string; titleEn: string; descriptionVi: string; descriptionEn: string; rules: WorkflowRuleId[] }> = [
  { id: 'article-spec', number: 1, titleVi: 'Article Spec foundation', titleEn: 'Article Spec foundation', descriptionVi: 'Khóa intent, reader outcome, keyword, thesis và phạm vi nội dung trước khi viết.', descriptionEn: 'Lock intent, reader outcome, keywords, thesis, and coverage before writing.', rules: ['core-idea'] },
  { id: 'quality-gate', number: 2, titleVi: 'Universal Quality Gate', titleEn: 'Universal Quality Gate', descriptionVi: 'Kiểm tra deterministic và semantic trước khi draft được chấp nhận.', descriptionEn: 'Run deterministic and semantic checks before a draft is accepted.', rules: ['quality-persistence'] },
  { id: 'knowledge', number: 3, titleVi: 'Knowledge governance', titleEn: 'Knowledge governance', descriptionVi: 'Quy định cách Content Plan, KB, nguồn nội bộ và website inventory được đọc.', descriptionEn: 'Control how Content Plans, KB, internal sources, and website inventory are read.', rules: ['source-grounding'] },
  { id: 'orchestration', number: 4, titleVi: 'Workflow orchestration', titleEn: 'Workflow orchestration', descriptionVi: 'Standard có thể chạy batch; Editorial cần duyệt outline trước khi tạo draft.', descriptionEn: 'Standard may run in batch; Editorial requires outline approval before drafting.', rules: ['outline', 'draft'] },
];

const STEP_LABELS: Record<number, string> = { 2: 'Step 1 · Article Spec', 3: 'Step 2 · Outline', 4: 'Step 3 · Draft' };

export default function WorkflowRules({ config, files, onChange }: Props) {
  const { language, tr } = useI18n();
  const [phaseId, setPhaseId] = useState<PhaseId>('article-spec');
  const [editingStage, setEditingStage] = useState<string | null>(null);
  const phase = PHASES.find(item => item.id === phaseId) ?? PHASES[0];
  const definitions = useMemo(() => phase.rules.flatMap(id => WORKFLOW_RULE_DEFINITIONS.filter(rule => rule.id === id)), [phase]);
  const readyKb = files.filter(file => file.category === 'kb' && isDocumentReady(file)).length;
  const readyGuides = files.filter(file => file.category === 'rules' && isDocumentReady(file)).length;

  const replaceSetting = (id: WorkflowRuleId, patch: Partial<ReturnType<typeof getWorkflowRuleSetting>>) => {
    const current = getWorkflowRuleSetting(config, id);
    onChange({ ...config, workflowRules: { ...config.workflowRules, [id]: { ...current, ...patch, version: current.version + 1 } } });
  };
  const updateStage = (id: WorkflowRuleId, stageId: string, patch: { instruction?: string; parameters?: Record<string, number | string | boolean> }) => {
    const setting = getWorkflowRuleSetting(config, id);
    replaceSetting(id, { stageOverrides: { ...setting.stageOverrides, [stageId]: { ...setting.stageOverrides[stageId], ...patch } } });
  };
  const resetStage = (id: WorkflowRuleId, stageId: string) => {
    const setting = getWorkflowRuleSetting(config, id); const next = { ...setting.stageOverrides }; delete next[stageId];
    replaceSetting(id, { stageOverrides: next }); setEditingStage(null);
  };
  const resetRule = (id: WorkflowRuleId) => onChange({ ...config, workflowRules: { ...config.workflowRules, [id]: undefined } });
  const muted = { color: 'var(--f3)', fontSize: 12 } as const;
  const sub = { padding: '8px 12px', color: 'var(--f3)', fontSize: 12, fontWeight: 500, background: 'var(--bg2)', borderBottom: '1px solid var(--b3)' } as const;

  return <>
    <section className="workflow-rules-panel">
      <h2>{tr('Pipeline behavior', 'Pipeline behavior')}</h2>
      <p className="desc">{tr('Bốn giai đoạn này là logic thực tế được compiler đưa vào prompt của bài đơn và batch.', 'These four phases are the actual behavior compiled into manual and batch prompts.')}</p>
      <div className="box workflow-phase-switcher" role="tablist">
        {PHASES.map(item => <button key={item.id} type="button" role="tab" aria-selected={phaseId === item.id} onClick={() => { setPhaseId(item.id); setEditingStage(null); }} className={`box-row click workflow-phase-button${phaseId === item.id ? ' is-active' : ''}`} style={{ width: '100%', textAlign: 'left', background: phaseId === item.id ? 'var(--bg3)' : undefined }}><span className="tag t-gray workflow-phase-index">{item.number}</span><span className="grow">{language === 'vi' ? item.titleVi : item.titleEn}</span>{phaseId === item.id && <I n="check" />}</button>)}
      </div>
    </section>

    <section>
      <h2>{language === 'vi' ? phase.titleVi : phase.titleEn}</h2>
      <p className="desc">{language === 'vi' ? phase.descriptionVi : phase.descriptionEn}</p>

      {phase.id === 'knowledge' && <div className="box knowledge-source-summary" style={{ marginBottom: 12 }}><div className="box-row"><I n="books" /><div className="grow">Knowledge Base<div className="s">{readyKb} {tr('nguồn sẵn sàng', 'ready sources')}</div></div></div><div className="box-row"><I n="file-description" /><div className="grow">Reference guides<div className="s">{readyGuides} {tr('nguồn sẵn sàng', 'ready sources')}</div></div></div></div>}

      {phase.id === 'orchestration' && <div className="box settings-preference-group" style={{ marginBottom: 12 }}><div className="box-row"><div className="grow">Standard / Scalable<div className="s">{tr('Cho phép bài đơn và batch tự động tiếp tục sau khi outline hợp lệ.', 'Manual and batch runs may continue automatically after a valid outline.')}</div></div><span className="tag t-gray">Manual + Batch</span></div><div className="box-row"><div className="grow">Editorial / Originality<div className="s">{tr('Chỉ chạy bài đơn và luôn dừng để user duyệt outline trước draft.', 'Manual only and always pauses for outline approval before drafting.')}</div></div><span className="tag t-gray">Manual + Approval</span></div></div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {definitions.map(rule => {
          const setting = getWorkflowRuleSetting(config, rule.id);
          const hardContract = rule.id === 'quality-persistence';
          const customized = setting.enforcement !== 'strict' || !setting.appliesTo.manual || !setting.appliesTo.batch || Boolean(setting.customInstruction.trim()) || Object.keys(setting.stageOverrides).length > 0;
          const preview = compileWorkflowRules(config, rule.steps[0], 'manual');
          const promptGroups = [
            { id: 'system', label: tr('System prompt · Bắt buộc', 'System prompt · Required'), content: preview.systemPrompt },
            { id: 'guidance', label: tr('Task guidance · Hướng dẫn', 'Task guidance · Guided'), content: preview.taskGuidance },
          ].filter(group => Boolean(group.content));
          return <div key={rule.id} className="box workflow-rule-group">
            <div className="box-row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}><div className="grow" style={{ minWidth: 220 }}><b style={{ fontWeight: 600 }}>{language === 'vi' ? rule.titleVi : rule.title}</b><div className="s">{language === 'vi' ? rule.summaryVi : rule.summary}</div></div><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{rule.steps.map(step => <span key={step} className="tag t-blue">{STEP_LABELS[step]}</span>)}</div></div>

            <div className="box-row workflow-setting-row" style={{ flexWrap: 'wrap' }}><div className="grow" style={{ minWidth: 220 }}>{tr('Mức áp dụng', 'Enforcement')}<div className="s">{hardContract ? tr('Quality Gate là safeguard bắt buộc và luôn chạy ở mức Strict.', 'Quality Gate is a required safeguard and always runs as Strict.') : tr('Strict đặt rule trong system prompt; Guided đặt rule trong task guidance.', 'Strict uses the system prompt; Guided uses task guidance.')}</div></div><select className="inp" style={{ width: 144 }} aria-label={tr('Mức áp dụng', 'Enforcement')} disabled={hardContract} value={setting.enforcement} onChange={event => replaceSetting(rule.id, { enforcement: event.target.value as WorkflowRuleEnforcement })}><option value="strict">Strict</option><option value="guided">Guided</option></select></div>
            <div className="box-row workflow-setting-row" style={{ flexWrap: 'wrap' }}><div className="grow" style={{ minWidth: 220 }}>{tr('Chế độ thực thi', 'Execution modes')}<div className="s">{hardContract ? tr('Safeguard này luôn bảo vệ cả bài đơn và batch.', 'This safeguard always protects manual and batch runs.') : phase.id === 'orchestration' ? tr('Batch chỉ dùng cho Standard/Scalable; Editorial luôn chạy bài đơn và cần approval.', 'Batch is Standard/Scalable only; Editorial stays manual and requires approval.') : tr('Chọn nơi rule này được compiler áp dụng.', 'Choose where this rule is compiled.')}</div></div><div style={{ display: 'flex', gap: 16 }}>{(['manual', 'batch'] as const).map(mode => <label key={mode} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--f2)' }}><input type="checkbox" disabled={hardContract} checked={setting.appliesTo[mode]} onChange={event => replaceSetting(rule.id, { appliesTo: { ...setting.appliesTo, [mode]: event.target.checked } })} />{mode === 'manual' ? tr('Bài đơn', 'Manual') : 'Batch'}</label>)}</div></div>
            <label className="box-row" style={{ display: 'block' }}><span>{tr('Instruction bổ sung', 'Additional instruction')}</span><span className="s" style={{ display: 'block' }}>{tr('Chỉ thêm yêu cầu riêng của team; không cần chép lại rule mặc định.', 'Add only team-specific guidance; do not repeat the default rules.')}</span><textarea rows={3} className="inp" style={{ height: 'auto', padding: 8, marginTop: 8, resize: 'vertical' }} value={setting.customInstruction} onChange={event => replaceSetting(rule.id, { customInstruction: event.target.value })} placeholder={tr('Không có instruction bổ sung', 'No additional instruction')} /></label>

            <div style={sub}>{tr('Quy tắc theo stage', 'Stage rules')}</div>
            {rule.stages.map(stage => {
              const effective = getStageEffective(rule, setting, stage); const override = setting.stageOverrides[stage.id]; const editKey = `${rule.id}:${stage.id}`; const editing = editingStage === editKey;
              return <div key={stage.id} className="box-row workflow-stage-row" style={{ display: 'block' }}><div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}><div className="grow" style={{ flex: 1, minWidth: 0 }}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{language === 'vi' ? stage.titleVi : stage.title}{stage.locked && <span className="tag t-gray">{tr('Bắt buộc', 'Required')}</span>}</div><div className="s">{override?.instruction?.trim() || (language === 'vi' ? stage.detailVi : stage.detail)}</div></div>{!stage.locked && <button type="button" className="btn" aria-expanded={editing} onClick={() => setEditingStage(editing ? null : editKey)}>{editing ? tr('Đóng', 'Close') : override ? tr('Chỉnh sửa', 'Edit') : tr('Tuỳ chỉnh', 'Customize')}</button>}</div>
                {stage.parameters?.length ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>{stage.parameters.map(parameter => <label key={parameter.id} style={{ display: 'flex', alignItems: 'center', gap: 8, ...muted }}><span>{language === 'vi' ? parameter.labelVi : parameter.label}</span><input type="number" className="inp" style={{ width: 80 }} min={parameter.min} max={parameter.max} step={parameter.step} value={Number(effective.parameters[parameter.id])} onChange={event => updateStage(rule.id, stage.id, { parameters: { ...override?.parameters, [parameter.id]: Number(event.target.value) } })} /></label>)}</div> : null}
                {!stage.locked && editing && <div style={{ marginTop: 8 }}><textarea rows={3} className="inp" style={{ height: 'auto', padding: 8, resize: 'vertical' }} aria-label={language === 'vi' ? stage.titleVi : stage.title} value={override?.instruction ?? ''} onChange={event => updateStage(rule.id, stage.id, { instruction: event.target.value })} placeholder={language === 'vi' ? stage.detailVi : stage.detail} />{override && <button type="button" className="btn ghost" style={{ marginTop: 6 }} onClick={() => resetStage(rule.id, stage.id)}><I n="restore" />{tr('Khôi phục mặc định', 'Restore default')}</button>}</div>}
              </div>;
            })}

            <div className="box-row" style={{ display: 'block', background: 'var(--bg2)' }}><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ flex: 1, ...muted, fontWeight: 500 }}>{tr('Prompt đang áp dụng', 'Effective prompt')}</span>{customized && <button type="button" className="btn ghost" onClick={() => resetRule(rule.id)}><I n="restore" />{tr('Reset toàn bộ rule', 'Reset rule')}</button>}</div><details className="effective-prompt" style={{ marginTop: 6, minWidth: 0 }}><summary style={{ cursor: 'pointer', ...muted }}>{tr('Xem nội dung prompt', 'View prompt content')}</summary><div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>{promptGroups.length ? promptGroups.map(group => <div key={group.id} className="box prompt-group"><div style={sub}>{group.label}</div><pre style={{ margin: 0, maxHeight: 256, overflow: 'auto', whiteSpace: 'pre-wrap', padding: 12, fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.6, color: 'var(--f2)' }}>{group.content}</pre></div>) : <div className="box" style={{ padding: 12, ...muted }}>{tr('Rule không áp dụng cho chế độ này.', 'Rule is not active in this mode.')}</div>}</div></details></div>
          </div>;
        })}
      </div>
    </section>
  </>;
}
