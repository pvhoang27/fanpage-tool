/* global document, fetch, $, esc, fmtAgo, toast, avatar, postJson, readStream, insertAtCursor, fillName, renderTopbar */
'use strict';

/* Trang comment. Ham chung nam o common.js */

renderTopbar('cmt');

let posts = [];
let currentPost = null;
let items = [];
const selected = new Set();
let templates = [];
let sending = false;
let filterMode = 'unreplied';
let query = '';
let lastFocused = 'message'; // o soan thao vua bam vao, de nut "Chen" chen dung cho

/* ======================= bai viet ======================= */

async function loadPosts() {
  try {
    const r = await fetch('/api/posts?limit=25');
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    posts = j.items;
    $('postCount').textContent = `${posts.length} bài gần nhất`;
    renderPosts();
  } catch (e) {
    $('posts').innerHTML = '<div class="empty"><span class="big-emoji">⚠️</span>Không tải được bài viết.</div>';
    const needPerm = /pages_read_engagement|pages_manage_engagement|pages_read_user_content|Page Public Content/i.test(e.message);
    $('permWarn').hidden = false;
    $('permWarn').innerHTML = needPerm
      ? `<b>Kết nối hiện tại chưa có quyền đọc bài viết và comment.</b>
         <p>Vào trang Kết nối, bấm <b>Kết nối lại</b> và tick đủ quyền khi Facebook hỏi.</p>
         <p><a class="cta" href="/setup.html">🔑 Mở trang Kết nối</a></p>
         <p class="small">Lỗi gốc: ${esc(e.message)}</p>`
      : `<b>Lỗi:</b> ${esc(e.message)}`;
  }
}

function renderPosts() {
  const box = $('posts');
  box.innerHTML = '';
  if (!posts.length) {
    box.innerHTML = '<div class="empty"><span class="big-emoji">📭</span>Page chưa có bài viết nào.</div>';
    return;
  }
  posts.forEach((p) => {
    const el = document.createElement('div');
    el.className = 'item post' + (currentPost?.id === p.id ? ' checked' : '');
    el.innerHTML = `
      ${p.picture ? `<img class="thumb" src="${esc(p.picture)}" alt="" />` : '<div class="thumb"></div>'}
      <div class="item-body">
        <div class="msg">${esc(p.message || '(Bài không có chữ)')}</div>
        <div class="time" style="margin:4px 0 0">${new Date(p.createdTime).toLocaleDateString('vi-VN')} · 💬 ${p.commentCount}</div>
      </div>`;
    el.onclick = () => {
      currentPost = p;
      renderPosts();
      loadComments();
    };
    box.appendChild(el);
  });
}

/* ======================= comment ======================= */

async function loadComments() {
  if (!currentPost) return;
  $('summary').textContent = 'Đang tải comment…';
  $('list').innerHTML = '<div class="empty"><span class="big-emoji">⏳</span>Đang tải…</div>';

  const qs = new URLSearchParams({ postId: currentPost.id, onlyUnreplied: String(filterMode === 'unreplied') });
  try {
    const r = await fetch('/api/comments?' + qs);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    items = j.items;
    selected.clear();
    items.filter((c) => !c.alreadyReplied).forEach((c) => selected.add(c.commentId));
    renderList();
  } catch (e) {
    items = [];
    $('list').innerHTML = `<div class="empty"><span class="big-emoji">⚠️</span>Không tải được comment.<br><small>${esc(e.message)}</small></div>`;
    $('summary').textContent = '';
    updateSend();
  }
}

function visibleItems() {
  if (!query) return items;
  return items.filter((c) => `${c.name} ${c.message || ''}`.toLowerCase().includes(query));
}

