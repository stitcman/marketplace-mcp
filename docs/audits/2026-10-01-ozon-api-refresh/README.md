# Ozon API refresh — 2026-10-01

STATUS: PARTIAL. ALL_METHODS_CURRENT=NO. DEPLOYMENT_BLOCKED.

## Проверенная база

Remote: https://github.com/stitcman/marketplace-mcp.git. `git ls-remote --symref origin HEAD` подтвердил default `codex/task-5-real-yandex-read` и `ffc7ef2465e3df84d6be6fb5aba4015d170b2d61`. Рабочая ветка `codex/ozon-api-refresh-20261001` создана от этой чистой базы. Чужой dirty worktree `full-readonly-coverage` сохранён. MOS не изменялся.

На действующем MCP подтверждено реальное active подключение Ozon, mock=false, sandbox=false. HTTPS health отвечает ok=true, store=postgres. Identity/version/build commit/manifest SHA/image ID/digest/Compose binding текущего сервера не получены. Исторический release-manifest v1.0.0 не доказывает текущую установку. SSH остановлен на HOST_KEY_VERIFICATION_FAILED; доверие к новому ключу не добавлено. BASELINE_UNVERIFIED.

## Исправления и потребительский контракт

- Цены и остатки: upstream cursor определяет продолжение независимо от total, фильтра и числа развёрнутых строк. Повтор cursor прекращает цикл; пустая отфильтрованная страница сохраняет continuation. Курсор привязан к аккаунту, методу и фильтрам. data.next_cursor, meta.next_cursor и meta.continuation согласованы.
- Остатки: opt-in `contract_version: "v2"` сохраняет FBO/FBS/rFBS/FBP/UNKNOWN, source_type, source_sku, missing available/reserved как null. По умолчанию v1 остаётся с прежней схемой FBO/FBS; несовместимая строка явно возвращает FEATURE_NOT_SUPPORTED, а не переименовывается в FBO. Потребителю нужен осознанный переход на v2.
- Цены: declared_price сохраняет денежный объект, валюту, missing/null/zero; старое скалярное представление поддержано явно.
- Заказы: FBS v4 и FBO v3, корневые postings/cursor/has_next, два независимых потока и постоянный временной интервал. Терминальный поток повторно не вызывается. Денежные произведения считаются десятичной арифметикой BigInt. sku сохранён как source_sku; marketplace_product_id больше не подменяется sku и может быть null. Это семантическая коррекция, требующая проверки конкретного потребителя.
- Сертификаты: только products/list переведён на last_id/limit после 28.09; page/page_size локально отвергаются. Отдельный certificate/list не изменён.
- Finance: устаревшие transaction list/total исключены; by-day continuation сохраняет date и следует last_id. Старый totals не синтезируется из неэквивалентных начислений.
- Barcode generate признан WRITE и запрещён, несмотря на исторический допуск report job. Retired logistics/finance/act методы исключены, ошибки содержат документированную замену.
- Performance: отдельный заранее provisioned серверный bearer с future expiry. Seller key туда не передаётся. Автоматический OAuth и ротация не выполняются.
- Защита: nested URL/auth/account overrides отвергаются; report jobs не повторяются после неопределённой сетевой ошибки; Retry-After соблюдается. Ozon JSON ограничен 256 KiB, файл 50 MiB до полного чтения. Файлы только HTTPS ir.ozone.ru, проверка public IPv4 и DNS pinning, redirects запрещены, credentials не передаются. IPv6/другие hosts пока запрещены.
- Tooling diff сохраняет $ref closure, recursive/allOf/anyOf/oneOf без потери схем; учитывает наследуемую и локальную авторизацию/security schemes и servers. Отсутствие пути не объявляется удалением. Новые/изменённые контракты DENY_UNTIL_REVIEWED. Активный старый schema generator пока не обеспечивает полную fidelity сложных схем.

Общие публичные schemas MOS/WB/ЯМ не расширены. Регрессии WB/ЯМ прошли; их инвентари и allowlists байтово совпадают с базой (baseline.json). Контракт настоящего потребителя MOS не исследован и не сертифицирован: MOS_COMPATIBILITY_UNVERIFIED. Старые cursors v1/v2 заказов не переносятся; начинать новую пагинацию после обновления. Нормализованную live-проверку кандидата нельзя приравнивать к проверкам старого сервера.

## Источники и покрытия

