/* global document, fetch, $, esc, fmtAgo, toast, avatar, postJson, readStream, insertAtCursor, fillName, renderTopbar */
'use strict';

/* Trang tin nhan. Ham chung ($, esc, toast...) nam o common.js */

renderTopbar('msg');

const WEEK_H = 24 * 7;

let items = [];            // khach tra ve tu server
const selected = new Set(); // psid dang tick
let templates = [];
let sending = false;

// Trang thai bo loc
let range = { hours: 72 };  // { hours } hoac { from, to }
let lastFrom = 'customer';
let orderFilter = 'hide';
let query = '';

/* ======================= quy tac gui ======================= */

function canSend(it) {
  if (it.skipLabels?.length) return false;              // mang nhan bo qua
  if (it.ordered) return false;                        // da dat hang: khong lam phien
  if (it.hoursSinceLast < 24) return true;             // trong 24h: luon gui duoc
  if (it.hoursSinceLast >= WEEK_H) return false;       // qua 7 ngay: FB chan han
  return $('tagMode').value !== 'none';                // 24h-7 ngay: can nhan
}

function blockReason(it) {
  if (it.skipLabels?.length) return `Bỏ qua vì nhãn: ${it.skipLabels.join(', ')}`;
  if (it.ordered) return 'Đã đặt hàng — không nhắn';
  if (it.hoursSinceLast >= WEEK_H) return 'Quá 7 ngày — Facebook không cho gửi';
  return 'Quá 24 giờ — xem “Cài đặt gửi”';
}

/* ======================= bo loc ======================= */

// Chon khoang thoi gian bang chip
document.querySelectorAll('#rangeChips .chip').forEach((chip) => {
  chip.onclick = () => {
    document.querySelectorAll('#rangeChips .chip').forEach((c) => c.classList.toggle('on', c === chip));
    if (chip.dataset.custom) {
      $('customRange').hidden = false;
      $('fromDate').focus();
      return;
    }
    $('customRange').hidden = true;
    range = { hours: Number(chip.dataset.h) };
    loadConversations();
  };
});

$('btnApplyDate').onclick = () => {
  const from = $('fromDate').value;
  const to = $('toDate').value;
  if (!from || !to) return toast('Chọn cả hai ngày nhé.', 'err');
  if (from > to) return toast('"Từ ngày" phải trước "đến ngày".', 'err');
  range = { from, to };
  loadConversations();
};

/** Nut chon kieu "segmented": bam la doi gia tri roi goi onChange */
function bindSeg(id, onChange) {
  const btns = document.querySelectorAll(`#${id} button`);
  btns.forEach((b) => {
    b.onclick = () => {
      btns.forEach((x) => x.classList.toggle('on', x === b));
      onChange(b.dataset.v);
    };
  });
}

bindSeg('lastFromSeg', (v) => { lastFrom = v; loadConversations(); });
bindSeg('orderSeg', (v) => { orderFilter = v; updateMoreCount(); loadConversations(); });

$('btnMore').onclick = () => { $('morePanel').hidden = !$('morePanel').hidden; };
$('showSkipped').onchange = () => { updateMoreCount(); loadConversations(); };
$('btnReload').onclick = () => loadConversations();
$('search').oninput = () => { query = $('search').value.trim().toLowerCase(); renderList(); };

/** So bo loc phu dang bat — hien tren nut "Lọc thêm" de khoi quen */
function updateMoreCount() {
  const n = (orderFilter !== 'hide' ? 1 : 0) + skipLabelIds.size + ($('showSkipped').checked ? 1 : 0);
  $('moreCount').hidden = n === 0;
  $('moreCount').textContent = String(n);
}

/* ======================= tai danh sach ======================= */

let orderedCount = 0;
let labelSkippedCount = 0;
let loadSeq = 0;

