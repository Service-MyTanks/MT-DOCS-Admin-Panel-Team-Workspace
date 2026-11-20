"use strict";

const config = window.MT_CONFIG || {};
const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_SANCTION_MINUTES = 5_256_000;

const KINDS = {
  ban: { title: "Мои баны", one: "Бан", add: "Добавить бан", icon: "i-ban", duration: true, permanent: true, hint: "Блокировка аккаунта на срок или навсегда" },
  kick: { title: "Мои кики", one: "Кик", add: "Добавить кик", icon: "i-kick", hint: "Принудительное отключение с сервера" },
  mute: { title: "Мои муты", one: "Мут", add: "Добавить мут", icon: "i-mute", duration: true, hint: "Ограничение чата на срок" },
  warning: { title: "Мои предупреждения", one: "Предупреждение", add: "Добавить предупреждение", icon: "i-warning", hint: "Устные и письменные предупреждения" },
};

// Единый список должностей (иерархия из 6 уровней). Должен совпадать с <select id="register-position"> в index.html.
const POSITIONS = Object.freeze([
  "Младший Хелпер", "Хелпер",
  "Младший модератор", "Модератор", "Старший модератор", "Администратор", "Старший администратор",
  "Тестировщик", "Медиа-продакшн", "Технический специалист", "Следящий за форумом", "Старший следящий за форумом", "Следящий за битвами", "Старший следящий за битвами",
  "Зам.куратора технических специалистов", "Куратор технических специалистов", "Зам куратора администрации", "Куратор администрации", "Заместитель Куратора Агентов Поддержки", "Куратор Агентов Поддержки",
  "Заместитель главного администратора", "Главный администратор",
  "Заместитель Специального Администратора", "Специальный Администратор",
]);

const state = { client: null, session: null, profile: null, renderId: 0, sanctionKind: "ban", recovery: false };

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  el.append(...children.flat().filter((child) => child != null && child !== false));
  return el;
}

function icon(name, className) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  if (className) svg.setAttribute("class", className);
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#${name}`);
  svg.append(use);
  return svg;
}

function isHttpUrl(text) {
  try {
    const url = new URL(text);
    return /^https?:\/\//i.test(text) && ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !/\s/.test(text);
  } catch {
    return false;
  }
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function formatDuration(minutes, permanent) {
  if (permanent) return "Навсегда";
  if (!minutes) return "—";
  if (minutes % 1440 === 0) { const d = minutes / 1440; return `${d} ${plural(d, "день", "дня", "дней")}`; }
  if (minutes % 60 === 0) { const hrs = minutes / 60; return `${hrs} ${plural(hrs, "час", "часа", "часов")}`; }
  return `${minutes} мин`;
}

const dateTimeFormat = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const formatDateTime = (iso) => dateTimeFormat.format(new Date(iso));
const formatDate = (isoDate) => { const [y, m, d] = String(isoDate).split("-"); return d ? `${d}.${m}.${y}` : String(isoDate); };

function localDateTimeValue(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

let toastTimer;
function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
}

function setMessage(id, text, kind = "error") {
  const el = $(id);
  el.textContent = text || "";
  el.dataset.kind = kind;
  el.hidden = !text;
}

function friendlyError(error) {
  const message = String(error?.message || error || "");
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) return "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.";
  if (/invalid login credentials/i.test(message)) return "Неверная почта или пароль.";
  if (/email not confirmed/i.test(message)) return "Почта не подтверждена. Откройте письмо от MT DOCS и перейдите по ссылке.";
  if (/database error saving new user/i.test(message)) return "Не удалось создать аккаунт: никнейм уже занят или данные некорректны. Если повторяется — сообщите руководителю.";
  if (/user already registered/i.test(message)) return "Аккаунт с этой почтой уже существует. Войдите или восстановите пароль.";
  if (/password should be at least|weak password/i.test(message)) return "Пароль слишком простой. Используйте не менее 8 символов.";
  if (/rate limit|too many requests|over_email_send_rate_limit/i.test(message)) return "Слишком много попыток. Подождите несколько минут и повторите.";
  if (/same.*password|different from the old/i.test(message)) return "Новый пароль должен отличаться от текущего.";
  if (/profiles_nickname_key|duplicate key value violates unique constraint/i.test(message)) return "Этот никнейм уже занят.";
  if (/row-level security|permission denied|недостаточно прав|42501/i.test(message)) return "Недостаточно прав для этого действия.";
  return message ? `Ошибка: ${message.slice(0, 300)}` : "Произошла неизвестная ошибка.";
}

function setBusy(button, busy, label) {
  if (busy) { button.dataset.label = button.innerHTML; button.disabled = true; button.textContent = label || "Подождите…"; }
  else if (button.dataset.label != null) { button.disabled = false; button.innerHTML = button.dataset.label; delete button.dataset.label; }
}

function showScreen(name) {
  $("boot-view").hidden = name !== "boot";
  $("auth-view").hidden = !["login", "gate", "recovery"].includes(name);
  $("app-view").hidden = name !== "app";
  $("login-panel").hidden = name !== "login";
  $("gate-panel").hidden = name !== "gate";
  $("recovery-panel").hidden = name !== "recovery";
}

function showGate({ title, text, iconName = "i-clock", actions = true }) {
  $("gate-title").textContent = title;
  $("gate-text").textContent = text;
  $("gate-icon").replaceChildren(icon(iconName));
  $("gate-actions").hidden = !actions;
  showScreen("gate");
}

function selectTab(name) {
  const login = name === "login";
  $("tab-login").setAttribute("aria-selected", String(login));
  $("tab-register").setAttribute("aria-selected", String(!login));
  $("login-form").hidden = !login;
  $("register-form").hidden = login;
  setMessage("login-message", "");
  setMessage("register-message", "");
}

async function loadProfile() {
  const { data, error } = await state.client.from("profiles").select("*").eq("id", state.session.user.id).maybeSingle();
  if (error) throw error;
  return data;
}

