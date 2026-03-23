let authToken = localStorage.getItem('admin_token') || '';
let currentDigest = null;
let currentFilter = 'all';
let searchQuery = '';
let selectedPreset = 'gemini';

const CATEGORY_META = {
  'ai-ml': { emoji: '🤖', label: 'AI / ML' }, 'security': { emoji: '🔒', label: '安全' },
  'engineering': { emoji: '⚙️', label: '工程' }, 'tools': { emoji: '🛠', label: '工具' },
  'opinion': { emoji: '💡', label: '观点' }, 'other': { emoji: '📝', label: '其他' },
  'building-tech': { emoji: '🏗', label: '建筑科技' }, 'policy': { emoji: '📋', label: '政策' }, 'product': { emoji: '📦', label: '产品' },
};

// --- Router (hash: #/reports, #/reports/YYYY-MM-DD, #/admin) ---
function getRoute() {
  const hash = window.location.hash.slice(1) || '/reports';
  const parts = hash.replace(/^\/+/, '').split('/');
  if (parts[0] === 'admin') return { view: 'admin' };
  if (parts[0] === 'reports' && parts[1] && /^\d{4}-\d{2}-\d{2}$/.test(parts[1])) return { view: 'detail', date: parts[1] };
  return { view: 'list' };
}

function showView(which) {
  const listPage = document.getElementById('reportsListPage');
  const detailPage = document.getElementById('reportDetailPage');
  const adminPage = document.getElementById('adminPage');
  const digestPanels = ['highlightsSection', 'statsSection', 'filterSection', 'top3Section', 'divider', 'articleSection', 'emptyState', 'skeletonView', 'statusBanner'];
  listPage.classList.toggle('hidden', which !== 'list');
  detailPage.classList.toggle('hidden', which !== 'detail');
  if (adminPage) adminPage.classList.toggle('hidden', which !== 'admin');
  digestPanels.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', which !== 'digest');
  });
  document.getElementById('heroDateSelWrap')?.classList.toggle('hidden', which !== 'digest');
  document.getElementById('generateBtn')?.classList.toggle('hidden', which !== 'digest');
  document.getElementById('settingsBtn')?.classList.toggle('hidden', which !== 'digest');
}

async function showReportsList() {
  showView('list');
  try {
    const res = await apiFetch('/api/digests');
    const data = await res.json();
    if (!data.ok) return;
    const list = data.data || [];
    document.getElementById('reportsListCount').textContent = `共 ${list.length} 份报告`;
    document.getElementById('reportsList').innerHTML = list.map(d => {
      const title = (d.report_title || d.date || '未命名').slice(0, 25);
      const dateLabel = d.date ? `${d.date.slice(0,4)}年${d.date.slice(5,7)}月${d.date.slice(8,10)}日` : d.date;
      return `<a href="#/reports/${d.date}" class="block p-4 rounded-xl border border-cream-200 dark:border-ink-700 hover:bg-cream-50 dark:hover:bg-ink-900 transition">
        <h3 class="font-medium text-ink-800 dark:text-cream-100 mb-1">${escapeHtml(title)}</h3>
        <p class="text-xs text-sand-500">${escapeHtml(dateLabel)}</p>
      </a>`;
    }).join('') || '<p class="text-sm text-sand-500">暂无报告</p>';
  } catch {
    document.getElementById('reportsList').innerHTML = '<p class="text-sm text-sand-500">加载失败</p>';
  }
}

function escapeHtml(s) {
  if (!s) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

async function showReportDetail(date) {
  showView('detail');
  document.getElementById('reportDetailTitle').textContent = '加载中...';
  document.getElementById('reportDetailArticles').innerHTML = '';
  try {
    const res = await apiFetch(`/api/digest/${date}`);
    const data = await res.json();
    if (!data.ok) {
      document.getElementById('reportDetailTitle').textContent = '报告不存在';
      return;
    }
    const d = data.data;
    const title = d.reportTitle || d.highlights?.slice(0, 25) || date;
    document.getElementById('reportDetailTitle').textContent = title;
    document.getElementById('reportDetailDate').textContent = d.date ? `${d.date.slice(0,4)}年${d.date.slice(5,7)}月${d.date.slice(8,10)}日` : date;
    document.getElementById('reportDetailHighlights').textContent = d.highlights || '暂无核心要点';
    const articles = d.articles || [];
    const aiArticles = articles.filter(a => a.source_domain !== 'building');
    const buildingArticles = articles.filter(a => a.source_domain === 'building');
    const sources = [...new Set(articles.map(a => a.source_name).filter(Boolean))].join('、');
    document.getElementById('reportDetailSources').textContent = sources || '—';

    let idx = 1;
    let html = '';

    if (aiArticles.length) {
      html += `<div class="mb-2 text-xs font-medium text-sand-600">AI 资讯（${aiArticles.length} 条）</div>`;
      html += aiArticles.map(a => {
        const card = `
        <div class="border-b border-cream-100 dark:border-ink-800 pb-4 last:border-0">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-xs font-medium text-gold-600 dark:text-gold-400">${idx}</span>
            <span class="text-xs text-sand-500">${escapeHtml(a.source_name || '')}</span>
          </div>
          <h4 class="font-medium mb-2"><a href="${escapeHtml(a.link)}" target="_blank" rel="noopener" class="hover:underline text-ink-800 dark:text-cream-100">${escapeHtml(a.title_zh || a.title || '')}</a></h4>
          <p class="text-sm text-sand-600 dark:text-sand-400">${escapeHtml((a.summary || '').slice(0, 300))}${(a.summary && a.summary.length > 300) ? '…' : ''}</p>
        </div>`;
        idx += 1;
        return card;
      }).join('');
    }

    if (buildingArticles.length) {
      html += `<div class="mt-4 mb-2 text-xs font-medium text-sand-600">建筑科技资讯（${buildingArticles.length} 条）</div>`;
      html += buildingArticles.map(a => {
        const card = `
        <div class="border-b border-cream-100 dark:border-ink-800 pb-4 last:border-0">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-xs font-medium text-gold-600 dark:text-gold-400">${idx}</span>
            <span class="text-xs text-sand-500">${escapeHtml(a.source_name || '')}</span>
          </div>
          <h4 class="font-medium mb-2"><a href="${escapeHtml(a.link)}" target="_blank" rel="noopener" class="hover:underline text-ink-800 dark:text-cream-100">${escapeHtml(a.title_zh || a.title || '')}</a></h4>
          <p class="text-sm text-sand-600 dark:text-sand-400">${escapeHtml((a.summary || '').slice(0, 300))}${(a.summary && a.summary.length > 300) ? '…' : ''}</p>
        </div>`;
        idx += 1;
        return card;
      }).join('');
    }

    document.getElementById('reportDetailArticles').innerHTML = html || '<p class="text-sm text-sand-500">暂无文章</p>';
    document.getElementById('downloadPdfBtn').dataset.date = date;
  } catch {
    document.getElementById('reportDetailTitle').textContent = '加载失败';
  }
}

function route() {
  const r = getRoute();
  if (r.view === 'admin') { showAdminView(); return; }
  if (r.view === 'detail') { showReportDetail(r.date); return; }
  showReportsList();
}

async function showAdminView() {
  showView('admin');
  const loginBlock = document.getElementById('adminLoginBlock');
  const mainBlock = document.getElementById('adminMainBlock');
  if (!loginBlock || !mainBlock) return;

  if (authToken) {
    try {
      const res = await fetch('/api/auth/me', { headers: { 'X-Auth-Token': authToken } });
      const data = await res.json();
      if (data.ok && data.username) {
        loginBlock.classList.add('hidden');
        mainBlock.classList.remove('hidden');
        document.getElementById('adminUserLabel').textContent = `已登录：${data.username}`;
        loadAdminConfig();
        initAdminTabs();
        return;
      }
    } catch {}
  }
  authToken = '';
  localStorage.removeItem('admin_token');
  loginBlock.classList.remove('hidden');
  mainBlock.classList.add('hidden');
  document.getElementById('adminLoginUser')?.focus();
}

window.addEventListener('hashchange', route);

// --- Admin page ---
let adminRssSources = [];

function initAdminTabs() {
  const allTabs = ['adminApiTab', 'adminScheduleTab', 'adminRssTab', 'adminWxmpTab', 'adminPasswordTab'];
  const tabMap = { api: 'adminApiTab', schedule: 'adminScheduleTab', rss: 'adminRssTab', wxmp: 'adminWxmpTab', password: 'adminPasswordTab' };
  document.querySelectorAll('.admin-tab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      allTabs.forEach(id => { const el = document.getElementById(id); if (el) el.classList.toggle('hidden', id !== tabMap[tab]); });
      if (tab === 'rss') loadAdminRssList();
    };
  });
}

