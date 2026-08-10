# Архитектура

## Два runtime-режима

Единый Next.js frontend собирается как автономный статический GitHub Pages export (`NEXT_PUBLIC_RUNTIME_MODE=static`) или full Docker UI. Static-код не показывает проекты и не опрашивает их API. IndexedDB всегда служит локальным автоматически сохраняемым черновиком; сбой API не блокирует редактор.

## Stack и данные

Gateway nginx — единственная публикуемая служба, по умолчанию `127.0.0.1:8080`. Он проксирует web и API и ограничивает тело 20 MiB. PostgreSQL в непубликуемом named volume хранит `projects` (UUID, name, schema_version, неизменяемый по структуре JSONB workspace, revision, UTC timestamps) и каскадно связанные `jobs` (UUID, project, type/status/progress/result/error/attempts/timestamps). Alembic `migrate` должен успешно завершиться до запуска API и worker; `/ready` проверяет SQL-соединение.

Полный workspace сохраняется снимком, поэтому порядок, исходные документы/байты в сериализованном представлении, encoding/EOL, editor metadata и неизвестные будущие JSON-поля не фильтруются. PUT использует атомарное сравнение revision и при конфликте возвращает 409.

## PostgreSQL-очередь

Worker использует общий backend image. Он атомарно забирает `queued` запись с `FOR UPDATE SKIP LOCKED`, фиксирует `running`, число попыток и результат/ошибку. Lease возвращает зависшие задания в очередь либо завершает их ошибкой после лимита попыток. Между пустыми опросами есть задержка, SIGTERM останавливает цикл. Первый тип `workspace_summary` только формирует статистику сохранённого snapshot.

Авторизации, многопользовательского режима, Redis/Celery, телеметрии и внешних API нет. Локальные PDF/OCR, модель ударений и детерминированный анализ метра выполняются отдельным worker; машинные результаты хранятся как предложения до явного принятия.