async function enterWorkspace() {
  if (!state.session) { showScreen("login"); return; }
  if (state.recovery) { showScreen("recovery"); return; }
  let profile;
  try {
    profile = await loadProfile();
  } catch (error) {
    showGate({ title: "Не удалось загрузить профиль", text: friendlyError(error), iconName: "i-warning" });
    return;
  }
  state.profile = profile;
  if (!profile) {
    showGate({ title: "Профиль не найден", text: "Аккаунт есть, но профиль сотрудника не создан. Обратитесь к руководителю.", iconName: "i-warning" });
  } else if (profile.status === "pending") {
    showGate({ title: "Заявка на рассмотрении", text: `${profile.nickname}, ваша заявка на должность «${profile.position}» отправлена. Доступ откроется после одобрения руководителем.` });
  } else if (profile.status === "rejected") {
    showGate({ title: "Доступ закрыт", text: "Руководитель отклонил заявку или отозвал доступ. Если это ошибка, свяжитесь с руководством проекта.", iconName: "i-ban" });
  } else {
    $("sidebar-nickname").textContent = profile.nickname;
    $("sidebar-position").textContent = profile.position;
    updateAvatarImages();
    $("topbar-nickname").textContent = profile.nickname;
    showScreen("app");
    if (!parseRoute()) location.replace("#/reports");
    else render();
    refreshPendingBadge();
  }
}

function avatarPublicUrl(path) {
  if (!path) return "./mytanks-avatar.jpg";
  const result = state.client.storage.from("avatars").getPublicUrl(path);
  return result.data.publicUrl + "?v=" + encodeURIComponent(state.profile?.updated_at || Date.now());
}
function updateAvatarImages() {
  const src = avatarPublicUrl(state.profile?.avatar_path);
  document.querySelectorAll(".team-avatar, .topbar-avatar").forEach((image) => { image.src = src; });
}
async function refreshPendingBadge() {
  const badge = $("pending-badge");
  if (!state.profile?.is_admin) { badge.hidden = true; return; }
  const { count, error } = await state.client.from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending");
  badge.hidden = error || !count;
  badge.textContent = count ? String(count) : "";
}

