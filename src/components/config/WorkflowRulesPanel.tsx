import { useMemo, useState } from 'react';
import { ChevronRight, Database, FileText, LockKeyhole, RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { AppConfig, DocumentFile, WorkflowRuleEnforcement, WorkflowRuleId } from '../../types';
import { compileWorkflowRules, getStageEffective, getWorkflowRuleSetting, WORKFLOW_RULE_DEFINITIONS } from '../../lib/workflowRules';
import { isDocumentReady } from '../../lib/documentStatus';
import { useI18n } from '../../lib/i18n';

interface Props { config: AppConfig; files: DocumentFile[]; onChange: (config: AppConfig) => void }

const STEP_LABELS: Record<number, { vi: string; en: string }> = {
  2: { vi: 'Bước 1 · Core Idea', en: 'Step 1 · Core Idea' },
  3: { vi: 'Bước 2 · Outline', en: 'Step 2 · Outline' },
  4: { vi: 'Bước 3 · Draft', en: 'Step 3 · Draft' },
};

export default function WorkflowRulesPanel({ config, files, onChange }: Props) {
  const { language, tr } = useI18n();
  const [selectedId, setSelectedId] = useState<WorkflowRuleId>('source-grounding');
  const selectedRule = useMemo(() => WORKFLOW_RULE_DEFINITIONS.find(rule => rule.id === selectedId) ?? WORKFLOW_RULE_DEFINITIONS[0], [selectedId]);
  const selectedSetting = getWorkflowRuleSetting(config, selectedRule.id);
  const manualPreview = compileWorkflowRules(config, selectedRule.steps[0], 'manual');
  const batchPreview = compileWorkflowRules(config, selectedRule.steps[0], 'batch');
  const readyKb = files.filter(file => file.category === 'kb' && isDocumentReady(file));
  const readyGuides = files.filter(file => file.category === 'rules' && isDocumentReady(file));
  const isCustomized = (id: WorkflowRuleId) => {
    const setting = getWorkflowRuleSetting(config, id);
    return setting.enforcement !== 'strict' || !setting.appliesTo.manual || !setting.appliesTo.batch || Boolean(setting.customInstruction.trim()) || Object.keys(setting.stageOverrides).length > 0;
  };
  const customizedCount = WORKFLOW_RULE_DEFINITIONS.filter(rule => isCustomized(rule.id)).length;

  const updateRule = (id: WorkflowRuleId, patch: { enforcement?: WorkflowRuleEnforcement; customInstruction?: string }) => {
    const current = getWorkflowRuleSetting(config, id);
    onChange({ ...config, workflowRules: { ...config.workflowRules, [id]: { ...current, ...patch, version: current.version + 1 } } });
  };
  const replaceSetting = (patch: Partial<typeof selectedSetting>) => onChange({ ...config, workflowRules:{...config.workflowRules,[selectedRule.id]:{...selectedSetting,...patch,version:selectedSetting.version+1}} });
  const updateStage = (stageId:string, patch:{instruction?:string;parameters?:Record<string,number|string|boolean>}) => replaceSetting({stageOverrides:{...selectedSetting.stageOverrides,[stageId]:{...selectedSetting.stageOverrides[stageId],...patch}}});
  const resetStage = (stageId:string) => { const next={...selectedSetting.stageOverrides}; delete next[stageId]; replaceSetting({stageOverrides:next}); };
  const resetRule = () => onChange({...config,workflowRules:{...config.workflowRules,[selectedRule.id]:undefined}});

  return <div className="workflow-rules-panel space-y-3">
    <section className="workflow-rules-intro rounded-xl border border-slate-200 bg-white px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2"><SlidersHorizontal className="app-icon text-slate-500"/><h3 className="text-sm font-medium text-slate-900">Workflow Rules</h3></div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{tr('Chọn một rule, thiết lập mức áp dụng và instruction riêng. Logic mặc định luôn hiển thị để biết chính xác AI đang làm gì.', 'Select a rule, set its enforcement and custom instruction. Default behavior stays visible so you know exactly what AI does.')}</p>
        </div>
        <div className="flex gap-4 text-[10px] text-slate-500"><span><b className="font-medium text-slate-900">{WORKFLOW_RULE_DEFINITIONS.length}</b> rules</span><span><b className="font-medium text-slate-900">{customizedCount}</b> {tr('đã chỉnh', 'customized')}</span></div>
      </div>
    </section>

    <div className="workflow-rules-layout grid min-h-[470px] overflow-hidden rounded-xl border border-slate-200 bg-white lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="workflow-rules-sidebar min-w-0 border-b border-slate-200 bg-slate-50 p-2 lg:border-b-0 lg:border-r">
        <p className="px-2 pb-2 pt-1 text-[9px] font-medium uppercase tracking-[0.12em] text-slate-400">{tr('Quy tắc đang áp dụng', 'Applied rules')}</p>
        <nav className="flex gap-1 overflow-x-auto pb-1 lg:grid lg:overflow-visible lg:pb-0">
          {WORKFLOW_RULE_DEFINITIONS.map((rule, index) => {
            const setting = getWorkflowRuleSetting(config, rule.id);
            const selected = rule.id === selectedRule.id;
            const customized = isCustomized(rule.id);
            return <button key={rule.id} type="button" onClick={() => setSelectedId(rule.id)} className={`workflow-rule-nav-item ${selected ? 'is-active' : ''} group flex min-w-[210px] items-center gap-2.5 rounded-lg border px-2.5 py-2.5 text-left transition-colors lg:min-w-0 ${selected ? 'border-slate-300 bg-white' : 'border-transparent text-slate-500'}`}>
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-medium ${selected ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-600'}`}>{index + 1}</span>
              <span className="min-w-0 flex-1"><span className={`block truncate text-[11px] font-medium ${selected ? 'text-slate-900' : 'text-slate-600'}`}>{language === 'vi' ? rule.titleVi : rule.title}</span><span className="mt-0.5 flex items-center gap-1 text-[9px] text-slate-400">{setting.enforcement === 'strict' ? tr('Bắt buộc', 'Strict') : tr('Ưu tiên', 'Guided')}{customized && <><span>·</span><span>{tr('Đã tùy chỉnh', 'Customized')}</span></>}</span></span>
              <ChevronRight className={`app-icon shrink-0 ${selected ? 'text-slate-700' : 'text-slate-300'}`}/>
            </button>;
          })}
        </nav>
        <div className="mt-3 border-t border-slate-200 px-2 pt-3">
          <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-slate-400">{tr('Nguồn sẵn sàng', 'Available sources')}</p>
          <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500"><span>Knowledge Base</span><b className="font-medium text-slate-800">{readyKb.length}</b></div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500"><span>Reference guides</span><b className="font-medium text-slate-800">{readyGuides.length}</b></div>
        </div>
      </aside>

      <main className="workflow-rule-editor min-w-0 p-4 sm:p-5">
        <header className="border-b border-slate-200 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-xl"><p className="text-[9px] font-medium uppercase tracking-[0.12em] text-slate-400">{tr('Rule được chọn', 'Selected rule')}</p><h4 className="mt-1 text-base font-medium text-slate-900">{language === 'vi' ? selectedRule.titleVi : selectedRule.title}</h4><p className="mt-1 text-[11px] leading-relaxed text-slate-500">{language === 'vi' ? selectedRule.summaryVi : selectedRule.summary}</p></div>
            <div className="flex flex-wrap gap-1.5">{selectedRule.steps.map(step => <span key={step} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[9px] font-medium text-slate-500">{language === 'vi' ? STEP_LABELS[step].vi : STEP_LABELS[step].en}</span>)}</div>
          </div>
        </header>

        <section className="workflow-rule-controls py-4">
          <div className="grid gap-4 md:grid-cols-[210px_minmax(0,1fr)]">
            <div><label className="text-[10px] font-medium text-slate-700">{tr('Mức áp dụng', 'Enforcement')}</label><div className="workflow-rule-enforcement mt-1.5 grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-50 p-1">{(['strict', 'guided'] as const).map(mode => <button key={mode} type="button" onClick={() => updateRule(selectedRule.id, { enforcement: mode })} className={`workflow-rule-mode rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors ${selectedSetting.enforcement === mode ? 'is-active bg-white text-slate-900' : 'text-slate-500'}`}>{mode === 'strict' ? tr('Bắt buộc', 'Strict') : tr('Ưu tiên', 'Guided')}</button>)}</div><div className="mt-3 space-y-1.5">{(['manual','batch'] as const).map(mode=><label key={mode} className="flex items-center justify-between text-[10px] text-slate-500"><span>{mode==='manual'?tr('Bài đơn','Manual'):tr('Batch generation','Batch generation')}</span><input type="checkbox" checked={selectedSetting.appliesTo[mode]} onChange={event=>replaceSetting({appliesTo:{...selectedSetting.appliesTo,[mode]:event.target.checked}})} /></label>)}</div></div>
            <label><span className="text-[10px] font-medium text-slate-700">{tr('Instruction tùy chỉnh', 'Custom instruction')}</span><textarea rows={4} value={selectedSetting.customInstruction} onChange={event => updateRule(selectedRule.id, { customInstruction: event.target.value })} placeholder={tr('Để trống để dùng logic mặc định bên dưới…', 'Leave blank to use the default behavior below…')} className="mt-1.5 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[11px] leading-relaxed text-slate-700 outline-none focus:border-slate-400"/><span className="mt-1 block text-right text-[9px] text-slate-400">{selectedSetting.customInstruction.length.toLocaleString()} {tr('ký tự', 'characters')}</span></label>
          </div>
        </section>

        <section className="workflow-rule-stages border-t border-slate-200 pt-4">
          <div className="flex items-center justify-between gap-3"><div><h5 className="text-[11px] font-medium text-slate-900">{tr('Cấu hình theo stage', 'Stage configuration')}</h5><p className="mt-0.5 text-[9px] text-slate-400">{tr('Rule có khóa là safeguard; các stage khác có thể sửa instruction và tham số.', 'Locked rules are safeguards; other stages allow instruction and parameter overrides.')}</p></div><button type="button" onClick={resetRule} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[9px] text-slate-500"><RotateCcw className="app-icon"/>{tr('Reset rule','Reset rule')}</button></div>
          <ol className="mt-3 space-y-2">{selectedRule.stages.map((stage, index) => { const effective=getStageEffective(selectedRule,selectedSetting,stage); const overridden=Boolean(selectedSetting.stageOverrides[stage.id]); return <li key={stage.id} className="workflow-rule-stage rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="flex gap-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-[9px] font-medium text-slate-600">{index+1}</span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><b className="text-[11px] font-medium text-slate-800">{language==='vi'?stage.titleVi:stage.title}</b><span className="text-[8px] uppercase text-slate-400">{stage.locked?tr('Đã khóa','Locked'):overridden?tr('Đã chỉnh','Modified'):tr('Mặc định','Default')}</span></div>{stage.locked?<p className="mt-1 text-[10px] leading-relaxed text-slate-500">{language==='vi'?stage.detailVi:stage.detail}</p>:<textarea rows={2} value={selectedSetting.stageOverrides[stage.id]?.instruction ?? ''} onChange={event=>updateStage(stage.id,{instruction:event.target.value})} placeholder={language==='vi'?stage.detailVi:stage.detail} className="mt-2 w-full resize-y rounded-md border border-slate-200 bg-white px-2.5 py-2 text-[10px] leading-relaxed outline-none"/>}{stage.parameters?.length?<div className="mt-2 grid grid-cols-2 gap-2">{stage.parameters.map(parameter=><label key={parameter.id} className="text-[9px] text-slate-500"><span>{language==='vi'?parameter.labelVi:parameter.label}</span><input type="number" min={parameter.min} max={parameter.max} step={parameter.step} value={Number(effective.parameters[parameter.id])} onChange={event=>updateStage(stage.id,{parameters:{...selectedSetting.stageOverrides[stage.id]?.parameters,[parameter.id]:Number(event.target.value)}})} className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[10px]"/></label>)}</div>:null}{overridden&&!stage.locked?<button type="button" onClick={()=>resetStage(stage.id)} className="mt-2 text-[9px] text-slate-400">{tr('Khôi phục stage','Reset stage')}</button>:null}</div></div></li>; })}</ol>
        </section>

        <section className="mt-4 border-t border-slate-200 pt-4"><h5 className="text-[11px] font-medium text-slate-900">Effective preview</h5><p className="mt-0.5 text-[9px] text-slate-400">{tr('Đây là nội dung thực tế compiler gửi tới model cho từng chế độ.', 'This is the effective content the compiler sends to the model in each mode.')}</p><div className="mt-2 grid gap-2 xl:grid-cols-2">{([{label:tr('Bài đơn','Manual'),preview:manualPreview},{label:'Batch',preview:batchPreview}] as const).map(item=><div key={item.label} className="min-w-0"><div className="mb-1 flex items-center justify-between gap-2"><b className="text-[9px] font-medium text-slate-600">{item.label}</b><span className="truncate font-mono text-[8px] text-slate-400">{item.preview.fingerprint}</span></div><pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[9px] leading-relaxed text-slate-500">{[item.preview.systemPrompt,item.preview.taskGuidance].filter(Boolean).join('\n\n')||tr('Không áp dụng trong chế độ này.','Not applied in this mode.')}</pre></div>)}</div></section>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3"><LockKeyhole className="app-icon mt-0.5 shrink-0 text-slate-400"/><p className="text-[9px] leading-relaxed text-slate-500">{tr('Validation cứng như không bịa dữ liệu, English output và SEO gate không bị tắt bởi Guided.', 'Hard safeguards such as no fabricated facts, English output, and the SEO gate are not disabled by Guided.')}</p></div>
          <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3"><FileText className="app-icon mt-0.5 shrink-0 text-slate-400"/><p className="text-[9px] leading-relaxed text-slate-500">{tr('Tài liệu upload là context/reference data, không phải operational skill.', 'Uploaded documents are context/reference data, not operational skills.')}</p></div>
        </div>
      </main>
    </div>

    <div className="flex items-center gap-2 px-1 text-[9px] text-slate-400"><Database className="app-icon shrink-0"/><span>{tr('Thay đổi được lưu vào writer:config trên Supabase khi nhấn Lưu cấu hình.', 'Changes are saved to writer:config in Supabase when Save settings is selected.')}</span></div>
  </div>;
}
