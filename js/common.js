/**
 * common.js — 公共数据加载模块
 *
 * 提供基于 fetch 的异步数据加载功能，支持从 data/ 目录读取：
 *   - dates_index.json    日期索引
 *   - news_data.json      新闻/话题数据（支持按日期加载）
 *   - permanent_vault.json 永久资源
 *
 * 入口函数 init() 会优先读取 dates_index.json 获取日期列表，
 * 并默认加载最新日期的内容。
 */

const DataLoader = (function () {
  const BASE_URL = 'data/';

  /**
   * 通用 JSON 加载函数
   * @param {string} path - 相对于 BASE_URL 的文件路径
   * @returns {Promise<any>}
   */
  async function fetchJSON(path) {
    const url = BASE_URL + path;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load "${url}": ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * 加载日期索引
   * @returns {Promise<{latest: string, dates: string[]}>}
   */
  async function loadDatesIndex() {
    return fetchJSON('dates_index.json');
  }

  /**
   * 加载指定日期的新闻数据。
   * 当 date 为空时，加载根目录的 news_data.json（即最新数据）。
   * @param {string} [date] - 日期字符串，格式 YYYY-MM-DD
   * @returns {Promise<{date: string, top_topics: object[], news: object[]}>}
   */
  async function loadNewsData(date) {
    if (date) {
      return fetchJSON(`${date}/news_data.json`);
    }
    return fetchJSON('news_data.json');
  }

  /**
   * 加载永久资源库
   * @returns {Promise<{resources: object[]}>}
   */
  async function loadPermanentVault() {
    return fetchJSON('permanent_vault.json');
  }

  return { loadDatesIndex, loadNewsData, loadPermanentVault };
})();

/* ─────────────────────────────────────────────
   渲染函数
───────────────────────────────────────────── */

/**
 * 渲染热门话题列表
 * @param {object[]} topics
 */
function renderTopTopics(topics) {
  const container = document.getElementById('top-topics');
  if (!container) return;

  if (!topics || topics.length === 0) {
    container.innerHTML = '<p class="empty-hint">暂无热门话题</p>';
    return;
  }

  container.innerHTML = topics
    .map(
      (topic, index) => `
    <div class="topic-item" data-id="${topic.id}">
      <span class="topic-rank">${index + 1}</span>
      <div class="topic-body">
        <a class="topic-title" href="${topic.url || '#'}">${topic.title}</a>
        <p class="topic-summary">${topic.summary || ''}</p>
        <span class="topic-meta">
          <span class="tag tag-${topic.category || 'default'}">${topic.category || ''}</span>
          ${topic.heat ? `<span class="topic-heat">🔥 ${topic.heat.toLocaleString()}</span>` : ''}
        </span>
      </div>
    </div>`
    )
    .join('');
}

/**
 * 渲染新闻列表
 * @param {object[]} newsList
 */
function renderNewsList(newsList) {
  const container = document.getElementById('news-list');
  if (!container) return;

  if (!newsList || newsList.length === 0) {
    container.innerHTML = '<p class="empty-hint">暂无新闻</p>';
    return;
  }

  container.innerHTML = newsList
    .map(
      (item) => `
    <article class="news-item" data-id="${item.id}">
      <a class="news-title" href="${item.url || '#'}">${item.title}</a>
      <p class="news-summary">${item.summary || ''}</p>
      <div class="news-meta">
        <span class="tag tag-${item.category || 'default'}">${item.category || ''}</span>
        ${item.source ? `<span class="news-source">${item.source}</span>` : ''}
        ${item.published_at ? `<time class="news-time" datetime="${item.published_at}">${formatDate(item.published_at)}</time>` : ''}
      </div>
    </article>`
    )
    .join('');
}

/**
 * 渲染永久资源列表
 * @param {object[]} resources
 */
function renderPermanentVault(resources) {
  const container = document.getElementById('permanent-vault');
  if (!container) return;

  if (!resources || resources.length === 0) {
    container.innerHTML = '<p class="empty-hint">暂无资源</p>';
    return;
  }

  container.innerHTML = resources
    .map(
      (item) => `
    <a class="vault-item" href="${item.url || '#'}" target="_blank" rel="noopener noreferrer">
      <span class="vault-title">${item.title}</span>
      <span class="vault-desc">${item.description || ''}</span>
    </a>`
    )
    .join('');
}

/**
 * 渲染日期导航
 * @param {string[]} dates - 日期数组（降序，最新在前）
 * @param {string} activeDate - 当前选中日期
 */
function renderDateNav(dates, activeDate) {
  const container = document.getElementById('date-nav');
  if (!container) return;

  // Track current active date via data attribute so the click handler
  // always reads the most up-to-date value.
  container.dataset.activeDate = activeDate;

  container.innerHTML = dates
    .map(
      (date) => `
    <button
      class="date-btn${date === activeDate ? ' active' : ''}"
      data-date="${date}"
      aria-pressed="${date === activeDate}"
    >${date}</button>`
    )
    .join('');

  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('.date-btn');
    if (!btn) return;

    const date = btn.dataset.date;
    if (date === container.dataset.activeDate) return;

    container.querySelectorAll('.date-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.date === date);
      b.setAttribute('aria-pressed', b.dataset.date === date);
    });

    await loadDateContent(date);
    container.dataset.activeDate = date;
  });
}

