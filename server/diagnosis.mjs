// Turns a stored job error into a Telegram explanation for the owner: what failed, why, what to do and where to look.
// Each rule matches the safe error text the worker saves; add new rules here when a new failure appears.
const rules = [
  { test: /\((ffmpeg|ffprobe): ENOENT\)/, what: 'На сервере нет программы FFmpeg/ffprobe — без неё видео нельзя прочитать и смонтировать.',
    why: 'Пакет ffmpeg-static не скачал программу при pnpm install. Частая причина — pnpm пропустил скачивание: разрешение на сборку ffmpeg-static задаётся в pnpm-workspace.yaml (onlyBuiltDependencies), а pnpm старше 10.26 не понимает прежний ключ allowBuilds. Также бывает, если node_modules скопирован с другой системы.',
    fix: 'В папке проекта выполните pnpm rebuild ffmpeg-static — команда скачает FFmpeg; затем перезапустите scenza и scenza-worker и повторите обработку. Либо установите FFmpeg сами и укажите путь в .env: SCENZA_FFMPEG и SCENZA_FFPROBE.',
    where: 'server/ai/render.mjs (FFMPEG_PATH, FFPROBE_PATH), папка node_modules/ffmpeg-static' },
  { test: /\(python: ENOENT\)|Не установлено Python-окружение/, what: 'Не найден Python для анализа видео (распознавание речи и поиск сцен).',
    why: 'Не создано окружение .scena/venv. Папки .scena нет в GitHub, поэтому в новой копии проекта его нет.',
    fix: 'Windows: запустите Setup-Python.cmd в папке проекта. Linux-сервер: команды из deploy/VIDEO-WORKER.md. Свой путь к Python можно указать в .env: SCENZA_PYTHON.',
    where: 'server/ai/worker.mjs (переменная python), папка .scena/venv' },
  { test: /\((ffmpeg|ffprobe|python): (EACCES|EPERM)\)/, what: 'Программа обработки есть, но система не даёт её запустить.',
    why: 'Нет прав на запуск файла или его блокирует антивирус.',
    fix: 'Проверьте права на файл (Linux: chmod +x) и исключения антивируса для папки проекта.',
    where: 'server/ai/render.mjs (FFMPEG_PATH), .scena/venv' },
  { test: /Python-зависимости|Обработка видео не завершена\. Проверьте файл, доступ к каталогу результата и зависимости Python/, what: 'Python найден, но в нём нет библиотек анализа (faster-whisper, scenedetect, OpenCV) или они сломаны.',
    why: 'Окружение создано, но установка библиотек не завершилась.',
    fix: 'Windows: запустите Setup-Python.cmd ещё раз. Linux: .scena/venv/bin/python -m pip install -r server/ai/requirements.txt.',
    where: 'server/ai/media.py, server/ai/requirements.txt' },
  { test: /OPENROUTER_API_KEY|AI-анализ пока не подключён/, what: 'Не задан ключ OpenRouter.',
    why: 'В .env пустая строка OPENROUTER_API_KEY или сервер запущен без .env.',
    fix: 'Впишите ключ в .env после OPENROUTER_API_KEY= и сохраните файл — сервер перечитает его сам.',
    where: '.env (OPENROUTER_API_KEY), server/ai/openai.mjs' },
  { test: /OpenRouter API отклонил доступ/, what: 'OpenRouter не принял ключ (HTTP 401/403).',
    why: 'Ключ удалён, перевыпущен, ограничен или у него нет доступа к модели.',
    fix: 'Создайте ключ в кабинете OpenRouter и впишите его в .env. Проверьте ограничения ключа по моделям.',
    where: '.env (OPENROUTER_API_KEY, PRIMARY_VIDEO_MODEL, FAST_EDIT_MODEL)' },
  { test: /Недостаточно средств на балансе OpenRouter/, what: 'На OpenRouter закончились деньги (HTTP 402).',
    why: 'Баланс аккаунта или лимит ключа исчерпан.', fix: 'Пополните баланс или поднимите лимит ключа в кабинете OpenRouter.', where: 'кабинет OpenRouter' },
  { test: /OpenRouter API ограничил запросы/, what: 'OpenRouter временно ограничил запросы (HTTP 429).',
    why: 'Слишком много запросов подряд или квота ключа.', fix: 'Подождите несколько минут и повторите обработку.', where: 'кабинет OpenRouter' },
  { test: /OpenRouter API недоступен \(HTTP/, what: 'OpenRouter ответил ошибкой сервера.',
    why: 'Сбой на стороне OpenRouter или выбранная модель недоступна.', fix: 'Повторите позже. Если не проходит — проверьте названия моделей в .env.', where: '.env (PRIMARY_VIDEO_MODEL, FAST_EDIT_MODEL), server/ai/openai.mjs' },
  { test: /Не удалось связаться с OpenRouter/, what: 'Сервер не смог подключиться к OpenRouter.',
    why: 'Нет интернета на сервере, блокировка сети или VPN/прокси.', fix: 'Проверьте интернет на машине, где запущена студия.', where: 'сеть сервера' },
  { test: /некорректный или незавершённый ответ/, what: 'Модель вернула неполный ответ.',
    why: 'Сбой модели или слишком длинный ответ.', fix: 'Повторите обработку. Если повторяется — проверьте модели в .env.', where: 'server/ai/openai.mjs' },
  { test: /превышено время ожидания/, what: 'AI-анализ не уложился в 10 минут.',
    why: 'Перегрузка OpenRouter или слишком длинный фрагмент.', fix: 'Повторите обработку позже.', where: 'server/ai/openai.mjs' },
  { test: /Не удалось обработать видео\. Проверьте файл и доступные ресурсы сервера/, what: 'FFmpeg запустился, но завершился с ошибкой.',
    why: 'Повреждённый или необычный файл, мало места на диске или памяти.', fix: 'Проверьте свободное место на диске и попробуйте другой файл. Подробности — в окне/журнале обработчика.', where: 'журнал worker (journalctl -u scenza-worker на сервере), server/ai/render.mjs' },
];
const stages = { preprocess: 'загрузка и подготовка видео', analyze: 'анализ видео', revise: 'правка ролика', export: 'экспорт', asset: 'загрузка рекламного файла' };

export const diagnose = text => rules.find(rule => rule.test.test(String(text || ''))) || null;

export function jobAlertText(job) {
  const error = String(job.error || '').slice(0, 1500), found = diagnose(error), stage = stages[job.type];
  const lines = [`SCENZA: ошибка обработки ${job.id}${stage ? ` (этап: ${stage})` : ''}.`, error];
  if (found) lines.push('', `Что случилось: ${found.what}`, `Причина: ${found.why}`, `Что сделать: ${found.fix}`, `Где смотреть: ${found.where}`);
  return lines.join('\n');
}