async function loadAdminConfig() {
  try {
    const res = await apiFetch('/api/config');
    const data = await res.json();
    if (data.ok && data.data) {
      const c = data.data;
      const preset = c.preset || 'doubao';
      document.querySelectorAll('#adminPresetBtns .preset-btn').forEach(b => b.classList.toggle('active', b.dataset.preset === preset));
      const hintEl = document.getElementById('adminPresetHint');
      if (hintEl) hintEl.textContent = PRESET_HINTS[preset] || '';
      if (c.apiKeyMasked) document.getElementById('adminCfgApiKey').placeholder = c.apiKeyMasked;
      document.getElementById('adminCfgBaseURL').value = c.baseURL || '';
      document.getElementById('adminCfgModel').value = c.model || '';
      if (c.schedules?.length) {
        const s = c.schedules[0];
        document.getElementById('adminScheduleEnabled').checked = !!s.enabled;
        document.getElementById('adminScheduleHour').value = s.hour ?? 8;
        document.getElementById('adminScheduleHours').value = s.hours ?? 24;
        document.getElementById('adminScheduleTopN').value = s.topN ?? 15;
      }
    }
    const rres = await apiFetch('/api/rss-sources');
    const rdata = await rres.json();
    if (rdata.ok) adminRssSources = rdata.data.custom?.length ? rdata.data.custom : (rdata.data.default || []);
  } catch {}
}

async function loadAdminRssList() {
  if (adminRssSources.length === 0) {
    try {
      const res = await apiFetch('/api/rss-sources');
      const data = await res.json();
      if (data.ok) adminRssSources = data.data.custom?.length ? data.data.custom : (data.data.default || []);
    } catch {}
  }
  const list = document.getElementById('adminRssList');
  if (!list) return;
  const countEl = document.getElementById('adminRssCount');
  list.innerHTML = adminRssSources.map((s, i) => {
    const isBuilding = s.domain === 'building';
    return `
    <div class="flex items-center gap-2 p-3 hover:bg-cream-50 dark:hover:bg-ink-900">
      <div class="flex-1 min-w-0"><div class="text-xs font-medium truncate">${escapeHtml(s.name)}</div><div class="text-[10px] text-sand-500 truncate">${escapeHtml(s.xmlUrl)}</div></div>
      <select class="rss-domain-sel text-[10px] px-1.5 py-0.5 rounded border border-cream-200 dark:border-ink-700 bg-white dark:bg-ink-900 text-ink-800 dark:text-cream-200" data-index="${i}">
        <option value="ai" ${isBuilding ? '' : 'selected'}>AI资讯</option>
        <option value="building" ${isBuilding ? 'selected' : ''}>建筑科技</option>
      </select>
      <button type="button" class="text-xs px-2 py-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950" data-index="${i}">删除</button>
    </div>`;
  }).join('');
  if (countEl) {
    countEl.textContent = adminRssSources.length ? `（共 ${adminRssSources.length} 个订阅源）` : '（暂无订阅源）';
  }
  list.querySelectorAll('select.rss-domain-sel').forEach(sel => {
    sel.onchange = () => {
      const idx = parseInt(sel.dataset.index);
      adminRssSources[idx].domain = sel.value;
    };
  });
  list.querySelectorAll('button[data-index]').forEach(btn => {
    btn.onclick = () => { adminRssSources.splice(parseInt(btn.dataset.index), 1); loadAdminRssList(); };
  });
}

// --- WeRSS export (微信公众号 RSS 清单导出) ---
let werssExportedList = [];