/* ─────────────────────────────────────────────
   辅助函数
───────────────────────────────────────────── */

/**
 * 将 ISO 日期字符串格式化为本地化短日期
 * @param {string} isoString
 * @returns {string}
 */
function formatDate(isoString) {
  try {
    return new Date(isoString).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

/**
 * 显示/隐藏全局加载指示器
 * @param {boolean} visible
 */
function setLoading(visible) {
  const el = document.getElementById('loading-indicator');
  if (el) el.hidden = !visible;
}

/**
 * 加载指定日期的新闻内容并重新渲染
 * @param {string} date
 */
async function loadDateContent(date) {
  setLoading(true);
  try {
    const newsData = await DataLoader.loadNewsData(date);
    renderTopTopics(newsData.top_topics);
    renderNewsList(newsData.news);

    const dateLabel = document.getElementById('current-date-label');
    if (dateLabel) dateLabel.textContent = newsData.date || date;
  } catch (err) {
    console.error(`加载 ${date} 数据失败:`, err);
    showError(`加载 ${date} 的内容失败，请稍后再试。`);
  } finally {
    setLoading(false);
  }
}

/**
 * 在页面上显示错误提示
 * @param {string} message
 */
function showError(message) {
  const el = document.getElementById('error-message');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 5000);
}

/* ─────────────────────────────────────────────
   初始化入口
───────────────────────────────────────────── */

/**
 * 初始化函数：
 * 1. 读取 dates_index.json 获取日期列表
 * 2. 默认加载最新日期的 news_data.json 和 permanent_vault.json
 * 3. 渲染所有区块
 */
async function init() {
  setLoading(true);
  try {
    // 1. 读取日期索引
    const datesIndex = await DataLoader.loadDatesIndex();
    const latestDate = datesIndex.latest || (datesIndex.dates && datesIndex.dates[0]);

    if (!latestDate) {
      throw new Error('dates_index.json 中未找到有效日期');
    }

    // 2. 并行加载最新新闻数据和永久资源
    const [newsData, vaultData] = await Promise.all([
      DataLoader.loadNewsData(latestDate),
      DataLoader.loadPermanentVault(),
    ]);

    // 3. 渲染各区块
    renderTopTopics(newsData.top_topics);
    renderNewsList(newsData.news);
    renderPermanentVault(vaultData.resources);
    renderDateNav(datesIndex.dates, latestDate);

    const dateLabel = document.getElementById('current-date-label');
    if (dateLabel) dateLabel.textContent = newsData.date || latestDate;
  } catch (err) {
    console.error('初始化失败:', err);
    showError('页面初始化失败，请刷新重试。');
  } finally {
    setLoading(false);
  }
}

// 页面加载完成后自动初始化
document.addEventListener('DOMContentLoaded', init);
