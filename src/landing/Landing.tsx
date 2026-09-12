import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowRight, Play, Menu, X, Plus, ScanLine, Captions, RectangleVertical, Download, Film, ArrowUpRight } from 'lucide-react';
import { Logo } from '../Icon';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { BackgroundPaths, AnimatedHeadline } from '@/components/ui/background-paths';
import { content } from './content';
import { ProductDemo } from './ProductDemo';
import { parseSelection } from './plans';
import type { BillingPeriod, Language, PlanId, PlanSelection } from './plans';
import { AuthModal } from './AuthModal';
import { LegalLinks } from './Legal';
import './landing.css';

const PricingSection = lazy(() => import('@/components/ui/pricing').then((module) => ({ default: module.PricingSection })));
const examples = [
  { id: 'city', credit: 'Tears of Steel · Blender Foundation · CC BY 3.0', source: 'https://mango.blender.org/', license: 'https://creativecommons.org/licenses/by/3.0/' },
  { id: 'coast', credit: 'Big Buck Bunny · Blender Foundation · CC BY 3.0', source: 'https://peach.blender.org/', license: 'https://creativecommons.org/licenses/by/3.0/' },
  { id: 'ship', credit: 'Elephants Dream · Blender Foundation / Netherlands Media Art Institute · CC BY 2.5', source: 'https://orange.blender.org/', license: 'https://creativecommons.org/licenses/by/2.5/' },
  { id: 'dawn', credit: 'Sintel · Blender Foundation · CC BY 3.0', source: 'https://durian.blender.org/', license: 'https://creativecommons.org/licenses/by/3.0/' },
];
const featureIcons = [ScanLine, Captions, RectangleVertical, Download];
export const isLocalStudio = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

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
    authFocus.current = menuOpen ? menuButton.current : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMenuOpen(false); setAuthMode(mode); setAuthOpen(true);
    if (plan) updatePlan(plan);
    else if (mode === 'register' && !selection) updatePlan({ planId: 'trial', period: 'month' });
  }
  function choosePlan(planId: PlanId, nextPeriod: BillingPeriod) { openAuth('register', { planId, period: nextPeriod }); }
  const links = [{ id: 'features', label: copy.nav.features }, { id: 'demo', label: copy.nav.how }, { id: 'pricing', label: copy.nav.pricing }, { id: 'faq', label: copy.nav.faq }];
  const languageControl = <div className="scenza-language" role="group" aria-label={copy.languageLabel}><button onClick={() => setLanguage('ru')} aria-pressed={language === 'ru'} lang="ru">RU</button><button onClick={() => setLanguage('en')} aria-pressed={language === 'en'} lang="en">EN</button></div>;

  return <div className="scenza-landing">
    <a className="skip-link" href="#scenza-main">{copy.skip}</a>
    <header className="scenza-header"><div className="scenza-container scenza-header-inner"><a href="/" className="scenza-brand" aria-label="SCENZA"><Logo subtitle={copy.brandSubtitle} /></a><nav className="scenza-desktop-nav" aria-label={copy.nav.features}>{links.map((link) => <a key={link.id} href={`#${link.id}`}>{link.label}</a>)}</nav><div className="scenza-header-actions">{languageControl}<Button variant="outline" size="sm" onClick={() => openAuth('login')}>{copy.login}</Button><Button size="sm" onClick={() => openAuth('register')}>{copy.start}<ArrowUpRight size={15} /></Button></div><button ref={menuButton} className="scenza-menu-button" aria-expanded={menuOpen} aria-controls="scenza-mobile-nav" aria-label={menuOpen ? copy.close : copy.menu} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button></div>
      {menuOpen && <nav id="scenza-mobile-nav" className="scenza-mobile-nav" aria-label={copy.menu}>{links.map((link) => <a key={link.id} href={`#${link.id}`} onClick={() => setMenuOpen(false)}>{link.label}</a>)}<div>{languageControl}<Button variant="outline" onClick={() => openAuth('login')}>{copy.login}</Button><Button onClick={() => openAuth('register')}>{copy.start}</Button></div></nav>}
    </header>
    <main id="scenza-main" tabIndex={-1}>
      <section className="scenza-hero"><BackgroundPaths className="scenza-hero-paths" /><div className="scenza-container scenza-hero-grid"><div className="scenza-hero-copy"><AnimatedHeadline text={copy.hero.title} className="scenza-hero-title" /><p>{copy.hero.subtitle}</p><div className="scenza-hero-buttons"><Button size="lg" onClick={() => openAuth('register')}>{copy.hero.primary}<ArrowRight size={20} /></Button><Button asChild variant="outline" size="lg"><a href="#demo"><Play size={17} />{copy.hero.secondary}</a></Button></div></div><div className="scenza-hero-product"><ProductDemo variant="hero" copy={copy.demo} lang={language} onAction={() => { if (isLocalStudio()) location.assign('/app'); else setDemoNotice(true); }} /></div></div></section>

      <section id="examples" className="scenza-container scenza-examples"><div className="scenza-section-title"><div><h2>{copy.examples.title}</h2><p>{copy.examples.description}</p></div><span className="scenza-demo-badge"><Film size={14} />{copy.examples.badge}</span></div><div className="scenza-examples-grid">{examples.map((example, index) => <button key={example.id} className="scenza-example" onClick={() => setVideoIndex(index)} aria-label={`${copy.examples.watch}: ${copy.examples.names[index]}`}><img src={`/videos/${example.id}.jpg`} alt={copy.examples.names[index]} width="640" height="360" loading="lazy" /><span className="scenza-duration">00:40</span><span className="scenza-example-play"><Play size={21} fill="currentColor" /></span><span className="scenza-example-caption"><strong>{copy.examples.names[index]}</strong><small>{copy.examples.types[index]}</small></span></button>)}<aside className="scenza-platform-panel"><h3>{copy.platforms.title}</h3><p>{copy.platforms.description}</p><div className="scenza-platforms">