async function exportWxRssList() {
  const statusEl = document.getElementById('werssExportStatus');
  const listEl = document.getElementById('werssExportList');
  const importBtn = document.getElementById('werssImportAllBtn');
  if (!listEl) return;
  statusEl.textContent = '正在读取…';
  importBtn?.classList.add('hidden');
  listEl.classList.add('hidden');
  try {
    const res = await apiFetch('/api/werss/export');
    const data = await res.json();
    if (!data.ok) { statusEl.textContent = data.error || '读取失败'; return; }
    const list = data.data?.list || [];
    werssExportedList = list;
    if (list.length === 0) {
      statusEl.textContent = '暂无已订阅的公众号，请先到 we-mp-rss 管理界面添加订阅';
      listEl.innerHTML = '';
      listEl.classList.add('hidden');
      return;
    }
    statusEl.textContent = `共 ${list.length} 个公众号`;
    importBtn?.classList.remove('hidden');
    const existingUrls = new Set(adminRssSources.map(s => s.xmlUrl));
    listEl.innerHTML = list.map(mp => {
      const alreadyAdded = existingUrls.has(mp.rssUrl);
      return `<div class="flex items-center gap-2 p-2.5 hover:bg-cream-50 dark:hover:bg-ink-900">
        <div class="flex-1 min-w-0">
          <div class="text-xs font-medium truncate">${escapeHtml(mp.name)}</div>
          <div class="text-[10px] text-sand-400 dark:text-sand-600 truncate select-all">${escapeHtml(mp.rssUrl)}</div>
        </div>
        <button type="button" class="werss-add-one text-xs px-2 py-1 rounded shrink-0 ${alreadyAdded ? 'bg-green-100 dark:bg-green-900/30 text-green-600' : 'bg-gold-500/20 text-gold-600 dark:text-gold-400'}" data-name="${escapeHtml(mp.name)}" data-url="${escapeHtml(mp.rssUrl)}" ${alreadyAdded ? 'disabled' : ''}>${alreadyAdded ? '已添加' : '添加'}</button>
      </div>`;
    }).join('');
    listEl.classList.remove('hidden');
    listEl.querySelectorAll('.werss-add-one:not([disabled])').forEach(btn => {
      btn.onclick = () => {
        adminRssSources.push({ name: btn.dataset.name, xmlUrl: btn.dataset.url, htmlUrl: '', domain: 'building' });
        loadAdminRssList();
        btn.textContent = '已添加';
        btn.disabled = true;
        btn.classList.remove('bg-gold-500/20', 'text-gold-600', 'dark:text-gold-400');
        btn.classList.add('bg-green-100', 'dark:bg-green-900/30', 'text-green-600');
        window.showToast?.(`已添加：${btn.dataset.name}`, 'success');
      };
    });
  } catch (e) {
    statusEl.textContent = '读取失败: ' + (e.message || '网络错误');
  }
}

function importAllWxRss() {
  if (!werssExportedList.length) return;
  const existingUrls = new Set(adminRssSources.map(s => s.xmlUrl));
  let added = 0;
  for (const mp of werssExportedList) {
    if (!existingUrls.has(mp.rssUrl)) {
      adminRssSources.push({ name: mp.name, xmlUrl: mp.rssUrl, htmlUrl: '', domain: 'building' });
      existingUrls.add(mp.rssUrl);
      added++;
    }
  }
  if (added > 0) {
    loadAdminRssList();
    exportWxRssList();
    window.showToast?.(`已添加 ${added} 个公众号 RSS 源`, 'success');
  } else {
    window.showToast?.('所有公众号 RSS 源已在列表中', 'info');
  }
}

document.getElementById('werssExportBtn')?.addEventListener('click', exportWxRssList);
document.getElementById('werssImportAllBtn')?.addEventListener('click', importAllWxRss);

document.getElementById('adminTestApiBtn')?.addEventListener('click', async () => {
  const apiKey = document.getElementById('adminCfgApiKey').value.trim();
  const baseURL = document.getElementById('adminCfgBaseURL').value.trim();
  const model = document.getElementById('adminCfgModel').value.trim();
  const preset = document.querySelector('#adminPresetBtns .preset-btn.active')?.dataset?.preset || 'custom';
  const resultEl = document.getElementById('adminTestResult');
  if (!apiKey) { resultEl.textContent = '请先输入 API Key'; return; }
  resultEl.textContent = '测试中...';
  try {
    const res = await apiFetch('/api/test-connection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset, apiKey, baseURL, model }) });
    const data = await res.json();
    resultEl.textContent = data.ok ? '✅ 连接成功' : `❌ ${data.error || '失败'}`;
  } catch { resultEl.textContent = '❌ 网络错误'; }
});

document.getElementById('adminSaveBtn')?.addEventListener('click', async () => {
  const apiKey = document.getElementById('adminCfgApiKey').value.trim();
  const baseURL = document.getElementById('adminCfgBaseURL').value.trim();
  const model = document.getElementById('adminCfgModel').value.trim();
  const preset = document.querySelector('#adminPresetBtns .preset-btn.active')?.dataset?.preset || 'custom';
  const scheduleEnabled = document.getElementById('adminScheduleEnabled').checked;
  const hour = parseInt(document.getElementById('adminScheduleHour').value) || 8;
  const hours = parseInt(document.getElementById('adminScheduleHours').value) || 24;
  const topN = parseInt(document.getElementById('adminScheduleTopN').value) || 15;
  if (!apiKey) { window.showToast?.('请输入 API Key', 'error'); return; }
  const needsBaseURL = ['custom', 'doubao', 'openai'].includes(preset);
  const needsModel = ['custom', 'doubao', 'openai', 'minimax'].includes(preset);
  const schedules = scheduleEnabled ? [{ enabled: true, preset, hour, minute: 0, hours, topN, baseURL: needsBaseURL ? baseURL : '', model: needsModel ? model : '' }] : [];
  try {
    await apiFetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset, apiKey, baseURL, model, schedules }) });
    await apiFetch('/api/rss-sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sources: adminRssSources }) });
    window.showToast?.('配置已保存', 'success');
  } catch { window.showToast?.('保存失败', 'error'); }
});

