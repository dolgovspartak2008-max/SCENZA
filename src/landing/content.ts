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
  advantages: { label: string; title: string; description: string; items: { title: string; text: string }[] };
  referral: { title: string; text: string; join: string; share: string; copied: string };
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
      note: 'Онлайн-оплата пока не подключена: тариф подключает администратор. Автоматических списаний нет.',
    },
    pricingTitle: 'Подберите свой ритм', pricingDescription: '1 токен = 1 минута исходного видео. Токены не сгорают: остаток переносится на следующий месяц. Чем больше пакет, тем дешевле минута.',
    pricing: { demo: 'Онлайн-оплата пока не подключена · тариф подключает администратор', discount: '−{discount}%', recommended: 'Рекомендуем', perMonth: '/ месяц', tokens: '{tokens} токенов · {price} за минуту', saving: 'Экономия {amount}', free: 'в подарок', gift: '10 токенов = 10 минут видео — бесплатно', choose: 'Выбрать', featuresLabel: 'Что входит в тариф', plans: {
      trial: { name: 'Подарок', description: 'Дарим 10 токенов сразу после регистрации — без карты и без срока', features: ['10 бесплатных токенов = 10 минут видео', 'Хватит на несколько готовых роликов', 'Субтитры, баннер и экспорт в CapCut', 'Токены не сгорают, карта не нужна'], cta: 'Забрать 10 токенов' },
      start: { name: 'Старт', description: 'Для регулярных коротких роликов', features: ['75 минут исходного видео', '≈65–70 готовых Shorts / TikTok', 'Субтитры и собственные баннеры', 'Экспорт готового MP4'], cta: 'Выбрать Старт' },
      pro: { name: 'Про', description: 'Для блогеров, которые выпускают ролики каждый день', features: ['170 минут исходного видео', 'Минута дешевле на 12%', 'Видеобаннеры с паузой ролика', 'Кадрирование под каждую площадку'], cta: 'Выбрать Про' },
      business: { name: 'Бизнес', description: 'Для студий, агентств и команд', features: ['500 минут исходного видео', '≈470 готовых роликов', 'Самая низкая цена минуты', 'Баннеры клиентов в безопасной зоне'], cta: 'Выбрать Бизнес' },
    } },
    faqTitle: 'Остались вопросы?', faqDescription: 'Самое важное о работе со SCENZA.',
    faq: [
      { question: 'Что делает SCENZA?', answer: 'SCENZA помогает создавать короткие ролики из длинных записей: находить смены сцен, выбирать фрагменты, менять формат кадра, добавлять текст и баннеры, а затем сохранять MP4.' },
      { question: 'Какие исходники поддерживаются?', answer: 'Лучше всего SCENZA работает с видео до 30 минут: анализ проходит быстрее, а ролики получаются точнее. В локальной студии можно загрузить MP4, MOV, WebM, MKV и AVI объёмом до 2 ГБ. Импорт по ссылке доступен для общедоступных видео и зависит от ограничений источника. Закрытые записи и защищённые плееры не поддерживаются.' },
      { question: 'Нужен ли опыт монтажа?', answer: 'Начать можно с выбора готовой сцены. Затем достаточно проверить начало и конец фрагмента, кадрирование и звук. В публичной демонстрации можно попробовать основные настройки без регистрации.' },
      { question: 'Можно ли править субтитры?', answer: 'Да. В рабочей студии вы вводите и редактируете текст вручную, выбираете стиль и встраиваете его в ролик. Автоматическое распознавание речи пока не подключено.' },
      { question: 'Как получить готовое видео?', answer: 'В рабочей студии нажмите «Экспортировать», дождитесь завершения обработки и скачайте MP4. Видео можно загрузить на нужную площадку самостоятельно. В сокращённой демоверсии можно скачать только PNG-кадр; экспорт MP4 недоступен.' },
      { question: 'Как устроен доступ по тарифам?', answer: 'Сразу после регистрации мы дарим 10 токенов — это 10 минут исходного видео, хватит на несколько готовых роликов. Карта не нужна, срок не ограничен. Платные тарифы считаются в токенах: 1 токен = 1 минута загруженного исходного видео. Онлайн-оплата пока не подключена: тариф подключает администратор через Telegram-бота, автоматических списаний нет.' },
      { question: 'Сгорают ли токены?', answer: 'Нет. Токены остаются на балансе, пока вы их не используете, и переносятся на следующий месяц при продлении. Повторный анализ того же видео токены не списывает.' },
      { question: 'Как работает «Приведи друга»?', answer: 'В профиле есть ваша ссылка. Когда друг регистрируется по ней, вы оба получаете по 20 токенов, а после каждой его покупки вы получаете ещё 10% токенов от тарифа.' },
    ],
    footer: { description: 'Ваши истории. Ваш формат.', localStudio: 'Локальная студия', localNote: 'Рабочая версия на этом компьютере', copyright: 'SCENZA · Студия коротких видео' },
    auth: { loginTitle: 'С возвращением в SCENZA', registerTitle: 'Начните свою историю', loginTab: 'Войти', registerTab: 'Создать аккаунт', notice: 'Демонстрационная форма. Данные не отправляются, аккаунт не создаётся.', name: 'Имя пользователя', namePlaceholder: 'Как вас называть', email: 'Электронная почта', password: 'Пароль', passwordPlaceholder: 'Не менее 8 символов', emailPlaceholder: 'you@example.com', submitLogin: 'Войти', submitRegister: 'Создать аккаунт', loading: 'Проверяем…', unavailable: 'Регистрация и вход пока не подключены. Аккаунт не создан. Пока вы можете посмотреть публичное демо.', invalidEmail: 'Введите корректный адрес электронной почты.', invalidName: 'Введите имя пользователя (до 60 символов).', shortPassword: 'Для примера используйте не менее 8 символов.', selectedPlan: 'Выбран тариф', noPayment: 'Оплата пока не подключена', terms: 'Выбор тарифа сохраняется, списаний не будет.', next: 'Посмотреть демо' },
    advantages: { label: 'Преимущества', title: 'Почему переходят в SCENZA', description: 'То, чего не хватает в привычных сервисах для нарезки роликов.', items: [
      { title: 'Токены не сгорают', text: 'Неиспользованные минуты остаются на балансе и переносятся на следующий месяц. Вы платите только за загруженное видео.' },
      { title: 'Реклама, которая не портит ролик', text: 'Баннер в свободной зоне кадра или вставка с паузой: ролик останавливается, показывает рекламу и продолжается с того же места.' },
      { title: 'Экспорт в CapCut, Premiere Pro и DaVinci', text: 'Пакет для CapCut в один клик: чистое видео без вшитых субтитров, редактируемые субтитры SRT и ваш баннер. Для Premiere и DaVinci — проект XML и EDL.' },
      { title: 'Текст поста и хэштеги', text: 'К каждому ролику — заголовок, хук, описание и 5–7 хэштегов для TikTok, Reels и Shorts. Скопируйте в один клик.' },
      { title: 'Честная цена за минуту', text: '1 токен = 1 минута исходного видео. Чем больше пакет, тем дешевле минута — до −24% на тарифе «Бизнес».' },
    ] },
    referral: { title: 'Приведи друга', text: '+20 токенов вам и другу сразу после регистрации по вашей ссылке и ещё 10% токенов с каждой его покупки.', join: 'Получить свою ссылку', share: 'Скопировать мою ссылку', copied: 'Ссылка скопирована' },
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
      note: 'Online payment is not connected yet: the administrator activates plans. There are no automatic charges.',
    },
    pricingTitle: 'Find your rhythm', pricingDescription: '1 token = 1 minute of source video. Tokens never expire: unused ones roll over to the next month. Bigger packs make every minute cheaper.',
    pricing: { demo: 'Online payment is not connected yet · plans are activated by the administrator', discount: '−{discount}%', recommended: 'Recommended', perMonth: '/ month', tokens: '{tokens} tokens · {price} per minute', saving: 'You save {amount}', free: 'as a gift', gift: '10 tokens = 10 minutes of video, free', choose: 'Choose', featuresLabel: 'What the plan includes', plans: {
      trial: { name: 'Gift', description: '10 tokens on us right after sign-up — no card, no deadline', features: ['10 free tokens = 10 minutes of video', 'Enough for several finished clips', 'Subtitles, banner and CapCut export', 'Tokens never expire, no card required'], cta: 'Claim 10 tokens' },
      start: { name: 'Start', description: 'For regular short videos', features: ['75 minutes of source video', '≈65–70 finished Shorts / TikToks', 'Subtitles and your own banners', 'Export a finished MP4'], cta: 'Choose Start' },
      pro: { name: 'Pro', description: 'For creators who publish every day', features: ['170 minutes of source video', 'Each minute 12% cheaper', 'Video banners that pause the clip', 'Framing for every platform'], cta: 'Choose Pro' },
      business: { name: 'Business', description: 'For studios, agencies and teams', features: ['500 minutes of source video', '≈470 finished clips', 'The lowest price per minute', 'Client banners inside the safe zone'], cta: 'Choose Business' },
    } },
    faqTitle: 'A few things to know', faqDescription: 'The essentials of working with SCENZA.',
    faq: [
      { question: 'What does SCENZA do?', answer: 'SCENZA helps you create short videos from long recordings: detect scene changes, choose clips, adjust framing, add text and banners, then export an MP4.' },
      { question: 'Which source files are supported?', answer: 'SCENZA works best with videos up to 30 minutes: analysis is faster and the clips are more precise. The local studio accepts MP4, MOV, WebM, MKV and AVI files up to 2 GB. Link imports work with publicly accessible videos and depend on the source’s restrictions. Private recordings and protected players are not supported.' },
      { question: 'Do I need editing experience?', answer: 'Start by choosing a detected scene, then check its start and end, framing and audio. You can try the main controls in the public demonstration without creating an account.' },
      { question: 'Can I edit subtitles?', answer: 'Yes. In the working studio, you can enter and edit text manually, choose its style and burn it into your video. Automatic speech recognition is not connected yet.' },
      { question: 'How do I get my finished video?', answer: 'In the working studio, select Export, wait for processing to finish and download the MP4. You can upload it to your chosen platform yourself. The limited demo can download PNG frames; MP4 export is unavailable.' },
      { question: 'How do the plans work?', answer: 'Right after sign-up we give you 10 tokens — 10 minutes of source video, enough for several finished clips. No card and no deadline. Paid plans are counted in tokens: 1 token = 1 minute of uploaded source video. Online payment is not connected yet: the administrator activates plans through the Telegram bot and there are no automatic charges.' },
      { question: 'Do tokens expire?', answer: 'No. Tokens stay on your balance until you use them and roll over to the next month when you renew. Re-analysing the same video does not use tokens again.' },
      { question: 'How does Invite a friend work?', answer: 'Your link is in your profile. When a friend signs up with it, you both get 20 tokens, and after each of their purchases you get another 10% of the plan tokens.' },
    ],
    footer: { description: 'Your stories. Your format.', localStudio: 'Local studio', localNote: 'Working version on this computer', copyright: 'SCENZA · Short video studio' },
    auth: { loginTitle: 'Welcome back to SCENZA', registerTitle: 'Start your story', loginTab: 'Log in', registerTab: 'Create account', notice: 'Demonstration form. No data is sent and no account is created.', name: 'Username', namePlaceholder: 'How should we call you', email: 'Email address', password: 'Password', passwordPlaceholder: 'At least 8 characters', emailPlaceholder: 'you@example.com', submitLogin: 'Log in', submitRegister: 'Create account', loading: 'Checking…', unavailable: 'Sign-up and login are not connected yet. No account was created. You can explore the public demo for now.', invalidEmail: 'Enter a valid email address.', invalidName: 'Enter a username (up to 60 characters).', shortPassword: 'For this example, use at least 8 characters.', selectedPlan: 'Selected plan', noPayment: 'Payments are not connected yet', terms: 'Your plan choice is saved. You will not be charged.', next: 'Explore the demo' },
    advantages: { label: 'Advantages', title: 'Why creators switch to SCENZA', description: 'What the usual clipping services are missing.', items: [
      { title: 'Tokens never expire', text: 'Unused minutes stay on your balance and roll over to the next month. You only pay for the video you upload.' },
      { title: 'Ads that do not spoil the clip', text: 'A banner in a free area of the frame or an inserted break: the clip pauses, shows the ad and resumes from the same moment.' },
      { title: 'Export to CapCut, Premiere Pro and DaVinci', text: 'A one-click CapCut pack: a clean video without burned-in captions, editable SRT subtitles and your banner. XML and EDL projects for Premiere and DaVinci.' },
      { title: 'Post text and hashtags', text: 'Every clip comes with a title, hook, description and 5–7 hashtags for TikTok, Reels and Shorts. Copy them in one click.' },
      { title: 'A fair price per minute', text: '1 token = 1 minute of source video. Bigger packs make each minute cheaper, up to −24% on Business.' },
    ] },
    referral: { title: 'Invite a friend', text: '+20 tokens for you and your friend right after they sign up with your link, plus 10% of tokens from each of their purchases.', join: 'Get my link', share: 'Copy my link', copied: 'Link copied' },
    demoNotice: { title: 'This is an interface demonstration', text: 'Try scene selection, subtitle styles and video formats here. Export belongs to the working studio. This public demo does not create projects or start processing.', button: 'Keep exploring' },
  },
};
