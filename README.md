# MT DOCS · Рабочее пространство команды MyTanks

Служебное SPA для команды: ежедневные отчёты, учёт блокировок (баны/кики/муты/предупреждения), личный кабинет, одобрение заявок руководителем.

**Стек:** ванильный JS + Supabase (auth, Postgres, RLS). Без сборки — статические файлы.

## Структура

```
index.html            разметка, CSP, SVG-иконки, диалоги
app.js                вся логика (роутинг на хэшах, формы, Supabase)
styles.css            тёмная тема
config.js             публичный URL и publishable-ключ Supabase, ссылка на форму отчётов
vendor/supabase.js    supabase-js 2.119.1 (вендорен локально)
favicon*, *.png, mytanks-avatar.jpg   иконки и аватар
.nojekyll             отключает Jekyll на GitHub Pages
```

## Публикация (GitHub Pages)

Сайт полностью статический, все пути относительные — работает в подпапке репозитория.
Адрес: `https://service-mytanks.github.io/MT-DOCS-Admin-Panel-Team-Workspace/`
Репозиторий: `Service-MyTanks/MT-DOCS-Admin-Panel-Team-Workspace` (публичный).

1. Содержимое этой папки лежит в корне репозитория (ветка `main`).
2. Settings → Pages → Source: **Deploy from a branch**, Branch: `main`, папка `/ (root)`.
3. **Supabase → Authentication → URL Configuration → Redirect URLs** — добавить адрес сайта, иначе письма подтверждения/восстановления не будут редиректить на приложение.

## Список должностей

Иерархия из 6 уровней, 24 должности. Список задан в **двух местах** и должен совпадать:

- `index.html` — `<select id="register-position">` (optgroup по уровням);
- `app.js` — константа `POSITIONS` (валидация при регистрации).

Если на `profiles.position` в БД есть CHECK-ограничение — обновите и его (см. `supabase-migration.sql` в материалах проекта).

## Безопасность

- Publishable-ключ Supabase публичный по дизайну; данные защищает RLS (анонимному доступ закрыт полностью).
- CSP через `<meta>`, без inline-скриптов; пользовательский ввод только через `textContent`.
- Админ-действия — через RPC `set_account_status` с серверной проверкой прав.
- Регистрация ≠ доступ: заявка проходит подтверждение почты и одобрение руководителем.