Официальные страницы [Seller](https://docs.ozon.ru/api/seller/) и [Performance](https://docs.ozon.ru/api/performance/) прочитаны браузером. Каждая из 18 точечных миграций имеет operation URL, retrieved_at_utc, effective_at и решение в `policies/ozon-contract-overrides.json`.

В DOM Seller 481 уникальный verb/path, в историческом snapshot 463; Performance 48 узлов. Это свидетельствует о неполноте исторического среза, а не о доказанных 18 добавлениях. Полные официальные machine-readable schemas не получены: Swagger URL из документации и альтернативные официальные запросы возвращают redirect loop/limit. source-manifest.json содержит исторические SHA-256 и отдельно свежие наблюдения; sources/fetch-results.json фиксирует неуспех загрузки. Фиксация версии 1.1.0-alpha.1 не делает API актуальным.

inventory-diff.json — полный diff локального инвентаря относительно установленной исходной базы, **не полный свежий официальный Swagger diff**. endpoint-coverage.json разделяет docs/implementation/admission/tests/live по каждой исторической записи. Всего 511, добавлено 0, изменено 18, scheduled_removal 2, подтверждённо removed 9, allowed 273. Новые действующие endpoints не допускаются автоматически. Тарифные и Performance ограничения не трактуются как отсутствие метода.

Накопленные dates/замены отражены в overrides. Акции v1 scheduled_removal 13.10.2026: есть тесты до/после, будущая v2 семантика не активирована заранее. Label/scanit 05.10.2026 — FUTURE_EFFECTIVE: создание этикеток остаётся запрещённым, live jobs не запускались. Официальный package-label flow и Money declared_price прочитаны, но полные новые schemas/fixtures не сертифицированы. Изменения product-info declared_price и forbidden import price, точные CSV columns/encoding/delimiter report products/postings, полный список analytics stock statuses и все changelog изменения с исторического среза остаются GAP. Парсера CSV в текущей реализации нет; новый не выдуман. Analytics data documented 1/min, ограничение тарифа и headers Retry-After/Ratelimit-Remaining зафиксированы; полная endpoint-specific quota matrix не доказана.

## Реальные READ: действующий сервер, не кандидат

Через существующий Secure Tunnel проверены capabilities и реальность подключения. На старых wrappers воспроизведены has_more=false при limit=1 и rFBS→FBO. Generic prices/stocks: по три последовательные страницы limit=1, official_api, продолжение true, total_items наблюдалось 43234 (не инвариант); declared_price и fbo/fbs/rfbs присутствовали.

FBS v4 и FBO v3: отдельно limit=1, фиксированный UTC интервал 2026-09-30T00:00:00Z–2026-10-01T04:00:00Z, по одному posting, continuation=true. WarehouseListV2 limit=1 и returnsList limit=1 успешны. RolesByToken успешен, expires_at=2026-12-08T09:54:14.116973Z; ключ не выводился. Finance accrual types успешен. By-day 2026-09-30 не дал классифицируемого подтверждения success/official_api; успех не заявляется.

8 generic методов имеют положительное READ-наблюдение старого сервера. Candidate live=0, terminal pagination подтверждена только фикстурами. Реальные деньги/идентификаторы/ответы не сохранены. Performance, report jobs, download и WRITE live не запускались. FINANCE_RECONCILIATION_UNVERIFIED: первичный источник одинакового периода/смысла недоступен, delta не вычислялась.

## Проверки и review

Фактически выполнены на базе и кандидате: `npm run build`, `npm test`, `npm run policies:check`, `npm run baseline:check` — PASS. Добавлены ozon-refresh, ozon-contract-refresh, ozon-transport-refresh, ozon-safety-refresh, ozon-file-refresh, ozon-spec-diff tests. Ошибки pagination/stock/money/transport воспроизводились тестами RED→GREEN. Safety: все 238 запрещённых/retired операций, unknown и nested routing/auth substitutions, HTTP_REQUESTS_SENT=0. JSON bounds и file/DNS правила проверены синтетически, не live download.

`node scripts/generate-read-policies.mjs --ozon-only` выполнен дважды: одинаковый tracked результат, WB/ЯМ не генерируются. Snapshot hashes закреплены в ozon-source-pins.json; drift и --approve-reviewed для Ozon блокируются до изменения файлов. `node scripts/record-ozon-refresh-evidence.mjs` создаёт matrix/diff/metrics/provenance. `node scripts/fetch-ozon-specs.mjs` выполнен: UNAVAILABLE/REDIRECT_LIMIT для обоих семейств. `node scripts/ozon-spec-diff.mjs seller|performance before.json after.json output.json` готов для CI, но свежих входов пока нет; синтетический тест не заменяет официальный diff.

Независимый read-only reviewer ozon_review проверил весь diff: P0/P1 не найдено; P2 (пропуск inherited authorization в diff) воспроизведён падающим тестом и исправлен. Reviewer повторно проверил финальную коррекцию: замечание закрыто, новых actionable P0/P1/P2 не найдено. Это review кода, не доказательство production readiness.

## Релиз, передача и откат

Кандидат 1.1.0-alpha.1: package/lock/Manifest/Passport согласованы; исторические provenance поля сохранены как исторические. Выпущенные v1.0.0/RC не переписывались. Финальный commit и manifest SHA записываются во внешнюю release-attestation после коммита, без self-hash цикла. Image ID и registry digest остаются отдельными null; образ кандидата не собран/не установлен. Внешний артефакт: C:/Users/9mail/.codex/artifacts/ozon-api-refresh-20261001/release-attestation.json.

Для передачи закрепить точный SHA из attestation в существующем процессе MCP; проверить `git show <SHA>:package.json` и SHA-256 Manifest. Не подменять production Compose примером. Точные серверные deploy команды не утверждены, поскольку текущие Compose binding/путь/образ не установлены. Любая команда рестарта на этом этапе запрещена gate.

До deploy нужны: полный официальный snapshot и diff/review всех READ, исправление fidelity schemas, MOS consumer compatibility, успешная обязательная финансовая сверка, read-only attestation runtime/Compose/image, подтверждённый старый образ+конфигурация и необходимая резервная копия состояния. Сохранить предыдущие image ID и digest отдельно; rollback должен вернуть только MCP router к прежнему закреплённому образу/конфигурации и пройти identity+smoke. Не рестартовать MOS/Postgres/соседние сервисы. Текущий rollback не проверен, production не менялся. Частичный hotfix не опубликован: существующая политика исключения полного gate не установлена.

BLOCKERS: OFFICIAL_SNAPSHOTS_UNAVAILABLE; BASELINE_UNVERIFIED/SSH_HOST_KEY; MOS_COMPATIBILITY_UNVERIFIED; FINANCE_RECONCILIATION_UNVERIFIED; FULL_READ_SCHEMA_AND_TEST_COVERAGE_INCOMPLETE; PERFORMANCE_LIVE_UNAVAILABLE; ROLLBACK_UNVERIFIED. Independent safe implementation complete to this boundary; production and ALL_METHODS_CURRENT остаются закрыты.
