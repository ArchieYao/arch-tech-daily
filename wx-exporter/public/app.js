/* eslint-disable */
(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const state = {
    mode: 'byUrls',     // 'byRange' | 'byUrls'
    mps: [],            // 全部公众号
    selected: new Set(),// 已选 mpId
    filter: '',
    urls: [],           // [{raw, normalized}]（Mode B 累积的规范化 URL 列表）
    pollTimer: null,
  };

  // ── 启动 ──
  init();

  async function init() {
    setupDateDefaults();
    setupBatchNameDefault();
    bindEvents();
    switchTab(state.mode);
    renderUrls();
    await Promise.all([fetchHealth(), fetchMps()]);
    pollJobs();
    state.pollTimer = setInterval(pollJobs, 2000);
  }

  function bindEvents() {
    // Tab 切换
    $$('.tab-bar .tab').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Mode A
    $('#btn-refresh-mps').addEventListener('click', fetchMps);
    $('#mp-filter').addEventListener('input', (e) => {
      state.filter = e.target.value.trim();
      renderMps();
    });
    $('#btn-select-all').addEventListener('click', () => {
      visibleMps().forEach((m) => state.selected.add(m.id));
      renderMps();
    });
    $('#btn-select-none').addEventListener('click', () => {
      state.selected.clear();
      renderMps();
    });
    $$('button[data-days]').forEach((btn) => {
      btn.addEventListener('click', () => setRangeDays(Number(btn.dataset.days)));
    });

    // Mode B
    $('#btn-add-urls').addEventListener('click', addPastedUrls);
    $('#btn-clear-urls').addEventListener('click', () => {
      if (state.urls.length === 0) return;
      if (!confirm('清空当前 URL 列表？')) return;
      state.urls = [];
      renderUrls();
    });

    // 共用
    $('#btn-preview').addEventListener('click', doPreview);
    $('#btn-start').addEventListener('click', doStart);
  }

  // ── Tab ──
  function switchTab(tab) {
    if (tab !== 'byRange' && tab !== 'byUrls') return;
    state.mode = tab;
    $$('.tab-bar .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));

    const byRange = $('#panel-byRange');
    const byUrls = $('#panel-byUrls');
    if (tab === 'byRange') {
      byRange.hidden = false;
      byUrls.hidden = true;
    } else {
      byRange.hidden = true;
      byUrls.hidden = false;
    }

    setMsg('');
    $('#preview').innerHTML = '';
    const warn = $('#urls-warn');
    if (warn) warn.hidden = true;
  }

  // ── 日期范围（Mode A）──
  function setupDateDefaults() {
    setRangeDays(7);
  }
  function setRangeDays(days) {
    const end = new Date();
    const start = new Date(end.getTime() - (days - 1) * 86400000);
    $('#date-start').value = ymd(start);
    $('#date-end').value = ymd(end);
  }
  function ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function getRangeISO() {
    const sv = $('#date-start').value;
    const ev = $('#date-end').value;
    if (!sv || !ev) throw new Error('请选择时间范围');
    const start = new Date(sv + 'T00:00:00');
    const end = new Date(ev + 'T23:59:59');
    if (end <= start) throw new Error('结束时间必须晚于开始时间');
    return { start: start.toISOString(), end: end.toISOString() };
  }

  // ── 批次名（Mode B）──
  function setupBatchNameDefault() {
    const el = $('#batch-name');
    if (el && !el.value) el.placeholder = `文章合集_${ymd(new Date())}`;
  }

  // ── 健康检查 ──
  async function fetchHealth() {
    const bar = $('#health-bar');
    bar.textContent = '检测中…';
    bar.className = 'health';
    try {
      const r = await fetch('/api/health').then((r) => r.json());
      const parts = [];
      parts.push(r.werssReachable ? 'WERSS ✓' : 'WERSS ✗');
      parts.push(r.wxLoggedIn ? '微信扫码 ✓' : '微信扫码 ✗');
      parts.push(r.db?.exists ? `数据库 ${(r.db.size / 1024).toFixed(0)}KB` : '数据库未就绪');
      bar.textContent = parts.join(' · ');
      if (!r.werssReachable || !r.wxLoggedIn || !r.db?.exists) {
        bar.classList.add('warn');
      } else {
        bar.classList.add('ok');
      }
    } catch (e) {
      bar.textContent = '连不上 we-mp-rss';
      bar.classList.add('err');
    }
  }

  // ── 公众号列表（Mode A）──
  async function fetchMps() {
    $('#mp-count').textContent = '加载中…';
    try {
      const r = await fetch('/api/mps').then((r) => r.json());
      if (!r.ok) throw new Error(r.error || '加载失败');
      state.mps = r.mps;
      renderMps();
    } catch (e) {
      $('#mp-list').innerHTML = `<div class="hint" style="padding:12px">加载失败：${e.message}<br/>请确认 we-mp-rss 已启动并扫码登录</div>`;
      $('#mp-count').textContent = '';
    }
  }
  function visibleMps() {
    const f = state.filter.toLowerCase();
    return state.mps.filter((m) => !f || (m.mp_name || '').toLowerCase().includes(f));
  }
  function renderMps() {
    const visible = visibleMps();
    $('#mp-count').textContent = `共 ${state.mps.length}（已选 ${state.selected.size}，显示 ${visible.length}）`;
    const root = $('#mp-list');
    root.innerHTML = '';
    if (visible.length === 0) {
      root.innerHTML = `<div class="hint" style="padding:12px">未找到匹配的公众号</div>`;
      return;
    }
    for (const m of visible) {
      const id = m.id;
      const checked = state.selected.has(id) ? 'checked' : '';
      const div = document.createElement('label');
      div.className = 'mp-item';
      div.innerHTML = `
        <input type="checkbox" ${checked} data-id="${id}" />
        <span class="name" title="${escapeHtml(m.mp_name || id)}">${escapeHtml(m.mp_name || id)}</span>
      `;
      div.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) state.selected.add(id);
        else state.selected.delete(id);
        $('#mp-count').textContent = `共 ${state.mps.length}（已选 ${state.selected.size}，显示 ${visible.length}）`;
      });
      root.appendChild(div);
    }
  }

  // ── URL 列表（Mode B）──
  async function addPastedUrls() {
    const input = $('#urls-input');
    const text = input.value.trim();
    $('#urls-warn').hidden = true;
    if (!text) return setMsg('请先粘贴链接', 'warn');

    try {
      const r = await fetch('/api/preview-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: text,
          existing: state.urls.map((u) => u.normalized),
        }),
      }).then((r) => r.json());
      if (!r.ok) throw new Error(r.error);

      for (const v of r.valid) state.urls.push(v);

      const warnParts = [];
      if (r.invalid.length) {
        warnParts.push(`忽略 ${r.invalid.length} 条非法链接：` +
          r.invalid.slice(0, 3).map((x) => truncate(x.raw, 50)).join('；') +
          (r.invalid.length > 3 ? ' …' : ''));
      }
      if (r.duplicates.length) {
        warnParts.push(`跳过 ${r.duplicates.length} 条重复链接`);
      }
      const warnEl = $('#urls-warn');
      if (warnParts.length) {
        warnEl.textContent = warnParts.join('；');
        warnEl.hidden = false;
      }

      input.value = '';
      renderUrls();
      setMsg(`已添加 ${r.valid.length} 条，列表共 ${state.urls.length} 条`, 'ok');
    } catch (e) {
      setMsg('解析失败：' + e.message, 'err');
    }
  }

  function renderUrls() {
    const root = $('#urls-list');
    if (!root) return;
    $('#urls-stats').textContent = `当前列表：${state.urls.length} 条`;
    root.innerHTML = '';
    if (state.urls.length === 0) {
      root.innerHTML = `<li class="hint" style="list-style:none;padding:10px 0">尚未添加任何链接。</li>`;
      return;
    }
    state.urls.forEach((u, idx) => {
      const li = document.createElement('li');
      li.className = 'url-item';
      li.innerHTML = `
        <span class="idx">${idx + 1}</span>
        <a href="${u.normalized}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(u.normalized)}">${escapeHtml(truncate(u.normalized, 80))}</a>
        <button class="btn ghost small" data-remove-url="${idx}">移除</button>
      `;
      root.appendChild(li);
    });
    $$('button[data-remove-url]').forEach((b) => {
      b.addEventListener('click', () => {
        const i = Number(b.dataset.removeUrl);
        state.urls.splice(i, 1);
        renderUrls();
      });
    });
  }

  // ── 预览 / 开始（按 mode 分支）──
  async function doPreview() {
    setMsg('');
    if (state.mode === 'byUrls') {
      // 「粘贴链接」模式不在预览阶段抓标题，仅本地列出
      if (state.urls.length === 0) return setMsg('URL 列表为空', 'warn');
      renderUrlPreview();
      return;
    }
    // byRange
    if (state.selected.size === 0) return setMsg('请先选择至少一个公众号', 'warn');
    let range; try { range = getRangeISO(); } catch (e) { return setMsg(e.message, 'warn'); }
    setMsg('查询中…');
    try {
      const body = { mpIds: [...state.selected], ...range };
      const r = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json());
      if (!r.ok) throw new Error(r.error);
      renderRangePreview(r);
    } catch (e) {
      setMsg('预览失败：' + e.message, 'err');
    }
  }

  function renderRangePreview(r) {
    const root = $('#preview');
    root.innerHTML = '';
    setMsg(`命中 ${r.total} 篇`);
    for (const g of r.groups) {
      const div = document.createElement('div');
      div.className = 'group';
      const list = g.articles.slice(0, 30).map((a) => `<li>${escapeHtml(a.title)} <span class="hint">· ${a.publishedAt.slice(0, 10)}</span></li>`).join('');
      const more = g.articles.length > 30 ? `<li class="hint">…还有 ${g.articles.length - 30} 篇未列出</li>` : '';
      div.innerHTML = `
        <h4><span>${escapeHtml(g.mpName)}</span><span class="hint">${g.articles.length} 篇</span></h4>
        <ul>${list}${more}</ul>
      `;
      root.appendChild(div);
    }
    if (r.groups.length === 0) {
      root.innerHTML = `<div class="hint" style="padding:12px">该时间范围内没有找到文章。可以先去 <a href="${location.protocol}//${location.hostname}:8002" target="_blank">we-mp-rss 后台</a> 手动刷新一次公众号。</div>`;
    }
  }

  function renderUrlPreview() {
    const root = $('#preview');
    root.innerHTML = '';
    const batchName = currentBatchName();
    setMsg(`待抓取 ${state.urls.length} 篇（文件名：${batchName}.docx）`);
    const div = document.createElement('div');
    div.className = 'group';
    const list = state.urls.slice(0, 50)
      .map((u, i) => `<li>${i + 1}. <span class="hint">${escapeHtml(truncate(u.normalized, 90))}</span></li>`)
      .join('');
    const more = state.urls.length > 50 ? `<li class="hint">…还有 ${state.urls.length - 50} 条未列出</li>` : '';
    div.innerHTML = `
      <h4><span>${escapeHtml(batchName)}</span><span class="hint">${state.urls.length} 篇</span></h4>
      <ul>${list}${more}</ul>
      <div class="hint" style="padding:4px 0">说明：Mode B 预览仅列出链接本身，真实标题会在导出阶段由爬虫返回。</div>
    `;
    root.appendChild(div);
  }

  async function doStart() {
    setMsg('');
    if (state.mode === 'byUrls') {
      if (state.urls.length === 0) return setMsg('URL 列表为空', 'warn');
      const batchName = currentBatchName();
      if (!confirm(`即将抓取 ${state.urls.length} 篇文章并合并为一个 Word 文档：${batchName}.docx\n是否继续？`)) return;
      setMsg('启动中…');
      try {
        const body = {
          mode: 'by_urls',
          urls: state.urls.map((u) => u.normalized),
          batchName,
        };
        const r = await fetch('/api/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then((r) => r.json());
        if (!r.ok) throw new Error(r.error);
        setMsg(`任务已创建：${r.jobId}`, 'ok');
        pollJobs();
      } catch (e) {
        setMsg('启动失败：' + e.message, 'err');
      }
      return;
    }

    // byRange
    if (state.selected.size === 0) return setMsg('请先选择至少一个公众号', 'warn');
    let range; try { range = getRangeISO(); } catch (e) { return setMsg(e.message, 'warn'); }
    if (!confirm(`即将爬取 ${state.selected.size} 个公众号在所选时间范围内的文章并生成 Word 文档。\n抓取过程中请勿关闭此窗口，是否继续？`)) return;
    setMsg('启动中…');
    try {
      const body = { mode: 'by_range', mpIds: [...state.selected], ...range };
      const r = await fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json());
      if (!r.ok) throw new Error(r.error);
      setMsg(`任务已创建：${r.jobId}`, 'ok');
      pollJobs();
    } catch (e) {
      setMsg('启动失败：' + e.message, 'err');
    }
  }

  function currentBatchName() {
    const raw = $('#batch-name').value.trim();
    return raw || `文章合集_${ymd(new Date())}`;
  }

  // ── 任务列表 ──
  async function pollJobs() {
    try {
      const r = await fetch('/api/jobs').then((r) => r.json());
      if (r.ok) renderJobs(r.jobs);
    } catch {}
  }

  function renderJobs(jobs) {
    const root = $('#job-list');
    if (!jobs.length) {
      root.innerHTML = `<div class="hint" style="padding:12px">还没有任务。选好内容后点击 "开始导出" 即可。</div>`;
      return;
    }
    root.innerHTML = '';
    for (const job of jobs) {
      const pct = job.progress.total > 0
        ? Math.min(100, Math.round((job.progress.done / job.progress.total) * 100))
        : (job.status === 'succeeded' ? 100 : 0);

      const mode = job.payload?.mode || 'by_range';
      let metaLine;
      if (mode === 'by_urls') {
        metaLine = `Mode B · ${escapeHtml(job.payload?.batchName || '文章合集')} · ${job.payload?.urlCount ?? 0} 篇链接`;
      } else {
        const mpsLabel = (job.payload?.mpNames || []).slice(0, 3).join(' / ') +
          (job.payload?.mpNames?.length > 3 ? ` 等 ${job.payload.mpNames.length} 个` : '');
        const time = `${(job.payload?.start || '').slice(0, 10)} ~ ${(job.payload?.end || '').slice(0, 10)}`;
        metaLine = `Mode A · ${escapeHtml(mpsLabel)} · ${time}`;
      }

      const downloadButtons = (job.artifacts || []).map((a) =>
        `<a class="btn" href="/api/jobs/${job.id}/download?file=${encodeURIComponent(a.filename)}" download>${a.kind === 'zip' ? '⬇ 打包下载' : '⬇ '}${escapeHtml(a.filename)} <span class="hint">(${(a.sizeBytes / 1024).toFixed(0)}KB)</span></a>`
      ).join('');

      const errBlock = job.error ? `<div class="meta" style="color:#b91c1c">错误：${escapeHtml(job.error)}</div>` : '';
      const abortBtn = ['pending', 'running'].includes(job.status)
        ? `<button class="btn" data-abort="${job.id}">取消</button>`
        : '';

      const div = document.createElement('div');
      div.className = 'job';
      div.innerHTML = `
        <div class="head">
          <div>
            <span class="id">#${job.id}</span>
            <span class="status ${job.status}">${job.status}</span>
          </div>
          <div class="hint">${new Date(job.createdAt).toLocaleString()}</div>
        </div>
        <div class="meta">${metaLine}</div>
        <div class="progress"><div style="width:${pct}%"></div></div>
        <div class="meta">
          ${pct}% · ${job.progress.done}/${job.progress.total}
          ${job.progress.currentMp ? ' · 当前: ' + escapeHtml(job.progress.currentMp) : ''}
          ${job.progress.currentArticle ? ' · ' + escapeHtml(String(job.progress.currentArticle).slice(0, 60)) : ''}
        </div>
        ${errBlock}
        <div class="actions">
          ${downloadButtons}
          ${abortBtn}
          <button class="btn ghost" data-toggle-log="${job.id}">日志</button>
        </div>
        <pre class="logs" id="log-${job.id}" style="display:none">${escapeHtml((job.logs || []).join('\n'))}</pre>
      `;
      root.appendChild(div);
    }
    $$('button[data-abort]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('确认取消该任务？')) return;
        await fetch(`/api/jobs/${b.dataset.abort}/abort`, { method: 'POST' });
        pollJobs();
      })
    );
    $$('button[data-toggle-log]').forEach((b) =>
      b.addEventListener('click', () => {
        const el = document.getElementById('log-' + b.dataset.toggleLog);
        el.style.display = el.style.display === 'none' ? 'block' : 'none';
      })
    );
  }

  function setMsg(text, kind) {
    const el = $('#action-msg');
    el.textContent = text;
    el.style.color = kind === 'err' ? '#b91c1c' :
                     kind === 'warn' ? '#b45309' :
                     kind === 'ok' ? '#15803d' : '';
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function truncate(s, n) {
    const t = String(s || '');
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  }
})();