function renderList() {
  const box = $('list');
  box.innerHTML = '';
  const list = visibleItems();

  if (!list.length) {
    box.innerHTML = query
      ? `<div class="empty"><span class="big-emoji">🔍</span>Không có comment nào khớp “${esc(query)}”.</div>`
      : `<div class="empty"><span class="big-emoji">🎉</span>${filterMode === 'unreplied' ? 'Bài này không còn comment nào chưa trả lời.' : 'Bài này chưa có comment.'}</div>`;
    updateSummary();
    return;
  }

  list.forEach((c) => {
    const el = document.createElement('div');
    el.className = 'item' + (selected.has(c.commentId) ? ' checked' : '');

    let tags = '';
    if (c.pageReplied) tags += '<span class="badge no">Page đã rep trên Facebook</span>';
    if (c.alreadyReplied) tags += '<span class="badge sent">✓ Tool đã trả lời</span>';
    if (!c.canPrivateReply) tags += '<span class="badge no">Quá 7 ngày — không nhắn riêng được</span>';

    el.innerHTML = `
      <input type="checkbox" ${selected.has(c.commentId) ? 'checked' : ''} aria-label="Chọn comment của ${esc(c.name)}" />
      ${avatar(c.name)}
      <div class="item-body">
        <div class="item-top">
          <span class="name">${esc(c.name)}</span>
          <span class="time">${fmtAgo(c.hoursSince)}${c.likeCount ? ` · 👍 ${c.likeCount}` : ''}</span>
        </div>
        <div class="msg" style="white-space:normal">${esc(c.message || '📎 Ảnh / sticker')}</div>
        <div class="tags">${tags}</div>
      </div>`;

    el.onclick = (ev) => {
      const cb = el.querySelector('input');
      if (ev.target !== cb) cb.checked = !cb.checked;
      cb.checked ? selected.add(c.commentId) : selected.delete(c.commentId);
      el.classList.toggle('checked', cb.checked);
      updateSummary();
    };
    box.appendChild(el);
  });
  updateSummary();
}

function updateSummary() {
  $('summary').innerHTML = items.length
    ? `<b>${items.length}</b> comment · đã chọn <b class="g">${selected.size}</b>`
    : currentPost ? 'Không có comment nào phù hợp' : '👈 Chọn một bài viết để xem comment';
  updateSend();
}

function updateSend() {
  $('sendCount').textContent = String(selected.size);
  $('btnSend').disabled = sending || selected.size === 0;
}

$('btnAll').onclick = () => { visibleItems().forEach((c) => selected.add(c.commentId)); renderList(); };
$('btnNone').onclick = () => { selected.clear(); renderList(); };
$('btnReload').onclick = () => loadComments();
$('search').oninput = () => { query = $('search').value.trim().toLowerCase(); renderList(); };

document.querySelectorAll('#filterSeg button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('#filterSeg button').forEach((x) => x.classList.toggle('on', x === b));
    filterMode = b.dataset.v;
    loadComments();
  };
});

/* ======================= cau mau ======================= */

