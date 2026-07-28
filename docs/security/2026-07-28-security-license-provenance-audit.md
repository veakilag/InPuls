# InPuls: аудит безопасности, лицензий и происхождения кода

Дата: 2026-07-28  
Статус: первый этап, read-only аудит  
Итоговый baseline `main`: `0888f5e9077cf2783cb20eb988397173ffe3f816`  
Начальный baseline: `8850d6346475b7ac86bbae825d2cb5e42d792757`

## Резюме

Во время аудита другой WORK-чат успел влить PR #45. Поэтому основная проверка выполнена на `8850d634…`, затем отдельно проверена дельта до актуального на момент завершения `main` — `0888f5e9…`. Дельта добавила `orderbook-density.js`, его интеграцию и тесты; новых XSS-синков, сетевых адресов, секретов или внешних зависимостей в ней не обнаружено.

Найдено:

| Severity | Количество |
|---|---:|
| Critical | 0 |
| High | 2 |
| Medium | 7 |
| Low | 3 |

Главные риски:

1. Репозиторий остаётся публичным, поэтому весь клиентский код и алгоритмы доступны для просмотра и клонирования.
2. `main` не защищён ruleset/branch protection, а обязательных проверок нет.
3. В `app.js` есть DOM-XSS-синк через `innerHTML` при недостаточной проверке символов и полей внешнего WebSocket/REST-потока.
4. CSP и основные защитные HTTP-заголовки отсутствуют.
5. Исторические GitHub Actions напрямую генерировали и пушили runtime-код; происхождение части текущего стакана требует отдельного подтверждения.

Подтверждённые положительные факты:

- в актуальном дереве не найдены пароли, токены, приватные ключи или API-ключи;
- в `package.json` нет runtime/dev dependencies, lock-файлов и npm supply-chain поверхности;
- внешние скрипты, CDN-библиотеки, `eval`, `new Function` и `document.write` не обнаружены;
- market data запрашивается по HTTPS/WSS у фиксированных публичных Binance endpoints;
- внешние ссылки в основном интерфейсе используют `rel="noopener"`;
- Service Worker обрабатывает только same-origin GET;
- на начальном baseline выполнено `npm test`: 162 теста пройдены, 0 упало;
- проверка дельты PR #45 была статической: полный набор тестов уже обновлённого `main` локально не перезапускался.

Отчёт не является юридическим заключением или гарантией отсутствия уязвимостей.

## Scope и методика

Проверены:

- HTML/JS/runtime, Worker и WebSocket-пути;
- DOM-синки, `innerHTML`, URL-конструирование и внешние ссылки;
- IndexedDB, localStorage, Cache API и Service Worker;
- CSP, HTTP-заголовки и локальный `server.js`;
- текущие зависимости и исторические GitHub Actions;
- текущее дерево на секреты и история имён файлов на чувствительные артефакты;
- Git-метаданные, авторство коммитов, лицензии и происхождение бинарных ассетов;
- ограниченный exact-string web search по характерным идентификаторам кода.

Не выполнялись:

- исправления, обновления зависимостей и изменения runtime/config;
- динамический browser pentest с управляемым MITM Binance-потока;
- полноценный DAST production-хостинга;
- исчерпывающий скан содержимого всех удалённых Git blobs. Текущий snapshot проверен, исторические имена файлов проверены, но filtered clone не позволил надёжно выгрузить каждый удалённый blob. После завершения optimization PR нужен полный clone и `gitleaks --log-opts="--all"`.

## Findings

### SEC-01 — Публичный репозиторий раскрывает весь клиентский код

