import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { request, uploadFile, waitForJob } from './api';
import { validateVideo, formatTime } from './model';
import type { Job, Navigate, Notify, Project } from './model';
import Steps from './Steps';

type Phase = 'idle' | 'uploading' | 'preparing' | 'ready' | 'analyzing' | 'complete' | 'cancelled' | 'error';
export default function Upload({ navigate, notify, onProjectChange }: { navigate: Navigate; notify: Notify; onProjectChange: () => void }) {
  const [tab, setTab] = useState<'file' | 'link'>('file');
  const [phase, setPhase] = useState<Phase>('idle');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [source, setSource] = useState('');
  const [project, setProject] = useState<Project | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const activeJob = useRef<string | null>(null);
  const busy = ['uploading', 'preparing', 'analyzing'].includes(phase);
  useEffect(() => () => controller.current?.abort(), []);

  function handleError(problem: unknown) {
    if (problem instanceof DOMException && problem.name === 'AbortError') return;
    setError(problem instanceof Error ? problem.message : 'Не удалось обработать видео. Повторите попытку.');
    setPhase('error');
  }
  async function track(job: Job, signal: AbortSignal, analysis = false) {
    activeJob.current = job.id;
    const result = await waitForJob(job.id, (value) => { setProgress(value.progress); setMessage(value.message); }, signal);
    const projectId = result.projectId ?? project?.id;
    if (!projectId) throw new Error('Обработка завершена, но проект не найден.');
    const response = await request<{ project: Project }>(`/api/projects/${projectId}`, { signal });
    setProject(response.project); setProgress(100); setPhase(analysis ? 'complete' : 'ready');
    activeJob.current = null; onProjectChange();
  }
  async function selectFile(file?: File) {
    if (!file || busy) return;
    const validation = validateVideo(file);
    if (validation) { setError(validation); return; }
    controller.current?.abort();
    const operation = new AbortController(); controller.current = operation;
    setError(''); setProject(null); setFileName(file.name); setFileSize(file.size); setProgress(0);
    setPhase('uploading'); setMessage('Загрузка на этот компьютер');
    try {
      const job = await uploadFile(file, setProgress, operation.signal);
      setPhase('preparing'); setProgress(0); setMessage('Подготовка видео для браузера');
      await track(job, operation.signal);
    } catch (problem) { handleError(problem); }
  }
  async function importLink() {
    if (busy) return;
    try { const url = new URL(source); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); }
    catch { setError('Введите полную ссылку, начинающуюся с https:// или http://'); return; }
    controller.current?.abort();
    const operation = new AbortController(); controller.current = operation;
    setError(''); setProject(null); setFileName('Видео по ссылке'); setFileSize(0); setProgress(0);
    setPhase('preparing'); setMessage('Подключение к источнику');
    try {
      const { job } = await request<{ job: Job }>('/api/import', { method: 'POST', body: JSON.stringify({ url: source.trim() }), signal: operation.signal });
      await track(job, operation.signal);
    } catch (problem) { handleError(problem); }
  }
  async function analyze() {
    if (!project || busy) return;
    const operation = new AbortController(); controller.current = operation;
    setError(''); setPhase('analyzing'); setProgress(0); setMessage('Поиск смены сцен');
    try {
      const { job } = await request<{ job: Job }>(`/api/projects/${project.id}/analyze`, { method: 'POST', signal: operation.signal });
      await track(job, operation.signal, true);
      notify('Сцены найдены. Видео готово к монтажу.');
    } catch (problem) { handleError(problem); }
  }
  async function cancel() {
    controller.current?.abort();
    const id = activeJob.current; activeJob.current = null;
    setPhase('cancelled'); setMessage('Операция отменена'); setError('');
    if (id) try { await request(`/api/jobs/${id}/cancel`, { method: 'POST' }); } catch (problem) { setError(problem instanceof Error ? problem.message : 'Не удалось отменить обработку.'); }
  }
  return <>
    <div className="page-intro"><h1>Добавьте видео для нарезки</h1><p>Загрузите файл или импортируйте видео по ссылке</p></div>
    <Steps labels={['Загрузка', 'Анализ сцен', 'Подготовка клипов']} active={phase === 'complete' ? 2 : phase === 'analyzing' ? 1 : 0} />
    <div className="upload-layout"><section className="upload-panel panel" aria-label="Загрузка видео">
      <div className="upload-tabs" role="tablist" aria-label="Источник видео">{(['file', 'link'] as const).map((value) => <button key={value} role="tab" id={`tab-${value}`} aria-controls={`panel-${value}`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} disabled={busy} className={tab === value ? 'selected' : ''} onClick={() => { setTab(value); setError(''); }} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { const next = tab === 'file' ? 'link' : 'file'; setTab(next); document.getElementById(`tab-${next}`)?.focus(); } }}><Icon name={value === 'file' ? 'upload' : 'link'} />{value === 'file' ? 'Файл с устройства' : 'Ссылка на источник'}</button>)}</div>
      {tab === 'file' ? <div id="panel-file" role="tabpanel" aria-labelledby="tab-file"><div className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void selectFile(event.dataTransfer.files[0]); }}><div className="upload-symbol"><Icon name="upload" size={37} /></div><h2>Перетащите видео сюда</h2><p>или выберите файл на устройстве</p><button className="button outline" disabled={busy} onClick={() => fileInput.current?.click()}>Выбрать файл</button><input ref={fileInput} type="file" accept="video/*,.mp4,.mov,.webm,.mkv,.m4v" hidden onChange={(event) => { void selectFile(event.target.files?.[0]); event.target.value = ''; }} /><small>MP4, MOV, WebM, MKV · до 2 ГБ · локальное хранение</small></div></div> : <form id="panel-link" className="source-panel" role="tabpanel" aria-labelledby="tab-link" onSubmit={(event) => { event.preventDefault(); void importLink(); }}><Icon name="link" size={35} /><h2>Импорт по ссылке</h2><p>Прямая ссылка на видео или открытая страница поддерживаемой площадки.</p><label htmlFor="source-url">Адрес видео</label><div className="source-input-row"><input id="source-url" type="url" placeholder="https://example.com/video.mp4" value={source} disabled={busy} onChange={(event) => setSource(event.target.value)} required /><button className="button outline" type="submit" disabled={busy || !source.trim()}>Загрузить по ссылке</button></div><small>Приватные записи, платный доступ и защищённые плееры не поддерживаются.</small></form>}
      {error && <p className="field-error" role="alert">{error}</p>}
      {(fileName || project) && <div className="upload-file real-upload-file">{project ? <video src={project.video} poster={project.image} controls preload="metadata" playsInline aria-label="Загруженное видео" /> : <div className="upload-file-placeholder"><Icon name="film" size={35} /></div>}<div className="upload-file-info"><div className="file-title"><h3>{project?.title ?? fileName}</h3><span className="badge">{project ? 'Сохранено на диске' : phase === 'uploading' ? 'Загрузка' : 'Обработка'}</span></div><div className="upload-status"><span>{phase === 'ready' ? `Видео готово · ${formatTime(project?.duration ?? 0)}` : phase === 'complete' ? `Найдено сцен: ${project?.scenes?.length ?? 0}` : message}</span><strong>{Math.round(progress)}%</strong></div><progress max={100} value={progress} aria-label="Ход загрузки и обработки" /><div className="file-meta"><span>{fileSize ? `${(fileSize / 1024 ** 2).toLocaleString('ru', { maximumFractionDigits: 1 })} МБ` : 'Импорт по ссылке'}</span>{busy && <button className="text-link" onClick={() => void cancel()}>Отменить</button>}</div></div></div>}
      <ol className="upload-stages"><li className={phase !== 'idle' ? 'active' : ''}><span className="stage-dot">{project && <Icon name="check" size={16} />}</span><div><strong>Загрузка видео</strong><p>{project ? 'Файл сохранён' : busy ? 'Получаем исходный файл' : 'Ожидает выбора файла'}</p></div></li><li className={['analyzing', 'complete'].includes(phase) ? 'active' : ''}><span className="stage-dot" /><div><strong>Поиск сцен</strong><p>{phase === 'complete' ? 'Анализ завершён' : phase === 'analyzing' ? 'Определяем смены кадров' : 'После загрузки'}</p></div></li><li className={phase === 'complete' ? 'active' : ''}><span className="stage-dot" /><div><strong>Монтаж клипов</strong><p>{phase === 'complete' ? 'Откройте редактор' : 'Следующий этап'}</p></div></li></ol>
      <button className="button primary analysis-button" disabled={!project || busy} onClick={() => void analyze()}>{phase === 'analyzing' ? 'Анализируем видео…' : phase === 'complete' ? 'Повторить анализ' : 'Начать анализ'}</button><p className="analysis-note">{busy ? 'Можно отменить текущую операцию' : project ? 'Автоматическое определение смены сцен' : 'Будет доступно после загрузки'}</p>{project && !busy && <button className="text-link open-demo-editor" onClick={() => navigate(`/projects/${project.id}`)}>Открыть редактор<Icon name="arrow" size={18} /></button>}
    </section><aside className="how-it-works panel"><h2>Как это работает</h2><ol className="how-steps"><li><span>1</span><div><h3>Добавьте исходное видео</h3><p>Выберите файл на компьютере или импортируйте общедоступное видео по ссылке.</p></div></li><li><span>2</span><div><h3>Найдите нужные сцены</h3><p>Анализ выделит смены сцен. Начало и конец каждого клипа можно изменить вручную.</p></div></li><li><span>3</span><div><h3>Соберите и скачайте клип</h3><p>Выберите формат, добавьте субтитры и баннер. Экспорт сохранит готовый MP4 со звуком.</p></div></li></ol><div className="how-film"><Icon name="folder" size={30} /><h3>Проекты сохраняются автоматически</h3><p>Видео, настройки и экспортированные клипы останутся на этом компьютере после перезапуска.</p></div><div className="telegram-info"><Icon name="send" size={29} /><div><h3>Отправляйте клипы в Telegram</h3><p>Подключите своего бота и укажите чат в настройках.</p><button className="text-link" onClick={() => navigate('/settings#telegram')}>Настроить подключение</button></div></div></aside></div><p className="page-note">Обработка выполняется локально</p>
  </>;
}