async function loadTemplates(selectId) {
  templates = await (await fetch('/api/comment-templates')).json();
  $('tplSelect').innerHTML = '<option value="">📋 Chọn câu mẫu…</option>' +
    templates.map((t) => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join('');
  if (selectId) $('tplSelect').value = selectId;
}

$('tplSelect').onchange = () => {
  const t = templates.find((x) => x.id === $('tplSelect').value);
  if (t) $('message').value = t.text;
};

async function saveTemplates(selectId) {
  await postJson('/api/comment-templates', templates);
  await loadTemplates(selectId);
}

$('btnSaveTpl').onclick = async () => {
  const text = $('message').value.trim();
  if (!text) return toast('Viết câu trả lời công khai trước rồi mới lưu được.', 'err');
  const cur = templates.find((x) => x.id === $('tplSelect').value);
  const title = prompt('Đặt tên cho câu mẫu này:', cur?.title || text.slice(0, 30))?.trim();
  if (!title) return;
  const existing = templates.find((t) => t.title === title);
  let id;
  if (existing) { existing.text = text; id = existing.id; }
  else { id = 'c' + Date.now(); templates.push({ id, title, text }); }
  await saveTemplates(id);
  toast(`Đã lưu câu mẫu "${title}"`, 'ok');
};

$('btnDelTpl').onclick = async () => {
  const t = templates.find((x) => x.id === $('tplSelect').value);
  if (!t) return toast('Chọn một câu mẫu trước.', 'err');
  if (!confirm(`Xoá câu mẫu "${t.title}"?`)) return;
  templates = templates.filter((x) => x.id !== t.id);
  await saveTemplates();
  toast('Đã xoá câu mẫu.', 'ok');
};

/* ======================= soan ======================= */

$('sendPrivate').onchange = () => {
  const on = $('sendPrivate').checked;
  $('privateMessage').hidden = !on;
  $('privateTip').hidden = !on;
};
$('message').onfocus = () => { lastFocused = 'message'; };
$('privateMessage').onfocus = () => { lastFocused = 'privateMessage'; };
document.querySelectorAll('.var-btn').forEach((b) => {
  b.onclick = () => {
    const ta = $(lastFocused);
    insertAtCursor(ta.hidden ? $('message') : ta, b.dataset.var);
  };
});

/* ======================= gui ======================= */

function log(msg, cls = '') {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = msg;
  $('log').appendChild(el);
  $('log').scrollTop = $('log').scrollHeight;
}

function setBar(done, total) {
  $('bar').hidden = false;
  $('bar').firstElementChild.style.width = total ? `${Math.round((done / total) * 100)}%` : '0';
}

$('btnSend').onclick = async () => {
  const text = $('message').value.trim();
  const privateText = $('privateMessage').value.trim();
  const pub = $('publicReply').checked;
  const priv = $('sendPrivate').checked;

  if (!pub && !priv) return toast('Chọn ít nhất một kiểu: trả lời công khai hoặc nhắn riêng.', 'err');
  if (pub && !text) return toast('Bạn chưa viết câu trả lời công khai.', 'err');
  if (priv && !privateText && !text) return toast('Bạn chưa viết nội dung nhắn riêng.', 'err');

  const targets = items.filter((c) => selected.has(c.commentId));
  const what = [pub && 'trả lời công khai', priv && 'nhắn tin riêng'].filter(Boolean).join(' + ');
  const sample = fillName(text || privateText, targets[0]?.name);
  if (!confirm(`${targets.length} comment sẽ được ${what}.\n\nVí dụ: ${sample}`)) return;

  sending = true;
  updateSend();
  $('log').innerHTML = '';
  $('stats').textContent = 'Đang gửi…';
  setBar(0, targets.length);

  try {
    const res = await fetch('/api/reply-comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targets: targets.map((c) => ({ commentId: c.commentId, name: c.name })),
        pageId: currentPageId,
        text,
        privateText,
        publicReply: pub,
        sendPrivate: priv,
        delayMs: Math.round(Number($('delaySec').value || 0) * 1000),
        skipAlreadyReplied: $('skipReplied').checked,
      }),
    });
    await readStream(res, handleEvent);
  } catch (e) {
    log(`Lỗi: ${e.message}`, 'error');
    toast('Gửi bị lỗi: ' + e.message, 'err');
  } finally {
    sending = false;
    updateSend();
  }
};

function handleEvent(ev) {
  if (ev.status === 'done') {
    setBar(1, 1);
    const msg = `Xong! Trả lời được ${ev.ok} comment` +
      (ev.fail ? ` · lỗi ${ev.fail}` : '') + (ev.skipped ? ` · bỏ qua ${ev.skipped}` : '');
    $('stats').textContent = msg;
    toast(msg, ev.fail ? 'err' : 'ok', 6000);
    log('── Hoàn tất ──', 'done');
    loadComments();
    return;
  }

  setBar(ev.index + 1, ev.total);
  $('stats').textContent = `Đang xử lý ${ev.index + 1}/${ev.total}…`;
  if (ev.status === 'ok') {
    log(`✓ ${ev.name} (${ev.did.join(' + ')})` + (ev.partialError ? ` — lỗi: ${ev.partialError.join('; ')}` : ''),
      ev.partialError ? 'skipped' : 'ok');
  } else if (ev.status === 'skipped') {
    log(`− ${ev.name}: ${ev.reason}`, 'skipped');
  } else {
    log(`✗ ${ev.name}: ${ev.error}`, 'error');
  }
}

/* ======================= don dep ======================= */

$('btnResetLog').onclick = async () => {
  if (!confirm('Xoá lịch sử? Sau đó tool cho phép trả lời lại các comment cũ.')) return;
  await fetch('/api/reset-comment-log', { method: 'POST' });
  toast('Đã xoá lịch sử đã trả lời.', 'ok');
  loadComments();
};

/* ======================= khoi dong ======================= */

loadPosts();
loadTemplates();