async function loadConversations() {
  const seq = ++loadSeq;
  const qs = new URLSearchParams({
    lastFrom,
    orderFilter,
    labelFilter: $('showSkipped').checked ? 'show' : 'hide',
    maxPages: '5',
  });

  if (range.hours) {
    qs.set('minHours', '0');
    qs.set('maxHours', String(range.hours));
  } else {
    qs.set('fromTs', String(new Date(range.from + 'T00:00:00').getTime()));
    qs.set('toTs', String(new Date(range.to + 'T23:59:59.999').getTime()));
  }

  $('summary').textContent = 'Đang tải…';
  $('list').innerHTML = '<div class="empty"><span class="big-emoji">⏳</span>Đang tải danh sách khách…</div>';

  try {
    const r = await fetch('/api/conversations?' + qs);
    const j = await r.json();
    if (seq !== loadSeq) return; // da co lan tai moi hon
    if (!r.ok) throw new Error(j.error);

    // Nguoi gui duoc len dau, roi toi ai nhan gan day nhat
    items = j.items.sort((a, b) => (canSend(b) - canSend(a)) || (a.hoursSinceLast - b.hoursSinceLast));
    orderedCount = j.orderedCount || 0;
    labelSkippedCount = j.labelFilter === 'hide' ? j.labelSkippedCount || 0 : 0;
    selected.clear();
    // tick san nhung nguoi gui duoc va chua tung gui
    items.filter((it) => canSend(it) && !it.alreadySent).forEach((it) => selected.add(it.psid));
    renderList();
  } catch (e) {
    if (seq !== loadSeq) return;
    items = [];
    $('list').innerHTML = `<div class="empty"><span class="big-emoji">⚠️</span>Không tải được danh sách.<br><small>${esc(e.message)}</small></div>`;
    $('summary').textContent = '';
    updatePreview();
  }
}

function visibleItems() {
  if (!query) return items;
  return items.filter((it) =>
    `${it.name} ${it.lastCustomerMessage || ''} ${it.lastMessage || ''}`.toLowerCase().includes(query)
  );
}

function renderList() {
  const box = $('list');
  box.innerHTML = '';
  const list = visibleItems();

  items.forEach((it) => { if (!canSend(it)) selected.delete(it.psid); });

  if (!list.length) {
    box.innerHTML = query
      ? `<div class="empty"><span class="big-emoji">🔍</span>Không có khách nào khớp “${esc(query)}”.</div>`
      : '<div class="empty"><span class="big-emoji">🎉</span>Không có khách nào cần rep trong khoảng thời gian này.<br><small>Thử chọn khoảng thời gian dài hơn ở trên.</small></div>';
    updateSummary();
    return;
  }

  list.forEach((it) => box.appendChild(renderItem(it)));
  updateSummary();
}

