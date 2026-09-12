import type { DemoCopy } from './ProductDemo';
import type { PricingCopy } from '@/components/ui/pricing';
import type { Language } from './plans';

type LandingCopy = {
  pageTitle: string; languageLabel: string;
  brandSubtitle: string;
  nav: { features: string; how: string; pricing: string; faq: string };
  login: string; start: string; menu: string; close: string; skip: string;
  hero: { title: string; subtitle: string; primary: string; secondary: string };
  examples: { title: string; description: string; badge: string; watch: string; source: string; names: [string, string, string, string]; types: [string, string, string, string] };
  platforms: { title: string; description: string };
  workspace: { title: string; description: string; features: [string, string, string, string]; details: [string, string, string, string] };
  demo: DemoCopy;
  pricingTitle: string; pricingDescription: string; pricing: PricingCopy;
  faqTitle: string; faqDescription: string; faq: { question: string; answer: string }[];
  footer: { description: string; localStudio: string; localNote: string; copyright: string };
  auth: { loginTitle: string; registerTitle: string; loginTab: string; registerTab: string; notice: string; email: string; password: string; passwordPlaceholder: string; emailPlaceholder: string; submitLogin: string; submitRegister: string; loading: string; unavailable: string; invalidEmail: string; shortPassword: string; selectedPlan: string; noPayment: string; terms: string; next: string };
  demoNotice: { title: string; text: string; button: string };
};

