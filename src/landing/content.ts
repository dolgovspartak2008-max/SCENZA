import type { DemoCopy } from './ProductDemo';
import type { PricingCopy } from '@/components/ui/pricing';
import type { Language } from './plans';

type LandingCopy = {
  pageTitle: string; languageLabel: string;
  brandSubtitle: string;
  nav: { features: string; how: string; pricing: string; faq: string };
  login: string; start: string; menu: string; close: string; skip: string;
  hero: { title: string; subtitle: string; primary: string };
  examples: { title: string; description: string; badge: string; watch: string; names: [string, string, string, string]; types: [string, string, string, string] };
  platforms: { title: string; description: string };
  workspace: { title: string; description: string; features: [string, string, string, string]; details: [string, string, string, string] };
  demo: DemoCopy;
  automation: { title: string; description: string; steps: { title: string; text: string }[]; valueTitle: string; value: string; note: string };
  pricingTitle: string; pricingDescription: string; pricing: PricingCopy;
  faqTitle: string; faqDescription: string; faq: { question: string; answer: string }[];
  footer: { description: string; localStudio: string; localNote: string; copyright: string };
  auth: { loginTitle: string; registerTitle: string; loginTab: string; registerTab: string; notice: string; name: string; namePlaceholder: string; email: string; password: string; passwordPlaceholder: string; emailPlaceholder: string; submitLogin: string; submitRegister: string; loading: string; unavailable: string; invalidEmail: string; invalidName: string; shortPassword: string; selectedPlan: string; noPayment: string; terms: string; next: string };
  demoNotice: { title: string; text: string; button: string };
};

