# Rust Skin Stacker — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Цель:** открытое приложение для Windows и Linux, которое делит и собирает стопки скинов Rust в инвентаре Steam. До запуска показывает план, во время операции — ход, после — сверку количества.

**Архитектура:** Tauri 2. Ядро на Rust держит токен в памяти, ходит в Steam Web API, строит план чистыми функциями и выполняет шаги по одному с паузой. Окно на TypeScript без фреймворка: рисует DOM через `h()`, данные из Steam попадают в страницу только как текст. Ядро и окно общаются командами Tauri и событием `run-progress`.

**Стек:**
- Rust 2024: `tauri` 2.12, `tauri-plugin-opener` 2.7, `reqwest` 0.13 (rustls), `tokio`, `serde`, `serde_json`, `thiserror`, `base64`, `regex`, `url`; для тестов `wiremock`.
- Окно: TypeScript ~6.0, Vite 8, Vitest 5, `@tauri-apps/api` 2.12, `@tauri-apps/plugin-opener` 2.7, `@fontsource/manrope`, `@tabler/icons-webfont`.
- CI: GitHub Actions на `windows-latest` и `ubuntu-24.04`, `tauri-apps/tauri-action@v1`, `actions/attest@v4`.

**Источники:**
- спека — `docs/superpowers/specs/2026-10-26-rust-skin-stacker-design.md`;
- описание продукта — `PRODUCT.md`;
- утверждённые макеты — `docs/design/main-window-item.png`, `docs/design/main-window-plan.png`; их исходник — `docs/design/mockup/d-final.html`.

## Global Constraints

Каждая задача неявно включает эти требования.

**Steam и токен**
- Только Rust: `appid` = `252490`, `contextid` = `2`.
- Steam Web API: `https://api.steampowered.com`.
  - Чтение: `GET IEconService/GetInventoryItemsWithDescriptions/v1/` с `access_token`, `steamid`, `appid`, `contextid`, `get_descriptions=true`, `language`, `count=500`, `start_assetid`.
  - Разделение: `POST IInventoryService/SplitItemStack/v1/` с `access_token`, `appid`, `itemid`, `quantity=1`, `steamid`.
  - Сборка: `POST IInventoryService/CombineItemStacks/v1/` с `access_token`, `appid`, `fromitemid`, `destitemid`, `quantity`, `steamid`.
- Токен живёт только в памяти Rust-ядра.
  - Не пишется на диск, не возвращается в окно, не печатается в `Debug`, журнале и текстах ошибок.
  - Окну отдаётся только `TokenInfo { steamidMasked: "7656…4821", expiresAt }`.
  - Ошибки `reqwest` наружу не форматируются: в них есть URL с токеном.
- Страница токена: `https://steamcommunity.com/pointssummary/ajaxgetasyncconfig`. Окно открывает её в системном браузере, и это единственный адрес, разрешённый плагину opener. Ссылки «Страница проекта» в первой версии нет: аккаунт на GitHub ещё не выбран.

**Правила операций** (спека, «Операции и правила»)
- Перед запуском инвентарь перечитывается. Если шаги плана изменились, вместо запуска показывается новый план.
- Разделение: стопка из A штук — это `A−1` запросов `SplitItemStack` с `quantity=1`. «Отделить N» — это `min(N, сумма(A−1))` запросов, сначала из самой большой стопки.
- Сборка:
  - в одну стопку попадают только записи с одинаковыми `classid` и `instanceid`;
  - стопка назначения — самая большая запись группы, при равенстве — с меньшим `assetid`;
  - перед каждым запросом проверяется: `fromitemid ≠ destitemid`, совпадают `classid` и `instanceid`, `quantity` равно `amount` из свежего чтения.
- Повторы:
  - POST повторяется только при 429, максимум 3 ожидания. Ожидание — `Retry-After` или 10/20/30 с, но не дольше 60 с.
  - После сетевого сбоя POST не повторяется.
  - GET повторяется при 429, 5xx и сетевой ошибке, максимум 3 раза.
- Пауза между запросами: по умолчанию 1500 мс, в настройках от 500 до 10 000 мс.
- Остановка: после трёх неудач подряд, при 401/403, по кнопке «Остановить» (срабатывает после текущего запроса).
- После операции инвентарь перечитывается, и по каждому скину сравнивается сумма `amount` до и после.

**Окно**
- Цвета:
  - фон `#0f1117`, панель `#161922`, карточка `#1b1f2b`, `--card-2` `#232838`, `--img` `#20253a`, линии `#262b3a`;
  - текст `#eceef5` / `#9aa0b4` / `#6c7287`;
  - акцент `#5b5bf7`, при наведении `#7171ff`;
  - успех `#3ecf8e`, предупреждение `#f2b84b`, ошибка `#f0625f`.
  - Без неона, свечения и градиентного текста.
- Шрифт Manrope (`@fontsource/manrope`) и значки Tabler (`@tabler/icons-webfont`) подключаются из npm и собираются Vite. CDN нет.
- Числа в таблицах и счётчиках — `font-variant-numeric: tabular-nums`. Анимации 150–250 мс, при `prefers-reduced-motion` отключены.
- Данные из Steam никогда не вставляются через `innerHTML`, только как текст (`h()`, `textContent`). Картинки — только `iconUrl(hash, size)` на `https://community.akamai.steamstatic.com/economy/image/`.
- Все строки интерфейса — ключи в `src/i18n/en.json` и `src/i18n/ru.json` с одинаковым набором ключей. Русские тексты — простые и естественные, как в макетах.
- Клавиатура: Tab, стрелки по сетке, пробел выбирает, Enter открывает панель скина.

**Код и репозиторий**
- Название — Rust Skin Stacker. Слова «Steam» в названии нет. Лицензия GPL-3.0 (`GPL-3.0-only`). Пишем «Not affiliated with Valve or Facepunch» / «Не связано с Valve и Facepunch».
- В открытом репозитории нет реальных SteamID и ID предметов. В тестах SteamID `76561190000000001`, `assetid` вида `1001`.
- Комментарии в коде — на русском и короткие, как в Rust Trader. Тексты журнала и `Display` ошибок Rust — на английском: журнал прикладывают к issue.
- Работа идёт в ветке `feat/app`. Коммиты — `feat:`, `test:`, `ci:`, `docs:`, `chore:`, сообщение на русском, в конце трейлер `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Секретов в коде, тестах, коммитах и отчётах нет.

## Структура файлов

```
.cargo/config.toml            — AWS_LC_SYS_PREBUILT_NASM=1: rustls собирается на Windows без NASM
package.json, tsconfig.json, vite.config.ts, vitest.config.ts, index.html
app-icon.svg                  — исходник значка приложения
src-tauri/
  Cargo.toml, build.rs, tauri.conf.json
  capabilities/default.json   — события и открытие одной страницы токена
  icons/                      — генерирует `tauri icon`
  src/main.rs                 — точка входа, вызывает lib::run()
  src/lib.rs                  — Builder: плагин opener, AppState, команды
  src/token.rs                — токен из вставленного текста, Secret без Debug
  src/steam.rs                — HTTP к Steam, повторы, ошибки без URL
  src/inventory.rs            — страницы → скины и записи; сверка до/после
  src/plan.rs                 — операция + инвентарь → шаги; проверка шага
  src/journal.rs              — журнал для «Скопировать журнал»
  src/runner.rs               — выполнение шагов: пауза, 429, остановка
  src/settings.rs             — язык и пауза, файл в папке настроек
  src/commands.rs             — AppState и команды окна
src/
  main.ts                     — запуск: настройки, язык, экран
  types.ts                    — типы данных из ядра
  api.ts                      — invoke/listen/openUrl; в браузере без Tauri — демо-режим
  store.ts                    — состояние окна и подписка
  actions.ts                  — действия: загрузка, план, запуск, выбор
  model.ts                    — чистые функции: фильтр, сортировка, раскладка, выбор
  format.ts                   — числа, время, картинки
  dom.ts                      — h() и icon()
  i18n/index.ts, en.json, ru.json
  ui/login.ts                 — экран входа
  ui/shell.ts                 — каркас главного окна
  ui/topbar.ts, ui/filters.ts, ui/grid.ts, ui/virtual.ts
  ui/panel.ts                 — правая панель: выбор состояния
  ui/panel-select.ts          — подсказка, один скин, несколько
  ui/panel-run.ts             — план, ход, итог
  ui/settings.ts              — боковая панель настроек
  styles/tokens.css, styles/app.css
  dev/mock.ts, dev/demo-items.json — демо-режим для `npm run dev` в браузере
.github/workflows/ci.yml, .github/workflows/release.yml, .github/dependabot.yml
.github/ISSUE_TEMPLATE/bug_report.yml
README.md, README.ru.md, LICENSE, SECURITY.md
```

## Как проверять

- Тесты Rust: `cargo test --manifest-path src-tauri/Cargo.toml`. Lint: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`. Формат: `cargo fmt --manifest-path src-tauri/Cargo.toml --check`.
- `tauri::generate_context!()` требует, чтобы папка `dist/` существовала. Перед первой сборкой Rust выполни `npm run build`.
- Окно: `npm run check` (типы), `npm test` (Vitest), `npm run build`.
- Вид окна без Tauri: `npm run dev` поднимает Vite на `http://localhost:1420`. В обычном браузере приложение работает в демо-режиме с выдуманными количествами. Адреса `?demo=main`, `?demo=item`, `?demo=plan` открывают состояния макетов. Снимок 1280×800 (PowerShell, Vite уже запущен):
  ```powershell
  $out = "$env:TEMP\rss-shot.png"; Start-Process chrome.exe -ArgumentList @("--headless=new","--disable-gpu","--hide-scrollbars","--user-data-dir=$env:TEMP\rss-chrome","--virtual-time-budget=8000","--window-size=1280,800","--screenshot=$out","http://localhost:1420/?demo=item") -Wait -NoNewWindow; $out
  ```
- Живое окно: `npm run tauri dev`.

## Порядок задач

0. Окружение: Rust, ветка `feat/app`.
1. Каркас Tauri 2 + Vite + TypeScript, значок, CSP, права.
2. `token.rs`.
3. `steam.rs`.
4. `inventory.rs`.
5. `plan.rs`.
6. `journal.rs` и `runner.rs`.
7. `settings.rs`, `commands.rs`, подключение в `lib.rs`.
8. Основа окна: типы, API, демо-режим, i18n, форматирование, `h()`, стили.
9. Экран входа и запуск окна.
10. Главное окно: верхняя панель, фильтры, виртуальная сетка, выбор.
11. Правая панель: подсказка, скин с ползунком, несколько, план.
12. Ход операции, итог и сверка, плашки, меню, настройки.
13. CI, Dependabot, шаблон issue, SECURITY.md.
14. Релизы: сборки, SHA256SUMS, подтверждения происхождения.
15. README (EN, RU) и LICENSE.
16. Дизайн-проверка (impeccable, finish review) и DESIGN.md.
17. Ручная проверка на аккаунте владельца.

---

### Task 0: Окружение

Выполняет контроллер, не субагент: задача ставит программы на машину владельца.

- [ ] **Step 1: Поставить Rust через официальный rustup**

```powershell
$dst = "$env:TEMP\rustup-init.exe"
Invoke-WebRequest https://win.rustup.rs/x86_64 -OutFile $dst
& $dst -y --default-toolchain stable --profile minimal -c clippy -c rustfmt
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
cargo --version; rustc --version; cargo clippy --version; cargo fmt --version
```
Ожидается: `rustc` не ниже 1.90 (этого требует `tauri-plugin-opener` 2.7.2).

- [ ] **Step 2: Проверить MSVC и WebView2**

```powershell
& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property displayName
Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue | Select-Object pv
```
Ожидается: строка с Visual Studio (сейчас «Visual Studio Community 2026») и версия WebView2 в `pv`.

- [ ] **Step 3: Ветка**

```bash
git -C E:/project/rust-skin-stacker switch -c feat/app
```

---

