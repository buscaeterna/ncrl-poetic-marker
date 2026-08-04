# Разметчик стихов НКРЯ

Браузерный редактор и валидатор метрической разметки. Единый frontend работает автономно на GitHub Pages и с локальным API в Docker.

## Локальный запуск

Установите **Docker Desktop** на Windows или macOS либо **Docker Engine с Compose V2** на Linux. Официальные образы Node.js, Python и nginx поддерживают доступные им платформы `amd64` и `arm64`. В корне проекта выполните одну и ту же команду в PowerShell, Terminal или командной строке:

```text
docker compose up --build
```

Откройте <http://localhost:8080>. Наружу публикуется только порт `8080`; nginx направляет `/api/` в FastAPI, а остальные запросы — в Next.js. Остановка: `docker compose down` (или Ctrl+C, затем эта команда). Также доступны `npm run stack:up` и `npm run stack:down`.

## Два режима

- **GitHub Pages:** полностью статический автономный редактор по адресу <https://buscaeterna.github.io/ncrl-poetic-marker/>. Сервер не используется и не опрашивается.
- **Локальный полный режим:** тот же редактор и локальные health/capabilities API. Индикатор показывает доступность API; при его временном отказе импорт, правка, проверка и экспорт продолжают работать.

В обоих режимах документы пока хранятся только в IndexedDB конкретного браузера. Импортированные тексты не отправляются API или внешним сервисам. Телеметрии и облачных API нет.

API предоставляет `/api/v1/health`, `/api/v1/capabilities`, документацию `/api/docs` и схему `/api/openapi.json`. PDF/OCR, автоматические ударения, автоматический метр, локальная нейросеть, серверное хранилище и очередь ещё не реализованы; они будут последовательно добавляться поверх API.

## Разработка и проверки

Нужны Node.js 22 и npm:

```text
npm ci
npm test
npm run lint
npm run build
npm run build:pages
```

`npm run build` проверяет standalone-сборку, а `build:pages` — статический export с `basePath`. Backend требует Python 3.12: `python -m pip install -e "backend[test]"`, затем `python -m pytest backend/tests`.
