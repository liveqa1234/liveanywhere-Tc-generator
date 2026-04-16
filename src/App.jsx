import { useState, useRef } from "react";

const SLACK_WEBHOOK = import.meta.env.VITE_SLACK_WEBHOOK;

const C = {
  bg:"#0c0c10", surface:"#13131a", surface2:"#1a1a24",
  border:"#2a2a38", accent:"#7c6af7", accent2:"#a78bfa",
  green:"#22d3a0", red:"#f87171", yellow:"#fbbf24",
  text:"#e8e8f0", muted:"#6b6b88",
};
const card = { background:C.surface, border:"1px solid "+C.border, borderRadius:14, padding:24, marginBottom:16 };
const inp  = { width:"100%", background:C.bg, border:"1px solid "+C.border, borderRadius:8, color:C.text, fontSize:13, padding:"9px 12px", outline:"none", boxSizing:"border-box" };
const lbl  = { display:"block", fontSize:11, textTransform:"uppercase", letterSpacing:"0.5px", color:C.muted, marginBottom:6, fontWeight:600 };

function PdfUpload({ sid, pdf, name, onFile, onRemove }) {
  const [drag, setDrag] = useState(false);
  const ref = useRef();
  const pick = (f) => { if (f && f.type === "application/pdf") onFile(sid, f); };
  if (pdf) return (
    <div style={{display:"flex",alignItems:"center",gap:12,background:C.green+"18",border:"1px solid "+C.green+"44",borderRadius:10,padding:"12px 16px"}}>
      <div style={{width:34,height:34,background:C.green+"22",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>{"📋"}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:12,fontWeight:600,color:C.green,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{name}</div>
        <div style={{fontSize:11,color:C.muted}}>{"PDF 첨부됨"}</div>
      </div>
      <button onClick={()=>onRemove(sid)} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:16}}>{"✕"}</button>
    </div>
  );
  return (
    <div style={{border:"2px dashed "+(drag?C.accent:C.border),borderRadius:10,padding:"28px 16px",textAlign:"center",background:drag?C.accent+"08":C.bg,cursor:"pointer"}}
      onDragOver={e=>{e.preventDefault();setDrag(true);}}
      onDragLeave={()=>setDrag(false)}
      onDrop={e=>{e.preventDefault();setDrag(false);pick(e.dataTransfer.files[0]);}}
      onClick={()=>ref.current.click()}>
      <input ref={ref} type="file" accept=".pdf" style={{display:"none"}} onChange={e=>pick(e.target.files[0])}/>
      <div style={{fontSize:28,marginBottom:8}}>{"📄"}</div>
      <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:4}}>{"PDF를 드래그하거나 클릭해서 선택"}</div>
      <div style={{fontSize:11,color:C.muted}}>{"기획서, 스펙 문서 등 .pdf 파일"}</div>
    </div>
  );
}

function parseTCs(raw, prefix) {
  const gl = (block, key) => { const m=block.match(new RegExp("^"+key+":\\s*(.+)$","im")); return m?m[1].trim():""; };
  const gm = (block, key) => { const m=block.match(new RegExp("^"+key+":\\s*\n([\\s\\S]*?)(?=\n[A-Z_]+:|$)","im")); return m?m[1].trim():gl(block,key); };
  const parseBlock = (block, n) => {
    if (!block.match(/FEATURE:/i)) return null;
    const p = gl(block,"PRIORITY") || "Medium";
    return { id:gl(block,"ID")||(prefix+"_"+String(n).padStart(3,"0")), platform:gl(block,"PLATFORM"), feature:gl(block,"FEATURE"), precondition:gm(block,"PRECONDITION"), action:gm(block,"ACTION"), expected:gm(block,"EXPECTED"), priority:["High","Medium","Low"].includes(p)?p:"Medium", notes:gm(block,"NOTES") };
  };
  const sheetMarkers = raw.match(/===SHEET:\s*.+?===/gi);
  if (sheetMarkers && sheetMarkers.length > 1) {
    const sheetBlocks = raw.split(/===SHEET:\s*.+?===/i).map(b=>b.trim()).filter(Boolean);
    const sheetNames = [...raw.matchAll(/===SHEET:\s*(.+?)===/gi)].map(m=>m[1].trim());
    const result = [];
    sheetBlocks.forEach((block, si) => {
      const tcs = []; let n = 0;
      block.split(/---TC---/i).map(b=>b.trim()).filter(Boolean).forEach(b => { n++; const tc=parseBlock(b,n); if(tc)tcs.push(tc); });
      if (tcs.length) result.push({ sheetName:sheetNames[si]||("시트"+(si+1)), tcs });
    });
    return result;
  }
  const tcs = []; let n = 0;
  raw.split(/---TC---/i).map(b=>b.trim()).filter(Boolean).forEach(b => { n++; const tc=parseBlock(b,n); if(tc)tcs.push(tc); });
  return tcs;
}