function renderItem(it) {
  const ok = canSend(it);
  const el = document.createElement('div');
  el.className = 'item' + (selected.has(it.psid) ? ' checked' : '') + (ok ? '' : ' blocked');

  // --- cac the nho ---
  let tags = '';
  if (!ok) tags += `<span class="badge no">${esc(blockReason(it))}</span>`;
  if (it.alreadySent) tags += '<span class="badge sent">✓ Đã gửi trước đó</span>';
  if (it.ordered) {
    const why = {
      manual: 'Bạn tự đánh dấu',
      auto: `Tool đoán: ${(it.orderReasons || []).join(', ') || 'có dấu hiệu đơn hàng'}`,
    }[it.orderSource] || 'Đã đặt hàng';
    tags += `<span class="badge order" title="${esc(why)}">📦 Đã đặt hàng</span>`;
  }
  (it.labels || []).forEach((l) => {
    const skip = skipLabelIds.has(l.id);
    tags += `<span class="badge fblabel${skip ? ' skip' : ''}" title="${skip ? 'Nhãn bỏ qua' : 'Nhãn'}">🏷 ${esc(l.name)}` +
      `<button class="x" data-id="${esc(l.id)}" title="Gỡ nhãn">×</button></span>`;
  });

  // --- nut thao tac (hien khi re chuot) ---
  const has = new Set((it.labels || []).map((l) => l.id));
  const addable = pageLabels.filter((l) => !has.has(l.id));
  const addSelect = addable.length
    ? `<select class="add-label"><option value="">🏷 Gắn nhãn…</option>` +
      addable.map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('') + '</select>'
    : '';
  const markBtn = it.ordered
    ? '<button class="btn xs mark" data-state="normal">↩ Chưa đặt hàng</button>'
    : '<button class="btn xs mark" data-state="ordered">📦 Đã đặt hàng</button>';

  const evidence = it.ordered && it.orderSource === 'auto' && it.orderReasons?.length
    ? `<div class="why">Vì: ${esc(it.orderReasons.join(' · '))}</div>`
    : '';

  el.innerHTML = `
    <input type="checkbox" ${selected.has(it.psid) ? 'checked' : ''} ${ok ? '' : 'disabled'} aria-label="Chọn ${esc(it.name)}" />
    ${avatar(it.name)}
    <div class="item-body">
      <div class="item-top">
        <span class="name">${esc(it.name)}</span>
        <span class="time">${fmtAgo(it.hoursSinceLast)}</span>
      </div>
      <div class="msg">${esc(it.lastCustomerMessage || it.lastMessage || '📎 Ảnh / sticker')}</div>
      ${evidence}
      <div class="tags">${tags}</div>
      <div class="item-actions">${markBtn}${addSelect}</div>
    </div>`;

  el.querySelector('.mark').onclick = (ev) => {
    ev.stopPropagation();
    markOrder(it, ev.currentTarget.dataset.state);
  };
  el.querySelectorAll('.badge .x').forEach((b) => {
    b.onclick = (ev) => {
      ev.stopPropagation();
      const l = it.labels.find((x) => x.id === b.dataset.id);
      if (confirm(`Gỡ nhãn "${l?.name}" khỏi ${it.name}?`)) setUserLabel(it, b.dataset.id, l?.name, 'remove');
    };
  });
  const sel = el.querySelector('.add-label');
  if (sel) {
    sel.onclick = (ev) => ev.stopPropagation();
    sel.onchange = () => {
      const l = pageLabels.find((x) => x.id === sel.value);
      if (l) setUserLabel(it, l.id, l.name, 'add');
    };
  }

  if (ok) {
    el.onclick = (ev) => {
      if (ev.target.closest('.item-actions')) return;
      const cb = el.querySelector('input');
      if (ev.target !== cb) cb.checked = !cb.checked;
      cb.checked ? selected.add(it.psid) : selected.delete(it.psid);
      el.classList.toggle('checked', cb.checked);
      updateSummary();
    };
  }
  return el;
}

function updateSummary() {
  const sendable = items.filter(canSend).length;
  const hidden = [];
  if (orderFilter === 'hide' && orderedCount) hidden.push(`${orderedCount} khách đã đặt hàng`);
  if (labelSkippedCount) hidden.push(`${labelSkippedCount} khách mang nhãn bỏ qua`);

  const what = { customer: 'khách chưa được rep', page: 'khách mình đã rep', all: 'khách' }[lastFrom];
  $('summary').innerHTML = items.length
    ? `<b>${items.length}</b> ${what} · gửi được <b class="g">${sendable}</b> · đã chọn <b>${selected.size}</b>` +
      (hidden.length ? ` · ẩn ${esc(hidden.join(', '))}` : '')
    : hidden.length ? `Không còn ai để nhắn · đã ẩn ${esc(hidden.join(', '))}` : 'Không có khách nào';

  updatePreview();
}

$('btnAll').onclick = () => {
  visibleItems().filter(canSend).forEach((it) => selected.add(it.psid));
  renderList();
};
$('btnNone').onclick = () => { selected.clear(); renderList(); };

/* ======================= gan nhan / danh dau ======================= */

async function setUserLabel(it, labelId, name, action) {
  try {
    const j = await postJson('/api/user-label', { psid: it.psid, labelId, name, action });
    if (j.sync && !j.sync.ok) toast(`Tool đã nhớ, nhưng chưa ghi được nhãn lên Facebook: ${j.sync.error}`, 'err', 6000);
    else toast(action === 'remove' ? `Đã gỡ nhãn "${name}"` : `Đã gắn nhãn "${name}" cho ${it.name}`, 'ok');
    await loadConversations();
  } catch (e) {
    toast('Không gắn được nhãn: ' + e.message, 'err');
  }
}