### Task 1: Каркас Tauri 2 + Vite + TypeScript

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.ts`, `app-icon.svg`, `.cargo/config.toml`
- Create: `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/icons/*` (генерирует CLI)
- Modify: `.gitignore`

**Interfaces:**
- Produces:
  - lib-крейт `rust_skin_stacker_lib` с `pub fn run()`; модули ядра добавляются в него строками `pub mod …;`;
  - npm-скрипты `dev`, `build`, `check`, `test`, `tauri`;
  - окно `main` 1280×800;
  - CSP и права, которые не меняются в следующих задачах.

- [ ] **Step 1: Файлы фронтенда**

`package.json`:
```json
{
  "name": "rust-skin-stacker",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "license": "GPL-3.0-only",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "check": "tsc --noEmit",
    "test": "vitest run",
    "tauri": "tauri"
  },
  "dependencies": {
    "@fontsource/manrope": "^5.3.0",
    "@tabler/icons-webfont": "^3.49.0",
    "@tauri-apps/api": "^2.12.4",
    "@tauri-apps/plugin-opener": "^2.7.2"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.12.4",
    "typescript": "~6.0.3",
    "vite": "^8.3.5",
    "vitest": "^5.0.5"
  },
  "engines": {
    "node": ">=22.12"
  }
}
```

`tsconfig.json` (конфиги Vite и Vitest в проверку типов не входят: их читает сам Vite):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';

// Как в шаблоне Tauri: постоянный порт, папка src-tauri не отслеживается.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: { target: 'es2022' },
});
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Rust Skin Stacker</title>
    <script type="module" src="/src/main.ts"></script>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
```

`src/main.ts` (временный, в Task 9 заменяется):
```ts
document.querySelector('#app')!.textContent = 'Rust Skin Stacker';
```

- [ ] **Step 2: Поставить пакеты**

Run: `npm install`
Expected: появился `package-lock.json`, ошибок нет. Если какая-то из версий выше недоступна, поставь ближайшую в той же мажорной ветке и укажи это в отчёте.

- [ ] **Step 3: Файлы Rust**

`.cargo/config.toml` (в корне репозитория, чтобы его видели и `cargo` из `src-tauri`, и `tauri build`):
```toml
# aws-lc-sys (TLS для reqwest через rustls) на Windows x86-64 без этого требует NASM.
[env]
AWS_LC_SYS_PREBUILT_NASM = "1"
```

`src-tauri/Cargo.toml`:
```toml
[package]
name = "rust-skin-stacker"
version = "0.1.0"
description = "Split and combine stacks of Rust skins in your Steam inventory"
authors = ["Rust Skin Stacker contributors"]
license = "GPL-3.0-only"
edition = "2024"
rust-version = "1.90"

[lib]
# Суффикс _lib: на Windows имя библиотеки не должно совпадать с именем программы.
name = "rust_skin_stacker_lib"
crate-type = ["rlib"]

[build-dependencies]
tauri-build = { version = "2.7.4", features = [] }

[dependencies]
tauri = { version = "2.12.5", features = [] }
tauri-plugin-opener = "2.7.2"
serde = { version = "1.0.229", features = ["derive"] }
serde_json = "1.0.154"
thiserror = "2.0.21"
base64 = "0.23.1"
regex = "1"
url = "2.5.8"
reqwest = "0.13.5"
tokio = { version = "1.54.1", features = ["time", "sync"] }

[dev-dependencies]
wiremock = "0.6.5"
tokio = { version = "1.54.1", features = ["macros", "rt-multi-thread", "time", "sync"] }

[profile.release]
codegen-units = 1
lto = true
opt-level = 3
panic = "abort"
strip = true
```

`src-tauri/build.rs`:
```rust
fn main() {
    tauri_build::build()
}
```

`src-tauri/src/main.rs`:
```rust
// В релизной сборке под Windows не открывать консоль рядом с окном.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    rust_skin_stacker_lib::run();
}
```

`src-tauri/src/lib.rs` (в Task 7 дополняется):
```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

`src-tauri/tauri.conf.json`. В `targets` стоит `all`: на каждой ОС собирается то, что на ней поддерживается (Windows — NSIS и MSI, Linux — AppImage, deb, rpm).
```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Rust Skin Stacker",
  "version": "0.1.0",
  "identifier": "io.rustskinstacker.desktop",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Rust Skin Stacker",
        "width": 1280,
        "height": 800,
        "minWidth": 1024,
        "minHeight": 640,
        "center": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://community.akamai.steamstatic.com; font-src 'self' data:; connect-src ipc: http://ipc.localhost; object-src 'none'; base-uri 'none'; form-action 'none'",
      "devCsp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://community.akamai.steamstatic.com; font-src 'self' data:; connect-src ipc: http://ipc.localhost ws://localhost:1420; object-src 'none'; base-uri 'none'; form-action 'none'"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "category": "Utility",
    "shortDescription": "Split and combine stacks of Rust skins",
    "longDescription": "Open-source app that splits and combines stacks of Rust skins in your Steam inventory. Not affiliated with Valve or Facepunch.",
    "license": "GPL-3.0-only",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

`src-tauri/capabilities/default.json`. Окну разрешены только события и открытие страницы токена. `opener:default` не подключаем: он разрешает открывать любые адреса.
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Main window: app events and opening the Steam token page in the browser",
  "windows": ["main"],
  "permissions": [
    "core:event:default",
    {
      "identifier": "opener:allow-open-url",
      "allow": [{ "url": "https://steamcommunity.com/pointssummary/ajaxgetasyncconfig" }]
    }
  ]
}
```

- [ ] **Step 4: Значок приложения**

`app-icon.svg` — значок Tabler `stack-2` (MIT) на квадрате акцентного цвета:
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" rx="232" fill="#5b5bf7"/>
  <g transform="translate(152 152) scale(30)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 4l-8 4l8 4l8 -4l-8 -4"/>
    <path d="M4 12l8 4l8 -4"/>
    <path d="M4 16l8 4l8 -4"/>
  </g>
</svg>
```

Run: `npx tauri icon app-icon.svg`
Expected: в `src-tauri/icons/` появились `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico` и другие. Папки `src-tauri/icons/android` и `src-tauri/icons/ios` удали: мобильных сборок нет.

Если CLI ответит, что SVG не поддерживается, отрисуй PNG с прозрачным фоном и передай его:
```powershell
$png = "$PWD\app-icon.png"; Start-Process chrome.exe -ArgumentList @("--headless=new","--disable-gpu","--default-background-color=00000000","--user-data-dir=$env:TEMP\rss-chrome","--window-size=1024,1024","--screenshot=$png","file:///$($PWD -replace '\\','/')/app-icon.svg") -Wait -NoNewWindow
npx tauri icon app-icon.png
```
PNG в репозиторий не добавляй.

- [ ] **Step 5: .gitignore**

Допиши в конец `.gitignore`:
```
# Tauri: сгенерированные схемы прав
src-tauri/gen/

# Рабочие файлы субагентов
.superpowers/
```

- [ ] **Step 6: Проверить сборку**

Run:
```bash
npm run build
cargo build --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```
Expected: `dist/` создан, Rust собирается без ошибок и предупреждений. Первая сборка Tauri занимает несколько минут.

- [ ] **Step 7: Проверить окно**

Запусти `npm run tauri dev` в фоне. Дождись в выводе `Running` с путём к `rust-skin-stacker.exe` и убедись, что процесс жив (`Get-Process rust-skin-stacker`). В окне 1280×800 стоит текст «Rust Skin Stacker». Затем останови процессы `rust-skin-stacker` и `node`, которые запустила эта команда.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts index.html src/main.ts app-icon.svg .cargo/config.toml .gitignore src-tauri
git commit -m "chore: каркас Tauri 2 + Vite + TypeScript

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Перед коммитом проверь `git status`: в индексе не должно быть `src-tauri/target/`, `src-tauri/gen/`, `node_modules/`, `dist/`.

---

### Task 2: Токен (`token.rs`)

Перенос `rust_trader/steam/auth.py` с одним изменением: токен ищется во всём вставленном тексте. Пользователь копирует страницу `ajaxgetasyncconfig` целиком (Ctrl+A, Ctrl+C), а браузеры отдают её по-разному: как JSON или как текст с подписями.

**Files:**
- Create: `src-tauri/src/token.rs`
- Modify: `src-tauri/src/lib.rs` (строка `pub mod token;`)

**Interfaces:**
- Produces:
  - `pub struct Secret` с методом `expose(&self) -> &str`; Debug печатает `Secret(***)`;
  - `pub struct Token { pub secret: Secret, pub steamid: String, pub expires_at: i64 }` с методами `info()` и `is_expired(now)`;
  - `pub struct TokenInfo { steamid_masked, expires_at }`, в JSON `steamidMasked`, `expiresAt`;
  - `pub enum TokenError { NotFound, NoExpiry, Expired, SteamIdMismatch }`;
  - `pub fn parse_token(raw: &str, now: i64) -> Result<Token, TokenError>`;
  - `pub fn mask_steamid(id: &str) -> String`;
  - только для тестов: `pub(crate) fn test_token() -> Token` со значением `tok-SECRET-value`, SteamID `76561190000000001`, `expires_at = i64::MAX`.

- [ ] **Step 1: Тесты**

Создай `src-tauri/src/token.rs` пока только с модулем тестов и добавь в начало `src-tauri/src/lib.rs` строку `pub mod token;`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;

    const ID: &str = "76561190000000001";
    const NOW: i64 = 1_800_000_000;

    fn b64(s: &str) -> String {
        URL_SAFE_NO_PAD.encode(s)
    }

    /// Заголовок с пробелами, как у Steam: он кодируется в «eyAi…».
    fn jwt(payload: &str) -> String {
        format!("{}.{}.c2lnbmF0dXJl", b64(r#"{ "typ": "JWT", "alg": "EdDSA" }"#), b64(payload))
    }

    fn payload(sub: &str, exp: i64) -> String {
        format!(r#"{{"iss":"r:0","sub":"{sub}","aud":["web"],"exp":{exp}}}"#)
    }

    #[test]
    fn steam_header_starts_with_ey_ai() {
        assert!(jwt(&payload(ID, NOW + 10)).starts_with("eyAi"));
    }

    #[test]
    fn parses_bare_jwt() {
        let raw = jwt(&payload(ID, NOW + 3600));
        let token = parse_token(&raw, NOW).unwrap();
        assert_eq!(token.steamid, ID);
        assert_eq!(token.expires_at, NOW + 3600);
        assert_eq!(token.secret.expose(), raw);
    }

    #[test]
    fn parses_standard_jwt_header() {
        let raw = format!("{}.{}.c2ln", b64(r#"{"alg":"EdDSA","typ":"JWT"}"#), b64(&payload(ID, NOW + 60)));
        assert!(raw.starts_with("eyJ"));
        assert_eq!(parse_token(&raw, NOW).unwrap().steamid, ID);
    }

    #[test]
    fn parses_whole_page_json() {
        let token = jwt(&payload(ID, NOW + 60));
        let page = format!(r#"{{"success":1,"data":{{"webapi_token":"{token}","webapi_token_expiration":0}}}}"#);
        assert_eq!(parse_token(&page, NOW).unwrap().secret.expose(), token);
    }

    #[test]
    fn parses_page_copied_as_text() {
        let token = jwt(&payload(ID, NOW + 60));
        let text = format!("success: 1\ndata:\n  webapi_token: {token}\n  other: x");
        assert_eq!(parse_token(&text, NOW).unwrap().secret.expose(), token);
    }

    #[test]
    fn parses_cookie_with_encoded_separator() {
        let token = jwt(&payload(ID, NOW + 60));
        let cookie = format!("steamLoginSecure={ID}%7C%7C{token}");
        let parsed = parse_token(&cookie, NOW).unwrap();
        assert_eq!(parsed.secret.expose(), token);
        assert_eq!(parsed.steamid, ID);
    }

    #[test]
    fn rejects_cookie_with_other_steamid() {
        let token = jwt(&payload(ID, NOW + 60));
        let cookie = format!("76561190000000002||{token}");
        assert_eq!(parse_token(&cookie, NOW), Err(TokenError::SteamIdMismatch));
    }

    #[test]
    fn rejects_expired_token() {
        assert_eq!(parse_token(&jwt(&payload(ID, NOW)), NOW), Err(TokenError::Expired));
    }

    #[test]
    fn rejects_token_without_expiry() {
        let raw = jwt(&format!(r#"{{"sub":"{ID}"}}"#));
        assert_eq!(parse_token(&raw, NOW), Err(TokenError::NoExpiry));
    }

    #[test]
    fn rejects_text_without_token() {
        assert_eq!(parse_token("hello", NOW), Err(TokenError::NotFound));
        assert_eq!(parse_token("eyXX.not.base64!", NOW), Err(TokenError::NotFound));
    }

    #[test]
    fn skips_junk_candidate_before_real_token() {
        let token = jwt(&payload(ID, NOW + 60));
        let text = format!("eyJunk.junk.junk {token}");
        assert_eq!(parse_token(&text, NOW).unwrap().secret.expose(), token);
    }

    #[test]
    fn debug_never_shows_secret() {
        let token = parse_token(&jwt(&payload(ID, NOW + 60)), NOW).unwrap();
        let shown = format!("{token:?}");
        assert!(!shown.contains(token.secret.expose()));
        assert!(shown.contains("***"));
    }

    #[test]
    fn info_masks_steamid() {
        let token = parse_token(&jwt(&payload(ID, NOW + 60)), NOW).unwrap();
        assert_eq!(token.info(), TokenInfo { steamid_masked: "7656…0001".into(), expires_at: NOW + 60 });
        assert!(!token.is_expired(NOW));
        assert!(token.is_expired(NOW + 60));
    }

    #[test]
    fn info_serializes_in_camel_case() {
        let info = TokenInfo { steamid_masked: "7656…0001".into(), expires_at: 5 };
        assert_eq!(serde_json::to_string(&info).unwrap(), r#"{"steamidMasked":"7656…0001","expiresAt":5}"#);
    }

    #[test]
    fn test_token_hides_its_value() {
        let token = test_token();
        assert!(!format!("{token:?}").contains("tok-SECRET"));
        assert!(!token.is_expired(NOW));
    }
}
```

- [ ] **Step 2: Убедиться, что тесты не собираются**

Run: `cargo test --manifest-path src-tauri/Cargo.toml token::`
Expected: ошибка компиляции, не найдены `parse_token`, `TokenInfo` и другие.

- [ ] **Step 3: Реализация**

Вставь над модулем тестов:

```rust
//! Токен Steam: находит JWT во вставленном тексте, проверяет срок и SteamID.
//! Значение токена не печатается ни в Debug, ни в журнале, ни в текстах ошибок.

use std::fmt;
use std::sync::OnceLock;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use regex::Regex;
use serde::Serialize;
use serde_json::Value;

/// Значение токена. Наружу отдаётся только через `expose()` — для запроса к Steam.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(***)")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Token {
    pub secret: Secret,
    pub steamid: String,
    /// Unix-время окончания, секунды.
    pub expires_at: i64,
}

/// То, что видит окно: сокращённый SteamID и срок.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenInfo {
    pub steamid_masked: String,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum TokenError {
    #[error("no Steam token found in the pasted text")]
    NotFound,
    #[error("the token has no expiry")]
    NoExpiry,
    #[error("the token has expired")]
    Expired,
    #[error("the SteamID in the cookie does not match the token")]
    SteamIdMismatch,
}

impl Token {
    pub fn info(&self) -> TokenInfo {
        TokenInfo { steamid_masked: mask_steamid(&self.steamid), expires_at: self.expires_at }
    }

    pub fn is_expired(&self, now: i64) -> bool {
        self.expires_at <= now
    }
}

/// «76561190000000001» → «7656…0001».
pub fn mask_steamid(id: &str) -> String {
    if id.len() <= 8 || !id.is_ascii() {
        return id.to_string();
    }
    format!("{}…{}", &id[..4], &id[id.len() - 4..])
}

/// Ищет токен в тексте: ответ `ajaxgetasyncconfig` целиком, сам `webapi_token`
/// или cookie `steamLoginSecure` (`steamid%7C%7Cjwt`). Возвращает первый годный.
/// Если годного нет, ошибка относится к первому кандидату, похожему на токен Steam.
pub fn parse_token(raw: &str, now: i64) -> Result<Token, TokenError> {
    let text = raw.replace("%7C", "|").replace("%7c", "|");
    let mut error = TokenError::NotFound;
    for cap in candidates().captures_iter(&text) {
        let cookie_steamid = cap.get(1).map(|m| m.as_str());
        match check(&cap[2], cookie_steamid, now) {
            Ok(token) => return Ok(token),
            Err(TokenError::NotFound) => {}
            Err(e) if error == TokenError::NotFound => error = e,
            Err(_) => {}
        }
    }
    Err(error)
}

fn candidates() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?:(\d{17})\|\|)?(ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)")
            .expect("valid regex")
    })
}

fn check(jwt: &str, cookie_steamid: Option<&str>, now: i64) -> Result<Token, TokenError> {
    let mut parts = jwt.split('.');
    let header = parts.next().and_then(decode).ok_or(TokenError::NotFound)?;
    let payload = parts.next().and_then(decode).ok_or(TokenError::NotFound)?;
    if !header.is_object() {
        return Err(TokenError::NotFound);
    }
    let steamid = payload
        .get("sub")
        .and_then(Value::as_str)
        .filter(|s| is_steamid(s))
        .ok_or(TokenError::NotFound)?;
    let expires_at = payload.get("exp").and_then(Value::as_i64).ok_or(TokenError::NoExpiry)?;
    if expires_at <= now {
        return Err(TokenError::Expired);
    }
    if cookie_steamid.is_some_and(|id| id != steamid) {
        return Err(TokenError::SteamIdMismatch);
    }
    Ok(Token { secret: Secret(jwt.to_string()), steamid: steamid.to_string(), expires_at })
}

fn decode(part: &str) -> Option<Value> {
    let bytes = URL_SAFE_NO_PAD.decode(part).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn is_steamid(s: &str) -> bool {
    s.len() == 17 && s.bytes().all(|b| b.is_ascii_digit())
}

/// Токен для тестов других модулей. SteamID выдуманный.
#[cfg(test)]
pub(crate) fn test_token() -> Token {
    Token {
        secret: Secret("tok-SECRET-value".to_string()),
        steamid: "76561190000000001".to_string(),
        expires_at: i64::MAX,
    }
}
```

Если в `base64` 0.23 изменились пути `Engine` или `URL_SAFE_NO_PAD`, поправь импорты по документации крейта и укажи это в отчёте.

- [ ] **Step 4: Тесты проходят**

Run: `cargo test --manifest-path src-tauri/Cargo.toml token::`
Expected: все 15 тестов PASS.

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` и `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
Expected: без замечаний. Если `cargo fmt` переносит строки, выполни `cargo fmt --manifest-path src-tauri/Cargo.toml` и закоммить результат.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/token.rs src-tauri/src/lib.rs
git commit -m "feat: разбор токена Steam из вставленного текста

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: HTTP к Steam (`steam.rs`)

Перенос `rust_trader/net.py` и `rust_trader/steam/api.py` с одним изменением: POST при 429 не ждёт сам, а возвращает `RateLimited`. Ожидание с отсчётом и кнопкой «Остановить» делает `runner.rs` (Task 6).

**Files:**
- Create: `src-tauri/src/steam.rs`
- Modify: `src-tauri/src/lib.rs` (строка `pub mod steam;`)

**Interfaces:**
- Consumes: `crate::token::{Token, test_token}`, `Token.secret.expose()`.
- Produces:
  - `pub const API_BASE: &str = "https://api.steampowered.com"`, `RUST_APPID = 252490`, `RUST_CONTEXTID = 2`, `PAGE_SIZE = 500`, `GET_RETRIES = 3`, `MAX_RETRY_AFTER = 60`;
  - `pub type SleepFn = Arc<dyn Fn(Duration) -> Pin<Box<dyn Future<Output = ()> + Send>> + Send + Sync>`;
  - `pub fn tokio_sleep() -> SleepFn`;
  - `pub enum SteamError { Auth(u16), RateLimited { retry_after: Option<u64> }, Http(u16), Rejected(i32), Network(&'static str), BadResponse, PagingLoop, TooLarge }` — `Debug + Clone + PartialEq + Eq + Display`;
  - `#[derive(Clone)] pub struct SteamClient` с методами:
    - `new(base: &str, sleep: SleepFn) -> Self`;
    - `async inventory_page(&self, token: &Token, start_assetid: Option<&str>, language: &str) -> Result<Value, SteamError>` — возвращает объект `response`;
    - `async split(&self, token: &Token, itemid: &str, quantity: u32) -> Result<(), SteamError>`;
    - `async combine(&self, token: &Token, from: &str, dest: &str, quantity: u32) -> Result<(), SteamError>`;
  - только для тестов: `pub(crate) fn recording_sleep() -> (SleepFn, Arc<Mutex<Vec<Duration>>>)` — пауза не ждёт, а записывает длительность.

- [ ] **Step 1: Тесты**

Создай `src-tauri/src/steam.rs` с модулем тестов и добавь в `lib.rs` строку `pub mod steam;`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::token::test_token;
    use serde_json::json;
    use wiremock::matchers::{body_string_contains, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const INV: &str = "/IEconService/GetInventoryItemsWithDescriptions/v1/";
    const SPLIT: &str = "/IInventoryService/SplitItemStack/v1/";
    const COMBINE: &str = "/IInventoryService/CombineItemStacks/v1/";
    /// Адрес, где никто не слушает: сбой сети.
    const DEAD: &str = "http://127.0.0.1:9";

    async fn setup() -> (MockServer, SteamClient, Arc<Mutex<Vec<Duration>>>) {
        let server = MockServer::start().await;
        let (sleep, slept) = recording_sleep();
        let client = SteamClient::new(&server.uri(), sleep);
        (server, client, slept)
    }

    fn secs(slept: &Arc<Mutex<Vec<Duration>>>) -> Vec<u64> {
        slept.lock().unwrap().iter().map(Duration::as_secs).collect()
    }

    fn empty_page() -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_json(json!({"response": {"total_inventory_count": 0}}))
    }

    #[tokio::test]
    async fn inventory_page_sends_params_and_returns_response() {
        let (server, client, _) = setup().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .and(query_param("access_token", "tok-SECRET-value"))
            .and(query_param("steamid", "76561190000000001"))
            .and(query_param("appid", "252490"))
            .and(query_param("contextid", "2"))
            .and(query_param("get_descriptions", "true"))
            .and(query_param("language", "english"))
            .and(query_param("count", "500"))
            .and(query_param("start_assetid", "42"))
            .respond_with(empty_page())
            .expect(1)
            .mount(&server)
            .await;
        let page = client.inventory_page(&test_token(), Some("42"), "english").await.unwrap();
        assert_eq!(page["total_inventory_count"], 0);
    }

    #[tokio::test]
    async fn inventory_page_waits_retry_after_on_429() {
        let (server, client, slept) = setup().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "2"))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET")).and(path(INV)).respond_with(empty_page()).mount(&server).await;
        client.inventory_page(&test_token(), None, "english").await.unwrap();
        assert_eq!(secs(&slept), vec![2]);
    }

    #[tokio::test]
    async fn retry_after_is_capped_at_60_seconds() {
        let (server, client, slept) = setup().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "600"))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET")).and(path(INV)).respond_with(empty_page()).mount(&server).await;
        client.inventory_page(&test_token(), None, "english").await.unwrap();
        assert_eq!(secs(&slept), vec![60]);
    }

    #[tokio::test]
    async fn inventory_page_gives_up_after_three_retries_on_5xx() {
        let (server, client, slept) = setup().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(ResponseTemplate::new(502))
            .expect(4)
            .mount(&server)
            .await;
        let err = client.inventory_page(&test_token(), None, "english").await.unwrap_err();
        assert_eq!(err, SteamError::Http(502));
        assert_eq!(secs(&slept), vec![10, 20, 30]);
    }

    #[tokio::test]
    async fn inventory_page_does_not_retry_401() {
        let (server, client, slept) = setup().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(ResponseTemplate::new(401))
            .expect(1)
            .mount(&server)
            .await;
        let err = client.inventory_page(&test_token(), None, "english").await.unwrap_err();
        assert_eq!(err, SteamError::Auth(401));
        assert!(secs(&slept).is_empty());
    }

    #[tokio::test]
    async fn inventory_page_without_response_is_bad() {
        let (server, client, _) = setup().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
            .mount(&server)
            .await;
        let err = client.inventory_page(&test_token(), None, "english").await.unwrap_err();
        assert_eq!(err, SteamError::BadResponse);
    }

    /// Медленный тест: на Windows отказ в соединении с локальным портом приходит примерно через секунду.
    #[tokio::test]
    async fn inventory_page_retries_network_errors() {
        let (sleep, slept) = recording_sleep();
        let client = SteamClient::new(DEAD, sleep);
        let err = client.inventory_page(&test_token(), None, "english").await.unwrap_err();
        assert!(matches!(err, SteamError::Network(_)));
        assert_eq!(secs(&slept), vec![5, 10, 15]);
    }

    #[tokio::test]
    async fn split_posts_form() {
        let (server, client, _) = setup().await;
        Mock::given(method("POST"))
            .and(path(SPLIT))
            .and(body_string_contains("appid=252490"))
            .and(body_string_contains("itemid=1001"))
            .and(body_string_contains("quantity=1"))
            .and(body_string_contains("steamid=76561190000000001"))
            .and(body_string_contains("access_token=tok-SECRET-value"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"response": {}})))
            .expect(1)
            .mount(&server)
            .await;
        client.split(&test_token(), "1001", 1).await.unwrap();
    }

    #[tokio::test]
    async fn combine_posts_form() {
        let (server, client, _) = setup().await;
        Mock::given(method("POST"))
            .and(path(COMBINE))
            .and(body_string_contains("fromitemid=1002"))
            .and(body_string_contains("destitemid=1001"))
            .and(body_string_contains("quantity=4"))
            .and(body_string_contains("steamid=76561190000000001"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"response": {}})))
            .expect(1)
            .mount(&server)
            .await;
        client.combine(&test_token(), "1002", "1001", 4).await.unwrap();
    }

    #[tokio::test]
    async fn post_returns_429_without_waiting() {
        let (server, client, slept) = setup().await;
        Mock::given(method("POST"))
            .and(path(SPLIT))
            .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "5"))
            .expect(1)
            .mount(&server)
            .await;
        let err = client.split(&test_token(), "1001", 1).await.unwrap_err();
        assert_eq!(err, SteamError::RateLimited { retry_after: Some(5) });
        assert!(secs(&slept).is_empty());
    }

    #[tokio::test]
    async fn post_does_not_retry_5xx() {
        let (server, client, _) = setup().await;
        Mock::given(method("POST"))
            .and(path(COMBINE))
            .respond_with(ResponseTemplate::new(500))
            .expect(1)
            .mount(&server)
            .await;
        let err = client.combine(&test_token(), "1002", "1001", 1).await.unwrap_err();
        assert_eq!(err, SteamError::Http(500));
    }

    #[tokio::test]
    async fn post_reports_eresult_rejection() {
        let (server, client, _) = setup().await;
        Mock::given(method("POST"))
            .and(path(SPLIT))
            .respond_with(ResponseTemplate::new(200).insert_header("x-eresult", "8"))
            .mount(&server)
            .await;
        let err = client.split(&test_token(), "1001", 1).await.unwrap_err();
        assert_eq!(err, SteamError::Rejected(8));
    }

    #[tokio::test]
    async fn post_network_error_is_not_retried() {
        let (sleep, slept) = recording_sleep();
        let client = SteamClient::new(DEAD, sleep);
        let err = client.split(&test_token(), "1001", 1).await.unwrap_err();
        assert!(matches!(err, SteamError::Network(_)));
        assert!(secs(&slept).is_empty());
        assert!(!format!("{err} {err:?}").contains("tok-SECRET"));
    }

    #[test]
    fn error_texts_never_contain_token_or_url() {
        let errors = [
            SteamError::Auth(401),
            SteamError::RateLimited { retry_after: Some(5) },
            SteamError::Http(500),
            SteamError::Rejected(8),
            SteamError::Network("connection failed"),
            SteamError::BadResponse,
            SteamError::PagingLoop,
            SteamError::TooLarge,
        ];
        for e in errors {
            let shown = format!("{e} {e:?}");
            assert!(!shown.contains("tok-SECRET"), "{shown}");
            assert!(!shown.contains("access_token"), "{shown}");
            assert!(!shown.contains("http"), "{shown}");
        }
    }
}
```

- [ ] **Step 2: Убедиться, что тесты не собираются**

Run: `cargo test --manifest-path src-tauri/Cargo.toml steam::`
Expected: ошибка компиляции, нет `SteamClient`, `SteamError` и `recording_sleep`.

- [ ] **Step 3: Реализация**

Вставь над модулем тестов:

```rust
//! HTTP к Steam Web API. В текстах ошибок нет ни URL, ни параметров, потому что
//! в них токен. Поэтому ошибки reqwest наружу никогда не форматируются.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
#[cfg(test)]
use std::sync::Mutex;
use std::time::Duration;

use reqwest::header::CONTENT_TYPE;
use serde_json::Value;
use url::{Url, form_urlencoded};

use crate::token::Token;

pub const API_BASE: &str = "https://api.steampowered.com";
pub const RUST_APPID: u32 = 252490;
pub const RUST_CONTEXTID: u32 = 2;
pub const PAGE_SIZE: u32 = 500;
/// Сколько раз повторять чтение инвентаря при 429, 5xx и сбое сети.
pub const GET_RETRIES: u64 = 3;
/// Дольше ждать по `Retry-After` не будем.
pub const MAX_RETRY_AFTER: u64 = 60;

/// Пауза, которую тесты подменяют записью длительности.
pub type SleepFn = Arc<dyn Fn(Duration) -> Pin<Box<dyn Future<Output = ()> + Send>> + Send + Sync>;

pub fn tokio_sleep() -> SleepFn {
    Arc::new(|d| Box::pin(tokio::time::sleep(d)))
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SteamError {
    #[error("Steam rejected the token (HTTP {0})")]
    Auth(u16),
    #[error("Steam asked to slow down (HTTP 429)")]
    RateLimited { retry_after: Option<u64> },
    #[error("Steam answered HTTP {0}")]
    Http(u16),
    #[error("Steam refused the request (eresult {0})")]
    Rejected(i32),
    #[error("network error: {0}")]
    Network(&'static str),
    #[error("unexpected response from Steam")]
    BadResponse,
    #[error("Steam returned the same inventory page twice")]
    PagingLoop,
    #[error("the inventory has too many pages")]
    TooLarge,
}

#[derive(Clone)]
pub struct SteamClient {
    http: reqwest::Client,
    base: String,
    sleep: SleepFn,
}

impl SteamClient {
    pub fn new(base: &str, sleep: SleepFn) -> Self {
        // Без редиректов: адрес с токеном не должен уйти на другой хост.
        let http = reqwest::Client::builder()
            .user_agent(concat!("RustSkinStacker/", env!("CARGO_PKG_VERSION")))
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(30))
            .build()
            .expect("HTTP client");
        Self { http, base: base.trim_end_matches('/').to_string(), sleep }
    }

    /// Одна страница инвентаря Rust: объект `response` из ответа Steam.
    /// Повторяется при 429, 5xx и сбое сети, не больше `GET_RETRIES` раз.
    pub async fn inventory_page(
        &self,
        token: &Token,
        start_assetid: Option<&str>,
        language: &str,
    ) -> Result<Value, SteamError> {
        let mut params = vec![
            ("access_token", token.secret.expose().to_string()),
            ("steamid", token.steamid.clone()),
            ("appid", RUST_APPID.to_string()),
            ("contextid", RUST_CONTEXTID.to_string()),
            ("get_descriptions", "true".to_string()),
            ("language", language.to_string()),
            ("count", PAGE_SIZE.to_string()),
        ];
        if let Some(start) = start_assetid {
            params.push(("start_assetid", start.to_string()));
        }
        let address = format!("{}/IEconService/GetInventoryItemsWithDescriptions/v1/", self.base);
        let url = Url::parse_with_params(&address, &params).map_err(|_| SteamError::BadResponse)?;
        let mut attempt: u64 = 0;
        loop {
            let outcome = match self.http.get(url.clone()).send().await {
                Ok(resp) => read_json(resp).await,
                Err(e) => Err(network(&e)),
            };
            let wait = match &outcome {
                Err(SteamError::Network(_)) => Some(5 * (attempt + 1)),
                Err(SteamError::RateLimited { retry_after }) => Some(retry_after.unwrap_or(10 * (attempt + 1))),
                Err(SteamError::Http(status)) if *status >= 500 => Some(10 * (attempt + 1)),
                _ => None,
            };
            match wait {
                Some(secs) if attempt < GET_RETRIES => {
                    attempt += 1;
                    (self.sleep)(Duration::from_secs(secs.min(MAX_RETRY_AFTER))).await;
                }
                _ => return outcome?.get("response").cloned().ok_or(SteamError::BadResponse),
            }
        }
    }

    pub async fn split(&self, token: &Token, itemid: &str, quantity: u32) -> Result<(), SteamError> {
        let fields = [
            ("appid", RUST_APPID.to_string()),
            ("itemid", itemid.to_string()),
            ("quantity", quantity.to_string()),
            ("steamid", token.steamid.clone()),
        ];
        self.post("IInventoryService/SplitItemStack/v1/", token, &fields).await
    }

    pub async fn combine(&self, token: &Token, from: &str, dest: &str, quantity: u32) -> Result<(), SteamError> {
        let fields = [
            ("appid", RUST_APPID.to_string()),
            ("fromitemid", from.to_string()),
            ("destitemid", dest.to_string()),
            ("quantity", quantity.to_string()),
            ("steamid", token.steamid.clone()),
        ];
        self.post("IInventoryService/CombineItemStacks/v1/", token, &fields).await
    }

    /// POST без повторов: после сбоя сети неизвестно, выполнил ли Steam запрос.
    /// 429 возвращается наверх, ожиданием с отсчётом управляет runner.
    async fn post(&self, method: &str, token: &Token, fields: &[(&str, String)]) -> Result<(), SteamError> {
        let body = form_urlencoded::Serializer::new(String::new())
            .extend_pairs(fields.iter().map(|(k, v)| (*k, v.as_str())))
            .append_pair("access_token", token.secret.expose())
            .finish();
        let resp = self
            .http
            .post(format!("{}/{}", self.base, method))
            .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .await
            .map_err(|e| network(&e))?;
        read_json(resp).await.map(|_| ())
    }
}

/// Статус, заголовок `x-eresult` и JSON. Пустое тело — пустой объект.
async fn read_json(resp: reqwest::Response) -> Result<Value, SteamError> {
    let status = resp.status().as_u16();
    if status == 401 || status == 403 {
        return Err(SteamError::Auth(status));
    }
    if status == 429 {
        return Err(SteamError::RateLimited { retry_after: retry_after(&resp) });
    }
    if !(200..300).contains(&status) {
        return Err(SteamError::Http(status));
    }
    if let Some(code) = header_number::<i32>(&resp, "x-eresult")
        && code != 1
    {
        return Err(SteamError::Rejected(code));
    }
    let bytes = resp.bytes().await.map_err(|e| network(&e))?;
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return Ok(Value::Object(serde_json::Map::new()));
    }
    serde_json::from_slice(&bytes).map_err(|_| SteamError::BadResponse)
}

fn header_number<T: std::str::FromStr>(resp: &reqwest::Response, name: &str) -> Option<T> {
    resp.headers().get(name)?.to_str().ok()?.trim().parse().ok()
}

fn retry_after(resp: &reqwest::Response) -> Option<u64> {
    header_number::<u64>(resp, "retry-after").map(|s| s.min(MAX_RETRY_AFTER))
}

/// Только вид сбоя: в тексте ошибки reqwest есть URL с токеном.
fn network(e: &reqwest::Error) -> SteamError {
    if e.is_timeout() {
        SteamError::Network("timeout")
    } else if e.is_connect() {
        SteamError::Network("connection failed")
    } else {
        SteamError::Network("request failed")
    }
}

/// Пауза для тестов: не ждёт, а записывает длительность.
#[cfg(test)]
pub(crate) fn recording_sleep() -> (SleepFn, Arc<Mutex<Vec<Duration>>>) {
    let slept = Arc::new(Mutex::new(Vec::new()));
    let log = slept.clone();
    let sleep: SleepFn = Arc::new(move |d| {
        log.lock().unwrap().push(d);
        Box::pin(async {})
    });
    (sleep, slept)
}
```

`if let … && …` — цепочка условий из Rust 2024 (стабильна с 1.88). Если компилятор её не принимает, замени на вложенный `if`.

- [ ] **Step 4: Тесты проходят**

Run: `cargo test --manifest-path src-tauri/Cargo.toml steam::`
Expected: 14 тестов PASS. `inventory_page_retries_network_errors` на Windows идёт несколько секунд, это нормально.

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` и `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
Expected: без замечаний.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/steam.rs src-tauri/src/lib.rs
git commit -m "feat: запросы к Steam с повторами и ошибками без токена

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Инвентарь и сверка (`inventory.rs`)

Перенос `rust_trader/steam/inventory.py` и `parsing.py`:
- нечитаемая запись не пропадает;
- курсор, который повторяется, — это ошибка, а не бесконечный цикл;
- `more_items` без курсора — ошибка: молча обрезать инвентарь нельзя.

Новое — группировка в скины и сверка до/после.

**Files:**
- Create: `src-tauri/src/inventory.rs`
- Modify: `src-tauri/src/lib.rs` (строка `pub mod inventory;`)

**Interfaces:**
- Consumes: `SteamClient::inventory_page`, `SteamError`, `Token`.
- Produces (все типы `Debug + Clone + PartialEq + Eq + Serialize`, в JSON camelCase):
  - `pub struct Record { assetid, classid, instanceid: String, amount: u32, tradable: bool, marketable: bool, available_after: Option<String> }`;
  - `pub struct Category { id: String, label: String }`;
  - `pub struct Skin { key: String, name: String, icon: Option<String>, category: Option<Category>, total: u32, records: Vec<Record> }`:
    - `key` — это `market_hash_name`, а если его нет, `class:<classid>`;
    - `records` отсортированы по убыванию `amount`, при равенстве — по `assetid`;
  - `pub struct Unreadable { assetid: Option<String>, amount: u32 }`;
  - `pub struct Inventory { skins: Vec<Skin>, unreadable: Vec<Unreadable> }` (`Default`), `skins` по возрастанию `key`, метод `total(&self) -> u64`;
  - `pub struct Mismatch { key, name: String, before: u32, after: u32 }`;
  - `pub struct Reconciliation { before: u64, after: u64, mismatches: Vec<Mismatch> }`;
  - `pub fn parse_pages(pages: &[Value]) -> Inventory`;
  - `pub async fn collect_pages<F, Fut>(get_page: F) -> Result<Vec<Value>, SteamError>`, где `F: FnMut(Option<String>) -> Fut`, `Fut: Future<Output = Result<Value, SteamError>>`;
  - `pub async fn load(client: &SteamClient, token: &Token, language: &str) -> Result<Inventory, SteamError>`;
  - `pub fn reconcile(before: &Inventory, after: &Inventory) -> Reconciliation`;
  - `pub const MAX_PAGES: usize = 100`.

- [ ] **Step 1: Тесты**

Создай `src-tauri/src/inventory.rs` с модулем тестов и добавь в `lib.rs` строку `pub mod inventory;`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::VecDeque;
    use std::future::ready;

    fn desc(classid: &str, instanceid: &str, hash: &str) -> Value {
        json!({
            "classid": classid, "instanceid": instanceid,
            "market_hash_name": hash, "market_name": hash, "name": hash,
            "icon_url": "abc_DEF-123", "tradable": 1, "marketable": 1,
            "tags": [
                {"category": "itemclass", "internal_name": "revolver", "localized_tag_name": "Revolver"},
                {"category": "steamcat", "internal_name": "steamcat.weapon", "localized_tag_name": "Weapon"}
            ]
        })
    }

    fn asset(assetid: &str, classid: &str, instanceid: &str, amount: &str) -> Value {
        json!({"appid": 252490, "contextid": "2", "assetid": assetid, "classid": classid,
               "instanceid": instanceid, "amount": amount})
    }

    fn page(assets: Vec<Value>, descriptions: Vec<Value>) -> Value {
        json!({"assets": assets, "descriptions": descriptions, "total_inventory_count": 0})
    }

    fn one_skin(inv: &Inventory) -> &Skin {
        assert_eq!(inv.skins.len(), 1, "{inv:?}");
        &inv.skins[0]
    }

    #[test]
    fn groups_records_of_one_skin_and_sorts_by_amount() {
        let inv = parse_pages(&[page(
            vec![asset("1001", "c1", "0", "1"), asset("1002", "c1", "0", "5"), asset("1003", "c1", "9", "4")],
            vec![desc("c1", "0", "Outlaw Revolver"), desc("c1", "9", "Outlaw Revolver")],
        )]);
        let skin = one_skin(&inv);
        assert_eq!(skin.key, "Outlaw Revolver");
        assert_eq!(skin.total, 10);
        let amounts: Vec<u32> = skin.records.iter().map(|r| r.amount).collect();
        assert_eq!(amounts, vec![5, 4, 1]);
        let ids: Vec<&str> = skin.records.iter().map(|r| r.assetid.as_str()).collect();
        assert_eq!(ids, vec!["1002", "1003", "1001"]);
        assert_eq!(skin.records[1].instanceid, "9");
        assert_eq!(inv.total(), 10);
    }

    #[test]
    fn reads_description_fields() {
        let inv = parse_pages(&[page(vec![asset("1001", "c1", "0", "2")], vec![desc("c1", "0", "Tempered AK47")])]);
        let skin = one_skin(&inv);
        assert_eq!(skin.name, "Tempered AK47");
        assert_eq!(skin.icon.as_deref(), Some("abc_DEF-123"));
        assert_eq!(skin.category, Some(Category { id: "steamcat.weapon".into(), label: "Weapon".into() }));
        let record = &skin.records[0];
        assert!(record.tradable && record.marketable);
        assert_eq!(record.available_after, None);
    }

    #[test]
    fn untradable_item_keeps_date() {
        let mut d = desc("c1", "0", "Twitch Hoodie");
        d["tradable"] = json!(0);
        d["marketable"] = json!(0);
        d["cache_expiration"] = json!("2026-11-02T07:00:00Z");
        let inv = parse_pages(&[page(vec![asset("1001", "c1", "0", "1")], vec![d])]);
        let record = &one_skin(&inv).records[0];
        assert!(!record.tradable && !record.marketable);
        assert_eq!(record.available_after.as_deref(), Some("2026-11-02T07:00:00Z"));
    }

    #[test]
    fn rejects_unsafe_icon_hash() {
        let mut d = desc("c1", "0", "Skin");
        d["icon_url"] = json!("../evil?x");
        let inv = parse_pages(&[page(vec![asset("1001", "c1", "0", "1")], vec![d])]);
        assert_eq!(one_skin(&inv).icon, None);
    }

    #[test]
    fn missing_description_falls_back_to_classid() {
        let inv = parse_pages(&[page(vec![asset("1001", "c7", "0", "3")], vec![])]);
        let skin = one_skin(&inv);
        assert_eq!(skin.key, "class:c7");
        assert_eq!(skin.name, "classid c7");
        assert_eq!(skin.icon, None);
        assert_eq!(skin.category, None);
    }

    #[test]
    fn missing_amount_means_one_and_numeric_ids_are_read() {
        let raw = json!({"assetid": 1001, "classid": 7, "instanceid": 0});
        let inv = parse_pages(&[page(vec![raw], vec![])]);
        let record = &one_skin(&inv).records[0];
        assert_eq!(record.assetid, "1001");
        assert_eq!(record.classid, "7");
        assert_eq!(record.amount, 1);
    }

    #[test]
    fn unreadable_records_are_kept_and_counted() {
        let inv = parse_pages(&[page(
            vec![
                json!({"classid": "c1", "amount": "3"}),
                asset("1002", "c1", "0", "0"),
                asset("1003", "c1", "0", "abc"),
                json!("junk"),
                json!({"assetid": "1004", "amount": "2"}),
                asset("1005", "c1", "0", "2"),
            ],
            vec![desc("c1", "0", "Skin")],
        )]);
        assert_eq!(
            inv.unreadable,
            vec![
                Unreadable { assetid: None, amount: 3 },
                Unreadable { assetid: Some("1002".into()), amount: 1 },
                Unreadable { assetid: Some("1003".into()), amount: 1 },
                Unreadable { assetid: None, amount: 1 },
                Unreadable { assetid: Some("1004".into()), amount: 2 },
            ]
        );
        assert_eq!(one_skin(&inv).total, 2);
        assert_eq!(inv.total(), 10);
    }

    #[test]
    fn merges_descriptions_across_pages() {
        let inv = parse_pages(&[
            page(vec![], vec![desc("c1", "0", "Skin")]),
            page(vec![asset("1001", "c1", "0", "1")], vec![]),
        ]);
        assert_eq!(one_skin(&inv).name, "Skin");
    }

    #[test]
    fn skins_are_ordered_by_key() {
        let inv = parse_pages(&[page(
            vec![asset("1", "c2", "0", "1"), asset("2", "c1", "0", "1")],
            vec![desc("c2", "0", "Zebra"), desc("c1", "0", "Alpha")],
        )]);
        let keys: Vec<&str> = inv.skins.iter().map(|s| s.key.as_str()).collect();
        assert_eq!(keys, vec!["Alpha", "Zebra"]);
    }

    #[tokio::test]
    async fn collects_pages_until_more_items_is_false() {
        let mut replies: VecDeque<Result<Value, SteamError>> = VecDeque::from([
            Ok(json!({"assets": [], "more_items": 1, "last_assetid": "10"})),
            Ok(json!({"assets": [], "total_inventory_count": 0})),
        ]);
        let mut starts = Vec::new();
        let pages = collect_pages(|start| {
            starts.push(start);
            ready(replies.pop_front().unwrap())
        })
        .await
        .unwrap();
        assert_eq!(pages.len(), 2);
        assert_eq!(starts, vec![None, Some("10".to_string())]);
    }

    #[tokio::test]
    async fn repeated_cursor_is_a_loop() {
        let err = collect_pages(|_| ready(Ok(json!({"assets": [], "more_items": true, "last_assetid": "10"}))))
            .await
            .unwrap_err();
        assert_eq!(err, SteamError::PagingLoop);
    }

    #[tokio::test]
    async fn more_items_without_cursor_is_bad() {
        let err = collect_pages(|_| ready(Ok(json!({"assets": [], "more_items": true})))).await.unwrap_err();
        assert_eq!(err, SteamError::BadResponse);
    }

    #[tokio::test]
    async fn page_that_is_not_an_inventory_is_bad() {
        for bad in [json!([]), json!({}), json!({"assets": "x", "total_inventory_count": 1})] {
            let err = collect_pages(|_| ready(Ok(bad.clone()))).await.unwrap_err();
            assert_eq!(err, SteamError::BadResponse, "{bad}");
        }
    }

    #[tokio::test]
    async fn endless_inventory_is_too_large() {
        let mut n = 0;
        let err = collect_pages(|_| {
            n += 1;
            ready(Ok(json!({"assets": [], "more_items": true, "last_assetid": n.to_string()})))
        })
        .await
        .unwrap_err();
        assert_eq!(err, SteamError::TooLarge);
        assert_eq!(n, MAX_PAGES);
    }

    #[tokio::test]
    async fn steam_error_is_passed_through() {
        let err = collect_pages(|_| ready(Err(SteamError::Auth(401)))).await.unwrap_err();
        assert_eq!(err, SteamError::Auth(401));
    }

    #[test]
    fn reconcile_matches_when_counts_are_equal() {
        let before = parse_pages(&[page(vec![asset("1", "c1", "0", "3")], vec![desc("c1", "0", "Skin")])]);
        let after = parse_pages(&[page(
            vec![asset("1", "c1", "0", "1"), asset("2", "c1", "0", "1"), asset("3", "c1", "0", "1")],
            vec![desc("c1", "0", "Skin")],
        )]);
        let r = reconcile(&before, &after);
        assert_eq!(r, Reconciliation { before: 3, after: 3, mismatches: vec![] });
    }

    #[test]
    fn reconcile_lists_every_changed_skin() {
        let before = parse_pages(&[page(vec![asset("1", "c1", "0", "3")], vec![desc("c1", "0", "Skin")])]);
        let after = parse_pages(&[page(
            vec![asset("1", "c1", "0", "2"), asset("5", "c2", "0", "1")],
            vec![desc("c1", "0", "Skin"), desc("c2", "0", "New")],
        )]);
        let r = reconcile(&before, &after);
        assert_eq!(r.before, 3);
        assert_eq!(r.after, 3);
        assert_eq!(
            r.mismatches,
            vec![
                Mismatch { key: "New".into(), name: "New".into(), before: 0, after: 1 },
                Mismatch { key: "Skin".into(), name: "Skin".into(), before: 3, after: 2 },
            ]
        );
    }
}
```

- [ ] **Step 2: Убедиться, что тесты не собираются**

Run: `cargo test --manifest-path src-tauri/Cargo.toml inventory::`
Expected: ошибка компиляции, нет `parse_pages`, `collect_pages`, `reconcile`.

- [ ] **Step 3: Реализация**

Вставь над модулем тестов:

```rust
//! Ответ Steam → скины Rust. Нечитаемая запись не пропадает: она попадает
//! в `unreadable` и учитывается в общем количестве.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::future::Future;

use serde::Serialize;
use serde_json::Value;

use crate::steam::{SteamClient, SteamError};
use crate::token::Token;

/// 100 страниц по 500 записей — с запасом для инвентаря на тысячи предметов.
pub const MAX_PAGES: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub assetid: String,
    pub classid: String,
    pub instanceid: String,
    pub amount: u32,
    pub tradable: bool,
    pub marketable: bool,
    /// `cache_expiration` из описания, если предмет пока нельзя обменять.
    pub available_after: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skin {
    /// `market_hash_name`, а без него `class:<classid>`.
    pub key: String,
    pub name: String,
    /// Хеш картинки на CDN Steam, только `[A-Za-z0-9_-]`.
    pub icon: Option<String>,
    pub category: Option<Category>,
    pub total: u32,
    /// По убыванию `amount`, при равенстве — по `assetid`.
    pub records: Vec<Record>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Unreadable {
    pub assetid: Option<String>,
    pub amount: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inventory {
    /// По возрастанию `key`.
    pub skins: Vec<Skin>,
    pub unreadable: Vec<Unreadable>,
}

impl Inventory {
    /// Все штуки, включая нечитаемые записи.
    pub fn total(&self) -> u64 {
        let skins: u64 = self.skins.iter().map(|s| u64::from(s.total)).sum();
        let unreadable: u64 = self.unreadable.iter().map(|u| u64::from(u.amount)).sum();
        skins + unreadable
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mismatch {
    pub key: String,
    pub name: String,
    pub before: u32,
    pub after: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reconciliation {
    pub before: u64,
    pub after: u64,
    pub mismatches: Vec<Mismatch>,
}

/// Весь инвентарь Rust: все страницы, затем разбор.
pub async fn load(client: &SteamClient, token: &Token, language: &str) -> Result<Inventory, SteamError> {
    let pages =
        collect_pages(|start| async move { client.inventory_page(token, start.as_deref(), language).await }).await?;
    Ok(parse_pages(&pages))
}

/// Страницы подряд по курсору `last_assetid`, пока Steam отвечает `more_items`.
pub async fn collect_pages<F, Fut>(mut get_page: F) -> Result<Vec<Value>, SteamError>
where
    F: FnMut(Option<String>) -> Fut,
    Fut: Future<Output = Result<Value, SteamError>>,
{
    let mut pages = Vec::new();
    let mut start = None;
    let mut seen = HashSet::new();
    for _ in 0..MAX_PAGES {
        let page = get_page(start.take()).await?;
        let Some(obj) = page.as_object() else {
            return Err(SteamError::BadResponse);
        };
        if !obj.contains_key("assets") && !obj.contains_key("total_inventory_count") {
            return Err(SteamError::BadResponse);
        }
        if obj.get("assets").is_some_and(|a| !a.is_array()) {
            return Err(SteamError::BadResponse);
        }
        let more = truthy(obj.get("more_items"));
        let cursor = id_of(obj.get("last_assetid"));
        pages.push(page);
        if !more {
            return Ok(pages);
        }
        // Следующая страница есть, а курсора нет: молча обрезать инвентарь нельзя.
        let cursor = cursor.ok_or(SteamError::BadResponse)?;
        if !seen.insert(cursor.clone()) {
            return Err(SteamError::PagingLoop);
        }
        start = Some(cursor);
    }
    Err(SteamError::TooLarge)
}

pub fn parse_pages(pages: &[Value]) -> Inventory {
    let mut descriptions: HashMap<(String, String), &Value> = HashMap::new();
    let mut assets: Vec<&Value> = Vec::new();
    for page in pages {
        for d in array(page.get("descriptions")) {
            if let Some(classid) = id_of(d.get("classid")) {
                descriptions.insert((classid, instance_of(d)), d);
            }
        }
        assets.extend(array(page.get("assets")));
    }

    let mut skins: BTreeMap<String, Skin> = BTreeMap::new();
    let mut unreadable = Vec::new();
    for raw in assets {
        let Some((assetid, classid, amount)) = read_asset(raw) else {
            unreadable.push(Unreadable { assetid: id_of(raw.get("assetid")), amount: amount_or_one(raw.get("amount")) });
            continue;
        };
        let instanceid = instance_of(raw);
        let desc = descriptions.get(&(classid.clone(), instanceid.clone())).copied();
        let key = skin_key(desc, &classid);
        let skin = skins.entry(key.clone()).or_insert_with(|| new_skin(key, desc, &classid));
        skin.total = skin.total.saturating_add(amount);
        skin.records.push(Record {
            assetid,
            classid,
            instanceid,
            amount,
            tradable: flag(desc, "tradable"),
            marketable: flag(desc, "marketable"),
            available_after: available_after(desc),
        });
    }
    let mut skins: Vec<Skin> = skins.into_values().collect();
    for skin in &mut skins {
        skin.records.sort_by(|a, b| b.amount.cmp(&a.amount).then_with(|| a.assetid.cmp(&b.assetid)));
    }
    Inventory { skins, unreadable }
}

/// Сумма `amount` по каждому скину до и после операции.
pub fn reconcile(before: &Inventory, after: &Inventory) -> Reconciliation {
    let mut totals: BTreeMap<&str, (&str, u32, u32)> = BTreeMap::new();
    for skin in &before.skins {
        totals.entry(skin.key.as_str()).or_insert((skin.name.as_str(), 0, 0)).1 += skin.total;
    }
    for skin in &after.skins {
        totals.entry(skin.key.as_str()).or_insert((skin.name.as_str(), 0, 0)).2 += skin.total;
    }
    let mismatches = totals
        .into_iter()
        .filter(|(_, (_, b, a))| b != a)
        .map(|(key, (name, before, after))| Mismatch { key: key.to_string(), name: name.to_string(), before, after })
        .collect();
    Reconciliation { before: before.total(), after: after.total(), mismatches }
}

fn read_asset(raw: &Value) -> Option<(String, String, u32)> {
    let assetid = id_of(raw.get("assetid"))?;
    let classid = id_of(raw.get("classid"))?;
    let amount = match raw.get("amount") {
        None | Some(Value::Null) => 1,
        Some(v) => number(v).filter(|n| *n >= 1)?,
    };
    Some((assetid, classid, amount))
}

fn amount_or_one(value: Option<&Value>) -> u32 {
    value.and_then(number).filter(|n| *n >= 1).unwrap_or(1)
}

fn instance_of(raw: &Value) -> String {
    id_of(raw.get("instanceid")).unwrap_or_else(|| "0".to_string())
}

fn skin_key(desc: Option<&Value>, classid: &str) -> String {
    text(desc, "market_hash_name").map_or_else(|| format!("class:{classid}"), str::to_string)
}

fn new_skin(key: String, desc: Option<&Value>, classid: &str) -> Skin {
    let name = text(desc, "market_name")
        .or_else(|| text(desc, "name"))
        .map_or_else(|| format!("classid {classid}"), str::to_string);
    Skin {
        key,
        name,
        icon: text(desc, "icon_url").filter(|h| is_icon_hash(h)).map(str::to_string),
        category: category(desc),
        total: 0,
        records: Vec::new(),
    }
}

fn category(desc: Option<&Value>) -> Option<Category> {
    let tag = array(desc?.get("tags"))
        .iter()
        .find(|t| t.get("category").and_then(Value::as_str) == Some("steamcat"))?;
    let id = text(Some(tag), "internal_name").or_else(|| text(Some(tag), "localized_tag_name"))?;
    let label = text(Some(tag), "localized_tag_name").or_else(|| text(Some(tag), "name")).unwrap_or(id);
    Some(Category { id: id.to_string(), label: label.to_string() })
}

fn available_after(desc: Option<&Value>) -> Option<String> {
    if flag(desc, "tradable") {
        return None;
    }
    text(desc, "cache_expiration").map(str::to_string)
}

fn flag(desc: Option<&Value>, field: &str) -> bool {
    truthy(desc.and_then(|d| d.get(field)))
}

fn is_icon_hash(hash: &str) -> bool {
    hash.len() <= 1024 && hash.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn text<'a>(desc: Option<&'a Value>, field: &str) -> Option<&'a str> {
    desc?.get(field)?.as_str().filter(|s| !s.is_empty())
}

fn array(value: Option<&Value>) -> &[Value] {
    value.and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}

/// Идентификатор Steam: непустая строка или неотрицательное число.
fn id_of(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) => n.as_u64().map(|n| n.to_string()),
        _ => None,
    }
}

fn number(value: &Value) -> Option<u32> {
    match value {
        Value::String(s) => s.trim().parse().ok(),
        Value::Number(n) => n.as_u64().and_then(|n| u32::try_from(n).ok()),
        _ => None,
    }
}

/// Steam пишет флаги по-разному: `1`, `true`, `"1"`.
fn truthy(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|n| n != 0.0),
        Some(Value::String(s)) => s == "1" || s.eq_ignore_ascii_case("true"),
        _ => false,
    }
}
```

- [ ] **Step 4: Тесты проходят**

Run: `cargo test --manifest-path src-tauri/Cargo.toml inventory::`
Expected: 17 тестов PASS.

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` и `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
Expected: без замечаний.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/inventory.rs src-tauri/src/lib.rs
git commit -m "feat: чтение инвентаря Rust по страницам и сверка до/после

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: План операции (`plan.rs`)

Чистые функции без сети: инвентарь и выбор пользователя → список шагов, очередь для панели и раскладка «станет».

**Files:**
- Create: `src-tauri/src/plan.rs`
- Modify: `src-tauri/src/lib.rs` (строка `pub mod plan;`)

**Interfaces:**
- Consumes: `inventory::{Inventory, Skin, Record}`. Записи в `Skin.records` уже отсортированы: по убыванию `amount`, при равенстве — по `assetid`.
- Produces:
  - `pub enum Operation { SplitAll, CombineAll, SplitSelected { keys: Vec<String> }, CombineSelected { keys: Vec<String> }, SplitOff { key: String, count: u32 } }`, `Serialize + Deserialize`, JSON `{"kind":"splitOff","key":"…","count":2}`;
  - `pub enum Step { Split { key, assetid }, Combine { key, from: Record, dest: Record, quantity: u32 } }` с методом `key(&self) -> &str`;
  - `pub struct QueueItem { key: String, amount: u32, requests: u32 }`;
  - `pub struct SkinAfter { key: String, stacks: Vec<u32>, singles: u32 }`;
  - `pub struct Plan { operation, steps (#[serde(skip)]), requests: u32, stacks: u32, queue: Vec<QueueItem>, more: u32, after: Vec<SkinAfter> }`;
  - `pub fn build(inventory: &Inventory, operation: &Operation) -> Plan`;
  - `pub fn validate(step: &Step) -> Result<(), &'static str>`;
  - `pub const QUEUE_PREVIEW: usize = 5`.

Правила (Global Constraints, «Правила операций»):
- скины идут по убыванию `total`, при равенстве — по названию;
- разделение: `A−1` шагов на запись, «Отделить N» — сначала из самой большой записи;
- сборка: группы по (`classid`, `instanceid`), назначение — первая запись группы.

- [ ] **Step 1: Тесты**

Создай `src-tauri/src/plan.rs` с модулем тестов и добавь в `lib.rs` строку `pub mod plan;`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn rec(assetid: &str, instanceid: &str, amount: u32) -> Record {
        Record {
            assetid: assetid.into(),
            classid: "c1".into(),
            instanceid: instanceid.into(),
            amount,
            tradable: true,
            marketable: true,
            available_after: None,
        }
    }

    /// Скин как после inventory::parse_pages: записи по убыванию amount, затем по assetid.
    fn skin(key: &str, mut records: Vec<Record>) -> Skin {
        records.sort_by(|a, b| b.amount.cmp(&a.amount).then_with(|| a.assetid.cmp(&b.assetid)));
        Skin {
            key: key.into(),
            name: key.into(),
            icon: None,
            category: None,
            total: records.iter().map(|r| r.amount).sum(),
            records,
        }
    }

    fn inv(skins: Vec<Skin>) -> Inventory {
        Inventory { skins, unreadable: vec![] }
    }

    fn split_ids(plan: &Plan) -> Vec<&str> {
        plan.steps
            .iter()
            .map(|s| match s {
                Step::Split { assetid, .. } => assetid.as_str(),
                Step::Combine { .. } => panic!("combine step in a split plan"),
            })
            .collect()
    }

    fn after(key: &str, stacks: Vec<u32>, singles: u32) -> SkinAfter {
        SkinAfter { key: key.into(), stacks, singles }
    }

    fn queued(key: &str, amount: u32, requests: u32) -> QueueItem {
        QueueItem { key: key.into(), amount, requests }
    }

    #[test]
    fn split_all_needs_a_minus_one_requests_per_stack() {
        let inventory = inv(vec![skin("A", vec![rec("1", "0", 5), rec("2", "0", 4), rec("3", "0", 1)])]);
        let plan = build(&inventory, &Operation::SplitAll);
        assert_eq!(plan.requests, 7);
        assert_eq!(plan.stacks, 2);
        assert_eq!(split_ids(&plan), vec!["1", "1", "1", "1", "2", "2", "2"]);
        assert_eq!(plan.after, vec![after("A", vec![], 10)]);
        assert_eq!(plan.queue, vec![queued("A", 5, 4), queued("A", 4, 3)]);
        assert_eq!(plan.more, 0);
    }

    #[test]
    fn stack_of_two_needs_one_request() {
        let plan = build(&inv(vec![skin("A", vec![rec("1", "0", 2)])]), &Operation::SplitAll);
        assert_eq!(plan.requests, 1);
        assert_eq!(plan.after, vec![after("A", vec![], 2)]);
    }

    #[test]
    fn split_all_with_only_singles_is_empty() {
        let plan = build(&inv(vec![skin("A", vec![rec("1", "0", 1), rec("2", "0", 1)])]), &Operation::SplitAll);
        assert_eq!(plan.requests, 0);
        assert!(plan.steps.is_empty() && plan.after.is_empty() && plan.queue.is_empty());
    }

    #[test]
    fn split_selected_touches_only_selected_skins() {
        let inventory = inv(vec![skin("A", vec![rec("1", "0", 3)]), skin("B", vec![rec("2", "0", 3)])]);
        let plan = build(&inventory, &Operation::SplitSelected { keys: vec!["B".into()] });
        assert_eq!(split_ids(&plan), vec!["2", "2"]);
        assert_eq!(plan.after, vec![after("B", vec![], 3)]);
    }

    #[test]
    fn split_off_takes_from_the_largest_stack_first() {
        let inventory = inv(vec![skin("A", vec![rec("1", "0", 5), rec("2", "0", 4)])]);
        let plan = build(&inventory, &Operation::SplitOff { key: "A".into(), count: 6 });
        assert_eq!(split_ids(&plan), vec!["1", "1", "1", "1", "2", "2"]);
        assert_eq!(plan.after, vec![after("A", vec![2], 7)]);
    }

    #[test]
    fn split_off_never_exceeds_a_minus_one() {
        let plan = build(&inv(vec![skin("A", vec![rec("1", "0", 3)])]), &Operation::SplitOff { key: "A".into(), count: 10 });
        assert_eq!(plan.requests, 2);
        assert_eq!(plan.after, vec![after("A", vec![], 3)]);
    }

    #[test]
    fn split_off_keeps_the_rest_as_a_stack() {
        let plan = build(&inv(vec![skin("A", vec![rec("1", "0", 8)])]), &Operation::SplitOff { key: "A".into(), count: 2 });
        assert_eq!(plan.requests, 2);
        assert_eq!(plan.after, vec![after("A", vec![6], 2)]);
    }

    #[test]
    fn split_off_zero_does_nothing() {
        let plan = build(&inv(vec![skin("A", vec![rec("1", "0", 8)])]), &Operation::SplitOff { key: "A".into(), count: 0 });
        assert_eq!(plan.requests, 0);
    }

    #[test]
    fn combine_all_merges_into_the_largest_record() {
        let inventory = inv(vec![skin("A", vec![rec("1", "0", 5), rec("2", "0", 4), rec("3", "0", 1)])]);
        let plan = build(&inventory, &Operation::CombineAll);
        assert_eq!(
            plan.steps,
            vec![
                Step::Combine { key: "A".into(), from: rec("2", "0", 4), dest: rec("1", "0", 5), quantity: 4 },
                Step::Combine { key: "A".into(), from: rec("3", "0", 1), dest: rec("1", "0", 5), quantity: 1 },
            ]
        );
        assert_eq!(plan.stacks, 1);
        assert_eq!(plan.queue, vec![queued("A", 10, 2)]);
        assert_eq!(plan.after, vec![after("A", vec![10], 0)]);
    }

    #[test]
    fn combine_keeps_other_instanceid_apart() {
        let inventory = inv(vec![skin("A", vec![rec("1", "0", 3), rec("2", "9", 2), rec("3", "0", 1)])]);
        let plan = build(&inventory, &Operation::CombineAll);
        assert_eq!(
            plan.steps,
            vec![Step::Combine { key: "A".into(), from: rec("3", "0", 1), dest: rec("1", "0", 3), quantity: 1 }]
        );
        assert_eq!(plan.after, vec![after("A", vec![4, 2], 0)]);
    }

    #[test]
    fn combine_tie_goes_to_the_smaller_assetid() {
        let plan = build(&inv(vec![skin("A", vec![rec("20", "0", 2), rec("10", "0", 2)])]), &Operation::CombineAll);
        assert_eq!(
            plan.steps,
            vec![Step::Combine { key: "A".into(), from: rec("20", "0", 2), dest: rec("10", "0", 2), quantity: 2 }]
        );
    }

    #[test]
    fn combine_two_singles_makes_a_stack() {
        let plan = build(&inv(vec![skin("A", vec![rec("1", "0", 1), rec("2", "0", 1)])]), &Operation::CombineAll);
        assert_eq!(plan.after, vec![after("A", vec![2], 0)]);
    }

    #[test]
    fn combine_with_nothing_to_merge_is_empty() {
        let plan = build(&inv(vec![skin("A", vec![rec("1", "0", 5), rec("2", "9", 1)])]), &Operation::CombineAll);
        assert_eq!(plan.requests, 0);
    }

    #[test]
    fn combine_selected_touches_only_selected_skins() {
        let inventory = inv(vec![
            skin("A", vec![rec("1", "0", 1), rec("2", "0", 1)]),
            skin("B", vec![rec("3", "0", 1), rec("4", "0", 1)]),
        ]);
        let plan = build(&inventory, &Operation::CombineSelected { keys: vec!["A".into()] });
        assert_eq!(plan.requests, 1);
        assert_eq!(plan.after, vec![after("A", vec![2], 0)]);
    }

    #[test]
    fn queue_shows_five_and_counts_the_rest() {
        let skins = (0..7).map(|i| skin(&format!("S{i}"), vec![rec(&i.to_string(), "0", 2)])).collect();
        let plan = build(&inv(skins), &Operation::SplitAll);
        assert_eq!(plan.stacks, 7);
        assert_eq!(plan.queue.len(), QUEUE_PREVIEW);
        assert_eq!(plan.more, 2);
    }

    #[test]
    fn skins_go_by_total_then_name() {
        let inventory = inv(vec![
            skin("B", vec![rec("1", "0", 2)]),
            skin("A", vec![rec("2", "0", 2)]),
            skin("C", vec![rec("3", "0", 5)]),
        ]);
        let plan = build(&inventory, &Operation::SplitAll);
        let keys: Vec<&str> = plan.after.iter().map(|a| a.key.as_str()).collect();
        assert_eq!(keys, vec!["C", "A", "B"]);
    }

    #[test]
    fn validate_rejects_unsafe_steps() {
        let combine = |from: Record, dest: Record, quantity| Step::Combine { key: "A".into(), from, dest, quantity };
        assert_eq!(validate(&combine(rec("2", "0", 3), rec("1", "0", 5), 3)), Ok(()));
        assert!(validate(&combine(rec("1", "0", 3), rec("1", "0", 3), 3)).is_err(), "same item");
        assert!(validate(&combine(rec("2", "9", 3), rec("1", "0", 5), 3)).is_err(), "other instanceid");
        let mut other_class = rec("2", "0", 3);
        other_class.classid = "c2".into();
        assert!(validate(&combine(other_class, rec("1", "0", 5), 3)).is_err(), "other classid");
        assert!(validate(&combine(rec("2", "0", 3), rec("1", "0", 5), 4)).is_err(), "wrong quantity");
        assert!(validate(&combine(rec("2", "0", 3), rec("1", "0", 5), 0)).is_err(), "zero quantity");
        assert!(validate(&Step::Split { key: "A".into(), assetid: String::new() }).is_err());
        assert_eq!(validate(&Step::Split { key: "A".into(), assetid: "1".into() }), Ok(()));
    }

    #[test]
    fn operation_reads_window_json() {
        let op: Operation = serde_json::from_str(r#"{"kind":"splitOff","key":"Outlaw Revolver","count":2}"#).unwrap();
        assert_eq!(op, Operation::SplitOff { key: "Outlaw Revolver".into(), count: 2 });
        let op: Operation = serde_json::from_str(r#"{"kind":"combineSelected","keys":["A"]}"#).unwrap();
        assert_eq!(op, Operation::CombineSelected { keys: vec!["A".into()] });
        assert_eq!(serde_json::from_str::<Operation>(r#"{"kind":"splitAll"}"#).unwrap(), Operation::SplitAll);
    }

    #[test]
    fn plan_json_has_no_steps() {
        let plan = build(&inv(vec![skin("A", vec![rec("1", "0", 3)])]), &Operation::SplitAll);
        let json = serde_json::to_value(&plan).unwrap();
        assert!(json.get("steps").is_none());
        assert_eq!(json["requests"], 2);
        assert_eq!(json["operation"]["kind"], "splitAll");
        assert_eq!(json["after"][0]["singles"], 3);
    }
}
```

- [ ] **Step 2: Убедиться, что тесты не собираются**

Run: `cargo test --manifest-path src-tauri/Cargo.toml plan::`
Expected: ошибка компиляции, нет `build`, `Operation`, `Step`.

- [ ] **Step 3: Реализация**

Вставь над модулем тестов:

```rust
//! Чистые функции: инвентарь и выбор пользователя → шаги. Сети здесь нет.

use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::inventory::{Inventory, Record, Skin};

/// Сколько стопок показывать в очереди плана.
pub const QUEUE_PREVIEW: usize = 5;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Operation {
    SplitAll,
    CombineAll,
    SplitSelected { keys: Vec<String> },
    CombineSelected { keys: Vec<String> },
    SplitOff { key: String, count: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
    /// Отделить одну штуку от стопки `assetid`.
    Split { key: String, assetid: String },
    /// Перенести `quantity` штук из `from` в `dest`.
    Combine { key: String, from: Record, dest: Record, quantity: u32 },
}

impl Step {
    pub fn key(&self) -> &str {
        match self {
            Step::Split { key, .. } | Step::Combine { key, .. } => key,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub key: String,
    /// Размер стопки, а для сборки — сколько штук будет в стопке.
    pub amount: u32,
    pub requests: u32,
}

/// Раскладка скина после операции.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinAfter {
    pub key: String,
    /// По убыванию.
    pub stacks: Vec<u32>,
    pub singles: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub operation: Operation,
    /// Окну шаги не нужны: их бывают тысячи.
    #[serde(skip)]
    pub steps: Vec<Step>,
    pub requests: u32,
    /// Сколько стопок затронет: разделяемых записей или собираемых групп.
    pub stacks: u32,
    pub queue: Vec<QueueItem>,
    /// «и ещё N» после очереди.
    pub more: u32,
    pub after: Vec<SkinAfter>,
}

struct SkinPart {
    steps: Vec<Step>,
    queue: Vec<QueueItem>,
    after: SkinAfter,
}

pub fn build(inventory: &Inventory, operation: &Operation) -> Plan {
    let selected: Option<HashSet<&str>> = match operation {
        Operation::SplitAll | Operation::CombineAll => None,
        Operation::SplitSelected { keys } | Operation::CombineSelected { keys } => {
            Some(keys.iter().map(String::as_str).collect())
        }
        Operation::SplitOff { key, .. } => Some(HashSet::from([key.as_str()])),
    };
    let mut skins: Vec<&Skin> = inventory
        .skins
        .iter()
        .filter(|s| selected.as_ref().is_none_or(|keys| keys.contains(s.key.as_str())))
        .collect();
    skins.sort_by(|a, b| b.total.cmp(&a.total).then_with(|| a.name.cmp(&b.name)));

    let (mut steps, mut queue, mut after) = (Vec::new(), Vec::new(), Vec::new());
    for skin in skins {
        let part = match operation {
            Operation::SplitAll | Operation::SplitSelected { .. } => split_skin(skin, u32::MAX),
            Operation::SplitOff { count, .. } => split_skin(skin, *count),
            Operation::CombineAll | Operation::CombineSelected { .. } => combine_skin(skin),
        };
        if let Some(part) = part {
            steps.extend(part.steps);
            queue.extend(part.queue);
            after.push(part.after);
        }
    }
    let stacks = queue.len() as u32;
    let more = queue.len().saturating_sub(QUEUE_PREVIEW) as u32;
    queue.truncate(QUEUE_PREVIEW);
    Plan { operation: operation.clone(), requests: steps.len() as u32, steps, stacks, queue, more, after }
}

/// Отделить по одному не больше `limit` штук, начиная с самой большой записи.
fn split_skin(skin: &Skin, limit: u32) -> Option<SkinPart> {
    let mut left = limit;
    let (mut steps, mut queue, mut stacks, mut singles) = (Vec::new(), Vec::new(), Vec::new(), 0u32);
    for record in &skin.records {
        let n = record.amount.saturating_sub(1).min(left);
        left -= n;
        for _ in 0..n {
            steps.push(Step::Split { key: skin.key.clone(), assetid: record.assetid.clone() });
        }
        if n > 0 {
            queue.push(QueueItem { key: skin.key.clone(), amount: record.amount, requests: n });
        }
        singles += n;
        match record.amount - n {
            1 => singles += 1,
            rest => stacks.push(rest),
        }
    }
    if steps.is_empty() {
        return None;
    }
    stacks.sort_unstable_by(|a, b| b.cmp(a));
    Some(SkinPart { steps, queue, after: SkinAfter { key: skin.key.clone(), stacks, singles } })
}

/// Собрать каждую группу (`classid`, `instanceid`) в её самую большую запись.
fn combine_skin(skin: &Skin) -> Option<SkinPart> {
    let mut groups: BTreeMap<(&str, &str), Vec<&Record>> = BTreeMap::new();
    for record in &skin.records {
        groups.entry((record.classid.as_str(), record.instanceid.as_str())).or_default().push(record);
    }
    let (mut steps, mut queue, mut amounts) = (Vec::new(), Vec::new(), Vec::new());
    for records in groups.values() {
        // Записи уже по убыванию amount: первая — назначение.
        let dest = records[0];
        let total: u32 = records.iter().map(|r| r.amount).sum();
        for from in &records[1..] {
            steps.push(Step::Combine {
                key: skin.key.clone(),
                from: (*from).clone(),
                dest: dest.clone(),
                quantity: from.amount,
            });
        }
        if records.len() > 1 {
            queue.push(QueueItem { key: skin.key.clone(), amount: total, requests: records.len() as u32 - 1 });
        }
        amounts.push(total);
    }
    if steps.is_empty() {
        return None;
    }
    let singles = amounts.iter().filter(|a| **a == 1).count() as u32;
    let mut stacks: Vec<u32> = amounts.into_iter().filter(|a| *a > 1).collect();
    stacks.sort_unstable_by(|a, b| b.cmp(a));
    Some(SkinPart { steps, queue, after: SkinAfter { key: skin.key.clone(), stacks, singles } })
}

/// Проверка перед каждым запросом (правило 3 спеки): сборка с неверными
/// данными может потерять предметы, поэтому такой шаг не отправляется.
pub fn validate(step: &Step) -> Result<(), &'static str> {
    match step {
        Step::Split { assetid, .. } if assetid.is_empty() => Err("empty assetid"),
        Step::Split { .. } => Ok(()),
        Step::Combine { from, dest, quantity, .. } => {
            if from.assetid == dest.assetid {
                Err("source and destination are the same item")
            } else if from.classid != dest.classid || from.instanceid != dest.instanceid {
                Err("items of different type")
            } else if *quantity == 0 || *quantity != from.amount {
                Err("quantity does not match the inventory")
            } else {
                Ok(())
            }
        }
    }
}
```

- [ ] **Step 4: Тесты проходят**

Run: `cargo test --manifest-path src-tauri/Cargo.toml plan::`
Expected: 19 тестов PASS.

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` и `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
Expected: без замечаний.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/plan.rs src-tauri/src/lib.rs
git commit -m "feat: план разделения и сборки стопок

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Журнал и выполнение шагов (`journal.rs`, `runner.rs`)

Перенос `rust_trader/steam/split.py` с правилами спеки:
- пауза только между запросами;
- 429 ждём с отсчётом и проверяем «Остановить» каждую секунду;
- 401/403 останавливают сразу;
- три неудачи подряд останавливают;
- сборка с неверными данными не отправляется.

**Files:**
- Create: `src-tauri/src/journal.rs`, `src-tauri/src/runner.rs`
- Modify: `src-tauri/src/lib.rs` (строки `pub mod journal;`, `pub mod runner;`)

**Interfaces:**
- Consumes: `plan::{Step, validate}`, `steam::{SteamClient, SteamError, SleepFn, recording_sleep}`, `token::{Token, test_token}`.
- Produces:
  - `journal::Journal` (`Default`): `add(&self, line: impl AsRef<str>)` и `text(&self) -> String`, не больше `MAX_LINES = 2000` строк, каждая начинается с времени UTC `HH:MM:SSZ`;
  - `runner::StackApi` — трейт с методами:
    - `fn split(&self, assetid: &str) -> impl Future<Output = Result<(), SteamError>> + Send`;
    - `fn combine(&self, from: &str, dest: &str, quantity: u32) -> impl Future<Output = Result<(), SteamError>> + Send`;
  - `runner::SteamStacker { pub client: SteamClient, pub token: Token }` реализует `StackApi`;
  - `runner::Progress` (serde `tag = "kind"`, camelCase):
    - `Request { done: u32, total: u32, errors: u32, key: String }` — шлётся перед каждым запросом и один раз в конце с `key = ""`;
    - `Waiting { seconds: u64 }`;
  - `runner::StopReason { Finished, StoppedByUser, TokenRejected, TooManyFailures }`, в JSON `"finished"` и т. д.;
  - `runner::RunOutcome { reason: StopReason, done: u32, errors: u32, total: u32 }`;
  - `runner::RunConfig { delay: Duration }`;
  - `pub async fn run<A: StackApi>(api: &A, steps: &[Step], config: &RunConfig, stop: &AtomicBool, sleep: &SleepFn, journal: &Journal, emit: impl FnMut(Progress)) -> RunOutcome`;
  - константы `MAX_FAILURES_IN_ROW = 3`, `MAX_RATE_WAITS = 3`, `MAX_WAIT_SECS = 60`.

- [ ] **Step 1: Журнал — тесты и реализация**

Журнал маленький, поэтому тесты и код пишутся одним шагом. `src-tauri/src/journal.rs`:

```rust
//! Журнал для кнопки «Скопировать журнал». Сюда не пишутся токен и полный SteamID.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_LINES: usize = 2000;

#[derive(Default)]
pub struct Journal {
    lines: Mutex<VecDeque<String>>,
}

impl Journal {
    pub fn add(&self, line: impl AsRef<str>) {
        let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        self.push(format!("{} {}", clock(secs), line.as_ref()));
    }

    fn push(&self, line: String) {
        let mut lines = self.lines.lock().unwrap_or_else(|e| e.into_inner());
        if lines.len() == MAX_LINES {
            lines.pop_front();
        }
        lines.push_back(line);
    }

    pub fn text(&self) -> String {
        let lines = self.lines.lock().unwrap_or_else(|e| e.into_inner());
        lines.iter().map(String::as_str).collect::<Vec<_>>().join("\n")
    }
}

/// Время суток по UTC: «14:03:27Z».
fn clock(secs: u64) -> String {
    let s = secs % 86_400;
    format!("{:02}:{:02}:{:02}Z", s / 3600, s % 3600 / 60, s % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clock_is_utc_time_of_day() {
        assert_eq!(clock(0), "00:00:00Z");
        assert_eq!(clock(86_400 + 3_600 * 14 + 60 * 3 + 27), "14:03:27Z");
    }

    #[test]
    fn lines_are_joined_and_stamped() {
        let journal = Journal::default();
        journal.add("first");
        journal.add(String::from("second"));
        let text = journal.text();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].ends_with("Z first"), "{text}");
        assert!(lines[1].ends_with("Z second"), "{text}");
    }

    #[test]
    fn keeps_only_the_last_lines() {
        let journal = Journal::default();
        for i in 0..MAX_LINES + 5 {
            journal.add(format!("line {i}"));
        }
        let text = journal.text();
        assert_eq!(text.lines().count(), MAX_LINES);
        assert!(text.lines().next().unwrap().ends_with("line 5"));
    }
}
```

Добавь в `lib.rs` строку `pub mod journal;`.

Run: `cargo test --manifest-path src-tauri/Cargo.toml journal::`
Expected: 3 теста PASS.

- [ ] **Step 2: Тесты runner**

Создай `src-tauri/src/runner.rs` с модулем тестов и добавь в `lib.rs` строку `pub mod runner;`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::inventory::Record;
    use crate::steam::recording_sleep;
    use crate::token::test_token;
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    /// Поддельный Steam: отвечает по списку, после списка — успехом.
    #[derive(Default)]
    struct FakeApi {
        replies: Mutex<VecDeque<Result<(), SteamError>>>,
        calls: Mutex<Vec<String>>,
        /// Нажать «Остановить» во время первого запроса.
        stop_on_call: Option<Arc<AtomicBool>>,
    }

    impl FakeApi {
        fn new(replies: Vec<Result<(), SteamError>>) -> Self {
            Self { replies: Mutex::new(replies.into()), ..Self::default() }
        }

        fn reply(&self, call: String) -> Result<(), SteamError> {
            self.calls.lock().unwrap().push(call);
            if let Some(stop) = &self.stop_on_call {
                stop.store(true, Ordering::SeqCst);
            }
            self.replies.lock().unwrap().pop_front().unwrap_or(Ok(()))
        }

        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl StackApi for FakeApi {
        async fn split(&self, assetid: &str) -> Result<(), SteamError> {
            self.reply(format!("split {assetid}"))
        }

        async fn combine(&self, from: &str, dest: &str, quantity: u32) -> Result<(), SteamError> {
            self.reply(format!("combine {from}->{dest} x{quantity}"))
        }
    }

    fn splits(n: usize) -> Vec<Step> {
        (0..n).map(|i| Step::Split { key: format!("Skin {i}"), assetid: format!("{}", 1000 + i) }).collect()
    }

    fn record(assetid: &str, amount: u32) -> Record {
        Record {
            assetid: assetid.into(),
            classid: "c1".into(),
            instanceid: "0".into(),
            amount,
            tradable: true,
            marketable: true,
            available_after: None,
        }
    }

    struct Run {
        outcome: RunOutcome,
        events: Vec<Progress>,
        slept: Vec<Duration>,
        journal: Journal,
    }

    async fn go<A: StackApi>(api: &A, steps: &[Step], stop: &AtomicBool) -> Run {
        let (sleep, slept) = recording_sleep();
        let journal = Journal::default();
        let mut events = Vec::new();
        let config = RunConfig { delay: Duration::from_millis(1500) };
        let outcome = run(api, steps, &config, stop, &sleep, &journal, |p| events.push(p)).await;
        let slept = slept.lock().unwrap().clone();
        Run { outcome, events, slept, journal }
    }

    fn waits(events: &[Progress]) -> Vec<u64> {
        events
            .iter()
            .filter_map(|e| match e {
                Progress::Waiting { seconds } => Some(*seconds),
                Progress::Request { .. } => None,
            })
            .collect()
    }

    #[tokio::test]
    async fn runs_all_steps_with_a_pause_between_requests() {
        let api = FakeApi::new(vec![]);
        let r = go(&api, &splits(3), &AtomicBool::new(false)).await;
        assert_eq!(r.outcome, RunOutcome { reason: StopReason::Finished, done: 3, errors: 0, total: 3 });
        assert_eq!(api.calls(), vec!["split 1000", "split 1001", "split 1002"]);
        assert_eq!(r.slept, vec![Duration::from_millis(1500); 2]);
        assert_eq!(r.events.first(), Some(&Progress::Request { done: 0, total: 3, errors: 0, key: "Skin 0".into() }));
        assert_eq!(r.events.last(), Some(&Progress::Request { done: 3, total: 3, errors: 0, key: String::new() }));
    }

    #[tokio::test]
    async fn auth_error_stops_at_once() {
        let api = FakeApi::new(vec![Ok(()), Err(SteamError::Auth(401))]);
        let r = go(&api, &splits(4), &AtomicBool::new(false)).await;
        assert_eq!(r.outcome.reason, StopReason::TokenRejected);
        assert_eq!(r.outcome.done, 1);
        assert_eq!(api.calls().len(), 2);
    }

    #[tokio::test]
    async fn three_failures_in_a_row_stop_the_run() {
        let fail = || Err(SteamError::Http(500));
        let api = FakeApi::new(vec![fail(), Ok(()), fail(), fail(), fail()]);
        let r = go(&api, &splits(6), &AtomicBool::new(false)).await;
        assert_eq!(r.outcome, RunOutcome { reason: StopReason::TooManyFailures, done: 1, errors: 4, total: 6 });
        assert_eq!(api.calls().len(), 5);
        assert!(r.journal.text().contains("three failures in a row"));
    }

    #[tokio::test]
    async fn network_failure_is_counted_once_and_not_retried() {
        let api = FakeApi::new(vec![Err(SteamError::Network("connection failed")), Ok(())]);
        let r = go(&api, &splits(2), &AtomicBool::new(false)).await;
        assert_eq!(api.calls(), vec!["split 1000", "split 1001"]);
        assert_eq!(r.outcome, RunOutcome { reason: StopReason::Finished, done: 1, errors: 1, total: 2 });
        assert!(r.journal.text().contains("network error"));
    }

    #[tokio::test]
    async fn scattered_failures_do_not_stop_the_run() {
        let fail = || Err(SteamError::Http(500));
        let api = FakeApi::new(vec![fail(), Ok(()), fail(), Ok(())]);
        let r = go(&api, &splits(4), &AtomicBool::new(false)).await;
        assert_eq!(r.outcome, RunOutcome { reason: StopReason::Finished, done: 2, errors: 2, total: 4 });
    }

    #[tokio::test]
    async fn rate_limit_waits_and_retries_the_same_step() {
        let api = FakeApi::new(vec![Err(SteamError::RateLimited { retry_after: Some(3) }), Ok(())]);
        let r = go(&api, &splits(1), &AtomicBool::new(false)).await;
        assert_eq!(r.outcome, RunOutcome { reason: StopReason::Finished, done: 1, errors: 0, total: 1 });
        assert_eq!(api.calls(), vec!["split 1000", "split 1000"]);
        assert_eq!(waits(&r.events), vec![3]);
        assert_eq!(r.slept, vec![Duration::from_secs(1); 3]);
    }

    #[tokio::test]
    async fn rate_limit_without_header_waits_10_20_30_then_fails() {
        let limited = || Err(SteamError::RateLimited { retry_after: None });
        let api = FakeApi::new(vec![limited(), limited(), limited(), limited()]);
        let r = go(&api, &splits(1), &AtomicBool::new(false)).await;
        assert_eq!(waits(&r.events), vec![10, 20, 30]);
        assert_eq!(r.outcome, RunOutcome { reason: StopReason::Finished, done: 0, errors: 1, total: 1 });
        assert_eq!(api.calls().len(), 4);
    }

    #[tokio::test]
    async fn rate_limit_wait_is_capped_at_60_seconds() {
        let api = FakeApi::new(vec![Err(SteamError::RateLimited { retry_after: Some(600) }), Ok(())]);
        let r = go(&api, &splits(1), &AtomicBool::new(false)).await;
        assert_eq!(waits(&r.events), vec![60]);
    }

    #[tokio::test]
    async fn stop_before_start_sends_nothing() {
        let api = FakeApi::new(vec![]);
        let r = go(&api, &splits(3), &AtomicBool::new(true)).await;
        assert_eq!(r.outcome.reason, StopReason::StoppedByUser);
        assert!(api.calls().is_empty());
    }

    #[tokio::test]
    async fn stop_finishes_the_current_request_and_stops() {
        let stop = Arc::new(AtomicBool::new(false));
        let api = FakeApi { stop_on_call: Some(stop.clone()), ..FakeApi::default() };
        let r = go(&api, &splits(3), &stop).await;
        assert_eq!(r.outcome, RunOutcome { reason: StopReason::StoppedByUser, done: 1, errors: 0, total: 3 });
        assert_eq!(api.calls().len(), 1);
        assert!(r.slept.is_empty(), "no pause after stop: {:?}", r.slept);
    }

    #[tokio::test]
    async fn stop_during_rate_limit_wait_stops() {
        let stop = Arc::new(AtomicBool::new(false));
        let api = FakeApi {
            replies: Mutex::new(VecDeque::from([Err(SteamError::RateLimited { retry_after: Some(30) })])),
            stop_on_call: Some(stop.clone()),
            ..FakeApi::default()
        };
        let r = go(&api, &splits(2), &stop).await;
        assert_eq!(r.outcome.reason, StopReason::StoppedByUser);
        assert_eq!(api.calls().len(), 1);
    }

    #[tokio::test]
    async fn invalid_combine_is_not_sent() {
        let api = FakeApi::new(vec![]);
        let bad = Step::Combine { key: "Skin".into(), from: record("1", 2), dest: record("1", 2), quantity: 2 };
        let good = Step::Combine { key: "Skin".into(), from: record("2", 3), dest: record("1", 5), quantity: 3 };
        let r = go(&api, &[bad, good], &AtomicBool::new(false)).await;
        assert_eq!(api.calls(), vec!["combine 2->1 x3"]);
        assert_eq!(r.outcome, RunOutcome { reason: StopReason::Finished, done: 1, errors: 1, total: 2 });
        assert!(r.journal.text().contains("invalid step"));
    }

    #[tokio::test]
    async fn journal_never_contains_token_or_steamid() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).respond_with(ResponseTemplate::new(500)).mount(&server).await;
        let (sleep, _) = recording_sleep();
        let api = SteamStacker { client: SteamClient::new(&server.uri(), sleep), token: test_token() };
        let r = go(&api, &splits(2), &AtomicBool::new(false)).await;
        assert_eq!(r.outcome.errors, 2);
        let text = r.journal.text();
        assert!(!text.contains("tok-SECRET"), "{text}");
        assert!(!text.contains("76561190000000001"), "{text}");
        assert!(text.contains("HTTP 500"), "{text}");
    }

    #[test]
    fn progress_and_outcome_serialize_for_the_window() {
        let p = Progress::Request { done: 1, total: 2, errors: 0, key: "A".into() };
        assert_eq!(
            serde_json::to_string(&p).unwrap(),
            r#"{"kind":"request","done":1,"total":2,"errors":0,"key":"A"}"#
        );
        assert_eq!(serde_json::to_string(&Progress::Waiting { seconds: 5 }).unwrap(), r#"{"kind":"waiting","seconds":5}"#);
        assert_eq!(serde_json::to_string(&StopReason::TooManyFailures).unwrap(), r#""tooManyFailures""#);
    }
}
```

- [ ] **Step 3: Убедиться, что тесты не собираются**

Run: `cargo test --manifest-path src-tauri/Cargo.toml runner::`
Expected: ошибка компиляции, нет `run`, `StackApi`, `Progress`.

- [ ] **Step 4: Реализация runner**

Вставь над модулем тестов:

```rust
//! Выполняет шаги по одному с паузой между запросами и сообщает окну о ходе.
//! Останавливается после трёх неудач подряд, при 401/403 и по кнопке «Остановить».

use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;

use crate::journal::Journal;
use crate::plan::{self, Step};
use crate::steam::{SleepFn, SteamClient, SteamError};
use crate::token::Token;

pub const MAX_FAILURES_IN_ROW: u32 = 3;
/// Сколько раз на одном шаге ждать по 429, прежде чем считать шаг неудачным.
pub const MAX_RATE_WAITS: u32 = 3;
pub const MAX_WAIT_SECS: u64 = 60;

/// Запросы, которые меняют инвентарь. В тестах их подменяет поддельный Steam.
pub trait StackApi {
    fn split(&self, assetid: &str) -> impl Future<Output = Result<(), SteamError>> + Send;
    fn combine(&self, from: &str, dest: &str, quantity: u32) -> impl Future<Output = Result<(), SteamError>> + Send;
}

pub struct SteamStacker {
    pub client: SteamClient,
    pub token: Token,
}

impl StackApi for SteamStacker {
    async fn split(&self, assetid: &str) -> Result<(), SteamError> {
        self.client.split(&self.token, assetid, 1).await
    }

    async fn combine(&self, from: &str, dest: &str, quantity: u32) -> Result<(), SteamError> {
        self.client.combine(&self.token, from, dest, quantity).await
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Progress {
    /// Перед каждым запросом и один раз в конце (`key` пустой).
    Request { done: u32, total: u32, errors: u32, key: String },
    /// Steam ответил 429: ждём столько секунд.
    Waiting { seconds: u64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StopReason {
    Finished,
    StoppedByUser,
    TokenRejected,
    TooManyFailures,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOutcome {
    pub reason: StopReason,
    pub done: u32,
    pub errors: u32,
    pub total: u32,
}

pub struct RunConfig {
    pub delay: Duration,
}

enum Failure {
    Steam(SteamError),
    Invalid(&'static str),
    Stopped,
}

pub async fn run<A: StackApi>(
    api: &A,
    steps: &[Step],
    config: &RunConfig,
    stop: &AtomicBool,
    sleep: &SleepFn,
    journal: &Journal,
    mut emit: impl FnMut(Progress),
) -> RunOutcome {
    let total = steps.len() as u32;
    let mut outcome = RunOutcome { reason: StopReason::Finished, done: 0, errors: 0, total };
    let mut in_row = 0;
    for (i, step) in steps.iter().enumerate() {
        // Пауза только между запросами и не после нажатия «Остановить».
        if i > 0 && !stop.load(Ordering::SeqCst) {
            sleep(config.delay).await;
        }
        if stop.load(Ordering::SeqCst) {
            journal.add("stopped by the user");
            outcome.reason = StopReason::StoppedByUser;
            break;
        }
        emit(Progress::Request { done: outcome.done, total, errors: outcome.errors, key: step.key().to_string() });
        match send(api, step, stop, sleep, journal, &mut emit).await {
            Ok(()) => {
                outcome.done += 1;
                in_row = 0;
            }
            Err(Failure::Stopped) => {
                journal.add("stopped by the user while waiting");
                outcome.reason = StopReason::StoppedByUser;
                break;
            }
            Err(Failure::Steam(SteamError::Auth(status))) => {
                journal.add(format!("Steam rejected the token (HTTP {status}), stopping"));
                outcome.reason = StopReason::TokenRejected;
                break;
            }
            Err(failure) => {
                outcome.errors += 1;
                in_row += 1;
                journal.add(format!("{} «{}» failed: {}", action(step), step.key(), describe(&failure)));
                if in_row >= MAX_FAILURES_IN_ROW {
                    journal.add("three failures in a row, stopping");
                    outcome.reason = StopReason::TooManyFailures;
                    break;
                }
            }
        }
    }
    emit(Progress::Request { done: outcome.done, total, errors: outcome.errors, key: String::new() });
    outcome
}

/// Один шаг. При 429 ждёт и повторяет тот же запрос, проверяя «Остановить» каждую секунду.
async fn send<A: StackApi>(
    api: &A,
    step: &Step,
    stop: &AtomicBool,
    sleep: &SleepFn,
    journal: &Journal,
    emit: &mut impl FnMut(Progress),
) -> Result<(), Failure> {
    plan::validate(step).map_err(Failure::Invalid)?;
    let mut waits = 0;
    loop {
        let result = match step {
            Step::Split { assetid, .. } => api.split(assetid).await,
            Step::Combine { from, dest, quantity, .. } => api.combine(&from.assetid, &dest.assetid, *quantity).await,
        };
        match result {
            Err(SteamError::RateLimited { retry_after }) if waits < MAX_RATE_WAITS => {
                waits += 1;
                let seconds = retry_after.unwrap_or(10 * u64::from(waits)).min(MAX_WAIT_SECS);
                journal.add(format!("Steam asked to slow down, waiting {seconds} s"));
                emit(Progress::Waiting { seconds });
                for _ in 0..seconds {
                    if stop.load(Ordering::SeqCst) {
                        return Err(Failure::Stopped);
                    }
                    sleep(Duration::from_secs(1)).await;
                }
            }
            other => return other.map_err(Failure::Steam),
        }
    }
}

fn action(step: &Step) -> &'static str {
    match step {
        Step::Split { .. } => "split",
        Step::Combine { .. } => "combine",
    }
}

fn describe(failure: &Failure) -> String {
    match failure {
        Failure::Steam(e) => e.to_string(),
        Failure::Invalid(why) => format!("invalid step, not sent: {why}"),
        Failure::Stopped => "stopped".to_string(),
    }
}
```

- [ ] **Step 5: Тесты проходят**

Run: `cargo test --manifest-path src-tauri/Cargo.toml runner::`
Expected: 14 тестов PASS.

Run: `cargo test --manifest-path src-tauri/Cargo.toml` (весь набор), затем `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` и `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
Expected: всё зелёное.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/journal.rs src-tauri/src/runner.rs src-tauri/src/lib.rs
git commit -m "feat: выполнение шагов с паузой, ожиданием 429 и остановкой

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Настройки, команды окна и сборка ядра (`settings.rs`, `commands.rs`, `lib.rs`)

Ядро собирается в одно целое. Логика команд живёт в методах `AppState`, поэтому её можно проверить без Tauri, на поддельном Steam (wiremock). Сами `#[tauri::command]` — однострочные обёртки.

**Files:**
- Create: `src-tauri/src/settings.rs`, `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs` (полностью)

**Interfaces:**
- Consumes: всё из Task 2–6.
- Produces:
  - `settings::Settings { language: Option<String>, delay_ms: u32 }`:
    - serde camelCase с `#[serde(default)]`, в JSON `{"language":null,"delayMs":1500}`;
    - метод `normalized()`;
    - `settings::load(path) -> Settings`, `settings::save(path, &Settings) -> io::Result<()>`;
    - `DEFAULT_DELAY_MS = 1500`, `MIN_DELAY_MS = 500`, `MAX_DELAY_MS = 10_000`;
  - `commands::UiError { code: &'static str, status: Option<u16> }`, в JSON `{"code":"tokenExpired","status":null}`;
  - `commands::StartResult` (serde `tag = "kind"`):
    - `PlanChanged { plan, inventory }`;
    - `Finished { outcome, reconciliation: Option<Reconciliation>, inventory: Option<Inventory> }`;
  - `commands::AppState::new(client, sleep, settings, settings_path: Option<PathBuf>)`;
  - команды Tauri (имена для `invoke`):

    | Команда | Аргументы | Возвращает |
    |---|---|---|
    | `set_token` | `{ raw }` | `TokenInfo` |
    | `forget_token` | — | — |
    | `load_inventory` | `{ lang }` | `Inventory` |
    | `preview` | `{ operation }` | `Plan` |
    | `start` | `{ operation, lang }` | `StartResult` |
    | `stop` | — | — |
    | `get_settings` | — | `Settings` |
    | `save_settings` | `{ settings }` | `Settings` |
    | `journal` | — | `String` |

  - событие `run-progress` с `runner::Progress`;
  - коды ошибок для окна: `tokenNotFound`, `tokenNoExpiry`, `tokenExpired`, `tokenSteamIdMismatch`, `tokenRejected`, `rateLimited`, `http` (со `status`), `steamRejected`, `network`, `badResponse`, `pagingLoop`, `tooLarge`, `noToken`, `noInventory`, `busy`, `settingsNotSaved`.

- [ ] **Step 1: Настройки — тесты и реализация**

`src-tauri/src/settings.rs`:

```rust
//! Настройки: язык и пауза между запросами. Файл лежит в папке настроек системы.

use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

pub const DEFAULT_DELAY_MS: u32 = 1500;
pub const MIN_DELAY_MS: u32 = 500;
pub const MAX_DELAY_MS: u32 = 10_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// "en", "ru" или None — язык системы.
    pub language: Option<String>,
    pub delay_ms: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self { language: None, delay_ms: DEFAULT_DELAY_MS }
    }
}

impl Settings {
    /// Пауза в допустимых границах, неизвестный язык — как в системе.
    pub fn normalized(mut self) -> Self {
        self.delay_ms = self.delay_ms.clamp(MIN_DELAY_MS, MAX_DELAY_MS);
        if !matches!(self.language.as_deref(), Some("en" | "ru")) {
            self.language = None;
        }
        self
    }
}

/// Нет файла или он испорчен — настройки по умолчанию.
pub fn load(path: &Path) -> Settings {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Settings>(&bytes).ok())
        .unwrap_or_default()
        .normalized()
}

pub fn save(path: &Path, settings: &Settings) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_vec_pretty(settings).map_err(io::Error::other)?;
    fs::write(path, json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_file(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rss-settings-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join("settings.json")
    }

    #[test]
    fn missing_file_gives_defaults() {
        assert_eq!(load(&temp_file("missing")), Settings::default());
    }

    #[test]
    fn broken_file_gives_defaults() {
        let path = temp_file("broken");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"{not json").unwrap();
        assert_eq!(load(&path), Settings::default());
    }

    #[test]
    fn partial_file_keeps_known_fields() {
        let path = temp_file("partial");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, br#"{"delayMs": 3000}"#).unwrap();
        assert_eq!(load(&path), Settings { language: None, delay_ms: 3000 });
    }

    #[test]
    fn normalized_clamps_delay_and_language() {
        let s = Settings { language: Some("de".into()), delay_ms: 100 }.normalized();
        assert_eq!(s, Settings { language: None, delay_ms: MIN_DELAY_MS });
        let s = Settings { language: Some("ru".into()), delay_ms: 60_000 }.normalized();
        assert_eq!(s, Settings { language: Some("ru".into()), delay_ms: MAX_DELAY_MS });
    }

    #[test]
    fn save_then_load_round_trips() {
        let path = temp_file("roundtrip");
        let s = Settings { language: Some("en".into()), delay_ms: 2500 };
        save(&path, &s).unwrap();
        assert_eq!(load(&path), s);
    }

    #[test]
    fn json_uses_camel_case() {
        assert_eq!(serde_json::to_string(&Settings::default()).unwrap(), r#"{"language":null,"delayMs":1500}"#);
    }
}
```

Добавь в `lib.rs` строку `pub mod settings;`.

Run: `cargo test --manifest-path src-tauri/Cargo.toml settings::`
Expected: 6 тестов PASS.

- [ ] **Step 2: Тесты команд**

Создай `src-tauri/src/commands.rs` с модулем тестов и добавь в `lib.rs` строку `pub mod commands;`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::runner::StopReason;
    use crate::steam::recording_sleep;
    use crate::token::test_token;
    use serde_json::json;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const NOW: i64 = 1_800_000_000;
    const INV: &str = "/IEconService/GetInventoryItemsWithDescriptions/v1/";
    const SPLIT: &str = "/IInventoryService/SplitItemStack/v1/";

    fn inventory_reply(amount: u32) -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_json(json!({"response": {
            "assets": [{"assetid": "1001", "classid": "c1", "instanceid": "0", "amount": amount.to_string()}],
            "descriptions": [{"classid": "c1", "instanceid": "0", "market_hash_name": "Outlaw Revolver",
                              "name": "Outlaw Revolver", "tradable": 1, "marketable": 1}],
            "total_inventory_count": 1
        }}))
    }

    fn state_for(server: &MockServer) -> AppState {
        let (sleep, _) = recording_sleep();
        AppState::new(SteamClient::new(&server.uri(), sleep.clone()), sleep, Settings::default(), None)
    }

    async fn with_token(state: &AppState) {
        state.session.lock().await.token = Some(test_token());
    }

    #[test]
    fn errors_map_to_codes_for_the_window() {
        assert_eq!(UiError::from(TokenError::Expired).code, "tokenExpired");
        assert_eq!(UiError::from(TokenError::NotFound).code, "tokenNotFound");
        assert_eq!(UiError::from(SteamError::Auth(403)), UiError { code: "tokenRejected", status: Some(403) });
        assert_eq!(UiError::from(SteamError::Network("timeout")).code, "network");
        assert_eq!(
            serde_json::to_string(&UiError::from(SteamError::Http(502))).unwrap(),
            r#"{"code":"http","status":502}"#
        );
    }

    #[test]
    fn steam_language_follows_the_window() {
        assert_eq!(steam_language("ru"), "russian");
        assert_eq!(steam_language("en"), "english");
        assert_eq!(steam_language("de"), "english");
    }

    #[tokio::test]
    async fn loading_needs_a_token() {
        let server = MockServer::start().await;
        let err = state_for(&server).load_inventory("en", NOW).await.unwrap_err();
        assert_eq!(err.code, "noToken");
    }

    #[tokio::test]
    async fn expired_token_is_caught_before_any_request() {
        let server = MockServer::start().await;
        Mock::given(method("GET")).respond_with(inventory_reply(3)).expect(0).mount(&server).await;
        let state = state_for(&server);
        let mut token = test_token();
        token.expires_at = NOW - 1;
        state.session.lock().await.token = Some(token);
        assert_eq!(state.load_inventory("en", NOW).await.unwrap_err().code, "tokenExpired");
    }

    #[tokio::test]
    async fn set_token_rejects_garbage_and_keeps_nothing() {
        let server = MockServer::start().await;
        let state = state_for(&server);
        assert_eq!(state.set_token("hello", NOW).await.unwrap_err().code, "tokenNotFound");
        assert!(state.session.lock().await.token.is_none());
    }

    #[tokio::test]
    async fn preview_needs_an_inventory() {
        let server = MockServer::start().await;
        let err = state_for(&server).preview(Operation::SplitAll).await.unwrap_err();
        assert_eq!(err.code, "noInventory");
    }

    #[tokio::test]
    async fn previewed_plan_runs_and_is_reconciled() {
        let server = MockServer::start().await;
        Mock::given(method("GET")).and(path(INV)).respond_with(inventory_reply(3)).mount(&server).await;
        Mock::given(method("POST"))
            .and(path(SPLIT))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"response": {}})))
            .expect(2)
            .mount(&server)
            .await;
        let state = state_for(&server);
        with_token(&state).await;
        state.load_inventory("en", NOW).await.unwrap();
        assert_eq!(state.preview(Operation::SplitAll).await.unwrap().requests, 2);

        let mut events = Vec::new();
        let result = state.start(Operation::SplitAll, "en", NOW, |p| events.push(p)).await.unwrap();
        let StartResult::Finished { outcome, reconciliation, inventory } = result else {
            panic!("expected Finished, got {result:?}");
        };
        assert_eq!(outcome.reason, StopReason::Finished);
        assert_eq!(outcome.done, 2);
        let reconciliation = reconciliation.expect("reconciliation");
        assert_eq!((reconciliation.before, reconciliation.after), (3, 3));
        assert!(reconciliation.mismatches.is_empty());
        assert!(inventory.is_some());
        assert!(!events.is_empty());
        assert!(state.journal_text().contains("check: before 3, after 3"));
    }

    #[tokio::test]
    async fn changed_inventory_returns_a_new_plan_instead_of_running() {
        let server = MockServer::start().await;
        Mock::given(method("GET")).and(path(INV)).respond_with(inventory_reply(3)).up_to_n_times(1).mount(&server).await;
        Mock::given(method("GET")).and(path(INV)).respond_with(inventory_reply(4)).mount(&server).await;
        Mock::given(method("POST")).respond_with(ResponseTemplate::new(200)).expect(0).mount(&server).await;
        let state = state_for(&server);
        with_token(&state).await;
        state.load_inventory("en", NOW).await.unwrap();
        state.preview(Operation::SplitAll).await.unwrap();
        let result = state.start(Operation::SplitAll, "en", NOW, |_| {}).await.unwrap();
        let StartResult::PlanChanged { plan, .. } = result else {
            panic!("expected PlanChanged, got {result:?}");
        };
        assert_eq!(plan.requests, 3);
    }

    #[tokio::test]
    async fn start_without_preview_shows_the_plan_first() {
        let server = MockServer::start().await;
        Mock::given(method("GET")).and(path(INV)).respond_with(inventory_reply(3)).mount(&server).await;
        Mock::given(method("POST")).respond_with(ResponseTemplate::new(200)).expect(0).mount(&server).await;
        let state = state_for(&server);
        with_token(&state).await;
        let result = state.start(Operation::SplitAll, "en", NOW, |_| {}).await.unwrap();
        assert!(matches!(result, StartResult::PlanChanged { .. }), "{result:?}");
    }

    #[tokio::test]
    async fn second_start_while_running_is_busy() {
        let server = MockServer::start().await;
        let state = state_for(&server);
        state.running.store(true, Ordering::SeqCst);
        let err = state.start(Operation::SplitAll, "en", NOW, |_| {}).await.unwrap_err();
        assert_eq!(err.code, "busy");
    }

    #[tokio::test]
    async fn save_settings_normalizes_and_writes_the_file() {
        let server = MockServer::start().await;
        let path = std::env::temp_dir().join(format!("rss-commands-{}", std::process::id())).join("settings.json");
        let (sleep, _) = recording_sleep();
        let state = AppState::new(SteamClient::new(&server.uri(), sleep.clone()), sleep, Settings::default(), Some(path.clone()));
        let saved = state.save_settings(Settings { language: Some("ru".into()), delay_ms: 50 }).unwrap();
        assert_eq!(saved, Settings { language: Some("ru".into()), delay_ms: 500 });
        assert_eq!(state.settings(), saved);
        assert_eq!(crate::settings::load(&path), saved);
    }
}
```

- [ ] **Step 3: Убедиться, что тесты не собираются**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::`
Expected: ошибка компиляции, нет `AppState`, `UiError`, `StartResult`.

- [ ] **Step 4: Реализация команд**

Вставь над модулем тестов в `src-tauri/src/commands.rs`:

```rust
//! Команды окна. Токен остаётся в ядре: окно получает только `TokenInfo`.
//! Логика — в методах `AppState`, чтобы её можно было проверить без Tauri.

use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::inventory::{self, Inventory, Reconciliation};
use crate::journal::Journal;
use crate::plan::{self, Operation, Plan};
use crate::runner::{self, Progress, RunConfig, RunOutcome, SteamStacker};
use crate::settings::{self, Settings};
use crate::steam::{SleepFn, SteamClient, SteamError};
use crate::token::{self, Token, TokenError, TokenInfo};

pub const PROGRESS_EVENT: &str = "run-progress";

/// Ошибка для окна: код, по которому окно берёт текст из i18n.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiError {
    pub code: &'static str,
    pub status: Option<u16>,
}

impl UiError {
    fn new(code: &'static str) -> Self {
        Self { code, status: None }
    }
}

impl From<TokenError> for UiError {
    fn from(e: TokenError) -> Self {
        UiError::new(match e {
            TokenError::NotFound => "tokenNotFound",
            TokenError::NoExpiry => "tokenNoExpiry",
            TokenError::Expired => "tokenExpired",
            TokenError::SteamIdMismatch => "tokenSteamIdMismatch",
        })
    }
}

impl From<SteamError> for UiError {
    fn from(e: SteamError) -> Self {
        match e {
            SteamError::Auth(status) => UiError { code: "tokenRejected", status: Some(status) },
            SteamError::RateLimited { .. } => UiError::new("rateLimited"),
            SteamError::Http(status) => UiError { code: "http", status: Some(status) },
            SteamError::Rejected(_) => UiError::new("steamRejected"),
            SteamError::Network(_) => UiError::new("network"),
            SteamError::BadResponse => UiError::new("badResponse"),
            SteamError::PagingLoop => UiError::new("pagingLoop"),
            SteamError::TooLarge => UiError::new("tooLarge"),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StartResult {
    /// Инвентарь изменился после предпросмотра: показать новый план, не запускать.
    PlanChanged { plan: Plan, inventory: Inventory },
    /// Операция закончилась. Сверки нет, если инвентарь не удалось перечитать.
    Finished { outcome: RunOutcome, reconciliation: Option<Reconciliation>, inventory: Option<Inventory> },
}

#[derive(Default)]
struct Session {
    token: Option<Token>,
    inventory: Option<Inventory>,
    last_plan: Option<Plan>,
}

pub struct AppState {
    client: SteamClient,
    sleep: SleepFn,
    session: tokio::sync::Mutex<Session>,
    stop: AtomicBool,
    running: AtomicBool,
    journal: Journal,
    settings: Mutex<Settings>,
    settings_path: Option<PathBuf>,
}

pub fn steam_language(lang: &str) -> &'static str {
    if lang == "ru" { "russian" } else { "english" }
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

impl AppState {
    pub fn new(client: SteamClient, sleep: SleepFn, settings: Settings, settings_path: Option<PathBuf>) -> Self {
        Self {
            client,
            sleep,
            session: tokio::sync::Mutex::new(Session::default()),
            stop: AtomicBool::new(false),
            running: AtomicBool::new(false),
            journal: Journal::default(),
            settings: Mutex::new(settings.normalized()),
            settings_path,
        }
    }

    pub async fn set_token(&self, raw: &str, now: i64) -> Result<TokenInfo, UiError> {
        if self.running.load(Ordering::SeqCst) {
            return Err(UiError::new("busy"));
        }
        let token = token::parse_token(raw, now)?;
        let info = token.info();
        *self.session.lock().await = Session { token: Some(token), ..Session::default() };
        self.journal.add(format!("token accepted for {}", info.steamid_masked));
        Ok(info)
    }

    pub async fn forget_token(&self) {
        self.stop.store(true, Ordering::SeqCst);
        *self.session.lock().await = Session::default();
        self.journal.add("token forgotten");
    }

    async fn token(&self, now: i64) -> Result<Token, UiError> {
        let token = self.session.lock().await.token.clone().ok_or(UiError::new("noToken"))?;
        if token.is_expired(now) {
            return Err(UiError::new("tokenExpired"));
        }
        Ok(token)
    }

    async fn read_inventory(&self, token: &Token, lang: &str) -> Result<Inventory, UiError> {
        match inventory::load(&self.client, token, steam_language(lang)).await {
            Ok(inv) => {
                self.journal.add(format!("inventory read: {} skins, {} items", inv.skins.len(), inv.total()));
                Ok(inv)
            }
            Err(e) => {
                self.journal.add(format!("inventory read failed: {e}"));
                Err(e.into())
            }
        }
    }

    pub async fn load_inventory(&self, lang: &str, now: i64) -> Result<Inventory, UiError> {
        let token = self.token(now).await?;
        let inv = self.read_inventory(&token, lang).await?;
        let mut session = self.session.lock().await;
        session.inventory = Some(inv.clone());
        session.last_plan = None;
        Ok(inv)
    }

    pub async fn preview(&self, operation: Operation) -> Result<Plan, UiError> {
        let mut session = self.session.lock().await;
        let inv = session.inventory.as_ref().ok_or(UiError::new("noInventory"))?;
        let plan = plan::build(inv, &operation);
        session.last_plan = Some(plan.clone());
        Ok(plan)
    }

    pub async fn start(
        &self,
        operation: Operation,
        lang: &str,
        now: i64,
        emit: impl FnMut(Progress),
    ) -> Result<StartResult, UiError> {
        if self.running.swap(true, Ordering::SeqCst) {
            return Err(UiError::new("busy"));
        }
        let result = self.run_operation(operation, lang, now, emit).await;
        self.running.store(false, Ordering::SeqCst);
        result
    }

    async fn run_operation(
        &self,
        operation: Operation,
        lang: &str,
        now: i64,
        emit: impl FnMut(Progress),
    ) -> Result<StartResult, UiError> {
        self.stop.store(false, Ordering::SeqCst);
        let token = self.token(now).await?;
        let previewed = self.session.lock().await.last_plan.clone();

        // Правило 1: перед запуском инвентарь перечитывается.
        let before = self.read_inventory(&token, lang).await?;
        let plan = plan::build(&before, &operation);
        {
            let mut session = self.session.lock().await;
            session.inventory = Some(before.clone());
            session.last_plan = Some(plan.clone());
        }
        let unchanged = previewed.is_some_and(|p| p.operation == operation && p.steps == plan.steps);
        if !unchanged {
            self.journal.add("inventory changed since the preview, showing the new plan");
            return Ok(StartResult::PlanChanged { plan, inventory: before });
        }

        let delay_ms = self.settings.lock().unwrap_or_else(|e| e.into_inner()).delay_ms;
        let config = RunConfig { delay: Duration::from_millis(u64::from(delay_ms)) };
        self.journal.add(format!("start: {} requests, pause {delay_ms} ms", plan.requests));
        let api = SteamStacker { client: self.client.clone(), token: token.clone() };
        let outcome = runner::run(&api, &plan.steps, &config, &self.stop, &self.sleep, &self.journal, emit).await;
        self.journal.add(format!(
            "finished: {:?}, done {}, errors {}",
            outcome.reason, outcome.done, outcome.errors
        ));

        // Правило 7: сверка по свежему чтению инвентаря.
        match self.read_inventory(&token, lang).await {
            Ok(after) => {
                let reconciliation = inventory::reconcile(&before, &after);
                self.journal.add(format!(
                    "check: before {}, after {}, mismatches {}",
                    reconciliation.before,
                    reconciliation.after,
                    reconciliation.mismatches.len()
                ));
                for m in &reconciliation.mismatches {
                    self.journal.add(format!("mismatch «{}»: {} -> {}", m.key, m.before, m.after));
                }
                let mut session = self.session.lock().await;
                session.inventory = Some(after.clone());
                session.last_plan = None;
                Ok(StartResult::Finished { outcome, reconciliation: Some(reconciliation), inventory: Some(after) })
            }
            Err(_) => Ok(StartResult::Finished { outcome, reconciliation: None, inventory: None }),
        }
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        self.journal.add("stop requested");
    }

    pub fn settings(&self) -> Settings {
        self.settings.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn save_settings(&self, settings: Settings) -> Result<Settings, UiError> {
        let settings = settings.normalized();
        if let Some(path) = &self.settings_path {
            settings::save(path, &settings).map_err(|_| UiError::new("settingsNotSaved"))?;
        }
        *self.settings.lock().unwrap_or_else(|e| e.into_inner()) = settings.clone();
        Ok(settings)
    }

    pub fn journal_text(&self) -> String {
        self.journal.text()
    }
}

#[tauri::command]
pub async fn set_token(state: State<'_, AppState>, raw: String) -> Result<TokenInfo, UiError> {
    state.set_token(&raw, now()).await
}

#[tauri::command]
pub async fn forget_token(state: State<'_, AppState>) -> Result<(), UiError> {
    state.forget_token().await;
    Ok(())
}

#[tauri::command]
pub async fn load_inventory(state: State<'_, AppState>, lang: String) -> Result<Inventory, UiError> {
    state.load_inventory(&lang, now()).await
}

#[tauri::command]
pub async fn preview(state: State<'_, AppState>, operation: Operation) -> Result<Plan, UiError> {
    state.preview(operation).await
}

#[tauri::command]
pub async fn start(
    app: AppHandle,
    state: State<'_, AppState>,
    operation: Operation,
    lang: String,
) -> Result<StartResult, UiError> {
    state
        .start(operation, &lang, now(), |progress| {
            let _ = app.emit(PROGRESS_EVENT, progress);
        })
        .await
}

#[tauri::command]
pub fn stop(state: State<'_, AppState>) {
    state.stop();
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings()
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<Settings, UiError> {
    state.save_settings(settings)
}

#[tauri::command]
pub fn journal(state: State<'_, AppState>) -> String {
    state.journal_text()
}
```

- [ ] **Step 5: Подключить ядро в `lib.rs`**

`src-tauri/src/lib.rs` целиком:

```rust
pub mod commands;
pub mod inventory;
pub mod journal;
pub mod plan;
pub mod runner;
pub mod settings;
pub mod steam;
pub mod token;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let settings_path = app.path().app_config_dir().ok().map(|dir| dir.join("settings.json"));
            let settings = settings_path.as_deref().map(settings::load).unwrap_or_default();
            let sleep = steam::tokio_sleep();
            let client = steam::SteamClient::new(steam::API_BASE, sleep.clone());
            app.manage(commands::AppState::new(client, sleep, settings, settings_path));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::set_token,
            commands::forget_token,
            commands::load_inventory,
            commands::preview,
            commands::start,
            commands::stop,
            commands::get_settings,
            commands::save_settings,
            commands::journal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 6: Тесты и сборка**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: все тесты ядра PASS (settings — 6, commands — 11, плюс тесты Task 2–6).

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`, `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: без замечаний.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src
git commit -m "feat: команды окна, настройки и сборка ядра

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Основа окна — типы, API, демо-режим, тексты, форматирование, модель, стили

Всё, на чём стоят экраны Task 9–12: типы данных ядра, вызовы команд, демо-режим для браузера, i18n EN/RU, форматирование, чистые функции модели, `h()`, состояние и базовые стили. Логика с ветвлениями покрыта тестами Vitest.

**Files:**
- Create: `src/types.ts`, `src/api.ts`, `src/store.ts`, `src/dom.ts`, `src/format.ts`, `src/model.ts`
- Create: `src/i18n/index.ts`, `src/i18n/en.json`, `src/i18n/ru.json`
- Create: `src/dev/mock.ts`, `src/dev/demo-items.json`
- Create: `src/styles/tokens.css`, `src/styles/base.css`
- Test: `src/i18n/i18n.test.ts`, `src/format.test.ts`, `src/model.test.ts`

**Interfaces:**
- Consumes: команды и типы ядра из Task 7 (таблица команд и JSON-формы в Task 2–7).
- Produces (имена, которые используют Task 9–12):
  - `types.ts`: `TokenInfo`, `Category`, `InvRecord`, `Skin`, `Unreadable`, `Inventory`, `Operation`, `QueueItem`, `SkinAfter`, `Plan`, `Progress`, `StopReason`, `RunOutcome`, `Mismatch`, `Reconciliation`, `StartResult`, `Settings`, `UiError`;
  - `api.ts`:
    - `api: Api` с методами `setToken`, `forgetToken`, `loadInventory`, `preview`, `start`, `stop`, `getSettings`, `saveSettings`, `journal`, `onProgress`, `openTokenPage`;
    - `useApi(next)`, `inTauri()`, `asUiError(e)`, `TOKEN_PAGE`;
  - `i18n/index.ts`: `Lang`, `detectLang`, `setLang`, `getLang`, `has`, `t`, `tn`, `errorText`;
  - `format.ts`: `iconUrl`, `fmtInt`, `fmtSeconds`, `fmtDuration`, `fmtTimeLeft`, `estimateSeconds`, `fmtDate`;
  - `model.ts`:
    - `Show`, `Sort`, `Filter`, `Layout`, `Pill`, `Counts`, `Totals`, `Selection`, `SelectMode`;
    - `defaultFilter`, `layoutOf`, `hasStack`, `isDupe`, `splitCapacity`, `canCombine`, `apartRecords`, `matches`, `visibleSkins`, `counts`, `totals`, `categoriesOf`, `nextSelection`, `layoutText`, `pillsOf`;
  - `store.ts`: `Panel`, `State`, `initialFilter`, `initState`, `getState`, `setState`, `subscribe`;
  - `dom.ts`: `h(tag, attrs, ...children)`, `icon(name)`;
  - `dev/mock.ts`: `createMockApi(): Api`.

- [ ] **Step 1: Типы ядра**

`src/types.ts`:
```ts
// Данные из Rust-ядра (serde, camelCase). Меняются вместе с src-tauri/src.

export interface TokenInfo {
  steamidMasked: string;
  expiresAt: number;
}

export interface Category {
  id: string;
  label: string;
}

export interface InvRecord {
  assetid: string;
  classid: string;
  instanceid: string;
  amount: number;
  tradable: boolean;
  marketable: boolean;
  availableAfter: string | null;
}

export interface Skin {
  key: string;
  name: string;
  icon: string | null;
  category: Category | null;
  total: number;
  /** По убыванию amount. */
  records: InvRecord[];
}

