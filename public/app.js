/* global document, fetch, $, esc, fmtAgo, toast, avatar, postJson, readStream, insertAtCursor, fillName, renderTopbar, Spin, currentPageId */
'use strict';

/* Trang xao tin nhan. Ham chung o common.js, bo xao o spin.js */

renderTopbar('msg');

const EXAMPLE = '{Dạ chào|Em chào|Chào} {{first_name}} {ạ|nha}! Shop {vừa về|mới có} {mẫu mới|hàng mới} {đẹp lắm|xinh lắm}, ' +
  '{anh/chị|mình} {xem thử|tham khảo} {nhé|nha} {ạ|}!';

let items = [];             // khach con trong 24h
const selected = new Set(); // psid dang tick
let templates = [];
let sending = false;
let rangeHours = 24;
let query = '';

/** Con trong cua so 24h tinh tu tin cuoi cua khach */
const canSend = (it) => it.hoursSinceCustomer != null && it.hoursSinceCustomer < 24;

/* ======================= bo loc ======================= */

document.querySelectorAll('#rangeChips .chip').forEach((chip) => {
  chip.onclick = () => {
    document.querySelectorAll('#rangeChips .chip').forEach((c) => c.classList.toggle('on', c === chip));
    rangeHours = Number(chip.dataset.h);
    loadConversations();
  };
});

$('btnReload').onclick = () => loadConversations();
$('search').oninput = () => { query = $('search').value.trim().toLowerCase(); renderList(); };

/* ======================= tai danh sach ======================= */

let loadSeq = 0;