function parseRoute() {
  const path = location.hash.replace(/^#/, "");
  if (path === "/reports") return { page: "reports", crumbs: [["Отчёты"]] };
  if (path === "/reports/mine") return { page: "my-reports", crumbs: [["Отчёты", "#/reports"], ["Мои отчёты"]] };
  if (path === "/blocks") return { page: "blocks", crumbs: [["Мониторинг игры"], ["Блокировки"]] };
  const match = path.match(/^\/blocks\/(ban|kick|mute|warning)$/);
  if (match) return { page: "sanctions", kind: match[1], crumbs: [["Мониторинг игры"], ["Блокировки", "#/blocks"], [KINDS[match[1]].title]] };
  if (path === "/account") return { page: "account", crumbs: [["Личный кабинет"]] };
  const training = {
    "/training/gameplay": "Игровой процесс",
    "/training/forum": "Работа с форумом",
    "/training/community": "Работа с сообществом",
    "/training/administration": "Административный аппарат"
  }[path];
  if (training) return { page: "training", section: training, sectionKey: path.split("/").pop(), crumbs: [["Обучение"], [training]] };
  return null;
}

function setChrome(route) {
  const nav = { reports: "reports", "my-reports": "reports", blocks: "blocks", sanctions: "blocks", account: "account", training: "training" }[route.page];
  for (const link of document.querySelectorAll("[data-nav]")) {
    const active = link.dataset.nav === nav;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  }
  for (const link of document.querySelectorAll("[data-training-nav]")) {
    const active = route.page === "training" && link.dataset.trainingNav === route.sectionKey;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  }
  $("breadcrumb").replaceChildren(...route.crumbs.flatMap(([label, href], index) => {
    const last = index === route.crumbs.length - 1;
    const node = last ? h("strong", { text: label }) : href ? h("a", { href, text: label }) : h("span", { class: "crumb", text: label });
    return index ? [h("span", { class: "crumb-sep", text: "/" }), node] : [node];
  }));
  const titles = { reports: "Отчётность", "my-reports": "Мои отчёты", blocks: "Блокировка", sanctions: KINDS[route.kind]?.title, account: "Личный кабинет", training: route.section };
  document.title = `${titles[route.page]} · MT DOCS`;
  closeSidebar();
}

function pageHeading(eyebrow, title, text, ...actions) {
  return h("div", { class: "page-heading" },
    h("div", {}, h("div", { class: "eyebrow" }, h("span"), eyebrow), h("h1", {}, title, h("span", { text: "." })), text ? h("p", { text }) : null),
    actions.length ? h("div", { class: "heading-actions" }, ...actions) : null);
}

function rowLink({ href, iconName, title, text, meta, external }) {
  return h("a", { class: "row-link", href, target: external ? "_blank" : null, rel: external ? "noopener noreferrer" : null },
    h("span", { class: "row-icon" }, icon(iconName)),
    h("span", { class: "row-text" }, h("strong", { text: title }), h("small", { text })),
    meta != null ? h("span", { class: "row-meta", text: meta }) : null,
    icon(external ? "i-external" : "i-chevron", "row-arrow"));
}

function loadingBlock() { return h("div", { class: "loading", role: "status" }, h("span", { class: "spinner" }), "Загружаем данные…"); }
function errorBlock(error, retry) {
  return h("div", { class: "empty-state error" }, icon("i-warning"), h("strong", { text: "Не удалось загрузить данные" }), h("p", { text: friendlyError(error) }),
    h("button", { type: "button", class: "button button-secondary", onclick: retry }, icon("i-refresh"), "Повторить"));
}
function emptyBlock(iconName, title, text, action) {
  return h("div", { class: "empty-state" }, icon(iconName), h("strong", { text: title }), h("p", { text }), action || null);
}

function newReportLink(className = "button button-primary") {
  return h("a", { class: className, href: config.reportsUrl, target: "_blank", rel: "noopener noreferrer" }, icon("i-plus"), "Новый отчёт");
}

async function render() {
  const route = parseRoute();
  if (!route || !state.profile) return;
  const id = ++state.renderId;
  const view = $("view");
  const current = () => id === state.renderId;
  setChrome(route);
  view.replaceChildren();
  const renderers = { reports: renderReports, "my-reports": renderMyReports, blocks: renderBlocks, sanctions: renderSanctions, account: renderAccount, training: renderTraining };
  await renderers[route.page](view, route, current);
  if (current()) view.focus({ preventScroll: true });
}

async function renderTraining(view, route) {
  if (route.sectionKey !== "administration") {
    view.append(
      pageHeading("БАЗА ЗНАНИЙ", route.section, "Обучающие материалы для команды MyTanks."),
      h("section", { class: "card" },
        emptyBlock("i-doc", "Материалы скоро появятся", "Этот раздел уже подготовлен. Содержимое будет добавлено позднее.")
      )
    );
    return;
  }

  const forum = "https://forum.mytanks.net/index.php";
  const links = {
    positions: forum + "?threads/ЗНАЧЕНИЕ-ДОЛЖНОСТЕЙ-В-ИЕРАРХИИ.1167/",
    hierarchy: forum + "?threads/📊-ОФИЦИАЛЬНАЯ-ТАБЛИЦА-ИЕРАРХИИ-ДОЛЖНОСТЕЙ-ПРОЕКТА-mytanks.1281/",
    rewards: forum + "?threads/Система-нормативов-и-вознаграждений.1311/",
    playerRules: forum + "?threads/🚜-ОБЩИЕ-ПРАВИЛА-ЗАПРЕТЫ-И-НАКАЗАНИЯ-ДЛЯ-ИГРОКОВ-СЕРВЕРА-mytanks.1198/",
    helperRules: forum + "?threads/📑-ПРАВИЛА-И-ОБЯЗАННОСТИ-ХЭЛПЕРОВ-mytanks.1186/",
    adminRules: forum + "?threads/📑-ПРАВИЛА-И-ОБЯЗАННОСТИ-АДМИНИСТРАЦИИ-mytanks.1185/",
    textAttestation: forum + "?forums/Регламент-текстовой-аттестации.64/",
    audioMeeting: forum + "?forums/Регламент-аудиосозвона.63/",
    applications: forum + "?forums/SHABLONY-ZAYAVLENIY/",
    requests: forum + "?forums/SHABLONY-FORM-I-PROSHENIYA/"
  };

  const card = (title, description, iconName, items, note) => h("section", { class: "card" },
    h("div", { class: "card-heading" },
      h("span", { class: "section-icon" }, icon(iconName)),
      h("div", {}, h("h2", { text: title }), h("p", { text: description }))),
    h("div", { class: "row-list" }, ...items),
    note ? h("p", { class: "training-explainer", text: note }) : null
  );

  view.append(
    pageHeading("ОБУЧЕНИЕ СОТРУДНИКОВ", route.section, "Последовательная подготовка к работе в административном аппарате MyTanks."),
    card("1. Начальный этап — Знакомство со структурой", "Изучите иерархию проекта, значения должностей и систему нормативов.", "i-book-open", [
      rowLink({ href: links.positions, iconName: "i-doc", title: "Значение должностей", text: "Первый обязательный материал для каждого новичка — знакомство с иерархией и смыслом должностей.", external: true }),
      rowLink({ href: links.hierarchy, iconName: "i-doc", title: "Официальная таблица иерархий и должностей", text: "Актуальная таблица должностей и структуры проекта MyTanks.", external: true }),
      rowLink({ href: links.rewards, iconName: "i-check", title: "Система нормативов и вознаграждений", text: "Нормативы работы сотрудников и предусмотренные вознаграждения.", external: true })
    ]),
    card("2. Промежуточный этап — Работа с обращениями", "Изучите правила проекта и обязанности сотрудников перед началом самостоятельной работы.", "i-message", [
      rowLink({ href: links.playerRules, iconName: "i-shield", title: "Правила для игроков", text: "Общие правила, запреты и наказания на сервере MyTanks.", external: true }),
      rowLink({ href: links.helperRules, iconName: "i-user", title: "Правила для агентов поддержки (хелперов)", text: "Обязанности и правила работы агентов поддержки.", external: true }),
      rowLink({ href: links.adminRules, iconName: "i-shield", title: "Правила для администрации проекта", text: "Регламент работы и обязанности администрации.", external: true })
    ], "Работа с обращениями подразумевает ответы на темы игроков в соответствующих ветках форума, таких как:\n\n1. Ветка «Жалобы»: только жалобы на игроков.\n2. Ветка «Обсуждение игры».\n3. Ветка «Вопрос & Ответ».\n4. Ветка «Идеи и Предложения».\n5. Ветка «Проблемы и Решения».\n6. Ветка «Предложения по улучшению».\n\nЗона вашей ответственности разграничивается в строгом соответствии с вашей должностью, должностные обязанности которой описаны в разделе «Значение должностей». Вы также можете запросить подробное описание у Главного Администратора, Специального Администратора и их заместителей. К примеру, Хелпер не несёт ответственность за ветку «Идеи и Предложения», зато отвечает за «Вопрос & Ответ». Остальные вопросы вы можете задать вышеперечисленным людям. Удачи!"),
    card("3. Финальный этап — Регламенты", "Порядок приёма кандидатов и прохождения аттестации.", "i-clipboard", [
      rowLink({ href: links.textAttestation, iconName: "i-doc", title: "Регламент текстовой аттестации", text: "Раздел с правилами и материалами текстовой аттестации.", external: true }),
      rowLink({ href: links.audioMeeting, iconName: "i-message", title: "Регламент аудиосозвона", text: "Раздел с правилами проведения аудиосозвона.", external: true })
    ], "Обязательно изучите все темы, содержащиеся в этих разделах!"),
    card("3. Финальный этап — Шаблоны заявлений и форм прошения", "Используйте утверждённые шаблоны при подаче заявлений и обращений.", "i-file-text", [
      rowLink({ href: links.applications, iconName: "i-doc", title: "Шаблоны заявлений", text: "Утверждённые формы заявлений.", external: true }),
      rowLink({ href: links.requests, iconName: "i-check", title: "Шаблоны форм прошения", text: "Утверждённые формы прошений.", external: true })
    ])
  );
}

async function countRows(table, filters = {}) {
  let query = state.client.from(table).select("id", { count: "exact", head: true }).eq("user_id", state.session.user.id);
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function renderReports(view, route, current) {
  const mine = rowLink({ href: "#/reports/mine", iconName: "i-doc", title: "Мои отчёты", text: "История ваших ежедневных отчётов", meta: "…" });
  view.append(
    pageHeading("ОТЧЁТНОСТЬ", "Отчётность", "Ежедневные отчёты команды MyTanks."),
    h("section", { class: "card" }, h("div", { class: "row-list" }, mine,
      rowLink({ href: config.reportsUrl, iconName: "i-plus", title: "Новый отчёт", text: "Откроется форма MT DOCS в новой вкладке", external: true }))));
  try {
    const count = await countRows("reports");
    if (current()) mine.querySelector(".row-meta").textContent = String(count);
  } catch {
    if (current()) mine.querySelector(".row-meta").textContent = "—";
  }
}

async function renderMyReports(view, route, current) {
  const body = h("section", { class: "card" }, loadingBlock());
  view.append(pageHeading("ОТЧЁТНОСТЬ", "Мои отчёты", "Отчёты, отправленные через форму MT DOCS во время входа в рабочее пространство.", newReportLink()), body);
  const { data, error } = await state.client.from("reports").select("id, report_date, position, online_minutes, report_count, subject, body, screenshots, created_at")
    .eq("user_id", state.session.user.id).order("report_date", { ascending: false }).order("created_at", { ascending: false }).limit(200);
  if (!current()) return;
  if (error) { body.replaceChildren(errorBlock(error, render)); return; }
  if (!data.length) {
    body.replaceChildren(emptyBlock("i-doc", "Отчётов пока нет", "Войдите в рабочее пространство в этом браузере и отправьте отчёт через форму MT DOCS — копия появится здесь.", newReportLink("button button-secondary")));
    return;
  }
  body.replaceChildren(h("div", { class: "table" },
    h("div", { class: "table-head", "aria-hidden": "true" }, h("span", { text: "Дата" }), h("span", { text: "Должность" }), h("span", { text: "Онлайн" }), h("span", { text: "Репорты" }), h("span")),
    ...data.map((report) => h("button", { type: "button", class: "table-row", onclick: () => openReport(report) },
      h("span", { class: "cell-strong", "data-label": "Дата", text: formatDate(report.report_date) }),
      h("span", { "data-label": "Должность", text: report.position }),
      h("span", { "data-label": "Онлайн", text: `${report.online_minutes} мин` }),
      h("span", { "data-label": "Репорты", text: String(report.report_count) }),
      icon("i-chevron", "row-arrow")))));
}

function openReport(report) {
  $("report-dialog-date").textContent = `ОТЧЁТ ЗА ${formatDate(report.report_date)}`;
  $("report-dialog-title").textContent = report.subject || "Ежедневный отчёт";
  $("report-dialog-body").textContent = report.body;
  $("report-dialog-links").replaceChildren(...(report.screenshots || []).filter(isHttpUrl).map((url, index) =>
    h("a", { class: "attachment-chip", href: url, target: "_blank", rel: "noopener noreferrer" }, icon("i-external"), `Скриншот ${index + 1}`)));
  $("report-dialog").showModal();
}

async function renderBlocks(view, route, current) {
  const rows = Object.entries(KINDS).map(([kind, info]) => rowLink({ href: `#/blocks/${kind}`, iconName: info.icon, title: info.title, text: info.hint, meta: "…" }));
  view.append(
    pageHeading("МОНИТОРИНГ ИГРЫ", "Блокировка", "Учёт наказаний, выданных вами в игре."),
    h("section", { class: "card" }, h("div", { class: "card-heading" }, h("span", { class: "section-icon" }, icon("i-lock")), h("div", {}, h("h2", { text: "Мои блокировки" }), h("p", { text: "Баны, кики, муты и предупреждения" }))),
      h("div", { class: "row-list" }, ...rows)));
  const counts = await Promise.allSettled(Object.keys(KINDS).map((kind) => countRows("sanctions", { kind })));
  if (!current()) return;
  counts.forEach((result, index) => { rows[index].querySelector(".row-meta").textContent = result.status === "fulfilled" ? String(result.value) : "—"; });
}

async function renderSanctions(view, route, current) {
  const info = KINDS[route.kind];
  const body = h("section", { class: "card" }, loadingBlock());
  const addButton = h("button", { type: "button", class: "button button-primary", onclick: () => openSanctionDialog(route.kind) }, icon("i-plus"), info.add);
  view.append(pageHeading("МОИ БЛОКИРОВКИ", info.title, info.hint + ".", addButton), body);
  const { data, error } = await state.client.from("sanctions").select("*")
    .eq("user_id", state.session.user.id).eq("kind", route.kind).order("issued_at", { ascending: false }).limit(500);
  if (!current()) return;
  if (error) { body.replaceChildren(errorBlock(error, render)); return; }
  if (!data.length) {
    body.replaceChildren(emptyBlock(info.icon, "Записей пока нет", `Здесь появятся ваши записи: ${info.title.toLowerCase().replace("мои ", "")}.`,
      h("button", { type: "button", class: "button button-secondary", onclick: () => openSanctionDialog(route.kind) }, icon("i-plus"), info.add)));
    return;
  }
  body.replaceChildren(h("div", { class: "record-list" }, ...data.map((item) => h("article", { class: "record" },
    h("div", { class: "record-main" },
      h("div", { class: "record-title" }, h("strong", { text: item.player_nickname }), info.duration ? h("span", { class: `pill${item.is_permanent ? " pill-danger" : ""}`, text: formatDuration(item.duration_minutes, item.is_permanent) }) : null),
      h("p", { class: "record-reason", text: item.reason }),
      item.comment ? h("p", { class: "record-comment", text: item.comment }) : null,
      h("div", { class: "record-meta" }, h("span", {}, icon("i-clock"), formatDateTime(item.issued_at)),
        item.evidence_url && isHttpUrl(item.evidence_url) ? h("a", { href: item.evidence_url, target: "_blank", rel: "noopener noreferrer" }, icon("i-external"), "Доказательства") : null)),
    h("button", { type: "button", class: "icon-button danger", "aria-label": `Удалить запись о ${item.player_nickname}`, title: "Удалить", onclick: () => deleteSanction(item) }, icon("i-close"))))));
}

function openSanctionDialog(kind) {
  const info = KINDS[kind];
  state.sanctionKind = kind;
  const form = $("sanction-form");
  form.reset();
  $("sanction-title").textContent = info.add;
  $("sanction-issued").value = localDateTimeValue();
  $("sanction-issued").max = localDateTimeValue();
  $("duration-field").hidden = !info.duration;
  $("permanent-label").hidden = !info.permanent;
  $("sanction-duration").disabled = false;
  $("sanction-unit").disabled = false;
  $("sanction-unit").value = kind === "mute" ? "60" : "1440";
  setMessage("sanction-message", "");
  $("sanction-dialog").showModal();
  $("sanction-player").focus();
}

function readSanction() {
  const info = KINDS[state.sanctionKind];
  const player = $("sanction-player").value.trim();
  const reason = $("sanction-reason").value.trim();
  const evidence = $("sanction-evidence").value.trim();
  const comment = $("sanction-comment").value.trim();
  const issuedValue = $("sanction-issued").value;
  const issued = issuedValue ? new Date(issuedValue) : null;
  if (!player) return { error: "Укажите ник нарушителя.", focus: "sanction-player" };
  if (!issued || Number.isNaN(issued.getTime())) return { error: "Укажите дату и время.", focus: "sanction-issued" };
  if (issued.getTime() > Date.now() + 60_000) return { error: "Дата не может быть в будущем.", focus: "sanction-issued" };
  if (!reason) return { error: "Укажите причину.", focus: "sanction-reason" };
  const permanent = Boolean(info.permanent && $("sanction-permanent").checked);
  let duration = null;
  if (info.duration && !permanent) {
    const amount = Number($("sanction-duration").value);
    if (!Number.isInteger(amount) || amount < 1) return { error: "Укажите срок целым числом больше нуля.", focus: "sanction-duration" };
    duration = amount * Number($("sanction-unit").value);
    if (duration > MAX_SANCTION_MINUTES) return { error: "Срок не может превышать 10 лет. Для бессрочного бана отметьте «Навсегда».", focus: "sanction-duration" };
  }
  if (evidence && !isHttpUrl(evidence)) return { error: "Ссылка должна начинаться с http:// или https:// и не содержать пробелов.", focus: "sanction-evidence" };
  return { row: { kind: state.sanctionKind, user_id: state.session.user.id, player_nickname: player, reason, duration_minutes: duration, is_permanent: permanent, evidence_url: evidence || null, comment: comment || null, issued_at: issued.toISOString() } };
}

async function submitSanction(event) {
  event.preventDefault();
  const result = readSanction();
  if (result.error) { setMessage("sanction-message", result.error); $(result.focus).focus(); return; }
  const button = $("sanction-submit");
  setBusy(button, true, "Сохраняем…");
  const { error } = await state.client.from("sanctions").insert(result.row);
  setBusy(button, false);
  if (error) { setMessage("sanction-message", friendlyError(error)); return; }
  $("sanction-dialog").close();
  showToast(`${KINDS[state.sanctionKind].one}: запись сохранена.`);
  render();
}

function confirmAction(title, text, okLabel = "Подтвердить") {
  return new Promise((resolve) => {
    const dialog = $("confirm-dialog");
    $("confirm-title").textContent = title;
    $("confirm-text").textContent = text;
    $("confirm-ok").textContent = okLabel;
    const ok = () => { cleanup(); dialog.close(); resolve(true); };
    const close = () => { cleanup(); resolve(false); };
    const cleanup = () => { $("confirm-ok").removeEventListener("click", ok); dialog.removeEventListener("close", close); };
    $("confirm-ok").addEventListener("click", ok);
    dialog.addEventListener("close", close);
    dialog.showModal();
  });
}

async function deleteSanction(item) {
  if (!await confirmAction("Удалить запись?", `Запись о «${item.player_nickname}» будет удалена без возможности восстановления.`, "Удалить")) return;
  const { data, error } = await state.client.from("sanctions").delete().eq("id", item.id).select("id");
  if (error || !data?.length) { showToast(error ? friendlyError(error) : "Запись не удалена: недостаточно прав."); return; }
  showToast("Запись удалена.");
  render();
}

async function renderAccount(view, route, current) {
  const profile = state.profile;
  const avatar = h("img", { class: "profile-avatar", src: avatarPublicUrl(profile.avatar_path), alt: "Аватар " + profile.nickname, width: 64, height: 64 });
  const avatarInput = h("input", { type: "file", id: "avatar-file", accept: "image/png,image/jpeg,image/webp", hidden: true });
  const uploadButton = h("button", { type: "button", class: "button button-secondary small", disabled: true }, "Загрузить аватар");
  const removeButton = h("button", { type: "button", class: "button button-secondary small", disabled: !profile.avatar_path }, "Удалить");
  const avatarActions = h("div", { class: "avatar-actions" }, avatarInput, h("button", { type: "button", class: "button button-secondary small", onclick: () => avatarInput.click() }, "Выбрать изображение"), uploadButton, removeButton, h("small", { class: "muted", text: "PNG, JPG или WebP. До 2 МБ после обработки; изображение будет обрезано до квадрата." }));
  avatarInput.addEventListener("change", () => {
    const file = avatarInput.files?.[0]; if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) { showToast("Выберите PNG, JPG или WebP размером до 8 МБ."); avatarInput.value = ""; return; }
    const reader = new FileReader(); reader.onload = () => { avatar.src = String(reader.result); uploadButton.disabled = false; }; reader.readAsDataURL(file);
  });
  uploadButton.addEventListener("click", () => uploadAvatar(avatarInput.files?.[0], uploadButton));
  removeButton.addEventListener("click", () => removeAvatar(removeButton));
  const info = (label, value) => h("div", { class: "info-item" }, h("small", { text: label }), h("strong", { text: value }));
  view.append(pageHeading("ПРОФИЛЬ СОТРУДНИКА", "Личный кабинет", "Ваши данные и настройки доступа.",
    h("button", { type: "button", class: "button button-secondary", onclick: openAccountSettings }, icon("i-shield"), "Настройки аккаунта"),
    h("button", { type: "button", class: "button button-secondary", onclick: logout }, icon("i-logout"), "Выйти")),
    h("section", { class: "card" }, h("div", { class: "profile-head" }, avatar, h("div", { class: "profile-identity" }, h("h2", { text: profile.nickname }), h("p", { class: "muted", text: profile.position }), avatarActions), h("span", { class: "pill pill-success", text: profile.is_admin ? "Руководитель" : "Доступ открыт" })),
      h("div", { class: "info-grid" }, info("Почта", state.session.user.email || profile.email), info("Должность", profile.position), info("Аккаунт создан", formatDateTime(profile.created_at)), info("Одобрен", profile.reviewed_at ? formatDateTime(profile.reviewed_at) : "—")),
      h("p", { class: "card-note", text: "Никнейм, почту и пароль можно изменить в настройках аккаунта. Должность и права доступа изменяются только руководителем." })));
  if (profile.is_admin) await renderAdmin(view, current);
}

function openAccountSettings() {
  const email = String(state.session?.user?.email || "").trim();
  const locked = email.toLowerCase() === "supportmytanks@gmail.com";
  $("settings-current-email").textContent = email || "—"; $("settings-new-email").value = "";
  $("settings-new-email").disabled = locked; $("settings-email-submit").disabled = locked;
  $("settings-email-locked").hidden = !locked;
  $("settings-email-message").hidden = true; $("settings-nickname-message").hidden = true; $("settings-password-message").hidden = true;
  $("settings-nickname").value = state.profile?.nickname || ""; $("account-settings-dialog").showModal();
}

async function changeNickname(event) {
  event.preventDefault(); const nickname = $("settings-nickname").value.trim();
  if (nickname.length < 2 || nickname.length > 64) { setMessage("settings-nickname-message", "Никнейм должен содержать от 2 до 64 символов."); return; }
  const button = $("settings-nickname-submit"); setBusy(button, true, "Сохраняем…");
  const { error } = await state.client.rpc("update_own_nickname", { new_nickname: nickname }); setBusy(button, false);
  if (error) { setMessage("settings-nickname-message", friendlyError(error)); return; }
  state.profile = await loadProfile(); $("sidebar-nickname").textContent = state.profile.nickname; $("topbar-nickname").textContent = state.profile.nickname;
  setMessage("settings-nickname-message", "Никнейм обновлён.", "success"); showToast("Никнейм успешно изменён."); render();
}

async function requestEmailChange(event) {
  event.preventDefault(); const current = String(state.session?.user?.email || "").trim().toLowerCase(); const email = $("settings-new-email").value.trim().toLowerCase();
  if (current === "supportmytanks@gmail.com") { setMessage("settings-email-message", "Для этого аккаунта смена почты отключена."); return; }
  if (!$("settings-new-email").checkValidity() || !email) { setMessage("settings-email-message", "Введите корректный новый адрес почты."); return; }
  if (email === current) { setMessage("settings-email-message", "Новая почта совпадает с текущей."); return; }
  if (email === "supportmytanks@gmail.com") { setMessage("settings-email-message", "Этот адрес закреплён за служебным аккаунтом."); return; }
  const button = $("settings-email-submit"); setBusy(button, true, "Отправляем…");
  const { error } = await state.client.auth.updateUser({ email }, { emailRedirectTo: appUrl() }); setBusy(button, false);
  if (error) { setMessage("settings-email-message", friendlyError(error)); return; }
  event.target.reset(); setMessage("settings-email-message", "Письмо для подтверждения отправлено на новый адрес. Почта профиля изменится после подтверждения; статус и права останутся прежними.", "success");
}

async function compressAvatar(file) {
  const image = await new Promise((resolve, reject) => { const img = new Image(); const reader = new FileReader(); reader.onerror = () => reject(new Error("Не удалось прочитать изображение.")); reader.onload = () => { img.onerror = () => reject(new Error("Некорректный файл изображения.")); img.onload = () => resolve(img); img.src = reader.result; }; reader.readAsDataURL(file); });
  const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 512; const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#171a20"; ctx.fillRect(0, 0, 512, 512); const side = Math.min(image.naturalWidth, image.naturalHeight);
  ctx.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 512, 512);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.84));
  if (!blob || blob.size > 2 * 1024 * 1024) throw new Error("Не удалось обработать изображение до 2 МБ."); return blob;
}

