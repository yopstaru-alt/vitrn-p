"use strict";
const API = "/api/products";
const PAGE = 24;
const $app = document.getElementById("app");
let categories = [];
let collections = [];
const SHOW_PROMO = false;  // фото-подборки отключены (код и API остались)
const SHOW_CAT_TILES = true;  // плитки разделов каталога (первый вариант)

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (p, cur) => {
  if (p == null || Number(p) <= 0) return "Цена на сайте";
  const n = Number(p).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
  return `${n} ${!cur || /^(RUB|РУБ)$/i.test(cur) ? "₽" : esc(cur)}`;
};
const plain = (html) => {  // описания у брендов приходят с HTML и сущностями
  const d = new DOMParser().parseFromString(String(html || "").replace(/<\/(p|div|li|h\d)>|<br\s*\/?>/gi, "\n"), "text/html");
  return (d.body.textContent || "").replace(/\u00a0/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
};
const secure = (u) => String(u || "").replace(/^http:\/\//i, "https://");
const FIT_MIN = 0.63, FIT_MAX = 0.71;  // как на сервере: фото ≈2:3 заполняет плитку без полос
const fits = (p) => p.image_ratio >= FIT_MIN && p.image_ratio <= FIT_MAX;
const isHttp = (u) => /^https?:\/\//i.test(u || "");

// Статический режим (GitHub Pages): бэкенда нет — поиск и сортировка выполняются в браузере по data/catalog.json
let SNAP = null;
const norm = (t) => String(t || "").toLowerCase().replace(/ё/g, "е");
async function snapshot() {
  if (!SNAP) {
    const r = await fetch("data/catalog.json");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const items = d.rows.map((row) => {  // компактные строки -> объекты как в API
      const it = Object.fromEntries(d.cols.map((c, i) => [c, row[i]]));
      const [bn, bw, bid] = d.brands[it.brand];
      return { ...it, brand_id: bid, brand_name: bn, brand_website: bw, currency: it.currency || "RUB", attributes: {}, _t: "" };
    });
    for (const it of items) it._t = `${norm(it.name)} ${norm(it.description)}`;  // поисковый текст считаем один раз
    SNAP = { items, titles: d.titles, order: d.order };
  }
  return SNAP;
}
async function staticApi(path, p) {
  const { items, titles, order } = await snapshot();
  if (path === "/categories") {
    const n = {};
    for (const it of items) n[it.peek_category] = (n[it.peek_category] || 0) + 1;
    return order.filter((s) => n[s]).map((s) => ({ slug: s, title: titles[s], count: n[s] }));
  }
  if (path === "/collections") return [];
  if (path !== "/search") {
    const it = items.find((x) => String(x.id) === path.slice(1));
    if (!it) throw new Error("HTTP 404");
    return it;
  }
  const words = norm(p.q).split(/\s+/).filter(Boolean);
  let list = items.filter((it) =>
    (!p.section || it.peek_category === p.section) &&
    (!p.category || norm(it.category_path).includes(norm(p.category))) &&
    ((p.sort !== "price_asc" && p.sort !== "price_desc") || it.price > 0));
  const score = new Map();
  if (words.length) {
    list = list.filter((it) => {
      const nm = norm(it.name), t = it._t;
      if (!words.every((w) => t.includes(w))) return false;
      score.set(it.id, words.reduce((a, w) => a + (nm.includes(w) ? 1 : 0.3), 0));
      return true;
    });
  }
  const sort = p.sort || "relevance";
  const fit = (it) => (p.prefer_fit && sort === "new" && !fits(it) ? 1 : 0);
  const cmp = {
    new: (a, b) => fit(a) - fit(b) || b.id - a.id,
    price_asc: (a, b) => a.price - b.price || a.id - b.id,
    price_desc: (a, b) => b.price - a.price || a.id - b.id,
    relevance: (a, b) => (score.get(b.id) || 0) - (score.get(a.id) || 0) || b.id - a.id,
  }[sort] || ((a, b) => b.id - a.id);
  list.sort(cmp);
  if (p.mix) {  // по кругу: n-й товар каждого бренда идёт в n-м «круге»; сортировка стабильна
    const seen = {};
    list = list.map((it) => ({ it, r: (seen[it.brand_id] = (seen[it.brand_id] || 0) + 1) }))
      .sort((a, b) => a.r - b.r).map((x) => x.it);
  }
  const limit = Number(p.limit) || 20, offset = Number(p.offset) || 0;
  return { total: list.length, limit, offset, items: list.slice(offset, offset + limit) };
}

let STATIC = false, probed = false;
async function api(path, params = {}) {
  const clean = {};
  for (const [k, v] of Object.entries(params)) if (v !== "" && v != null) clean[k] = v;
  if (!STATIC) {
    try {
      const r = await fetch(`${API}${path}?${new URLSearchParams(clean)}`);
      if (r.ok) { probed = true; return r.json(); }
      if (probed) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (probed) throw e;
    }
    STATIC = true;  // первый запрос не прошёл — бэкенда нет (GitHub Pages): работаем по снимку каталога
  }
  return staticApi(path, clean);
}

// ---------- роутинг: #/?q=..&c=..&sort=.. и #/p/<id> ----------
function route() {
  const h = location.hash.replace(/^#/, "") || "/";
  const [path, qs = ""] = h.split("?");
  return { path, params: new URLSearchParams(qs) };
}
function go(params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  location.hash = "#/" + (qs.toString() ? "?" + qs : "");
}

// ---------- компоненты ----------
function cardHTML(p) {
  const img = isHttp(p.image_url)
    ? `<img class="${fits(p) ? "fit" : ""}" src="${esc(secure(p.image_url))}" alt="${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'noimg',textContent:'нет фото'}))">`
    : `<div class="noimg">нет фото</div>`;
  return `<a class="card" href="#/p/${p.id}">
    <div class="tile">${img}</div>
    <div class="card-brand">${esc(p.brand_name)}</div>
    <div class="card-name">${esc(p.name)}</div>
    <div class="card-price">${money(p.price, p.currency)}</div>
  </a>`;
}
const skeletons = (n = 8) => `<div class="grid">${'<div class="skel"></div>'.repeat(n)}</div>`;

function tagsHTML(active, q, sortUi) {
  const all = `<a class="tag ${active ? "" : "active"}" href="${chipHref(q, "", sortUi)}">Все</a>`;
  const chips = all + categories.map((c) =>
    `<a class="tag ${active === c.slug ? "active" : ""}" href="${chipHref(q, c.slug, sortUi)}">${esc(c.title)}<sup>${c.count}</sup></a>`).join("");
  return chips;
}
const chipHref = (q, c, sortUi) => sortHref(q, c, sortUi);

// ---------- страницы ----------
const SORTS = [["", "Рекомендуемое"], ["price_asc", "Дешевле"], ["price_desc", "Дороже"]];
const SHELF_SIZE = 16;

function shelfHTML(id, title, href) {
  return `<section class="shelf" id="${id}">
    <div class="shelf-head"><h2><a href="${href}">${esc(title)}</a></h2>
      <div class="shelf-nav"><a class="link-u" href="${href}">Смотреть все</a>
        <button class="arrow" data-dir="-1" aria-label="Назад">←</button><button class="arrow" data-dir="1" aria-label="Вперёд">→</button></div></div>
    <div class="shelf-row">${'<div class="skel"></div>'.repeat(6)}</div></section>`;
}

async function fillShelf(id, params) {
  const el = document.getElementById(id);
  if (!el) return;
  const row = el.querySelector(".shelf-row");
  el.querySelectorAll(".arrow").forEach((b) => b.addEventListener("click", () =>
    row.scrollBy({ left: Number(b.dataset.dir) * row.clientWidth * 0.9, behavior: "smooth" })));
  try {
    const data = await api("/search", { has_image: true, mix: true, prefer_fit: true, limit: SHELF_SIZE, ...params });
    if (!data.items.length) return el.remove();
    row.innerHTML = data.items.map(cardHTML).join("");
  } catch { el.remove(); }
}

async function renderCatalog({ params }) {
  const q = params.get("q") || "", c = params.get("c") || "", sortUi = params.get("sort") || "", col = params.get("col") || "";
  const colInfo = collections.find((x) => x.slug === col);
  const cat = categories.find((x) => x.slug === c);
  document.title = (q ? `«${q}» — ` : colInfo ? `${colInfo.title} — ` : cat ? `${cat.title} — ` : "") + "drop by vitrn — поиск одежды у дизайнеров";
  const home = !q && !c && !col;
  // «Рекомендуемое»: при поиске — по релевантности, иначе новинки с перемешиванием брендов
  const sort = sortUi || (q ? "relevance" : "new");

  $app.innerHTML = `
    <section class="hero">
      <h1>${home ? "Найдём одежду у дизайнеров" : q ? "Результаты поиска" : esc(colInfo?.title || cat?.title || "Каталог")}</h1>
      <form class="search-form" role="search">
        <label class="visually-hidden" for="q">Поиск</label>
        <input id="q" name="q" type="search" autocomplete="off" placeholder="Платье, худи, жакет…" value="${esc(q)}">
        <button class="btn" type="submit">Найти</button>
      </form>
      <div class="tags">${tagsHTML(c, q, sortUi)}</div>
    </section>
    <div class="catalog-shell">
      ${home && SHOW_PROMO ? promoTilesHTML(collections) : ""}
      ${home && SHOW_CAT_TILES ? `<div class="promo">${catTilesHTML(categories.filter((x) => x.slug !== "other").slice(0, 8))}</div>` : ""}
      <div class="catalog-head">
        ${home ? "" : `<h2>${q ? `«${esc(q)}»${cat ? " · " + esc(cat.title) : ""}` : esc(colInfo?.title || cat?.title)}${colInfo ? `<small class="col-sub">${esc(colInfo.subtitle)}</small>` : ""}</h2><span class="meta" id="meta"></span>`}
        <label class="sort"><span>Сортировка</span>
          <select id="sort">${SORTS.map(([v, t]) => `<option value="${v}" ${v === sortUi ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      </div>
      ${home ? `<div class="shelves"></div>` : `<div id="results">${skeletons()}</div><div class="more-wrap" id="more"></div>`}
    </div>`;
  $app.querySelector("#sort").addEventListener("change", (e) => { location.hash = sortHref(q, c, e.target.value); });

  $app.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    go({ q: new FormData(e.target).get("q").trim(), c, sort: sortUi });
  });

  if (home) {  // ленты «как в онлайн-кинотеатре»: Новинки, затем по категориям; бренды в каждой ленте перемешаны
    const apiSort = sortUi || "new";
    const shelves = [["new", "Новинки", "#/", {}], ...categories.filter((x) => x.slug !== "other")
      .map((x) => [x.slug, x.title, `#/?c=${x.slug}${sortUi ? "&sort=" + sortUi : ""}`, { section: x.slug }])];
    const box = $app.querySelector(".shelves");
    box.innerHTML = shelves.map(([id, t, href]) => shelfHTML("shelf-" + id, t, href)).join("");
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      const sh = shelves.find(([id]) => "shelf-" + id === en.target.id);
      fillShelf(en.target.id, { sort: apiSort, ...sh[3] });
    }), { rootMargin: "400px" });
    box.querySelectorAll(".shelf").forEach((el) => io.observe(el));
    // под лентами — все карточки подряд (в любом порядке) с кнопкой «Показать ещё»
    box.insertAdjacentHTML("afterend", `<div id="results"></div><div class="more-wrap" id="more"></div>`);
    mountGrid({ has_image: true, sort: apiSort, limit: PAGE, mix: true, prefer_fit: !sortUi },
      $app.querySelector("#results"), $app.querySelector("#more"), null);
    return;
  }

  mountGrid({ q, section: c, collection: col, sort, has_image: true, limit: PAGE, mix: !q && !sortUi, prefer_fit: !q && !sortUi },
    $app.querySelector("#results"), $app.querySelector("#more"), $app.querySelector("#meta"));
}