function buildPrompt(type, sh, tcPrefix, platformList, priority, focusNote, baseTcs) {
  const spec = (sh.pdf&&sh.spec.trim()) ? "\n## 추가 메모:\n"+sh.spec+"\n"
    : (!sh.pdf&&sh.spec.trim()) ? "\n## 기획 내용:\n"+sh.spec+"\n" : "";
  const focus = focusNote.trim() ? "\n## 중점 테스트 항목:\n"+focusNote.trim()+"\n위 중점 항목을 최우선으로 TC를 구성하고, 관련 케이스를 가장 많이 생성해주세요.\n" : "";
  const fmt = (id,pr) => "ID: "+id+"\nPLATFORM: "+platformList+"\nFEATURE: 테스트 항목명\nPRECONDITION:\n1. 로그인된 상태\n2. 숙소 상세 페이지에 진입한 상태\nACTION:\n1. 링크페이 생성 버튼 클릭\n2. 금액 입력\nEXPECTED:\n1. 기대결과가 노출된다\nPRIORITY: "+pr+"\nNOTES:\n\n---TC---";

  if (type === "normal") {
    return "당신은 QA 엔지니어입니다. "+(sh.pdf?"첨부된 PDF 기획 문서":"아래 기획 내용")+"를 분석하여 테스트 케이스를 작성해주세요.\n"
      +spec+focus
      +"\n## 시트 분리 규칙:\n"
      +"- 기획서와 피그마를 분석하여 아래 우선순위로 시트를 자동 분리\n"
      +"- 1순위: 피그마 페이지 구조가 명시되어 있으면 피그마 페이지 단위로 분리\n"
      +"  · LiveAnywhere 피그마 페이지 구조: 게스트 앱 / 게스트 웹 / 콘솔 (호스트) / 앱 호스트 메시지 / 매니저 백오피스 (Crew)\n"
      +"  · 기획서가 여러 피그마 페이지에 걸쳐 있으면 해당 페이지명으로 시트 분리\n"
      +"- 2순위: 피그마 페이지 구분이 없고 역할이 구분되면 역할별 분리 (매니저 / 게스트 앱 / 게스트 웹 / 콘솔 / 호스트 등)\n"
      +"- 3순위: 역할 구분도 없고 기능/화면이 여러 개면 아래 LiveAnywhere 화면 구조 기준으로 분리\n"
      +"  · 홈 / 검색 목록 / 검색 상세 / 집 상세 / 집 예약 (예약 요청, 예약 진행, 결제 완료) / 리브 후기 / 내 정보\n"
      +"  · 위 구조에 해당하지 않으면 기획서의 기능/섹션 단위로 자유롭게 분리\n"
      +"- 4순위: 단일 기능이면 ===SHEET: "+sh.name+"=== 하나만 사용\n"
      +"- 시트 구분은 ===SHEET: 시트명=== 으로 표시\n"
      +"- 각 시트 안에서 TC는 ---TC--- 로 구분\n"
      +"\n## 조건:\n- TC ID 접두사: "+tcPrefix+"\n- 시트명: "+sh.name+"\n- 플랫폼: "+platformList
      +"\n- 기본 우선순위: "+priority
      +"\n- TC 수 기준:\n  · 단순 기능: 최소 15개 이상\n  · 보통 기능: 최소 25개 이상\n  · 복잡한 기능: 최소 40개 이상\n  · 어떤 경우에도 최소 40개 이상 생성할 것\n"
      +"\n## 출력 형식:\n텍스트 형식으로만 출력. JSON/마크다운 절대 금지. TC 사이는 ---TC--- 구분.\n\n"
      +fmt(tcPrefix+"_001","High")
      +"\n\n## 사전조건 작성 규칙:\n- 반드시 '~된 상태' 또는 '~한 상태' 형태로 작성 (로그인된 상태 / 숙소 상세 페이지에 진입한 상태 / 결제 수단이 등록된 상태)\n- 동사형 금지: '로그인한다', '페이지로 이동한다' 등 금지\n"
      +"\n## 테스트 액션 작성 규칙:\n- 반드시 명사형으로 끝내기 (버튼 클릭 / 텍스트 입력 / 항목 선택 / 페이지 이동)\n- '~한다', '~클릭한다', '~입력한다' 등 동사형 종결 금지\n- 올바른 예: '로그인 버튼 클릭', '이메일 입력', '날짜 선택'\n- 잘못된 예: '로그인 버튼을 클릭한다', '이메일을 입력한다'\n"
      +"\n## 기대결과 작성 규칙:\n- 반드시 '~된다' 형태 단문 (화면이 노출된다 / 버튼이 활성화된다 / 오류 메시지가 표시된다)\n- '올바르게 처리된다', '정상적으로 동작한다' 같은 추상적 표현 금지\n"
      +"\n## TC 작성 원칙:\n- 반드시 게스트/호스트/매니저가 실제로 버튼을 누르고, 입력하고, 결과를 눈으로 확인할 수 있는 케이스만 작성\n- 내부 구현 검증 케이스 절대 금지 (URL 암호화 확인, HTTPS 적용 확인, DB 저장 확인, API 응답값 확인 등)\n- 화면에 노출되는 UI, 버튼 동작, 상태 변화, 메시지 노출 등 눈에 보이는 결과 기준\n"
      +"\n## 역할별 TC 구성 순서 (반드시 이 순서로 그룹핑):\n1. 매니저 (백오피스/Crew): 링크페이 생성 → 만료 등 관리 기능\n2. 게스트 (결제 페이지): 결제 수단 선택 → 결제 완료\n   - 포함: 결제 수단 선택 (신용카드/네이버페이/카카오페이/토스페이 등), 결제 버튼 클릭, 결제 완료/실패 화면 노출\n   - 제외: 카드 번호 입력, CVC 입력, 유효기간 입력 등 PG사 화면 동작 (우리 관할 아님)\n- 호스트 관련 TC는 기획서에 명시된 경우에만 작성, 없으면 생략\n- 위 순서대로 흐름이 이어지도록 작성\n"
      +"\n주의: 정상 플로우 -> 예외 케이스 순서. PRIORITY는 High/Medium/Low 중 하나.";
  } else {
    const fl = (baseTcs||[]).map(t=>t.feature).filter((v,i,a)=>a.indexOf(v)===i).join("\n");
    return "당신은 QA 엔지니어입니다. 아래 기능들에 대해 게스트 관점의 예외 케이스 TC를 작성해주세요.\n"
      +spec+focus
      +"\n## 기본 TC 기능 목록:\n"+fl+"\n"
      +"\n## 원칙:\n- 게스트가 직접 재현 가능한 케이스만 (네트워크 강제차단 등 제외)\n- 정상 동작 후 뒤로가기/재시도/중복 제출, 빈값/범위초과 입력, 필수항목 미입력, 중복 시도\n"
      +"\n## 조건:\n- TC ID: "+tcPrefix+"_E001 형식\n- 사용자: 게스트 기준\n- 플랫폼: "+platformList
      +"\n- PRIORITY: 게스트 경험 직접 영향 High, 안내 메시지 수준 Medium\n"
      +"\n## 출력 형식:\n텍스트 형식으로만. JSON/마크다운 절대 금지. TC 사이는 ---TC--- 구분.\n\n"
      +fmt(tcPrefix+"_E001","High")
      +"\n\n기대결과는 '~된다' 형태 단문. PRIORITY는 High/Medium/Low 중 하나.";
  }
}

