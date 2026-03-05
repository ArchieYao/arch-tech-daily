/**
 * AI 每日精选 — UX Enhancements
 * Features: progress bar · scroll animations · skeleton · back-to-top
 *           toast · category counts · keyboard shortcuts · PWA
 */

/* ══════════════════════════════════════════════════════════════
   1. READING PROGRESS BAR
   ══════════════════════════════════════════════════════════════ */
(function initProgressBar() {
  const bar = document.getElementById('readingProgress');
  if (!bar) return;
  function update() {
    const scrollTop = window.scrollY;
    const docH = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.transform = `scaleX(${docH > 0 ? scrollTop / docH : 0})`;
  }
  window.addEventListener('scroll', update, { passive: true });
})();

/* ══════════════════════════════════════════════════════════════
   2. BACK TO TOP
   ══════════════════════════════════════════════════════════════ */
(function initBackToTop() {
  const btn = document.getElementById('backToTop');
  if (!btn) return;
  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 380);
  }, { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
})();

/* ══════════════════════════════════════════════════════════════
   3. TOAST NOTIFICATION SYSTEM
   ══════════════════════════════════════════════════════════════ */
window.showToast = function(message, type = 'info', sub = '') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = { success: '✓', error: '✕', info: 'ℹ' }[type] || 'ℹ';
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <div class="toast-body">
      <span class="toast-msg">${message}</span>
      ${sub ? `<span class="toast-sub">${sub}</span>` : ''}
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;

  container.appendChild(toast);
  // Animate in
  requestAnimationFrame(() => toast.classList.add('toast-show'));
  // Auto-remove
  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 320);
  }, type === 'error' ? 5000 : 3200);
};

/* ══════════════════════════════════════════════════════════════
   4. SKELETON LOADING
   ══════════════════════════════════════════════════════════════ */
(function initSkeleton() {
  const skeleton = document.getElementById('skeletonView');
  const mainApp  = document.getElementById('mainApp');
  if (!skeleton || !mainApp) return;

  // Show skeleton when app becomes visible, until digest renders
  let shown = false;
  const maybeShow = () => {
    if (shown) return;
    if (!mainApp.classList.contains('hidden')) {
      shown = true;
      skeleton.classList.remove('hidden');
    }
  };
  const observer = new MutationObserver(maybeShow);
  observer.observe(mainApp, { attributes: true, attributeFilter: ['class'] });
  maybeShow(); // check immediately

  // Hide skeleton once content is ready
  document.addEventListener('digestRendered', () => {
    skeleton.classList.add('hidden');
    observer.disconnect();
  });

  // Also hide if empty state shown
  document.addEventListener('emptyStateShown', () => {
    skeleton.classList.add('hidden');
    observer.disconnect();
  });
})();

/* ══════════════════════════════════════════════════════════════
   5. PANEL STAGGER ANIMATION ON CONTENT LOAD
   ══════════════════════════════════════════════════════════════ */
document.addEventListener('digestRendered', () => {
  const sections = document.querySelectorAll('#mainApp main > section:not(.hidden)');
  sections.forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(12px)';
    el.style.transition = 'none';
    setTimeout(() => {
      el.style.transition = 'opacity 0.38s ease, transform 0.38s ease';
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    }, i * 90);
  });
});

/* ══════════════════════════════════════════════════════════════
   6. CATEGORY COUNT BADGES
   ══════════════════════════════════════════════════════════════ */
document.addEventListener('digestRendered', ({ detail: { digest } }) => {
  if (!digest?.articles) return;

  const counts = { all: digest.articles.length };
  digest.articles.forEach(a => {
    counts[a.category] = (counts[a.category] || 0) + 1;
  });

  document.querySelectorAll('.cat-btn').forEach(btn => {
    const cat = btn.dataset.cat;
    const n = counts[cat] ?? 0;
    // Remove any existing count badge
    const old = btn.querySelector('.cat-count');
    if (old) old.remove();
    if (n > 0) {
      const badge = document.createElement('span');
      badge.className = 'cat-count';
      badge.textContent = n;
      btn.appendChild(badge);
    }
  });
});