async function markOrder(it, state) {
  try {
    const j = await postJson('/api/order-mark', { psid: it.psid, state, name: it.name });
    if (j.sync && !j.sync.ok) {
      toast(`Đã đánh dấu, nhưng chưa ghi được nhãn "${j.sync.label}" lên Facebook: ${j.sync.error}`, 'err', 6000);
    } else {
      toast(state === 'ordered' ? `📦 ${it.name}: đã đặt hàng — sẽ không bị nhắn` : `${it.name}: bỏ đánh dấu đặt hàng`, 'ok');
    }
    await loadConversations();
  } catch (e) {
    toast('Không lưu được: ' + e.message, 'err');
  }
}

/* ======================= nhan cua Page ======================= */

let pageLabels = [];
let skipLabelIds = new Set();
let labelAccess = null;

async function loadLabels() {
  try {
    const r = await fetch('/api/labels');
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    pageLabels = j.labels || [];
    skipLabelIds = new Set(j.skipLabelIds || []);
    labelAccess = j.access;
    renderSkipLabels();
    fillLabelPickers();
    updateMoreCount();
    if (items.length) renderList(); // de hien o "Gan nhan" tren tung khach
  } catch (e) {
    $('skipLabelList').innerHTML = `<span class="empty-note">Không đọc được nhãn: ${esc(e.message)}</span>`;
  }
}

function renderSkipLabels() {
  const box = $('skipLabelList');
  box.innerHTML = '';
  if (!pageLabels.length) {
    box.innerHTML = '<span class="empty-note">Page chưa có nhãn nào — tạo nhãn ở ô bên dưới.</span>';
  }
  pageLabels.forEach((l) => {
    const on = skipLabelIds.has(l.id);
    const b = document.createElement('button');
    b.className = 'chip soft' + (on ? ' on' : '');
    b.textContent = (on ? '🚫 ' : '') + l.name;
    b.title = on ? 'Đang bỏ qua người mang nhãn này — bấm để thôi' : 'Bấm để bỏ qua người mang nhãn này';
    b.onclick = () => toggleSkipLabel(l.id);
    box.appendChild(b);
  });

  const st = $('labelStatus');
  if (labelAccess?.available) {
    st.className = 'note ok';
    st.textContent = '✅ Đọc được nhãn Page Inbox — nhãn gắn ở đâu tool cũng thấy.';
  } else {
    st.className = 'note';
    st.innerHTML = 'ℹ️ Bấm vào nhãn để bỏ qua người mang nhãn đó. Tool chỉ biết nhãn <b>gắn trong tool</b> ' +
      '(nút “🏷 Gắn nhãn” trên mỗi khách) — nhãn gắn tay trong Business Suite thì Facebook không cho tool đọc.';
  }
}

async function toggleSkipLabel(id) {
  skipLabelIds.has(id) ? skipLabelIds.delete(id) : skipLabelIds.add(id);
  renderSkipLabels();
  updateMoreCount();
  try {
    await postJson('/api/skip-labels', { ids: [...skipLabelIds] });
  } catch (e) {
    toast('Không lưu được: ' + e.message, 'err');
  }
  loadConversations();
}

$('btnCreateLabel').onclick = async () => {
  const name = $('newLabelName').value.trim();
  if (!name) return $('newLabelName').focus();
  try {
    const j = await postJson('/api/labels', { name });
    $('newLabelName').value = '';
    if (!pageLabels.some((l) => l.id === j.id)) pageLabels.push({ id: j.id, name: j.name });
    renderSkipLabels();
    fillLabelPickers();
    renderList();
    toast(`Đã tạo nhãn "${j.name}". Bấm vào nó để bỏ qua người mang nhãn.`, 'ok', 5000);
  } catch (e) {
    toast('Không tạo được nhãn: ' + e.message, 'err');
  }
};
$('newLabelName').onkeydown = (e) => { if (e.key === 'Enter') $('btnCreateLabel').click(); };

/* ----- cai dat ghi nhan len Page Inbox ----- */

const NEW_LABEL = '__new__';

async function loadLabelSync() {
  try {
    const j = await (await fetch('/api/label-sync')).json();
    $('syncOrderMark').checked = j.syncOrderMark;
    $('tagSent').checked = j.tagSent;
    $('orderLabelName').value = j.orderLabelName;
    $('sentLabelName').value = j.sentLabelName;
  } catch { /* dung mac dinh */ }
  fillLabelPickers();
}