async function uploadAvatar(file, button) {
  if (!file) return; setBusy(button, true, "Загружаем…");
  try { const blob = await compressAvatar(file); const path = state.session.user.id + "/avatar.webp";
    const { error: uploadError } = await state.client.storage.from("avatars").upload(path, blob, { upsert: true, contentType: "image/webp", cacheControl: "3600" }); if (uploadError) throw uploadError;
    const { error } = await state.client.rpc("set_own_avatar_path", { new_path: path }); if (error) throw error;
    state.profile = await loadProfile(); updateAvatarImages(); showToast("Аватар обновлён."); render();
  } catch (error) { showToast(friendlyError(error)); } finally { setBusy(button, false); }
}

async function removeAvatar(button) {
  if (!state.profile?.avatar_path || !await confirmAction("Удалить аватар?", "Вместо фотографии будет отображаться стандартная аватарка.", "Удалить")) return;
  setBusy(button, true, "Удаляем…"); const path = state.profile.avatar_path;
  const { error } = await state.client.rpc("set_own_avatar_path", { new_path: null });
  if (error) { setBusy(button, false); showToast(friendlyError(error)); return; }
  state.profile = await loadProfile(); updateAvatarImages(); const { error: removeError } = await state.client.storage.from("avatars").remove([path]);
  setBusy(button, false); showToast(removeError ? "Аватар отвязан, но файл не удалось удалить." : "Аватар удалён."); render();
}