document.getElementById('adminPresetBtns')?.addEventListener('click', e => {
  const btn = e.target.closest('.preset-btn');
  if (!btn) return;
  const preset = btn.dataset.preset;
  document.querySelectorAll('#adminPresetBtns .preset-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const hintEl = document.getElementById('adminPresetHint');
  if (hintEl) hintEl.textContent = PRESET_HINTS[preset] || '';
  if (preset === 'doubao') {
    document.getElementById('adminCfgBaseURL').value = 'https://ark.cn-beijing.volces.com/api/v3';
    document.getElementById('adminCfgModel').value = 'doubao-seed-1-6-251015';
  } else if (preset === 'minimax') {
    document.getElementById('adminCfgBaseURL').value = '';
    document.getElementById('adminCfgModel').value = 'MiniMax-M2.7';
  } else if (preset === 'openai') {
    document.getElementById('adminCfgBaseURL').value = 'https://api.openai.com/v1';
    document.getElementById('adminCfgModel').value = 'gpt-4o-mini';
  } else if (preset === 'custom') {
    document.getElementById('adminCfgBaseURL').value = '';
    document.getElementById('adminCfgModel').value = '';
    document.getElementById('adminCfgBaseURL').placeholder = 'https://your-api-provider.com/v1';
    document.getElementById('adminCfgModel').placeholder = '输入模型 ID';
  }
});

document.getElementById('adminTestRssBtn')?.addEventListener('click', async () => {
  const url = document.getElementById('adminRssUrl').value.trim();
  const resultEl = document.getElementById('adminRssTestResult');
  if (!url) return;
  resultEl.textContent = '测试中...';
  resultEl.classList.remove('hidden');
  try {
    const res = await apiFetch('/api/rss-sources/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ xmlUrl: url }) });
    const data = await res.json();
    resultEl.textContent = data.ok ? '✅ RSS 源可访问' : `❌ ${data.error}`;
  } catch { resultEl.textContent = '❌ 网络错误'; }
  resultEl.classList.remove('hidden');
});

document.getElementById('adminAddRssBtn')?.addEventListener('click', () => {
  const name = document.getElementById('adminRssName').value.trim();
  const url = document.getElementById('adminRssUrl').value.trim();
  const domainSel = document.getElementById('adminRssDomain');
  const domain = domainSel ? domainSel.value : 'ai';
  if (!name || !url) return;
  adminRssSources.push({ name, xmlUrl: url, htmlUrl: url.replace(/\/feed.*$/, ''), domain });
  loadAdminRssList();
  document.getElementById('adminRssName').value = '';
  document.getElementById('adminRssUrl').value = '';
  document.getElementById('adminRssTestResult').classList.add('hidden');
});

document.getElementById('adminResetRssBtn')?.addEventListener('click', async () => {
  if (!confirm('确定恢复默认 RSS 源？')) return;
  try {
    await apiFetch('/api/rss-sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sources: [] }) });
    adminRssSources = [];
    const res = await apiFetch('/api/rss-sources');
    const data = await res.json();
    if (data.ok) adminRssSources = data.data.default || [];
    loadAdminRssList();
  } catch {}
});

document.getElementById('adminGenerateBtn')?.addEventListener('click', async () => {
  const res = await apiFetch('/api/digest/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  const data = await res.json();
  if (data.ok) { window.showToast?.('已开始生成'); watchStatus(); }
  else window.showToast?.(data.message || '生成失败', 'error');
});

// Convert score (0-30) to star rating HTML
function renderStars(score) {
  const rating = Math.round((score / 30) * 10) / 2; // Convert to 0-5 scale, round to 0.5
  const fullStars = Math.floor(rating);
  const hasHalf = rating % 1 !== 0;
  const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);

  let html = '<span class="inline-flex items-center gap-0.5" title="' + score + '/30">';
  for (let i = 0; i < fullStars; i++) html += '<svg class="w-3.5 h-3.5 text-warm-500 fill-current" viewBox="0 0 20 20"><path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z"/></svg>';
  if (hasHalf) html += '<svg class="w-3.5 h-3.5 text-warm-500" viewBox="0 0 20 20"><defs><linearGradient id="half"><stop offset="50%" stop-color="currentColor"/><stop offset="50%" stop-color="transparent"/></linearGradient></defs><path fill="url(#half)" d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z"/></svg>';
  for (let i = 0; i < emptyStars; i++) html += '<svg class="w-3.5 h-3.5 text-sand-300 dark:text-ink-700" viewBox="0 0 20 20"><path fill="currentColor" d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z"/></svg>';
  html += '</span>';
  return html;
}

const PRESET_HINTS = {
  gemini: '免费获取: aistudio.google.com/apikey',
  doubao: '获取: console.volcengine.com/ark',
  openai: '获取: platform.openai.com/api-keys',
  minimax: '获取: platform.minimaxi.com/user-center/basic-information',
  custom: '填入任意 OpenAI 兼容服务的 API Key',
};

const API_PRESETS = {
  gemini: { name: 'Google Gemini' },
  doubao: { name: '豆包 Doubao' },
  openai: { name: 'OpenAI' },
  minimax: { name: 'MiniMax' },
  custom: { name: '自定义' },
};

// --- Theme ---
function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark') document.documentElement.classList.add('dark');
  else if (saved === 'light') document.documentElement.classList.remove('dark');
  else if (window.matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.classList.add('dark');
}
initTheme();

document.getElementById('themeToggle').addEventListener('click', () => {
  document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
});

// --- Admin Auth ---
function showApp() {
  document.getElementById('mainApp').classList.remove('hidden');
}

// Admin login
document.getElementById('adminLoginBtn')?.addEventListener('click', doAdminLogin);
document.getElementById('adminLoginPass')?.addEventListener('keydown', e => { if (e.key === 'Enter') doAdminLogin(); });
document.getElementById('adminLoginUser')?.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('adminLoginPass')?.focus(); });

async function doAdminLogin() {
  const username = document.getElementById('adminLoginUser')?.value?.trim();
  const password = document.getElementById('adminLoginPass')?.value;
  if (!username || !password) return;
  const errEl = document.getElementById('adminLoginError');
  errEl?.classList.add('hidden');
  try {
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await res.json();
    if (data.ok) {
      authToken = data.token;
      localStorage.setItem('admin_token', authToken);
      showAdminView();
    } else {
      if (errEl) { errEl.textContent = data.message || '用户名或密码错误'; errEl.classList.remove('hidden'); }
      document.getElementById('adminLoginPass').value = '';
    }
  } catch {
    if (errEl) { errEl.textContent = '网络错误'; errEl.classList.remove('hidden'); }
  }
}

// Admin logout
document.getElementById('adminLogoutBtn')?.addEventListener('click', () => {
  authToken = '';
  localStorage.removeItem('admin_token');
  showAdminView();
});

// Change password
document.getElementById('changePwdBtn')?.addEventListener('click', async () => {
  const oldPwd = document.getElementById('changePwdOld')?.value;
  const newPwd = document.getElementById('changePwdNew')?.value;
  const confirmPwd = document.getElementById('changePwdConfirm')?.value;
  const resultEl = document.getElementById('changePwdResult');
  if (!resultEl) return;
  resultEl.classList.add('hidden');

  if (!oldPwd || !newPwd || !confirmPwd) {
    resultEl.textContent = '请填写所有字段';
    resultEl.className = 'text-xs text-red-500';
    resultEl.classList.remove('hidden');
    return;
  }
  if (newPwd !== confirmPwd) {
    resultEl.textContent = '两次输入的新密码不一致';
    resultEl.className = 'text-xs text-red-500';
    resultEl.classList.remove('hidden');
    return;
  }
  if (newPwd.length < 6) {
    resultEl.textContent = '新密码至少 6 个字符';
    resultEl.className = 'text-xs text-red-500';
    resultEl.classList.remove('hidden');
    return;
  }
  try {
    const res = await apiFetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }),
    });
    const data = await res.json();
    if (data.ok) {
      resultEl.textContent = '密码修改成功';
      resultEl.className = 'text-xs text-green-600';
      resultEl.classList.remove('hidden');
      document.getElementById('changePwdOld').value = '';
      document.getElementById('changePwdNew').value = '';
      document.getElementById('changePwdConfirm').value = '';
    } else {
      resultEl.textContent = data.message || '修改失败';
      resultEl.className = 'text-xs text-red-500';
      resultEl.classList.remove('hidden');
    }
  } catch {
    resultEl.textContent = '网络错误';
    resultEl.className = 'text-xs text-red-500';
    resultEl.classList.remove('hidden');
  }
});