/* ══════════════════════════════════════════════════════════════
   7. KEYBOARD SHORTCUTS
   ══════════════════════════════════════════════════════════════ */
(function initKeyboard() {
  document.addEventListener('keydown', e => {
    // Don't intercept when typing in an input
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.key === 'Escape') document.activeElement.blur();
      return;
    }
    switch (e.key) {
      case '/':
        e.preventDefault();
        document.getElementById('searchInput')?.focus();
        break;
      case 'g': case 'G':
        document.getElementById('generateBtn')?.click();
        break;
      case 's': case 'S':
        document.getElementById('settingsBtn')?.click();
        break;
      case 't': case 'T':
        document.getElementById('themeToggle')?.click();
        break;
      case 'Escape': {
        // Close any open modal
        const modals = document.querySelectorAll('.modal-bg:not(.hidden)');
        modals.forEach(m => m.classList.add('hidden'));
        break;
      }
      case '?':
        window.showToast('快捷键: / 搜索 · G 生成 · S 设置 · T 主题 · Esc 关闭', 'info');
        break;
    }
  });
})();

/* ══════════════════════════════════════════════════════════════
   8. PWA SERVICE WORKER REGISTRATION
   ══════════════════════════════════════════════════════════════ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // silently fail if sw.js not present
    });
  });
}

/* ══════════════════════════════════════════════════════════════
   DARK MODE — Complete CSS var injection
   (CSS handles the styles; this ensures smooth transition)
   ══════════════════════════════════════════════════════════════ */
(function initDarkTransition() {
  const toggle = document.getElementById('themeToggle');
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    document.documentElement.style.transition = 'background-color 0.25s, color 0.25s';
    setTimeout(() => { document.documentElement.style.transition = ''; }, 300);
  });
})();

/* ══════════════════════════════════════════════════════════════
   ARTICLE TRANSLATION MODAL
   ══════════════════════════════════════════════════════════════ */