async function loadConversations() {
  const seq = ++loadSeq;
  const qs = new URLSearchParams({
    by: 'customer',          // tinh gio theo tin cuoi cua khach
    lastFrom: 'all',         // tin cuoi la ai cung duoc
    orderFilter: 'all',      // khong an khach da dat hang
    labelFilter: 'show',
    minHours: '0',
    maxHours: String(rangeHours),
    maxPages: '5',
  });

  $('summary').textContent = 'Đang tải…';
  $('list').innerHTML = '<div class="empty"><span class="big-emoji">⏳</span>Đang tải danh sách khách…</div>';

  try {
    const r = await fetch('/api/conversations?' + qs);
    const j = await r.json();
    if (seq !== loadSeq) return;
    if (!r.ok) throw new Error(j.error);

    // Ai moi nhan gan nhat len dau
    items = j.items.sort((a, b) => a.hoursSinceCustomer - b.hoursSinceCustomer);
    selected.clear();
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

  if (!list.length) {
    box.innerHTML = query
      ? `<div class="empty"><span class="big-emoji">🔍</span>Không có khách nào khớp “${esc(query)}”.</div>`
      : `<div class="empty"><span class="big-emoji">💤</span>Không có khách nào nhắn trong ${rangeHours} giờ qua.</div>`;
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

  let tags = '';
  if (it.alreadySent) tags += '<span class="badge sent">✓ Đã nhắn sau tin cuối của khách</span>';
  if (it.lastFromPage) tags += '<span class="badge no">Mình đã rep</span>';
  if (!ok) tags += '<span class="badge no">Quá 24 giờ — Facebook không cho gửi</span>';

  const left = 24 - (it.hoursSinceCustomer ?? 24);
  const leftTxt = ok && left < 3 ? ` · <span style="color:var(--amber)">còn ${left < 1 ? Math.max(1, Math.round(left * 60)) + ' phút' : Math.floor(left) + ' giờ'}</span>` : '';

  el.innerHTML = `
    <input type="checkbox" ${selected.has(it.psid) ? 'checked' : ''} ${ok ? '' : 'disabled'} aria-label="Chọn ${esc(it.name)}" />
    ${avatar(it.name)}
    <div class="item-body">
      <div class="item-top">
        <span class="name">${esc(it.name)}</span>
        <span class="time" title="Lần cuối khách nhắn">${fmtAgo(it.hoursSinceCustomer)}${leftTxt}</span>
      </div>
      <div class="msg">${esc(it.lastCustomerMessage || '📎 Ảnh / sticker')}</div>
      <div class="tags">${tags}</div>
    </div>`;

  if (ok) {
    el.onclick = (ev) => {
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
  const sent = items.filter((it) => it.alreadySent).length;
  $('summary').innerHTML = items.length
    ? `<b>${items.length}</b> khách nhắn trong ${rangeHours} giờ qua · đã chọn <b class="g">${selected.size}</b>` +
      (sent ? ` · ${sent} người đã nhắn rồi` : '')
    : `Không có khách nào trong ${rangeHours} giờ qua`;
  updatePreview();
}

$('btnAll').onclick = () => {
  visibleItems().filter(canSend).forEach((it) => selected.add(it.psid));
  renderList();
};
$('btnNone').onclick = () => { selected.clear(); renderList(); };

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
  const title = prompt('Đặt tên cho câu mẫu này:', cur?.title || 'Câu xào ' + (templates.length + 1))?.trim();
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

/* ======================= soan + xao ======================= */

document.querySelectorAll('.var-btn[data-var]').forEach((b) => {
  b.onclick = () => insertAtCursor($('message'), b.dataset.var);
});

/* Boi den 1 tu roi bam -> {tu do|} va dat con tro vao cho go cach noi khac */
$('btnChoice').onclick = () => {
  const ta = $('message');
  const s = ta.selectionStart ?? ta.value.length;
  const e = ta.selectionEnd ?? ta.value.length;
  const picked = ta.value.slice(s, e);
  const ins = `{${picked}|}`;
  ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = s + ins.length - 1; // ngay truoc dau }
  updatePreview();
  if (!picked) toast('Gõ các cách nói vào giữa { }, ngăn nhau bằng dấu |', '', 4000);
};

$('btnExample').onclick = () => {
  if ($('message').value.trim() && !confirm('Thay nội dung đang viết bằng câu ví dụ?')) return;
  $('message').value = EXAMPLE;
  updatePreview();
};

$('message').oninput = updatePreview;
$('btnReshuffle').onclick = updatePreview;

function updatePreview() {
  const text = $('message').value.trim();
  const n = text ? Spin.variants(text) : 0;

  // Thong tin xao
  const info = $('spinInfo');
  if (!text) {
    info.className = 'note';
    info.innerHTML = 'Viết <code>{Chào|Dạ chào|Hi}</code> → mỗi khách nhận một cách nói ngẫu nhiên. Bấm <b>💡 Ví dụ</b> để xem mẫu.';
  } else if (n > 1) {
    info.className = 'note ok';
    info.innerHTML = `🔀 Câu này xào ra được <b>${n === Infinity ? 'rất nhiều' : n.toLocaleString('vi-VN')}</b> kiểu khác nhau.`;
  } else {
    info.className = 'note warn';
    info.innerHTML = '⚠️ Câu này chưa xào — ai cũng nhận y hệt. Bôi đen một từ rồi bấm <b>🔀 Thêm lựa chọn</b>.';
  }

  // 3 vi du voi ten that cua 3 khach dang chon
  const picks = items.filter((it) => selected.has(it.psid)).slice(0, 3);
  // Luon du 3 ten de thay ro do xao (thieu thi them ten vi du)
  const names = [...picks.map((p) => p.name), 'Nguyễn Văn An', 'Trần Thị Bình', 'Lê Minh'].slice(0, 3);
  $('previewLabel').textContent = picks.length ? 'Khách sẽ nhận (ví dụ):' : 'Khách sẽ nhận (ví dụ, tên giả):';
  $('preview').innerHTML = text
    ? names.slice(0, n > 1 ? 3 : 1).map((nm) =>
        `<div class="bubble-row"><span class="who">${esc(nm.split(' ').slice(-1)[0])}</span>` +
        `<div class="bubble">${esc(fillName(Spin.spin(text), nm))}</div></div>`).join('')
    : '<div class="bubble empty-bubble">Nội dung tin nhắn sẽ hiện ở đây</div>';
  $('btnReshuffle').hidden = !(n > 1);

  updateSend();
}

function updateSend() {
  const hasText = Boolean($('message').value.trim());
  $('sendCount').textContent = String(selected.size);
  $('btnSend').disabled = sending || selected.size === 0 || !hasText;
  $('btnSend').title = !hasText ? 'Viết nội dung tin nhắn trước' : selected.size ? '' : 'Chọn ít nhất 1 khách';
}

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
  const targets = items.filter((i) => selected.has(i.psid) && canSend(i));
  const n = Spin.variants(text);
  const note = n > 1 ? `Mỗi người nhận một câu xào khác nhau (${n === Infinity ? 'rất nhiều' : n} kiểu).` : 'Ai cũng nhận y hệt một câu.';
  if (!confirm(`Gửi cho ${targets.length} khách?\n${note}\n\nVí dụ: ${fillName(Spin.spin(text), targets[0]?.name)}`)) return;

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
          hoursSinceLast: t.hoursSinceCustomer, // cua so 24h tinh theo tin cua khach
          lastCustomerTs: t.lastCustomerTs,
        })),
        pageId: currentPageId,
        text,
        delayMs: Math.round(Number($('delaySec').value || 0) * 1000),
        skipAlreadySent: $('skipSent').checked,
        skipOrdered: false,
        tagMode: 'none',
        tagSent: false,
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
  if (ev.status === 'labelling') return;

  if (ev.status === 'done') {
    setBar(1, 1);
    const msg = `Xong! Gửi được ${ev.ok} người` +
      (ev.fail ? ` · lỗi ${ev.fail}` : '') + (ev.skipped ? ` · bỏ qua ${ev.skipped}` : '');
    $('stats').textContent = msg;
    toast(msg, ev.fail ? 'err' : 'ok', 6000);
    log('── Hoàn tất ──', 'done');
    loadConversations();
    return;
  }

  setBar(ev.index + 1, ev.total);
  $('stats').textContent = `Đang gửi ${ev.index + 1}/${ev.total}…`;
  if (ev.status === 'ok') log(`✓ ${ev.name}: ${ev.text || ''}`, 'ok');
  else if (ev.status === 'skipped') log(`− ${ev.name}: ${ev.reason}`, 'skipped');
  else log(`✗ ${ev.name}: ${ev.error}`, 'error');
}

/* ======================= don dep ======================= */

$('btnResetLog').onclick = async () => {
  if (!confirm('Xoá lịch sử đã gửi? Sau đó tool cho nhắn lại cả những người đã nhắn.')) return;
  await fetch('/api/reset-sent-log', { method: 'POST' });
  toast('Đã xoá lịch sử đã gửi.', 'ok');
  loadConversations();
};

/* ======================= khoi dong ======================= */

loadTemplates();
loadConversations();
updatePreview();