/* O chon nhan: nhan Page dang co + "Tao nhan moi". Gia tri that nam o input an. */
function fillLabelPickers() {
  ['order', 'sent'].forEach((kind) => {
    const sel = $(kind + 'LabelPick');
    const input = $(kind + 'LabelName');
    const current = input.value.trim();
    const names = pageLabels.map((l) => l.name);
    const match = names.find((n) => n.toLowerCase() === current.toLowerCase());

    let html = names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    if (current && !match) html = `<option value="${esc(current)}">${esc(current)} (tự tạo khi cần)</option>` + html;
    html += `<option value="${NEW_LABEL}">＋ Tạo nhãn mới…</option>`;
    sel.innerHTML = html;
    sel.value = match || current || NEW_LABEL;
    input.hidden = sel.value !== NEW_LABEL;

    sel.onchange = () => {
      const isNew = sel.value === NEW_LABEL;
      input.value = isNew ? '' : sel.value;
      input.hidden = !isNew;
      if (isNew) input.focus();
    };
  });
}

$('btnSaveSync').onclick = async () => {
  try {
    const j = await postJson('/api/label-sync', {
      syncOrderMark: $('syncOrderMark').checked,
      tagSent: $('tagSent').checked,
      orderLabelName: $('orderLabelName').value.trim(),
      sentLabelName: $('sentLabelName').value.trim(),
    });
    $('orderLabelName').value = j.orderLabelName;
    $('sentLabelName').value = j.sentLabelName;
    toast('Đã lưu cài đặt nhãn.', 'ok');
    loadLabels();
  } catch (e) {
    toast('Không lưu được: ' + e.message, 'err');
  }
};

/* ======================= cau mau ======================= */