// 公众号管理 - 打开 we-mp-rss
document.getElementById('openWerssBtn')?.addEventListener('click', () => {
  const werssUrl = window.location.protocol + '//' + window.location.hostname + ':8001';
  window.open(werssUrl, '_blank', 'noopener');
});

// 公众号管理 - 一键刷新所有公众号
document.getElementById('refreshAllMpsBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('refreshAllMpsBtn');
  const resultEl = document.getElementById('refreshMpsResult');
  btn.disabled = true;
  btn.textContent = '正在刷新...';
  resultEl.classList.remove('hidden');
  resultEl.innerHTML = '<p>正在获取公众号列表并逐个刷新，请稍候...</p>';
  try {
    const res = await apiFetch('/api/werss/refresh', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      const d = data.data;
      let html = `<p><strong>刷新完成：</strong>共 ${d.total} 个公众号，成功更新 ${d.updated} 个</p>`;
      if (d.results?.length) {
        html += '<div class="mt-2 space-y-0.5">';
        for (const r of d.results) {
          const icon = r.ok ? '✓' : '✗';
          const color = r.ok ? 'text-green-600' : 'text-red-500';
          html += `<p class="${color}">${icon} ${r.name || r.mpId}${r.error ? ' — ' + r.error : ''}</p>`;
        }
        html += '</div>';
      }
      resultEl.innerHTML = html;
      window.showToast?.(`刷新完成：${d.updated}/${d.total} 个公众号`, 'success');
    } else {
      resultEl.innerHTML = `<p class="text-red-500">刷新失败：${data.error || '未知错误'}</p>`;
      window.showToast?.(data.error || '刷新失败', 'error');
    }
  } catch (e) {
    resultEl.innerHTML = `<p class="text-red-500">请求失败：${e.message}</p>`;
    window.showToast?.('网络错误', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '一键刷新所有公众号';
  }
});

function apiFetch(url, opts = {}) { opts.headers = { ...opts.headers, 'X-Auth-Token': authToken }; return fetch(url, opts); }

// --- Time ---
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
  if (m < 60) return `${m}分钟前`; if (h < 24) return `${h}小时前`; if (d < 7) return `${d}天前`;
  return dateStr.slice(0, 10);
}

// --- Render ---
function renderDigest(digest) {
  currentDigest = digest;
  ['highlightsSection','statsSection','filterSection','top3Section','divider','articleSection'].forEach(id => document.getElementById(id).classList.remove('hidden'));
  document.getElementById('emptyState').classList.add('hidden');
  document.getElementById('digestDate').textContent = digest.date;
  document.getElementById('highlightsText').textContent = digest.highlights || '暂无今日看点';
  document.getElementById('statSources').textContent = `${digest.success_feeds||digest.successFeeds||0}/${digest.total_feeds||digest.totalFeeds||90}`;
  document.getElementById('statTotal').textContent = digest.total_articles||digest.totalArticles||'-';
  document.getElementById('statFiltered').textContent = digest.filtered_articles||digest.filteredArticles||'-';
  document.getElementById('statSelected').textContent = digest.articles?.length||0;
  renderArticles();
  document.dispatchEvent(new CustomEvent('digestRendered', { detail: { digest } }));
}

