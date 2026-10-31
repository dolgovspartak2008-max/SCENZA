import { useCallback, useEffect, useState } from 'react';
import { request } from './api';
import type { Notify } from './model';

// Mirrors TEMPLATE_KEYS in server/ai/api.mjs: only the reusable look of a clip. Subtitle text, timings, chosen fragments,
// keywords and uploaded music belong to one video and never travel with a template.
export const templateKeys = ['format', 'cropMode', 'cropSmoothing', 'muted', 'subtitles', 'subtitleStyle', 'subtitleSize', 'subtitleColor', 'subtitleFont', 'subtitleColors', 'subtitleColorEvery', 'subtitleAccentColor', 'subtitleY', 'subtitlePosition', 'musicVolume'] as const;
export type TemplateSettings = Partial<Record<(typeof templateKeys)[number], unknown>>;
export type Template = { id: string; name: string; settings: TemplateSettings; createdAt: string; updatedAt: string };
type List = { items: Template[]; defaultId: string | null };
const api = '/api/video/templates';
const labels: Record<string, string> = { format: 'формат кадра', cropMode: 'кадрирование', cropSmoothing: 'плавность кадра', muted: 'звук видео', subtitles: 'показ субтитров', subtitleStyle: 'стиль субтитров', subtitleSize: 'размер', subtitleColor: 'цвет', subtitleFont: 'шрифт', subtitleColors: 'цвета', subtitleColorEvery: 'смена цвета', subtitleAccentColor: 'цвет акцентов', subtitleY: 'высота', subtitlePosition: 'положение', musicVolume: 'громкость музыки' };

export const pickTemplate = (settings: object): TemplateSettings => Object.fromEntries(templateKeys.filter(key => Object.hasOwn(settings, key)).map(key => [key, (settings as Record<string, unknown>)[key]]));

export function useTemplates(enabled = true) {
  const [list, setList] = useState<List | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setList(await request<List>(api)); setError(''); }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Не удалось загрузить шаблоны.'); }
  }, []);
  useEffect(() => { if (enabled) void load(); }, [enabled, load]);
  const change = useCallback(async (path: string, method: string, body?: object) => {
    const result = await request<List & { skipped?: string[] }>(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    setList({ items: result.items, defaultId: result.defaultId });
    return result;
  }, []);
  return { list, error, load, change };
}

/** Shown before processing starts: which template the first clips of the new video will use. */
export function TemplatePicker({ list, value, onChange }: { list: List | null; value: string | null; onChange: (id: string | null) => void }) {
  if (!list?.items.length) return null;
  return <label className="ai-template-picker">Шаблон оформления<select value={value ?? ''} onChange={event => onChange(event.target.value || null)}>
    <option value="">Без шаблона</option>
    {list.items.map(item => <option key={item.id} value={item.id}>{item.name}{item.id === list.defaultId ? ' · по умолчанию' : ''}</option>)}
  </select></label>;
}

export function TemplatesPanel<T extends object>({ settings, onApply, notify, templates }: { settings: T; onApply: (next: T) => void; notify: Notify; templates: ReturnType<typeof useTemplates> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const { list, error, change } = templates;
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    try { await action(); notify(message); }
    catch (problem) { notify(problem instanceof Error ? problem.message : 'Не удалось сохранить шаблон.'); }
    finally { setBusy(false); }
  }
  function apply(template: Template) {
    const known = templateKeys.filter(key => Object.hasOwn(template.settings, key));
    onApply({ ...settings, ...pickTemplate(template.settings) });
    notify(`Шаблон «${template.name}» применён: ${known.map(key => labels[key]).join(', ')}. Текст субтитров, фрагменты и музыка этого видео не менялись. Нажмите «Применить к ролику», чтобы пересобрать его.`);
  }
  return <section className="ai-templates" aria-labelledby="ai-templates-title">
    <h3 id="ai-templates-title">Мои шаблоны</h3>
    <p className="ai-note">Шаблон хранит оформление: формат кадра, кадрирование, стиль, шрифт, цвета и положение субтитров, громкость. Текст, тайминги, фрагменты и музыка конкретного видео в шаблон не попадают. Изменения текущего ролика не меняют сохранённый шаблон.</p>
    <form className="ai-template-save" onSubmit={event => { event.preventDefault(); void run(async () => { const result = await change(api, 'POST', { name, settings: pickTemplate(settings), default: !list?.items.length }); setName(''); if (result.skipped?.length) notify(`Шаблон сохранён без настроек: ${result.skipped.map(key => labels[key] ?? key).join(', ')}.`); }, `Шаблон «${name.trim()}» сохранён.`); }}>
      <label>Название шаблона<input value={name} maxLength={60} required placeholder="Например, Подкаст · жёлтые субтитры" onChange={event => setName(event.target.value)} /></label>
      <button className="button primary" disabled={busy || !name.trim()}>Сохранить как шаблон</button>
    </form>
    {error && <p className="field-error" role="alert">{error}</p>}
    {list && (list.items.length ? <ul className="ai-template-list">{list.items.map(item => <li key={item.id}>
      <div><strong>{item.name}</strong>{item.id === list.defaultId && <span className="badge">По умолчанию</span>}<small>Обновлён {new Date(item.updatedAt).toLocaleDateString('ru-RU')}</small></div>
      <div className="ai-template-actions">
        <button type="button" className="button primary" disabled={busy} onClick={() => apply(item)}>Применить</button>
        <button type="button" className="button outline" disabled={busy} onClick={() => { if (confirm(`Заменить настройки шаблона «${item.name}» текущими?`)) void run(() => change(`${api}/${item.id}`, 'PUT', { settings: pickTemplate(settings) }), `Шаблон «${item.name}» обновлён.`); }}>Обновить текущими</button>
        <button type="button" className="button outline" disabled={busy} aria-pressed={item.id === list.defaultId} onClick={() => void run(() => change(`${api}/${item.id}`, 'PUT', { default: item.id !== list.defaultId }), item.id === list.defaultId ? 'Шаблон по умолчанию отключён.' : `«${item.name}» будет применяться к новым видео.`)}>{item.id === list.defaultId ? 'Не по умолчанию' : 'Сделать по умолчанию'}</button>
        <button type="button" className="text-link" disabled={busy} onClick={() => { if (confirm(`Удалить шаблон «${item.name}»?`)) void run(() => change(`${api}/${item.id}`, 'DELETE'), 'Шаблон удалён.'); }}>Удалить</button>
      </div>
    </li>)}</ul> : <p className="ai-note">Сохранённых шаблонов пока нет. Настройте ролик и сохраните оформление — его можно будет выбрать для следующего видео.</p>)}
  </section>;
}