(function initTranslation() {
  // 产品当前主要为中文内容，关闭翻译功能时，直接打开原文链接即可
  const TRANSLATION_ENABLED = false;
  // Share 模式或翻译关闭：不启用翻译弹窗，所有文章链接直接在新窗口打开
  if (window.__shareMode || !TRANSLATION_ENABLED) {
    document.addEventListener('digestRendered', () => {
      document.querySelectorAll('.article-card a[href], .top-card a[href]').forEach(link => {
        link.target = '_blank';
        link.rel = 'noopener';
      });
    });
    return;
  }
  const modal        = document.getElementById('translateModal');
  const loading      = document.getElementById('tmLoading');
  const errBox       = document.getElementById('tmError');
  const errMsg       = document.getElementById('tmErrorMsg');
  const content      = document.getElementById('tmContent');
  const tmTitle      = document.getElementById('tmTitle');
  const tmSumm       = document.getElementById('tmSummary');
  const tmBody       = document.getElementById('tmBody');
  const tmClose      = document.getElementById('tmClose');
  const tmOrig       = document.getElementById('tmOrigLink');
  const tmFall       = document.getElementById('tmFallbackLink');
  const tmRetranslate = document.getElementById('tmRetranslate');
  const tmDownload   = document.getElementById('tmDownload');
  const tmFontInc    = document.getElementById('tmFontInc');
  const tmFontDec    = document.getElementById('tmFontDec');
  if (!modal) return;

  let currentES  = null;
  let currentUrl = null; // dedup: track active URL
  let currentTitle = '', currentDesc = '';
  let fontSize = parseInt(localStorage.getItem('tm-font-size') || '15');

  // Apply font size
  function applyFontSize() {
    tmBody.style.fontSize = fontSize + 'px';
    localStorage.setItem('tm-font-size', fontSize);
  }
  applyFontSize();

  tmFontInc?.addEventListener('click', () => { fontSize = Math.min(22, fontSize + 1); applyFontSize(); });

  // Download translated article as Markdown
  tmDownload?.addEventListener('click', () => {
    const title   = tmTitle.textContent.trim();
    const summary = tmSumm.textContent.trim();
    // Get raw markdown from streamBuffer if streaming, else reconstruct from DOM
    const bodyMd  = currentStreamBuffer || domToMarkdown(tmBody);
    const origUrl = tmOrig.href;
    const date    = new Date().toLocaleDateString('zh-CN');

    const md = [
      `# ${title}`,
      '',
      `> ${summary}`,
      '',
      '---',
      '',
      bodyMd,
      '',
      '---',
      '',
      `原文链接：${origUrl}`,
      `下载时间：${date}`,
    ].join('\n');

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = sanitizeFilename(title) + '.md';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  function sanitizeFilename(name) {
    return (name || 'article').replace(/[/\\?%*:|"<>]/g, '-').slice(0, 80);
  }

  // Convert rendered HTML back to rough Markdown for download
  function domToMarkdown(el) {
    let md = '';
    el.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        md += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();
        const text = node.innerText || node.textContent || '';
        if (tag === 'h1') md += '\n# ' + text + '\n';
        else if (tag === 'h2') md += '\n## ' + text + '\n';
        else if (tag === 'h3') md += '\n### ' + text + '\n';
        else if (tag === 'p') md += '\n' + text + '\n';
        else if (tag === 'ul') {
          node.querySelectorAll('li').forEach(li => { md += '- ' + li.textContent + '\n'; });
        } else if (tag === 'ol') {
          node.querySelectorAll('li').forEach((li, i) => { md += (i+1) + '. ' + li.textContent + '\n'; });
        } else if (tag === 'blockquote') md += '\n> ' + text + '\n';
        else if (tag === 'strong' || tag === 'b') md += '**' + text + '**';
        else if (tag === 'em' || tag === 'i') md += '*' + text + '*';
        else if (tag === 'code') md += '`' + text + '`';
        else if (tag === 'pre') md += '\n```\n' + text + '\n```\n';
        else if (tag === 'hr') md += '\n---\n';
        else if (!['div','span','a'].includes(tag)) md += text;
        else md += text;
      }
    });
    return md.trim();
  }
  tmFontDec?.addEventListener('click', () => { fontSize = Math.max(12, fontSize - 1); applyFontSize(); });

  // Re-translate button
  tmRetranslate?.addEventListener('click', () => {
    if (!currentUrl) return;
    tmBody.innerHTML = '';
    showLoading('正在重新翻译…');
    authFetch('/api/article/retranslate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: currentUrl, title: currentTitle, desc: currentDesc }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { preCache[currentUrl] = { ...d, ready: true }; showInstant(d); markReadyArticles(); }
        else showError(d.error || '重新翻译失败', currentUrl);
      })
      .catch(() => showError('网络错误', currentUrl));
  });


  // Auth helper — reuse app.js global token
  function getAuthHeaders() {
    const t = window.authToken || localStorage.getItem('auth_token') || '';
    return t ? { 'X-Auth-Token': t } : {};
  }
  function authFetch(url, opts = {}) {
    opts.headers = { ...opts.headers, ...getAuthHeaders() };
    return fetch(url, opts);
  }
  function authToken() {
    return window.authToken || localStorage.getItem('auth_token') || '';
  }
  // Configure marked.js
  if (window.marked) {
    marked.setOptions({ breaks: true, gfm: true });
  }
  function renderMd(text) {
    if (!text) return '';
    return window.marked ? marked.parse(text) : text.replace(/\n/g, '<br>');
  }

  function openModal() {
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    if (currentES) { currentES.close(); currentES = null; }
  }
  function showLoading(msg) {
    loading.classList.remove('hidden');
    errBox.classList.add('hidden');
    content.classList.add('hidden');
    const txt = document.getElementById('tmLoadingText');
    if (txt) txt.textContent = msg || '正在抓取原文并翻译，请稍候…';
  }
  function showError(msg, url) {
    loading.classList.add('hidden');
    errBox.classList.remove('hidden');
    content.classList.add('hidden');
    errMsg.textContent = msg;
    tmFall.href = url;
  }

  // Streaming accumulator — render Markdown progressively
  let streamBuffer = '';
  let streamRenderTimer = null;
  let currentStreamBuffer = ''; // kept for download after stream completes

  function appendChunk(text) {
    loading.classList.add('hidden');
    content.classList.remove('hidden');
    streamBuffer += text;
    currentStreamBuffer = streamBuffer;
    // Throttle render to 100ms for performance
    if (streamRenderTimer) return;
    streamRenderTimer = setTimeout(() => {
      streamRenderTimer = null;
      tmBody.innerHTML = renderMd(streamBuffer) + '<span class="tm-streaming-cursor">▍</span>';
      const box = modal.querySelector('.translate-modal-box');
      if (box) box.scrollTop = box.scrollHeight;
    }, 100);
  }

  function flushPending() {
    if (streamRenderTimer) { clearTimeout(streamRenderTimer); streamRenderTimer = null; }
    if (streamBuffer) {
      tmBody.innerHTML = renderMd(streamBuffer);
    }
    streamBuffer = '';
  }

  function startStream(url, title, desc) {
    streamBuffer = '';
    currentStreamBuffer = '';
    streamRenderTimer = null;
    tmBody.innerHTML = '';
    tmTitle.textContent = '';
    tmSumm.textContent = '';

    const params = new URLSearchParams({
      url:   url,
      title: title.slice(0, 200),
      desc:  desc.slice(0, 500),
    });

    const tok = authToken();
    if (tok) params.set('token', tok);
    const es = new EventSource(`/api/article/translate/stream?${params}`);
    currentES = es;

    es.addEventListener('status', (e) => {
      const d = JSON.parse(e.data);
      showLoading(d.msg);
    });

    es.addEventListener('meta', (e) => {
      const d = JSON.parse(e.data);
      loading.classList.add('hidden');
      content.classList.remove('hidden');
      tmTitle.textContent = d.titleZh || '';
      tmSumm.textContent  = d.summary  || '';
      // Show divider
      const div = document.querySelector('.tm-divider');
      if (div) div.style.display = '';
    });

    es.addEventListener('chunk', (e) => {
      const d = JSON.parse(e.data);
      appendChunk(d.text || '');
    });

    es.addEventListener('done', () => {
      flushPending();
      appendOrigLink(url);
      es.close(); currentES = null;
    });

    es.addEventListener('error', (e) => {
      es.close(); currentES = null;
      try {
        const d = JSON.parse(e.data);
        showError(d.error || '翻译失败', url);
      } catch {
        // SSE connection error (not our error event)
        if (tmBody.children.length === 0) showError('连接中断，请重试', url);
      }
    });

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        if (tmBody.children.length === 0 && content.classList.contains('hidden')) {
          showError('连接失败，请检查网络', url);
        }
        currentES = null;
      }
    };
  }

  // Pre-translation status cache (url → {titleZh, summary, content})
  const preCache = {};

  // Fetch pre-translation status for all visible articles
  async function fetchTranslationStatus() {
    const links = [...document.querySelectorAll('.article-card a[href], .top-card a[href]')];
    const urls = [...new Set(
      links.map(l => l.href).filter(u => u && !u.startsWith(location.origin))
    )];
    if (!urls.length) return;
    try {
      const res = await authFetch('/api/article/translations/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      });
      const data = await res.json();
      if (data.ok) {
        Object.assign(preCache, data.data);
        markReadyArticles();
      }
    } catch {}
  }

  // Add "已翻译" badge to pre-translated articles
  function markReadyArticles() {
    document.querySelectorAll('.article-card, .top-card').forEach(card => {
      const link = card.querySelector('a[href]');
      if (!link) return;
      const url = link.href;
      if (!preCache[url]?.ready) return;
      if (card.querySelector('.tm-ready-badge')) return; // already marked
      const badge = document.createElement('span');
      badge.className = 'tm-ready-badge';
      badge.textContent = '已翻译';
      // Insert after the title element
      const title = card.querySelector('h3,h4,.article-title');
      if (title) title.insertAdjacentElement('afterend', badge);
      else card.prepend(badge);
    });
  }

  // Show pre-cached translation instantly (no loading)
  function appendOrigLink(url) {
    if (!url || tmBody.querySelector('.tm-orig-footer')) return;
    const footer = document.createElement('div');
    footer.className = 'tm-orig-footer';
    footer.innerHTML = `原文链接：<a href="${url}" target="_blank" rel="noopener">${url}</a>`;
    tmBody.appendChild(footer);
  }

  function showInstant(data) {
    loading.classList.add('hidden');
    errBox.classList.add('hidden');
    content.classList.remove('hidden');
    tmTitle.textContent = data.titleZh || '';
    tmSumm.textContent  = data.summary  || '';
    tmBody.innerHTML = '';
    currentStreamBuffer = data.content || '';
    tmBody.innerHTML = renderMd(data.content || '');
    appendOrigLink(data.url || currentUrl || tmOrig.href);
  }

  // Attach click handlers after digest renders
  function attachHandlers() {
    document.querySelectorAll('.article-card a[href], .top-card a[href]').forEach(link => {
      if (link.dataset.translateBound) return;
      link.dataset.translateBound = '1';

      link.addEventListener('click', (e) => {
        const url   = link.href;
        const title = link.closest('[data-title]')?.dataset.title
                   || link.closest('.article-card, .top-card')?.querySelector('h3,h4')?.textContent
                   || link.textContent || '';
        const desc  = link.closest('.article-card, .top-card')?.querySelector('.article-desc, p')?.textContent || '';

        if (!url || url.startsWith(location.origin)) return;
        e.preventDefault();

        // Dedup: ignore if same URL already loading
        if (currentUrl === url && !modal.classList.contains('hidden')) return;
        currentUrl   = url;
        currentTitle = title;
        currentDesc  = desc;

        tmOrig.href = url;
        tmFall.href = url;
        openModal();

        // Pre-cached? Show instantly (only if content is substantial, not just a description)
        const cached = preCache[url];
        if (cached?.ready && cached?.content && cached.content.length > 200) {
          showInstant(cached);
        } else if (cached?.ready && (!cached?.content || cached.content.length <= 200)) {
          // Batch-translated: content is just description — stream full article
          showLoading('正在获取全文翻译…');
          startStream(url, title, desc);
        } else {
          // Not pre-translated — stream it
          showLoading();
          startStream(url, title, desc);
        }
      });
    });
  }

  tmClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  // Poll background translation progress and update badges
  let progressTimer = null;
  function startProgressPolling() {
    if (progressTimer) return;
    progressTimer = setInterval(async () => {
      try {
        const res = await authFetch('/api/translate/progress');
        const { data } = await res.json();
        updateProgressBanner(data);
        if (!data.running) {
          clearInterval(progressTimer); progressTimer = null;
          // Refresh badges once done
          fetchTranslationStatus();
        }
      } catch {}
    }, 3000);
  }

  function updateProgressBanner(state) {
    let banner = document.getElementById('translateProgressBanner');
    if (!state.running) {
      if (banner) banner.remove();
      return;
    }
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'translateProgressBanner';
      banner.className = 'translate-progress-banner';
      document.body.appendChild(banner);
    }
    const pct = state.total > 0 ? Math.round((state.done / state.total) * 100) : 0;
    banner.innerHTML = `<span>后台翻译中 ${state.done}/${state.total}</span><div class="tpb-bar"><div class="tpb-fill" style="width:${pct}%"></div></div>`;
  }

  document.addEventListener('digestRendered', () => {
    setTimeout(async () => {
      attachHandlers();
      fetchTranslationStatus();
      // Check if background translation is running
      try {
        const res = await authFetch('/api/translate/progress');
        const { data } = await res.json();
        if (data.running) { updateProgressBanner(data); startProgressPolling(); }
      } catch {}
    }, 150);
  });
})();