function renderArticles() {
  if (!currentDigest?.articles) return;
  let articles = [...currentDigest.articles];
  if (currentFilter !== 'all') articles = articles.filter(a => a.category === currentFilter);
  if (searchQuery) { const q = searchQuery.toLowerCase(); articles = articles.filter(a => (a.title_zh||'').toLowerCase().includes(q)||(a.title||'').toLowerCase().includes(q)||(a.summary||'').toLowerCase().includes(q)||(a.source_name||'').toLowerCase().includes(q)||(a.keywords||[]).some(k=>k.toLowerCase().includes(q))); }

  const top3 = articles.slice(0, 3);
  const ranks = ['gold','silver','bronze'];
  document.getElementById('top3Grid').innerHTML = top3.map((a, i) => `
    <div class="top-card ${ranks[i]}">
      <div class="flex items-center gap-3 mb-4">
        <span class="medal ${ranks[i]}">${i+1}</span>
        <span class="category-badge" data-cat="${a.category}">${CATEGORY_META[a.category]?.label||a.category}</span>
        <span class="ml-auto">${renderStars(a.score)}</span>
      </div>
      <h3 class="text-lg sm:text-xl font-semibold leading-tight mb-3">
        <a href="${a.link}" target="_blank" rel="noopener" class="hover:text-warm-600 dark:hover:text-warm-400 transition">${a.title_zh||a.title}</a>
      </h3>
      <p class="text-xs text-sand-400 mb-4 line-clamp-1">${a.title}</p>
      <p class="text-sm sm:text-base leading-relaxed text-sand-600 dark:text-sand-400 mb-4 line-clamp-4">${a.summary||''}</p>
      ${a.reason?`<p class="text-xs text-warm-600 dark:text-warm-400 mb-4 italic leading-relaxed">"${a.reason}"</p>`:''}
      <div class="flex items-center gap-2 text-xs text-sand-400 pt-3 border-t border-sand-100 dark:border-ink-800">
        <span class="font-medium truncate">${a.source_name}</span>
        <span class="opacity-30 shrink-0">·</span>
        <span class="shrink-0 whitespace-nowrap">${timeAgo(a.pub_date)}</span>
      </div>
      ${(a.keywords||[]).length?`<div class="flex flex-wrap gap-2 mt-4">${a.keywords.map(k=>`<span class="keyword-tag">${k}</span>`).join('')}</div>`:''}
    </div>`).join('');

  const rest = articles.slice(3);
  document.getElementById('articleList').innerHTML = rest.map((a, i) => `
    <div class="article-card group">
      <div class="flex items-start gap-4 sm:gap-6">
        <span class="text-lg sm:text-xl font-light text-sand-200 dark:text-ink-800 mt-1 w-8 text-right shrink-0">${i + 4}</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-3 flex-wrap">
            <span class="category-badge" data-cat="${a.category}">${CATEGORY_META[a.category]?.label||a.category}</span>
            ${renderStars(a.score)}
          </div>
          <h3 class="article-title group-hover:text-warm-600 dark:group-hover:text-warm-400 transition">
            <a href="${a.link}" target="_blank" rel="noopener" class="hover:underline">${a.title_zh||a.title}</a>
          </h3>
          <p class="text-xs text-sand-400 mb-3 line-clamp-1">${a.title}</p>
          <p class="article-summary line-clamp-3">${a.summary||''}</p>
          <div class="flex items-center gap-2 article-meta mt-4">
            <span class="font-medium truncate">${a.source_name}</span>
            <span class="opacity-30 shrink-0">·</span>
            <span class="shrink-0 whitespace-nowrap">${timeAgo(a.pub_date)}</span>
          </div>
          ${(a.keywords||[]).length?`<div class="flex flex-wrap gap-2 mt-4">${a.keywords.map(k=>`<span class="keyword-tag">${k}</span>`).join('')}</div>`:''}
        </div>
      </div>
    </div>`).join('');

  document.getElementById('top3Section').classList.toggle('hidden', top3.length === 0);
  document.getElementById('divider').classList.toggle('hidden', rest.length === 0);
  document.getElementById('articleSection').classList.toggle('hidden', rest.length === 0);
}

// --- Filters ---
document.querySelectorAll('.cat-btn').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active'); currentFilter = btn.dataset.cat; renderArticles();
}));
let searchTimer = null;
document.getElementById('searchInput').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { searchQuery = e.target.value; renderArticles(); }, 300);
});

// --- Share ---
document.getElementById('shareBtn').addEventListener('click', async () => {
  if (!currentDigest?.date) return;
  try {
    const res = await apiFetch('/api/digest/share', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: currentDigest.date }),
    });
    const data = await res.json();
    if (data.ok) {
      const url = data.url;
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        window.showToast?.('分享链接已复制', 'success', url);
      } else {
        prompt('分享链接（对方无需登录）：', url);
      }
    } else { window.showToast?.('生成分享链接失败', 'error'); }
  } catch { window.showToast?.('网络错误', 'error'); }
});

// --- Share page detection ---
async function checkSharePage() {
  const path = window.location.pathname;
  const match = path.match(/^\/share\/([a-f0-9]+)$/);
  if (!match) return false;
  try {
    const res = await fetch(`/api/share/${match[1]}`);
    const data = await res.json();
    if (data.ok) {
      document.getElementById('mainApp').classList.remove('hidden');
      document.getElementById('reportsListPage').classList.add('hidden');
      document.getElementById('reportDetailPage').classList.add('hidden');
      document.getElementById('generateBtn').classList.add('hidden');
      document.getElementById('settingsBtn').classList.add('hidden');
      document.getElementById('shareBtn').classList.add('hidden');
      document.getElementById('themeToggle').classList.add('hidden');
      document.getElementById('navReports').classList.add('hidden');
      document.getElementById('navAdmin').classList.add('hidden');
      document.getElementById('heroDateSelWrap')?.classList.add('hidden');
      renderDigest(data.data);
      return true;
    }
  } catch {}
  return false;
}

// --- Settings: per-channel scheduling ---
const settingsModal = document.getElementById('settingsModal');

// Tab switching
document.querySelectorAll('.settings-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.settings-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('apiTab').classList.toggle('hidden', tab !== 'api');
    document.getElementById('rssTab').classList.toggle('hidden', tab !== 'rss');
    if (tab === 'rss') loadRssSources();
  });
});

// RSS source management
let rssSources = [];

async function loadRssSources() {
  try {
    const res = await apiFetch('/api/rss-sources');
    const data = await res.json();
    if (data.ok) {
      rssSources = data.data.custom && data.data.custom.length > 0 ? data.data.custom : data.data.default;
      renderRssList();
    }
  } catch {}
}

function renderRssList() {
  const list = document.getElementById('rssList');
  list.innerHTML = rssSources.map((s, i) => {
    const isBuilding = s.domain === 'building';
    return `
    <div class="flex items-center gap-2 p-3 hover:bg-sand-50 dark:hover:bg-ink-950 transition">
      <div class="flex-1 min-w-0">
        <div class="text-xs font-medium truncate">${s.name}</div>
        <div class="text-[10px] text-sand-400 truncate">${s.xmlUrl}</div>
      </div>
      <select class="modal-domain-sel text-[10px] px-1.5 py-0.5 rounded border border-cream-200 dark:border-ink-700 bg-white dark:bg-ink-900" data-index="${i}">
        <option value="ai" ${isBuilding ? '' : 'selected'}>AI资讯</option>
        <option value="building" ${isBuilding ? 'selected' : ''}>建筑科技</option>
      </select>
      <button class="text-xs px-2 py-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition" onclick="removeRss(${i})">删除</button>
    </div>`;
  }).join('');
  list.querySelectorAll('select.modal-domain-sel').forEach(sel => {
    sel.onchange = () => {
      rssSources[parseInt(sel.dataset.index)].domain = sel.value;
      saveRssSources();
    };
  });
}

window.removeRss = (index) => {
  rssSources.splice(index, 1);
  renderRssList();
  saveRssSources();
};

async function saveRssSources() {
  try {
    await apiFetch('/api/rss-sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources: rssSources }),
    });
  } catch {}
}