- **Severity:** High
- **Файл и строки:** настройка GitHub repository visibility; runtime-алгоритмы находятся, в частности, в `engine.js`, `app.js`, `chart.js`, `orderbook*.js` и `orderbook-density.js:1-718`.
- **Доказательство:** на момент завершения аудита `veakilag/InPuls` имеет `visibility: public`. GitHub Terms разрешают другим пользователям просматривать и воспроизводить публичный контент через функции GitHub, включая fork: [GitHub Terms of Service](https://docs.github.com/site-policy/github-terms/github-terms-of-service).
- **Реальный риск:** любой может скачать текущую историю и изучить алгоритмы. Перевод в private не удалит уже сделанные клоны, скачивания или независимые публичные копии. Код, доставляемый браузеру, останется доступен пользователю даже из private-репозитория.
- **Способ исправления:** после завершения optimization PR перевести репозиторий в private и проверить доступ GitHub App; критические алгоритмы со временем вынести на закрытый backend; не публиковать production source maps. Минификация/обфускация — только дополнительное усложнение анализа.
- **Будут затронуты:** GitHub visibility/hosting; позднее архитектура API/backend и production build.
- **Конфликт с общей оптимизацией:** высокий, если менять visibility/Pages или архитектуру до завершения текущей работы; сейчас отложить.

### SEC-02 — `main` не защищён от прямой или скомпрометированной записи

- **Severity:** High
- **Файл и строки:** настройка ветки GitHub, строк в репозитории нет.
- **Доказательство:** `main.protected = false`; repository rulesets отсутствуют; обязательных status checks нет. В текущем дереве также нет активных CI workflows.
- **Реальный риск:** ошибочный direct push либо скомпрометированный аккаунт, токен или GitHub App может сразу изменить код. Для PWA особенно опасна подмена `sw.js`, поскольку вредоносная версия может закрепиться в браузерном кеше.
- **Способ исправления:** после optimization PR включить ruleset: PR обязателен, required checks, запрет force-push/delete, минимальный bypass; добавить CODEOWNERS для `sw.js`, workflow и security-sensitive файлов; рассмотреть signed commits/tags и release provenance.
- **Будут затронуты:** GitHub rulesets/branch settings; будущие `.github/workflows/*`, `CODEOWNERS`.
- **Конфликт с общей оптимизацией:** высокий — включение защиты сейчас может остановить активные push/merge другого WORK-чата.

### SEC-03 — DOM XSS через `innerHTML` и слабую проверку market symbol

- **Severity:** Medium
- **Файл и строки:** `engine.js:429-433`; `app.js:246-276`, `app.js:1979-2002`, `app.js:2057-2087`.
- **Доказательство:** `filterUsdtPerpetualTicker` проверяет в основном `endsWith("USDT")`; отдельные WebSocket-ветки используют ещё более слабую такую же проверку. `selectChartSymbol` принимает любое значение с таким окончанием и вставляет его в query string. `renderDetail` строит `innerHTML`, куда без HTML/attribute escaping попадают `item.symbol`, `signal.type`, `signal.label` и символ в двух `href`; `escapeHtml` применён только к `signal.reason`.
- **Реальный риск:** при текущем доверенном Binance TLS-канале эксплуатация требует вредоносного/скомпрометированного upstream, подменённого payload или будущего подключения недоверенного data adapter. Но sink реальный: строка вида HTML/кавычек может превратиться в разметку, атрибут или URL. CSP отсутствует, поэтому последствия усиливаются.
- **Способ исправления:** ввести единый allowlist/парсер допустимых Binance symbols; проверять, что payload соответствует подписке и известному universe; строить REST URL через `URL`/`URLSearchParams`; заменить динамический `innerHTML` на DOM API, `textContent` и безопасное присваивание `href`; валидировать class tokens; добавить тесты с HTML, кавычками, управляющими символами и malformed symbols.
- **Будут затронуты:** `engine.js`, `app.js`, возможно общий symbol helper и связанные тесты.
- **Конфликт с общей оптимизацией:** высокий — `app.js`, engine и подписки активно меняются.

### SEC-04 — Нет CSP и основных защитных HTTP-заголовков

- **Severity:** Medium
- **Файл и строки:** `index.html:3-12`; `server.js:8-14`; аналогично другие HTML entry points.
- **Доказательство:** в HTML отсутствует CSP meta; `server.js` отправляет только `content-type` и `cache-control`. Не заданы `Content-Security-Policy`, `X-Content-Type-Options`, `frame-ancestors`/`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`; HSTS зависит от production-хостинга.
- **Реальный риск:** существующий или будущий XSS получает меньше ограничений; приложение можно встраивать для clickjacking; браузер имеет более широкие разрешения на соединения, workers и загрузку ресурсов.
- **Способ исправления:** после стабилизации runtime настроить HTTP CSP с `default-src 'self'`, минимальными `connect-src` для Binance REST/WSS, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `worker-src 'self'`; добавить `nosniff`, referrer/permissions policy и HSTS на HTTPS-хостинге. Текущие inline styles/scripts потребуют nonce/hash либо выноса в файлы. CSP meta может быть временным частичным решением, но `frame-ancestors` должен приходить HTTP-заголовком.
- **Будут затронуты:** deployment/server config, `server.js`, `index.html`, `refresh.html`, `reset-v26.html` и лабораторные HTML.
- **Конфликт с общей оптимизацией:** высокий; серверную конфигурацию и Service Worker сейчас не менять.

### SEC-05 — Reset-страницы воздействуют на весь origin

- **Severity:** Medium
- **Файл и строки:** `refresh.html:15-25`; `reset-v26.html:47-60`.
- **Доказательство:** `refresh.html` автоматически, без пользовательского подтверждения, unregister-ит все Service Worker registrations и удаляет все Cache Storage keys текущего origin. `reset-v26.html` требует click и фильтрует cache keys по `inpuls-`, но всё равно unregister-ит все registrations.
- **Реальный риск:** если на одном GitHub Pages/custom-domain origin размещены другие PWA, переход по reset URL отключит их Service Worker; `refresh.html` также очистит их caches. Это availability/offline-data риск и удобная ссылка для внешнего инициирования сброса.
- **Способ исправления:** после optimization решить, нужна ли legacy `refresh.html`; в любом случае требовать явный click, ограничивать registrations по InPuls scope/script URL и удалять только cache keys с `inpuls-`; добавить regression tests.
- **Будут затронуты:** `refresh.html`, `reset-v26.html`, UI/runtime tests.
- **Конфликт с общей оптимизацией:** высокий — напрямую пересекается с текущей логикой Service Worker и recovery.

### SEC-06 — Исторические self-modifying GitHub Actions ослабляют supply-chain и provenance

- **Severity:** Medium
- **Файл и строки:** исторический, сейчас удалённый `.github/workflows/apply-tape-v2-core.yml:1-440` в commit `35f8992e…`; исторический `.github/workflows/apply-guarded-raw-tape.yml:1-41`, удалённый в `68714eed…`.
- **Доказательство:** workflow имел `permissions: contents: write`, использовал `actions/checkout@v4` по изменяемому major tag, разворачивал большой base64-encoded transformer, делал `git add -A`, commit и push, после чего удалял сам workflow. В истории найдено 15 коммитов от `github-actions[bot]`; они создавали/меняли `app.js`, `index.html`, `orderbook.js`, `orderbook-worker.js`, `orderbook-flow-workspace.js`, `orderbook-tape-layout.js`, `orderbook-tape-latency.js`, `sw.js`, `reset-v26.html` и тесты. Активных workflows сейчас нет.
- **Реальный риск:** активного RCE через этот workflow сейчас нет, однако encoded/self-deleting генерация затрудняет review и установление цепочки происхождения. Возврат старой ветки/workflow или повторение паттерна вновь даст write-capable action возможность менять runtime. Bot author не фиксирует фактического автора, инструмент, prompt и основание прав.
- **Способ исправления:** после optimization провести отдельный line-by-line review bot-generated diff без массового рефакторинга; создать provenance register `commit → оператор → инструмент/model → prompt/task → review`; будущие Actions закреплять полным commit SHA — GitHub указывает, что это единственный immutable способ pinning: [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use); permissions по умолчанию read-only, изменения только через PR/review, без encoded и self-deleting transformers.
- **Будут затронуты:** `docs/security/`/provenance records; будущие `.github/workflows/*`, `CODEOWNERS`; runtime только в рамках отдельного review.
- **Конфликт с общей оптимизацией:** высокий для runtime-review и workflow; документация конфликтует слабо.

### SEC-07 — Нельзя подтвердить чистое лицензирование и происхождение всех артефактов

- **Severity:** Medium
- **Файл и строки:** `LICENSE`, `NOTICE`, `THIRD_PARTY*` отсутствуют; `package.json:1-9` не содержит license; `assets/inpuls-world-map-v17.png` — binary; `icon.svg:1-9`; новый `orderbook-density.js:1-718` и bot-touched файлы требуют provenance record.
- **Доказательство:** в репозитории нет лицензии/NOTICE/реестра источников. У PNG нет полезных author/copyright metadata, у SVG нет атрибуции. Ограниченный exact-string поиск по характерным идентификаторам текущего кода не дал достоверных внешних совпадений, но это не доказывает оригинальность. Git-авторство фиксирует аккаунт или bot, а не реальный источник фрагмента. Если код создавался через OpenAI, действующие европейские terms указывают, что между пользователем и OpenAI output принадлежит пользователю, но output может быть неуникальным и может содержать third-party material: [OpenAI Europe Terms of Use](https://openai.com/policies/eu-terms-of-use/).
- **Реальный риск:** неизвестный источник карты, иконки или сгенерированного/заимствованного фрагмента может привести к требованию удаления, атрибуции, раскрытия производного кода или компенсации. Отсутствие license сохраняет default copyright, но не создаёт доказательную цепочку собственности. GitHub отдельно объясняет default copyright при отсутствии лицензии: [Licensing a repository](https://docs.github.com/articles/licensing-a-repository).
- **Способ исправления:** сохранить исходники/промпты/дату/инструмент для карты и иконки либо заменить их на доказуемо собственные; для AI/WORK-изменений хранить task/commit/reviewer mapping; после юридического решения добавить proprietary LICENSE, NOTICE и third-party inventory, не добавляя автоматически MIT/Apache; перед монетизацией отдельно проверить Binance API/market-data terms: [Binance Terms](https://www.binance.com/en/terms), [Binance API](https://www.binance.com/en/binance-api).
- **Будут затронуты:** будущие `LICENSE`, `NOTICE`, `THIRD_PARTY*`, `docs/security/`; возможно `assets/*`, если происхождение не подтвердится.
- **Конфликт с общей оптимизацией:** низкий для документации, средний при замене ассетов; решение по лицензии лучше принять после optimization.

### SEC-08 — Публичная Git-история раскрывает личный email

- **Severity:** Medium
- **Файл и строки:** Git commit metadata, строк в runtime нет.
- **Доказательство:** большая часть commit history содержит личный Gmail-адрес автора. Сам адрес в отчёте намеренно не воспроизводится.
- **Реальный риск:** spam, phishing, корреляция аккаунтов и doxxing. Перевод репозитория в private не удалит адрес из уже скачанных копий.
- **Способ исправления:** включить GitHub noreply email и блокировку command-line pushes, раскрывающих email; обновить локальный git config для будущих коммитов. Переписывание истории рассматривать только отдельно после private/optimization и с осознанием, что это destructive migration, меняющая все SHA и не удаляющая старые клоны.
- **Будут затронуты:** GitHub email settings, локальная Git-конфигурация; при отдельном решении — вся Git history.
- **Конфликт с общей оптимизацией:** низкий для будущих коммитов; критически высокий для history rewrite — сейчас запрещено.

### SEC-09 — Нет `.gitignore` и профилактики утечки будущих backend-секретов

- **Severity:** Medium
- **Файл и строки:** `.gitignore` отсутствует; `.env.example` отсутствует; активного CI secret scan config нет.
- **Доказательство:** текущий frontend не хранит ключей, и секретов в текущем snapshot не найдено, но репозиторий не исключает `.env`, ключи, дампы БД, логи и локальные credentials. Планируемый backend увеличит риск.
- **Реальный риск:** секрет можно случайно закоммитить и опубликовать; простое последующее удаление файла не убирает его из Git history и уже сделанных clones.
- **Способ исправления:** после optimization добавить строгий `.gitignore`, безопасный `.env.example` без значений, local/pre-commit gitleaks и GitHub secret scanning/push protection. Доступность security features для private repositories зависит от плана GitHub: [GitHub Secret Protection billing](https://docs.github.com/enterprise-cloud%40latest/billing/concepts/product-billing/github-advanced-security).
- **Будут затронуты:** `.gitignore`, `.env.example`, будущий CI/pre-commit config.
- **Конфликт с общей оптимизацией:** низкий, но любые изменения отложены по условию первого этапа.

### SEC-10 — Malformed URI завершает локальный Node server

- **Severity:** Low сейчас; Medium, если этот server станет сетевым/production.
- **Файл и строки:** `server.js:8-14`, критическая операция `decodeURIComponent` на строке 9.
- **Доказательство:** запрос `GET /%E0%A4%A` вызывает необработанный `URIError: URI malformed`, после чего Node process завершается. Проверенный encoded traversal не выдал `/etc/passwd`, то есть подтверждён crash, а не traversal. Сейчас listener привязан к `127.0.0.1`.
- **Реальный риск:** локальный denial of service; при будущем внешнем bind/reverse proxy любой удалённый клиент сможет уронить процесс одним запросом.
- **Способ исправления:** обернуть URL parsing/decoding в обработку ошибок и возвращать 400; зафиксировать document root; корректно обрабатывать methods/status; добавить security headers и regression tests, если server используется вне локальной разработки.
- **Будут затронуты:** `server.js`, новые server/security tests.
- **Конфликт с общей оптимизацией:** средний, если другой чат меняет dev server.

### SEC-11 — Service Worker активируется с неполным app shell

- **Severity:** Low
- **Файл и строки:** `sw.js:47-65`, `sw.js:78-113` на baseline `0888f5e9…`.
- **Доказательство:** install использует `Promise.allSettled(SHELL.map(cache.add))` и затем `skipWaiting()`, поэтому failed required asset не останавливает установку. Activate удаляет старые `inpuls-` caches и вызывает `clients.claim()`. Любой успешный same-origin GET кешируется без проверки MIME/build integrity.
- **Реальный риск:** пользователь может получить смешанную/неполную offline-сборку; старый рабочий cache уже удалён. При локальном server fallback отсутствующий JS может прийти как `index.html` с HTTP 200 и сохраниться под JS request, ломая offline runtime. Прямого захвата данных не показано.
- **Способ исправления:** обязательные shell assets устанавливать атомарно (`addAll` или эквивалент), optional assets — отдельно; активировать/claim только coherent build; проверять response content type и release manifest перед cache put.
- **Будут затронуты:** `sw.js`, Service Worker/cache tests.
- **Конфликт с общей оптимизацией:** очень высокий — Service Worker и release versioning сейчас активно меняются; не исправлять до завершения optimization PR.

### SEC-12 — IndexedDB ограничен на запись, но не по числу series/symbol records

- **Severity:** Low
- **Файл и строки:** `chart.js:147-178`; `orderbook.js:649-690`.
- **Доказательство:** каждая candle series обрезается до 30 000 значений, каждый trade record — до `MAX_TRADE_HISTORY`, но нет LRU/TTL или глобального лимита числа ключей/символов. Ошибки транзакций поглощаются.
- **Реальный риск:** при длительном использовании и множестве символов origin storage может исчерпать quota; новые записи тихо перестанут сохраняться, ухудшая историю, resume и offline-поведение. В БД хранится публичная market data, не персональные секреты.
- **Способ исправления:** добавить `updatedAt`-based LRU/TTL, лимит records/bytes, обработку quota errors и миграционные тесты.
- **Будут затронуты:** `chart.js`, `orderbook.js`, IndexedDB/storage tests.
- **Конфликт с общей оптимизацией:** высокий — пересекается со стаканом и persistent history.

## Лицензии и внешние источники

| Компонент | Тип использования | Лицензия/условия | Вывод |
|---|---|---|---|
| First-party JS/HTML/CSS | Включён в продукт | Repository license отсутствует; default copyright | Не добавлять permissive license без отдельного бизнес-решения |
| `actions/checkout@v4` | Только исторический GitHub workflow; в продукт не бандлится | MIT: [actions/checkout](https://github.com/actions/checkout) | Несовместимость не обнаружена; future pin только на полный SHA |
| Binance REST/WSS market data | Внешний API/data service, не JS dependency | Binance Terms/API terms | Нужна отдельная проверка коммерческого использования/redistribution до paid launch |
| Inter | Только имя в CSS font stack; файл шрифта не бандлится и не загружается | Не применяется к текущему artifact | Текущей redistributable font dependency нет |
| TradingView/Binance web pages | Обычные внешние ссылки | Условия соответствующих сайтов | Код/SDK не включены |
| `assets/inpuls-world-map-v17.png` | Бинарный UI asset | Не установлена | Нужны источник, авторство и разрешение либо замена |
| `icon.svg` | UI asset | Не установлена | Нужны исходник/авторство либо явная фиксация как first-party |
| AI/WORK-generated output, если применимо | Возможные first-party изменения | Terms используемого инструмента + права на входные материалы | Нужна commit-level provenance; terms сами по себе не доказывают уникальность |

На текущем snapshot нет подтверждённой несовместимой open-source лицензии. Чистое заключение о происхождении пока невозможно из-за неизвестного происхождения карты/иконки и неполного provenance для bot/agent-generated изменений.

## Фрагменты и артефакты, происхождение которых нужно подтвердить

1. `assets/inpuls-world-map-v17.png`: оригинальный source file, автор, дата, инструмент, prompt/reference images и право коммерческого использования.
2. `icon.svg`: автор/исходник и дата создания.
3. Все 15 коммитов `github-actions[bot]`, особенно изменения core orderbook/runtime; установить operator/task/source для каждого.
4. `orderbook-density.js:1-718` из PR #45 и будущие WORK-chat commits: сохранить связь PR/commit с задачей, prompt/transcript, использованной моделью и человеческим review.
5. Крупные алгоритмические блоки в `engine.js`, `chart.js`, `orderbook*.js`: зафиксировать first-party authorship либо источник/лицензию. Exact-string search не нашёл убедительных совпадений, но поиск не является доказательством.

Рекомендуемый минимальный provenance record:

| Поле | Пример содержания |
|---|---|
| Commit/PR | SHA и номер PR |
| Компонент | Файлы/функции |
| Создатель | Человек, агент или workflow |
| Инструмент | Product/model/version, если применимо |
| Основание | Task/prompt/design source |
| Входные материалы | Ссылки, assets, лицензии |
| Reviewer | Кто проверил логику и происхождение |
| Решение | Accepted / rewritten / removed |

## Проверки после завершения optimization PR

Порядок следующего этапа, без автоматического начала исправлений:

1. Зафиксировать merge SHA финального optimization PR и повторить diff-aware security scan.
2. Полным clone прогнать historical secret scan (`gitleaks --all`) и сохранить машинный результат.
3. Перепроверить все строки findings после структурных перемещений.
4. Отдельно согласовать remediation-порядок: visibility → main protection → XSS/symbol validation → CSP/headers → reset/SW → storage/server.
5. Отдельно согласовать юридические артефакты: proprietary license/NOTICE/provenance register и судьбу неподтверждённых assets.

До отдельного подтверждения исправления не начинаются.