<span className="scenza-platform scenza-platform-tiktok"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 2h-3v13a3 3 0 1 1-3-3V9a6 6 0 1 0 6 6V8a8 8 0 0 0 5 2V7a5 5 0 0 1-5-5Z" /></svg>TikTok</span>
<span className="scenza-platform scenza-platform-instagram"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>Instagram Reels</span>
<span className="scenza-platform scenza-platform-youtube"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="4" width="22" height="16" rx="5" fill="currentColor"/><path d="m10 8 6 4-6 4Z" fill="white"/></svg>YouTube Shorts</span>
<span className="scenza-platform scenza-platform-telegram"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="m5 11 13-5-2.5 12-4-3-2 2 .5-4 6-5-8 4Z" fill="white"/></svg>Telegram</span>
</div><span className="scenza-format-note">9:16 <i /> 1:1 <i /> 16:9</span></aside></div></section>

      <section id="demo" className="scenza-demo-section"><div className="scenza-container"><div className="scenza-section-title"><div><h2>{copy.workspace.title}</h2><p>{copy.workspace.description}</p></div></div><ProductDemo variant="wide" copy={copy.demo} lang={language} onAction={() => { if (isLocalStudio()) location.assign('/app'); else setDemoNotice(true); }} /><div id="features" className="scenza-feature-strip">{copy.workspace.features.map((label, index) => { const FeatureIcon = featureIcons[index]; return <div key={index}><span className="scenza-feature-icon"><FeatureIcon size={23} /></span><div><h3>{label}</h3><p>{copy.workspace.details[index]}</p></div></div>; })}</div></div></section>

      <section id="pricing" ref={pricingRef} className="scenza-container scenza-pricing-section"><div className="scenza-section-title"><div><h2>{copy.pricingTitle}</h2><p>{copy.pricingDescription}</p></div></div>{pricingVisible ? <Suspense fallback={<div className="scenza-pricing-placeholder" aria-label={copy.nav.pricing} />}><PricingSection language={language} copy={copy.pricing} period={period} selectedPlan={selection?.planId ?? null} onPick={(planId, period) => updatePlan({ planId, period })} onPeriodChange={changePeriod} onSelect={choosePlan} /></Suspense> : <div className="scenza-pricing-placeholder" />}</section>

      <section id="faq" className="scenza-container scenza-faq"><div className="scenza-section-title"><div><h2>{copy.faqTitle}</h2><p>{copy.faqDescription}</p></div></div><div className="scenza-faq-grid">{[0, 1].map((column) => <div className="scenza-faq-column" key={column}>{copy.faq.filter((_, index) => index % 2 === column).map((item) => <details key={item.question} name="scenza-faq"><summary><span>{item.question}</span><Plus size={18} aria-hidden="true" /></summary><p>{item.answer}</p></details>)}</div>)}</div></section>
    </main>
    <footer className="scenza-footer"><div className="scenza-container"><a className="scenza-brand" href="/" aria-label="SCENZA"><Logo subtitle={copy.brandSubtitle} /></a><nav aria-label={copy.footer.copyright}>{links.map((link) => <a key={link.id} href={`#${link.id}`}>{link.label}</a>)}{isLocalStudio() && <a href="/app" title={copy.footer.localNote}>{copy.footer.localStudio}<ArrowUpRight size={13} /></a>}</nav><p>{copy.footer.copyright}</p></div><div className="scenza-container scenza-legal-footer"><LegalLinks language={language} /><p>Самозанятый Долгов Спартак Сергеевич · ИНН 026617773364<br /><a href="mailto:dolgovspartak2008@gmail.com">dolgovspartak2008@gmail.com</a></p></div></footer>

    <AuthModal open={authOpen} mode={authMode} setMode={setAuthMode} close={() => setAuthOpen(false)} copy={copy} selection={selection} onPlanChange={updatePlan} restoreFocus={authFocus.current} onDemo={() => { setAuthOpen(false); requestAnimationFrame(() => document.getElementById('demo')?.scrollIntoView()); }} />
    <Dialog open={videoIndex !== null} onClose={() => setVideoIndex(null)} title={videoIndex === null ? copy.examples.watch : copy.examples.names[videoIndex]} closeLabel={copy.close} className="scenza-video-dialog">{videoIndex !== null && <><span className="scenza-demo-badge">{copy.examples.badge}</span><h2>{copy.examples.names[videoIndex]}</h2><video controls playsInline preload="metadata" poster={`/videos/${examples[videoIndex].id}.jpg`} src={`/videos/${examples[videoIndex].id}.mp4`} aria-label={copy.examples.names[videoIndex]} /><p>{copy.examples.source} · <a href={examples[videoIndex].source} target="_blank" rel="noreferrer">{examples[videoIndex].credit}</a> · <a href={examples[videoIndex].license} target="_blank" rel="noreferrer">Creative Commons</a></p></>}</Dialog>
    <Dialog open={demoNotice} onClose={() => setDemoNotice(false)} title={copy.demoNotice.title} closeLabel={copy.close}><div className="scenza-information"><Film size={29} /><h2>{copy.demoNotice.title}</h2><p>{copy.demoNotice.text}</p><Button onClick={() => setDemoNotice(false)}>{copy.demoNotice.button}</Button></div></Dialog>
  </div>;
}