export interface Unreadable {
  assetid: string | null;
  amount: number;
}

export interface Inventory {
  skins: Skin[];
  unreadable: Unreadable[];
}

export type Operation =
  | { kind: 'splitAll' }
  | { kind: 'combineAll' }
  | { kind: 'splitSelected'; keys: string[] }
  | { kind: 'combineSelected'; keys: string[] }
  | { kind: 'splitOff'; key: string; count: number };

export interface QueueItem {
  key: string;
  amount: number;
  requests: number;
}

export interface SkinAfter {
  key: string;
  stacks: number[];
  singles: number;
}

export interface Plan {
  operation: Operation;
  requests: number;
  stacks: number;
  queue: QueueItem[];
  more: number;
  after: SkinAfter[];
}

export type Progress =
  | { kind: 'request'; done: number; total: number; errors: number; key: string }
  | { kind: 'waiting'; seconds: number };

export type StopReason = 'finished' | 'stoppedByUser' | 'tokenRejected' | 'tooManyFailures';

export interface RunOutcome {
  reason: StopReason;
  done: number;
  errors: number;
  total: number;
}

export interface Mismatch {
  key: string;
  name: string;
  before: number;
  after: number;
}

export interface Reconciliation {
  before: number;
  after: number;
  mismatches: Mismatch[];
}