async function changePassword(event) {
  event.preventDefault(); const password = $("settings-new-password").value;
  if (password.length < 8) { setMessage("settings-password-message", "Пароль должен содержать не менее 8 символов."); return; }
  if (password !== $("settings-password-repeat").value) { setMessage("settings-password-message", "Пароли не совпадают."); return; }
  const button = $("settings-password-submit"); setBusy(button, true, "Сохраняем…");
  const { error } = await state.client.auth.updateUser({ password }); setBusy(button, false);
  if (error) { setMessage("settings-password-message", friendlyError(error)); return; }
  event.target.reset(); setMessage("settings-password-message", "Пароль изменён.", "success");
}

async function renderAdmin(view, current) {
  const section = h("section", { class: "card" },
    h("div", { class: "card-heading" }, h("span", { class: "section-icon" }, icon("i-user")), h("div", {}, h("h2", { text: "Сотрудники и заявки" }), h("p", { text: "Одобрение регистраций и управление доступом" }))),
    loadingBlock());
  view.append(section);
  const { data, error } = await state.client.from("profiles").select("id, email, nickname, position, status, is_admin, created_at").order("created_at", { ascending: false });
  if (!current()) return;
  if (error) { section.lastChild.replaceWith(errorBlock(error, render)); return; }
  const groups = [["pending", "Ожидают одобрения"], ["approved", "Активные"], ["rejected", "Отклонённые и отозванные"]];
  const statusAction = (person, status, label, className) => h("button", { type: "button", class: `button ${className} small`, onclick: () => changeStatus(person, status) }, label);
  section.lastChild.replaceWith(h("div", { class: "admin-groups" }, ...groups.map(([status, title]) => {
    const people = data.filter((person) => person.status === status);
    return h("div", { class: "admin-group" }, h("h3", {}, title, h("span", { class: "count", text: String(people.length) })),
      people.length ? h("div", { class: "people" }, ...people.map((person) => h("div", { class: "person" },
        h("div", { class: "person-text" }, h("strong", {}, person.nickname, person.is_admin ? h("span", { class: "pill", text: "руководитель" }) : null), h("small", { text: `${person.position} · ${person.email}` }), h("small", { text: `Регистрация: ${formatDateTime(person.created_at)}` })),
        person.id === state.profile.id ? h("span", { class: "muted small-text", text: "Это вы" }) : h("div", { class: "person-actions" },
          status !== "approved" ? statusAction(person, "approved", "Одобрить", "button-primary") : null,
          status === "pending" ? statusAction(person, "rejected", "Отклонить", "button-secondary") : null,
          status === "approved" ? statusAction(person, "rejected", "Отозвать доступ", "button-secondary") : null))))
        : h("p", { class: "muted small-text", text: "Нет сотрудников." }));
  })));
}

