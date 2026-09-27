import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Play, Menu, X, Plus, ScanLine, Captions, RectangleVertical, Download, Film, ArrowUpRight, Maximize, UserRound } from 'lucide-react';
import { Logo } from '../Icon';
import { ShinyButton as Button } from '@/components/ui/shiny-button';
import { PageLoader } from '@/components/ui/page-loader';
import { SectionNavigation } from '@/components/ui/section-navigation';
import { Dialog } from '@/components/ui/dialog';
import { BackgroundPaths, AnimatedHeadline } from '@/components/ui/background-paths';
import { ParticleBackground } from '@/components/ui/particle-background';
import { content } from './content';
import { ProductDemo } from './ProductDemo';
import { SplineScene } from '@/components/ui/splite';
import { Spotlight } from '@/components/ui/spotlight';
import { parseSelection } from './plans';
import type { BillingPeriod, Language, PlanId, PlanSelection } from './plans';
import { AuthModal } from './AuthModal';
import { authRequest } from './auth';
import type { Account } from './auth';
import { LegalLinks } from './LegalLinks';
import './landing.css';

const PricingSection = lazy(() => import('@/components/ui/pricing').then((module) => ({ default: module.PricingSection })));
const examples = [
  { id: 'platform-example-5958', duration: '00:23' },
  { id: 'platform-example-2', duration: '02:51' },
  { id: 'platform-example-3', duration: '01:42' },
  { id: 'platform-example-4', duration: '00:39' },
];
const featureIcons = [ScanLine, Captions, RectangleVertical, Download];
export const isLocalStudio = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

function VideoExample({ id, duration, title, type, watch, language, onExpand }: { id: string; duration: string; title: string; type: string; watch: string; language: Language; onExpand: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const pause = () => { if (document.hidden) element.pause(); };
    const pauseOther = (event: Event) => { if (event.target instanceof HTMLVideoElement && event.target !== element) element.pause(); };
    document.addEventListener('visibilitychange', pause);
    document.addEventListener('play', pauseOther, true);
    const observer = new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) element.pause(); });
    observer.observe(element);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', pause); document.removeEventListener('play', pauseOther, true); };
  }, []);
  return <article className="scenza-example" aria-label={title}><div className="scenza-example-media">
    <video ref={video} src={`/videos/${id}.mp4`} poster={`/videos/${id}.jpg`} playsInline preload="none" controls={started} aria-label={title} onPlay={() => { setStarted(true); setError(false); }} onError={() => setError(true)} />
    {!started && <button className="scenza-example-start" aria-label={`${watch}: ${title}`} onClick={() => { setError(false); void video.current?.play().catch(() => setError(true)); }}><span className="scenza-duration">{duration}</span><span className="scenza-example-play"><Play size={21} fill="currentColor" /></span><span className="scenza-example-caption"><strong>{title}</strong><small>{type}</small></span></button>}
    {started && <button className="scenza-example-expand" aria-label={`${language === 'ru' ? 'Увеличить видео' : 'Expand video'}: ${title}`} onClick={() => { video.current?.pause(); onExpand(); }}><Maximize size={17} /></button>}
    {error && <p className="scenza-example-error" role="alert">{language === 'ru' ? 'Видео не загрузилось. Попробуйте ещё раз.' : 'Video could not load. Please try again.'}</p>}
  </div></article>;
}

function readLanguage(): Language {
  try { return localStorage.getItem('scenza.language') === 'en' ? 'en' : 'ru'; } catch { return 'ru'; }
}
function readPlan() { try { return parseSelection(localStorage.getItem('scenza.selected-plan')); } catch { return null; } }