export const content: Record<Language, LandingCopy> = {
  ru: {
    pageTitle: 'SCENZA — создавайте короткие видео', languageLabel: 'Язык интерфейса',
    brandSubtitle: 'Студия коротких видео',
    nav: { features: 'Возможности', how: 'Как это работает', pricing: 'Тарифы', faq: 'FAQ' },
    login: 'Войти', start: 'Начать', menu: 'Открыть меню', close: 'Закрыть', skip: 'К содержимому',
    hero: { title: 'Создавайте видео с SCENZA', subtitle: 'Находите интересные моменты, добавляйте субтитры и превращайте длинные записи в короткие ролики', primary: 'Начать бесплатно' },
    examples: { title: 'Истории в коротком формате', description: 'Посмотрите, какие видео вы можете создать на нашей платформе.', badge: 'Демонстрационные примеры', watch: 'Смотреть видео', names: ['Пример 1', 'Пример 2', 'Пример 3', 'Пример 4'], types: ['Квадратное видео · 1:1', 'Вертикальное видео · 9:16', 'Вертикальное видео · 9:16', 'Видео с субтитрами · 9:16'] },
    platforms: { title: 'Готовьте видео для любимых платформ', description: 'Один ролик — подходящий формат. Готовые файлы для ваших публикаций.' },
    workspace: { title: 'Попробуйте редактор на готовом видео', description: 'Выберите фрагмент, измените текст и сравните форматы прямо здесь.', features: ['Выбор фрагмента', 'Оформление субтитров', 'Формат кадра', 'Сохранение кадра'], details: ['Три отрезка одного видео для знакомства с редактором', 'Свой текст и три стиля, без распознавания речи', 'Сравните 9:16, 1:1 и 16:9', 'Скачайте PNG с выбранным оформлением'] },
    demo: { labelInterface: 'Сокращённая демоверсия редактора', projectTitle: 'Ваше видео · пример', sceneLabel: 'Фрагменты', scenes: [{ title: 'Начало', caption: 'Ваша история начинается здесь' }, { title: 'Развитие', caption: 'Выберите момент, который хочется пересмотреть' }, { title: 'Финал', caption: 'Добавьте свой текст и найдите нужный формат' }], subtitlesLabel: 'Субтитры', presets: ['Классика', 'Акцент', 'Минимал'], formatLabel: 'Формат', exportLabel: 'Экспортировать', sourceLabel: 'Пример видео для редактирования', guideLabel: 'Меняйте настройки и сравнивайте результат', selectSceneLabel: 'Посмотреть следующий фрагмент' },
    automation: {
      title: 'Вы загружаете видео — SCENZA готовит короткие ролики',
      description: 'Так будет работать полная версия. Автоматизация в разработке; здесь можно попробовать сокращённый редактор.',
      steps: [
        { title: 'Загрузите исходник', text: 'Добавьте длинное видео. Система проанализирует содержание и предложит интересные моменты.' },
        { title: 'Выберите момент', text: 'SCENZA подготовит монтаж, адаптирует кадр и добавит субтитры. Музыка — по желанию.' },
        { title: 'Уточните результат', text: 'Проверьте ролик и опишите правки обычными словами. При необходимости добавьте рекламный баннер.' },
        { title: 'Скачайте готовый ролик', text: 'Получите MP4 для публикации. Следующий ролик можно будет создать из того же исходника без повторной загрузки.' },
      ],
      valueTitle: 'За что будет оплата',
      value: 'За автоматическую подготовку роликов: поиск моментов, монтаж, кадрирование, субтитры и финальный экспорт. Вы выбираете результат и вносите правки, а сервис берёт на себя повторяющуюся работу.',
      note: 'Модель оплаты, цены и лимиты уточняются. Условия будут доступны до оплаты.',
    },
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
      { question: 'Как получить готовое видео?', answer: 'В рабочей студии нажмите «Экспортировать», дождитесь завершения обработки и скачайте MP4. Видео можно загрузить на нужную площадку самостоятельно. В сокращённой демоверсии можно скачать только PNG-кадр; экспорт MP4 недоступен.' },
      { question: 'Как устроен доступ по тарифам?', answer: 'Тарифы на этой странице демонстрационные. После подтверждённой регистрации предусмотрены 7 бесплатных дней без привязки карты. Затем пользователь сам выбирает и оплачивает тариф; автоматических списаний нет. Цены и лимиты платных планов пока демонстрационные. Публичная регистрация и приём оплаты ещё не открыты.' },
    ],
    footer: { description: 'Ваши истории. Ваш формат.', localStudio: 'Локальная студия', localNote: 'Рабочая версия на этом компьютере', copyright: 'SCENZA · Студия коротких видео' },
    auth: { loginTitle: 'С возвращением в SCENZA', registerTitle: 'Начните свою историю', loginTab: 'Войти', registerTab: 'Создать аккаунт', notice: 'Демонстрационная форма. Данные не отправляются, аккаунт не создаётся.', name: 'Имя пользователя', namePlaceholder: 'Как вас называть', email: 'Электронная почта', password: 'Пароль', passwordPlaceholder: 'Не менее 8 символов', emailPlaceholder: 'you@example.com', submitLogin: 'Войти', submitRegister: 'Создать аккаунт', loading: 'Проверяем…', unavailable: 'Регистрация и вход пока не подключены. Аккаунт не создан. Пока вы можете посмотреть публичное демо.', invalidEmail: 'Введите корректный адрес электронной почты.', invalidName: 'Введите имя пользователя (до 60 символов).', shortPassword: 'Для примера используйте не менее 8 символов.', selectedPlan: 'Выбран тариф', noPayment: 'Оплата пока не подключена', terms: 'Выбор тарифа сохраняется, списаний не будет.', next: 'Посмотреть демо' },
    demoNotice: { title: 'Это демонстрация интерфейса', text: 'Здесь можно выбирать сцены, стили субтитров и формат кадра. Экспорт доступен в рабочей студии; публичное демо не создаёт проекты и не запускает обработку.', button: 'Продолжить просмотр' },
  },
  en: {
    pageTitle: 'SCENZA — create short videos', languageLabel: 'Interface language',
    brandSubtitle: 'Short video studio',
    nav: { features: 'Features', how: 'How it works', pricing: 'Pricing', faq: 'FAQ' },
    login: 'Log in', start: 'Get started', menu: 'Open menu', close: 'Close', skip: 'Skip to content',
    hero: { title: 'Create videos with SCENZA', subtitle: 'Find interesting moments, add subtitles and turn long recordings into short videos', primary: 'Start for free' },
    examples: { title: 'Stories, in a shorter format', description: 'See what videos you can create on our platform.', badge: 'Demonstration examples', watch: 'Watch video', names: ['Example 1', 'Example 2', 'Example 3', 'Example 4'], types: ['Square video · 1:1', 'Vertical video · 9:16', 'Vertical video · 9:16', 'Video with subtitles · 9:16'] },
    platforms: { title: 'Prepare videos for your favourite platforms', description: 'One story, the right format. Video files ready for your next post.' },
    workspace: { title: 'Try the editor with a sample video', description: 'Choose a segment, edit the text and compare formats right here.', features: ['Choose a segment', 'Style captions', 'Change the format', 'Save a frame'], details: ['Three segments of one video to explore the editor', 'Your text and three styles, without speech recognition', 'Compare 9:16, 1:1 and 16:9', 'Download a PNG with your chosen styling'] },
    demo: { labelInterface: 'Limited editor demo', projectTitle: 'Your video · sample', sceneLabel: 'Segments', scenes: [{ title: 'Beginning', caption: 'Your story starts here' }, { title: 'Development', caption: 'Choose a moment worth watching again' }, { title: 'Ending', caption: 'Add your text and find the right format' }], subtitlesLabel: 'Subtitles', presets: ['Classic', 'Accent', 'Minimal'], formatLabel: 'Format', exportLabel: 'Export', sourceLabel: 'Sample video for editing', guideLabel: 'Change the settings and compare the result', selectSceneLabel: 'View the next segment' },
    automation: {
      title: 'You upload a video — SCENZA prepares short clips',
      description: 'The planned workflow for the full version. Automation is in development; this page offers a limited editor demo.',
      steps: [
        { title: 'Upload your source', text: 'Add a long video. The system will analyse its content and suggest interesting moments.' },
        { title: 'Choose a moment', text: 'SCENZA will edit the clip, adapt the framing and add subtitles. Music will be optional.' },
        { title: 'Refine the result', text: 'Review your clip and describe changes in plain language. Add an advertising banner if needed.' },
        { title: 'Download your clip', text: 'Get an MP4 ready to publish. Create another clip from the same source without uploading it again.' },
      ],
      valueTitle: 'What you will pay for',
      value: 'Automatic clip preparation: finding moments, editing, reframing, subtitles and final export. You choose the result and request changes while the service handles repetitive work.',
      note: 'The payment model, prices and limits are being finalised. Terms will be available before payment.',
    },
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
      { question: 'How do I get my finished video?', answer: 'In the working studio, select Export, wait for processing to finish and download the MP4. You can upload it to your chosen platform yourself. The limited demo can download PNG frames; MP4 export is unavailable.' },
      { question: 'How do the plans work?', answer: 'The plans on this page are illustrative. Verified registration includes a 7-day trial without a card. Afterwards, choose and pay for a plan manually; there are no automatic charges. Paid prices and limits are still illustrative. Public registration and payments are not open yet.' },
    ],
    footer: { description: 'Your stories. Your format.', localStudio: 'Local studio', localNote: 'Working version on this computer', copyright: 'SCENZA · Short video studio' },
    auth: { loginTitle: 'Welcome back to SCENZA', registerTitle: 'Start your story', loginTab: 'Log in', registerTab: 'Create account', notice: 'Demonstration form. No data is sent and no account is created.', name: 'Username', namePlaceholder: 'How should we call you', email: 'Email address', password: 'Password', passwordPlaceholder: 'At least 8 characters', emailPlaceholder: 'you@example.com', submitLogin: 'Log in', submitRegister: 'Create account', loading: 'Checking…', unavailable: 'Sign-up and login are not connected yet. No account was created. You can explore the public demo for now.', invalidEmail: 'Enter a valid email address.', invalidName: 'Enter a username (up to 60 characters).', shortPassword: 'For this example, use at least 8 characters.', selectedPlan: 'Selected plan', noPayment: 'Payments are not connected yet', terms: 'Your plan choice is saved. You will not be charged.', next: 'Explore the demo' },
    demoNotice: { title: 'This is an interface demonstration', text: 'Try scene selection, subtitle styles and video formats here. Export belongs to the working studio. This public demo does not create projects or start processing.', button: 'Keep exploring' },
  },
};