async function changeStatus(person, status) {
  const texts = { approved: ["Одобрить доступ?", `${person.nickname} получит доступ к рабочему пространству.`, "Одобрить"], rejected: ["Закрыть доступ?", `${person.nickname} больше не сможет пользоваться рабочим пространством.`, "Закрыть доступ"] };
  if (!await confirmAction(...texts[status])) return;
  const { error } = await state.client.rpc("set_account_status", { target: person.id, new_status: status });
  if (error) { showToast(friendlyError(error)); return; }
  showToast(status === "approved" ? `Доступ для ${person.nickname} открыт.` : `Доступ для ${person.nickname} закрыт.`);
  refreshPendingBadge();
  render();
}

async function logout() {
  const { error } = await state.client.auth.signOut();
  if (error) await state.client.auth.signOut({ scope: "local" });
  state.session = null;
  state.profile = null;
  location.replace("#/reports");
  showScreen("login");
}

function openSidebar() { document.body.classList.add("sidebar-open"); $("sidebar-backdrop").hidden = false; $("menu-button").setAttribute("aria-expanded", "true"); }
function closeSidebar() { document.body.classList.remove("sidebar-open"); $("sidebar-backdrop").hidden = true; $("menu-button").setAttribute("aria-expanded", "false"); }

function bindAuthForms() {
  $("tab-login").addEventListener("click", () => selectTab("login"));
  $("tab-register").addEventListener("click", () => selectTab("register"));

  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = $("login-email").value.trim();
    const password = $("login-password").value;
    if (!$("login-email").checkValidity() || !email) { setMessage("login-message", "Введите корректную почту."); $("login-email").focus(); return; }
    if (!password) { setMessage("login-message", "Введите пароль."); $("login-password").focus(); return; }
    const button = event.target.querySelector("button[type=submit]");
    setBusy(button, true, "Входим…");
    const { data, error } = await state.client.auth.signInWithPassword({ email, password });
    setBusy(button, false);
    if (error) { setMessage("login-message", friendlyError(error)); return; }
    state.session = data.session;
    $("login-password").value = "";
    enterWorkspace();
  });

  $("forgot-password").addEventListener("click", async () => {
    const email = $("login-email").value.trim();
    if (!email || !$("login-email").checkValidity()) { setMessage("login-message", "Введите почту в поле выше, затем нажмите «Забыли пароль?»."); $("login-email").focus(); return; }
    const { error } = await state.client.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
    setMessage("login-message", error ? friendlyError(error) : "Если аккаунт существует, на почту отправлена ссылка для смены пароля.", error ? "error" : "success");
  });

  $("register-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const nickname = $("register-nickname").value.trim();
    const position = $("register-position").value;
    const email = $("register-email").value.trim();
    const password = $("register-password").value;
    const fail = (text, id) => { setMessage("register-message", text); $(id).focus(); };
    if (nickname.length < 2) return fail("Никнейм должен содержать от 2 до 64 символов.", "register-nickname");
    if (!position || !POSITIONS.includes(position)) return fail("Выберите должность из списка.", "register-position");
    if (!email || !$("register-email").checkValidity()) return fail("Введите корректную почту.", "register-email");
    if (password.length < 8) return fail("Пароль должен содержать не менее 8 символов.", "register-password");
    if (password !== $("register-password-repeat").value) return fail("Пароли не совпадают.", "register-password-repeat");
    const button = event.target.querySelector("button[type=submit]");
    setBusy(button, true, "Отправляем…");
    const { data, error } = await state.client.auth.signUp({ email, password, options: { data: { nickname, position }, emailRedirectTo: appUrl() } });
    setBusy(button, false);
    if (error) { setMessage("register-message", friendlyError(error)); return; }
    event.target.reset();
    if (data.session) { state.session = data.session; enterWorkspace(); return; }
    selectTab("login");
    $("login-email").value = email;
    setMessage("login-message", "Заявка создана. Мы отправили письмо на почту — перейдите по ссылке, чтобы подтвердить адрес. После этого дождитесь одобрения руководителя.", "success");
  });

  $("recovery-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = $("recovery-password").value;
    if (password.length < 8) { setMessage("recovery-message", "Пароль должен содержать не менее 8 символов."); return; }
    const button = event.target.querySelector("button[type=submit]");
    setBusy(button, true, "Сохраняем…");
    const { error } = await state.client.auth.updateUser({ password });
    setBusy(button, false);
    if (error) { setMessage("recovery-message", friendlyError(error)); return; }
    state.recovery = false;
    event.target.reset();
    showToast("Пароль обновлён.");
    enterWorkspace();
  });

  $("gate-refresh").addEventListener("click", enterWorkspace);
  $("gate-logout").addEventListener("click", logout);
}