document.getElementById('testRssBtn').addEventListener('click', async () => {
  const url = document.getElementById('rssUrl').value.trim();
  const resultEl = document.getElementById('rssTestResult');
  const btn = document.getElementById('testRssBtn');
  if (!url) return;
  btn.disabled = true;
  btn.textContent = '测试中...';
  resultEl.textContent = '正在测试...';
  resultEl.className = 'text-[10px] text-sand-500';
  resultEl.classList.remove('hidden');
  try {
    const res = await apiFetch('/api/rss-sources/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xmlUrl: url }),
    });
    const data = await res.json();
    if (data.ok) {
      resultEl.textContent = '✅ RSS 源可访问';
      resultEl.className = 'text-[10px] text-green-600 dark:text-green-400';
    } else {
      resultEl.textContent = `❌ 失败: ${data.error}`;
      resultEl.className = 'text-[10px] text-red-500';
    }
  } catch {
    resultEl.textContent = '❌ 网络错误';
    resultEl.className = 'text-[10px] text-red-500';
  } finally {
    btn.disabled = false;
    btn.textContent = '测试';
  }
});

document.getElementById('addRssBtn').addEventListener('click', () => {
  const name = document.getElementById('rssName').value.trim();
  const url = document.getElementById('rssUrl').value.trim();
  const domainSel = document.getElementById('rssDomainSel');
  const domain = domainSel ? domainSel.value : 'ai';
  if (!name || !url) return;
  rssSources.push({ name, xmlUrl: url, htmlUrl: url.replace(/\/feed.*$/, ''), domain });
  renderRssList();
  saveRssSources();
  document.getElementById('rssName').value = '';
  document.getElementById('rssUrl').value = '';
  document.getElementById('rssTestResult').classList.add('hidden');
});

document.getElementById('resetRssBtn').addEventListener('click', async () => {
  if (!confirm('确定要恢复默认 RSS 源吗？这将删除所有自定义源。')) return;
  try {
    await apiFetch('/api/rss-sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources: [] }),
    });
    loadRssSources();
  } catch {}
});

document.getElementById('settingsBtn').addEventListener('click', async () => {
  settingsModal.classList.remove('hidden');
  // Load saved config
  try {
    const res = await apiFetch('/api/config');
    const data = await res.json();
    if (data.ok && data.data) {
      const c = data.data;
      selectPreset(c.preset || 'gemini');
      if (c.apiKeyMasked) document.getElementById('cfgApiKey').placeholder = c.apiKeyMasked;
      if (c.baseURL) document.getElementById('cfgBaseURL').value = c.baseURL;
      if (c.model) document.getElementById('cfgModel').value = c.model;
      if (c.schedules?.length) {
        const s = c.schedules[0];
        document.getElementById('cfgScheduleEnabled').checked = s.enabled;
        toggleScheduleFields(s.enabled);
        if (s.hour !== undefined) document.getElementById('cfgScheduleHour').value = s.hour;
        if (s.hours) document.getElementById('cfgScheduleHours').value = s.hours;
        if (s.topN) document.getElementById('cfgScheduleTopN').value = s.topN;
      }
    }
  } catch {}
});
document.getElementById('settingsCancel').addEventListener('click', () => settingsModal.classList.add('hidden'));
settingsModal.addEventListener('click', e => { if (e.target === settingsModal) settingsModal.classList.add('hidden'); });

function selectPreset(preset) {
  selectedPreset = preset;
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.toggle('active', b.dataset.preset === preset));
  document.getElementById('cfgApiKeyHint').textContent = PRESET_HINTS[preset] || '';
  const showCustom = preset === 'custom' || preset === 'doubao' || preset === 'minimax' || preset === 'openai';
  document.getElementById('customFields').classList.toggle('hidden', !showCustom);
  // Pre-fill base URL / model for known presets
  if (preset === 'doubao') {
    const base = document.getElementById('cfgBaseURL');
    const model = document.getElementById('cfgModel');
    if (!base.value) base.value = 'https://ark.cn-beijing.volces.com/api/v3';
    if (!model.value) model.value = 'doubao-seed-1-6-251015';
  } else if (preset === 'minimax') {
    const model = document.getElementById('cfgModel');
    if (!model.value) model.value = 'MiniMax-M2.7';
  } else if (preset === 'openai') {
    const base = document.getElementById('cfgBaseURL');
    const model = document.getElementById('cfgModel');
    if (!base.value) base.value = 'https://api.openai.com/v1';
    if (!model.value) model.value = 'gpt-4o-mini';
  } else if (preset === 'custom') {
    document.getElementById('cfgBaseURL').placeholder = 'https://your-api-provider.com/v1';
    document.getElementById('cfgModel').placeholder = '输入模型 ID';
  }
}

document.querySelectorAll('.preset-btn').forEach(btn => btn.addEventListener('click', () => selectPreset(btn.dataset.preset)));

// Test API connection
document.getElementById('testApiBtn').addEventListener('click', async () => {
  const apiKey = document.getElementById('cfgApiKey').value.trim();
  const baseURL = document.getElementById('cfgBaseURL')?.value?.trim() || '';
  const model = document.getElementById('cfgModel')?.value?.trim() || '';
  const resultEl = document.getElementById('testResult');
  const btn = document.getElementById('testApiBtn');

  if (!apiKey) {
    resultEl.textContent = '请先输入 API Key';
    resultEl.className = 'text-[10px] mt-1 text-red-500';
    resultEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = '测试中...';
  resultEl.textContent = '正在测试连接...';
  resultEl.className = 'text-[10px] mt-1 text-sand-500';
  resultEl.classList.remove('hidden');

  try {
    const res = await apiFetch('/api/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: selectedPreset, apiKey, baseURL, model }),
    });
    const data = await res.json();
    if (data.ok) {
      resultEl.textContent = '✅ 连接成功！API Key 可用';
      resultEl.className = 'text-[10px] mt-1 text-green-600 dark:text-green-400';
    } else {
      resultEl.textContent = `❌ 连接失败: ${data.error || '未知错误'}`;
      resultEl.className = 'text-[10px] mt-1 text-red-500';
    }
  } catch (err) {
    resultEl.textContent = '❌ 网络错误';
    resultEl.className = 'text-[10px] mt-1 text-red-500';
  } finally {
    btn.disabled = false;
    btn.textContent = '测试连接';
  }
});

function toggleScheduleFields(enabled) {
  document.getElementById('scheduleFields').classList.toggle('hidden', !enabled);
}
document.getElementById('cfgScheduleEnabled').addEventListener('change', e => toggleScheduleFields(e.target.checked));

