import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import Step4Draft from '../../src/components/workspace/Step4Draft';
import {LanguageProvider} from '../../src/lib/i18n';
import {DEFAULT_CONFIG,DEFAULT_MODELS} from '../../src/lib/defaultData';
import '../../src/index.css';import '../../src/codex-theme.css';
const original='# Browser fixture\n\n'+Array.from({length:9},(_,i)=>`Introduction line ${i+1} — unchanged source.`).join('\n')+'\n\n## Main body\nBODY_SENTINEL: This entire section remains visible.\n\n| Option | Benefit |\n| --- | --- |\n| **A — B** | [Details](https://example.com/details) |\n\n## Conclusion\nCONCLUSION_SENTINEL: Keep this section.';
function Fixture(){
 const [article,setArticle]=useState<any>({id:'browser-fixture',topic:'Browser fixture',draft:original,keywords:'fixture',tone:'professional',outline:[],currentStep:4,status:'draft'});
 return <main><details><summary>Fixture source (local only)</summary><pre data-testid="stored-source">{article.draft}</pre></details><Step4Draft article={article} config={DEFAULT_CONFIG} files={[]} model={DEFAULT_MODELS[0]} railwayUrl="" onUpdate={async p=>{setArticle((a:any)=>({...a,...p}));return true;}} onPrev={()=>{}} onToggleComplete={()=>{}}/></main>;
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><Fixture/></LanguageProvider>);