function bindApp() {
  window.addEventListener("hashchange", () => { if (!$("app-view").hidden) { if (parseRoute()) render(); else location.replace("#/reports"); } });
  $("sidebar-logout").addEventListener("click", logout);
  $("menu-button").addEventListener("click", () => document.body.classList.contains("sidebar-open") ? closeSidebar() : openSidebar());
  $("sidebar-backdrop").addEventListener("click", closeSidebar);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && document.body.classList.contains("sidebar-open")) closeSidebar(); });
  for (const [toggleId, itemsId] of [["monitoring-toggle", "monitoring-items"], ["training-toggle", "training-items"]]) {
    $(toggleId).addEventListener("click", () => {
      const toggle = $(toggleId);
      const expanded = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(expanded));
      $(itemsId).hidden = !expanded;
    });
  }
  $("sanction-form").addEventListener("submit", submitSanction);
  $("settings-nickname-form").addEventListener("submit", changeNickname);
  $("settings-email-form").addEventListener("submit", requestEmailChange);
  $("settings-password-form").addEventListener("submit", changePassword);
  $("sanction-permanent").addEventListener("change", (event) => {
    $("sanction-duration").disabled = event.target.checked;
    $("sanction-unit").disabled = event.target.checked;
  });
  for (const button of document.querySelectorAll("[data-close]")) button.addEventListener("click", () => button.closest("dialog").close());
  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("click", (event) => {
      const rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
    });
  }
}