export default function Landing({ requestAccess = false }: { requestAccess?: boolean }) {
  const [language, setLanguage] = useState<Language>(readLanguage);
  const copy = content[language];
  const [selection, setSelection] = useState<PlanSelection | null>(readPlan);
  const [period, setPeriod] = useState<BillingPeriod>(() => readPlan()?.period ?? 'month');
  const [menuOpen, setMenuOpen] = useState(false);
  const [robotSettled, setRobotSettled] = useState(requestAccess);
  const finishLoading = useCallback(() => setRobotSettled(true), []);
  const [account, setAccount] = useState<Account | null>(null);
  const [authOpen, setAuthOpen] = useState(requestAccess);
  const [authMode, setAuthMode] = useState<'login' | 'register'>(requestAccess ? 'login' : 'register');
  const [videoIndex, setVideoIndex] = useState<number | null>(null);
  const [demoNotice, setDemoNotice] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const authFocus = useRef<HTMLElement | null>(null);
  const pricingRef = useRef<HTMLElement>(null);
  const [pricingVisible, setPricingVisible] = useState(false);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = copy.pageTitle;
    document.querySelector('meta[name="description"]')?.setAttribute('content', copy.hero.subtitle);
    try { localStorage.setItem('scenza.language', language); } catch { /* The page still works without storage. */ }
  }, [language, copy]);
  useEffect(() => {
    const element = pricingRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setPricingVisible(true); observer.disconnect(); } }, { rootMargin: '500px' });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); menuButton.current?.focus(); } };
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  useEffect(() => {
    if (authOpen) return;
    let active = true;
    const refresh = () => { void authRequest<{ user: Account | null }>('session').then(result => { if (active) setAccount(result.user); }).catch(() => {}); };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [authOpen]);

  function updatePlan(plan: PlanSelection) {
    const normalized = { ...plan, period: plan.planId === 'trial' ? 'month' as const : plan.period };
    setSelection(normalized);
    if (normalized.planId !== 'trial') setPeriod(normalized.period);
    try { localStorage.setItem('scenza.selected-plan', JSON.stringify(normalized)); } catch { /* Selection is retained in this tab. */ }
  }
  function changePeriod(next: BillingPeriod) {
    setPeriod(next);
    if (selection && selection.planId !== 'trial') updatePlan({ ...selection, period: next });
  }
  function openAuth(mode: 'login' | 'register', plan?: PlanSelection) {
    if (account?.accessActive && mode === 'register') { location.assign('/app'); return; }
    authFocus.current = menuOpen ? menuButton.current : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMenuOpen(false); setAuthMode(mode); setAuthOpen(true);
    if (plan) updatePlan(plan);
    else if (mode === 'register' && !selection) updatePlan({ planId: 'trial', period: 'month' });
  }
  function choosePlan(planId: PlanId, nextPeriod: BillingPeriod) { openAuth('register', { planId, period: nextPeriod }); }
  const links = [{ id: 'demo', label: copy.nav.features }, { id: 'workflow', label: copy.nav.how }, { id: 'pricing', label: copy.nav.pricing }, { id: 'faq', label: copy.nav.faq }];
  const languageControl = <div className="scenza-language" role="group" aria-label={copy.languageLabel}><button onClick={() => setLanguage('ru')} aria-pressed={language === 'ru'} lang="ru">RU</button><button onClick={() => setLanguage('en')} aria-pressed={language === 'en'} lang="en">EN</button></div>;

  const accountLabel = account?.name || account?.email;
  const accountButton = <Button variant="outline" size="sm" className={account ? 'scenza-account-button' : undefined} title={accountLabel} onClick={() => openAuth('login')}>{account ? <><UserRound size={17} /><span>{accountLabel}</span></> : copy.login}</Button>;
  return <div className="scenza-landing" inert={!robotSettled}>
    <ParticleBackground />
    <PageLoader open={!robotSettled} onContinue={finishLoading} language={language} />
    <SectionNavigation language={language} disabled={!robotSettled || authOpen || menuOpen || videoIndex !== null || demoNotice} />
    <a className="skip-link" href="#scenza-main">{copy.skip}</a>
    <header className="scenza-header"><div className="scenza-container scenza-header-inner"><a href="/" className="scenza-brand" aria-label="SCENZA"><Logo subtitle={copy.brandSubtitle} /></a><nav className="scenza-desktop-nav" aria-label={copy.nav.features}>{links.map((link) => <a key={link.id} href={`#${link.id}`}>{link.label}</a>)}</nav><div className="scenza-header-actions">{languageControl}{accountButton}<Button size="sm" onClick={() => openAuth('register')}>{account ? (language === 'ru' ? 'В студию' : 'Open studio') : copy.start}<ArrowUpRight size={15} /></Button></div>{account && <div className="scenza-mobile-account">{accountButton}</div>}<button ref={menuButton} className="scenza-menu-button" aria-expanded={menuOpen} aria-controls="scenza-mobile-nav" aria-label={menuOpen ? copy.close : copy.menu} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button></div>
      {menuOpen && <nav id="scenza-mobile-nav" className="scenza-mobile-nav" aria-label={copy.menu}>{links.map((link) => <a key={link.id} href={`#${link.id}`} onClick={() => setMenuOpen(false)}>{link.label}</a>)}<div>{languageControl}{accountButton}<Button onClick={() => openAuth('register')}>{copy.start}</Button></div></nav>}
    </header>
    <main id="scenza-main" tabIndex={-1}>
      <Spotlight />
      <section id="hero" tabIndex={-1} data-section-label={language === 'ru' ? 'Главная' : 'Home'} className="scenza-hero"><BackgroundPaths className="scenza-hero-paths" /><div className="scenza-container scenza-hero-grid"><div className="scenza-hero-copy"><AnimatedHeadline text={copy.hero.title} className="scenza-hero-title" /><p>{copy.hero.subtitle}</p><div className="scenza-hero-buttons"><Button size="lg" onClick={() => openAuth('register')}>{copy.hero.primary}<ArrowRight size={20} /></Button></div></div><SplineScene language={language} onSettled={finishLoading} /></div></section>

      <section id="examples" tabIndex={-1} data-section-label={language === 'ru' ? 'Примеры' : 'Examples'} className="scenza-container scenza-examples"><div className="scenza-section-title"><div><h2>{copy.examples.title}</h2><p>{copy.examples.description}</p></div><span className="scenza-demo-badge"><Film size={14} />{copy.examples.badge}</span></div><div className="scenza-examples-grid">{examples.map((example, index) => <VideoExample key={example.id} id={example.id} duration={example.duration} title={copy.examples.names[index]} type={copy.examples.types[index]} watch={copy.examples.watch} language={language} onExpand={() => setVideoIndex(index)} />)}<aside className="scenza-platform-panel"><h3>{copy.platforms.title}</h3><p>{copy.platforms.description}</p><div className="scenza-platforms">
<span className="scenza-platform scenza-platform-tiktok"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 2h-3v13a3 3 0 1 1-3-3V9a6 6 0 1 0 6 6V8a8 8 0 0 0 5 2V7a5 5 0 0 1-5-5Z" /></svg>TikTok</span>
<span className="scenza-platform scenza-platform-instagram"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>Instagram Reels</span>
<span className="scenza-platform scenza-platform-youtube"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="4" width="22" height="16" rx="5" fill="currentColor"/><path d="m10 8 6 4-6 4Z" fill="white"/></svg>YouTube Shorts</span>
<span className="scenza-platform scenza-platform-telegram"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="m5 11 13-5-2.5 12-4-3-2 2 .5-4 6-5-8 4Z" fill="white"/></svg>Telegram</span>
</div><span className="scenza-format-note">9:16 <i /> 1:1 <i /> 16:9</span></aside></div></section>

      <section id="demo" tabIndex={-1} data-section-label={copy.nav.features} className="scenza-demo-section"><div className="scenza-container"><div className="scenza-section-title"><div><h2>{copy.workspace.title}</h2><p>{copy.workspace.description}</p></div></div><ProductDemo variant="wide" copy={copy.demo} lang={language} onAction={() => { if (isLocalStudio()) location.assign('/app'); else setDemoNotice(true); }} /><div id="features" tabIndex={-1} className="scenza-feature-strip">{copy.workspace.features.map((label, index) => { const FeatureIcon = featureIcons[index]; return <div key={index}><span className="scenza-feature-icon"><FeatureIcon size={23} /></span><div><h3>{label}</h3><p>{copy.workspace.details[index]}</p></div></div>; })}</div></div></section>

      <section id="workflow" tabIndex={-1} data-section-label={copy.nav.how} aria-labelledby="workflow-title" className="scenza-container scenza-workflow">
        <div className="scenza-workflow-intro"><h2 id="workflow-title">{copy.automation.title}</h2><p>{copy.automation.description}</p></div>
        <ol className="scenza-workflow-steps">{copy.automation.steps.map((step, index) => <li key={step.title}><span className="scenza-workflow-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><div><h3>{step.title}</h3><p>{step.text}</p></div></li>)}</ol>
        <div className="scenza-workflow-value"><h3>{copy.automation.valueTitle}</h3><div><p>{copy.automation.value}</p><p className="scenza-workflow-note">{copy.automation.note}</p></div></div>
      </section>

      <section id="pricing" tabIndex={-1} data-section-label={copy.nav.pricing} ref={pricingRef} className="scenza-container scenza-pricing-section"><div className="scenza-section-title"><div><h2>{copy.pricingTitle}</h2><p>{copy.pricingDescription}</p></div></div>{pricingVisible ? <Suspense fallback={<div className="scenza-pricing-placeholder" aria-label={copy.nav.pricing} />}><PricingSection language={language} copy={copy.pricing} period={period} selectedPlan={selection?.planId ?? null} onPick={(planId, period) => updatePlan({ planId, period })} onPeriodChange={changePeriod} onSelect={choosePlan} /></Suspense> : <div className="scenza-pricing-placeholder" />}</section>

      <section id="faq" tabIndex={-1} data-section-label={copy.nav.faq} className="scenza-container scenza-faq"><div className="scenza-section-title"><div><h2>{copy.faqTitle}</h2><p>{copy.faqDescription}</p></div></div><div className="scenza-faq-grid">{[0, 1].map((column) => <div className="scenza-faq-column" key={column}>{copy.faq.filter((_, index) => index % 2 === column).map((item) => <details key={item.question} name="scenza-faq"><summary><span>{item.question}</span><Plus size={18} aria-hidden="true" /></summary><p>{item.answer}</p></details>)}</div>)}</div></section>
    </main>
    <footer className="scenza-footer"><div className="scenza-container scenza-legal-footer"><LegalLinks language={language} /><p>Самозанятый Долгов Спартак Сергеевич · ИНН 026617773364<br /><a href="mailto:artemnikov200777@gmail.com">artemnikov200777@gmail.com</a></p></div></footer>

    <AuthModal account={account} onAccountChange={setAccount} open={authOpen} mode={authMode} setMode={setAuthMode} close={() => setAuthOpen(false)} copy={copy} selection={selection} onPlanChange={updatePlan} restoreFocus={authFocus.current} onDemo={() => { setAuthOpen(false); requestAnimationFrame(() => document.getElementById('demo')?.scrollIntoView()); }} />
    <Dialog open={videoIndex !== null} onClose={() => setVideoIndex(null)} title={videoIndex === null ? copy.examples.watch : copy.examples.names[videoIndex]} closeLabel={copy.close} className="scenza-video-dialog">{videoIndex !== null && <><span className="scenza-demo-badge">{copy.examples.badge}</span><h2>{copy.examples.names[videoIndex]}</h2><video controls autoPlay playsInline preload="metadata" poster={`/videos/${examples[videoIndex].id}.jpg`} src={`/videos/${examples[videoIndex].id}.mp4`} aria-label={copy.examples.names[videoIndex]} /><p>{copy.examples.types[videoIndex]}</p></>}</Dialog>
    <Dialog open={demoNotice} onClose={() => setDemoNotice(false)} title={copy.demoNotice.title} closeLabel={copy.close}><div className="scenza-information"><Film size={29} /><h2>{copy.demoNotice.title}</h2><p>{copy.demoNotice.text}</p><Button onClick={() => setDemoNotice(false)}>{copy.demoNotice.button}</Button></div></Dialog>
  </div>;
}
