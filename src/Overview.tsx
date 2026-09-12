import { useState } from 'react';
import { Icon } from './Icon';
import { filterProjects, formatTime } from './model';
import type { Navigate, Project } from './model';

export function FilmPoster({ project, navigate }: { project: Project; navigate: Navigate }) {
  return <a className="film-poster" href={`/app/projects/${project.id}`} aria-label={`Открыть видео ${project.title}`} onClick={(event) => { event.preventDefault(); navigate(`/projects/${project.id}`); }}><img src={project.image} alt={project.alt} /><span className="poster-play"><Icon name="play" /></span><div className="poster-caption"><h3>{project.title}</h3><p>{project.duration ? formatTime(project.duration) : project.genre}</p></div></a>;
}

export default function Overview({ navigate, showAll, items }: { navigate: Navigate; showAll: boolean; items: Project[] }) {
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState('week');
  const results = filterProjects(query, items);
  const trendItems = [...items].filter((item) => Date.now() - new Date(item.createdAt ?? 0).getTime() < (period === 'week' ? 7 : 30) * 86400000).sort((a, b) => (b.scenes?.length ?? 0) - (a.scenes?.length ?? 0)).slice(0, 4);
  return <>
    <div className="page-intro"><h1>Ваша студия коротких видео</h1><p>Находите истории, выбирайте сцены и создавайте клипы</p></div>
    <div className="search-row"><div className="search-field"><Icon name="search" size={23} /><input type="search" aria-label="Найти фильм или сериал" placeholder="Найти фильм или сериал" value={query} onChange={(event) => setQuery(event.target.value)} /></div><a className="button primary upload-button" href="/app/upload" onClick={(event) => { event.preventDefault(); navigate('/upload'); }}><Icon name="download" size={24} />Загрузить видео</a></div>
    <section id="projects" className="projects-section"><div className="section-heading"><h2>{query.trim() ? 'Результаты поиска' : showAll ? 'Все проекты' : 'Продолжить работу'}</h2><a className="text-link" href="/app#projects" onClick={(event) => { event.preventDefault(); setQuery(''); navigate('/#projects'); }}>Все проекты<Icon name="arrow" size={19} /></a></div>
      <div className="project-grid">{(query.trim() || showAll ? results : results.slice(0, 3)).map((project) => <article className="project-card has-video" key={project.id}><video src={project.video} poster={project.image} controls preload="metadata" playsInline aria-label={`Видео ${project.title}`} onPlay={(event) => { document.querySelectorAll('video').forEach((video) => { if (video !== event.currentTarget) video.pause(); }); }} /><div className="project-card-bottom"><div><h3>{project.title}</h3><p className="project-status"><i className={`status-dot ${project.tone}`} />{project.status}</p></div><a href={`/app/projects/${project.id}`} className="button outline" onClick={(event) => { event.preventDefault(); navigate(`/projects/${project.id}`); }}>Открыть редактор</a></div>{project.sourceCredit && <p className="source-credit" title={project.sourceCredit}>{project.sourceCredit}</p>}</article>)}</div>
      {results.length === 0 && <div className="empty-state"><Icon name={query ? 'search' : 'film'} size={30} /><h3>{query ? 'Ничего не найдено' : 'Добавьте первое видео'}</h3><p>{query ? 'Попробуйте другое название или добавьте своё видео.' : 'Загрузите файл с компьютера или импортируйте по ссылке.'}</p><button className="button outline" onClick={() => query ? setQuery('') : navigate('/upload')}>{query ? 'Сбросить поиск' : 'Загрузить видео'}</button></div>}
    </section>
    <div className="discovery-grid"><section id="trends" className="trends-section"><div className="section-heading"><div className="heading-with-filter"><h2>В тренде</h2><select aria-label="Период трендов" value={period} onChange={(event) => setPeriod(event.target.value)}><option value="week">За неделю</option><option value="month">За месяц</option></select></div><a className="text-link" href="/app#projects" onClick={(event) => { event.preventDefault(); navigate('/#projects'); }}>Вся подборка<Icon name="arrow" size={19} /></a></div><p className="collection-note">Подборка из вашей библиотеки · по числу найденных сцен</p><div className="poster-grid">{trendItems.map((project) => <FilmPoster key={project.id} project={project} navigate={navigate} />)}</div>{!trendItems.length && <p className="empty-collection">За этот период пока нет проектов.</p>}</section>
      <aside className="new-cut panel"><h2>Новая нарезка</h2><ol className="new-cut-steps"><li><span>1</span>Добавьте видео</li><li><span>2</span>Выберите моменты</li><li><span>3</span>Проверьте и скачайте</li></ol><a href="/app/upload" className="button primary" onClick={(event) => { event.preventDefault(); navigate('/upload'); }}>Создать проект</a></aside>
    </div><p className="page-note">Локальная библиотека · ваши файлы хранятся на этом компьютере</p>
  </>;
}