export default function App() {
  const [tcPrefix,          setTcPrefix]          = useState("TC");
  const [wikiLink,          setWikiLink]           = useState("");
  const [figmaToken,        setFigmaToken]         = useState("");
  const [geminiKey,         setGeminiKey]          = useState("");
  const [focusNote,         setFocusNote]          = useState("");
  const [platforms,         setPlatforms]          = useState(new Set());
  const [priority,          setPriority]           = useState("Medium");
  const [sheets,            setSheets]             = useState([{id:1,name:"기능 1",pdf:null,pdfName:"",figmaUrls:[""],spec:""}]);
  const [activeId,          setActiveId]           = useState(1);
  const [editTab,           setEditTab]            = useState(null);
  const [editVal,           setEditVal]            = useState("");
  const [loading,           setLoading]            = useState(false);
  const [loadMsg,           setLoadMsg]            = useState("");
  const [error,             setError]              = useState("");
  const [results,           setResults]            = useState(null);
  const [analysis,          setAnalysis]           = useState(null);
  const [analyzing,         setAnalyzing]          = useState(false);
  const [enhancedAnalysis,  setEnhancedAnalysis]   = useState(null);
  const [enhancedAnalyzing, setEnhancedAnalyzing]  = useState(false);
  const [existingTC,        setExistingTC]         = useState(null);
  const [existingTCName,    setExistingTCName]     = useState("");
  const idRef = useRef(1);

  const active = sheets.find(s=>s.id===activeId);
  const upd = (id,patch) => setSheets(prev=>prev.map(s=>s.id===id?{...s,...patch}:s));

  const addSheet = () => { idRef.current++; const id=idRef.current; setSheets(prev=>[...prev,{id,name:"시트 "+id,pdf:null,pdfName:"",figmaUrls:[""],spec:""}]); setActiveId(id); };
  const removeSheet = (id) => { if(sheets.length<=1)return; setSheets(prev=>{const nx=prev.filter(s=>s.id!==id);setActiveId(nx[0].id);return nx;}); };
  const resetAll = () => { idRef.current=1; setSheets([{id:1,name:"기능 1",pdf:null,pdfName:"",figmaUrls:[""],spec:""}]); setActiveId(1); setTcPrefix("TC"); setWikiLink(""); setPlatforms(new Set()); setError(""); setResults(null); setAnalysis(null); setEnhancedAnalysis(null); setExistingTC(null); setExistingTCName(""); setFocusNote(""); };
  const addFigma = (sid) => { const sh=sheets.find(s=>s.id===sid); upd(sid,{figmaUrls:[...sh.figmaUrls,""]}); };
  const delFigma = (sid,i) => { const sh=sheets.find(s=>s.id===sid); if(sh.figmaUrls.length<=1)return; upd(sid,{figmaUrls:sh.figmaUrls.filter((_,j)=>j!==i)}); };
  const setFigma = (sid,i,v) => { const sh=sheets.find(s=>s.id===sid); const a=[...sh.figmaUrls]; a[i]=v; upd(sid,{figmaUrls:a}); };
  const onPdf = (sid,file)=>{ const r=new FileReader(); r.onload=e=>upd(sid,{pdf:e.target.result.split(",")[1],pdfName:file.name}); r.readAsDataURL(file); };
  const rmPdf = (sid) => upd(sid,{pdf:null,pdfName:""});
  const handleExistingTC = (file) => { if(!file)return; const r=new FileReader(); r.onload=e=>{setExistingTC(e.target.result.split(",")[1]);setExistingTCName(file.name);}; r.readAsDataURL(file); };

  const callClaude = async (content) => {
    const key = geminiKey.trim();
    if (!key) throw new Error("Claude API 키를 입력해주세요.");
    const messages = content.map(c => {
      if (c.type==="text") return {type:"text",text:c.text};
      if (c.type==="document") return {type:"document",source:{type:"base64",media_type:c.source.media_type,data:c.source.data}};
      return null;
    }).filter(Boolean);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({
        model:"claude-sonnet-4-20250514",
        max_tokens:8192,
        messages:[{role:"user",content:messages}]
      })
    });
    if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(e?.error?.message||"Claude API 오류: "+res.status); }
    const data = await res.json();
    return data.content?.map(c=>c.text||"").join("")||"";
  };

  const callAndContinue = async (content) => {
    let raw = await callClaude(content);
    if (raw.length > 7000) {
      const cont = await callClaude([...content,{type:"text",text:raw},{type:"text",text:"응답이 잘렸습니다. 마지막 TC부터 같은 형식으로 이어서 작성해주세요."}]);
      raw += "\n" + cont;
    }
    return raw;
  };


  const sendSlack = async (type, data) => {
    try {
      let text = "";
      if (type === "tc") {
        const total = data.reduce((a,r)=>a+r.tcs.length,0);
        const lines = data.map(r=>"  - "+r.sheetName+" ("+r.tcs.length+"개)").join("\n");
        text = "*TC 생성 완료!*\n*TC ID 접두사:* "+tcPrefix+"\n*시트:* "+data.length+"개  |  *총 TC:* "+total+"개\n"+lines;
      } else if (type === "analysis") {
        const total = data.reduce((a,s)=>a+s.items.length,0);
        const lines = data.map(s=>{ const hi=s.items.filter(i=>i.priority==="High").length; const md=s.items.filter(i=>i.priority==="Medium").length; return "  - "+s.title+": "+s.items.length+"개"+(hi?" High:"+hi:"")+(md?" Medium:"+md:""); }).join("\n");
        const tops = data.flatMap(s=>s.items).filter(i=>i.priority==="High").slice(0,3).map(i=>"  - "+i.item).join("\n");
        text = "*TC 분석 완료!*\n*누락/부족 항목:* 총 "+total+"개 발견\n"+lines+(tops?"\n\n*High 누락 항목:*\n"+tops:"");
      } else if (type === "enhanced") {
        const { qualitySummary:qs, improvements, newTcs } = data;
        text = "*TC 품질 분석 완료!*\n*평균 품질 점수:* "+(qs.AVG_SCORE||0)+"점\n*양호 (70점↑):* "+(qs.HIGH_QUALITY||0)+"개  |  *미흡 (70점↓):* "+(qs.LOW_QUALITY||0)+"개\n*개선 제안:* "+improvements.length+"개  |  *신규 TC:* "+newTcs.length+"개";
      }
      await fetch(SLACK_WEBHOOK,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text})});
    } catch(e) { console.warn("슬랙 전송 실패:", e.message); }
  };

  const fetchFigmaPages = async (figmaUrl) => {
    if (!figmaToken || !figmaUrl) return null;
    try {
      const match = figmaUrl.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/);
      if (!match) return null;
      const fileKey = match[1];
      const res = await fetch("https://api.figma.com/v1/files/"+fileKey+"?depth=1", {
        headers: { "X-Figma-Token": figmaToken }
      });
      if (!res.ok) return null;
      const data = await res.json();
      return (data.document?.children||[]).map(p=>p.name);
    } catch(e) { return null; }
  };

  const generate = async () => {
    const hasContent = sheets.some(s=>s.pdf||s.spec.trim());
    if (!hasContent) { setError("최소 하나의 시트에 PDF 또는 텍스트를 입력해주세요."); return; }
    setError(""); setLoading(true); setResults(null);
    const platformList = [...platforms].join(", ") || "PC, APP";
    const generated = [];
    try {
      for (let i=0; i<sheets.length; i++) {
        const sh = sheets[i];
        if (!sh.pdf && !sh.spec.trim()) continue;
        const figmaStr = sh.figmaUrls.filter(Boolean).join(" | ");
        const figmaUrls = sh.figmaUrls.filter(Boolean);
        const hasFigma = figmaUrls.length > 0;
        const useFigma = hasFigma && figmaToken && !sh.pdf && !sh.spec.trim();
        setLoadMsg("("+(i+1)+"/"+sheets.length+") "+sh.name+(hasFigma?" - 피그마 페이지 분석 중...":" 생성 중..."));
        // Fetch figma pages for all provided figma URLs
        let figmaPagesList = [];
        if (hasFigma && figmaToken) {
          const pagesResults = await Promise.all(figmaUrls.map(url=>fetchFigmaPages(url)));
          pagesResults.forEach((pages,idx)=>{ if(pages&&pages.length) figmaPagesList.push({url:figmaUrls[idx],pages}); });
        }
        const figmaPagesSection = figmaPagesList.length
          ? "\n## 피그마 페이지 구조 (반드시 이 페이지 단위로 시트 분리):\n"
            +figmaPagesList.map(f=>"- "+f.url+"\n  페이지: "+f.pages.join(" / ")).join("\n")+"\n"
            +"위 페이지 목록 기준으로 ===SHEET: 페이지명=== 으로 시트를 분리해주세요.\n"
          : "";
        setLoadMsg("("+(i+1)+"/"+sheets.length+") "+sh.name+" TC 생성 중...");
        const content = [];
        if (sh.pdf) content.push({type:"document",source:{type:"base64",media_type:"application/pdf",data:sh.pdf}});
        const promptText = buildPrompt("normal",sh,tcPrefix,platformList,priority,focusNote,null);
        const finalPrompt = promptText + figmaPagesSection
          + (useFigma ? "\n## 피그마 분석 지시:\n- 위 피그마 링크의 각 페이지/컴포넌트/화면 구조를 직접 읽어서 TC를 작성해주세요.\n- 버튼, 입력 필드, 상태 변화, 화면 전환 등을 파악하여 반영해주세요." : "");
        content.push({type:"text",text:finalPrompt});
        const parseResult = parseTCs(await callAndContinue(content), tcPrefix);
        let normalSheets = [], allTcs = [];
        if (parseResult.length && parseResult[0].sheetName) {
          normalSheets = parseResult.map(s=>({...s,figmaStr,wikiLink}));
          allTcs = parseResult.flatMap(s=>s.tcs);
        } else {
          if (!parseResult.length) throw new Error("생성된 TC 없음 ("+sh.name+")");
          normalSheets = [{sheetName:sh.name,tcs:parseResult,figmaStr,wikiLink}];
          allTcs = parseResult;
        }
        generated.push(...normalSheets);
        setLoadMsg("("+(i+1)+"/"+sheets.length+") "+sh.name+" - 예외케이스 생성 중...");
        const exContent = [];
        if (sh.pdf) exContent.push({type:"document",source:{type:"base64",media_type:"application/pdf",data:sh.pdf}});
        exContent.push({type:"text",text:buildPrompt("exception",sh,tcPrefix,platformList,priority,focusNote,allTcs)});
        const exResult = parseTCs(await callAndContinue(exContent), tcPrefix+"_E");
        if (exResult.length && exResult[0].sheetName) {
          exResult.forEach(s=>generated.push({...s,sheetName:s.sheetName+" - 예외케이스",figmaStr,wikiLink}));
        } else if (exResult.length) {
          generated.push({sheetName:sh.name+" - 예외케이스",tcs:exResult,figmaStr,wikiLink});
        }
      }
      if (!generated.length) throw new Error("생성된 시트가 없습니다.");
      setResults(generated);
      sendSlack("tc", generated);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const analyzeTC = async () => {
    const hasContent = sheets.some(s=>s.pdf||s.spec.trim());
    if (!hasContent) { setError("기획 문서(PDF) 또는 기획 내용을 먼저 입력해주세요."); return; }
    if (!existingTC) { setError("기존 TC 파일(.xlsx)을 업로드해주세요."); return; }
    setError(""); setAnalyzing(true); setAnalysis(null);
    try {
      const sh = sheets.find(s=>s.pdf||s.spec.trim()) || sheets[0];
      const platformList = [...platforms].join(", ") || "PC, APP";
      const figmaStr = sh.figmaUrls.filter(Boolean).join(", ");
      const specSection = sh.spec.trim() ? "\n## 기획 내용:\n"+sh.spec+"\n" : "";
      const prompt = "당신은 QA 엔지니어입니다. 첨부된 기존 TC 파일과 기획 문서를 비교하여 누락된 테스트 케이스를 찾아주세요.\n"
        +specSection+(figmaStr?"\n## 피그마 링크: "+figmaStr+"\n":"")
        +"\n## 분석 기준:\n- 기획서에 명시된 기능 중 TC가 없거나 부족한 항목\n- 게스트가 직접 재현 가능한 누락 예외케이스\n- 재현 불가(네트워크 차단 등) 케이스 제외\n"
        +"\n## 출력 형식:\nSECTION: 섹션명\nITEM: 항목명\nREASON: 이유 한 줄\nSUGGEST:\n1. 제안 액션\nEXPECTED: 기대결과가 노출된다\nPRIORITY: High\n---ITEM---\n"
        +"\n이미 기존 TC에 있는 항목은 언급하지 말 것. PRIORITY는 High/Medium/Low 중 하나.";
      const content = [];
      content.push({type:"document",source:{type:"base64",media_type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",data:existingTC}});
      if (sh.pdf) content.push({type:"document",source:{type:"base64",media_type:"application/pdf",data:sh.pdf}});
      content.push({type:"text",text:prompt});
      const raw = await callClaude(content);
      const sections = [];
      raw.split(/^SECTION:/im).filter(Boolean).forEach(block=>{
        const title = (block.match(/^(.+)$/m)||[])[1]||"분석 결과";
        const items = [];
        block.split(/---ITEM---/i).map(b=>b.trim()).filter(Boolean).forEach(ib=>{
          const gf=(key)=>{const m=ib.match(new RegExp("^"+key+":\\s*(.+)$","im"));return m?m[1].trim():"";};
          const gm=(key)=>{const m=ib.match(new RegExp("^"+key+":\\s*\n([\\s\\S]*?)(?=\n[A-Z]+:|$)","im"));return m?m[1].trim():gf(key);};
          const item=gf("ITEM"); if(!item)return;
          items.push({item,reason:gf("REASON"),suggest:gm("SUGGEST"),expected:gf("EXPECTED"),priority:gf("PRIORITY")||"Medium"});
        });
        if (items.length) sections.push({title:title.trim(),items});
      });
      const final = sections.length ? sections : [{title:"분석 완료",items:[{item:"누락된 TC 없음",reason:"기존 TC가 기획서의 주요 케이스를 충분히 커버하고 있습니다.",suggest:"",expected:"",priority:"Low"}]}];
      setAnalysis(final);
      sendSlack("analysis", final);
    } catch(e) { setError("분석 오류: "+e.message); }
    finally { setAnalyzing(false); }
  };

  const enhancedAnalyze = async () => {
    const hasContent = sheets.some(s=>s.pdf||s.spec.trim());
    if (!hasContent) { setError("기획 문서(PDF) 또는 기획 내용을 먼저 입력해주세요."); return; }
    if (!existingTC) { setError("기존 TC 파일(.xlsx)을 업로드해주세요."); return; }
    setError(""); setEnhancedAnalyzing(true); setEnhancedAnalysis(null);
    try {
      const sh = sheets.find(s=>s.pdf||s.spec.trim()) || sheets[0];
      const figmaStr = sh.figmaUrls.filter(Boolean).join(", ");
      const specSection = sh.spec.trim() ? "\n## 기획 내용:\n"+sh.spec+"\n" : "";
      const focusSection = focusNote.trim() ? "\n## 중점 항목:\n"+focusNote+"\n" : "";
      const prompt = "당신은 시니어 QA 엔지니어입니다. 첨부된 기존 TC 파일을 아래 3가지 관점으로 분석해주세요.\n"
        +specSection+focusSection+(figmaStr?"\n## 피그마 링크: "+figmaStr+"\n":"")
        +"\n## 분석 관점:\n1. 품질 점수: 각 TC의 사전조건/액션/기대결과를 0~100점 평가\n   - 사전조건: '~된 상태' 형태로 끝나는지, 구체적인지\n   - 액션: 명사형으로 끝나는지 (클릭/입력/선택), 단계가 명확한지\n   - 기대결과: '~된다' 형태인지, 구체적이고 눈에 보이는 결과인지\n2. 미흡한 TC 개선: 품질이 낮은 TC(70점 미만)는 개선된 버전 제안\n3. 신규 TC: 기획서/피그마에 있지만 기존 TC에 없는 케이스 추가 생성\n"
        +"\n## 출력 형식 (반드시 아래 형식 준수):\n"
        +"===QUALITY_SUMMARY===\nTOTAL: TC총개수\nAVG_SCORE: 평균점수\nHIGH_QUALITY: 70점이상개수\nLOW_QUALITY: 70점미만개수\n===END_QUALITY===\n\n"
        +"===IMPROVE===\nTC_ID: 기존TC아이디\nSCORE: 점수\nISSUE: 문제점 한 줄\nOLD_PRECONDITION: 기존사전조건\nNEW_PRECONDITION: 개선된사전조건\nOLD_ACTION: 기존액션\nNEW_ACTION: 개선된액션\nOLD_EXPECTED: 기존기대결과\nNEW_EXPECTED: 개선된기대결과\n---ITEM---\n===END_IMPROVE===\n\n"
        +"===NEW_TC===\nID: 신규TCID\nPLATFORM: 플랫폼\nFEATURE: 항목명\nPRECONDITION:\n1. ~된 상태\nACTION:\n1. 액션\nEXPECTED:\n1. ~된다\nPRIORITY: High\nNOTES:\n\n---TC---\n===END_NEW_TC===\n"
        +"\n주의: 내부 구현 검증(URL암호화, HTTPS확인 등) 절대 금지.";
      const content = [];
      content.push({type:"document",source:{type:"base64",media_type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",data:existingTC}});
      if (sh.pdf) content.push({type:"document",source:{type:"base64",media_type:"application/pdf",data:sh.pdf}});
      content.push({type:"text",text:prompt});
      const raw = await callClaude(content);
      const qMatch = raw.match(/===QUALITY_SUMMARY===([\s\S]*?)===END_QUALITY===/i);
      const qualitySummary = {};
      if (qMatch) { qMatch[1].split("\n").forEach(line=>{ const [k,v]=line.split(":").map(s=>s.trim()); if(k&&v)qualitySummary[k]=isNaN(v)?v:Number(v); }); }
      const improveMatch = raw.match(/===IMPROVE===([\s\S]*?)===END_IMPROVE===/i);
      const improvements = [];
      if (improveMatch) {
        improveMatch[1].split(/---ITEM---/i).map(b=>b.trim()).filter(Boolean).forEach(block=>{
          const gf=k=>{const m=block.match(new RegExp("^"+k+":\\s*(.+)$","im"));return m?m[1].trim():"";};
          const gm=k=>{const m=block.match(new RegExp("^"+k+":\\s*\n([\\s\\S]*?)(?=\n[A-Z_]+:|$)","im"));return m?m[1].trim():gf(k);};
          const id=gf("TC_ID"); if(!id)return;
          improvements.push({id,score:Number(gf("SCORE"))||0,issue:gf("ISSUE"),oldPre:gm("OLD_PRECONDITION"),newPre:gm("NEW_PRECONDITION"),oldAct:gm("OLD_ACTION"),newAct:gm("NEW_ACTION"),oldExp:gm("OLD_EXPECTED"),newExp:gm("NEW_EXPECTED")});
        });
      }
      const newTcMatch = raw.match(/===NEW_TC===([\s\S]*?)===END_NEW_TC===/i);
      const newTcsRaw = newTcMatch ? parseTCs(newTcMatch[1], tcPrefix) : [];
      const newTcs = newTcsRaw.length && newTcsRaw[0].sheetName ? newTcsRaw.flatMap(s=>s.tcs) : newTcsRaw;
      setEnhancedAnalysis({qualitySummary,improvements,newTcs});
      sendSlack("enhanced",{qualitySummary,improvements,newTcs});
    } catch(e) { setError("분석 오류: "+e.message); }
    finally { setEnhancedAnalyzing(false); }
  };

  const loadXLSX = () => new Promise((res,rej)=>{ if(window.XLSX){res(window.XLSX);return;} const el=document.createElement("script"); el.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; el.onload=()=>res(window.XLSX); el.onerror=()=>rej(new Error("XLSX 로드 실패")); document.head.appendChild(el); });

  const downloadExcel = async () => {
    const XLSX = await loadXLSX();
    const wb = XLSX.utils.book_new();
    const HDRS = ["TC ID","플랫폼 OS","사전 조건 (Pre-condition)","테스트 항목 (Feature/Function)","테스트 액션 (Scenario/Steps)","기대 결과\n(Expected Result)","Android","iOS","삼성 인터넷","iOS\n크롬","Windows Chrome","Mac Chrome","실제 결과\n(Actual Result)","JIRA","참고\n(Reference)","비고\n(Notes)","우선순위\n(Priority)"];
    const WCHS = [14,12,36,28,40,34,9,8,12,8,15,12,12,14,34,14,11];
    results.forEach((sheet,si)=>{
      let nm=sheet.sheetName.replace(/[:\\\/\?\*\[\]]/g,"").substring(0,31)||"Sheet"+(si+1);
      let fn=nm,n=2; while(wb.SheetNames.includes(fn))fn=nm.substring(0,28)+"_"+n++;
      const rows=[[null],["프로젝트 : ",sheet.wikiLink||"","피그마",sheet.figmaStr||"",null,null,"APP",null,"MO WEB",null,"PC WEB"],HDRS];
      sheet.tcs.forEach((tc,idx)=>{
        const r=idx+4;
        const f="IF(COUNTIF(G"+r+":H"+r+",\"F\")>=1,\"F\",IF(COUNTIF(G"+r+":H"+r+",\"P\")>=1,\"P\",IF(COUNTIF(G"+r+":H"+r+",\"N/T\")>=1,\"N/T\",IF(COUNTIF(G"+r+":H"+r+",\"NA\")>=1,\"NA\",\"-\"))))";
        rows.push([tc.id||"",tc.platform||"",tc.precondition||"",tc.feature||"",tc.action||"",tc.expected||"","","","","","","",{f},"",sheet.figmaStr||"","",tc.priority||"Medium"]);
      });
      const ws=XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"]=WCHS.map(w=>({wch:w}));
      ws["!rows"]=[{hpt:14},{hpt:18},{hpt:36}];
      sheet.tcs.forEach(()=>ws["!rows"].push({hpt:75}));
      XLSX.utils.book_append_sheet(wb,ws,fn);
    });
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([[],[],[null,"결과보고서"],[],[null,"Application","LiveAnywhere"]]),"Summary");
    const qa=[[],[null,"검증 진행 현황"],[null,"시트명","TC 수"]];
    results.forEach((sh,i)=>qa.push([null,sh.sheetName,{f:"COUNTA('"+wb.SheetNames[i]+"'!A4:A1000)"}]));
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(qa),"QA 검증 진행 현황");
    XLSX.writeFile(wb,"TC_"+tcPrefix+"_"+new Date().toISOString().slice(0,10)+".xlsx");
  };

  const downloadEnhancedExcel = async () => {
    if (!enhancedAnalysis) return;
    const XLSX = await loadXLSX();
    const wb = XLSX.utils.book_new();
    const { qualitySummary:qs, improvements, newTcs } = enhancedAnalysis;
    const summaryRows = [["TC 품질 분석 보고서"],[],["총 TC 수",qs.TOTAL||0],["평균 품질 점수",(qs.AVG_SCORE||0)+"점"],["양호 (70점 이상)",qs.HIGH_QUALITY||0],["미흡 (70점 미만)",qs.LOW_QUALITY||0]];
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(summaryRows),"품질 요약");
    const impRows=[["TC ID","품질점수","문제점","기존 사전조건","개선 사전조건","기존 액션","개선 액션","기존 기대결과","개선 기대결과"]];
    improvements.forEach(i=>impRows.push([i.id,i.score,i.issue,i.oldPre,i.newPre,i.oldAct,i.newAct,i.oldExp,i.newExp]));
    const impWs=XLSX.utils.aoa_to_sheet(impRows);
    impWs["!cols"]=[10,8,20,24,24,24,24,24,24].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb,impWs,"개선 제안");
    const newRows=[["TC ID","플랫폼 OS","사전 조건","테스트 항목","테스트 액션","기대 결과","우선순위"]];
    newTcs.forEach(tc=>newRows.push([tc.id,tc.platform,tc.precondition,tc.feature,tc.action,tc.expected,tc.priority]));
    const newWs=XLSX.utils.aoa_to_sheet(newRows);
    newWs["!cols"]=[14,12,30,28,36,30,11].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb,newWs,"신규 TC");
    XLSX.writeFile(wb,"TC_품질분석_"+new Date().toISOString().slice(0,10)+".xlsx");
  };

  const isLoading = loading || analyzing || enhancedAnalyzing;
  const loadTitle = enhancedAnalyzing?"TC 품질 분석 중...":analyzing?"TC 분석 중...":"TC 생성 중...";
  const loadSub = enhancedAnalyzing?"사전조건·액션·기대결과 품질을 점검하고 있어요":analyzing?"기획서와 기존 TC를 비교하고 있어요":loadMsg;

  if (isLoading) return (
    <div style={{background:C.bg,minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"system-ui,sans-serif",color:C.text}}>
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
      <div style={{width:44,height:44,border:"3px solid "+C.border,borderTopColor:C.accent,borderRadius:"50%",animation:"spin 0.8s linear infinite",marginBottom:20}}/>
      <div style={{fontSize:15,fontWeight:700,marginBottom:6}}>{loadTitle}</div>
      <div style={{fontSize:12,color:C.muted}}>{loadSub}</div>
    </div>
  );

  if (enhancedAnalysis) {
    const { qualitySummary:qs, improvements, newTcs } = enhancedAnalysis;
    const scoreColor = s => s>=80?C.green:s>=70?C.yellow:C.red;
    return (
      <div style={{background:C.bg,minHeight:"100vh",fontFamily:"system-ui,sans-serif",color:C.text,padding:"32px 20px 80px",maxWidth:960,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24,flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:16,fontWeight:700}}>{"✨ TC 품질 개선 분석 완료"}</div>
            <div style={{fontSize:12,color:C.muted,marginTop:2}}>{"개선 제안 "+improvements.length+"개 · 신규 TC "+newTcs.length+"개"}</div>
          </div>
          <div style={{marginLeft:"auto",display:"flex",gap:8}}>
            <button style={{padding:"8px 16px",background:"transparent",border:"1px solid "+C.border,borderRadius:7,color:C.muted,fontSize:12,cursor:"pointer"}} onClick={()=>setEnhancedAnalysis(null)}>{"↩ 돌아가기"}</button>
            <button style={{padding:"9px 18px",background:C.green,border:"none",borderRadius:7,color:"#000",fontSize:13,fontWeight:700,cursor:"pointer"}} onClick={downloadEnhancedExcel}>{"⬇ 엑셀 다운로드"}</button>
          </div>
        </div>
        <div style={{...card,display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,textAlign:"center"}}>
          {[{label:"총 TC",value:qs.TOTAL||0,color:C.text},{label:"평균 품질점수",value:(qs.AVG_SCORE||0)+"점",color:scoreColor(qs.AVG_SCORE||0)},{label:"양호 (70점↑)",value:qs.HIGH_QUALITY||0,color:C.green},{label:"미흡 (70점↓)",value:qs.LOW_QUALITY||0,color:C.red}].map((item,i)=>(
            <div key={i}>
              <div style={{fontSize:22,fontWeight:800,color:item.color,marginBottom:4}}>{item.value}</div>
              <div style={{fontSize:11,color:C.muted}}>{item.label}</div>
            </div>
          ))}
        </div>
        {improvements.length>0&&(
          <div style={card}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:16,display:"flex",alignItems:"center",gap:8}}>
              <span style={{padding:"3px 10px",background:C.red+"22",borderRadius:20,fontSize:11,color:C.red}}>{"개선 제안"}</span>
              <span style={{fontSize:11,color:C.muted,fontWeight:400}}>{improvements.length+"개 TC"}</span>
            </div>
            {improvements.map((item,i)=>(
              <div key={i} style={{background:C.surface2,borderRadius:10,padding:"14px 16px",marginBottom:10,border:"1px solid "+C.border}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                  <span style={{padding:"2px 8px",borderRadius:4,fontSize:10,background:scoreColor(item.score)+"22",color:scoreColor(item.score),fontWeight:700}}>{item.score+"점"}</span>
                  <span style={{fontSize:12,fontWeight:700,color:C.accent2}}>{item.id}</span>
                  <span style={{fontSize:11,color:C.muted}}>{item.issue}</span>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:8,fontSize:11}}>
                  {[["사전조건",item.oldPre,item.newPre],["액션",item.oldAct,item.newAct],["기대결과",item.oldExp,item.newExp]].map(([label,old,nw],j)=>(old||nw)?(
                    <div key={j}>
                      <div style={{color:C.muted,marginBottom:4,fontWeight:600,fontSize:10}}>{label}</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                        <div style={{background:C.bg,borderRadius:6,padding:"8px 10px",borderLeft:"3px solid "+C.red,whiteSpace:"pre-wrap",lineHeight:1.5}}>
                          <div style={{fontSize:9,color:C.red,marginBottom:3}}>{"기존"}</div>{old}
                        </div>
                        <div style={{background:C.bg,borderRadius:6,padding:"8px 10px",borderLeft:"3px solid "+C.green,whiteSpace:"pre-wrap",lineHeight:1.5}}>
                          <div style={{fontSize:9,color:C.green,marginBottom:3}}>{"개선"}</div>{nw}
                        </div>
                      </div>
                    </div>
                  ):null)}
                </div>
              </div>
            ))}
          </div>
        )}
        {newTcs.length>0&&(
          <div style={card}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:16,display:"flex",alignItems:"center",gap:8}}>
              <span style={{padding:"3px 10px",background:C.green+"22",borderRadius:20,fontSize:11,color:C.green}}>{"신규 TC"}</span>
              <span style={{fontSize:11,color:C.muted,fontWeight:400}}>{newTcs.length+"개"}</span>
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead><tr style={{background:C.surface2}}>
                  {["TC ID","플랫폼","사전조건","테스트 항목","테스트 액션","기대 결과","우선순위"].map(h=>(
                    <th key={h} style={{padding:"8px 10px",textAlign:"left",color:C.muted,fontSize:10,borderBottom:"1px solid "+C.border,whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {newTcs.map((tc,i)=>{
                    const pc=tc.priority==="High"?C.red:tc.priority==="Medium"?C.yellow:C.green;
                    return (
                      <tr key={i} style={{borderBottom:"1px solid "+C.border+"33"}}>
                        <td style={{padding:"9px 10px",fontSize:10,color:C.accent2,whiteSpace:"nowrap"}}>{tc.id}</td>
                        <td style={{padding:"9px 10px"}}><span style={{background:C.accent+"22",color:C.accent2,borderRadius:4,padding:"2px 6px",fontSize:10}}>{tc.platform}</span></td>
                        <td style={{padding:"9px 10px",maxWidth:140,whiteSpace:"pre-wrap",verticalAlign:"top"}}>{tc.precondition}</td>
                        <td style={{padding:"9px 10px",maxWidth:150,verticalAlign:"top"}}>{tc.feature}</td>
                        <td style={{padding:"9px 10px",maxWidth:170,whiteSpace:"pre-wrap",verticalAlign:"top"}}>{tc.action}</td>
                        <td style={{padding:"9px 10px",maxWidth:150,whiteSpace:"pre-wrap",verticalAlign:"top"}}>{tc.expected}</td>
                        <td style={{padding:"9px 10px"}}><span style={{padding:"2px 8px",borderRadius:4,fontSize:10,background:pc+"22",color:pc}}>{tc.priority}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (analysis) return (
    <div style={{background:C.bg,minHeight:"100vh",fontFamily:"system-ui,sans-serif",color:C.text,padding:"32px 20px 80px",maxWidth:900,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24,flexWrap:"wrap"}}>
        <div>
          <div style={{fontSize:16,fontWeight:700}}>{"🔍 TC 분석 완료"}</div>
          <div style={{fontSize:12,color:C.muted,marginTop:2}}>{"누락/부족 항목 · "+analysis.reduce((a,s)=>a+s.items.length,0)+"개 발견"}</div>
        </div>
        <button style={{marginLeft:"auto",padding:"8px 16px",background:"transparent",border:"1px solid "+C.border,borderRadius:7,color:C.muted,fontSize:12,cursor:"pointer"}} onClick={()=>setAnalysis(null)}>{"↩ 돌아가기"}</button>
      </div>
      {analysis.map((section,si)=>(
        <div key={si} style={card}>
          <div style={{fontSize:13,fontWeight:700,color:C.accent2,marginBottom:14,display:"flex",alignItems:"center",gap:8}}>
            <span style={{padding:"3px 10px",background:C.accent+"22",borderRadius:20,fontSize:11}}>{section.title}</span>
            <span style={{fontSize:11,color:C.muted,fontWeight:400}}>{section.items.length+"개 항목"}</span>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {section.items.map((item,ii)=>{
              const pc=item.priority==="High"?C.red:item.priority==="Medium"?C.yellow:C.green;
              return (
                <div key={ii} style={{background:C.surface2,borderRadius:10,padding:"14px 16px",border:"1px solid "+C.border}}>
                  <div style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:6}}>
                    <span style={{padding:"2px 8px",borderRadius:4,fontSize:10,background:pc+"22",color:pc,whiteSpace:"nowrap",flexShrink:0}}>{item.priority}</span>
                    <div style={{fontSize:13,fontWeight:600,color:C.text}}>{item.item}</div>
                  </div>
                  {item.reason&&<div style={{fontSize:11,color:C.muted,marginBottom:8}}>{"💬 "+item.reason}</div>}
                  {item.suggest&&(
                    <div style={{background:C.bg,borderRadius:8,padding:"10px 12px",fontSize:11,color:C.text,borderLeft:"3px solid "+C.accent}}>
                      <div style={{color:C.accent2,fontWeight:600,marginBottom:4,fontSize:10}}>{"제안 액션"}</div>
                      <div style={{whiteSpace:"pre-wrap",lineHeight:1.6}}>{item.suggest}</div>
                      {item.expected&&<div style={{marginTop:6,color:C.green}}>{"→ "+item.expected}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  if (results) return (
    <div style={{background:C.bg,minHeight:"100vh",fontFamily:"system-ui,sans-serif",color:C.text,padding:"32px 20px 80px",maxWidth:960,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24,flexWrap:"wrap"}}>
        <div>
          <div style={{fontSize:16,fontWeight:700}}>{"✅ TC 생성 완료"}</div>
          <div style={{fontSize:12,color:C.muted,marginTop:2}}>{results.length}{"개 시트 · "}{results.reduce((a,r)=>a+r.tcs.length,0)}{"개 TC"}</div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
          <button style={{padding:"8px 16px",background:"transparent",border:"1px solid "+C.border,borderRadius:7,color:C.muted,fontSize:12,cursor:"pointer"}} onClick={()=>setResults(null)}>{"↩ 다시 만들기"}</button>
          <button style={{padding:"9px 18px",background:C.green,border:"none",borderRadius:7,color:"#000",fontSize:13,fontWeight:700,cursor:"pointer"}} onClick={downloadExcel}>{"⬇ 엑셀 다운로드"}</button>
        </div>
      </div>
      {results.map(sheet=>(
        <div key={sheet.sheetName} style={card}>
          <div style={{fontSize:12,color:C.accent2,fontWeight:700,marginBottom:12}}>{"📑 "}{sheet.sheetName}<span style={{color:C.muted,fontWeight:400}}>{" ("+sheet.tcs.length+"개)"}</span></div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{background:C.surface2}}>
                {["TC ID","플랫폼","사전조건","테스트 항목","테스트 액션","기대 결과","우선순위"].map(h=>(
                  <th key={h} style={{padding:"8px 10px",textAlign:"left",color:C.muted,fontSize:10,borderBottom:"1px solid "+C.border,whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {sheet.tcs.map((tc,i)=>{
                  const pc=tc.priority==="High"?C.red:tc.priority==="Medium"?C.yellow:C.green;
                  return (
                    <tr key={i} style={{borderBottom:"1px solid "+C.border+"33"}}>
                      <td style={{padding:"9px 10px",fontSize:10,color:C.accent2,whiteSpace:"nowrap"}}>{tc.id}</td>
                      <td style={{padding:"9px 10px"}}><span style={{background:C.accent+"22",color:C.accent2,borderRadius:4,padding:"2px 6px",fontSize:10}}>{tc.platform}</span></td>
                      <td style={{padding:"9px 10px",maxWidth:150,color:C.text,whiteSpace:"pre-wrap",verticalAlign:"top"}}>{tc.precondition}</td>
                      <td style={{padding:"9px 10px",maxWidth:160,color:C.text,verticalAlign:"top"}}>{tc.feature}</td>
                      <td style={{padding:"9px 10px",maxWidth:180,color:C.text,whiteSpace:"pre-wrap",verticalAlign:"top"}}>{tc.action}</td>
                      <td style={{padding:"9px 10px",maxWidth:160,color:C.text,whiteSpace:"pre-wrap",verticalAlign:"top"}}>{tc.expected}</td>
                      <td style={{padding:"9px 10px"}}><span style={{padding:"2px 8px",borderRadius:4,fontSize:10,background:pc+"22",color:pc}}>{tc.priority}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div style={{background:C.bg,minHeight:"100vh",fontFamily:"system-ui,sans-serif",color:C.text,padding:"32px 20px 80px",maxWidth:900,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:32}}>
        <div style={{width:38,height:38,background:"linear-gradient(135deg,"+C.accent+",#5b4fcf)",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>{"🤖"}</div>
        <div>
          <div style={{fontSize:16,fontWeight:700}}>{"TC Auto Generator"}</div>
          <div style={{fontSize:11,color:C.muted}}>{"LiveAnywhere QA · Powered by Claude"}</div>
        </div>
      </div>

      <div style={card}>
        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:16}}><span>{"📋"}</span><span style={{fontSize:13,fontWeight:600}}>{"프로젝트 정보"}</span></div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:12,marginBottom:12}}>
          <div><label style={lbl}>{"TC ID 접두사"}</label><input style={inp} value={tcPrefix} onChange={e=>setTcPrefix(e.target.value)} placeholder="예: GM_KG"/></div>
          <div><label style={lbl}>{"Wiki / 기획 링크 (선택)"}</label><input style={inp} value={wikiLink} onChange={e=>setWikiLink(e.target.value)} placeholder="https://..."/></div>
        </div>
        <div>
          <label style={lbl}>{"Claude API Key"}</label>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input style={{...inp,flex:1}} type="password" value={geminiKey} onChange={e=>{setGeminiKey(e.target.value);}} placeholder="sk-ant-... (console.anthropic.com에서 발급)"/>
            {geminiKey&&<span style={{fontSize:11,color:C.green,whiteSpace:"nowrap"}}>{"✓ 입력됨"}</span>}
          </div>
          <div style={{fontSize:11,color:C.muted,marginTop:4}}>{"Claude Sonnet · console.anthropic.com에서 API 키 발급"}</div>
        </div>
        <div>
          <label style={lbl}>{"Figma Access Token (선택 · 피그마만 있을 때 입력)"}</label>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input style={{...inp,flex:1}} type="password" value={figmaToken} onChange={e=>{setFigmaToken(e.target.value);}} placeholder="figd_xxxx... (Figma → 설정 → Personal access tokens)"/>
            {figmaToken&&<span style={{fontSize:11,color:C.green,whiteSpace:"nowrap"}}>{"✓ 연결됨"}</span>}
          </div>
          <div style={{fontSize:11,color:C.muted,marginTop:4}}>{"PDF 없이 피그마 링크만 입력하면 피그마 화면을 직접 읽어서 TC를 생성해요"}</div>
        </div>
      </div>

      <div style={card}>
        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:12}}><span>{"🎯"}</span><span style={{fontSize:13,fontWeight:600}}>{"중점 테스트 항목 (선택)"}</span></div>
        <textarea style={{width:"100%",background:C.bg,border:"1px solid "+C.border,borderRadius:8,color:C.text,fontSize:13,padding:"9px 12px",outline:"none",resize:"vertical",minHeight:72,boxSizing:"border-box",lineHeight:1.6,fontFamily:"inherit"}} value={focusNote} onChange={e=>setFocusNote(e.target.value)} placeholder={"예시: 링크페이 생성/만료 플로우 위주로\n예시: 게스트 결제 수단 선택 화면 집중\n예시: 집 등록 필수 입력값 검증 위주로"}/>
        <div style={{fontSize:11,color:C.muted,marginTop:5}}>{"입력하면 해당 항목을 최우선으로 TC를 집중 생성해요"}</div>
      </div>

      <div style={card}>
        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:16}}><span>{"⚙️"}</span><span style={{fontSize:13,fontWeight:600}}>{"테스트 옵션"}</span></div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <div>
            <label style={lbl}>{"테스트 플랫폼"}</label>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:4}}>
              {["PC","APP","MO"].map(p=>(
                <button key={p} style={{padding:"5px 12px",borderRadius:20,border:"1px solid "+(platforms.has(p)?C.accent:C.border),background:platforms.has(p)?"rgba(124,106,247,0.15)":"transparent",color:platforms.has(p)?C.accent2:C.muted,fontSize:11,cursor:"pointer"}}
                  onClick={()=>{const nx=new Set(platforms);nx.has(p)?nx.delete(p):nx.add(p);setPlatforms(nx);}}>
                  {p==="MO"?"MO WEB":p==="PC"?"PC WEB":"APP"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={lbl}>{"기본 우선순위"}</label>
            <div style={{display:"flex",gap:6,marginTop:4}}>
              {["High","Medium","Low"].map(p=>{
                const c=p==="High"?C.red:p==="Medium"?C.yellow:C.green; const on=priority===p;
                return <button key={p} style={{flex:1,padding:"7px 0",borderRadius:7,border:"1px solid "+(on?c:C.border),background:on?c+"22":"transparent",color:on?c:C.muted,fontSize:12,cursor:"pointer"}} onClick={()=>setPriority(p)}>{p==="High"?"🔴 High":p==="Medium"?"🟡 Medium":"🟢 Low"}</button>;
              })}
            </div>
          </div>
        </div>
      </div>

      <div style={card}>
        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4}}><span>{"📑"}</span><span style={{fontSize:13,fontWeight:600}}>{"TC 시트 구성"}</span><span style={{fontSize:11,color:C.muted}}>{"기능/화면 단위로 추가 · 탭 더블클릭으로 이름 변경"}</span></div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",margin:"16px 0",alignItems:"center"}}>
          {sheets.map(sh=>(
            <div key={sh.id} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:7,border:"1px solid "+(sh.id===activeId?C.accent:C.border),background:sh.id===activeId?"rgba(124,106,247,0.15)":"transparent",color:sh.id===activeId?C.accent2:C.muted,fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}}
              onClick={()=>{if(editTab!==sh.id)setActiveId(sh.id);}}>
              {editTab===sh.id?(
                <input autoFocus value={editVal} style={{background:"transparent",border:"none",outline:"none",color:C.accent2,fontSize:11,width:90}}
                  onClick={e=>e.stopPropagation()}
                  onChange={e=>setEditVal(e.target.value)}
                  onBlur={()=>{upd(sh.id,{name:editVal||sh.name});setEditTab(null);}}
                  onKeyDown={e=>{if(e.key==="Enter"||e.key==="Escape"){upd(sh.id,{name:editVal||sh.name});setEditTab(null);}}}
                />
              ):(
                <span onDoubleClick={e=>{e.stopPropagation();setEditTab(sh.id);setEditVal(sh.name);}} style={{cursor:"text"}}>{sh.name}{" ✎"}</span>
              )}
              {sheets.length>1&&<span onClick={e=>{e.stopPropagation();removeSheet(sh.id);}} style={{opacity:0.5,fontSize:11,marginLeft:2}}>{"✕"}</span>}
            </div>
          ))}
          <button style={{padding:"5px 12px",background:"transparent",border:"1px dashed "+C.border,borderRadius:7,color:C.muted,fontSize:11,cursor:"pointer"}} onClick={addSheet}>{"+ 시트 추가"}</button>
          <button style={{marginLeft:"auto",padding:"5px 12px",background:"transparent",border:"1px solid rgba(248,113,113,0.3)",borderRadius:7,color:C.red,fontSize:11,cursor:"pointer"}} onClick={()=>{if(window.confirm("모든 시트와 입력값을 초기화할까요?"))resetAll();}}>{"🔄 초기화"}</button>
        </div>
        {active&&(
          <div>
            <div style={{marginBottom:16}}>
              <label style={lbl}>{"피그마 링크 (선택)"}</label>
              <div style={{display:"flex",flexDirection:"column",gap:7}}>
                {active.figmaUrls.map((url,i)=>(
                  <div key={i} style={{display:"flex",gap:7,alignItems:"center"}}>
                    <input style={{...inp,flex:1}} value={url} placeholder="https://www.figma.com/file/..." onChange={e=>setFigma(active.id,i,e.target.value)}/>
                    {active.figmaUrls.length>1&&<button onClick={()=>delFigma(active.id,i)} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:15}}>{"✕"}</button>}
                  </div>
                ))}
              </div>
              <button style={{padding:"5px 10px",background:"transparent",border:"1px dashed "+C.border,borderRadius:6,color:C.muted,fontSize:11,cursor:"pointer",marginTop:7}} onClick={()=>addFigma(active.id)}>{"+ 링크 추가"}</button>
            </div>
            <div style={{marginBottom:16}}>
              <label style={lbl}>{"기획 문서 (PDF · 선택)"}</label>
              <PdfUpload sid={active.id} pdf={active.pdf} name={active.pdfName} onFile={onPdf} onRemove={rmPdf}/>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,margin:"16px 0",color:C.muted,fontSize:11}}>
              <div style={{flex:1,height:1,background:C.border}}/>{" 또는 텍스트로 직접 입력 "}<div style={{flex:1,height:1,background:C.border}}/>
            </div>
            <div>
              <label style={lbl}>{"기획 내용 직접 입력 (선택)"}</label>
              <textarea style={{width:"100%",background:C.bg,border:"1px solid "+C.border,borderRadius:8,color:C.text,fontSize:13,padding:"9px 12px",outline:"none",resize:"vertical",minHeight:120,boxSizing:"border-box",lineHeight:1.6}} value={active.spec} placeholder="기획 내용을 붙여넣으세요..." onChange={e=>upd(active.id,{spec:e.target.value})}/>
              <div style={{fontSize:11,color:C.muted,marginTop:5}}>{"피그마 / PDF / 텍스트 중 하나 이상 입력하면 TC를 생성해요"}</div>
            </div>
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:12}}><span>{"🔍"}</span><span style={{fontSize:13,fontWeight:600}}>{"기존 TC 분석 (선택)"}</span><span style={{fontSize:11,color:C.muted}}>{"기존 TC 파일을 업로드하면 분석해줍니다"}</span></div>
        {existingTC ? (
          <div style={{display:"flex",alignItems:"center",gap:12,background:C.accent+"18",border:"1px solid "+C.accent+"44",borderRadius:10,padding:"12px 16px",marginBottom:12}}>
            <div style={{width:34,height:34,background:C.accent+"22",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>{"📊"}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:600,color:C.accent2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{existingTCName}</div>
              <div style={{fontSize:11,color:C.muted}}>{"기존 TC 첨부됨"}</div>
            </div>
            <button onClick={()=>{setExistingTC(null);setExistingTCName("");}} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:16}}>{"✕"}</button>
          </div>
        ) : (
          <label style={{display:"block",border:"2px dashed "+C.border,borderRadius:10,padding:"20px 16px",textAlign:"center",background:C.bg,cursor:"pointer",marginBottom:12}}>
            <input type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={e=>handleExistingTC(e.target.files[0])}/>
            <div style={{fontSize:22,marginBottom:6}}>{"📊"}</div>
            <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:3}}>{"기존 TC 엑셀 파일 업로드"}</div>
            <div style={{fontSize:11,color:C.muted}}>{"기획서와 비교하여 누락 항목 분석 또는 품질 개선 제안 (.xlsx)"}</div>
          </label>
        )}
        <div style={{display:"flex",gap:8}}>
          <button style={{flex:1,padding:"11px 0",background:existingTC?"rgba(124,106,247,0.15)":"rgba(42,42,56,0.5)",border:"1px solid "+(existingTC?C.accent:C.border),borderRadius:8,color:existingTC?C.accent2:C.muted,fontSize:13,fontWeight:600,cursor:existingTC?"pointer":"not-allowed"}} onClick={existingTC?analyzeTC:undefined} disabled={!existingTC}>
            {"🔍 누락 TC 분석"}
          </button>
          <button style={{flex:1,padding:"11px 0",background:existingTC?"rgba(34,211,160,0.15)":"rgba(42,42,56,0.5)",border:"1px solid "+(existingTC?C.green:C.border),borderRadius:8,color:existingTC?C.green:C.muted,fontSize:13,fontWeight:600,cursor:existingTC?"pointer":"not-allowed"}} onClick={existingTC?enhancedAnalyze:undefined} disabled={!existingTC}>
            {"✨ TC 품질 개선 분석"}
          </button>
        </div>
      </div>

      {error&&<div style={{background:"rgba(248,113,113,0.08)",border:"1px solid rgba(248,113,113,0.3)",borderRadius:10,padding:"12px 16px",fontSize:12,color:C.red,marginBottom:12}}>{"⚠️ "}{error}</div>}
      <button style={{width:"100%",padding:"14px 0",background:"linear-gradient(135deg,"+C.accent+",#5b4fcf)",border:"none",borderRadius:10,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",marginTop:6}} onClick={generate}>{"🚀 AI로 테스트 케이스 생성하기"}</button>
    </div>
  );
}