async function loadTemplates(selectId) {
  templates = await (await fetch('/api/templates')).json();
  $('tplSelect').innerHTML = '<option value="">📋 Chọn câu mẫu…</option>' +
    templates.map((t) => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join('');
  if (selectId) $('tplSelect').value = selectId;
}

$('tplSelect').onchange = () => {
  const t = templates.find((x) => x.id === $('tplSelect').value);
  if (!t) return;
  $('message').value = t.text;
  updatePreview();
};

async function saveTemplates(selectId) {
  await postJson('/api/templates', templates);
  await loadTemplates(selectId);
}

$('btnSaveTpl').onclick = async () => {
  const text = $('message').value.trim();
  if (!text) return toast('Viết nội dung trước rồi mới lưu được.', 'err');
  const cur = templates.find((x) => x.id === $('tplSelect').value);
  const title = prompt('Đặt tên cho câu mẫu này:', cur?.title || text.slice(0, 30))?.trim();
  if (!title) return;
  const existing = templates.find((t) => t.title === title);
  let id;
  if (existing) { existing.text = text; id = existing.id; }
  else { id = 't' + Date.now(); templates.push({ id, title, text }); }
  await saveTemplates(id);
  toast(`Đã lưu câu mẫu "${title}"`, 'ok');
};

$('btnDelTpl').onclick = async () => {
  const t = templates.find((x) => x.id === $('tplSelect').value);
  if (!t) return toast('Chọn một câu mẫu trong danh sách trước.', 'err');
  if (!confirm(`Xoá câu mẫu "${t.title}"?`)) return;
  templates = templates.filter((x) => x.id !== t.id);
  await saveTemplates();
  toast('Đã xoá câu mẫu.', 'ok');
};

/* ======================= soan tin + xem truoc ======================= */

document.querySelectorAll('.var-btn').forEach((b) => {
  b.onclick = () => insertAtCursor($('message'), b.dataset.var);
});
$('message').oninput = updatePreview;

function updatePreview() {
  const text = $('message').value.trim();
  const first = items.find((it) => selected.has(it.psid));
  $('previewLabel').textContent = first ? `${first.name} sẽ thấy:` : 'Khách sẽ thấy (ví dụ):';
  $('preview').className = 'bubble' + (text ? '' : ' empty-bubble');
  $('preview').textContent = text ? fillName(text, first?.name || 'Nguyễn Văn An') : 'Nội dung tin nhắn sẽ hiện ở đây';
  updateSend();
}

function updateSend() {
  const hasText = Boolean($('message').value.trim());
  $('sendCount').textContent = String(selected.size);
  $('btnSend').disabled = sending || selected.size === 0 || !hasText;
  $('btnSend').title = !hasText ? 'Viết nội dung tin nhắn trước' : selected.size ? '' : 'Chọn ít nhất 1 khách';
}

$('tagMode').onchange = () => {
  $('tagWarn').hidden = $('tagMode').value === 'none';
  renderList();
};

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
  if (!text) return toast('Bạn chưa viết nội dung tin nhắn.', 'err');
  const targets = items.filter((i) => selected.has(i.psid));
  if (!confirm(`Gửi tin này cho ${targets.length} khách?\n\n${fillName(text, targets[0]?.name)}`)) return;

  sending = true;
  updateSend();
  $('log').innerHTML = '';
  $('stats').textContent = 'Đang gửi…';
  setBar(0, targets.length);

  try {
    const res = await fetch('/api/send-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targets: targets.map((t) => ({
          psid: t.psid,
          name: t.name,
          hoursSinceLast: t.hoursSinceLast,
          ordered: t.ordered,
          skipLabels: t.skipLabels || [],
        })),
        pageId: currentPageId,
        text,
        delayMs: Math.round(Number($('delaySec').value || 0) * 1000),
        skipAlreadySent: $('skipSent').checked,
        skipOrdered: $('skipOrdered').checked,
        tagMode: $('tagMode').value,
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
  if (ev.status === 'labelling') {
    log(`Đang gắn nhãn "${ev.label}" cho ${ev.total} người…`);
    return;
  }

  if (ev.status === 'done') {
    setBar(1, 1);
    const msg = `Xong! Gửi được ${ev.ok} người` +
      (ev.fail ? ` · lỗi ${ev.fail}` : '') + (ev.skipped ? ` · bỏ qua ${ev.skipped}` : '');
    $('stats').textContent = msg;
    toast(msg, ev.fail ? 'err' : 'ok', 6000);
    if (ev.labelled) {
      const l = ev.labelled;
      log(`Nhãn "${l.label}": gắn được ${l.ok} người` + (l.fail ? `, lỗi ${l.fail}` : ''), l.fail ? 'error' : 'ok');
      (l.errors || []).forEach((m) => log('   ' + m, 'error'));
    }
    log('── Hoàn tất ──', 'done');
    loadConversations();
    return;
  }

  setBar(ev.index + 1, ev.total);
  $('stats').textContent = `Đang gửi ${ev.index + 1}/${ev.total}…`;
  if (ev.status === 'ok') log(`✓ ${ev.name}`, 'ok');
  else if (ev.status === 'skipped') log(`− ${ev.name}: ${ev.reason}`, 'skipped');
  else log(`✗ ${ev.name}: ${ev.error}`, 'error');
}

/* ======================= don dep ======================= */

$('btnResetLog').onclick = async () => {
  if (!confirm('Xoá lịch sử đã gửi? Sau đó tool sẽ cho gửi lại những người đã từng gửi.')) return;
  await fetch('/api/reset-sent-log', { method: 'POST' });
  toast('Đã xoá lịch sử đã gửi.', 'ok');
  loadConversations();
};

$('btnResetOrders').onclick = async () => {
  if (!confirm('Xoá hết đánh dấu "đã đặt hàng" bạn từng bấm? Tool sẽ quay lại tự đoán.')) return;
  await fetch('/api/reset-order-marks', { method: 'POST' });
  toast('Đã xoá đánh dấu đặt hàng.', 'ok');
  loadConversations();
};

/* ======================= khoi dong ======================= */

(function init() {
  const ymd = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const week = new Date();
  week.setDate(week.getDate() - 7);
  $('fromDate').value = ymd(week);
  $('toDate').value = ymd(new Date());

  loadTemplates();
  loadLabels();
  loadLabelSync();
  loadConversations();
})();
