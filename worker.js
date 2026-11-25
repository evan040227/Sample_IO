const BASE = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
let py;
let chain = Promise.resolve();
async function handle({id,type,payload}) {
  try {
    let result;
    if(type==='init') {
      postMessage({type:'status',text:'Python 실행 환경 준비 중…'});
      importScripts(BASE+'pyodide.js');
      py=await loadPyodide({indexURL:BASE});
      await py.loadPackage(['numpy','micropip']);
      await py.runPythonAsync("import micropip; await micropip.install('openpyxl==3.1.5')");
      const response=await fetch('./model.py');
      if(!response.ok) throw Error('model.py를 불러올 수 없습니다.');
      await py.runPythonAsync(await response.text());
      postMessage({type:'status',text:'Excel 읽기와 계수 검증 중…'});
      py.globals.set('raw_input',new Uint8Array(payload));
      await py.runPythonAsync('raw_bytes = raw_input.to_py()');
      result=await py.runPythonAsync('initialize(raw_bytes)');
      await py.runPythonAsync('del raw_input, raw_bytes');
    } else if(type==='explore') {
      py.globals.set('sheet_input',payload.sheet);
      py.globals.set('row_input',payload.row);
      result=await py.runPythonAsync('explore(sheet_input,row_input)');
    } else if(type==='simulate') {
      py.globals.set('scenario_input',JSON.stringify(payload));
      result=await py.runPythonAsync('simulate(scenario_input)');
    } else if(type==='employment') {
      py.globals.set('employment_input',JSON.stringify(payload));
      result=await py.runPythonAsync('set_employment(employment_input)');
    } else if(type==='ai_analyze') {
      py.globals.set('ai_input',JSON.stringify(payload));
      result=await py.runPythonAsync('ai_analyze(ai_input)');
    } else {
      throw Error('알 수 없는 작업입니다: '+type);
    }
    postMessage({id,ok:true,result:JSON.parse(result)});
  } catch(error) { postMessage({id,ok:false,error:String(error)}); }
}
onmessage=e=>{chain=chain.then(()=>handle(e.data));};