export type StartResult =
  | { kind: 'planChanged'; plan: Plan; inventory: Inventory }
  | { kind: 'finished'; outcome: RunOutcome; reconciliation: Reconciliation | null; inventory: Inventory | null };

export interface Settings {
  language: 'en' | 'ru' | null;
  delayMs: number;
}

export interface UiError {
  code: string;
  status: number | null;
}
```

- [ ] **Step 2: Тексты EN и RU**

`src/i18n/en.json`:
```json
{
  "app.name": "Rust Skin Stacker",
  "app.disclaimer": "Not affiliated with Valve or Facepunch.",

  "login.title": "Sign in with a Steam token",
  "login.lead": "The app needs a temporary Steam token. With it, the app reads your Rust inventory and splits or combines stacks. The token lasts about a day.",
  "login.step1": "Open the token page in a browser where you are signed in to Steam.",
  "login.step2": "Select everything on the page and copy it: Ctrl+A, then Ctrl+C.",
  "login.step3": "Paste it into the field below. The app finds the token itself.",
  "login.open": "Open the token page",
  "login.placeholder": "Paste the whole page or just the token",
  "login.ok": "Token for account {id}, valid for {left}",
  "login.continue": "Continue",
  "login.checking": "Checking…",
  "login.safeTitle": "Why this is safe",
  "login.safe1": "The token stays only in the app's memory and is gone when you close it. It is never written to disk.",
  "login.safe2": "Requests go only to Steam. There are no other servers and no telemetry.",
  "login.safe3": "The code is open under GPL-3.0. Builds are made on GitHub Actions, and each one comes with a provenance attestation.",

  "error.tokenNotFound": "There is no Steam token in this text. Copy the whole token page and paste it again.",
  "error.tokenNoExpiry": "The token has no expiry date. Get a new one on the token page.",
  "error.tokenExpired": "The token has expired. Get a new one on the token page.",
  "error.tokenSteamIdMismatch": "The SteamID in the cookie does not match the token.",
  "error.tokenRejected": "Steam did not accept the token. Paste a new one.",
  "error.noToken": "Paste a token first.",
  "error.rateLimited": "Steam asks to wait. Try again in a minute.",
  "error.http": "Steam answered with error {status}. Try again later.",
  "error.steamRejected": "Steam refused the request.",
  "error.network": "No connection to Steam. Check the internet and try again.",
  "error.badResponse": "Steam sent an unexpected answer. Try again later.",
  "error.pagingLoop": "Steam sent the same inventory page twice. Try again later.",
  "error.tooLarge": "The inventory is too large to read in full.",
  "error.busy": "An operation is already running.",
  "error.noInventory": "Load the inventory first.",
  "error.settingsNotSaved": "Could not save the settings.",
  "error.unknown": "Something went wrong. Copy the log and describe the problem in a GitHub issue.",

  "top.splitAll": "Split all",
  "top.combineAll": "Combine all",
  "top.account": "{id} · token valid for {left}",
  "top.accountExpired": "{id} · token expired",
  "top.menu": "Menu",
  "top.lang": "Change language",
  "menu.settings": "Settings",
  "menu.copyLog": "Copy log",
  "menu.logCopied": "Log copied",
  "menu.copyFailed": "Could not copy",
  "menu.forget": "Forget token",

  "filters.search": "Search",
  "filters.show": "Show",
  "filters.all": "All",
  "filters.stacks": "Stacks",
  "filters.dupes": "Duplicates",
  "filters.dupesHint": "Items with more than one entry",
  "filters.type": "Type",
  "filters.noTypes": "No types",
  "stats.total": "Total",
  "stats.records": "Entries in Steam",
  "stats.stacks": "Stacks",
  "stats.unreadable": "Unreadable entries",

  "grid.title": "Inventory",
  "grid.meta_one": "{count} item in stacks",
  "grid.meta_other": "{count} items in stacks",
  "grid.sort": "Sort",
  "sort.amount": "Most pieces first",
  "sort.name": "By name",
  "grid.empty": "There are no Rust items in this inventory.",
  "grid.nothingFound": "Nothing matches these filters.",
  "grid.loading": "Loading the inventory…",
  "card.total": "{count} pcs",
  "layout.singles_one": "{count} single",
  "layout.singles_other": "{count} singles",
  "layout.stackWord_one": "stack",
  "layout.stackWord_other": "stacks",
  "layout.both": "{stacks} and {singles}",
  "after.becomes": "becomes {layout}",

  "panel.hintTitle": "Pick an item",
  "panel.hintClick": "Click a card to open the item. Ctrl + click or Shift + click selects several.",
  "panel.hintKeys": "Keyboard: arrows move, Space selects, Enter opens.",
  "panel.hintSplitAll": "Split all turns every stack into single items.",
  "panel.hintCombineAll": "Combine all puts identical items back into stacks.",
  "panel.allSingle": "Everything is already single.",

  "item.marketable": "Can be sold on the Steam Market",
  "item.tradable": "Can be traded",
  "item.records": "Entries in inventory",
  "item.yes": "yes",
  "item.no": "no",
  "item.from": "from {date}",
  "item.apart_one": "{count} entry won't combine with the rest: Steam gives it a different trade status. Such entries go into a stack of their own.",
  "item.apart_other": "{count} entries won't combine with the rest: Steam gives them a different trade status. Such entries go into a stack of their own.",
  "item.splitOff": "Split off one by one",
  "item.less": "Fewer",
  "item.more": "More",
  "item.count": "How many to split off",
  "item.result": "Becomes: {layout} · {requests}, {time}",
  "item.splitN": "Split off {count}",
  "item.combine": "Combine",
  "item.nothingToSplit": "Every entry is already single.",
  "item.foot": "The inventory is re-read before every operation.",

  "multi.title": "Selected: {items}, {pcs}",
  "multi.items_one": "{count} item",
  "multi.items_other": "{count} items",
  "multi.split": "Split selected",
  "multi.combine": "Combine selected",
  "multi.clear": "Clear selection",
  "multi.more": "+{count}",

  "op.splitAll": "Split all",
  "op.splitAll.sub": "Every stack becomes single items",
  "op.combineAll": "Combine all",
  "op.combineAll.sub": "Identical items go back into stacks",
  "op.splitSelected": "Split selected",
  "op.splitSelected.sub": "Selected stacks become single items",
  "op.combineSelected": "Combine selected",
  "op.combineSelected.sub": "Selected identical items go back into stacks",
  "op.splitOff": "Split off {count}",
  "op.splitOff.sub": "{count} pcs become single items, the rest stays a stack",

  "plan.requests_one": "{count} request",
  "plan.requests_other": "{count} requests",
  "plan.changed": "The inventory changed while you were looking at the plan. Here is the new one — check it and run again.",
  "plan.stacks": "Stacks affected",
  "plan.requestsLabel": "Requests to Steam",
  "plan.time": "Takes about",
  "plan.queue": "Queue",
  "plan.queueReq": "{count} req.",
  "plan.more_one": "and {count} more stack",
  "plan.more_other": "and {count} more stacks",
  "plan.check": "After the run the inventory is re-read and the count is checked: {count} pcs before, {count} pcs should remain.",
  "plan.run": "Run",
  "plan.cancel": "Cancel",
  "plan.close": "Close",
  "plan.nothingSplit": "Nothing to do: everything is already single.",
  "plan.nothingCombine": "Nothing to do: there are no identical entries to combine.",

  "run.title": "Running: {op}",
  "run.progress": "Done {done} of {total}, errors {errors}",
  "run.current": "Now: {name}",
  "run.left": "{time} left",
  "run.waiting": "Steam asked to wait: {seconds} s",
  "run.stop": "Stop",
  "run.stopping": "Stopping after the current request…",
  "run.browse": "You can keep browsing the grid while it runs.",

  "result.done": "Done",
  "result.stopped": "Stopped",
  "result.summary": "{requests}, errors {errors}",
  "result.reason.stoppedByUser": "Stopped with the Stop button. What was done stays done.",
  "result.reason.tokenRejected": "Steam stopped accepting the token. Paste a new one and run again — what was done stays done.",
  "result.reason.tooManyFailures": "Three requests in a row failed, so the app stopped. Details are in the log.",
  "result.checkOk": "Check: {before} pcs before — {after} pcs now",
  "result.checkBad": "Check failed: {before} pcs before — {after} pcs now",
  "result.mismatch": "{name}: was {before}, now {after}",
  "result.checkUnavailable": "Could not check the count: the inventory did not load. Re-read it.",
  "result.reload": "Re-read inventory",
  "result.copyLog": "Copy log",
  "result.copied": "Copied",
  "result.close": "Close",

  "banner.tokenExpired": "The token has expired — paste a new one.",
  "banner.newToken": "Paste token",
  "banner.retry": "Try again",

  "settings.title": "Settings",
  "settings.language": "Language",
  "settings.system": "As in the system",
  "settings.delay": "Pause between requests",
  "settings.delayHint": "A shorter pause is faster, but Steam asks to wait more often. Default is 1.5 s.",
  "settings.delayValue": "{value} s",
  "settings.save": "Save",
  "settings.close": "Close",
  "settings.about": "Open source under GPL-3.0. Not affiliated with Valve or Facepunch. Use at your own risk.",

  "time.seconds": "~{n} s",
  "time.minutes": "~{n} min",
  "time.hoursMinutes": "~{h} h {m} min",
  "time.expired": "expired",
  "time.minutesShort": "{n} min",
  "time.hoursShort": "{n} h"
}
```

`src/i18n/ru.json`:
```json
{
  "app.name": "Rust Skin Stacker",
  "app.disclaimer": "Не связано с Valve и Facepunch.",

  "login.title": "Вход по токену Steam",
  "login.lead": "Приложению нужен временный токен Steam. С ним оно читает инвентарь Rust и делит или собирает стопки. Токен действует около суток.",
  "login.step1": "Откройте страницу токена в браузере, где вы вошли в Steam.",
  "login.step2": "Выделите всё на странице и скопируйте: Ctrl+A, затем Ctrl+C.",
  "login.step3": "Вставьте в поле ниже — приложение само найдёт токен.",
  "login.open": "Открыть страницу токена",
  "login.placeholder": "Вставьте страницу целиком или только токен",
  "login.ok": "Токен аккаунта {id}, действует ещё {left}",
  "login.continue": "Продолжить",
  "login.checking": "Проверяю…",
  "login.safeTitle": "Почему это безопасно",
  "login.safe1": "Токен хранится только в памяти приложения и исчезает при закрытии. На диск он не записывается.",
  "login.safe2": "Запросы уходят только в Steam. Других серверов и телеметрии нет.",
  "login.safe3": "Код открыт под GPL-3.0. Сборки делаются в GitHub Actions, к каждой приложено подтверждение происхождения.",

  "error.tokenNotFound": "В тексте нет токена Steam. Скопируйте страницу токена целиком и вставьте ещё раз.",
  "error.tokenNoExpiry": "У токена нет срока действия. Получите новый на странице токена.",
  "error.tokenExpired": "Срок токена истёк. Получите новый на странице токена.",
  "error.tokenSteamIdMismatch": "SteamID в cookie не совпадает с токеном.",
  "error.tokenRejected": "Steam не принял токен. Вставьте новый.",
  "error.noToken": "Сначала вставьте токен.",
  "error.rateLimited": "Steam просит подождать. Попробуйте через минуту.",
  "error.http": "Steam ответил ошибкой {status}. Попробуйте позже.",
  "error.steamRejected": "Steam отклонил запрос.",
  "error.network": "Нет связи со Steam. Проверьте интернет и попробуйте ещё раз.",
  "error.badResponse": "Steam прислал непонятный ответ. Попробуйте позже.",
  "error.pagingLoop": "Steam дважды прислал одну и ту же страницу инвентаря. Попробуйте позже.",
  "error.tooLarge": "Инвентарь слишком большой, прочитать его целиком не получилось.",
  "error.busy": "Операция уже идёт.",
  "error.noInventory": "Сначала загрузите инвентарь.",
  "error.settingsNotSaved": "Не получилось сохранить настройки.",
  "error.unknown": "Что-то пошло не так. Скопируйте журнал и опишите проблему в issue на GitHub.",

  "top.splitAll": "Разделить всё",
  "top.combineAll": "Собрать всё",
  "top.account": "{id} · токен ещё {left}",
  "top.accountExpired": "{id} · токен истёк",
  "top.menu": "Меню",
  "top.lang": "Сменить язык",
  "menu.settings": "Настройки",
  "menu.copyLog": "Скопировать журнал",
  "menu.logCopied": "Журнал скопирован",
  "menu.copyFailed": "Не удалось скопировать",
  "menu.forget": "Забыть токен",

  "filters.search": "Поиск",
  "filters.show": "Показать",
  "filters.all": "Все",
  "filters.stacks": "Стопки",
  "filters.dupes": "Дубли",
  "filters.dupesHint": "У предмета больше одной записи",
  "filters.type": "Тип",
  "filters.noTypes": "Типов нет",
  "stats.total": "Всего",
  "stats.records": "Записей в Steam",
  "stats.stacks": "Стопок",
  "stats.unreadable": "Нечитаемых записей",

  "grid.title": "Инвентарь",
  "grid.meta_one": "{count} предмет в стопках",
  "grid.meta_few": "{count} предмета в стопках",
  "grid.meta_many": "{count} предметов в стопках",
  "grid.meta_other": "{count} предмета в стопках",
  "grid.sort": "Сортировка",
  "sort.amount": "Больше всего штук",
  "sort.name": "По названию",
  "grid.empty": "В инвентаре Rust нет предметов.",
  "grid.nothingFound": "По этим фильтрам ничего нет.",
  "grid.loading": "Загружаю инвентарь…",
  "card.total": "{count} шт.",
  "layout.singles_one": "{count} по одному",
  "layout.singles_few": "{count} по одному",
  "layout.singles_many": "{count} по одному",
  "layout.singles_other": "{count} по одному",
  "layout.stackWord_one": "стопка",
  "layout.stackWord_few": "стопки",
  "layout.stackWord_many": "стопок",
  "layout.stackWord_other": "стопки",
  "layout.both": "{stacks} и {singles}",
  "after.becomes": "станет {layout}",

  "panel.hintTitle": "Выберите предмет",
  "panel.hintClick": "Клик по карточке открывает предмет. Ctrl + клик или Shift + клик выбирают несколько.",
  "panel.hintKeys": "С клавиатуры: стрелки — по сетке, пробел — выбрать, Enter — открыть.",
  "panel.hintSplitAll": "«Разделить всё» превратит каждую стопку в отдельные предметы.",
  "panel.hintCombineAll": "«Собрать всё» сложит одинаковые предметы обратно в стопки.",
  "panel.allSingle": "Всё уже лежит по одному.",

  "item.marketable": "Можно продать на площадке Steam",
  "item.tradable": "Можно обменять",
  "item.records": "Записей в инвентаре",
  "item.yes": "да",
  "item.no": "нет",
  "item.from": "с {date}",
  "item.apart_one": "{count} запись не соберётся с остальными: у неё в Steam другой статус обмена. Такие записи собираются в отдельную стопку.",
  "item.apart_few": "{count} записи не соберутся с остальными: у них в Steam другой статус обмена. Такие записи собираются в отдельную стопку.",
  "item.apart_many": "{count} записей не соберутся с остальными: у них в Steam другой статус обмена. Такие записи собираются в отдельную стопку.",
  "item.apart_other": "{count} записи не соберутся с остальными: у них в Steam другой статус обмена. Такие записи собираются в отдельную стопку.",
  "item.splitOff": "Отделить по одному",
  "item.less": "Меньше",
  "item.more": "Больше",
  "item.count": "Сколько отделить",
  "item.result": "Станет: {layout} · {requests}, {time}",
  "item.splitN": "Отделить {count}",
  "item.combine": "Собрать",
  "item.nothingToSplit": "Все записи уже лежат по одному.",
  "item.foot": "Перед операцией инвентарь перечитывается.",

  "multi.title": "Выбрано: {items}, {pcs}",
  "multi.items_one": "{count} предмет",
  "multi.items_few": "{count} предмета",
  "multi.items_many": "{count} предметов",
  "multi.items_other": "{count} предмета",
  "multi.split": "Разделить выбранные",
  "multi.combine": "Собрать выбранные",
  "multi.clear": "Снять выбор",
  "multi.more": "+{count}",

  "op.splitAll": "Разделить всё",
  "op.splitAll.sub": "Каждая стопка станет отдельными предметами",
  "op.combineAll": "Собрать всё",
  "op.combineAll.sub": "Одинаковые предметы соберутся в стопки",
  "op.splitSelected": "Разделить выбранные",
  "op.splitSelected.sub": "Выбранные стопки станут отдельными предметами",
  "op.combineSelected": "Собрать выбранные",
  "op.combineSelected.sub": "Выбранные одинаковые предметы соберутся в стопки",
  "op.splitOff": "Отделить {count}",
  "op.splitOff.sub": "{count} шт. станут отдельными предметами, остальное останется стопкой",

  "plan.requests_one": "{count} запрос",
  "plan.requests_few": "{count} запроса",
  "plan.requests_many": "{count} запросов",
  "plan.requests_other": "{count} запроса",
  "plan.changed": "Инвентарь изменился, пока вы смотрели план. Вот новый — проверьте его и запустите ещё раз.",
  "plan.stacks": "Стопок затронет",
  "plan.requestsLabel": "Запросов к Steam",
  "plan.time": "Займёт примерно",
  "plan.queue": "Очередь",
  "plan.queueReq": "{count} запр.",
  "plan.more_one": "и ещё {count} стопка",
  "plan.more_few": "и ещё {count} стопки",
  "plan.more_many": "и ещё {count} стопок",
  "plan.more_other": "и ещё {count} стопки",
  "plan.check": "После запуска инвентарь перечитается и количество сверится: было {count} шт. — должно остаться {count} шт.",
  "plan.run": "Запустить",
  "plan.cancel": "Отмена",
  "plan.close": "Закрыть",
  "plan.nothingSplit": "Делать нечего: всё уже лежит по одному.",
  "plan.nothingCombine": "Делать нечего: одинаковых записей, которые можно собрать, нет.",

  "run.title": "Идёт: {op}",
  "run.progress": "Выполнено {done} из {total}, ошибок {errors}",
  "run.current": "Сейчас: {name}",
  "run.left": "Осталось {time}",
  "run.waiting": "Steam попросил подождать: {seconds} с",
  "run.stop": "Остановить",
  "run.stopping": "Остановлюсь после текущего запроса…",
  "run.browse": "Сетку можно листать, пока идёт операция.",

  "result.done": "Готово",
  "result.stopped": "Остановлено",
  "result.summary": "{requests}, ошибок {errors}",
  "result.reason.stoppedByUser": "Остановлено кнопкой «Остановить». Сделанное сохранилось.",
  "result.reason.tokenRejected": "Steam перестал принимать токен. Вставьте новый и запустите снова — сделанное сохранилось.",
  "result.reason.tooManyFailures": "Три запроса подряд не прошли, поэтому приложение остановилось. Подробности — в журнале.",
  "result.checkOk": "Сверка: было {before} шт. — стало {after} шт.",
  "result.checkBad": "Сверка не сошлась: было {before} шт. — стало {after} шт.",
  "result.mismatch": "{name}: было {before}, стало {after}",
  "result.checkUnavailable": "Сверить не удалось: инвентарь не загрузился. Перечитайте его.",
  "result.reload": "Перечитать инвентарь",
  "result.copyLog": "Скопировать журнал",
  "result.copied": "Скопировано",
  "result.close": "Закрыть",

  "banner.tokenExpired": "Токен истёк — вставьте новый.",
  "banner.newToken": "Вставить токен",
  "banner.retry": "Повторить",

  "settings.title": "Настройки",
  "settings.language": "Язык",
  "settings.system": "Как в системе",
  "settings.delay": "Пауза между запросами",
  "settings.delayHint": "Чем пауза короче, тем быстрее идёт операция, но тем чаще Steam просит подождать. По умолчанию 1,5 с.",
  "settings.delayValue": "{value} с",
  "settings.save": "Сохранить",
  "settings.close": "Закрыть",
  "settings.about": "Открытый код под GPL-3.0. Не связано с Valve и Facepunch. Пользуйтесь на свой риск.",

  "time.seconds": "~{n} с",
  "time.minutes": "~{n} мин",
  "time.hoursMinutes": "~{h} ч {m} мин",
  "time.expired": "истёк",
  "time.minutesShort": "{n} мин",
  "time.hoursShort": "{n} ч"
}
```

- [ ] **Step 3: Тесты i18n, форматирования и модели**

`src/i18n/i18n.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import en from './en.json';
import ru from './ru.json';
import { detectLang, errorText, setLang, t, tn } from './index';