// Сетка карточек с «Показать ещё»
function mountGrid(base, results, more, meta) {
  let offset = 0;
  async function load() {
    try {
      const data = await api("/search", { ...base, offset });
      if (offset === 0) {
        if (meta) meta.textContent = data.total ? `Найдено: ${data.total.toLocaleString("ru-RU")}` : "";
        results.innerHTML = data.items.length
          ? `<div class="grid"></div>`
          : `<div class="empty">Ничего не нашли. Попробуйте другой запрос или категорию.</div>`;
      }
      results.querySelector(".grid")?.insertAdjacentHTML("beforeend", data.items.map(cardHTML).join(""));
      offset += data.items.length;
      more.innerHTML = offset < data.total ? `<button class="btn btn-ghost btn-lg">Показать ещё</button>` : "";
      more.querySelector("button")?.addEventListener("click", load);
    } catch (e) {
      results.innerHTML = `<div class="empty">Не удалось загрузить каталог (${esc(e.message)}). <a class="link-u" href="">Повторить</a></div>`;
    }
  }
  load();
}

// Промо-плитки: подборки-образы (Вечерний самурай, Домашний лук, ...)
const promoTilesHTML = (items) => `<section class="promo" aria-label="Подборки"><div class="grid">${items.map((x) => `
  <a class="card promo-card ${esc(x.theme)}" href="#/?col=${esc(x.slug)}">
    <div class="tile">${x.cover_url ? `<img class="fit" src="${esc(secure(x.cover_url))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}</div>
    <div class="card-brand">Подборка</div>
    <div class="card-name">${esc(x.title)}${x.mark ? ` <span aria-hidden="true">${x.mark}</span>` : ""}</div>
    <div class="card-price">${x.count} товаров</div>
  </a>`).join("")}</div></section>`;

// Плитки разделов каталога (название + число товаров) на главной, пригодятся для промо-подборок (подключать: container.innerHTML = catTilesHTML(items))
const catTilesHTML = (items) => `<div class="cats">${items.map((x) =>
  `<a class="cat-tile" href="#/?c=${x.slug}"><b>${esc(x.title)}</b><span>${x.count} товаров</span></a>`).join("")}</div>`;

function sortHref(q, c, v) {
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (c) qs.set("c", c);
  if (v) qs.set("sort", v);
  return "#/" + (qs.toString() ? "?" + qs : "");
}

async function renderProduct({ path }) {
  const id = Number(path.split("/")[2]);
  $app.innerHTML = `<div class="product"><a class="back" href="javascript:history.length>1?history.back():location.hash='#/'">← Назад</a>
    <div class="gallery"><div class="skel" style="aspect-ratio:4/5"></div></div></div>`;
  let p;
  try { p = await api(`/${id}`); } catch {
    $app.innerHTML = `<div class="product"><a class="back" href="#/">← В каталог</a><div class="empty" style="grid-column:1/-1">Товар не найден.</div></div>`;
    return;
  }
  document.title = `${p.name} — ${p.brand_name} · drop by vitrn`;
  const cat = categories.find((x) => x.slug === p.peek_category);
  const attrs = Object.entries(p.attributes || {}).filter(([, v]) => v != null && typeof v !== "object" && String(v).trim());
  const rows = [["Бренд", p.brand_name], ["Категория", cat?.title], ...attrs].filter(([, v]) => v);
  const img = isHttp(p.image_url)
    ? `<img src="${esc(secure(p.image_url))}" alt="${esc(p.name)}" referrerpolicy="no-referrer">` : `<div class="noimg">нет фото</div>`;
  const buy = isHttp(p.product_url)
    ? `<a class="btn btn-lg" href="${esc(p.product_url)}" target="_blank" rel="noopener sponsored">Купить</a>
       <div class="buy-note">Откроется страница товара на сайте ${esc(p.brand_name)}</div>` : "";

  $app.innerHTML = `
    <article class="product">
      <a class="back" href="javascript:history.length>1?history.back():location.hash='#/'">← Назад</a>
      <div class="gallery"><div class="tile">${img}</div></div>
      <div class="info">
        <div class="brand">${p.brand_website && isHttp(p.brand_website)
          ? `<a class="link-u" href="${esc(p.brand_website)}" target="_blank" rel="noopener">${esc(p.brand_name)} ↗</a>` : esc(p.brand_name)}</div>
        <h1>${esc(p.name)}</h1>
        <div class="price">${money(p.price, p.currency)}</div>
        ${buy ? `<div class="buy">${buy}</div>` : ""}
        ${p.description ? `<p class="desc">${esc(plain(p.description).slice(0, 1200))}</p>` : ""}
        <dl class="attrs">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      </div>
    </article>
    ${isHttp(p.product_url) ? `<div class="buy-bar"><span class="bb-price">${money(p.price, p.currency)}</span>
      <a class="btn" href="${esc(p.product_url)}" target="_blank" rel="noopener sponsored">Купить</a></div>` : ""}
    <section class="similar"><h2>Ещё в категории${cat ? ` «${esc(cat.title)}»` : ""}</h2><div id="sim">${skeletons(4)}</div></section>`;
  window.scrollTo(0, 0);

  try {
    const data = await api("/search", { section: p.peek_category, has_image: true, sort: "new", limit: 9 });
    const items = data.items.filter((x) => x.id !== p.id).slice(0, 8);
    $app.querySelector("#sim").innerHTML = `<div class="grid">${items.map(cardHTML).join("")}</div>`;
  } catch { $app.querySelector("#sim").innerHTML = ""; }
}

async function render() {
  const r = route();
  document.querySelectorAll("[data-nav]").forEach((a) => a.toggleAttribute("aria-current", !r.path.startsWith("/p/")));
  if (r.path.startsWith("/p/")) return renderProduct(r);
  window.scrollTo(0, 0);
  return renderCatalog(r);
}

// Размер карточки фиксирован (~245 px), число карточек в ряду зависит от ширины экрана
function layout() {
  const w = document.documentElement.clientWidth, pad = w <= 800 ? 14 : 20, gap = w <= 800 ? 12 : 22;
  const n = w <= 800 ? 2 : Math.max(2, Math.floor((w - 2 * pad + gap) / (230 + gap)));
  document.documentElement.style.setProperty("--n", n);
}

(async function init() {
  layout();
  window.addEventListener("resize", layout);
  try { collections = await api("/collections", { has_image: true }); } catch { collections = []; }
  try { categories = await api("/categories", { has_image: true }); } catch { categories = []; }
  window.addEventListener("hashchange", render);
  render();
})();
