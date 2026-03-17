# NeoMarket // Grid Ops Terminal

Дашборд практикума NeoMarket — read-only витрина для ~174 студентов, 40 команд, 3 синдикатов.

**Live:** [urfu2026-neomarket.github.io/neomarket-dashboard](https://urfu2026-neomarket.github.io/neomarket-dashboard/)

## Что показывает

- **Leaderboard** — рейтинг 40 команд по суммарной Rep
- **Syndicates** — составы Forge / Interface / QA Corps
- **Search** — личная карточка участника (Rep, Credits, ранг, достижения, транзакции)
- **Hero block** — персонализированный обзор «моей команды» (localStorage)
- **Sprint context** — текущий спринт, дельта Rep за спринт

## Горячие клавиши

| Клавиша | Действие |
|---------|----------|
| `S` | Syndicates |
| `L` | Leaderboard |
| `/` | Search (фокус на поиск) |
| `Esc` | Закрыть модалку / сбросить поиск |

## Стек

Статика: HTML + vanilla JS + CSS. Без фреймворков, без сборки.
Хостинг: GitHub Pages.
Данные: JSON-файлы в `data/`.

## Стилистика

Cyberpunk-lite: тёмный фон, неоновые акценты (cyan/magenta/green), JetBrains Mono.

## Обновление данных

Данные публикуются из приватного репозитория `plan/` через скрипт. При публикации удаляется поле `captain_tg` из roster.json.