const PLURAL = /_(zero|one|two|few|many|other)$/;
const baseKeys = (dict: object) => [...new Set(Object.keys(dict).map((k) => k.replace(PLURAL, '')))].sort();
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  it('en and ru have the same keys', () => {
    expect(baseKeys(ru)).toEqual(baseKeys(en));
  });

  it('plural keys have every form the language needs', () => {
    const plurals = baseKeys(Object.fromEntries(Object.entries(en).filter(([k]) => PLURAL.test(k))));
    for (const key of plurals) {
      for (const form of ['one', 'other']) expect(Object.keys(en)).toContain(`${key}_${form}`);
      for (const form of ['one', 'few', 'many', 'other']) expect(Object.keys(ru)).toContain(`${key}_${form}`);
    }
  });

  it('placeholders match between languages', () => {
    const ruDict = ru as Record<string, string>;
    for (const [key, text] of Object.entries(en)) {
      const other = ruDict[key];
      if (other !== undefined) expect(placeholders(other), key).toEqual(placeholders(text));
    }
  });

  it('substitutes variables and plural forms', () => {
    setLang('ru');
    expect(t('time.seconds', { n: 3 })).toBe('~3 с');
    expect(tn('plan.requests', 1)).toBe('1 запрос');
    expect(tn('plan.requests', 2)).toBe('2 запроса');
    expect(tn('plan.requests', 5)).toBe('5 запросов');
    expect(tn('plan.requests', 21)).toBe('21 запрос');
    setLang('en');
    expect(tn('plan.requests', 1)).toBe('1 request');
    expect(tn('plan.requests', 72)).toBe('72 requests');
  });

  it('returns the key when the text is missing', () => {
    setLang('ru');
    expect(t('no.such.key')).toBe('no.such.key');
  });

  it('turns error codes into text', () => {
    setLang('en');
    expect(errorText({ code: 'http', status: 502 })).toBe('Steam answered with error 502. Try again later.');
    expect(errorText({ code: 'whatever', status: null })).toBe(t('error.unknown'));
  });

  it('detects the language from the system locale', () => {
    expect(detectLang('ru-RU')).toBe('ru');
    expect(detectLang('en-US')).toBe('en');
    expect(detectLang('de-DE')).toBe('en');
    expect(detectLang(undefined)).toBe('en');
  });
});
```

`src/format.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { setLang } from './i18n';
import { estimateSeconds, fmtDuration, fmtInt, fmtSeconds, fmtTimeLeft, iconUrl } from './format';

describe('format', () => {
  beforeEach(() => setLang('ru'));

  it('formats integers with the language separator', () => {
    expect(fmtInt(1234).replace(/\s/g, ' ')).toBe('1 234');
  });

  it('formats durations', () => {
    expect(fmtDuration(2.1)).toBe('~3 с');
    expect(fmtDuration(59)).toBe('~59 с');
    expect(fmtDuration(61)).toBe('~2 мин');
    expect(fmtDuration(3900)).toBe('~1 ч 5 мин');
  });

  it('estimates time from requests and pause', () => {
    expect(estimateSeconds(0, 1500)).toBe(0);
    expect(estimateSeconds(2, 1500)).toBeCloseTo(2.1);
    expect(estimateSeconds(72, 1500)).toBeCloseTo(71 * 1.5 + 72 * 0.3);
  });

  it('shows how long the token lives', () => {
    const now = 1_800_000_000;
    expect(fmtTimeLeft(now + 18 * 3600 + 5, now)).toBe('18 ч');
    expect(fmtTimeLeft(now + 120, now)).toBe('2 мин');
    expect(fmtTimeLeft(now + 10, now)).toBe('1 мин');
    expect(fmtTimeLeft(now, now)).toBe('истёк');
  });

  it('builds icon urls on the Steam CDN', () => {
    expect(iconUrl('abc_DEF-1', 128)).toBe('https://community.akamai.steamstatic.com/economy/image/abc_DEF-1/128fx128f');
  });

  it('formats seconds with one decimal', () => {
    expect(fmtSeconds(1500)).toBe('1,5');
    setLang('en');
    expect(fmtSeconds(1500)).toBe('1.5');
    expect(fmtSeconds(2000)).toBe('2');
  });
});
```

`src/model.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { setLang } from './i18n';
import {
  apartRecords, canCombine, categoriesOf, counts, defaultFilter, layoutOf, layoutText, nextSelection,
  pillsOf, splitCapacity, totals, visibleSkins,
} from './model';
import type { Inventory, InvRecord, Skin } from './types';

function rec(assetid: string, amount: number, instanceid = '0'): InvRecord {
  return { assetid, classid: 'c1', instanceid, amount, tradable: true, marketable: true, availableAfter: null };
}

function skin(key: string, amounts: number[], category = 'steamcat.weapon'): Skin {
  const records = amounts.map((a, i) => rec(`${key}-${i}`, a)).sort((a, b) => b.amount - a.amount);
  return { key, name: key, icon: null, category: { id: category, label: category }, total: amounts.reduce((a, b) => a + b, 0), records };
}

const inv = (skins: Skin[]): Inventory => ({ skins, unreadable: [] });

