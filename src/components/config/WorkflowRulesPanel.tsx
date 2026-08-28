import { useMemo, useState } from 'react';
import { ChevronRight, Database, FileText, LockKeyhole, SlidersHorizontal } from 'lucide-react';
import type { AppConfig, DocumentFile, WorkflowRuleEnforcement, WorkflowRuleId } from '../../types';
import { getWorkflowRuleSetting, WORKFLOW_RULE_DEFINITIONS } from '../../lib/workflowRules';
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
  const readyKb = files.filter(file => file.category === 'kb' && isDocumentReady(file));
  const readyGuides = files.filter(file => file.category === 'rules' && isDocumentReady(file));
  const customizedCount = WORKFLOW_RULE_DEFINITIONS.filter(rule => getWorkflowRuleSetting(config, rule.id).customInstruction.trim()).length;

  const updateRule = (id: WorkflowRuleId, patch: { enforcement?: WorkflowRuleEnforcement; customInstruction?: string }) => {
    const current = getWorkflowRuleSetting(config, id);
    onChange({ ...config, workflowRules: { ...config.workflowRules, [id]: { ...current, ...patch } } });
  };

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
            const customized = Boolean(setting.customInstruction.trim());
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
            <div><label className="text-[10px] font-medium text-slate-700">{tr('Mức áp dụng', 'Enforcement')}</label><div className="workflow-rule-enforcement mt-1.5 grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-50 p-1">{(['strict', 'guided'] as const).map(mode => <button key={mode} type="button" onClick={() => updateRule(selectedRule.id, { enforcement: mode })} className={`workflow-rule-mode rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors ${selectedSetting.enforcement === mode ? 'is-active bg-white text-slate-900' : 'text-slate-500'}`}>{mode === 'strict' ? tr('Bắt buộc', 'Strict') : tr('Ưu tiên', 'Guided')}</button>)}</div><p className="mt-1.5 text-[9px] leading-relaxed text-slate-400">{selectedSetting.enforcement === 'strict' ? tr('Model phải tuân thủ instruction này.', 'The model must follow this instruction.') : tr('Model ưu tiên áp dụng khi phù hợp.', 'The model applies it when relevant.')}</p></div>
            <label><span className="text-[10px] font-medium text-slate-700">{tr('Instruction tùy chỉnh', 'Custom instruction')}</span><textarea rows={4} value={selectedSetting.customInstruction} onChange={event => updateRule(selectedRule.id, { customInstruction: event.target.value })} placeholder={tr('Để trống để dùng logic mặc định bên dưới…', 'Leave blank to use the default behavior below…')} className="mt-1.5 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[11px] leading-relaxed text-slate-700 outline-none focus:border-slate-400"/><span className="mt-1 block text-right text-[9px] text-slate-400">{selectedSetting.customInstruction.length.toLocaleString()} {tr('ký tự', 'characters')}</span></label>
          </div>
        </section>

        <section className="workflow-rule-stages border-t border-slate-200 pt-4">
          <div className="flex items-center justify-between gap-3"><div><h5 className="text-[11px] font-medium text-slate-900">{tr('Logic mặc định đang chạy', 'Active default behavior')}</h5><p className="mt-0.5 text-[9px] text-slate-400">{tr('Instruction tùy chỉnh được áp dụng thêm vào các bước này.', 'Custom instructions are applied in addition to these stages.')}</p></div><span className="text-[9px] text-slate-400">{selectedRule.stages.length} stages</span></div>
          <ol className="mt-3 space-y-2">{selectedRule.stages.map((stage, index) => <li key={stage.title} className="workflow-rule-stage flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-[9px] font-medium text-slate-600">{index + 1}</span><div><b className="block text-[11px] font-medium text-slate-800">{language === 'vi' ? stage.titleVi : stage.title}</b><p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{language === 'vi' ? stage.detailVi : stage.detail}</p></div></li>)}</ol>
        </section>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3"><LockKeyhole className="app-icon mt-0.5 shrink-0 text-slate-400"/><p className="text-[9px] leading-relaxed text-slate-500">{tr('Validation cứng như không bịa dữ liệu, English output và SEO gate không bị tắt bởi Guided.', 'Hard safeguards such as no fabricated facts, English output, and the SEO gate are not disabled by Guided.')}</p></div>
          <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3"><FileText className="app-icon mt-0.5 shrink-0 text-slate-400"/><p className="text-[9px] leading-relaxed text-slate-500">{tr('Tài liệu upload là context/reference data, không phải operational skill.', 'Uploaded documents are context/reference data, not operational skills.')}</p></div>
        </div>
      </main>
    </div>

    <div className="flex items-center gap-2 px-1 text-[9px] text-slate-400"><Database className="app-icon shrink-0"/><span>{tr('Thay đổi được lưu vào writer:config trên Supabase khi nhấn Lưu cấu hình.', 'Changes are saved to writer:config in Supabase when Save settings is selected.')}</span></div>
  </div>;
}
