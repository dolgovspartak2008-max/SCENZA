import type { ReactNode } from 'react';
import { CloudUpload, MessagesSquare, Lightbulb, Compass, Sparkles, Captions, Crop, AudioLines } from 'lucide-react';

export default function StudioWelcome({ children }: { children:ReactNode }) {
  return <div className="studio-welcome">
    <section className="studio-canvas" aria-labelledby="studio-title">
      <img className="studio-art" src="/assets/studio-mountains.webp" srcSet="/assets/studio-mountains-768.webp 768w, /assets/studio-mountains.webp 1536w" sizes="(max-width: 650px) 100vw, 75vw" alt="" width="1536" height="1024" fetchPriority="high" />
      <header className="studio-intro"><h1 id="studio-title">Создайте свой ролик</h1><p>Загрузите видео и выберите лучшие моменты.</p></header>
      <div className="studio-upload-area">{children}</div>
      <div className="studio-caption"><span>Большие истории.<br/>В коротких роликах.</span><p>Ваше видео. Ваш взгляд. Ваша история.</p></div>
    </section>
    <aside className="studio-tools" aria-label="Идеи и возможности студии">
      <section className="studio-quick" aria-labelledby="studio-ideas-title"><h2 id="studio-ideas-title">Идеи для вашего видео</h2>
        <div className="studio-tool"><span className="studio-tool-icon"><MessagesSquare /></span><span><strong>Интервью и разговоры</strong><small>Ответы на вопросы, личные истории и живые диалоги.</small></span></div>
        <div className="studio-tool"><span className="studio-tool-icon"><Lightbulb /></span><span><strong>Обзоры и мастер-классы</strong><small>Покажите, как всё устроено: от первого шага до результата.</small></span></div>
        <div className="studio-tool"><span className="studio-tool-icon"><Compass /></span><span><strong>События и путешествия</strong><small>Сохраните атмосферу места, впечатления и неожиданные встречи.</small></span></div>
      </section>
      <section className="studio-features" aria-label="Возможности монтажа">
        <div><Sparkles/><span><strong>AI-монтаж</strong><small>Поиск ярких сцен и лучших моментов</small></span></div>
        <div><Captions/><span><strong>Автосубтитры</strong><small>Распознавание речи и настройка текста</small></span></div>
        <div><Crop/><span><strong>Кадрирование</strong><small>Ваш кадр для каждой площадки</small></span><span className="studio-formats" aria-label="Форматы 9 на 16 и 16 на 9"><i>9:16</i><i>16:9</i></span></div>
        <div><AudioLines/><span><strong>Звук</strong><small>Музыка и баланс громкости</small></span></div>
      </section>
      <p className="studio-local"><CloudUpload size={17}/> Начните с одного видео</p>
    </aside>
  </div>;
}
