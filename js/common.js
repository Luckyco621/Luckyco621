/**
 * common.js — AI4S Executive Dashboard 共通モジュール
 *
 * インターフェース: index.txt (AI4S Executive Dashboard) を保持
 * データ取得方式:   index1.txt の方式を採用
 *   - Promise.all([news_data.json, dates_index.json, permanent_vault.json])
 *   - 複数JSONフォーマット対応（bare-array / {dates:...} / {items:[...]}）
 *   - 日付ごとのオンデマンドフェッチ + メモリキャッシュ
 *   - URL重複排除 (dedupeByUrl)
 *   - ページネーション対応 (PAGE_SIZE = 20)
 *   - dates_index.json: 配列形式 または {latest, dates[]} 形式 両対応
 */

(function () {
  'use strict';

  // ============================================================
  // フェッチ状態 (index1.txt 方式)
  // ============================================================
  var DATA = [];          // 選択中の日付のアイテム
  var PATENTS = [];       // 特許アーカイブ
  var DATES = {};         // { 'YYYY-MM-DD': [items] | null }  null = 未ロード
  var SORTED_DATES = [];  // 降順ソート済み日付一覧
  var SELECTED_DATE_IDX = 0;
  var VAULT = [];         // permanent_vault.json のアイテム

  // ============================================================
  // ページネーション状態
  // ============================================================
  var PAGE_STATE = {};
  var PAGE_SIZE = 20;

  // ============================================================
  // 静的マスターデータ（AI4S Executive Dashboard 用）
  // ============================================================
  var POLICY_DATA = [
    {
      type: '公募', title: 'AI for Scienceによる科学研究革新プログラム（370億円基金）',
      org: '文部科学省', budget: '370億円', status: '準備中',
      deadline: '2026-06-30', priority: 'S',
      insight: '最優先。チャレンジ型50億円の早期公募に備えてURA中心の応募準備チームを今すぐ編成。',
      url: 'https://www.mext.go.jp/content/20260224-mxt_sinkou01-000047519_5.pdf',
    },
    {
      type: '公募', title: 'AI4Sに不可欠な計算資源の戦略的増強（76億円）',
      org: '文部科学省', budget: '76億円', status: '受付中',
      deadline: '2026-04-15', priority: 'A',
      insight: 'HPCI参加機関が対象。中国地域大学連合での連名申請を探る。',
      url: 'https://www.mext.go.jp/b_menu/boshu/detail/mext_00503.html',
    },
    {
      type: '公募', title: '科学技術イノベーション創出に向けた大学フェローシップ創設事業',
      org: 'JST', budget: '2億円／年', status: '継続公募',
      deadline: '2026-05-31', priority: 'B',
      insight: 'AI4S博士人材の育成に直結。既存フェローシップとの重複確認が必要。',
      url: 'https://www.jst.go.jp/',
    },
    {
      type: '制度', title: '戦略的創造研究推進事業（CREST/さきがけ）AI4S領域',
      org: 'JST', budget: '最大5億円/課題', status: '公募前',
      deadline: '2026-05-15', priority: 'A',
      insight: '岡大のAI4S研究者が核となるCRESTチーム編成を検討。',
      url: 'https://www.jst.go.jp/kisoken/crest/',
    },
    {
      type: '公募', title: '国際科学技術共同研究推進事業（SICORP）日米AI4S',
      org: 'JST', budget: '1億円/件', status: '公募中',
      deadline: '2026-07-31', priority: 'B',
      insight: '日米AI4S政府間合意の後押しあり。米国大学との共同提案を検討。',
      url: 'https://www.jst.go.jp/inter/program/sicorp/',
    },
  ];

  var BENCHMARK_DATA = [
    {
      name: '東京大学', type: '基盤AI・国際連携型',
      center: 'Beyond AI研究推進機構 / GDEPアドバイザリーボード',
      domain: ['LLM基盤モデル', '量子×AI', 'AI倫理・ガバナンス', '生命科学AI'],
      companies: ['SoftBank', 'IBM', 'Microsoft', 'Google'],
      insight: '国内AI4S最高水準。岡大は倫理・ガバナンス面での連携余地を探る。',
      relevance: 3, relevanceLevel: 'mid',
    },
    {
      name: '筑波大学', type: 'AI4S・共創施設型',
      center: 'デジタルヘルスイノベーション棟（DHI棟、2026年12月竣工予定）',
      domain: ['デジタルヘルス', 'AI創薬', '計算科学', '包括的学術情報基盤'],
      companies: ['Amazon (AWS)', 'NVIDIA', 'NTT', 'Fujitsu'],
      insight: 'DHI棟にAmazon・NVIDIA入居予定。岡大の医工連携との差別化が急務。',
      relevance: 4, relevanceLevel: 'high',
    },
    {
      name: '慶應義塾大学', type: '人間中心・学際融合型',
      center: 'KAI（慶應義塾AI研究センター）',
      domain: ['AI×医療', '人間中心設計', 'AI社会実装', 'Well-being科学'],
      companies: ['Fujitsu', 'NEC', 'Panasonic', 'Sony'],
      insight: '塾長が「3年で世界最高峰AIキャンパス」宣言。岡大の差別化戦略見直しが必要。',
      relevance: 3, relevanceLevel: 'mid',
    },
    {
      name: '東北大学', type: '国家中枢・基盤研究型',
      center: 'AI・人間複合知性センター / スーパーコンピュータFUGAKU利用拠点',
      domain: ['材料AI', 'スパコン活用', 'AI防災', 'グリーンAI'],
      companies: ['NTT', 'Hitachi', 'Toyota', 'DENSO'],
      insight: '計算資源・材料科学に強み。岡山大の理工系AI4S研究との競合点を把握。',
      relevance: 2, relevanceLevel: 'low',
    },
    {
      name: '大阪大学', type: '社会実装・産学連携型',
      center: 'AIoT健康社会共創センター / CiDER（感染症総合教育研究拠点）',
      domain: ['AI×感染症', '量子計算', '産業AI', 'AI医療デバイス'],
      companies: ['OMRON', 'Daikin', 'Sharp', 'ROHM'],
      insight: '阪大との西日本連携（共同公募・CREST）が岡大の競争力向上につながる。',
      relevance: 5, relevanceLevel: 'high',
    },
    {
      name: '名古屋大学', type: 'AI4S・産業連携型',
      center: 'C-TEFs（カーボンニュートラル×AI融合拠点）',
      domain: ['モビリティAI', 'カーボンニュートラル', '製造業AI', '自動運転'],
      companies: ['Toyota', 'Denso', 'Aisin', 'Bosch'],
      insight: '製造業AI分野で独走。岡大の農業・バイオ等との棲み分けを明確化する。',
      relevance: 2, relevanceLevel: 'low',
    },
  ];

  var INDUSTRY_DATA = [
    {
      name: 'NVIDIA', sector: 'AI半導体・プラットフォーム', priority: 'A', color: '#76b900',
      univPartners: ['東京大学', '筑波大学', '東北大学'],
      insight: 'DGX SuperPOD等の大学向け整備支援策あり。岡大スパコン更新時に接触すべき。',
    },
    {
      name: 'Amazon (AWS)', sector: 'クラウド・AI基盤', priority: 'A', color: '#ff9900',
      univPartners: ['筑波大学', '慶應義塾大学', '九州大学'],
      insight: 'AWS Research Credits提供を積極活用。筑波DHI棟への入居実績が示す大学連携重視姿勢。',
    },
    {
      name: 'NTTグループ', sector: '通信・AI研究開発', priority: 'A', color: '#0066cc',
      univPartners: ['東京大学', '東北大学', '九州大学', '岡山大学（可能性）'],
      insight: '「tsuzumi」LLMの大学共同研究スキーム検討中。岡大との連携余地を早急に確認。',
    },
    {
      name: 'ユビー', sector: 'AI医療・ヘルステック', priority: 'A', color: '#009688',
      univPartners: ['東京大学', '慶應義塾大学', '京都大学'],
      insight: '地方医療機関との連携を模索中。岡大附属病院との医療AIデータ連携を探る。',
    },
    {
      name: 'Preferred Networks', sector: '産業AI・ロボティクス', priority: 'B', color: '#e91e63',
      univPartners: ['東京大学', '東北大学'],
      insight: '製造業AIと材料科学に特化。岡大の理工系研究室との共同研究窓口を探る。',
    },
    {
      name: 'Fujitsu', sector: 'IT・スパコン・量子', priority: 'B', color: '#e50027',
      univPartners: ['東京大学', '慶應義塾大学', '東北大学'],
      insight: 'Fugaku共同利用機関として連携強化中。岡大のHPCI参加状況を確認する。',
    },
  ];

  var INSIGHTS_DATA = [
    {
      priority: 'S', urgency: '今月中に意思決定',
      title: '【最優先】AI4S科学研究革新370億円基金への応募戦略を策定せよ',
      summary: '2026年度中に公募開始予定のチャレンジ型（50億円）に向け、岡大の強み（農業・医療・環境）を軸にした研究提案チームの組成が急務。URAが中心となり学長・副学長への提言を今月中に行うこと。',
    },
    {
      priority: 'A', urgency: '今四半期中',
      title: '【緊急】AI4S計算資源公募（76億円）への申請可否を判断せよ',
      summary: '締切（4月15日）が迫るHPCI対象計算資源整備補助。岡大単独申請か中国地域連合での申請かを早急に判断し、必要書類の準備を開始すること。',
    },
    {
      priority: 'A', urgency: '今四半期中',
      title: '大阪大学との西日本AI4S連携フレームワーク構築を提案せよ',
      summary: '阪大AIoT拠点との共同公募・人材交流スキームを策定することで、CREST等への採択確率が上がる。まず担当部署間で非公式接触を開始する。',
    },
    {
      priority: 'B', urgency: '半年以内',
      title: 'NTT「tsuzumi」LLM共同研究スキームへの参画を検討せよ',
      summary: 'NTTが検討中の大学向け共同研究プログラムへの参画は、岡大LLM研究の底上げに直結する。NTT研究所に接触し情報収集を先行させること。',
    },
    {
      priority: 'B', urgency: '半年以内',
      title: '岡大AI4Sロードマップ（2026-2030）を策定・公表せよ',
      summary: '慶應・筑波等がAI戦略を相次いで公表する中、岡大独自の強み（農業×AI、医療×AI等）を軸にした中期ロードマップの策定と対外発信が重要。',
    },
  ];

  // ============================================================
  // ヘルパー関数
  // ============================================================
  function getTagClass(tag) {
    var m = {
      '政策': 'tag-policy',
      '公募': 'tag-fund',
      '制度': 'tag-fund',
      '大学': 'tag-univ',
      '国際連携': 'tag-intl',
      '企業': 'tag-corp',
    };
    return m[tag] || 'tag-default';
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      var d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) { return dateStr; }
  }

  function daysUntil(deadline) {
    if (!deadline) return 9999;
    var now = new Date();
    var target = new Date(deadline);
    return Math.round((target - now) / (1000 * 60 * 60 * 24));
  }

  function getPriorityClass(priority) {
    var m = { 'S': 'priority-s', 'A': 'priority-a', 'B': 'priority-b' };
    return m[priority] || '';
  }

  function renderRelevance(score, level) {
    var max = 5;
    var filled = Math.min(score || 0, max);
    var dotClass = level === 'high' ? 'active' : level === 'low' ? '' : 'active';
    var html = '関連度 ';
    for (var i = 1; i <= max; i++) {
      html += '<span class="rel-dot' + (i <= filled ? ' ' + dotClass : '') + '"></span>';
    }
    return html;
  }

  // ── サイドバー & トップバー 生成 ─────────────────────────────
  function initSidebar(pageId, pageTitle) {
    var navItems = [
      { id: 'dashboard', icon: '🏠', label: 'Executive Dashboard', href: 'index.html' },
      { id: 'policy',    icon: '📋', label: '政策・公募',           href: 'policy.html' },
      { id: 'benchmark', icon: '🏛️', label: '大学ベンチマーク',     href: 'benchmark.html' },
      { id: 'industry',  icon: '🏢', label: '産業連携ウォッチ',     href: 'industry.html' },
      { id: 'insights',  icon: '💡', label: '岡大インサイト',       href: 'insights.html' },
      { id: 'timeline',  icon: '📅', label: '政策タイムライン',     href: 'timeline.html' },
      { id: 'sources',   icon: '🗂️', label: '情報収集ソース一覧',   href: 'sources.html' },
    ];

    var sidebarEl = document.getElementById('sidebar');
    if (sidebarEl) {
      sidebarEl.innerHTML =
        '<div class="sidebar-brand">'
        + '<div class="sidebar-brand-name">AI4S 動向ナビ</div>'
        + '<div class="sidebar-brand-sub">岡山大学 戦略インテリジェンス</div>'
        + '</div>'
        + '<nav class="sidebar-nav">'
        + '<div class="sidebar-section-label">メニュー</div>'
        + navItems.map(function(item) {
            return '<a class="nav-item' + (item.id === pageId ? ' active' : '') + '" href="' + item.href + '">'
              + '<span class="nav-icon">' + item.icon + '</span>'
              + item.label
              + '</a>';
          }).join('')
        + '</nav>';
    }

    var topbarEl = document.getElementById('topbar');
    if (topbarEl) {
      topbarEl.innerHTML =
        '<span class="topbar-title">' + pageTitle + '</span>'
        + '<span class="topbar-last-updated" id="topbar-last-updated"></span>';
    }
  }

  // ============================================================
  // index1.txt 方式: データ取得ユーティリティ
  // ============================================================

  /** URL重複排除 */
  function dedupeByUrl(arr) {
    var seen = typeof Set !== 'undefined' ? new Set() : { _d: {}, has: function(k) { return k in this._d; }, add: function(k) { this._d[k] = 1; } };
    return arr.filter(function(d) {
      var key = d.url || '';
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** ローディング表示 */
  function setLoading(visible) {
    var el = document.getElementById('loading-indicator');
    if (el) el.hidden = !visible;
  }

  /** エラー表示 */
  function showError(msg) {
    var el = document.getElementById('error-message');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    setTimeout(function() { el.hidden = true; }, 5000);
  }

  /** last_updated をトップバーに表示 */
  function setLastUpdated(isoString) {
    if (!isoString) return;
    try {
      var dt = new Date(isoString);
      var el = document.getElementById('topbar-last-updated');
      if (el) {
        el.textContent = '最終更新: ' + dt.toLocaleString('ja-JP', {
          month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
      }
    } catch (e) { /* ignore */ }
  }

  /** アイテム配列を日付でグループ化して DATES に格納 */
  function groupByDate(items) {
    DATES = {};
    (items || []).forEach(function(item) {
      var d = item.date || 'unknown';
      if (!DATES[d]) DATES[d] = [];
      DATES[d].push(item);
    });
  }

  /**
   * 日付ごとのデータをオンデマンドでフェッチ (index1.txt 方式)
   * DATES[dateStr] がすでにロード済みならキャッシュを返す
   */
  function loadDateData(dateStr, callback) {
    if (DATES[dateStr] && DATES[dateStr] !== null) {
      callback(DATES[dateStr]);
      return;
    }
    fetch('data/' + dateStr + '.json')
      .then(function(r) {
        if (!r.ok) throw new Error('not found');
        return r.json();
      })
      .then(function(dateData) {
        var items = dateData.items || dateData.news || [];
        items.sort(function(a, b) {
          var sd = (b.score || 0) - (a.score || 0);
          return sd !== 0 ? sd : ((b.date || '') > (a.date || '') ? 1 : -1);
        });
        DATES[dateStr] = items;
        callback(items);
      })
      .catch(function() {
        DATES[dateStr] = DATES[dateStr] || [];
        callback(DATES[dateStr] || []);
      });
  }

  /**
   * メイン初期化 (index1.txt 方式)
   * Promise.all で3つのJSONを並行取得し複数フォーマットに対応
   * @param {function} [onDataLoaded] - データロード完了後のコールバック({DATA, DATES, SORTED_DATES, VAULT, PATENTS})
   */
  function init(onDataLoaded) {
    setLoading(true);

    var newsPromise = fetch('data/news_data.json')
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch(function(e) { console.error('news_data.json load error:', e); return {}; });

    var datesPromise = fetch('data/dates_index.json')
      .then(function(r) { if (!r.ok) return null; return r.json(); })
      .catch(function() { return null; });

    var vaultPromise = fetch('data/permanent_vault.json')
      .then(function(r) { if (!r.ok) return []; return r.json(); })
      .catch(function() { return []; });

    Promise.all([newsPromise, datesPromise, vaultPromise])
      .then(function(results) {
        var json = results[0];
        var datesIndex = results[1];
        var vault = results[2];

        // vault: 配列形式 または {resources:[]} 形式 両対応
        VAULT = Array.isArray(vault) ? vault : (vault.resources || []);

        // news_data.json: 3フォーマット対応 (index1.txt 方式)
        if (Array.isArray(json)) {
          // Format 1: bare array
          groupByDate(json);
          PATENTS = [];
        } else if (json && json.dates) {
          // Format 2: {dates: {'YYYY-MM-DD': [items]}, patents: [], highlights: [], last_updated: ''}
          DATES = json.dates || {};
          PATENTS = json.patents || [];
          setLastUpdated(json.last_updated);
        } else if (json && (json.items || json.news || json.top_topics)) {
          // Format 3: {date, top_topics:[], news:[], items:[], last_updated:'', highlights:[]}
          var allItems = json.items || json.news || json.top_topics || [];
          groupByDate(allItems);
          PATENTS = [];
          setLastUpdated(json.last_updated);
        } else {
          DATES = {};
          PATENTS = [];
        }

        // dates_index.json: 配列形式 または {latest, dates:[]} 形式 両対応
        if (Array.isArray(datesIndex)) {
          // index1.txt 形式: 降順ソート済み配列
          SORTED_DATES = datesIndex;
          datesIndex.forEach(function(d) {
            if (!(d in DATES)) DATES[d] = null;
          });
        } else if (datesIndex && Array.isArray(datesIndex.dates)) {
          // {latest, dates:[]} 形式
          SORTED_DATES = datesIndex.dates;
          datesIndex.dates.forEach(function(d) {
            if (!(d in DATES)) DATES[d] = null;
          });
        } else {
          // フォールバック: DATESのキーから生成
          SORTED_DATES = Object.keys(DATES).filter(function(d) { return d !== 'unknown'; }).sort().reverse();
        }

        SELECTED_DATE_IDX = 0;

        // 各ロード済み日付のアイテムをスコア降順でソート
        SORTED_DATES.forEach(function(d) {
          if (DATES[d] && Array.isArray(DATES[d])) {
            DATES[d].sort(function(a, b) {
              var sd = (b.score || 0) - (a.score || 0);
              return sd !== 0 ? sd : ((b.date || '') > (a.date || '') ? 1 : -1);
            });
          }
        });

        // 最新日付のデータを DATA にセット
        DATA = SORTED_DATES.length > 0 ? (DATES[SORTED_DATES[0]] || []) : [];

        setLoading(false);

        if (typeof onDataLoaded === 'function') {
          onDataLoaded({
            DATA: dedupeByUrl(DATA),
            DATES: DATES,
            SORTED_DATES: SORTED_DATES,
            VAULT: VAULT,
            PATENTS: PATENTS,
          });
        }
      })
      .catch(function(e) {
        console.error('AI4S init error:', e);
        setLoading(false);
        showError('データ読み込みに失敗しました。再読み込みしてください。');
        if (typeof onDataLoaded === 'function') {
          onDataLoaded({ DATA: [], DATES: {}, SORTED_DATES: [], VAULT: [], PATENTS: [] });
        }
      });
  }

  // ============================================================
  // Public API
  // ============================================================
  window.AI4S = {
    // 静的データ
    POLICY_DATA: POLICY_DATA,
    BENCHMARK_DATA: BENCHMARK_DATA,
    INDUSTRY_DATA: INDUSTRY_DATA,
    INSIGHTS_DATA: INSIGHTS_DATA,

    // ヘルパー
    getTagClass: getTagClass,
    formatDate: formatDate,
    daysUntil: daysUntil,
    getPriorityClass: getPriorityClass,
    renderRelevance: renderRelevance,

    // UI初期化
    initSidebar: initSidebar,

    // データ取得 (index1.txt 方式)
    init: init,
    loadDateData: loadDateData,
    dedupeByUrl: dedupeByUrl,
    setLastUpdated: setLastUpdated,

    // ライブアクセサ
    get DATA() { return DATA; },
    get DATES() { return DATES; },
    get SORTED_DATES() { return SORTED_DATES; },
    get VAULT() { return VAULT; },
    get PATENTS() { return PATENTS; },
  };
})();
