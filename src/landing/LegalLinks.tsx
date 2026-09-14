const links = [
  ['privacy', 'Политика обработки данных', 'Privacy policy'],
  ['consent', 'Согласие на обработку данных', 'Data consent'],
  ['terms', 'Пользовательское соглашение', 'Terms of use'],
  ['offer', 'Публичная оферта', 'Service offer'],
  ['payment', 'Оплата и возврат', 'Payment and refunds'],
  ['cookies', 'Файлы cookie', 'Cookies'],
  ['contacts', 'Реквизиты и контакты', 'Legal details'],
] as const;

export function LegalLinks({ language = 'ru' }: { language?: 'ru' | 'en' }) {
  return <nav className="scenza-legal-nav" aria-label={language === 'ru' ? 'Юридические документы' : 'Legal documents'}>
    {links.map(([path, ru, en]) => <a key={path} href={`/legal/${path}`} hrefLang="ru">{language === 'ru' ? ru : en}</a>)}
  </nav>;
}