describe('model', () => {
  beforeEach(() => setLang('ru'));

  it('describes the layout of a skin', () => {
    const s = skin('A', [5, 1, 4, 1]);
    expect(layoutOf(s)).toEqual({ stacks: [5, 4], singles: 2 });
    expect(splitCapacity(s)).toBe(7);
    expect(canCombine(s)).toBe(true);
    expect(canCombine(skin('B', [3]))).toBe(false);
  });

  it('finds entries that will not combine with the main stack', () => {
    const s: Skin = { ...skin('A', []), records: [rec('1', 3), rec('2', 2, '9'), rec('3', 1)], total: 6 };
    expect(apartRecords(s).map((r) => r.assetid)).toEqual(['2']);
  });

  it('writes layouts in words', () => {
    expect(layoutText([6], 2, true)).toBe('стопка ×6 и 2 по одному');
    expect(layoutText([5, 4], 3, true)).toBe('стопки ×5, ×4 и 3 по одному');
    expect(layoutText([], 12, false)).toBe('12 по одному');
    expect(layoutText([10], 0, false)).toBe('×10');
    setLang('en');
    expect(layoutText([6], 2, true)).toBe('stack ×6 and 2 singles');
  });

  it('makes at most three stack pills', () => {
    expect(pillsOf({ stacks: [9, 8, 7, 6, 5], singles: 3 })).toEqual([
      { text: '×9', stack: true },
      { text: '×8', stack: true },
      { text: '×7', stack: true },
      { text: '+2', stack: true },
      { text: '3 по одному', stack: false },
    ]);
  });

  it('filters by search, show and type, then sorts', () => {
    const i = inv([skin('Alpha', [1]), skin('Bravo', [3, 1]), skin('Charlie', [2], 'steamcat.clothing'), skin('Delta', [1, 1])]);
    const f = defaultFilter();
    expect(visibleSkins(i, f).map((s) => s.key)).toEqual(['Bravo', 'Charlie', 'Delta', 'Alpha']);
    expect(visibleSkins(i, { ...f, show: 'stacks' }).map((s) => s.key)).toEqual(['Bravo', 'Charlie']);
    expect(visibleSkins(i, { ...f, show: 'dupes' }).map((s) => s.key)).toEqual(['Bravo', 'Delta']);
    expect(visibleSkins(i, { ...f, categories: ['steamcat.clothing'] }).map((s) => s.key)).toEqual(['Charlie']);
    expect(visibleSkins(i, { ...f, search: 'ALP' }).map((s) => s.key)).toEqual(['Alpha']);
    expect(visibleSkins(i, { ...f, sort: 'name' }).map((s) => s.key)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
  });

  it('counts filters and totals', () => {
    const i: Inventory = { skins: [skin('A', [5, 1]), skin('B', [1]), skin('C', [1, 1])], unreadable: [{ assetid: null, amount: 2 }] };
    expect(counts(i)).toEqual({ all: 3, stacks: 1, dupes: 2 });
    expect(totals(i)).toEqual({ items: 11, records: 6, stacks: 1, unreadable: 1 });
  });

  it('lists categories once, sorted by label', () => {
    const i = inv([skin('A', [1], 'b'), skin('B', [1], 'a'), skin('C', [1], 'b')]);
    expect(categoriesOf(i).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('selects single, toggles and ranges', () => {
    const order = ['a', 'b', 'c', 'd'];
    let sel = nextSelection({ selected: [], anchor: null }, 'b', 'single', order);
    expect(sel).toEqual({ selected: ['b'], anchor: 'b' });
    sel = nextSelection(sel, 'd', 'toggle', order);
    expect(sel.selected).toEqual(['b', 'd']);
    sel = nextSelection(sel, 'd', 'toggle', order);
    expect(sel.selected).toEqual(['b']);
    sel = nextSelection({ selected: ['b'], anchor: 'b' }, 'd', 'range', order);
    expect(sel).toEqual({ selected: ['b', 'c', 'd'], anchor: 'b' });
    sel = nextSelection({ selected: ['c'], anchor: 'c' }, 'a', 'range', order);
    expect(sel.selected).toEqual(['a', 'b', 'c']);
    expect(nextSelection({ selected: [], anchor: null }, 'c', 'range', order)).toEqual({ selected: ['c'], anchor: 'c' });
  });
});
```

- [ ] **Step 4: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL, модулей `./index`, `./format`, `./model` нет.

- [ ] **Step 5: i18n, форматирование, модель**

`src/i18n/index.ts`:
```ts
import en from './en.json';
import ru from './ru.json';
import type { UiError } from '../types';

export type Lang = 'en' | 'ru';
type Vars = Record<string, string | number>;

const dicts: Record<Lang, Record<string, string>> = { en, ru };
let current: Lang = 'en';

export function detectLang(locale: string | undefined): Lang {
  return locale?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export function setLang(lang: Lang): void {
  current = lang;
}

export function getLang(): Lang {
  return current;
}

export function has(key: string): boolean {
  return key in dicts[current] || key in dicts.en;
}

/** Текст по ключу; `{name}` заменяется значением из vars. Нет текста — ключ. */
export function t(key: string, vars: Vars = {}): string {
  const text = dicts[current][key] ?? dicts.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** Множественное число: `ключ_one/_few/_many/_other` по правилам языка, `{count}` — число в формате языка. */
export function tn(key: string, count: number, vars: Vars = {}): string {
  const full = `${key}_${new Intl.PluralRules(current).select(count)}`;
  const chosen = full in dicts[current] ? full : `${key}_other`;
  return t(chosen, { count: new Intl.NumberFormat(current).format(count), ...vars });
}

/** Текст ошибки ядра по её коду. */
export function errorText(error: UiError): string {
  const key = `error.${error.code}`;
  return has(key) ? t(key, { status: error.status ?? '' }) : t('error.unknown');
}
```

`src/format.ts`:
```ts
import { getLang, t } from './i18n';

export const ICON_BASE = 'https://community.akamai.steamstatic.com/economy/image/';

/** Картинка предмета с CDN Steam — единственный внешний адрес, который грузит окно. */
export function iconUrl(hash: string, size: number): string {
  return `${ICON_BASE}${encodeURIComponent(hash)}/${size}fx${size}f`;
}

export function fmtInt(n: number): string {
  return new Intl.NumberFormat(getLang()).format(n);
}

/** Миллисекунды → секунды с одним знаком: «1,5». */
export function fmtSeconds(ms: number): string {
  return new Intl.NumberFormat(getLang(), { maximumFractionDigits: 1 }).format(ms / 1000);
}

/** «~3 с», «~2 мин», «~1 ч 5 мин». */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return t('time.seconds', { n: s });
  const m = Math.ceil(s / 60);
  if (m < 60) return t('time.minutes', { n: m });
  return t('time.hoursMinutes', { h: Math.floor(m / 60), m: m % 60 });
}

/** Сколько ещё живёт токен: «18 ч», «25 мин», «истёк». */
export function fmtTimeLeft(expiresAt: number, nowSec: number): string {
  const left = expiresAt - nowSec;
  if (left <= 0) return t('time.expired');
  if (left < 3600) return t('time.minutesShort', { n: Math.max(1, Math.floor(left / 60)) });
  return t('time.hoursShort', { n: Math.floor(left / 3600) });
}

/** Паузы между запросами плюс около 0,3 с на сам запрос. */
export function estimateSeconds(requests: number, delayMs: number): number {
  if (requests <= 0) return 0;
  return (requests - 1) * (delayMs / 1000) + requests * 0.3;
}

/** «2 нояб.» из ISO-даты Steam; непонятную строку показываем как есть. */
export function fmtDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(getLang(), { day: 'numeric', month: 'short' }).format(date);
}
```

`src/model.ts`:
```ts
// Чистые функции над инвентарём: фильтр, сортировка, раскладка, выбор.

import { fmtInt } from './format';
import { t, tn } from './i18n';
import type { Category, Inventory, InvRecord, Skin } from './types';

export type Show = 'all' | 'stacks' | 'dupes';
export type Sort = 'amount' | 'name';

export interface Filter {
  search: string;
  show: Show;
  categories: string[];
  sort: Sort;
}

export interface Layout {
  stacks: number[];
  singles: number;
}

export interface Pill {
  text: string;
  stack: boolean;
}

export interface Counts {
  all: number;
  stacks: number;
  dupes: number;
}

export interface Totals {
  items: number;
  records: number;
  stacks: number;
  unreadable: number;
}

export interface Selection {
  selected: string[];
  anchor: string | null;
}

export type SelectMode = 'single' | 'toggle' | 'range';

/** Фильтр при открытии окна: все предметы, больше всего штук сверху. */
export function defaultFilter(): Filter {
  return { search: '', show: 'all', categories: [], sort: 'amount' };
}

/** Стопки по убыванию и сколько записей лежит по одному. */
export function layoutOf(skin: Skin): Layout {
  const stacks = skin.records.filter((r) => r.amount > 1).map((r) => r.amount).sort((a, b) => b - a);
  return { stacks, singles: skin.records.filter((r) => r.amount === 1).length };
}

export const hasStack = (skin: Skin): boolean => skin.records.some((r) => r.amount > 1);
export const isDupe = (skin: Skin): boolean => skin.records.length > 1;

/** Сколько штук можно отделить по одному: сумма A−1 по стопкам. */
export function splitCapacity(skin: Skin): number {
  return skin.records.reduce((n, r) => n + r.amount - 1, 0);
}

/** Есть хотя бы две записи с одинаковыми classid и instanceid. */
export function canCombine(skin: Skin): boolean {
  const seen = new Set<string>();
  for (const r of skin.records) {
    const type = `${r.classid}/${r.instanceid}`;
    if (seen.has(type)) return true;
    seen.add(type);
  }
  return false;
}

/** Записи, которые не соберутся с основной стопкой: у них другие classid или instanceid. */
export function apartRecords(skin: Skin): InvRecord[] {
  const main = skin.records[0];
  if (!main) return [];
  return skin.records.filter((r) => r.classid !== main.classid || r.instanceid !== main.instanceid);
}

export function matches(skin: Skin, filter: Filter): boolean {
  if (filter.show === 'stacks' && !hasStack(skin)) return false;
  if (filter.show === 'dupes' && !isDupe(skin)) return false;
  if (filter.categories.length > 0 && !(skin.category && filter.categories.includes(skin.category.id))) return false;
  const query = filter.search.trim().toLocaleLowerCase();
  return !query || skin.name.toLocaleLowerCase().includes(query) || skin.key.toLocaleLowerCase().includes(query);
}

export function visibleSkins(inventory: Inventory, filter: Filter): Skin[] {
  const byName = (a: Skin, b: Skin) => a.name.localeCompare(b.name);
  const byAmount = (a: Skin, b: Skin) => b.total - a.total || byName(a, b);
  return inventory.skins.filter((s) => matches(s, filter)).sort(filter.sort === 'name' ? byName : byAmount);
}

export function counts(inventory: Inventory): Counts {
  return {
    all: inventory.skins.length,
    stacks: inventory.skins.filter(hasStack).length,
    dupes: inventory.skins.filter(isDupe).length,
  };
}

export function totals(inventory: Inventory): Totals {
  let items = 0;
  let records = 0;
  let stacks = 0;
  for (const skin of inventory.skins) {
    items += skin.total;
    records += skin.records.length;
    stacks += skin.records.filter((r) => r.amount > 1).length;
  }
  const unreadable = inventory.unreadable.reduce((n, u) => n + u.amount, 0);
  return {
    items: items + unreadable,
    records: records + inventory.unreadable.length,
    stacks,
    unreadable: inventory.unreadable.length,
  };
}

export function categoriesOf(inventory: Inventory): Category[] {
  const byId = new Map<string, Category>();
  for (const skin of inventory.skins) if (skin.category) byId.set(skin.category.id, skin.category);
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Клик — один предмет, Ctrl — добавить или убрать, Shift — диапазон от якоря в порядке сетки. */
export function nextSelection(current: Selection, key: string, mode: SelectMode, order: string[]): Selection {
  if (mode === 'toggle') {
    const has = current.selected.includes(key);
    return { selected: has ? current.selected.filter((k) => k !== key) : [...current.selected, key], anchor: key };
  }
  if (mode === 'range' && current.anchor) {
    const from = order.indexOf(current.anchor);
    const to = order.indexOf(key);
    if (from >= 0 && to >= 0) {
      const [a, b] = from < to ? [from, to] : [to, from];
      return { selected: order.slice(a, b + 1), anchor: current.anchor };
    }
  }
  return { selected: [key], anchor: key };
}

/** «стопка ×6 и 2 по одному»; без слова — «×6 и 2 по одному». */
export function layoutText(stacks: number[], singles: number, withWord: boolean): string {
  const list = stacks.map((n) => `×${fmtInt(n)}`).join(', ');
  const stackPart = stacks.length ? (withWord ? `${tn('layout.stackWord', stacks.length)} ${list}` : list) : '';
  const singlePart = singles ? tn('layout.singles', singles) : '';
  if (stackPart && singlePart) return t('layout.both', { stacks: stackPart, singles: singlePart });
  return stackPart || singlePart;
}

/** Плашки раскладки на карточке: не больше трёх стопок, остальные — «+N». */
export function pillsOf(layout: Layout, max = 3): Pill[] {
  const pills: Pill[] = layout.stacks.slice(0, max).map((n) => ({ text: `×${fmtInt(n)}`, stack: true }));
  if (layout.stacks.length > max) pills.push({ text: `+${layout.stacks.length - max}`, stack: true });
  if (layout.singles) pills.push({ text: tn('layout.singles', layout.singles), stack: false });
  return pills;
}
```

- [ ] **Step 6: Тесты проходят**

Run: `npm test`
Expected: все тесты i18n (7), format (6) и model (8) PASS.

- [ ] **Step 7: API, демо-режим, состояние, `h()`, стили**

`src/api.ts`:
```ts
// Вызовы ядра. В обычном браузере (`npm run dev` без Tauri) main.ts подменяет api демо-режимом.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { Lang } from './i18n';
import type { Inventory, Operation, Plan, Progress, Settings, StartResult, TokenInfo, UiError } from './types';

export const TOKEN_PAGE = 'https://steamcommunity.com/pointssummary/ajaxgetasyncconfig';

export interface Api {
  setToken(raw: string): Promise<TokenInfo>;
  forgetToken(): Promise<void>;
  loadInventory(lang: Lang): Promise<Inventory>;
  preview(operation: Operation): Promise<Plan>;
  start(operation: Operation, lang: Lang): Promise<StartResult>;
  stop(): Promise<void>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<Settings>;
  journal(): Promise<string>;
  onProgress(callback: (progress: Progress) => void): Promise<() => void>;
  openTokenPage(): Promise<void>;
}

const tauriApi: Api = {
  setToken: (raw) => invoke<TokenInfo>('set_token', { raw }),
  forgetToken: () => invoke<void>('forget_token'),
  loadInventory: (lang) => invoke<Inventory>('load_inventory', { lang }),
  preview: (operation) => invoke<Plan>('preview', { operation }),
  start: (operation, lang) => invoke<StartResult>('start', { operation, lang }),
  stop: () => invoke<void>('stop'),
  getSettings: () => invoke<Settings>('get_settings'),
  saveSettings: (settings) => invoke<Settings>('save_settings', { settings }),
  journal: () => invoke<string>('journal'),
  onProgress: (callback) => listen<Progress>('run-progress', (event) => callback(event.payload)),
  openTokenPage: () => openUrl(TOKEN_PAGE),
};

export let api: Api = tauriApi;

export function useApi(next: Api): void {
  api = next;
}

export function inTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

/** Ошибка команды как `UiError`; всё непонятное — код `unknown`. */
export function asUiError(error: unknown): UiError {
  if (typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string') {
    const { code, status } = error as { code: string; status?: unknown };
    return { code, status: typeof status === 'number' ? status : null };
  }
  return { code: 'unknown', status: null };
}
```

`src/store.ts`:
```ts
// Состояние окна. Один объект, setState заменяет его и оповещает подписчиков.

import type { Lang } from './i18n';
import { defaultFilter, type Filter } from './model';
import type { Inventory, Plan, Reconciliation, RunOutcome, Settings, TokenInfo, UiError } from './types';

export type Panel =
  | { kind: 'selection' }
  | { kind: 'plan'; plan: Plan; changed: boolean }
  | {
      kind: 'running';
      plan: Plan;
      done: number;
      total: number;
      errors: number;
      key: string;
      /** Конец ожидания по 429, `Date.now()`-миллисекунды. */
      waitUntil: number | null;
      stopping: boolean;
    }
  | { kind: 'result'; plan: Plan; outcome: RunOutcome; reconciliation: Reconciliation | null };

export interface State {
  screen: 'login' | 'main';
  lang: Lang;
  settings: Settings;
  token: TokenInfo | null;
  inventory: Inventory | null;
  loading: boolean;
  /** Ошибка загрузки или запуска — плашка над сеткой. */
  error: UiError | null;
  tokenExpired: boolean;
  filter: Filter;
  selected: string[];
  anchor: string | null;
  panel: Panel;
  menuOpen: boolean;
  settingsOpen: boolean;
}

export const initialFilter: Filter = defaultFilter();

type Listener = (state: State) => void;

let state: State;
const listeners = new Set<Listener>();

export function initState(initial: State): void {
  state = initial;
}

export function getState(): State {
  return state;
}

export function setState(patch: Partial<State>): void {
  state = { ...state, ...patch };
  for (const listener of [...listeners]) if (listeners.has(listener)) listener(state);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
```

`src/dom.ts`:
```ts
// h() — единственный способ строить DOM. Строки становятся текстом, а не HTML:
// названия из Steam не могут вставить разметку.

type AttrValue = string | number | boolean | null | undefined | EventListener;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, AttrValue> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (typeof value === 'function') el.addEventListener(name.replace(/^on/, ''), value);
    else if (name === 'class') el.className = String(value);
    else el.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

/** Значок Tabler из шрифта, скрытый от экранных чтецов. */
export function icon(name: string): HTMLElement {
  return h('i', { class: `ti ti-${name}`, 'aria-hidden': 'true' });
}
```

Обработчики передаются как `onclick: () => …`, `oninput: (e) => …`. Имя события — то, что после `on`.

`src/dev/demo-items.json` — из исходника макета, одной командой:
```bash
node -e "const fs=require('fs');const s=fs.readFileSync('docs/design/mockup/items.js','utf8');fs.mkdirSync('src/dev',{recursive:true});fs.writeFileSync('src/dev/demo-items.json',s.slice(s.indexOf('['),s.lastIndexOf(']')+1))"
```
Проверь, что файл — массив объектов `{ "name", "icon", "color" }`.

`src/dev/mock.ts`:
```ts
// Демо-режим для `npm run dev` в обычном браузере. Названия и картинки настоящие
// (как на макетах docs/design/), количества выдуманы. В сборку Tauri не попадает:
// main.ts подключает его только при import.meta.env.DEV и без Tauri.

import type { Api } from '../api';
import type { Inventory, InvRecord, Operation, Plan, Progress, Settings, Skin, SkinAfter } from '../types';
import items from './demo-items.json';

/** Раскладка как в docs/design/mockup/data.js: [стопки, сколько по одному]. */
const LAYOUT: Array<[number[], number]> = [
  [[8], 0], [[], 1], [[5, 4], 3], [[], 1], [[12], 0], [[3], 2], [[], 1], [[], 1],
  [[7], 0], [[], 2], [[], 1], [[4], 1], [[], 1], [[], 1], [[9], 0], [[], 1],
  [[2], 0], [[], 1], [[6], 0], [[], 1], [[], 1], [[3], 0], [[], 1], [[], 1],
  [[10], 0], [[], 1], [[2], 1], [[], 1], [[], 1], [[5], 0], [[], 1], [[], 1],
  [[], 1], [[4], 0], [[], 1], [[], 1], [[3], 0], [[], 1], [[], 1], [[2], 0],
];

const CATEGORIES = [
  { id: 'steamcat.weapon', label: 'Weapon' },
  { id: 'steamcat.clothing', label: 'Clothing' },
  { id: 'steamcat.construction', label: 'Construction' },
  { id: 'steamcat.tool', label: 'Tool' },
];

const iconHash = (url: string): string => url.split('/economy/image/')[1]?.split('/')[0] ?? '';

function demoInventory(): Inventory {
  let id = 1000;
  const skins: Skin[] = items.map((item, i) => {
    const [stacks, singles] = LAYOUT[i % LAYOUT.length];
    const amounts = [...stacks, ...Array<number>(singles).fill(1)];
    const records: InvRecord[] = amounts.map((amount) => ({
      assetid: String(++id),
      classid: `c${i}`,
      instanceid: '0',
      amount,
      tradable: true,
      marketable: true,
      availableAfter: null,
    }));
    return {
      key: item.name,
      name: item.name,
      icon: iconHash(item.icon),
      category: CATEGORIES[i % CATEGORIES.length],
      total: amounts.reduce((a, b) => a + b, 0),
      records,
    };
  });
  return { skins: skins.sort((a, b) => a.key.localeCompare(b.key)), unreadable: [] };
}

/** Упрощённая копия plan::build из ядра — только для демо. */
function demoPlan(inventory: Inventory, operation: Operation): Plan {
  const keys =
    operation.kind === 'splitSelected' || operation.kind === 'combineSelected'
      ? new Set(operation.keys)
      : operation.kind === 'splitOff'
        ? new Set([operation.key])
        : null;
  const skins = inventory.skins
    .filter((s) => !keys || keys.has(s.key))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const split = operation.kind === 'splitAll' || operation.kind === 'splitSelected' || operation.kind === 'splitOff';
  let requests = 0;
  const queue: Plan['queue'] = [];
  const after: SkinAfter[] = [];
  for (const skin of skins) {
    if (split) {
      let left = operation.kind === 'splitOff' ? operation.count : Infinity;
      let singles = 0;
      const stacks: number[] = [];
      const startRequests = requests;
      for (const record of skin.records) {
        const n = Math.min(record.amount - 1, left);
        left -= n;
        requests += n;
        singles += n;
        if (n > 0) queue.push({ key: skin.key, amount: record.amount, requests: n });
        if (record.amount - n === 1) singles += 1;
        else stacks.push(record.amount - n);
      }
      if (requests > startRequests) after.push({ key: skin.key, stacks: stacks.sort((a, b) => b - a), singles });
    } else if (skin.records.length > 1) {
      requests += skin.records.length - 1;
      queue.push({ key: skin.key, amount: skin.total, requests: skin.records.length - 1 });
      after.push({ key: skin.key, stacks: skin.total > 1 ? [skin.total] : [], singles: skin.total > 1 ? 0 : 1 });
    }
  }
  return { operation, requests, stacks: queue.length, queue: queue.slice(0, 5), more: Math.max(0, queue.length - 5), after };
}

function applyPlan(inventory: Inventory, plan: Plan): Inventory {
  const byKey = new Map(plan.after.map((a) => [a.key, a]));
  let id = 5000;
  const skins = inventory.skins.map((skin) => {
    const after = byKey.get(skin.key);
    const base = skin.records[0];
    if (!after || !base) return skin;
    const amounts = [...after.stacks, ...Array<number>(after.singles).fill(1)];
    return { ...skin, records: amounts.map((amount) => ({ ...base, assetid: String(++id), amount })) };
  });
  return { ...inventory, skins };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createMockApi(): Api {
  let inventory = demoInventory();
  let settings: Settings = { language: null, delayMs: 1500 };
  let listener: ((progress: Progress) => void) | null = null;
  let stopped = false;
  const log: string[] = [];

  return {
    async setToken(raw) {
      if (!raw.toLowerCase().includes('demo')) throw { code: 'tokenNotFound', status: null };
      return { steamidMasked: '7656…4821', expiresAt: Math.floor(Date.now() / 1000) + 18 * 3600 + 300 };
    },
    async forgetToken() {},
    async loadInventory() {
      await wait(600);
      return inventory;
    },
    async preview(operation) {
      return demoPlan(inventory, operation);
    },
    async start(operation) {
      const plan = demoPlan(inventory, operation);
      stopped = false;
      let done = 0;
      while (done < plan.requests && !stopped) {
        listener?.({ kind: 'request', done, total: plan.requests, errors: 0, key: plan.queue[0]?.key ?? '' });
        await wait(120);
        done += 1;
      }
      listener?.({ kind: 'request', done, total: plan.requests, errors: 0, key: '' });
      const before = inventory.skins.reduce((n, s) => n + s.total, 0);
      if (!stopped) inventory = applyPlan(inventory, plan);
      log.push(`demo run: ${operation.kind}, ${done} of ${plan.requests}`);
      return {
        kind: 'finished',
        outcome: { reason: stopped ? 'stoppedByUser' : 'finished', done, errors: 0, total: plan.requests },
        reconciliation: { before, after: before, mismatches: [] },
        inventory,
      };
    },
    async stop() {
      stopped = true;
    },
    async getSettings() {
      return settings;
    },
    async saveSettings(next) {
      settings = { language: next.language, delayMs: Math.min(10_000, Math.max(500, next.delayMs)) };
      return settings;
    },
    async journal() {
      return log.join('\n');
    },
    async onProgress(callback) {
      listener = callback;
      return () => {
        listener = null;
      };
    },
    async openTokenPage() {
      window.open('https://steamcommunity.com/pointssummary/ajaxgetasyncconfig', '_blank', 'noopener');
    },
  };
}
```

`src/styles/tokens.css`:
```css
/* Палитра из спеки и утверждённых макетов (docs/design/). */
:root {
  --bg: #0f1117;
  --panel: #161922;
  --card: #1b1f2b;
  --card-2: #232838;
  --card-hover: #1f2432;
  --img: #20253a;
  --line: #262b3a;
  --text: #eceef5;
  --text-2: #9aa0b4;
  --text-3: #6c7287;
  --acc: #5b5bf7;
  --acc-2: #7171ff;
  --acc-bg: rgba(91, 91, 247, 0.14);
  --ok: #3ecf8e;
  --warn: #f2b84b;
  --bad: #f0625f;
  --bad-bg: rgba(240, 98, 95, 0.12);
  --card-h: 192px;
  --ease: cubic-bezier(0.2, 0.7, 0.2, 1);
  color-scheme: dark;
}
```

`src/styles/base.css`:
```css
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  background: var(--bg);
  color: var(--text);
  font: 500 14px/1.45 'Manrope', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
}
#app { height: 100%; }
::selection { background: var(--acc); color: #fff; }
h1, h2, h3, p, ul, ol, dl, dd { margin: 0; }
ul, ol { padding: 0; list-style: none; }
button, input, select, textarea { font: inherit; color: inherit; }
button { border: 0; background: none; padding: 0; cursor: pointer; }
button:disabled { cursor: default; opacity: 0.45; }
:focus-visible { outline: 2px solid var(--acc-2); outline-offset: 2px; }

* { scrollbar-width: thin; scrollbar-color: var(--card-2) transparent; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: var(--card-2); border-radius: 5px; border: 2px solid var(--bg); }
::-webkit-scrollbar-track { background: transparent; }

.ti { line-height: 1; }
.num { font-variant-numeric: tabular-nums; }
.muted { color: var(--text-2); }
.grow { flex: 1; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

.btn {
  height: 44px; padding: 0 16px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  font-weight: 800; font-size: 14px;
  transition: background-color 0.15s var(--ease);
}
.btn .ti { font-size: 18px; }
.btn.pri { background: var(--acc); color: #fff; }
.btn.pri:hover:not(:disabled) { background: var(--acc-2); }
.btn.sec { background: var(--card-2); color: var(--text); }
.btn.sec:hover:not(:disabled) { background: #2b3144; }
.btn.danger { background: var(--bad-bg); color: #ff8f8c; }
.link { color: var(--acc-2); font-weight: 700; }
.link:hover { text-decoration: underline; }

.range {
  -webkit-appearance: none; appearance: none;
  width: 100%; height: 6px; border-radius: 3px; cursor: pointer;
  background: linear-gradient(to right, var(--acc) var(--fill, 0%), var(--card-2) var(--fill, 0%));
}
.range::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}
.range::-moz-range-thumb {
  width: 18px; height: 18px; border: 0; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}
.range:focus-visible { outline-offset: 6px; }

@keyframes rise { from { opacity: 0; transform: translateY(4px); } }
@keyframes fade { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

- [ ] **Step 8: Проверка**

Run: `npm run check` и `npm test`
Expected: типы без ошибок, все тесты PASS.

- [ ] **Step 9: Commit**

```bash
git add src
git commit -m "feat: основа окна — типы, API, демо-режим, тексты EN/RU, модель

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Действия, экран входа и запуск окна

**Files:**
- Create: `src/actions.ts`, `src/ui/login.ts`, `src/ui/shell.ts` (временная заглушка, в Task 10 заменяется), `src/styles/login.css`
- Modify: `src/main.ts` (полностью)

**Interfaces:**
- Consumes: `api`, `useApi`, `inTauri`, `asUiError` (api.ts), `t`, `errorText`, `getLang`, `setLang`, `detectLang` (i18n), `fmtTimeLeft` (format), `nextSelection`, `visibleSkins`, `Filter`, `SelectMode` (model), store, `h`, `icon`, `createMockApi`.
- Produces:
  - `actions.ts`: `loadInventory()`, `setFilter(patch)`, `selectSkin(key, mode, order)`, `clearSelection()`, `closePanel()`, `showPlan(operation)`, `runPlan(plan)`, `stopRun()`, `forgetToken()`, `copyJournal(): Promise<boolean>`, `saveSettings(settings)`, `switchLang(lang)`;
  - `ui/login.ts`: `renderLogin(): Screen`;
  - `ui/shell.ts`: `mountMain(): Screen`, где `Screen = { el: HTMLElement; destroy(): void }`;
  - в `main.ts` — порядок запуска и демо-адреса `?demo=main|item|plan`.

Экран входа — по спеке, раздел «Первый запуск и вход»:
- три шага и кнопка «Открыть страницу токена» (системный браузер);
- поле для вставки страницы целиком;
- проверка на лету: «Токен аккаунта 7656…4821, действует ещё 18 ч» или понятная ошибка;
- блок «Почему это безопасно»;
- «Не связано с Valve и Facepunch».

После «Продолжить» текст поля стирается: токен не остаётся в окне.

- [ ] **Step 1: Действия**

`src/actions.ts`:
```ts
// Действия окна: всё, что меняет состояние и вызывает ядро.

import { api, asUiError } from './api';
import { detectLang, setLang, type Lang } from './i18n';
import { nextSelection, type Filter, type SelectMode } from './model';
import { getState, setState, type Panel } from './store';
import type { Operation, Plan, Progress, Settings, UiError } from './types';

const TOKEN_CODES = new Set(['tokenExpired', 'tokenRejected', 'noToken']);

/** Ошибка токена — плашка «Токен истёк», любая другая — плашка с текстом ошибки. */
function showError(error: UiError): void {
  if (TOKEN_CODES.has(error.code)) setState({ tokenExpired: true, error: null });
  else setState({ error });
}

export async function loadInventory(): Promise<void> {
  setState({ loading: true, error: null });
  try {
    const inventory = await api.loadInventory(getState().lang);
    const keys = new Set(inventory.skins.map((s) => s.key));
    const s = getState();
    setState({
      inventory,
      loading: false,
      selected: s.selected.filter((k) => keys.has(k)),
      panel: s.panel.kind === 'running' ? s.panel : { kind: 'selection' },
    });
  } catch (e) {
    setState({ loading: false });
    showError(asUiError(e));
  }
}

export function setFilter(patch: Partial<Filter>): void {
  setState({ filter: { ...getState().filter, ...patch } });
}

/** Выбор меняет панель на «выбор», кроме времени, когда идёт операция. */
export function selectSkin(key: string, mode: SelectMode, order: string[]): void {
  const s = getState();
  const next = nextSelection({ selected: s.selected, anchor: s.anchor }, key, mode, order);
  setState({ ...next, panel: s.panel.kind === 'running' ? s.panel : { kind: 'selection' } });
}

export function clearSelection(): void {
  setState({ selected: [], anchor: null });
}

export function closePanel(): void {
  if (getState().panel.kind !== 'running') setState({ panel: { kind: 'selection' } });
}

export async function showPlan(operation: Operation): Promise<void> {
  if (getState().panel.kind === 'running') return;
  try {
    const plan = await api.preview(operation);
    setState({ panel: { kind: 'plan', plan, changed: false } });
  } catch (e) {
    showError(asUiError(e));
  }
}

export async function runPlan(plan: Plan): Promise<void> {
  if (getState().panel.kind === 'running') return;
  setState({ panel: running(plan), error: null });
  const unlisten = await api.onProgress(onProgress);
  try {
    const result = await api.start(plan.operation, getState().lang);
    if (result.kind === 'planChanged') {
      setState({ inventory: result.inventory, panel: { kind: 'plan', plan: result.plan, changed: true } });
    } else {
      setState({
        inventory: result.inventory ?? getState().inventory,
        panel: { kind: 'result', plan, outcome: result.outcome, reconciliation: result.reconciliation },
        tokenExpired: result.outcome.reason === 'tokenRejected',
      });
    }
  } catch (e) {
    setState({ panel: { kind: 'selection' } });
    showError(asUiError(e));
  } finally {
    unlisten();
  }
}

function running(plan: Plan): Panel {
  return { kind: 'running', plan, done: 0, total: plan.requests, errors: 0, key: '', waitUntil: null, stopping: false };
}

function onProgress(progress: Progress): void {
  const panel = getState().panel;
  if (panel.kind !== 'running') return;
  if (progress.kind === 'request') {
    const { done, total, errors, key } = progress;
    setState({ panel: { ...panel, done, total, errors, key, waitUntil: null } });
  } else {
    setState({ panel: { ...panel, waitUntil: Date.now() + progress.seconds * 1000 } });
  }
}

export function stopRun(): void {
  const panel = getState().panel;
  if (panel.kind !== 'running' || panel.stopping) return;
  setState({ panel: { ...panel, stopping: true } });
  void api.stop();
}

/** Назад на экран входа: «Забыть токен» и «Вставить токен». */
export async function forgetToken(): Promise<void> {
  await api.forgetToken();
  setState({
    screen: 'login',
    token: null,
    inventory: null,
    selected: [],
    anchor: null,
    panel: { kind: 'selection' },
    tokenExpired: false,
    error: null,
    menuOpen: false,
    settingsOpen: false,
  });
}

export async function copyJournal(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(await api.journal());
    return true;
  } catch {
    return false;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  const saved = await api.saveSettings(settings);
  const lang: Lang = saved.language ?? detectLang(navigator.language);
  setLang(lang);
  setState({ settings: saved, lang, settingsOpen: false });
}

export async function switchLang(lang: Lang): Promise<void> {
  await saveSettings({ ...getState().settings, language: lang });
}
```

- [ ] **Step 2: Экран входа**

`src/ui/login.ts`:
```ts
// Экран входа: как получить токен, поле вставки с проверкой на лету, почему это безопасно.

import { switchLang } from '../actions';
import { api, asUiError } from '../api';
import { h, icon } from '../dom';
import { fmtTimeLeft } from '../format';
import { errorText, getLang, t } from '../i18n';
import { setState } from '../store';
import type { TokenInfo } from '../types';

export interface Screen {
  el: HTMLElement;
  destroy(): void;
}

export function renderLogin(): Screen {
  const status = h('p', { class: 'login-status', role: 'status', 'aria-live': 'polite' });
  const next = h('button', { class: 'btn pri', type: 'button', disabled: true }, t('login.continue'), icon('arrow-right'));
  const field = h('textarea', {
    class: 'login-field',
    rows: 5,
    placeholder: t('login.placeholder'),
    'aria-label': t('login.placeholder'),
    spellcheck: 'false',
    autocomplete: 'off',
  });
  let info: TokenInfo | null = null;
  let timer = 0;
  let seq = 0;

  // Каждая вставка проверяется в ядре; ответ на устаревший ввод отбрасывается.
  const check = async () => {
    const raw = field.value.trim();
    const mine = ++seq;
    info = null;
    next.disabled = true;
    status.className = 'login-status';
    status.textContent = raw ? t('login.checking') : '';
    if (!raw) return;
    try {
      const result = await api.setToken(raw);
      if (mine !== seq) return;
      info = result;
      status.textContent = t('login.ok', {
        id: result.steamidMasked,
        left: fmtTimeLeft(result.expiresAt, Date.now() / 1000),
      });
      status.classList.add('ok');
      next.disabled = false;
    } catch (e) {
      if (mine !== seq) return;
      status.textContent = errorText(asUiError(e));
      status.classList.add('bad');
    }
  };

  field.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void check(), 250);
  });
  next.addEventListener('click', () => {
    if (!info) return;
    field.value = '';
    setState({ screen: 'main', token: info, tokenExpired: false, error: null });
  });

  const lang = getLang();
  const el = h(
    'main',
    { class: 'login' },
    h(
      'div',
      { class: 'login-card' },
      h(
        'div',
        { class: 'login-head' },
        h('div', { class: 'brand' }, h('span', { class: 'logo' }, icon('stack-2')), t('app.name')),
        h(
          'button',
          { class: 'lang', type: 'button', 'aria-label': t('top.lang'), onclick: () => void switchLang(lang === 'ru' ? 'en' : 'ru') },
          lang.toUpperCase(),
        ),
      ),
      h('h1', { class: 'login-title' }, t('login.title')),
      h('p', { class: 'muted' }, t('login.lead')),
      h('ol', { class: 'steps' }, h('li', {}, t('login.step1')), h('li', {}, t('login.step2')), h('li', {}, t('login.step3'))),
      h('button', { class: 'btn sec', type: 'button', onclick: () => void api.openTokenPage() }, icon('external-link'), t('login.open')),
      field,
      status,
      next,
      h(
        'section',
        { class: 'safe' },
        h('h2', {}, icon('shield-check'), t('login.safeTitle')),
        h('ul', {}, h('li', {}, t('login.safe1')), h('li', {}, t('login.safe2')), h('li', {}, t('login.safe3'))),
      ),
      h('p', { class: 'disclaimer' }, t('app.disclaimer')),
    ),
  );
  return { el, destroy: () => window.clearTimeout(timer) };
}
```

`src/styles/login.css` (`.brand`, `.logo`, `.lang` используются и в верхней панели):
```css
.brand { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 17px; white-space: nowrap; }
.logo { width: 30px; height: 30px; border-radius: 8px; background: var(--acc); color: #fff; display: grid; place-items: center; font-size: 18px; }
.lang { height: 30px; min-width: 40px; padding: 0 8px; border-radius: 8px; color: var(--text-2); font-size: 13px; font-weight: 800; }
.lang:hover { background: var(--card); color: var(--text); }

.login { height: 100%; overflow-y: auto; display: grid; place-items: center; padding: 32px 24px; }
.login-card {
  width: min(560px, 100%); background: var(--panel); border: 1px solid var(--line); border-radius: 16px;
  padding: 28px; display: flex; flex-direction: column; gap: 16px; animation: rise 0.25s var(--ease);
}
.login-head { display: flex; align-items: center; justify-content: space-between; }
.login-title { font-size: 24px; font-weight: 800; line-height: 1.2; }
.steps { counter-reset: step; display: grid; gap: 10px; }
.steps li { display: flex; gap: 12px; align-items: flex-start; }
.steps li::before {
  counter-increment: step; content: counter(step); flex: none; width: 24px; height: 24px; border-radius: 50%;
  background: var(--acc-bg); color: var(--acc-2); font-weight: 800; font-size: 12px; display: grid; place-items: center;
}
.login-field {
  width: 100%; min-height: 104px; resize: vertical; background: var(--bg); border: 1.5px solid var(--line);
  border-radius: 10px; padding: 12px; font: 500 12px/1.5 ui-monospace, 'Cascadia Mono', Consolas, monospace;
}
.login-field:focus { outline: none; border-color: var(--acc); }
.login-status { min-height: 20px; font-size: 13px; color: var(--text-2); }
.login-status.ok { color: var(--ok); }
.login-status.bad { color: var(--bad); }
.safe { background: var(--card); border-radius: 12px; padding: 14px 16px; display: grid; gap: 8px; }
.safe h2 { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 800; }
.safe h2 .ti { color: var(--ok); font-size: 18px; }
.safe li { position: relative; padding-left: 14px; font-size: 13px; color: var(--text-2); }
.safe li::before { content: ''; position: absolute; left: 2px; top: 8px; width: 4px; height: 4px; border-radius: 50%; background: var(--text-3); }
.disclaimer { font-size: 12px; color: var(--text-3); text-align: center; }
```

- [ ] **Step 3: Временная заглушка главного окна**

`src/ui/shell.ts` (в Task 10 заменяется целиком):
```ts
import { h } from '../dom';
import { t } from '../i18n';
import type { Screen } from './login';

export function mountMain(): Screen {
  return { el: h('main', { class: 'login' }, h('h1', {}, t('grid.title'))), destroy: () => {} };
}
```

- [ ] **Step 4: Запуск окна**

`src/main.ts` целиком:
```ts
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import '@tabler/icons-webfont/dist/tabler-icons.min.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/login.css';

import { loadInventory, selectSkin, setFilter, showPlan } from './actions';
import { api, inTauri, useApi } from './api';
import { detectLang, setLang } from './i18n';
import { visibleSkins } from './model';
import { getState, initState, initialFilter, setState, subscribe, type State } from './store';
import { renderLogin, type Screen } from './ui/login';
import { mountMain } from './ui/shell';

async function boot(): Promise<void> {
  // В обычном браузере (npm run dev) Tauri нет — работает демо-режим. В сборку он не попадает.
  if (import.meta.env.DEV && !inTauri()) {
    const { createMockApi } = await import('./dev/mock');
    useApi(createMockApi());
  }
  const settings = await api.getSettings();
  const lang = settings.language ?? detectLang(navigator.language);
  setLang(lang);
  initState({
    screen: 'login',
    lang,
    settings,
    token: null,
    inventory: null,
    loading: false,
    error: null,
    tokenExpired: false,
    filter: initialFilter,
    selected: [],
    anchor: null,
    panel: { kind: 'selection' },
    menuOpen: false,
    settingsOpen: false,
  });

  const root = document.getElementById('app')!;
  let screen: Screen | null = null;
  let shown = '';
  // Экран перестраивается при смене экрана или языка.
  const show = (s: State) => {
    const id = `${s.screen}:${s.lang}`;
    if (id === shown) return;
    shown = id;
    document.documentElement.lang = s.lang;
    screen?.destroy();
    screen = s.screen === 'login' ? renderLogin() : mountMain();
    root.replaceChildren(screen.el);
  };
  subscribe(show);
  show(getState());

  if (import.meta.env.DEV && !inTauri()) await openDemoState();
}

/** `?demo=main|item|plan` — состояния с макетов docs/design/ для снимков в браузере. */
async function openDemoState(): Promise<void> {
  const demo = new URLSearchParams(location.search).get('demo');
  if (!demo) return;
  const token = await api.setToken('demo');
  setState({ screen: 'main', token });
  await loadInventory();
  const s = getState();
  if (!s.inventory || demo === 'main') return;
  setFilter({ show: 'stacks' });
  if (demo === 'item') {
    const order = visibleSkins(s.inventory, getState().filter).map((skin) => skin.key);
    const key = order[4];
    if (key) selectSkin(key, 'single', order);
  }
  if (demo === 'plan') await showPlan({ kind: 'splitAll' });
}

void boot();
```

- [ ] **Step 5: Проверка**

Run: `npm run check`, `npm test`, `npm run build`
Expected: без ошибок. В `dist/assets` нет `demo-items`: `Select-String -Path dist/assets/*.js -Pattern 'Rust Isles SAR' -List` ничего не находит.

Запусти `npm run dev` в фоне и сними экран входа командой из раздела «Как проверять», адрес `http://localhost:1420/`.

Expected на снимке:
- по центру карточка: название с логотипом, переключатель языка, заголовок;
- три пронумерованных шага, кнопка «Открыть страницу токена», поле вставки, неактивная «Продолжить»;
- блок «Почему это безопасно» и строка «Не связано с Valve и Facepunch»;
- шрифт Manrope, значки на месте.

Язык зависит от системы. На русской Windows экран на русском.

Проверь в браузере (`mcp__Claude_Browser__*` или вручную):
- вставка «hello» показывает красный текст `error.tokenNotFound`;
- вставка «demo» показывает зелёную строку и включает «Продолжить»;
- после «Продолжить» видна заглушка «Инвентарь».

Останови Vite.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "feat: экран входа по токену и запуск окна

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Главное окно — верхняя панель, фильтры, виртуальная сетка, выбор

По макету `docs/design/main-window-item.png`, исходник — `docs/design/mockup/d-final.html`. Три колонки под верхней панелью: фильтры 200 px, сетка, правая панель 340 px. Правую панель наполняет Task 11.

**Files:**
- Create: `src/ui/virtual.ts`, `src/ui/topbar.ts`, `src/ui/filters.ts`, `src/ui/grid.ts`, `src/styles/main.css`
- Modify: `src/ui/shell.ts` (полностью), `src/main.ts` (импорт стилей)
- Test: `src/ui/virtual.test.ts`

**Interfaces:**
- Consumes: actions (`loadInventory`, `setFilter`, `selectSkin`, `showPlan`, `switchLang`, `forgetToken`, `copyJournal`), model, format, i18n, store, `h`, `icon`, `Screen`.
- Produces:
  - `ui/shell.ts`: `interface Part { update(state: State): void; destroy?(): void }`, `mountMain(): Screen`;
  - `ui/virtual.ts`: `CARD_HEIGHT = 192`, `GAP = 12`, `MIN_CARD_WIDTH = 168`, `columnsFor(width, minCard?, gap?)`, `visibleRange(count, cols, rowHeight, scrollTop, viewport, overscan = 2): Range { first, last, padTop, total }`;
  - `createTopbar(el)`, `createFilters(el)`, `createGrid(el)` — каждая возвращает `Part`.

Поведение:
- **Верхняя панель:**
  - «Разделить всё» и «Собрать всё» открывают план. Активная кнопка подсвечена, пока открыт её план. Во время операции и без инвентаря кнопки неактивны;
  - справа аккаунт «7656…4821 · токен ещё 18 ч» с зелёной точкой, после срока — красная точка и «токен истёк»;
  - переключатель языка RU/EN;
  - меню: «Настройки», «Скопировать журнал», «Забыть токен». «Забыть токен» неактивно во время операции.
- **Фильтры:**
  - поиск;
  - «Показать»: Все, Стопки, Дубли — переключатель, у каждого пункта число предметов;
  - «Тип» — флажки по `category` из инвентаря, несколько сразу;
  - внизу итоги: всего штук, записей в Steam, стопок, нечитаемых (если есть).
- **Сетка:**
  - карточки фиксированной высоты 192 px, колонки по ширине (не уже 168 px);
  - в DOM только видимые ряды и два запасных;
  - во время плана и операции у затронутых карточек подпись «станет …», остальные приглушены;
  - клик — один предмет, Ctrl/⌘ + клик — добавить или убрать, Shift + клик — диапазон;
  - клавиатура: стрелки, Home/End, PageUp/PageDown, пробел (Shift + пробел — диапазон), Enter;
  - во время загрузки — скелет из 12 карточек;
  - пустой инвентарь — «В инвентаре Rust нет предметов.», пустой фильтр — «По этим фильтрам ничего нет.»;
  - над сеткой плашка: «Токен истёк — вставьте новый» с кнопкой «Вставить токен» (возврат на экран входа) или текст ошибки с кнопкой «Повторить».

- [ ] **Step 1: Тест виртуальной сетки**

`src/ui/virtual.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { columnsFor, visibleRange } from './virtual';

describe('virtual grid', () => {
  it('fits as many columns as the width allows', () => {
    expect(columnsFor(712)).toBe(4);
    expect(columnsFor(700)).toBe(3);
    expect(columnsFor(100)).toBe(1);
    expect(columnsFor(0)).toBe(1);
  });

  it('renders the visible rows plus two spare rows', () => {
    expect(visibleRange(5000, 4, 204, 0, 600)).toEqual({ first: 0, last: 20, padTop: 0, total: 255000 });
    expect(visibleRange(5000, 4, 204, 2040, 600)).toEqual({ first: 32, last: 60, padTop: 1632, total: 255000 });
  });

  it('stops at the end of the list', () => {
    const r = visibleRange(5000, 4, 204, 255000 - 600, 600);
    expect(r.last).toBe(5000);
    expect(r.first).toBe(4980);
    expect(visibleRange(10, 4, 204, 0, 5000)).toEqual({ first: 0, last: 10, padTop: 0, total: 612 });
  });

  it('handles an empty list', () => {
    expect(visibleRange(0, 4, 204, 0, 600)).toEqual({ first: 0, last: 0, padTop: 0, total: 0 });
  });
});
```

Run: `npm test -- virtual`
Expected: FAIL, нет `./virtual`.

- [ ] **Step 2: Расчёт сетки**

`src/ui/virtual.ts`:
```ts
// Расчёт видимых рядов виртуальной сетки. Чистые функции — их проверяют тесты.

/** Совпадает с --card-h в styles/tokens.css. */
export const CARD_HEIGHT = 192;
export const GAP = 12;
export const MIN_CARD_WIDTH = 168;

export interface Range {
  /** Индексы карточек [first, last). */
  first: number;
  last: number;
  /** Сдвиг первого нарисованного ряда. */
  padTop: number;
  /** Полная высота сетки. */
  total: number;
}

export function columnsFor(width: number, minCard = MIN_CARD_WIDTH, gap = GAP): number {
  return Math.max(1, Math.floor((width + gap) / (minCard + gap)));
}

export function visibleRange(
  count: number,
  cols: number,
  rowHeight: number,
  scrollTop: number,
  viewport: number,
  overscan = 2,
): Range {
  const rows = Math.ceil(count / cols);
  const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const lastRow = Math.min(rows, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
  return {
    first: Math.min(count, firstRow * cols),
    last: Math.min(count, lastRow * cols),
    padTop: firstRow * rowHeight,
    total: rows * rowHeight,
  };
}
```

Run: `npm test -- virtual`
Expected: 4 теста PASS.

- [ ] **Step 3: Каркас главного окна**

`src/ui/shell.ts` целиком:
```ts
// Каркас главного окна: верхняя панель и три колонки. Каждая часть сама решает, что перерисовать.

import { loadInventory } from '../actions';
import { h } from '../dom';
import { getState, subscribe, type State } from '../store';
import { createFilters } from './filters';
import { createGrid } from './grid';
import type { Screen } from './login';
import { createTopbar } from './topbar';

export interface Part {
  update(state: State): void;
  destroy?(): void;
}

export function mountMain(): Screen {
  const top = h('header', { class: 'top' });
  const filters = h('aside', { class: 'filters' });
  const content = h('section', { class: 'content' });
  const side = h('aside', { class: 'side' });
  const el = h('div', { class: 'app' }, top, h('div', { class: 'wrap' }, filters, content, side));
  const parts: Part[] = [createTopbar(top), createFilters(filters), createGrid(content)];
  const update = (state: State) => {
    for (const part of parts) part.update(state);
  };
  const unsubscribe = subscribe(update);
  update(getState());
  if (!getState().inventory && !getState().loading) void loadInventory();
  return {
    el,
    destroy: () => {
      unsubscribe();
      for (const part of parts) part.destroy?.();
    },
  };
}
```

- [ ] **Step 4: Верхняя панель**

`src/ui/topbar.ts`:
```ts
// Верхняя панель: массовые действия, аккаунт и срок токена, язык, меню.

import { copyJournal, forgetToken, showPlan, switchLang } from '../actions';
import { h, icon } from '../dom';
import { fmtTimeLeft } from '../format';
import { getLang, t } from '../i18n';
import { getState, setState, type State } from '../store';
import type { Part } from './shell';

export function createTopbar(el: HTMLElement): Part {
  const split = h(
    'button',
    { class: 'bulk', type: 'button', onclick: () => void showPlan({ kind: 'splitAll' }) },
    icon('arrows-split-2'),
    t('top.splitAll'),
  );
  const combine = h(
    'button',
    { class: 'bulk', type: 'button', onclick: () => void showPlan({ kind: 'combineAll' }) },
    icon('stack-push'),
    t('top.combineAll'),
  );
  const dot = h('span', { class: 'dot', 'aria-hidden': 'true' });
  const account = h('span', {});
  const lang = getLang();
  const langButton = h(
    'button',
    { class: 'lang', type: 'button', 'aria-label': t('top.lang'), onclick: () => void switchLang(lang === 'ru' ? 'en' : 'ru') },
    lang.toUpperCase(),
  );
  const copyLabel = h('span', {}, t('menu.copyLog'));
  const forget = h(
    'button',
    { type: 'button', role: 'menuitem', class: 'danger', onclick: () => void forgetToken() },
    icon('logout'),
    t('menu.forget'),
  );
  const menu = h(
    'div',
    { class: 'menu', role: 'menu', hidden: true },
    h(
      'button',
      { type: 'button', role: 'menuitem', onclick: () => setState({ menuOpen: false, settingsOpen: true }) },
      icon('settings'),
      t('menu.settings'),
    ),
    h('button', { type: 'button', role: 'menuitem', onclick: () => void copy() }, icon('clipboard'), copyLabel),
    forget,
  );
  const menuButton = h(
    'button',
    {
      class: 'icon-btn',
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'aria-label': t('top.menu'),
      onclick: () => setState({ menuOpen: !getState().menuOpen }),
    },
    icon('dots'),
  );
  const menuWrap = h('div', { class: 'menu-wrap' }, menuButton, menu);
  el.append(
    h('div', { class: 'brand' }, h('span', { class: 'logo' }, icon('stack-2')), t('app.name')),
    split,
    combine,
    h('div', { class: 'acct' }, dot, account),
    langButton,
    menuWrap,
  );

  let copyTimer = 0;
  const copy = async () => {
    const ok = await copyJournal();
    copyLabel.textContent = t(ok ? 'menu.logCopied' : 'menu.copyFailed');
    window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => {
      copyLabel.textContent = t('menu.copyLog');
    }, 1500);
  };

  const paint = (s: State) => {
    const running = s.panel.kind === 'running';
    const open = s.panel.kind === 'plan' ? s.panel.plan.operation.kind : null;
    for (const [button, kind] of [[split, 'splitAll'], [combine, 'combineAll']] as const) {
      button.disabled = running || !s.inventory;
      button.classList.toggle('active', open === kind);
      button.setAttribute('aria-pressed', String(open === kind));
    }
    const now = Date.now() / 1000;
    const id = s.token?.steamidMasked ?? '';
    const expired = s.tokenExpired || !s.token || s.token.expiresAt <= now;
    dot.classList.toggle('bad', expired);
    account.textContent =
      expired || !s.token ? t('top.accountExpired', { id }) : t('top.account', { id, left: fmtTimeLeft(s.token.expiresAt, now) });
    menu.hidden = !s.menuOpen;
    menuButton.setAttribute('aria-expanded', String(s.menuOpen));
    forget.disabled = running;
  };

  const onPointer = (e: MouseEvent) => {
    if (getState().menuOpen && !menuWrap.contains(e.target as Node)) setState({ menuOpen: false });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && getState().menuOpen) {
      setState({ menuOpen: false });
      menuButton.focus();
    }
  };
  document.addEventListener('mousedown', onPointer);
  document.addEventListener('keydown', onKey);
  // Срок токена убывает и без событий.
  const clock = window.setInterval(() => paint(getState()), 60_000);

  return {
    update: paint,
    destroy() {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.clearInterval(clock);
      window.clearTimeout(copyTimer);
    },
  };
}
```

- [ ] **Step 5: Фильтры**

`src/ui/filters.ts`:
```ts
// Левая колонка: поиск, «Показать», «Тип» и итоги инвентаря.

import { setFilter } from '../actions';
import { h, icon } from '../dom';
import { fmtInt } from '../format';
import { t } from '../i18n';
import { categoriesOf, counts, totals, type Show } from '../model';
import { getState, type State } from '../store';
import type { Part } from './shell';

const SHOWS: Show[] = ['all', 'stacks', 'dupes'];

function toggleCategory(id: string): void {
  const current = getState().filter.categories;
  setFilter({ categories: current.includes(id) ? current.filter((c) => c !== id) : [...current, id] });
}

function statRow(label: string, value: string): HTMLElement {
  return h('div', {}, h('dt', {}, label), h('dd', { class: 'num' }, value));
}

export function createFilters(el: HTMLElement): Part {
  const search = h('input', {
    class: 'search-input',
    type: 'search',
    placeholder: t('filters.search'),
    'aria-label': t('filters.search'),
    autocomplete: 'off',
    spellcheck: 'false',
  });
  search.addEventListener('input', () => setFilter({ search: search.value }));
  const shows = SHOWS.map((value) => {
    const count = h('span', { class: 'c num' });
    const button = h(
      'button',
      {
        class: 'opt',
        type: 'button',
        role: 'radio',
        title: value === 'dupes' ? t('filters.dupesHint') : undefined,
        onclick: () => setFilter({ show: value }),
      },
      h('span', { class: 'box round' }, icon('check')),
      t(`filters.${value}`),
      count,
    );
    return { value, button, count };
  });
  const types = h('div', { role: 'group', 'aria-label': t('filters.type') });
  const stats = h('dl', { class: 'stats' });
  el.append(
    h('label', { class: 'search' }, icon('search'), search),
    h('div', { role: 'radiogroup', 'aria-label': t('filters.show') }, h('div', { class: 'fh' }, t('filters.show')), ...shows.map((s) => s.button)),
    h('div', {}, h('div', { class: 'fh' }, t('filters.type')), types),
    stats,
  );

  let lastInventory: State['inventory'] = null;
  let lastFilter: State['filter'] | null = null;
  return {
    update(s) {
      if (s.inventory === lastInventory && s.filter === lastFilter) return;
      lastInventory = s.inventory;
      lastFilter = s.filter;
      if (document.activeElement !== search && search.value !== s.filter.search) search.value = s.filter.search;

      const inv = s.inventory;
      const c = inv ? counts(inv) : null;
      for (const o of shows) {
        const on = s.filter.show === o.value;
        o.button.classList.toggle('on', on);
        o.button.setAttribute('aria-checked', String(on));
        o.count.textContent = c ? fmtInt(c[o.value]) : '';
      }

      const list = inv ? categoriesOf(inv) : [];
      types.replaceChildren(
        ...(list.length
          ? list.map((category) => {
              const on = s.filter.categories.includes(category.id);
              return h(
                'button',
                { class: on ? 'opt on' : 'opt', type: 'button', role: 'checkbox', 'aria-checked': String(on), onclick: () => toggleCategory(category.id) },
                h('span', { class: 'box' }, icon('check')),
                category.label,
              );
            })
          : [h('p', { class: 'muted small' }, t('filters.noTypes'))]),
      );

      if (!inv) {
        stats.replaceChildren();
        return;
      }
      const sum = totals(inv);
      const rows = [
        statRow(t('stats.total'), t('card.total', { count: fmtInt(sum.items) })),
        statRow(t('stats.records'), fmtInt(sum.records)),
        statRow(t('stats.stacks'), fmtInt(sum.stacks)),
      ];
      if (sum.unreadable) rows.push(statRow(t('stats.unreadable'), fmtInt(sum.unreadable)));
      stats.replaceChildren(...rows);
    },
  };
}
```

- [ ] **Step 6: Сетка**

`src/ui/grid.ts`:
```ts
// Сетка карточек. Виртуальная: в DOM только видимые ряды, поэтому тысячи записей не тормозят.

import { forgetToken, loadInventory, selectSkin, setFilter } from '../actions';
import { h, icon } from '../dom';
import { fmtInt, iconUrl } from '../format';
import { errorText, t, tn } from '../i18n';
import { counts, layoutOf, layoutText, pillsOf, visibleSkins, type SelectMode, type Sort } from '../model';
import type { Panel, State } from '../store';
import type { Skin, SkinAfter } from '../types';
import type { Part } from './shell';
import { CARD_HEIGHT, GAP, MIN_CARD_WIDTH, columnsFor, visibleRange } from './virtual';

const SKELETON_CARDS = 12;
const ROW = CARD_HEIGHT + GAP;

/** Раскладка «станет» для карточек, пока открыт план или идёт операция. */
function afterMap(panel: Panel): Map<string, SkinAfter> | null {
  if (panel.kind !== 'plan' && panel.kind !== 'running') return null;
  return new Map(panel.plan.after.map((a) => [a.key, a]));
}

function card(skin: Skin, index: number, selected: boolean, tabbable: boolean, after: Map<string, SkinAfter> | null): HTMLElement {
  const change = after?.get(skin.key);
  const sub = change
    ? h('span', { class: 'becomes' }, t('after.becomes', { layout: layoutText(change.stacks, change.singles, false) }))
    : t('card.total', { count: fmtInt(skin.total) });
  return h(
    'div',
    {
      class: `card${selected ? ' sel' : ''}${after && !change ? ' dim' : ''}`,
      role: 'option',
      'aria-selected': String(selected),
      tabindex: tabbable ? 0 : -1,
      'data-index': index,
      title: skin.name,
    },
    h('div', { class: 'nm' }, skin.name),
    h('div', { class: 'sub' }, sub),
    h(
      'div',
      { class: 'imgbox' },
      skin.icon
        ? h('img', { src: iconUrl(skin.icon, 128), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' })
        : icon('photo-off'),
    ),
    h('div', { class: 'layout' }, ...pillsOf(layoutOf(skin)).map((p) => h('span', { class: p.stack ? 'pill st' : 'pill' }, p.text))),
  );
}

export function createGrid(el: HTMLElement): Part {
  const banner = h('div', { class: 'banner', role: 'alert', hidden: true });
  const meta = h('span', { class: 'meta' });
  const sort = h(
    'select',
    { class: 'sort', 'aria-label': t('grid.sort') },
    h('option', { value: 'amount' }, t('sort.amount')),
    h('option', { value: 'name' }, t('sort.name')),
  );
  sort.addEventListener('change', () => setFilter({ sort: sort.value as Sort }));
  const cards = h('div', { class: 'grid', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': t('grid.title') });
  const spacer = h('div', { class: 'spacer' }, cards);
  const empty = h('p', { class: 'empty', hidden: true });
  const scroller = h('div', { class: 'scroller' }, spacer, empty);
  el.append(
    banner,
    h('div', { class: 'bar' }, h('h1', {}, t('grid.title')), meta, h('span', { class: 'sort-wrap' }, icon('arrows-sort'), sort)),
    scroller,
  );

  let state: State | null = null;
  let list: Skin[] = [];
  let lastInventory: State['inventory'] = null;
  let lastFilter: State['filter'] | null = null;
  let lastBanner = '';
  let cols = 1;
  let focusIndex = 0;
  let frame = 0;

  const order = () => list.map((s) => s.key);
  const focusCard = (index: number) => cards.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus({ preventScroll: true });

  const render = () => {
    frame = 0;
    if (!state) return;
    cols = columnsFor(scroller.clientWidth, MIN_CARD_WIDTH, GAP);
    cards.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    if (!state.inventory) {
      cards.style.transform = '';
      const skeleton = state.loading ? SKELETON_CARDS : 0;
      spacer.style.height = `${Math.ceil(skeleton / cols) * ROW}px`;
      cards.replaceChildren(...Array.from({ length: skeleton }, () => h('div', { class: 'card skeleton', 'aria-hidden': 'true' })));
      return;
    }
    const range = visibleRange(list.length, cols, ROW, scroller.scrollTop, scroller.clientHeight);
    spacer.style.height = `${range.total}px`;
    cards.style.transform = `translateY(${range.padTop}px)`;
    // Карточка с фокусом должна быть нарисована, иначе Tab проскочит сетку.
    focusIndex = Math.min(Math.max(focusIndex, range.first), Math.max(range.first, range.last - 1));
    const selected = new Set(state.selected);
    const after = afterMap(state.panel);
    const hadFocus = cards.contains(document.activeElement);
    const nodes: HTMLElement[] = [];
    for (let i = range.first; i < range.last; i++) {
      nodes.push(card(list[i], i, selected.has(list[i].key), i === focusIndex, after));
    }
    cards.replaceChildren(...nodes);
    if (hadFocus) focusCard(focusIndex);
  };

  const moveFocus = (index: number) => {
    if (!list.length) return;
    focusIndex = Math.min(list.length - 1, Math.max(0, index));
    const top = Math.floor(focusIndex / cols) * ROW;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + CARD_HEIGHT > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = top + CARD_HEIGHT - scroller.clientHeight;
    }
    render();
    focusCard(focusIndex);
  };

  const pick = (index: number, mode: SelectMode) => {
    const skin = list[index];
    if (!skin) return;
    focusIndex = index;
    selectSkin(skin.key, mode, order());
  };

  cards.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('.card[data-index]');
    if (!target) return;
    pick(Number(target.dataset.index), e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single');
  });
  cards.addEventListener('keydown', (e) => {
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: cols,
      ArrowUp: -cols,
      PageDown: cols * 3,
      PageUp: -cols * 3,
      Home: -list.length,
      End: list.length,
    };
    if (e.key in moves) {
      e.preventDefault();
      moveFocus(focusIndex + moves[e.key]);
    } else if (e.key === ' ') {
      e.preventDefault();
      pick(focusIndex, e.shiftKey ? 'range' : 'toggle');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(focusIndex, 'single');
    }
  });
  cards.addEventListener('focusin', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('.card[data-index]');
    if (target) focusIndex = Number(target.dataset.index);
  });
  scroller.addEventListener('scroll', () => {
    if (!frame) frame = requestAnimationFrame(render);
  });
  const observer = new ResizeObserver(() => render());
  observer.observe(scroller);

  const paintBanner = (s: State) => {
    const key = s.tokenExpired ? 'token' : s.error ? `error:${s.error.code}:${s.error.status}` : '';
    if (key === lastBanner) return;
    lastBanner = key;
    banner.hidden = !key;
    if (s.tokenExpired) {
      banner.replaceChildren(
        icon('alert-triangle'),
        h('span', {}, t('banner.tokenExpired')),
        h('button', { class: 'btn pri', type: 'button', onclick: () => void forgetToken() }, t('banner.newToken')),
      );
    } else if (s.error) {
      banner.replaceChildren(
        icon('alert-triangle'),
        h('span', {}, errorText(s.error)),
        h('button', { class: 'btn sec', type: 'button', onclick: () => void loadInventory() }, icon('refresh'), t('banner.retry')),
      );
    }
  };

  return {
    update(s) {
      state = s;
      if (s.inventory !== lastInventory || s.filter !== lastFilter) {
        if (lastFilter && s.filter !== lastFilter) scroller.scrollTop = 0;
        list = s.inventory ? visibleSkins(s.inventory, s.filter) : [];
        lastInventory = s.inventory;
        lastFilter = s.filter;
      }
      sort.value = s.filter.sort;
      meta.textContent = s.inventory ? tn('grid.meta', counts(s.inventory).stacks) : '';
      paintBanner(s);
      empty.hidden = !(s.inventory && list.length === 0);
      empty.textContent = s.inventory?.skins.length === 0 ? t('grid.empty') : t('grid.nothingFound');
      cards.setAttribute('aria-busy', String(s.loading));
      render();
    },
    destroy() {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    },
  };
}
```

- [ ] **Step 7: Стили главного окна**

`src/styles/main.css`:
```css
[hidden] { display: none !important; }

.app { height: 100%; display: flex; flex-direction: column; }

/* Верхняя панель */
.top { height: 60px; flex: none; display: flex; align-items: center; gap: 10px; padding: 0 20px; border-bottom: 1px solid var(--line); }
.top .brand { margin-right: 18px; }
.bulk {
  height: 38px; padding: 0 16px; border-radius: 9px; display: flex; align-items: center; gap: 8px;
  font-weight: 700; font-size: 14px; background: var(--card-2);
  transition: background-color 0.15s var(--ease), box-shadow 0.15s var(--ease), color 0.15s var(--ease);
}
.bulk .ti { font-size: 18px; }
.bulk:hover:not(:disabled) { background: #2b3144; }
.bulk.active { background: var(--acc-bg); color: var(--acc-2); box-shadow: inset 0 0 0 1.5px var(--acc); }
.acct { margin-left: auto; display: flex; align-items: center; gap: 8px; color: var(--text-2); font-size: 13px; white-space: nowrap; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); }
.dot.bad { background: var(--bad); }
.top .lang { margin-left: 4px; }
.icon-btn { width: 36px; height: 36px; border-radius: 9px; display: grid; place-items: center; color: var(--text-2); font-size: 20px; }
.icon-btn:hover, .icon-btn[aria-expanded='true'] { background: var(--card); color: var(--text); }
.menu-wrap { position: relative; }
.menu {
  position: absolute; right: 0; top: 44px; z-index: 20; min-width: 230px; padding: 6px; display: grid;
  background: var(--card); border: 1px solid var(--line); border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45); animation: rise 0.15s var(--ease);
}
.menu button { height: 36px; padding: 0 10px; border-radius: 8px; display: flex; align-items: center; gap: 10px; text-align: left; font-size: 14px; }
.menu button .ti { font-size: 18px; color: var(--text-2); }
.menu button:hover:not(:disabled) { background: var(--card-2); }
.menu .danger, .menu .danger .ti { color: var(--bad); }

.wrap { flex: 1; min-height: 0; display: grid; grid-template-columns: 200px minmax(0, 1fr) 340px; }

/* Фильтры */
.filters { border-right: 1px solid var(--line); padding: 16px; display: flex; flex-direction: column; gap: 18px; min-height: 0; overflow-y: auto; }
.search { height: 38px; border-radius: 9px; background: var(--card); display: flex; align-items: center; gap: 8px; padding: 0 12px; color: var(--text-3); cursor: text; }
.search:focus-within { box-shadow: inset 0 0 0 1.5px var(--acc); }
.search-input { flex: 1; min-width: 0; border: 0; outline: none; background: none; font-size: 14px; color: var(--text); }
.search-input::placeholder { color: var(--text-3); }
.fh { font-size: 11px; font-weight: 800; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
.opt { width: 100%; display: flex; align-items: center; gap: 10px; font-size: 14px; padding: 6px 0; text-align: left; border-radius: 6px; }
.opt:hover .box { border-color: var(--text-3); }
.opt .c { margin-left: auto; color: var(--text-3); font-size: 12px; }
.box {
  width: 18px; height: 18px; flex: none; border-radius: 5px; border: 1.5px solid #3d4357; display: grid; place-items: center;
  font-size: 13px; transition: background-color 0.15s var(--ease), border-color 0.15s var(--ease);
}
.box.round { border-radius: 50%; }
.box .ti { opacity: 0; color: #fff; }
.opt.on .box { background: var(--acc); border-color: var(--acc); }
.opt.on .box .ti { opacity: 1; }
.small { font-size: 12px; }
.stats { margin-top: auto; display: grid; gap: 4px; font-size: 12px; color: var(--text-3); }
.stats div { display: flex; justify-content: space-between; gap: 8px; }
.stats dd { color: var(--text-2); font-weight: 700; }

/* Сетка */
.content { padding: 16px 18px 0; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 14px; }
.bar { display: flex; align-items: center; gap: 10px; min-height: 38px; }
.bar h1 { font-size: 18px; font-weight: 800; }
.bar .meta { color: var(--text-2); font-size: 13px; }
.sort-wrap { margin-left: auto; height: 34px; padding: 0 4px 0 12px; border-radius: 8px; background: var(--card); display: flex; align-items: center; gap: 6px; color: var(--text-2); font-size: 13px; }
.sort { height: 100%; border: 0; background: transparent; color: var(--text-2); font-size: 13px; cursor: pointer; }
.sort option { background: var(--card); color: var(--text); }
.scroller { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: 16px; }
.spacer { position: relative; }
.grid { position: absolute; top: 0; left: 0; right: 0; display: grid; gap: 12px; grid-auto-rows: var(--card-h); }
.card {
  position: relative; height: var(--card-h); background: var(--card); border-radius: 12px; padding: 10px 10px 12px;
  border: 1.5px solid transparent; cursor: pointer; user-select: none;
  transition: border-color 0.15s var(--ease), background-color 0.15s var(--ease), opacity 0.2s var(--ease);
}
.card:hover { background: var(--card-hover); }
.card.sel { border-color: var(--acc); background: var(--card-2); }
.card.dim { opacity: 0.35; }
.card .nm { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card .sub { font-size: 12px; color: var(--text-2); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.card .becomes { color: var(--acc-2); font-weight: 700; }
.imgbox { height: 96px; margin-top: 8px; border-radius: 8px; background: var(--img); display: grid; place-items: center; }
.imgbox img { width: 84px; height: 84px; object-fit: contain; }
.imgbox .ti { font-size: 28px; color: var(--text-3); }
.layout { display: flex; gap: 4px; margin-top: 8px; height: 20px; overflow: hidden; }
.pill {
  height: 20px; padding: 0 7px; border-radius: 5px; background: var(--card-2); font-size: 11px; font-weight: 700;
  color: var(--text-2); display: flex; align-items: center; white-space: nowrap; font-variant-numeric: tabular-nums;
}
.pill.st { color: var(--text); }
.card.sel .pill { background: #2c3246; }
.card.skeleton {
  cursor: default; background: linear-gradient(90deg, var(--card) 0%, var(--card-2) 50%, var(--card) 100%);
  background-size: 200% 100%; animation: shimmer 1.4s linear infinite;
}
@keyframes shimmer { to { background-position: -200% 0; } }
.empty { padding: 60px 0; text-align: center; color: var(--text-2); }
.banner {
  display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 14px; border-radius: 10px;
  background: var(--bad-bg); color: #ffb4b2; font-size: 13px; animation: rise 0.2s var(--ease);
}
.banner > .ti { font-size: 18px; }
.banner .btn { margin-left: auto; height: 32px; padding: 0 12px; font-size: 13px; }

/* Правая панель — содержимое в panel.css */
.side { border-left: 1px solid var(--line); background: var(--panel); padding: 18px; display: flex; flex-direction: column; min-height: 0; overflow-y: auto; }
```

В `src/main.ts` после строки `import './styles/login.css';` добавь:
```ts
import './styles/main.css';
```

- [ ] **Step 8: Проверка**

Run: `npm run check`, `npm test`, `npm run build`
Expected: без ошибок, все тесты PASS.

Запусти `npm run dev` в фоне и сними `http://localhost:1420/?demo=main`. Сравни с `docs/design/main-window-item.png`:
- совпадают верхняя панель, колонка фильтров с числами и итогами, сетка 4 колонки по 1280 px с плашками `×N` и «N по одному»;
- правая колонка пока пустая — её наполняет Task 11.

Проверь в браузере:
- клик выделяет карточку рамкой акцентного цвета;
- Ctrl + клик добавляет, Shift + клик выделяет диапазон;
- стрелки двигают фокус, пробел выбирает;
- «Стопки» и «Дубли» меняют сетку и счётчики;
- поиск фильтрует по названию;
- «Разделить всё» подсвечивает кнопку, затронутые карточки получают подпись «станет … по одному», остальные приглушены.

Останови Vite.

- [ ] **Step 9: Commit**

```bash
git add src
git commit -m "feat: главное окно — верхняя панель, фильтры, виртуальная сетка

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Правая панель — подсказка, скин, несколько, план, ход, итог

По макетам `docs/design/main-window-item.png` (выбран скин) и `docs/design/main-window-plan.png` (план «Разделить всё»). Состояния — по спеке, раздел «Окно», пункт «Справа, панель».

**Files:**
- Create: `src/ui/panel.ts`, `src/ui/panel-select.ts`, `src/ui/panel-run.ts`, `src/styles/panel.css`
- Modify: `src/ui/shell.ts` (подключить панель), `src/main.ts` (импорт стилей)

**Interfaces:**
- Consumes: actions (`showPlan`, `runPlan`, `stopRun`, `closePanel`, `clearSelection`, `loadInventory`, `copyJournal`), `api.preview`, model (`layoutOf`, `layoutText`, `splitCapacity`, `canCombine`, `hasStack`, `apartRecords`, `counts`, `totals`), format, i18n, store (`Panel`, `State`), `Part`.
- Produces:
  - `createPanel(el): Part`;
  - `panel-select.ts`: `picture(skin, size, cls)`, `hintView(inventory)`, `itemView(skin, state)`, `multiView(skins)`;
  - `panel-run.ts`: `planView(plan, changed, state)`, `runningView(panel, state, tick)`, `resultView(panel)`.

Поведение:
- Панель перерисовывается только при смене `panel`, выбора, инвентаря, паузы или флага загрузки. Ввод в поиске её не трогает, поэтому ползунок не сбрасывается.
- **Один скин:**
  - картинка 256 px, название, «N шт. · стопка ×6 и 2 по одному»;
  - «Можно продать на площадке Steam», «Можно обменять» (да / нет / «с 2 нояб.»), «Записей в инвентаре»;
  - пометка «N записей не соберутся с остальными…», если есть записи с другим `instanceid`;
  - блок «Отделить по одному»: ползунок от 1 до `A−1`, кнопки − и +, поле числа;
  - строка «Станет: … · 2 запроса, ~3 с» — её считает ядро (`preview` с `splitOff`), поэтому она всегда совпадает с планом;
  - кнопки «Отделить N» и «Собрать» (неактивна, если собирать нечего).
- **Несколько скинов:** до 8 миниатюр и «+N», «Выбрано: 2 предмета, 20 шт.», «Разделить выбранные», «Собрать выбранные», «Снять выбор».
- **План:**
  - заголовок операции и подзаголовок;
  - если ядро вернуло новый план, сверху пометка «Инвентарь изменился…»;
  - «Стопок затронет», «Запросов к Steam», «Займёт примерно»;
  - очередь из первых пяти с миниатюрами и «и ещё N стопок»;
  - обещание сверки с общим числом штук;
  - кнопки «Запустить» и «Отмена»;
  - если запросов 0 — «Делать нечего…» и «Закрыть».
- **Ход:** полоса, «Выполнено N из M, ошибок K», текущий предмет, «Осталось ~…», при 429 — «Steam попросил подождать: N с» с отсчётом каждую секунду, кнопка «Остановить». После нажатия кнопка неактивна, на ней «Остановлюсь после текущего запроса…».
- **Итог:**
  - «Готово» или «Остановлено», «72 запроса, ошибок 0», причина остановки;
  - сверка зелёным «Сверка: было 121 шт. — стало 121 шт.» или красным со списком расхождений; без сверки — «Сверить не удалось…»;
  - кнопки «Перечитать инвентарь», «Скопировать журнал», «Закрыть».

- [ ] **Step 1: Подсказка, скин, несколько**

`src/ui/panel-select.ts`:
```ts
// Правая панель, пока операции нет: подсказка, один скин, несколько скинов.

import { clearSelection, showPlan } from '../actions';
import { api } from '../api';
import { h, icon } from '../dom';
import { estimateSeconds, fmtDate, fmtDuration, fmtInt, iconUrl } from '../format';
import { t, tn } from '../i18n';
import { apartRecords, canCombine, counts, hasStack, layoutOf, layoutText, splitCapacity } from '../model';
import type { State } from '../store';
import type { Inventory, Skin } from '../types';

export function picture(skin: Skin | undefined, size: number, cls: string): HTMLElement {
  return h('div', { class: cls }, skin?.icon ? h('img', { src: iconUrl(skin.icon, size), alt: '' }) : icon('photo-off'));
}

export function hintView(inventory: Inventory): HTMLElement {
  const allSingle = counts(inventory).stacks === 0;
  return h(
    'div',
    { class: 'panel hint' },
    h('div', { class: 'hint-icon' }, icon('hand-click')),
    h('h2', { class: 'plan-h' }, t('panel.hintTitle')),
    h('p', { class: 'muted' }, t('panel.hintClick')),
    h('p', { class: 'muted' }, t('panel.hintKeys')),
    h(
      'div',
      { class: 'sec' },
      h('p', {}, icon('arrows-split-2'), t('panel.hintSplitAll')),
      h('p', {}, icon('stack-push'), t('panel.hintCombineAll')),
    ),
    allSingle ? h('p', { class: 'note ok' }, icon('circle-check'), t('panel.allSingle')) : null,
  );
}

function yesNo(flag: boolean, availableAfter: string | null): HTMLElement {
  if (flag) return h('b', { class: 'yes' }, t('item.yes'));
  if (availableAfter) return h('b', { class: 'later' }, t('item.from', { date: fmtDate(availableAfter) }));
  return h('b', { class: 'no' }, t('item.no'));
}

function fact(label: string, value: HTMLElement): HTMLElement {
  return h('div', {}, h('dt', {}, label), h('dd', {}, value));
}

/** Блок «Отделить по одному». Строку «Станет: …» считает ядро, поэтому она совпадает с планом. */
function splitOff(skin: Skin, capacity: number, delayMs: number): { section: HTMLElement; button: HTMLButtonElement } {
  let count = 1;
  let seq = 0;
  const value = h('input', {
    class: 'v num',
    type: 'number',
    min: 1,
    max: capacity,
    value: count,
    inputmode: 'numeric',
    'aria-label': t('item.count'),
  });
  const range = h('input', { class: 'range', type: 'range', min: 1, max: capacity, value: count, 'aria-label': t('item.count') });
  const preview = h('p', { class: 'preview num', 'aria-live': 'polite' });
  const label = h('span', {}, t('item.splitN', { count }));
  const button = h(
    'button',
    { class: 'btn pri', type: 'button', onclick: () => void showPlan({ kind: 'splitOff', key: skin.key, count }) },
    icon('arrows-split-2'),
    label,
  );
  const less = h('button', { class: 'b', type: 'button', 'aria-label': t('item.less'), onclick: () => set(count - 1) }, icon('minus'));
  const more = h('button', { class: 'b', type: 'button', 'aria-label': t('item.more'), onclick: () => set(count + 1) }, icon('plus'));

  function set(next: number): void {
    count = Math.min(capacity, Math.max(1, Math.round(next) || 1));
    value.value = String(count);
    range.value = String(count);
    range.style.setProperty('--fill', `${capacity > 1 ? ((count - 1) / (capacity - 1)) * 100 : 100}%`);
    label.textContent = t('item.splitN', { count: fmtInt(count) });
    less.disabled = count <= 1;
    more.disabled = count >= capacity;
    const mine = ++seq;
    api.preview({ kind: 'splitOff', key: skin.key, count }).then(
      (plan) => {
        const after = plan.after[0];
        if (mine !== seq || !after) return;
        preview.textContent = t('item.result', {
          layout: layoutText(after.stacks, after.singles, true),
          requests: tn('plan.requests', plan.requests),
          time: fmtDuration(estimateSeconds(plan.requests, delayMs)),
        });
      },
      () => {},
    );
  }

  range.addEventListener('input', () => set(Number(range.value)));
  value.addEventListener('change', () => set(Number(value.value)));
  set(1);

  const section = h(
    'section',
    { class: 'sec' },
    h('div', { class: 'sec-h' }, h('span', {}, t('item.splitOff')), h('span', { class: 'amt' }, less, value, more)),
    range,
    h('div', { class: 'ticks num' }, h('span', {}, '1'), h('span', {}, fmtInt(capacity))),
    preview,
  );
  return { section, button };
}

export function itemView(skin: Skin, state: State): HTMLElement {
  const layout = layoutOf(skin);
  const main = skin.records[0];
  const apart = apartRecords(skin).length;
  const capacity = splitCapacity(skin);
  const split = capacity > 0 ? splitOff(skin, capacity, state.settings.delayMs) : null;
  const combine = h(
    'button',
    {
      class: 'btn sec',
      type: 'button',
      disabled: !canCombine(skin),
      onclick: () => void showPlan({ kind: 'combineSelected', keys: [skin.key] }),
    },
    icon('stack-push'),
    t('item.combine'),
  );
  return h(
    'div',
    { class: 'panel item' },
    picture(skin, 256, 'big'),
    h('h2', { class: 'iname' }, skin.name),
    h('p', { class: 'isub num' }, `${t('card.total', { count: fmtInt(skin.total) })} · ${layoutText(layout.stacks, layout.singles, true)}`),
    h(
      'dl',
      { class: 'kv' },
      fact(t('item.marketable'), yesNo(main?.marketable ?? false, main?.availableAfter ?? null)),
      fact(t('item.tradable'), yesNo(main?.tradable ?? false, main?.availableAfter ?? null)),
      fact(t('item.records'), h('b', { class: 'num' }, fmtInt(skin.records.length))),
    ),
    apart ? h('p', { class: 'note' }, icon('alert-triangle'), tn('item.apart', apart)) : null,
    split ? split.section : h('p', { class: 'note muted' }, icon('circle-check'), t('item.nothingToSplit')),
    split ? h('div', { class: 'acts' }, split.button, combine) : h('div', { class: 'acts one' }, combine),
    h('p', { class: 'foot' }, t('item.foot')),
  );
}

export function multiView(skins: Skin[]): HTMLElement {
  const pcs = skins.reduce((n, s) => n + s.total, 0);
  const keys = skins.map((s) => s.key);
  const shown = skins.slice(0, 8);
  return h(
    'div',
    { class: 'panel multi' },
    h(
      'div',
      { class: 'thumbs' },
      ...shown.map((s) => h('div', { class: 'thumb', title: s.name }, s.icon ? h('img', { src: iconUrl(s.icon, 96), alt: '' }) : icon('photo-off'))),
      skins.length > shown.length ? h('div', { class: 'thumb' }, t('multi.more', { count: fmtInt(skins.length - shown.length) })) : null,
    ),
    h('h2', { class: 'plan-h' }, t('multi.title', { items: tn('multi.items', skins.length), pcs: t('card.total', { count: fmtInt(pcs) }) })),
    h(
      'div',
      { class: 'acts one' },
      h(
        'button',
        { class: 'btn pri', type: 'button', disabled: !skins.some(hasStack), onclick: () => void showPlan({ kind: 'splitSelected', keys }) },
        icon('arrows-split-2'),
        t('multi.split'),
      ),
      h(
        'button',
        { class: 'btn sec', type: 'button', disabled: !skins.some(canCombine), onclick: () => void showPlan({ kind: 'combineSelected', keys }) },
        icon('stack-push'),
        t('multi.combine'),
      ),
    ),
    h('button', { class: 'link', type: 'button', onclick: clearSelection }, t('multi.clear')),
    h('p', { class: 'foot' }, t('item.foot')),
  );
}
```

- [ ] **Step 2: План, ход, итог**

`src/ui/panel-run.ts`:
```ts
// Правая панель вокруг операции: план, ход, итог со сверкой.

import { closePanel, copyJournal, loadInventory, runPlan, stopRun } from '../actions';
import { h, icon } from '../dom';
import { estimateSeconds, fmtDuration, fmtInt } from '../format';
import { t, tn } from '../i18n';
import { totals } from '../model';
import type { Panel, State } from '../store';
import type { Operation, Plan, Skin } from '../types';
import { picture } from './panel-select';

function title(operation: Operation): string {
  return operation.kind === 'splitOff' ? t('op.splitOff', { count: fmtInt(operation.count) }) : t(`op.${operation.kind}`);
}

const isSplit = (operation: Operation) => operation.kind !== 'combineAll' && operation.kind !== 'combineSelected';

function skinsByKey(state: State): Map<string, Skin> {
  return new Map((state.inventory?.skins ?? []).map((skin) => [skin.key, skin]));
}

function fact(label: string, value: string): HTMLElement {
  return h('div', { class: 'fact' }, h('dt', {}, label), h('dd', { class: 'num' }, value));
}

export function planView(plan: Plan, changed: boolean, state: State): HTMLElement {
  const operation = plan.operation;
  if (plan.requests === 0) {
    return h(
      'div',
      { class: 'panel plan' },
      h('h2', { class: 'plan-h' }, title(operation)),
      h('p', { class: 'note ok' }, icon('circle-check'), t(isSplit(operation) ? 'plan.nothingSplit' : 'plan.nothingCombine')),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn sec wide', type: 'button', onclick: closePanel }, t('plan.close')),
    );
  }
  const byKey = skinsByKey(state);
  const sub = operation.kind === 'splitOff' ? t('op.splitOff.sub', { count: fmtInt(plan.requests) }) : t(`op.${operation.kind}.sub`);
  const items = state.inventory ? totals(state.inventory).items : 0;
  return h(
    'div',
    { class: 'panel plan' },
    h('h2', { class: 'plan-h' }, title(operation)),
    h('p', { class: 'isub' }, sub),
    changed ? h('p', { class: 'note' }, icon('refresh'), t('plan.changed')) : null,
    h(
      'dl',
      { class: 'facts' },
      fact(t('plan.stacks'), fmtInt(plan.stacks)),
      fact(t('plan.requestsLabel'), fmtInt(plan.requests)),
      fact(t('plan.time'), fmtDuration(estimateSeconds(plan.requests, state.settings.delayMs))),
    ),
    h('div', { class: 'fh queue-h' }, t('plan.queue')),
    h(
      'ul',
      { class: 'queue' },
      ...plan.queue.map((item) => {
        const skin = byKey.get(item.key);
        return h(
          'li',
          {},
          picture(skin, 64, 'qimg'),
          h('span', { class: 'qn' }, `${skin?.name ?? item.key} ×${fmtInt(item.amount)}`),
          h('span', { class: 'r num' }, t('plan.queueReq', { count: fmtInt(item.requests) })),
        );
      }),
      plan.more ? h('li', { class: 'more' }, tn('plan.more', plan.more)) : null,
    ),
    h('p', { class: 'check' }, icon('scale'), t('plan.check', { count: fmtInt(items) })),
    h('div', { class: 'grow' }),
    h('button', { class: 'btn pri run', type: 'button', onclick: () => void runPlan(plan) }, icon('player-play'), t('plan.run')),
    h('button', { class: 'btn sec cancel', type: 'button', onclick: closePanel }, t('plan.cancel')),
  );
}

export function runningView(
  panel: Extract<Panel, { kind: 'running' }>,
  state: State,
  tick: (fn: () => void) => void,
): HTMLElement {
  const name = panel.key ? (skinsByKey(state).get(panel.key)?.name ?? panel.key) : '';
  const fill = h('div', { class: 'fill' });
  fill.style.width = `${panel.total ? Math.round((panel.done / panel.total) * 100) : 100}%`;
  const wait = h('p', { class: 'wait num', role: 'status' });
  if (panel.waitUntil) {
    const until = panel.waitUntil;
    const show = () => {
      wait.textContent = t('run.waiting', { seconds: Math.max(0, Math.ceil((until - Date.now()) / 1000)) });
    };
    show();
    tick(show);
  } else {
    wait.hidden = true;
  }
  const left = Math.max(0, panel.total - panel.done);
  return h(
    'div',
    { class: 'panel run-view' },
    h('h2', { class: 'plan-h' }, t('run.title', { op: title(panel.plan.operation) })),
    h(
      'div',
      { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': panel.total, 'aria-valuenow': panel.done },
      fill,
    ),
    h('p', { class: 'num' }, t('run.progress', { done: fmtInt(panel.done), total: fmtInt(panel.total), errors: fmtInt(panel.errors) })),
    name ? h('p', { class: 'muted' }, t('run.current', { name })) : null,
    h('p', { class: 'muted num' }, t('run.left', { time: fmtDuration(estimateSeconds(left, state.settings.delayMs)) })),
    wait,
    h('p', { class: 'foot' }, t('run.browse')),
    h(
      'button',
      { class: 'btn danger wide', type: 'button', disabled: panel.stopping, onclick: stopRun },
      icon('player-stop'),
      t(panel.stopping ? 'run.stopping' : 'run.stop'),
    ),
  );
}

export function resultView(panel: Extract<Panel, { kind: 'result' }>): HTMLElement {
  const { outcome, reconciliation } = panel;
  const finished = outcome.reason === 'finished';
  let check: HTMLElement;
  if (!reconciliation) {
    check = h('p', { class: 'verdict bad' }, icon('alert-triangle'), t('result.checkUnavailable'));
  } else if (reconciliation.before === reconciliation.after && reconciliation.mismatches.length === 0) {
    check = h(
      'p',
      { class: 'verdict ok num' },
      icon('scale'),
      t('result.checkOk', { before: fmtInt(reconciliation.before), after: fmtInt(reconciliation.after) }),
    );
  } else {
    check = h(
      'div',
      { class: 'verdict bad' },
      h('p', { class: 'num' }, icon('alert-triangle'), t('result.checkBad', { before: fmtInt(reconciliation.before), after: fmtInt(reconciliation.after) })),
      h(
        'ul',
        { class: 'mismatches num' },
        ...reconciliation.mismatches.map((m) => h('li', {}, t('result.mismatch', { name: m.name, before: fmtInt(m.before), after: fmtInt(m.after) }))),
      ),
    );
  }
  const copyLabel = h('span', {}, t('result.copyLog'));
  const copy = async () => {
    copyLabel.textContent = t((await copyJournal()) ? 'result.copied' : 'menu.copyFailed');
  };
  return h(
    'div',
    { class: 'panel outcome' },
    h('h2', { class: 'plan-h' }, t(finished ? 'result.done' : 'result.stopped')),
    h('p', { class: 'isub num' }, t('result.summary', { requests: tn('plan.requests', outcome.done), errors: fmtInt(outcome.errors) })),
    finished ? null : h('p', { class: 'note' }, icon('alert-triangle'), t(`result.reason.${outcome.reason}`)),
    check,
    h('div', { class: 'grow' }),
    h('button', { class: 'btn pri wide', type: 'button', onclick: () => void loadInventory() }, icon('refresh'), t('result.reload')),
    h(
      'div',
      { class: 'acts' },
      h('button', { class: 'btn sec', type: 'button', onclick: () => void copy() }, icon('clipboard'), copyLabel),
      h('button', { class: 'btn sec', type: 'button', onclick: closePanel }, t('result.close')),
    ),
  );
}
```

- [ ] **Step 3: Панель и подключение**

`src/ui/panel.ts`:
```ts
// Правая панель. Перерисовывается только при смене того, что в ней показано:
// иначе ввод в поиске сбрасывал бы ползунок «Отделить по одному».

import { h } from '../dom';
import type { Panel, State } from '../store';
import type { Inventory, Skin } from '../types';
import { planView, resultView, runningView } from './panel-run';
import { hintView, itemView, multiView } from './panel-select';
import type { Part } from './shell';

interface Shown {
  panel: Panel;
  selected: string[];
  inventory: Inventory | null;
  delay: number;
  loading: boolean;
}

function view(state: State, tick: (fn: () => void) => void): HTMLElement {
  const inventory = state.inventory;
  if (!inventory) return h('div', { class: 'panel' });
  const panel = state.panel;
  switch (panel.kind) {
    case 'plan':
      return planView(panel.plan, panel.changed, state);
    case 'running':
      return runningView(panel, state, tick);
    case 'result':
      return resultView(panel);
    case 'selection': {
      const byKey = new Map(inventory.skins.map((skin) => [skin.key, skin]));
      const skins = state.selected.map((key) => byKey.get(key)).filter((skin): skin is Skin => skin !== undefined);
      if (skins.length === 1) return itemView(skins[0], state);
      if (skins.length > 1) return multiView(skins);
      return hintView(inventory);
    }
  }
}

export function createPanel(el: HTMLElement): Part {
  let shown: Shown | null = null;
  let timer = 0;
  const stopTimer = () => {
    window.clearInterval(timer);
    timer = 0;
  };
  const tick = (fn: () => void) => {
    stopTimer();
    timer = window.setInterval(fn, 1000);
  };
  return {
    update(state) {
      const next: Shown = {
        panel: state.panel,
        selected: state.selected,
        inventory: state.inventory,
        delay: state.settings.delayMs,
        loading: state.loading,
      };
      if (shown && (Object.keys(next) as (keyof Shown)[]).every((k) => shown![k] === next[k])) return;
      shown = next;
      stopTimer();
      el.replaceChildren(view(state, tick));
    },
    destroy: stopTimer,
  };
}
```

В `src/ui/shell.ts`:
- добавь импорт `import { createPanel } from './panel';`;
- строку с `const parts` замени на
  ```ts
  const parts: Part[] = [createTopbar(top), createFilters(filters), createGrid(content), createPanel(side)];
  ```

В `src/main.ts` после `import './styles/main.css';` добавь:
```ts
import './styles/panel.css';
```

- [ ] **Step 4: Стили панели**

`src/styles/panel.css`:
```css
.panel { display: flex; flex-direction: column; min-height: 100%; animation: rise 0.2s var(--ease); }
.wide { width: 100%; }
.foot { margin-top: auto; padding-top: 14px; font-size: 12px; color: var(--text-3); line-height: 1.5; }
.note { margin-top: 12px; display: flex; gap: 8px; align-items: flex-start; font-size: 12px; line-height: 1.5; color: var(--warn); }
.note .ti { font-size: 16px; flex: none; margin-top: 1px; }
.note.ok { color: var(--ok); }
.note.muted { color: var(--text-2); }
.plan-h { font-size: 20px; font-weight: 800; margin: 2px 0 4px; line-height: 1.25; }
.isub { color: var(--text-2); font-size: 13px; }

/* Скин */
.big { height: 196px; flex: none; border-radius: 12px; background: var(--img); display: grid; place-items: center; }
.big img { width: 176px; height: 176px; object-fit: contain; }
.big .ti, .thumb .ti { color: var(--text-3); font-size: 32px; }
.iname { margin: 14px 0 4px; font-size: 20px; font-weight: 800; line-height: 1.25; overflow-wrap: anywhere; }
.kv { margin-top: 12px; display: grid; gap: 6px; font-size: 13px; }
.kv div { display: flex; justify-content: space-between; gap: 12px; color: var(--text-2); }
.kv b { color: var(--text); font-weight: 700; }
.kv .yes { color: var(--ok); }
.kv .no { color: var(--text-2); }
.kv .later { color: var(--warn); }
.sec { margin-top: 14px; background: var(--card); border-radius: 12px; padding: 14px; }
.sec-h { display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: 800; }
.amt { display: flex; align-items: center; gap: 6px; }
.amt .b { width: 30px; height: 30px; border-radius: 8px; background: var(--card-2); display: grid; place-items: center; font-size: 16px; }
.amt .b:hover:not(:disabled) { background: #2b3144; }
.amt .v {
  width: 52px; height: 30px; border: 0; border-radius: 8px; background: var(--bg); text-align: center;
  font-weight: 800; font-size: 15px; appearance: textfield; -moz-appearance: textfield;
}
.amt .v::-webkit-inner-spin-button, .amt .v::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.sec .range { margin: 18px 0 6px; }
.ticks { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-3); }
.preview { margin-top: 12px; font-size: 13px; color: var(--text-2); min-height: 38px; }
.acts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 14px; }
.acts.one { grid-template-columns: 1fr; }

/* Подсказка */
.hint { gap: 10px; }
.hint-icon { width: 44px; height: 44px; border-radius: 12px; background: var(--acc-bg); color: var(--acc-2); display: grid; place-items: center; font-size: 22px; }
.hint .sec { display: grid; gap: 10px; font-size: 13px; color: var(--text-2); }
.hint .sec p { display: flex; gap: 10px; align-items: flex-start; }
.hint .sec .ti { font-size: 18px; color: var(--text); flex: none; }

/* Несколько */
.thumbs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.thumb { aspect-ratio: 1; border-radius: 8px; background: var(--img); display: grid; place-items: center; font-size: 12px; font-weight: 800; color: var(--text-2); }
.thumb img { width: 80%; height: 80%; object-fit: contain; }
.multi .plan-h { margin-top: 14px; }
.multi .link { margin-top: 12px; align-self: flex-start; }

/* План */
.facts { display: grid; gap: 10px; margin-top: 14px; }
.fact { display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 10px; border-bottom: 1px solid var(--line); font-size: 13px; color: var(--text-2); }
.fact dd { font-size: 20px; color: var(--text); font-weight: 800; }
.queue-h { margin-top: 16px; }
.queue { font-size: 13px; }
.queue li { display: flex; align-items: center; gap: 10px; padding: 5px 0; }
.qimg { width: 28px; height: 28px; flex: none; border-radius: 6px; background: var(--img); display: grid; place-items: center; }
.qimg img { width: 28px; height: 28px; object-fit: contain; }
.qimg .ti { font-size: 16px; color: var(--text-3); }
.qn { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.queue .r { margin-left: auto; color: var(--text-3); font-size: 12px; white-space: nowrap; }
.queue .more { color: var(--text-3); }
.check { margin-top: 12px; display: flex; gap: 8px; align-items: flex-start; font-size: 12px; color: var(--text-2); line-height: 1.5; }
.check .ti { color: var(--ok); font-size: 16px; flex: none; }
.run { height: 50px; margin-top: 16px; width: 100%; }
.cancel { height: 40px; margin-top: 8px; width: 100%; }

/* Ход */
.progress { height: 8px; border-radius: 4px; background: var(--card-2); overflow: hidden; margin: 16px 0 10px; }
.progress .fill { height: 100%; background: var(--acc); border-radius: 4px; }
.run-view p { margin-top: 4px; font-size: 13px; }
.wait { color: var(--warn); font-weight: 700; }
.run-view .btn { margin-top: 14px; }

/* Итог */
.verdict { margin-top: 14px; display: flex; flex-direction: column; gap: 8px; font-size: 14px; font-weight: 700; line-height: 1.45; }
p.verdict, .verdict > p { flex-direction: row; display: flex; gap: 8px; align-items: flex-start; }
.verdict .ti { font-size: 18px; flex: none; }
.verdict.ok { color: var(--ok); }
.verdict.bad { color: var(--bad); }
.mismatches { display: grid; gap: 4px; font-size: 13px; font-weight: 600; padding-left: 26px; }
.outcome .acts { margin-top: 8px; }
.outcome .wide { margin-top: 16px; }
```

- [ ] **Step 5: Проверка**

Run: `npm run check`, `npm test`, `npm run build`
Expected: без ошибок.

Запусти `npm run dev` в фоне и сними `?demo=item` и `?demo=plan`. Сравни с `docs/design/main-window-item.png` и `docs/design/main-window-plan.png`.

Expected:
- для item — та же панель: картинка, название, «да/да», записи, блок «Отделить по одному» с ползунком, строка «Станет: …», кнопки «Отделить 1» и «Собрать»;
- для plan — заголовок «Разделить всё», три цифры, очередь из пяти с миниатюрами, «и ещё N стопок», сверка, «Запустить» и «Отмена»;
- затронутые карточки подписаны «станет … по одному», остальные приглушены.

Небольшие отличия в данных допустимы: демо-количества, количество в ползунке.

В браузере проверь сценарий:
- выбрать скин;
- сдвинуть ползунок — строка «Станет» и кнопка меняются;
- «Отделить N» → план → «Запустить» → полоса хода и счётчик;
- «Остановить» → итог «Остановлено» со сверкой;
- «Перечитать инвентарь» возвращает подсказку;
- Ctrl + клик по двум карточкам → «Выбрано: 2 предмета, N шт.».

Останови Vite.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "feat: правая панель — скин, выбор, план, ход и итог со сверкой

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Настройки и проверка окна целиком

Боковая панель «Настройки» (спека, «Прочие состояния»): язык (как в системе / English / Русский) и пауза между запросами от 0,5 до 10 с с шагом 0,5 (по умолчанию 1,5). Затем проверка всех состояний окна в демо-режиме и запуск настоящего окна Tauri.

**Files:**
- Create: `src/ui/settings.ts`, `src/styles/overlay.css`
- Modify: `src/ui/shell.ts`, `src/main.ts`

**Interfaces:**
- Consumes: `saveSettings` (actions), `asUiError`, `errorText`, `fmtSeconds`, store (`setState`, `State`), `Part`.
- Produces: `createSettings(host): Part`.

- [ ] **Step 1: Панель настроек**

`src/ui/settings.ts`:
```ts
// Боковая панель настроек: язык и пауза между запросами.

import { saveSettings } from '../actions';
import { asUiError } from '../api';
import { h, icon } from '../dom';
import { fmtSeconds } from '../format';
import { errorText, t } from '../i18n';
import { setState, type State } from '../store';
import type { Settings } from '../types';
import type { Part } from './shell';

const MIN_DELAY = 500;
const MAX_DELAY = 10_000;
const STEP = 500;

export function createSettings(host: HTMLElement): Part {
  let open = false;
  let restoreFocus: HTMLElement | null = null;
  const close = () => setState({ settingsOpen: false });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) close();
  };
  document.addEventListener('keydown', onKey);

  const render = (state: State) => {
    let delay = state.settings.delayMs;
    let language = state.settings.language;
    const value = h('output', { class: 'v num' });
    const range = h('input', {
      class: 'range',
      type: 'range',
      min: MIN_DELAY,
      max: MAX_DELAY,
      step: STEP,
      value: delay,
      'aria-label': t('settings.delay'),
    });
    const paint = () => {
      value.textContent = t('settings.delayValue', { value: fmtSeconds(delay) });
      range.style.setProperty('--fill', `${((delay - MIN_DELAY) / (MAX_DELAY - MIN_DELAY)) * 100}%`);
    };
    range.addEventListener('input', () => {
      delay = Number(range.value);
      paint();
    });
    paint();

    const select = h(
      'select',
      { class: 'select', 'aria-label': t('settings.language') },
      h('option', { value: '' }, t('settings.system')),
      h('option', { value: 'en' }, 'English'),
      h('option', { value: 'ru' }, 'Русский'),
    );
    select.value = language ?? '';
    select.addEventListener('change', () => {
      language = select.value === 'en' || select.value === 'ru' ? select.value : null;
    });

    const error = h('p', { class: 'field-error', role: 'alert' });
    const save = async () => {
      const next: Settings = { language, delayMs: delay };
      try {
        await saveSettings(next);
      } catch (e) {
        error.textContent = errorText(asUiError(e));
      }
    };

    const drawer = h(
      'div',
      { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'settings-title' },
      h(
        'div',
        { class: 'drawer-head' },
        h('h2', { id: 'settings-title' }, t('settings.title')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('settings.close'), onclick: close }, icon('x')),
      ),
      h('label', { class: 'field' }, h('span', { class: 'fh' }, t('settings.language')), select),
      h(
        'div',
        { class: 'field' },
        h('div', { class: 'field-row' }, h('span', { class: 'fh' }, t('settings.delay')), value),
        range,
        h('p', { class: 'muted small' }, t('settings.delayHint')),
      ),
      error,
      h('div', { class: 'grow' }),
      h('p', { class: 'muted small' }, t('settings.about')),
      h(
        'div',
        { class: 'acts' },
        h('button', { class: 'btn pri', type: 'button', onclick: () => void save() }, t('settings.save')),
        h('button', { class: 'btn sec', type: 'button', onclick: close }, t('settings.close')),
      ),
    );
    host.replaceChildren(h('div', { class: 'backdrop', onclick: close }), drawer);
    select.focus();
  };

  return {
    update(state) {
      if (state.settingsOpen === open) return;
      open = state.settingsOpen;
      if (open) {
        restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        render(state);
      } else {
        host.replaceChildren();
        restoreFocus?.focus();
        restoreFocus = null;
      }
    },
    destroy() {
      document.removeEventListener('keydown', onKey);
    },
  };
}
```

`src/styles/overlay.css`:
```css
.backdrop { position: fixed; inset: 0; z-index: 30; background: rgba(5, 6, 10, 0.55); animation: fade 0.15s var(--ease); }
.drawer {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 31; width: 380px; max-width: 100%;
  padding: 22px; display: flex; flex-direction: column; gap: 18px;
  background: var(--panel); border-left: 1px solid var(--line); box-shadow: -16px 0 40px rgba(0, 0, 0, 0.35);
  animation: slide-in 0.2s var(--ease);
}
@keyframes slide-in { from { transform: translateX(24px); opacity: 0; } }
.drawer-head { display: flex; align-items: center; justify-content: space-between; }
.drawer-head h2 { font-size: 20px; font-weight: 800; }
.field { display: grid; gap: 8px; }
.field .fh { margin: 0; }
.field-row { display: flex; align-items: baseline; justify-content: space-between; }
.field-row .v { font-weight: 800; }
.select { height: 40px; padding: 0 12px; border: 1.5px solid var(--line); border-radius: 10px; background: var(--card); color: var(--text); font-size: 14px; }
.select:focus { outline: none; border-color: var(--acc); }
.drawer .range { margin: 10px 0 4px; }
.field-error { min-height: 18px; font-size: 13px; color: var(--bad); }
```

- [ ] **Step 2: Подключение**

В `src/ui/shell.ts`:
- добавь импорт `import { createSettings } from './settings';`;
- в `mountMain` создай слой: `const overlay = h('div', { class: 'overlay' });`;
- добавь его последним ребёнком `.app`:
  ```ts
  const el = h('div', { class: 'app' }, top, h('div', { class: 'wrap' }, filters, content, side), overlay);
  ```
- строку с `const parts` замени на
  ```ts
  const parts: Part[] = [createTopbar(top), createFilters(filters), createGrid(content), createPanel(side), createSettings(overlay)];
  ```

В `src/main.ts` после `import './styles/panel.css';` добавь:
```ts
import './styles/overlay.css';
```

- [ ] **Step 3: Проверка в демо-режиме**

Run: `npm run check`, `npm test`, `npm run build`
Expected: без ошибок.

Запусти `npm run dev` в фоне и пройди в браузере (`mcp__Claude_Browser__*` или вручную):
1. Меню → «Настройки»: панель выезжает справа, фокус на выборе языка. Escape и клик по затемнению закрывают её.
2. Пауза 3 с → «Сохранить»: в плане «Займёт примерно» стало больше.
3. Язык English → «Сохранить»: окно перерисовалось на английском. Верни «Как в системе».
4. Меню → «Скопировать журнал»: на пункте на 1,5 с «Журнал скопирован» (в демо журнал короткий).
5. Меню → «Забыть токен»: экран входа.

Сними `?demo=main`, `?demo=item`, `?demo=plan` и положи снимки в отчёт задачи. Останови Vite.

- [ ] **Step 4: Проверка настоящего окна**

Run: `npm run tauri dev` в фоне.
Expected: собирается и открывает окно с экраном входа. В выводе нет паники Rust. Затем останови процессы `rust-skin-stacker` и `node`, которые запустила эта команда.

Живую проверку с токеном (CSP, IPC, открытие страницы токена) делает контроллер в Task 16, а проверку на аккаунте — владелец в Task 17.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: настройки языка и паузы

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: CI, Dependabot, шаблон issue, SECURITY.md

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/dependabot.yml`, `.github/ISSUE_TEMPLATE/bug_report.yml`, `SECURITY.md`

**Interfaces:**
- Consumes: npm-скрипты `check`, `test`, `build`; команды cargo из раздела «Как проверять».
- Produces: проверку на каждый push в `main` и каждый pull request, на `windows-latest` и `ubuntu-24.04`.

`ubuntu-24.04` вместо `ubuntu-22.04` из спеки: образ 22.04 с 17.09.2026 устарел, в апреле 2027 его уберут (actions/runner-images#14254). AppImage и deb, собранные на 24.04, требуют glibc 2.39: это Ubuntu 24.04+, Debian 13+, Fedora 40+.

- [ ] **Step 1: Проверка на push и pull request**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    name: check (${{ matrix.os }})
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, ubuntu-24.04]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v7

      - name: Linux packages for Tauri
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm

      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy, rustfmt

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: './src-tauri -> target'

      - run: npm ci
      - run: npm run check
      - run: npm test
      # tauri::generate_context!() требует собранную папку dist/
      - run: npm run build

      - name: cargo fmt
        run: cargo fmt --manifest-path src-tauri/Cargo.toml --check
      - name: cargo clippy
        run: cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
      - name: cargo test
        run: cargo test --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 2: Dependabot**

`.github/dependabot.yml` (минорные и патч-обновления — одним PR на экосистему, мажорные — отдельно):
```yaml
version: 2
updates:
  - package-ecosystem: cargo
    directory: /src-tauri
    schedule:
      interval: weekly
    groups:
      cargo-minor:
        update-types: [minor, patch]
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    groups:
      npm-minor:
        update-types: [minor, patch]
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

- [ ] **Step 3: Шаблон issue**

`.github/ISSUE_TEMPLATE/bug_report.yml`:
```yaml
name: Bug report / Ошибка
description: Something does not work / Что-то не работает
labels: [bug]
body:
  - type: markdown
    attributes:
      value: |
        **Never paste your Steam token, the token page or the `steamLoginSecure` cookie here.** Anyone who has the token can act on your Steam account until it expires. The log from Menu → Copy log has no token in it and is safe to paste.

        **Никогда не вставляйте сюда токен Steam, страницу токена или cookie `steamLoginSecure`.** С токеном любой может действовать от вашего аккаунта, пока срок не истечёт. В журнале из «Меню → Скопировать журнал» токена нет, его можно вставлять.
  - type: input
    id: version
    attributes:
      label: App version / Версия приложения
      placeholder: 0.1.0
    validations:
      required: true
  - type: dropdown
    id: system
    attributes:
      label: System / Система
      options:
        - Windows 11
        - Windows 10
        - Linux (AppImage)
        - Linux (deb)
        - Linux (rpm)
    validations:
      required: true
  - type: textarea
    id: what
    attributes:
      label: What happened / Что произошло
      description: What you did, what you expected and what you got. / Что вы сделали, что ожидали и что получилось.
    validations:
      required: true
  - type: textarea
    id: log
    attributes:
      label: Log / Журнал
      description: Menu → Copy log. / Меню → «Скопировать журнал».
      render: text
  - type: checkboxes
    id: no-token
    attributes:
      label: Token / Токен
      options:
        - label: There is no token, token page or cookie in this issue / В этом issue нет токена, страницы токена и cookie
          required: true
```

- [ ] **Step 4: SECURITY.md**

`SECURITY.md`:
```markdown
# Security

## Reporting a vulnerability

Please do not open a public issue for a vulnerability. Use **Security → Report a vulnerability** in this repository (private reporting).

Never send your Steam token, the token page or cookies — not in issues and not in private reports. A report needs steps to reproduce, not your token.

## What the app does with the token

- The token is kept only in the memory of the app's Rust core. It is never written to disk and never sent back to the window.
- The core talks only to `api.steampowered.com`. The window loads only item pictures from `community.akamai.steamstatic.com`; everything else is blocked by the Content Security Policy.
- The window can open exactly one address in your browser: the Steam token page.
- There is no telemetry, no auto-update and no third-party server.

## Supported versions

Fixes go into the latest release only.

---

# Безопасность

## Как сообщить об уязвимости

Не открывайте публичный issue. В этом репозитории есть **Security → Report a vulnerability** — закрытое сообщение.

Никогда не присылайте токен Steam, страницу токена или cookie — ни в issue, ни в закрытом сообщении. Для отчёта нужны шаги, чтобы повторить проблему, а не ваш токен.

## Что приложение делает с токеном

- Токен хранится только в памяти Rust-ядра приложения. На диск он не пишется и обратно в окно не передаётся.
- Ядро ходит только на `api.steampowered.com`. Окно загружает только картинки предметов с `community.akamai.steamstatic.com`, остальное запрещено политикой безопасности (CSP).
- Окно может открыть в браузере ровно один адрес — страницу токена Steam.
- Телеметрии, автообновления и сторонних серверов нет.

## Какие версии поддерживаются

Исправления выходят только в последней версии.
```

- [ ] **Step 5: Проверка**

Проверь, что YAML читается:
```bash
python -c "import sys, yaml; [yaml.safe_load(open(f, encoding='utf-8')) for f in sys.argv[1:]]; print('ok')" .github/workflows/ci.yml .github/dependabot.yml .github/ISSUE_TEMPLATE/bug_report.yml
```
Expected: `ok`. Если PyYAML не установлен, не ставь его: прочитай файлы глазами и укажи это в отчёте. Настоящая проверка будет при первом push на GitHub (Task 17).

Проверь, что шаги CI совпадают с локальными: выполни подряд `npm ci`, `npm run check`, `npm test`, `npm run build`, `cargo fmt … --check`, `cargo clippy … -D warnings`, `cargo test …`.
Expected: всё зелёное.

- [ ] **Step 6: Commit**

```bash
git add .github SECURITY.md
git commit -m "ci: проверка на Windows и Linux, Dependabot, шаблон issue, SECURITY.md

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Релизы — сборки, SHA256SUMS, подтверждения происхождения

По тегу `v*` собираются:
- Windows: NSIS `.exe` и `.msi`;
- Linux: `.AppImage`, `.deb`, `.rpm`.

Файлы ложатся в черновик релиза. К каждому прикладывается подтверждение происхождения (`actions/attest@v4`: в его README он рекомендован вместо `attest-build-provenance`). Последний шаг считает `SHA256SUMS` по всем файлам, подтверждает и его и добавляет в релиз. Публикует релиз владелец вручную.

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `tauri.conf.json` (`productName`, `version`, `bundle.targets = "all"`), npm-скрипт `build`.
- Produces: черновик релиза с файлами, `SHA256SUMS` и подтверждениями (`gh attestation verify <file> --repo <owner>/rust-skin-stacker`).

GitHub заменяет пробелы в именах файлов релиза точками: `Rust Skin Stacker_0.1.0_x64-setup.exe` становится `Rust.Skin.Stacker_0.1.0_x64-setup.exe`. Поэтому копии для подписи и `SHA256SUMS` переименовываются так же. Последний шаг проверяет, что каждое имя из `SHA256SUMS` есть среди файлов релиза.

- [ ] **Step 1: Файл релиза**

`.github/workflows/release.yml`:
```yaml
name: Release

on:
  push:
    tags: ['v*']

permissions:
  contents: read

jobs:
  build:
    name: build (${{ matrix.os }})
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: windows-latest
            bundles: nsis,msi
          - os: ubuntu-24.04
            bundles: appimage,deb,rpm
    runs-on: ${{ matrix.os }}
    permissions:
      contents: write # tauri-action создаёт черновик релиза и загружает в него файлы
      id-token: write # подтверждение происхождения
      attestations: write
      artifact-metadata: write
    steps:
      - uses: actions/checkout@v7

      - name: Linux packages for Tauri
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm

      - uses: dtolnay/rust-toolchain@stable

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: './src-tauri -> target'

      - run: npm ci

      - uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: Rust Skin Stacker ${{ github.ref_name }}
          releaseDraft: true
          prerelease: false
          uploadUpdaterJson: false
          args: --bundles ${{ matrix.bundles }}
          releaseBody: |
            Builds for Windows and Linux. Not affiliated with Valve or Facepunch.

            **Check a file before you run it**
            - Checksum: compare the file with `SHA256SUMS` — `sha256sum -c SHA256SUMS --ignore-missing` on Linux, `Get-FileHash <file>` on Windows.
            - Provenance: `gh attestation verify <file> --repo ${{ github.repository }}`

            Windows SmartScreen may warn about an unsigned app. The README explains what to do.

      - name: Collect files for attestation
        shell: bash
        run: |
          mkdir release-files
          for f in src-tauri/target/release/bundle/*/*; do
            case "$f" in
              *.exe|*.msi|*.AppImage|*.deb|*.rpm) cp "$f" "release-files/$(basename "$f" | tr ' ' '.')" ;;
            esac
          done
          ls -l release-files

      - uses: actions/attest@v4
        with:
          subject-path: release-files/*

      - uses: actions/upload-artifact@v7
        with:
          name: files-${{ runner.os }}
          path: release-files/*
          if-no-files-found: error

  checksums:
    needs: build
    runs-on: ubuntu-24.04
    permissions:
      contents: write
      id-token: write
      attestations: write
      artifact-metadata: write
    steps:
      - uses: actions/download-artifact@v8
        with:
          pattern: files-*
          merge-multiple: true
          path: files

      - name: SHA256SUMS
        working-directory: files
        run: |
          sha256sum * > ../SHA256SUMS
          cat ../SHA256SUMS

      - uses: actions/attest@v4
        with:
          subject-path: SHA256SUMS

      - name: Check names and upload SHA256SUMS to the draft release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAG: ${{ github.ref_name }}
          REPO: ${{ github.repository }}
        run: |
          gh release view "$TAG" --repo "$REPO" --json assets -q '.assets[].name' > assets.txt
          for f in files/*; do
            name="$(basename "$f")"
            grep -qxF "$name" assets.txt || { echo "::error::$name is not among the release files"; exit 1; }
          done
          gh release upload "$TAG" SHA256SUMS --repo "$REPO" --clobber
```

- [ ] **Step 2: Проверка**

Run: та же проверка YAML, что в Task 13, Step 5, для `.github/workflows/release.yml`.
Expected: `ok`.

Проверь, что имена файлов, которые ждёт шаг «Collect files», получаются локально на Windows:
```bash
npm run tauri build
ls "src-tauri/target/release/bundle/nsis" "src-tauri/target/release/bundle/msi"
```
Expected: есть `Rust Skin Stacker_0.1.0_x64-setup.exe` и `Rust Skin Stacker_0.1.0_x64_en-US.msi` (сборка MSI скачивает WiX при первом запуске). Запиши имена в отчёт. Сам релиз проверяется при первом теге на GitHub (Task 17).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: релиз по тегу — установщики, SHA256SUMS и подтверждения происхождения

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: README (EN и RU), LICENSE, снимки окна

**Files:**
- Create: `README.md`, `README.ru.md`, `LICENSE`, `docs/screenshots/main.png`, `docs/screenshots/plan.png`

**Interfaces:**
- Consumes: демо-режим (`?demo=item`, `?demo=plan`), состав релиза из Task 14.
- Produces: страницу проекта.

README по спеке, раздел «Репозиторий, сборка, релизы», содержит:
- что делает приложение и скриншоты;
- как получить токен;
- «Почему этому можно доверять» и как проверить файл;
- что делать с предупреждением SmartScreen;
- «не связано с Valve и Facepunch» и «на свой риск»;
- как собрать из исходников.

Владелец репозитория пока не выбран, поэтому в README нет ссылок с его именем. Команда проверки описана через `<owner>`, а точная команда попадает в описание каждого релиза.

- [ ] **Step 1: Лицензия**

```powershell
Invoke-WebRequest https://www.gnu.org/licenses/gpl-3.0.txt -OutFile LICENSE
Get-Content LICENSE -TotalCount 3
```
Expected: первые строки — `GNU GENERAL PUBLIC LICENSE` и `Version 3, 29 June 2007`.

- [ ] **Step 2: Снимки окна**

Запусти `npm run dev` в фоне. Сними два состояния командой из раздела «Как проверять», сохраняя сразу в репозиторий:
- `?demo=item` → `docs/screenshots/main.png`;
- `?demo=plan` → `docs/screenshots/plan.png`.

Перед снимками проверь, что окно английское: временно поменяй язык через «Настройки» или запусти Chrome с `--lang=en-US`. Названия и картинки на снимках настоящие, количества выдуманные, SteamID — демо `7656…4821`.

Останови Vite.

- [ ] **Step 3: README.md**

````markdown
# Rust Skin Stacker

Split and combine stacks of Rust skins in your Steam inventory. Open source, runs on your computer, for Windows and Linux.

> Not affiliated with Valve or Facepunch. Use at your own risk.

![Main window](docs/screenshots/main.png)

Steam puts identical Rust skins into one inventory entry — "8 × Outlaw Revolver". To sell or trade them one by one, the stack has to be split, and sometimes you want them back in one stack. Rust Skin Stacker does both. It shows the plan before it starts and checks the count of every item afterwards.

## What it does

- **Split all** — every stack becomes single items.
- **Combine all** — identical items go back into one stack.
- **Split off N** — take N single items out of a stack, the rest stays a stack.
- **Selected items** — split or combine only what you picked (Ctrl + click, Shift + click).
- Handles inventories of thousands of items. English and Russian.

![Plan before a run](docs/screenshots/plan.png)

*Item names and pictures in the screenshots are real, quantities are made up.*

## Download

Get the latest version on the **Releases** page of this repository:

| System | File |
|---|---|
| Windows 10/11 | `…_x64-setup.exe` (installer) or `…_x64_en-US.msi` |
| Linux | `….AppImage`, `….deb` (Ubuntu 24.04+, Debian 13+) or `….rpm` (Fedora 40+) |

**Windows SmartScreen** may say the app comes from an unknown publisher: the builds are not code-signed, because a certificate costs money every year. Check the file as described below, then click *More info → Run anyway*.

## Get a token

Instead of your password, the app uses a temporary Steam token.

1. In a browser where you are signed in to Steam, open <https://steamcommunity.com/pointssummary/ajaxgetasyncconfig>. The app has a button for it.
2. Select everything on the page and copy it: Ctrl+A, then Ctrl+C.
3. Paste it into the app. The app finds the token itself and shows which account it belongs to and how long it lasts (about a day).

Do not share the token: until it expires, anyone who has it can act on your account. Never paste it into issues.

## Why you can trust it

- **The token stays in memory.** It lives in the app's Rust core, is never written to disk and never goes back to the window. Close the app and it is gone.
- **Only Steam.** The core talks only to `api.steampowered.com`. The window may load only item pictures from Steam's CDN; the Content Security Policy blocks everything else. No telemetry, no auto-update, no third-party servers.
- **The plan comes first.** Before a run the app shows how many stacks and requests it takes, re-reads the inventory and shows a new plan if something changed.
- **The result is checked.** After a run the app re-reads the inventory and compares the count of every item before and after.
- **Open code, builds on GitHub Actions.** Releases are built from this repository. Every file comes with a provenance attestation and is listed in `SHA256SUMS`.

### Check a downloaded file

```bash
# checksum (Linux; on Windows run Get-FileHash <file> and compare with SHA256SUMS)
sha256sum -c SHA256SUMS --ignore-missing

# provenance: the file was built by GitHub Actions from this repository
gh attestation verify <file> --repo <owner>/rust-skin-stacker
```

`<owner>` is the account in the address of this page. The release notes have the exact command.

## How a run works

- Splitting a stack of A items takes A−1 requests to Steam. "Split off N" takes N requests.
- Combining moves entries of one item into its largest entry. Entries with a different trade status (another `instanceid`) are combined into a stack of their own.
- Requests go one at a time with a pause: 1.5 s by default, 0.5–10 s in Settings. If Steam asks to slow down, the app waits and shows a countdown.
- A run stops after three failures in a row, when Steam stops accepting the token, or when you press Stop (after the current request).
- Steam sometimes merges split items back. Running Split all again is normal.

## Build from source

You need Rust 1.90+, Node.js 22.12+ and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your system.

```bash
npm ci
npm run tauri build
```

Installers appear in `src-tauri/target/release/bundle/`.

For development, `npm run tauri dev` opens the app, and `npm run dev` opens the window in a regular browser in demo mode with made-up data. Tests: `npm test` and `cargo test --manifest-path src-tauri/Cargo.toml`.

## License

[GPL-3.0](LICENSE). Rust is a trademark of Facepunch Studios, Steam is a trademark of Valve Corporation. This project is not affiliated with either.

[Русская версия](README.ru.md)
````

- [ ] **Step 4: README.ru.md**

````markdown
# Rust Skin Stacker

Делит и собирает стопки скинов Rust в инвентаре Steam. Открытый код, работает на вашем компьютере, есть версии для Windows и Linux.

> Не связано с Valve и Facepunch. Пользуйтесь на свой риск.

![Главное окно](docs/screenshots/main.png)

Steam складывает одинаковые скины Rust в одну запись инвентаря, например «8 × Outlaw Revolver». Чтобы продавать или обменивать их по одному, стопку нужно разделить, а иногда — собрать обратно. Rust Skin Stacker умеет и то и другое. До запуска он показывает план, а после операции сверяет количество каждого предмета.

## Что умеет

- **Разделить всё** — каждая стопка станет отдельными предметами.
- **Собрать всё** — одинаковые предметы снова лягут в одну стопку.
- **Отделить N** — достать из стопки N отдельных предметов, остальное останется стопкой.
- **Выбранное** — разделить или собрать только то, что вы отметили (Ctrl + клик, Shift + клик).
- Справляется с инвентарями на тысячи предметов. Интерфейс на русском и английском.

![План перед запуском](docs/screenshots/plan.png)

*Названия и картинки на снимках настоящие, количества выдуманы.*

## Скачать

Последняя версия — на странице **Releases** этого репозитория:

| Система | Файл |
|---|---|
| Windows 10/11 | `…_x64-setup.exe` (установщик) или `…_x64_en-US.msi` |
| Linux | `….AppImage`, `….deb` (Ubuntu 24.04+, Debian 13+) или `….rpm` (Fedora 40+) |

**SmartScreen в Windows** может предупредить, что издатель неизвестен. Это потому, что сборки не подписаны сертификатом: он стоит денег каждый год. Проверьте файл, как описано ниже, и нажмите «Подробнее → Выполнить в любом случае».

## Как получить токен

Вместо пароля приложению нужен временный токен Steam.

1. В браузере, где вы вошли в Steam, откройте <https://steamcommunity.com/pointssummary/ajaxgetasyncconfig>. В приложении для этого есть кнопка.
2. Выделите всё на странице и скопируйте: Ctrl+A, затем Ctrl+C.
3. Вставьте в приложение. Оно само найдёт токен и покажет, от какого он аккаунта и сколько ещё действует (около суток).

Никому не передавайте токен: пока он не истёк, с ним можно действовать от вашего аккаунта. Не вставляйте его в issue.

## Почему этому можно доверять

- **Токен живёт только в памяти.** Он хранится в Rust-ядре приложения, не пишется на диск и не возвращается в окно. Закрыли приложение — токена больше нет.
- **Только Steam.** Ядро обращается только к `api.steampowered.com`. Окну разрешено загружать лишь картинки предметов с CDN Steam, остальное запрещает политика безопасности (CSP). Телеметрии, автообновления и сторонних серверов нет.
- **Сначала план.** Перед запуском приложение показывает, сколько стопок и запросов понадобится. Потом перечитывает инвентарь и, если что-то изменилось, показывает новый план.
- **Результат проверяется.** После операции инвентарь перечитывается, и количество каждого предмета сравнивается с тем, что было.
- **Открытый код, сборки на GitHub Actions.** Релизы собираются из этого репозитория. К каждому файлу приложено подтверждение происхождения, все файлы перечислены в `SHA256SUMS`.

### Как проверить скачанный файл

```bash
# контрольная сумма (Linux; в Windows выполните Get-FileHash <файл> и сравните с SHA256SUMS)
sha256sum -c SHA256SUMS --ignore-missing

# происхождение: файл собран в GitHub Actions из этого репозитория
gh attestation verify <файл> --repo <владелец>/rust-skin-stacker
```

`<владелец>` — аккаунт в адресе этой страницы. Точная команда есть в описании релиза.

## Как идёт операция

- Чтобы разделить стопку из A предметов, нужно A−1 запросов к Steam. «Отделить N» — это N запросов.
- При сборке записи одного предмета переносятся в его самую большую запись. Записи с другим статусом обмена (другой `instanceid`) собираются в отдельную стопку.
- Запросы идут по одному с паузой: по умолчанию 1,5 с, в настройках — от 0,5 до 10 с. Если Steam просит подождать, приложение ждёт и показывает отсчёт.
- Операция останавливается после трёх неудач подряд, когда Steam перестаёт принимать токен, или по кнопке «Остановить» — после текущего запроса.
- Иногда Steam снова склеивает разделённые предметы. Запустить «Разделить всё» ещё раз — нормально.

## Сборка из исходников

Нужны Rust 1.90+, Node.js 22.12+ и [системные зависимости Tauri](https://v2.tauri.app/start/prerequisites/).

```bash
npm ci
npm run tauri build
```

Установщики появятся в `src-tauri/target/release/bundle/`.

Для разработки: `npm run tauri dev` открывает приложение, а `npm run dev` — окно в обычном браузере в демо-режиме с выдуманными данными. Тесты: `npm test` и `cargo test --manifest-path src-tauri/Cargo.toml`.

## Лицензия

[GPL-3.0](LICENSE). Rust — товарный знак Facepunch Studios, Steam — товарный знак Valve Corporation. Проект не связан ни с одной из этих компаний.

[English version](README.md)
````

- [ ] **Step 5: Проверка**

Открой `README.md` и `README.ru.md` в предпросмотре Markdown. Картинки из `docs/screenshots/` видны, ссылки `LICENSE` и `README.*.md` ведут на файлы. В текстах нет реального SteamID, токена и адресов, кроме `steamcommunity.com`, `api.steampowered.com` и `v2.tauri.app`.

- [ ] **Step 6: Commit**

```bash
git add README.md README.ru.md LICENSE docs/screenshots
git commit -m "docs: README на английском и русском, лицензия GPL-3.0, снимки окна

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Живая проверка окна, дизайн-проверка и DESIGN.md

Выполняет контроллер: нужны снимки настоящего окна (computer-use) и скилл impeccable. Исправления по находкам делает субагент-implementer одним списком.

- [ ] **Step 1: Настоящее окно**

1. `npm run tauri build -- --no-bundle`, затем запустить `src-tauri/target/release/rust-skin-stacker.exe`.
2. Снять экран входа через computer-use и проверить, что CSP не мешает: шрифт Manrope, значки Tabler, стили на месте.
3. «Открыть страницу токена» открывает системный браузер ровно на `ajaxgetasyncconfig`.
4. Вставка «hello» показывает текст `error.tokenNotFound`. Он пришёл из Rust через IPC.

Если стили или значки не применились, исправить CSP в `tauri.conf.json`, ничего не открывая сверх нужного.

- [ ] **Step 2: Финальная дизайн-проверка**

Вызвать скилл `impeccable`, режим finish review для канона `0843f683` (code-led). Эталоны:
- `docs/design/main-window-item.png`, `docs/design/main-window-plan.png`;
- `PRODUCT.md`, раздел «Brand Commitments».

Сравнить со снимками демо-режима `?demo=main|item|plan`, экрана входа и настроек. Отдельно проверить анти-цели владельца:
- не похоже на кейс-сайт;
- понятно, что случится;
- не перегружено кнопками;
- похоже на Rust.

Находки уровня Critical и Important передать одним списком субагенту-implementer, затем повторить снимки.

- [ ] **Step 3: DESIGN.md**

По скиллу impeccable записать `DESIGN.md` по тому, что построено:
- токены цветов и размеров;
- шрифт и значки;
- сетка и карточка, панель и её состояния;
- анимации, клавиатура, правила текста.

```bash
git add DESIGN.md src
git commit -m "docs: DESIGN.md по построенному окну

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Финальная проверка ветки**

- Весь набор: `npm run check`, `npm test`, `npm run build`, cargo fmt/clippy/test.
- Финальное ревью всей ветки (`superpowers:requesting-code-review`, самая сильная модель).
- Отдельно security-reviewer по `token.rs`, `steam.rs`, `commands.rs`, `capabilities/default.json`, `tauri.conf.json`, `dom.ts`, получив только код и правила раздела «Steam и токен» из Global Constraints.

Находки исправляет один субагент-fixer. После этого — `superpowers:finishing-a-development-branch`.

---

### Task 17: Ручная проверка на аккаунте владельца

Выполняет владелец. Контроллер готовит сборку и чек-лист, токен не видит.

- [ ] **Step 1: Сборка одной пары** — первая проверка CombineItemStacks:
  1. Запустить `npm run tauri dev` или собранный `.exe`, вставить страницу токена.
  2. Найти скин, у которого две записи по одному с одинаковым статусом обмена: в панели нет пометки «не соберутся».
  3. «Собрать» → план на 1 запрос → «Запустить».
  4. Итог: сверка зелёная, у скина одна запись ×2.

  Если Steam вернул ошибку, скопировать журнал. «Собрать» тогда выйдет отдельной версией, как сказано в спеке, раздел «Риски».
- [ ] **Step 2: «Отделить N»** на стопке: N отдельных предметов, остаток — стопкой, сверка зелёная.
- [ ] **Step 3: «Разделить всё»** на нескольких стопках: ход, «Остановить» в середине, повторный запуск, сверка.
- [ ] **Step 4: Установщики:**
  - на Windows поставить `.msi` и `.exe` из `npm run tauri build`, проверить, что приложение запускается;
  - на Linux (виртуальная машина или WSL с графикой) — `.AppImage` и `.deb` из CI-сборки.
- [ ] **Step 5: GitHub:**
  1. Создать репозиторий `rust-skin-stacker` и включить Private vulnerability reporting.
  2. Отправить `main`. CI зелёный на Windows и Linux.
  3. Тег `v0.1.0`. В черновике релиза пять файлов и `SHA256SUMS`.
  4. `gh attestation verify <файл> --repo <owner>/rust-skin-stacker` проходит.
  5. Опубликовать релиз вручную.

