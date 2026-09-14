export function studioProgress(status:string, progress:number|null|undefined, uploading:number|null = null, hasCandidates=false) {
  const measured=typeof progress==='number'&&Number.isFinite(progress)?Math.min(100,Math.max(0,Math.round(progress))):null;
  if(status==='UPLOADING')return {value:uploading,estimated:false,label:'Загрузка видео'};
  if(status==='FAILED')return {value:null,estimated:false,label:'Обработка остановлена'};
  if(['READY','AWAITING_APPROVAL','APPROVED','ADDING_AD','COMPLETED'].includes(status))return {value:100,estimated:false,label:status==='READY'?(hasCandidates?'Анализ завершён':'Видео подготовлено'):status==='COMPLETED'?'Экспорт завершён':'Ролик готов'};
  const phase = status==='PREPROCESSING'?1:status==='TRANSCRIBING'?2:status==='ANALYZING'?(hasCandidates?4:3):null;
  if(phase!==null)return {value:Math.min(99,Math.round((phase+(measured??0)/100)*20)),estimated:true,label:'Подготовка к монтажу · оценка по этапам'};
  if(measured!==null)return {value:measured,estimated:false,label:'Прогресс текущего этапа'};
  return {value:null,estimated:false,label:'Выполняется обработка'};
}
