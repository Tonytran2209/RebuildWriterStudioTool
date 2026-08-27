import { useState } from 'react';
import { Check, ChevronDown, Database, FileSearch, GitBranch, ShieldCheck } from 'lucide-react';
import type { AppConfig, DocumentFile, WorkflowRuleEnforcement, WorkflowRuleId } from '../../types';
import { getWorkflowRuleSetting, WORKFLOW_RULE_DEFINITIONS } from '../../lib/workflowRules';
import { isDocumentReady } from '../../lib/documentStatus';
import { useI18n } from '../../lib/i18n';

interface Props {
  config: AppConfig;
  files: DocumentFile[];
  onChange: (config: AppConfig) => void;
}

const STEP_LABELS: Record<number, { vi: string; en: string }> = {
  2: { vi: 'Bước 1 · Core Idea', en: 'Step 1 · Core Idea' },
  3: { vi: 'Bước 2 · Outline', en: 'Step 2 · Outline' },
  4: { vi: 'Bước 3 · Draft', en: 'Step 3 · Draft' },
};

export default function WorkflowRulesPanel({ config, files, onChange }: Props) {
  const { language, tr } = useI18n();
  const [expanded, setExpanded] = useState<WorkflowRuleId | null>('source-grounding');
  const readyKb = files.filter(file => file.category === 'kb' && isDocumentReady(file));
  const readyGuides = files.filter(file => file.category === 'rules' && isDocumentReady(file));

  const updateRule = (id: WorkflowRuleId, patch: { enforcement?: WorkflowRuleEnforcement; customInstruction?: string }) => {
    const current = getWorkflowRuleSetting(config, id);
    onChange({
      ...config,
      workflowRules: {
        ...config.workflowRules,
        [id]: { ...current, ...patch },
      },
    });
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{tr('Registry vận hành thực tế', 'Live operational registry')}</p>
            <h3 className="mt-1 text-sm font-medium text-slate-900">{tr('AI đang xử lý content theo các rule nào?', 'Which rules actually control content generation?')}</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{tr('Các card dưới đây phản ánh trực tiếp retrieval, prompt contract, validation và persistence đang chạy trong pipeline. Thay đổi được lưu vào cấu hình và đưa vào system prompt của đúng bước.', 'These cards mirror the retrieval, prompt contract, validation and persistence used by the live pipeline. Changes are saved in configuration and injected into the matching step system prompt.')}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><b className="block text-sm text-slate-900">{readyKb.length}</b><span className="text-[9px] text-slate-500">KB sources</span></div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><b className="block text-sm text-slate-900">{readyGuides.length}</b><span className="text-[9px] text-slate-500">reference guides</span></div>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {[
            { icon: FileSearch, title: tr('1. Retrieve', '1. Retrieve'), detail: tr('Chọn nguồn liên quan', 'Select relevant sources') },
            { icon: GitBranch, title: tr('2. Generate', '2. Generate'), detail: tr('Chạy contract từng bước', 'Run each step contract') },
            { icon: ShieldCheck, title: tr('3. Validate & Save', '3. Validate & Save'), detail: tr('Kiểm tra rồi lưu Supabase', 'Validate, then save to Supabase') },
          ].map(item => <div key={item.title} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"><item.icon className="app-icon text-slate-500"/><div><b className="block text-[11px] text-slate-800">{item.title}</b><span className="text-[9px] text-slate-500">{item.detail}</span></div></div>)}
        </div>
      </section>

      <div className="space-y-2">
        {WORKFLOW_RULE_DEFINITIONS.map((rule, index) => {
          const setting = getWorkflowRuleSetting(config, rule.id);
          const isExpanded = expanded === rule.id;
          return (
            <section key={rule.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white transition-colors hover:border-slate-300">
              <button type="button" onClick={() => setExpanded(isExpanded ? null : rule.id)} className="flex w-full items-start gap-3 p-4 text-left hover:bg-slate-50/70">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-[10px] font-medium text-slate-600">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h4 className="text-xs font-medium text-slate-900">{language === 'vi' ? rule.titleVi : rule.title}</h4>{rule.steps.map(step => <span key={step} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-normal text-slate-500">{language === 'vi' ? STEP_LABELS[step].vi : STEP_LABELS[step].en}</span>)}</div>
                  <p className="mt-1 text-[11px] text-slate-500">{language === 'vi' ? rule.summaryVi : rule.summary}</p>
                </div>
                <ChevronDown className={`app-icon shrink-0 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}/>
              </button>
              {isExpanded && <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                <div className="relative space-y-3 border-l border-slate-200 pl-5">
                  {rule.stages.map((stage, stageIndex) => <div key={stage.title} className="relative"><span className="absolute -left-[25px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 bg-white"><Check className="h-2.5 w-2.5 text-slate-600"/></span><b className="block text-[11px] text-slate-800">{stageIndex + 1}. {language === 'vi' ? stage.titleVi : stage.title}</b><p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{language === 'vi' ? stage.detailVi : stage.detail}</p></div>)}
                </div>
                <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-[180px_1fr]">
                  <label><span className="mb-1 block text-[10px] font-semibold text-slate-600">{tr('Cách áp dụng', 'Enforcement')}</span><select value={setting.enforcement} onChange={event => updateRule(rule.id, { enforcement: event.target.value as WorkflowRuleEnforcement })} className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] text-slate-700 outline-none focus:border-slate-400"><option value="strict">{tr('Strict — bắt buộc', 'Strict — mandatory')}</option><option value="guided">{tr('Guided — ưu tiên', 'Guided — preferred')}</option></select></label>
                  <label><span className="mb-1 block text-[10px] font-semibold text-slate-600">{tr('Điều chỉnh cách rule được áp dụng', 'Adjust how this rule is applied')}</span><textarea rows={3} value={setting.customInstruction} onChange={event => updateRule(rule.id, { customInstruction: event.target.value })} placeholder={tr('Bổ sung yêu cầu cho pipeline này; để trống để dùng logic mặc định hiển thị bên trên.', 'Add an instruction for this pipeline; leave blank to use the displayed default behavior.')} className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] leading-relaxed text-slate-700 outline-none focus:border-slate-400"/></label>
                </div>
              </div>}
            </section>
          );
        })}
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[10px] leading-relaxed text-slate-500"><Database className="app-icon mt-0.5 shrink-0"/><p>{tr('Tài liệu upload vẫn là nguồn Knowledge Base/reference data. Nó không còn đại diện cho một operational skill. Các giới hạn cứng như không bịa dữ liệu, canonical English output và SEO gate vẫn được validator bảo vệ.', 'Uploaded documents remain Knowledge Base/reference data; they no longer represent operational skills. Hard safeguards such as no fabricated facts, canonical English output and the SEO gate remain validator-enforced.')}</p></div>
    </div>
  );
}
