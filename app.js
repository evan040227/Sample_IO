const $=id=>document.getElementById(id);
// 화면 표시 단위: 억원. 계산 엔진과 원자료 단위는 백만원이므로 경계에서만 변환합니다.
const fmt=x=>Number(x).toLocaleString('ko-KR',{maximumFractionDigits:2});
const fmtWon=x=>fmt(Number(x)/100);
const toBaekman=x=>Number(x)*100;
let worker,nextId=0,requests=new Map(),sectors=[],rowChoices=[],cells=[],basket=[],result=null,aiResult=null;
function text(tag,value){const e=document.createElement(tag);e.textContent=value;return e;}
function call(type,payload){return new Promise((resolve,reject)=>{const id=++nextId;requests.set(id,{resolve,reject});worker.postMessage({id,type,payload});});}
function startWorker(){worker=new Worker('./worker.js');worker.onmessage=({data:d})=>{if(d.type==='status'){$('status').textContent=d.text;return;}const p=requests.get(d.id);if(!p)return;requests.delete(d.id);d.ok?p.resolve(d.result):p.reject(Error(d.error));};worker.onerror=e=>{for(const p of requests.values())p.reject(Error(e.message||'Worker 실행 오류'));requests.clear();};}
function options(el,list){el.replaceChildren(...list.map(x=>{const o=document.createElement('option');o.value=x.code;o.textContent=x.code+' '+x.name;return o;}));}
function invalidate(){result=null;aiResult=null;$('results').hidden=true;$('ai-results').hidden=true;}
async function load(buffer){
 invalidate();basket=[];renderBasket();
 for(const id of ['sheet','row','sector','add','run','row-search','col-search','sector-search','amount','ai-run'])$(id).disabled=true;
 if(worker)worker.terminate();for(const p of requests.values())p.reject(Error('데이터 다시 로드'));requests.clear();startWorker();
 try{
  const info=await call('init',buffer);sectors=info.sectors;options($('sector'),sectors);
  $('sector-search').value='';$('row-search').value='';$('col-search').value='';
  $('sheet').replaceChildren(...info.sheets.map(s=>{const o=text('option',s);o.value=s;return o;}));
  $('validation').textContent=JSON.stringify(info.residuals,null,2)+'\n최대 절대 잔차: 허용값 1e-8 미만';
  for(const id of ['sheet','row','sector','add','run','row-search','col-search','sector-search','amount','ai-run'])$(id).disabled=false;
  await explore();$('status').textContent='준비 완료 · '+sectors.length+'개 부문 · '+info.sheets.length+'개 시트 · 계수 검증 통과';
 }catch(e){$('status').textContent='준비 실패: '+e.message+' — 새로고침 후 재시도하세요.';}
}
let exploreSeq=0;
async function explore(){const seq=++exploreSeq;try{const d=await call('explore',{sheet:$('sheet').value,row:$('row').value});if(seq!==exploreSeq)return;rowChoices=d.rows;filterRows(d.selected);cells=d.cells;$('unit').textContent=d.unit;$('explore-caption').textContent=$('sheet').value+' / 행: '+d.selected+' '+d.name;renderCells();}catch(e){$('status').textContent=e.message;}}
function filterRows(selected){const q=$('row-search').value.trim();options($('row'),rowChoices.filter(r=>(r.code+' '+r.name).includes(q)));if([...$('row').options].some(o=>o.value===selected))$('row').value=selected;}
function renderCells(){const q=$('col-search').value.trim();$('cells').replaceChildren(...cells.filter(c=>(c.code+' '+c.name).includes(q)).map(c=>{const tr=document.createElement('tr');for(const v of [c.code,c.name,c.value===null?'빈 셀':typeof c.value==='number'?fmt(c.value):c.value])tr.append(text('td',v));return tr;}));}
$('sheet').onchange=()=>{$('row-search').value='';$('row').replaceChildren();explore();};$('row').onchange=explore;
$('row-search').oninput=()=>{filterRows();if($('row').value)explore();else{$('cells').replaceChildren();$('explore-caption').textContent='일치하는 행이 없습니다.';}};
$('col-search').oninput=renderCells;
$('sector-search').oninput=()=>{const q=$('sector-search').value.trim();options($('sector'),sectors.filter(s=>(s.code+' '+s.name).includes(q)));};
function renderBasket(){$('basket').replaceChildren(...basket.map((s,i)=>{const li=text('li',s.code+' '+s.name+' / '+fmtWon(s.amount)+'억원 ');const b=text('button','삭제');b.type='button';b.onclick=()=>{basket.splice(i,1);invalidate();renderBasket();};li.append(b);return li;}));$('sim-status').textContent=basket.length?basket.length+'개 입력 준비. 계산 버튼을 누르세요.':'시나리오를 추가하세요.';}
$('scenario').onsubmit=e=>{e.preventDefault();const amount=toBaekman($('amount').value),s=sectors.find(s=>s.code===$('sector').value);if(!s||!Number.isFinite(amount)||amount<=0){$('sim-status').textContent='산업과 양의 증가액을 확인하세요.';return;}basket.push({...s,amount});invalidate();renderBasket();};
$('clear').onclick=()=>{basket=[];invalidate();renderBasket();};
$('run').onclick=async()=>{if(!basket.length){$('sim-status').textContent='시나리오를 먼저 추가하세요.';return;}const snapshot=basket.map(s=>({...s}));$('run').disabled=true;$('sim-status').textContent='계산 중…';try{const r=await call('simulate',snapshot);if(JSON.stringify(snapshot)!==JSON.stringify(basket)){$('sim-status').textContent='입력이 변경되었습니다. 다시 계산하세요.';return;}result=r;renderResult();$('sim-status').textContent='계산 완료. 아래 결과는 현재 시나리오에 대응합니다.';}catch(e){invalidate();$('sim-status').textContent='계산 실패: '+e.message;}finally{$('run').disabled=false;}};
function renderResult(){$('results').hidden=false;$('cards').replaceChildren(...[['수요 증가액',result.demand],['생산유발액',result.production],['수입유발액',result.imports],['부가가치유발액',result.valueAdded]].map(([title,v])=>{const d=text('div',title);d.className='card';d.append(text('strong',fmtWon(v)),text('span','억원'));return d;}));const max=Math.max(...result.rows.map(r=>r.production),1);$('bars').replaceChildren(...result.rows.slice(0,15).map(r=>{const d=text('div',r.name+' · '+fmtWon(r.production)+'억원');d.className='bar';const t=document.createElement('div');t.className='track';const f=document.createElement('div');f.className='fill';f.style.width=Math.max(0,r.production/max*100)+'%';t.append(f);d.append(t);return d;}));$('result-rows').replaceChildren(...result.rows.map(r=>{const tr=document.createElement('tr');[r.code,r.name,fmtWon(r.production),fmtWon(r.imports),fmtWon(r.valueAdded)].forEach(v=>tr.append(text('td',v)));return tr;}));}
function csvCell(v){let s=String(v);if(/^[=+@-]/.test(s)&&typeof v!=='number')s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
function downloadCSV(filename,rows){const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('download').onclick=()=>{if(!result)return;downloadCSV('io-2023-results.csv',[['산업코드','산업명','생산유발액_억원','수입유발액_억원','부가가치유발액_억원'],...result.rows.map(r=>[r.code,r.name,r.production/100,r.imports/100,r.valueAdded/100])]);};

function renderAI(){
 $('ai-results').hidden=false;
 const cards=[['AI 수요 증가액',aiResult.demand,'억원'],['생산유발액',aiResult.production,'억원'],['수입유발액',aiResult.imports,'억원'],['부가가치유발액',aiResult.valueAdded,'억원'],['취업유발인원',aiResult.employment,'명']];
 $('ai-cards').replaceChildren(...cards.map(([label,value,unit])=>{const d=text('div',label);d.className='card';d.append(text('strong',unit==='억원'?fmtWon(value):fmt(value)),text('span',unit));return d;}));
 $('ai-groups').replaceChildren(...aiResult.groups.map(g=>{const tr=document.createElement('tr');[g.label,g.employmentOfficialSector,fmt(g.employmentCoefficient),fmtWon(g.demand),fmt(g.employment)].forEach(v=>tr.append(text('td',v)));return tr;}));
 const top=aiResult.rows.slice(0,15),max=Math.max(...top.map(r=>r.production),1);
 $('ai-bars').replaceChildren(...top.map(r=>{const d=text('div',r.code+' '+r.name+' · '+fmtWon(r.production)+'억원');d.className='bar';const track=document.createElement('div');track.className='track';const fill=document.createElement('div');fill.className='fill';fill.style.width=Math.max(0,r.production/max*100)+'%';track.append(fill);d.append(track);return d;}));
 $('ai-rows').replaceChildren(...aiResult.rows.map(r=>{const tr=document.createElement('tr');[r.code,r.name,fmtWon(r.production),fmtWon(r.imports),fmtWon(r.valueAdded)].forEach(v=>tr.append(text('td',v)));return tr;}));
 $('ai-employment-note').textContent='취업유발인원은 한국은행 2023년 취업유발계수(명/10억원)를 AI 대리산업의 최종수요에 적용한 추정치입니다. 공식 계수는 통합부문 기준이므로 380개 기본부문별 취업유발인원으로 세분하지 않습니다.';
}
$('ai-run').onclick=async()=>{
 const payload={semiconductor:toBaekman($('ai-semiconductor').value),software:toBaekman($('ai-software').value),datacenter:toBaekman($('ai-datacenter').value)};
 if(Object.values(payload).some(v=>!Number.isFinite(v)||v<0)||Object.values(payload).reduce((a,b)=>a+b,0)<=0){$('ai-status').textContent='각 수요액은 0 이상이어야 하며 합계는 0보다 커야 합니다.';return;}
 $('ai-run').disabled=true;$('ai-status').textContent='AI 산업 파급효과 계산 중…';
 try{aiResult=await call('ai_analyze',payload);renderAI();$('ai-status').textContent='분석 완료 · 총 수요 '+fmtWon(aiResult.demand)+'억원';}
 catch(e){$('ai-status').textContent='분석 실패: '+e.message;}
 finally{$('ai-run').disabled=false;}
};
$('download-ai').onclick=()=>{
 if(!aiResult)return;
 const rows=[
  ['구분','산업코드','산업명/공식 통합부문','수요 증가액_억원','생산유발액_억원','수입유발액_억원','부가가치유발액_억원','취업유발계수_명_10억원','취업유발인원_명'],
  ...aiResult.groups.map(g=>['AI 산업군','',g.label+' / '+g.employmentOfficialSector,g.demand/100,g.production/100,'',g.valueAdded/100,g.employmentCoefficient,g.employment]),
  ['합계','','AI 산업 전체',aiResult.demand/100,aiResult.production/100,aiResult.imports/100,aiResult.valueAdded/100,'',aiResult.employment],
  [],
  ['세부 기본부문 산업별 유발액','','','','','','','',''],
  ...aiResult.rows.map(r=>['기본부문',r.code,r.name,'',r.production/100,r.imports/100,r.valueAdded/100,'',''])
 ];
 downloadCSV('ai-industry-impact-2023.csv',rows);
};
async function loadDefaultWorkbook(){
 try{$('status').textContent='기본 Excel 내려받는 중…';const response=await fetch('./data/io-2023.xlsx');if(!response.ok)throw Error('기본 Excel 다운로드 실패 (HTTP '+response.status+')');await load(await response.arrayBuffer());}
 catch(error){$('status').textContent='준비 실패: '+error.message+' — 연결 상태를 확인하고 새로고침하세요.';}
}
$('load-basic').onclick=async()=>{
 const button=$('load-basic');button.disabled=true;button.textContent='불러오는 중…';
 try{await loadDefaultWorkbook();const ready=!$('sheet').disabled;button.textContent=ready?'기본부문 불러오기 완료':'기본부문 다시 불러오기';button.disabled=ready;}
 finally{if($('sheet').disabled){button.disabled=false;button.textContent='기본부문 다시 불러오기';}}
};