const appUrl = () => `${location.origin}${location.pathname}`;

function readAuthError() {
  const params = new URLSearchParams(location.hash.replace(/^#/, "") || location.search.replace(/^\?/, ""));
  const code = params.get("error_code") || params.get("error");
  if (!code) return "";
  history.replaceState(null, "", appUrl());
  if (/otp_expired/.test(code)) return "Ссылка из письма устарела или уже использована. Войдите или запросите новую.";
  return `Не удалось подтвердить ссылку: ${(params.get("error_description") || code).slice(0, 200)}`;
}

async function start() {
  bindAuthForms();
  bindApp();
  if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase?.createClient) {
    showGate({ title: "Сервер не подключён", text: "Укажите адрес проекта Supabase и публичный ключ в файле config.js, затем обновите страницу.", iconName: "i-warning", actions: false });
    return;
  }
  const authError = readAuthError();
  state.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  state.client.auth.onAuthStateChange((event, session) => {
    state.session = session;
    if (event === "PASSWORD_RECOVERY") { state.recovery = true; setTimeout(() => showScreen("recovery"), 0); }
    if (event === "SIGNED_OUT") { state.profile = null; setTimeout(() => showScreen("login"), 0); }
  });
  const { data, error } = await state.client.auth.getSession();
  if (/access_token|refresh_token|type=/.test(location.hash)) history.replaceState(null, "", `${appUrl()}#/reports`);
  if (error) { showScreen("login"); setMessage("login-message", friendlyError(error)); return; }
  state.session = data.session;
  if (!state.session) { showScreen("login"); if (authError) setMessage("login-message", authError); return; }
  enterWorkspace();
}

start();