document.getElementById('settingsSave').addEventListener('click', async () => {
  const apiKey = document.getElementById('cfgApiKey').value.trim();
  const baseURL = document.getElementById('cfgBaseURL')?.value?.trim() || '';
  const model = document.getElementById('cfgModel')?.value?.trim() || '';
  const scheduleEnabled = document.getElementById('cfgScheduleEnabled').checked;

  // Build schedule for current preset
  const schedules = scheduleEnabled ? [{
    enabled: true,
    preset: selectedPreset,
    label: API_PRESETS[selectedPreset]?.name || selectedPreset,
    hour: parseInt(document.getElementById('cfgScheduleHour').value) || 8,
    minute: 0,
    hours: parseInt(document.getElementById('cfgScheduleHours').value) || 48,
    topN: parseInt(document.getElementById('cfgScheduleTopN').value) || 15,
    baseURL: ['custom', 'doubao', 'openai'].includes(selectedPreset) ? baseURL : '',
    model: ['custom', 'doubao', 'openai', 'minimax'].includes(selectedPreset) ? model : '',
  }] : [];

  if (!apiKey) {
    const statusEl = document.getElementById('cfgStatus');
    statusEl.textContent = '请输入 API Key';
    statusEl.className = 'text-xs text-center text-red-500';
    statusEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await apiFetch('/api/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: selectedPreset, apiKey, baseURL, model, schedules }),
    });
    const data = await res.json();
    const statusEl = document.getElementById('cfgStatus');
    if (data.ok) {
      statusEl.textContent = '✅ 配置已加密保存到服务器';
      statusEl.className = 'text-xs text-center text-green-600 dark:text-green-400';
      statusEl.classList.remove('hidden');
      setTimeout(() => { settingsModal.classList.add('hidden'); statusEl.classList.add('hidden'); }, 1500);
    } else {
      statusEl.textContent = data.message || '保存失败';
      statusEl.className = 'text-xs text-center text-red-500';
      statusEl.classList.remove('hidden');
    }
  } catch { window.showToast?.('网络错误', 'error'); }
});

// --- Generate Modal ---
const genModal = document.getElementById('generateModal');
document.getElementById('generateBtn').addEventListener('click', async () => {
  // Check if config exists
  try {
    const res = await apiFetch('/api/config');
    const data = await res.json();
    if (data.ok && data.data?.apiKeyMasked) {
      document.getElementById('genConfigInfo').textContent = `使用已保存的配置 (${data.data.preset || 'auto'}: ${data.data.apiKeyMasked})`;
    } else {
      document.getElementById('genConfigInfo').innerHTML = '⚠️ 尚未配置 API Key，请先点击 <b>设置</b> 按钮配置';
    }
  } catch {}
  genModal.classList.remove('hidden');
});
document.getElementById('genCancel').addEventListener('click', () => genModal.classList.add('hidden'));
genModal.addEventListener('click', e => { if (e.target === genModal) genModal.classList.add('hidden'); });

document.getElementById('genConfirm').addEventListener('click', async () => {
  const hours = parseInt(document.getElementById('genHours').value);
  const topN = parseInt(document.getElementById('genTopN').value);
  genModal.classList.add('hidden');
  const res = await apiFetch('/api/digest/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hours, topN }),
  });
  const data = await res.json();
  if (!data.ok) { window.showToast?.(data.message || '生成失败', 'error'); return; }
  watchStatus();
});

let statusEventSource = null;
function watchStatus() {
  const banner = document.getElementById('statusBanner');
  const text = document.getElementById('statusText');
  banner.classList.remove('hidden');
  if (statusEventSource) statusEventSource.close();
  const sseUrl = authToken ? `/api/status/stream?token=${authToken}` : '/api/status/stream';
  statusEventSource = new EventSource(sseUrl);
  statusEventSource.onmessage = (e) => {
    try {
      const state = JSON.parse(e.data);
      text.textContent = state.progress || state.step;
      if (!state.running) {
        statusEventSource.close();
        statusEventSource = null;
        if (state.step === 'done') { banner.classList.add('hidden'); loadLatest(); }
        else if (state.step === 'error') { text.textContent = `生成失败: ${state.progress}`; setTimeout(() => banner.classList.add('hidden'), 5000); }
      }
    } catch {}
  };
  statusEventSource.onerror = () => {
    statusEventSource.close();
    statusEventSource = null;
    text.textContent = '连接中断，刷新页面重试';
    setTimeout(() => banner.classList.add('hidden'), 3000);
  };
}

// --- Load ---
async function loadDigestList() {
  try {
    const res = await apiFetch('/api/digests');
    const data = await res.json();
    if (!data.ok) return;
    const sel = document.getElementById('dateSelect');
    sel.innerHTML = data.data.map(d => `<option value="${d.date}">${d.date}</option>`).join('');
    if (!data.data.length) sel.innerHTML = '<option>暂无</option>';
  } catch {}
}

async function loadLatest() {
  try {
    const res = await apiFetch('/api/digest/latest');
    const data = await res.json();
    if (data.ok) { renderDigest(data.data); loadDigestList(); }
    else document.getElementById('emptyState').classList.remove('hidden');
  } catch { document.getElementById('emptyState').classList.remove('hidden'); }
}

document.getElementById('dateSelect').addEventListener('change', async e => {
  const date = e.target.value;
  if (!date || date === '暂无') return;
  try { const res = await apiFetch(`/api/digest/${date}`); const data = await res.json(); if (data.ok) renderDigest(data.data); } catch {}
});

async function checkRunning() {
  try { const res = await apiFetch('/api/status'); const data = await res.json(); if (data.ok && data.data.running) watchStatus(); } catch {}
}

// PDF：直接下载日报 PDF 文件
document.getElementById('downloadPdfBtn')?.addEventListener('click', () => {
  const btn = document.getElementById('downloadPdfBtn');
  const date = btn?.dataset?.date;
  if (!date) {
    window.showToast?.('无法获取报告日期', 'error');
    return;
  }
  const url = `/api/digest/${date}/pdf`;
  window.showToast?.('正在生成 PDF，如浏览器未自动下载请检查下载栏或弹窗拦截。', 'info');
  // 直接跳转即可触发下载（服务端使用 Content-Disposition: attachment）
  window.open(url, '_blank', 'noopener');
});

(async () => {
  const isShare = await checkSharePage();
  if (isShare) return;
  showApp();
  if (!window.location.hash || window.location.hash === '#') window.location.hash = '#/reports';
  route();
  checkRunning();
})();
