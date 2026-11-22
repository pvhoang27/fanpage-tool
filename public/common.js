/* global document, fetch */
/* Ham dung chung cho ca 3 trang. Nap truoc app.js / comments.js. */
'use strict';

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function fmtAgo(h) {
  if (h == null) return '';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} phút trước`;
  if (h < 24) return `${Math.round(h)} giờ trước`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hôm qua' : `${d} ngày trước`;
}

/** Thong bao nho goc phai duoi, tu bien mat. type: '' | 'ok' | 'err' */
function toast(msg, type = '', ms = 3500) {
  let box = document.querySelector('.toasts');
  if (!box) {
    box = document.createElement('div');
    box.className = 'toasts';
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/** Avatar tron co chu cai dau, mau co dinh theo ten */
const AVATAR_COLORS = ['#1877f2', '#12a150', '#e8590c', '#7048e8', '#d6336c', '#0c8599', '#b25e09', '#5c7cfa'];
function avatar(name) {
  const n = String(name || '?').trim();
  const letter = (n.split(/\s+/).pop() || '?')[0].toUpperCase();
  let h = 0;
  for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const color = AVATAR_COLORS[h % AVATAR_COLORS.length];
  return `<div class="avatar" style="background:${color}">${esc(letter)}</div>`;
}

/** Page dang lam viec — gui kem khi gui tin de server chan neu vua doi Page */
let currentPageId = null;

/** Chip "● Ten Page ▾" tren thanh tren cung, bam vao de doi Page */
async function loadPageChip() {
  const chip = $('pageChip');
  if (!chip) return;
  let pages = [];
  try {
    const r = await fetch('/api/page');
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    currentPageId = String(j.id);
    try { pages = await (await fetch('/api/pages')).json(); } catch { /* chi hien 1 Page */ }
    chip.className = 'page-chip ok';
    chip.innerHTML = `<span class="dot"></span><span class="pc-name">${esc(j.name || 'Page ' + j.id)}</span>` +
      (pages.length > 1 ? `<span class="pc-count">${pages.length}</span>` : '') + '<span class="pc-caret">▾</span>';
    chip.title = 'Bấm để đổi Page';
  } catch (e) {
    chip.className = 'page-chip err';
    chip.innerHTML = '<span class="dot"></span>Chưa kết nối ▾';
    chip.title = e.message;
  }
  renderPageMenu(pages);
}

function renderPageMenu(pages) {
  const menu = $('pageMenu');
  if (!menu) return;
  const rows = pages.map((p) => `
    <button class="pm-item${p.active ? ' on' : ''}" data-id="${esc(p.id)}" ${p.active ? 'disabled' : ''}>
      ${avatar(p.name)}<span class="pm-name">${esc(p.name)}</span>${p.active ? '<span class="pm-check">✓ Đang dùng</span>' : ''}
    </button>`).join('');
  menu.innerHTML =
    `<div class="pm-head">Page của bạn</div>${rows || '<div class="pm-empty">Chưa có Page nào</div>'}` +
    `<div class="pm-sep"></div>` +
    `<a class="pm-link" href="/auth/login?choose=1">＋ Thêm Page / kết nối lại</a>` +
    `<a class="pm-link" href="/setup.html">⚙ Quản lý kết nối</a>`;

  menu.querySelectorAll('.pm-item:not(.on)').forEach((b) => {
    b.onclick = async () => {
      try {
        const j = await postJson('/api/pages/switch', { id: b.dataset.id });
        toast(`Đã chuyển sang ${j.name}`, 'ok');
        setTimeout(() => location.reload(), 400);
      } catch (e) {
        toast('Không chuyển được: ' + e.message, 'err');
      }
    };
  });
}

/** POST JSON tien loi */
async function postJson(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Lỗi ${r.status}`);
  return j;
}

/** Doc luong NDJSON tu server, goi onEvent cho tung dong */
async function readStream(res, onEvent) {
  if (!res.ok && res.headers.get('content-type')?.includes('application/json')) {
    throw new Error((await res.json()).error);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
  }
}

/** Chen chuoi vao vi tri con tro cua textarea */
function insertAtCursor(ta, text) {
  const s = ta.selectionStart ?? ta.value.length;
  const e = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = s + text.length;
  ta.dispatchEvent(new Event('input'));
}

/** Thay {{name}} / {{first_name}} bang ten that */
function fillName(text, name) {
  const full = name || 'bạn';
  return text.replaceAll('{{name}}', full).replaceAll('{{first_name}}', full.split(' ').slice(-1)[0]);
}

/** Thanh tren cung giong nhau o ca 3 trang */
function renderTopbar(active) {
  const el = document.querySelector('.topbar');
  if (!el) return;
  const tab = (href, key, label) => `<a href="${href}" class="${active === key ? 'on' : ''}">${label}</a>`;
  el.innerHTML = `
    <div class="topbar-in">
      <div class="brand"><div class="brand-logo">💬</div>Rep khách hàng</div>
      <div class="page-switch">
        <button class="page-chip" id="pageChip" aria-haspopup="true"><span class="dot"></span>Đang kết nối…</button>
        <div class="page-menu" id="pageMenu" hidden></div>
      </div>
      <nav class="tabs">
        ${tab('/', 'msg', '💬 Tin nhắn')}
        ${tab('/comments.html', 'cmt', '📝 Comment')}
        ${tab('/setup.html', 'setup', '🔑 Kết nối')}
      </nav>
    </div>`;
  loadPageChip();

  // Mo / dong menu chon Page
  $('pageChip').onclick = (e) => { e.stopPropagation(); $('pageMenu').hidden = !$('pageMenu').hidden; };
  document.addEventListener('click', (e) => { if (!e.target.closest('.page-switch')) $('pageMenu').hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('pageMenu').hidden = true; });
}