export const content: Record<Language, LandingCopy> = {
  ru: {
    pageTitle: 'SCENZA — создавайте короткие видео', languageLabel: 'Язык интерфейса',
    brandSubtitle: 'Студия коротких видео',
    nav: { features: 'Возможности', how: 'Как это работает', pricing: 'Тарифы', faq: 'FAQ' },
    login: 'Войти', start: 'Начать', menu: 'Открыть меню', close: 'Закрыть', skip: 'К содержимому',
    hero: { title: 'Создавайте видео с SCENZA', subtitle: 'Находите интересные моменты, добавляйте субтитры и превращайте длинные записи в короткие ролики', primary: 'Начать создавать', secondary: 'Смотреть демо' },
    examples: { title: 'Истории в коротком формате', description: 'Посмотрите, как разные истории звучат в коротком видео.', badge: 'Демонстрационные примеры', watch: 'Смотреть видео', source: 'Фрагмент открытого фильма', names: ['Городская история', 'Маленькое приключение', 'По ту сторону привычного', 'За горизонтом'], types: ['Кино · история', 'Анимация · настроение', 'Анимация · фантастика', 'Кино · путешествие'] },
    platforms: { title: 'Готовьте видео для любимых платформ', description: 'Один ролик — подходящий формат. Готовые файлы для ваших публикаций.' },
    workspace: { title: 'От исходника до готового ролика — в одном окне', description: 'Выберите сцену, примерьте субтитры и найдите свой формат.', features: ['Поиск сцен', 'Субтитры', 'Вертикальный формат', 'Экспорт'], details: ['Находите смены сцен и нужные отрезки', 'Редактируйте текст и выбирайте оформление', 'Кадрируйте под 9:16, 1:1 или 16:9', 'Сохраняйте клипы в MP4 со звуком'] },
    demo: { labelInterface: 'Демонстрация интерфейса', projectTitle: 'Тихий город', sceneLabel: 'Сцены', scenes: [{ title: 'Встреча', caption: 'Иногда всё решает одна встреча' }, { title: 'Над городом', caption: 'Новый взгляд на знакомый город' }, { title: 'Важный звонок', caption: 'Есть слова, которые меняют всё' }], subtitlesLabel: 'Субтитры', presets: ['Классика', 'Акцент', 'Минимал'], formatLabel: 'Формат', exportLabel: 'Экспортировать', sourceLabel: 'Исходное видео', guideLabel: 'Выберите сцену и настройте её', selectSceneLabel: 'Посмотреть следующую сцену' },
    pricingTitle: 'Подберите свой ритм', pricingDescription: 'Начните знакомство со студией. Условия доступа объявим перед запуском.',
    pricing: { demo: 'Демонстрационные тарифы · цены и лимиты не утверждены', month: 'Ежемесячно', year: 'Ежегодно', discount: '−{discount}% в демо', recommended: 'Рекомендуем', perMonth: '/ месяц', annualTotal: 'Полная сумма за год', free: 'на 7 дней', choose: 'Выбрать', featuresLabel: 'Возможности в демонстрации', plans: {
      trial: { name: 'Пробный', description: '7 дней знакомства со студией без карты', features: ['Демонстрация редактора', 'Выбор сцен и форматов', 'Знакомство с субтитрами', '7 дней бесплатно после регистрации'], cta: 'Попробовать SCENZA' },
      start: { name: 'Start', description: 'Для ваших регулярных историй', features: ['Загрузка исходного видео', 'Поиск смены сцен', 'Субтитры и собственные баннеры', 'Экспорт готового MP4'], cta: 'Выбрать Start' },
      pro: { name: 'Pro', description: 'Пространство для новых идей', features: ['Знакомство со всеми инструментами', 'Настройка кадрирования', 'Подготовка видео к публикации', 'Лимиты и состав плана уточняются'], cta: 'Выбрать Pro' },
    } },
    faqTitle: 'Остались вопросы?', faqDescription: 'Самое важное о работе со SCENZA.',
    faq: [
      { question: 'Что делает SCENZA?', answer: 'SCENZA помогает создавать короткие ролики из длинных записей: находить смены сцен, выбирать фрагменты, менять формат кадра, добавлять текст и баннеры, а затем сохранять MP4.' },
      { question: 'Какие исходники поддерживаются?', answer: 'В локальной студии можно загрузить MP4, MOV, WebM, MKV и AVI объёмом до 2 ГБ. Импорт по ссылке доступен для общедоступных видео и зависит от ограничений источника. Закрытые записи и защищённые плееры не поддерживаются.' },
      { question: 'Нужен ли опыт монтажа?', answer: 'Начать можно с выбора готовой сцены. Затем достаточно проверить начало и конец фрагмента, кадрирование и звук. В публичной демонстрации можно попробовать основные настройки без регистрации.' },
      { question: 'Можно ли править субтитры?', answer: 'Да. В рабочей студии вы вводите и редактируете текст вручную, выбираете стиль и встраиваете его в ролик. Автоматическое распознавание речи пока не подключено.' },
      { question: 'Как получить готовое видео?', answer: 'В рабочей студии нажмите «Экспортировать», дождитесь завершения обработки и скачайте MP4. Видео можно загрузить на нужную площадку самостоятельно. Публичное демо показывает интерфейс и не запускает экспорт.' },
      { question: 'Как устроен доступ по тарифам?', answer: 'Тарифы на этой странице демонстрационные. После подтверждённой регистрации предусмотрены 7 бесплатных дней без привязки карты. Затем пользователь сам выбирает и оплачивает тариф; автоматических списаний нет. Цены и лимиты платных планов пока демонстрационные. Публичная регистрация и приём оплаты ещё не открыты.' },
    ],
    footer: { description: 'Ваши истории. Ваш формат.', localStudio: 'Локальная студия', localNote: 'Рабочая версия на этом компьютере', copyright: 'SCENZA · Студия коротких видео' },
    auth: { loginTitle: 'С возвращением в SCENZA', registerTitle: 'Начните свою историю', loginTab: 'Войти', registerTab: 'Создать аккаунт', notice: 'Демонстрационная форма. Данные не отправляются, аккаунт не создаётся.', email: 'Электронная почта', password: 'Пароль', passwordPlaceholder: 'Не менее 8 символов', emailPlaceholder: 'you@example.com', submitLogin: 'Войти', submitRegister: 'Создать аккаунт', loading: 'Проверяем…', unavailable: 'Регистрация и вход пока не подключены. Аккаунт не создан. Пока вы можете посмотреть публичное демо.', invalidEmail: 'Введите корректный адрес электронной почты.', shortPassword: 'Для примера используйте не менее 8 символов.', selectedPlan: 'Выбран тариф', noPayment: 'Оплата пока не подключена', terms: 'Выбор тарифа сохраняется, списаний не будет.', next: 'Посмотреть демо' },
    demoNotice: { title: 'Это демонстрация интерфейса', text: 'Здесь можно выбирать сцены, стили субтитров и формат кадра. Экспорт доступен в рабочей студии; публичное демо не создаёт проекты и не запускает обработку.', button: 'Продолжить просмотр' },
  },
  en: {
    pageTitle: 'SCENZA — create short videos', languageLabel: 'Interface language',
    brandSubtitle: 'Short video studio',
    nav: { features: 'Features', how: 'How it works', pricing: 'Pricing', faq: 'FAQ' },
    login: 'Log in', start: 'Get started', menu: 'Open menu', close: 'Close', skip: 'Skip to content',
    hero: { title: 'Create videos with SCENZA', subtitle: 'Find interesting moments, add subtitles and turn long recordings into short videos', primary: 'Start creating', secondary: 'Watch the demo' },
    examples: { title: 'Stories, in a shorter format', description: 'See how different stories come to life in a short video.', badge: 'Demonstration examples', watch: 'Watch video', source: 'Excerpt from an open movie', names: ['A city story', 'A little adventure', 'Beyond the familiar', 'Over the horizon'], types: ['Film · story', 'Animation · mood', 'Animation · sci-fi', 'Film · journey'] },
    platforms: { title: 'Prepare videos for your favourite platforms', description: 'One story, the right format. Video files ready for your next post.' },
    workspace: { title: 'From source to finished video — in one workspace', description: 'Choose a scene, try subtitle styles and find your format.', features: ['Scene detection', 'Subtitles', 'Vertical format', 'Export'], details: ['Find scene changes and the moments you need', 'Edit your text and choose a subtitle style', 'Frame your story in 9:16, 1:1 or 16:9', 'Save MP4 clips with audio'] },
    demo: { labelInterface: 'Interface demonstration', projectTitle: 'Quiet City', sceneLabel: 'Scenes', scenes: [{ title: 'An encounter', caption: 'Sometimes a single meeting changes everything' }, { title: 'Above the city', caption: 'A new view of a familiar city' }, { title: 'The important call', caption: 'Some words change everything' }], subtitlesLabel: 'Subtitles', presets: ['Classic', 'Accent', 'Minimal'], formatLabel: 'Format', exportLabel: 'Export', sourceLabel: 'Source video', guideLabel: 'Choose a scene and make it yours', selectSceneLabel: 'View the next scene' },
    pricingTitle: 'Find your rhythm', pricingDescription: 'Get to know the studio. Access terms will be announced before launch.',
    pricing: { demo: 'Demonstration pricing · prices and limits are not final', month: 'Monthly', year: 'Yearly', discount: '−{discount}% in demo', recommended: 'Recommended', perMonth: '/ month', annualTotal: 'Full annual payment', free: 'for 7 days', choose: 'Choose', featuresLabel: 'Features in this demonstration', plans: {
      trial: { name: 'Trial', description: '7 days in the studio, no card required', features: ['Editor demonstration', 'Scene and format selection', 'A look at subtitle styles', '7 days free after registration'], cta: 'Try SCENZA' },
      start: { name: 'Start', description: 'For the stories you tell regularly', features: ['Upload source videos', 'Detect scene changes', 'Subtitles and your own banners', 'Export a finished MP4'], cta: 'Choose Start' },
      pro: { name: 'Pro', description: 'Room for your next idea', features: ['Explore the editing tools', 'Adjust your framing', 'Prepare videos for publishing', 'Plan features and limits to be announced'], cta: 'Choose Pro' },
    } },
    faqTitle: 'A few things to know', faqDescription: 'The essentials of working with SCENZA.',
    faq: [
      { question: 'What does SCENZA do?', answer: 'SCENZA helps you create short videos from long recordings: detect scene changes, choose clips, adjust framing, add text and banners, then export an MP4.' },
      { question: 'Which source files are supported?', answer: 'The local studio accepts MP4, MOV, WebM, MKV and AVI files up to 2 GB. Link imports work with publicly accessible videos and depend on the source’s restrictions. Private recordings and protected players are not supported.' },
      { question: 'Do I need editing experience?', answer: 'Start by choosing a detected scene, then check its start and end, framing and audio. You can try the main controls in the public demonstration without creating an account.' },
      { question: 'Can I edit subtitles?', answer: 'Yes. In the working studio, you can enter and edit text manually, choose its style and burn it into your video. Automatic speech recognition is not connected yet.' },
      { question: 'How do I get my finished video?', answer: 'In the working studio, select Export, wait for processing to finish and download the MP4. You can upload it to your chosen platform yourself. The public demo shows the interface without exporting files.' },
      { question: 'How do the plans work?', answer: 'The plans on this page are illustrative. Verified registration includes a 7-day trial without a card. Afterwards, choose and pay for a plan manually; there are no automatic charges. Paid prices and limits are still illustrative. Public registration and payments are not open yet.' },
    ],
    footer: { description: 'Your stories. Your format.', localStudio: 'Local studio', localNote: 'Working version on this computer', copyright: 'SCENZA · Short video studio' },
    auth: { loginTitle: 'Welcome back to SCENZA', registerTitle: 'Start your story', loginTab: 'Log in', registerTab: 'Create account', notice: 'Demonstration form. No data is sent and no account is created.', email: 'Email address', password: 'Password', passwordPlaceholder: 'At least 8 characters', emailPlaceholder: 'you@example.com', submitLogin: 'Log in', submitRegister: 'Create account', loading: 'Checking…', unavailable: 'Sign-up and login are not connected yet. No account was created. You can explore the public demo for now.', invalidEmail: 'Enter a valid email address.', shortPassword: 'For this example, use at least 8 characters.', selectedPlan: 'Selected plan', noPayment: 'Payments are not connected yet', terms: 'Your plan choice is saved. You will not be charged.', next: 'Explore the demo' },
    demoNotice: { title: 'This is an interface demonstration', text: 'Try scene selection, subtitle styles and video formats here. Export belongs to the working studio. This public demo does not create projects or start processing.', button: 'Keep exploring' },
  },
};
