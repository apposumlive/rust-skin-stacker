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
