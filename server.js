'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');

const fb = require('./lib/fb');
const cmt = require('./lib/comments');
const auth = require('./lib/auth');
const Spin = require('./public/spin.js');
const store = require('./lib/store');
const order = require('./lib/order');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function errPayload(e) {
  return {
    error: e.message || String(e),
    code: e.fbCode,
    subcode: e.fbSubcode,
    type: e.fbType,
  };
}

/* ---------- Page info ---------- */
app.get('/api/page', async (req, res) => {
  try {
    const info = await fb.getPageInfo();
    res.json(info);
  } catch (e) {
    res.status(400).json(errPayload(e));
  }
});

/* ---------- Nhan cua Page Inbox (vi du "Da dat hang") ---------- */

/** Nho ket qua thu quyen doc nhan trong 5 phut, khoi thu di thu lai lien tuc */
let labelProbe = { at: 0, result: null };

async function labelAccess(samplePsid) {
  const FRESH = 5 * 60 * 1000;
  if (labelProbe.result && Date.now() - labelProbe.at < FRESH) return labelProbe.result;

  const raw = await fb.probeLabelAccess(samplePsid);
  const result = raw.available
    ? raw
    : {
        ...raw,
        reason:
          raw.code === 100 && raw.subcode === 33
            ? 'Facebook không cho app đọc hồ sơ của từng khách, nên không tra được nhãn của họ'
            : raw.reason,
      };

  labelProbe = { at: Date.now(), result };
  return result;
}

app.get('/api/labels', async (req, res) => {
  try {
    const labels = await fb.fetchPageLabels();
    const saved = store.getOrderLabelIds();
    const orderLabelIds = saved || labels.filter((l) => order.looksLikeOrderLabel(l.name)).map((l) => l.id);

    // Lay tam 1 psid bat ky de thu xem co doc duoc nhan cua khach khong
    let sample = null;
    try {
      const { pageId, conversations } = await fb.fetchConversations({ maxPages: 1, pageSize: 1, msgLimit: 1 });
      const p = conversations[0]?.participants?.data?.find((x) => String(x.id) !== String(pageId));
      sample = p?.id || null;
    } catch { /* khong sao, chi la mau thu */ }

    const savedSkip = store.getSkipLabelIds();
    res.json({
      labels,
      orderLabelIds,
      skipLabelIds: savedSkip || orderLabelIds,
      usingDefault: !saved,
      access: await labelAccess(sample),
    });
  } catch (e) {
    res.status(400).json(errPayload(e));
  }
});

/* ---------- Ghi nhan len Page Inbox ---------- */

/** Nho id cua nhan theo ten, khoi phai tra cuu lai moi lan */
const labelIdCache = new Map();

async function labelIdFor(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) throw new Error('Ten nhan de trong');
  if (labelIdCache.has(key)) return labelIdCache.get(key);
  const id = await fb.ensureLabel(name);
  labelIdCache.set(key, id);
  return id;
}

app.get('/api/label-sync', (req, res) => res.json(store.getLabelSync()));

app.post('/api/label-sync', (req, res) => {
  const next = store.saveLabelSync(req.body || {});
  labelIdCache.clear(); // ten nhan co the vua doi
  res.json(next);
});

/** Tao nhan moi tren Page (trung ten thi dung lai nhan cu) */
app.post('/api/labels', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Tên nhãn để trống' });
    const id = await fb.ensureLabel(name);
    labelIdCache.set(name.toLowerCase(), id);
    res.json({ id, name });
  } catch (e) {
    res.status(400).json(errPayload(e));
  }
});

/** Chon nhan nao thi bo qua khach mang nhan do */
app.post('/api/skip-labels', (req, res) => {
  const ids = Array.isArray(req.body) ? req.body : req.body?.ids;
  res.json({ ok: true, skipLabelIds: store.saveSkipLabelIds(ids) });
});

/**
 * Gan / go 1 nhan cho 1 khach ngay trong tool.
 * Luon ghi vao ban sao cua tool (de loc duoc), roi moi thu ghi len Facebook.
 */
app.post('/api/user-label', async (req, res) => {
  const { psid, labelId, name, action = 'add' } = req.body || {};
  if (!psid || !labelId) return res.status(400).json({ error: 'Thieu psid hoac labelId' });

  if (action === 'remove') store.removeUserLabel(psid, labelId);
  else store.addUserLabels(psid, { id: labelId, name: name || '' });

  let sync = { ok: true };
  try {
    if (action === 'remove') await fb.detachLabel(labelId, psid);
    else await fb.attachLabel(labelId, psid);
  } catch (e) {
    sync = { ok: false, error: e.message };
  }
  res.json({ ok: true, sync });
});

app.post('/api/order-labels', (req, res) => {
  const ids = Array.isArray(req.body) ? req.body : req.body?.ids;
  res.json({ ok: true, orderLabelIds: store.saveOrderLabelIds(ids) });
});

/* ---------- Danh sach hoi thoai lau chua rep ---------- */
app.get('/api/conversations', async (req, res) => {
  try {
    const minHours = Number(req.query.minHours ?? 24);
    const maxHours = req.query.maxHours ? Number(req.query.maxHours) : null;
    const fromTs = req.query.fromTs ? Number(req.query.fromTs) : null;
    const toTs = req.query.toTs ? Number(req.query.toTs) : null;
    const lastFrom = ['customer', 'page', 'all'].includes(req.query.lastFrom)
      ? req.query.lastFrom
      : 'customer';
    const maxPages = Math.min(Number(req.query.maxPages ?? 5), 30);
    // hide = an khach da dat hang (mac dinh) | only = chi xem ho | all = xem tat
    const orderFilter = ['hide', 'only', 'all'].includes(req.query.orderFilter)
      ? req.query.orderFilter
      : 'hide';

    const { pageId, conversations } = await fb.fetchConversations({ maxPages });
    const normalized = conversations.map((c) => fb.normalizeConversation(c, pageId));
    const by = req.query.by === 'customer' ? 'customer' : 'last';
    const filtered = fb.filterStale(normalized, { minHours, maxHours, fromTs, toTs, lastFrom, by });
    const sentLog = store.getSentLog();
    const marks = store.getOrderMarks();

    // Quet "#chotdon" tren MOI hoi thoai tai ve (ke ca ngoai khung gio dang xem) roi nho lai vinh vien
    const chotDon = store.addChotDon(
      normalized
        .map((c) => ({ psid: c.psid, at: order.findChotDon(c.messages), name: c.name, pageId }))
        .filter((c) => c.at)
    );

    // Nhan cua Page Inbox — chi doc duoc khi app du quyen, khong thi bo qua
    let labelsByPsid = {};
    let labelInfo = { available: false };
    try {
      labelInfo = await labelAccess(filtered[0]?.psid);
      if (labelInfo.available && filtered.length) {
        labelsByPsid = await fb.fetchUserLabelsBatch(filtered.map((it) => it.psid));
      }
    } catch (e) {
      labelInfo = { available: false, reason: e.message };
    }

    // Nhan do chinh tool da gan (ban sao cuc bo) — luon dung duoc
    const localLabels = store.getUserLabels();
    const labelFilter = req.query.labelFilter === 'show' ? 'show' : 'hide';

    let pageLabels = [];
    try { pageLabels = await fb.fetchPageLabels(); } catch { /* token loi thi thoi */ }
    const savedSkip = store.getSkipLabelIds();
    const skipIds = new Set(
      (savedSkip || pageLabels.filter((l) => order.looksLikeOrderLabel(l.name)).map((l) => l.id)).map(String)
    );
    const nameOf = new Map(pageLabels.map((l) => [String(l.id), l.name]));

    let items = filtered.map((it) => {
      const { messages, ...rest } = it;
      const detected = order.detectOrder(messages);
      const customerPhone = order.findCustomerPhone(messages);
      const mark = marks[it.psid];

      // Gop nhan doc tu Facebook (neu doc duoc) voi nhan tool da gan
      const merged = new Map();
      (labelsByPsid[it.psid] || []).forEach((l) => merged.set(String(l.id), { id: String(l.id), name: l.name, source: 'fb' }));
      Object.entries(localLabels[it.psid] || {}).forEach(([id, v]) => {
        if (!merged.has(id)) merged.set(id, { id, name: nameOf.get(id) || v.name, source: 'tool' });
      });
      const labels = [...merged.values()];
      const skipHits = labels.filter((l) => skipIds.has(l.id));

      // Uu tien: danh dau tay > nhan cua Facebook > tu doan noi dung chat
      let ordered;
      let orderSource;
      if (mark) {
        ordered = mark.state === 'ordered';
        orderSource = 'manual';
      } else {
        ordered = detected.ordered;
        orderSource = detected.ordered ? 'auto' : null;
      }

      return {
        ...rest,
        // "Da gui" = da nhan cho nguoi nay SAU lan cuoi ho nhan. Khach nhan lai -> gui tiep duoc.
        alreadySent: sentAfterCustomer(sentLog[it.psid], it.lastCustomerTs),
        lastSentAt: sentLog[it.psid]?.at || null,
        canUseHumanAgentTag: it.hoursSinceLast <= 24 * 7,
        ordered,
        orderSource,
        orderScore: detected.score,
        orderReasons: detected.reasons,
        orderCancelled: detected.cancelled,
        orderMarkedAt: mark?.at || null,
        labels,
        skipLabels: skipHits.map((l) => l.name),
        // SDT do khach gui (khong tinh so shop gui) — thuong la da chot don
        customerPhone,
        // Page da nhan "#chotdon" cho khach nay (thoi diem), null neu chua
        chotDonAt: chotDon[it.psid]?.at || null,
      };
    });

    const labelSkippedCount = items.filter((it) => it.skipLabels.length).length;
    if (labelFilter === 'hide') items = items.filter((it) => !it.skipLabels.length);

    const orderedCount = items.filter((it) => it.ordered).length;
    if (orderFilter === 'hide') items = items.filter((it) => !it.ordered);
    else if (orderFilter === 'only') items = items.filter((it) => it.ordered);

    res.json({
      total: normalized.length,
      matched: items.length,
      orderedCount,
      orderFilter,
      labelSkippedCount,
      labelFilter,
      labelAccess: labelInfo,
      items,
    });
  } catch (e) {
    res.status(400).json(errPayload(e));
  }
});

/** Comment nay da duoc tool lam viec "kind" chua ('công khai' | 'tin nhắn riêng') */
function didKind(entry, kind) {
  return Boolean(entry && (entry.did || []).includes(kind));
}

/** Lan gui gan nhat co sau tin cuoi cua khach khong (khong biet tin cua khach -> coi nhu co) */
function sentAfterCustomer(entry, lastCustomerTs) {
  if (!entry?.at) return false;
  if (!lastCustomerTs) return true;
  return new Date(entry.at).getTime() > Number(lastCustomerTs);
}

/* ---------- Templates ---------- */
app.get('/api/templates', (req, res) => res.json(store.getTemplates()));

app.post('/api/templates', (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  res.json(store.saveTemplates(list));
});

/* ---------- Gui hang loat (stream NDJSON) ---------- */
app.post('/api/send-bulk', async (req, res) => {
  const {
    targets = [],
    text = '',
    delayMs = 1200,
    skipAlreadySent = true,
    skipOrdered = true,
    skipHasPhone = false,
    skipChotDon = true,
    tagMode = 'auto',
    fallbackTag = null,
  } = req.body || {};

  if (pageMismatch(req)) return res.status(409).json({ error: 'Tool vừa chuyển sang Page khác — tải lại trang rồi chọn khách lại.' });
  if (!text.trim()) return res.status(400).json({ error: 'Chua nhap noi dung tin nhan' });
  if (!Array.isArray(targets) || !targets.length) {
    return res.status(400).json({ error: 'Chua chon hoi thoai nao' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders?.();

  // Dang gui thi khong cho doi Page (token doi giua chung -> gui nham Page)
  activeJobs++;
  try {

  const write = (obj) => res.write(JSON.stringify(obj) + '\n');
  const sentLog = store.getSentLog();
  const marks = store.getOrderMarks();
  const skipIds = new Set((store.getSkipLabelIds() || []).map(String));
  const localLabels = store.getUserLabels();
  // Quet lai "#chotdon" ngay truoc khi gui: phong khi vua chot don ma danh sach tren may chua tai lai
  let chotDon = store.getChotDon();
  try {
    const { pageId: pid, conversations } = await fb.fetchConversations({ maxPages: 5 });
    chotDon = store.addChotDon(
      conversations
        .map((c) => fb.normalizeConversation(c, pid))
        .map((c) => ({ psid: c.psid, at: order.findChotDon(c.messages), name: c.name, pageId: pid }))
        .filter((c) => c.at)
    );
  } catch { /* loi mang thi dung ban da nho */ }
  const delay = Math.max(0, Number(delayMs) || 0);

  let ok = 0;
  let fail = 0;
  let skipped = 0;
  const sentPsids = [];

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const base = { index: i, total: targets.length, psid: t.psid, name: t.name };

    // Chan cuoi cung: khach da dat hang thi tuyet doi khong nhan lam phien
    if (skipOrdered && (marks[t.psid]?.state === 'ordered' || (t.ordered && marks[t.psid]?.state !== 'normal'))) {
      skipped++;
      write({ ...base, status: 'skipped', reason: 'Khách đã đặt hàng — bỏ qua để không làm phiền' });
      continue;
    }

    // Chan theo nhan bo qua (nhan do tool gan, hoac do giao dien gui len)
    const hit = Object.entries(localLabels[t.psid] || {}).find(([id]) => skipIds.has(id));
    if (hit || (Array.isArray(t.skipLabels) && t.skipLabels.length)) {
      skipped++;
      write({ ...base, status: 'skipped', reason: `Mang nhãn bỏ qua: ${hit ? hit[1].name : t.skipLabels.join(', ')}` });
      continue;
    }

    // Page da nhan "#chotdon" = chac chan da chot -> khong nhan
    if (skipChotDon && (chotDon[t.psid] || t.chotDonAt)) {
      skipped++;
      write({ ...base, status: 'skipped', reason: 'Đã #chotdon — khách đã chốt đơn' });
      continue;
    }

    if (skipHasPhone && t.customerPhone) {
      skipped++;
      write({ ...base, status: 'skipped', reason: `Khách đã gửi SĐT ${t.customerPhone} — chắc đã chốt đơn` });
      continue;
    }

    if (skipAlreadySent && sentAfterCustomer(sentLog[t.psid], t.lastCustomerTs)) {
      skipped++;
      write({ ...base, status: 'skipped', reason: 'Đã nhắn người này sau lần cuối họ nhắn' });
      continue;
    }

    // Xao rieng cho tung nguoi, roi dien ten
    const body = Spin.spin(text)
      .replaceAll('{{name}}', t.name || 'bạn')
      .replaceAll('{{first_name}}', (t.name || 'bạn').split(' ').slice(-1)[0]);

    try {
      const r = await fb.sendMessage({
        psid: t.psid,
        text: body,
        hoursSinceLast: t.hoursSinceLast,
        tagMode,
        fallbackTag,
      });
      ok++;
      sentPsids.push(t.psid);
      store.markSent(t.psid, { name: t.name, messageId: r.message_id, tag: r.usedTag });
      write({ ...base, status: 'ok', text: body, messageId: r.message_id, tag: r.usedTag, fellBackFrom: r.fellBackFrom });
    } catch (e) {
      fail++;
      write({ ...base, status: 'error', ...errPayload(e) });
    }

    if (delay && i < targets.length - 1) await new Promise((r) => setTimeout(r, delay));
  }

  // Gan nhan "da nhan" trong Page Inbox cho nhung nguoi vua gui thanh cong,
  // de mo Messenger ra la thay ngay ai da bi nhan.
  let labelled = null;
  const syncCfg = store.getLabelSync();
  if (syncCfg.tagSent && req.body?.tagSent !== false && sentPsids.length) {
    write({ status: 'labelling', total: sentPsids.length, label: syncCfg.sentLabelName });
    try {
      const labelId = await labelIdFor(syncCfg.sentLabelName);
      const r = await fb.attachLabelBatch(labelId, sentPsids);
      store.addUserLabels(sentPsids, { id: labelId, name: syncCfg.sentLabelName });
      const { okPsids, ...counts } = r;
      labelled = { label: syncCfg.sentLabelName, ...counts };
    } catch (e) {
      labelled = { label: syncCfg.sentLabelName, ok: 0, fail: sentPsids.length, errors: [e.message] };
    }
  }

  write({ status: 'done', ok, fail, skipped, total: targets.length, labelled });
  res.end();
  } finally {
    activeJobs--;
  }
});

/* ---------- Danh dau / bo danh dau khach da dat hang ---------- */
app.get('/api/order-marks', (req, res) => res.json(store.getOrderMarks()));

app.post('/api/order-mark', async (req, res) => {
  const { psid, state = 'ordered', name = '', note = '' } = req.body || {};
  if (!psid) return res.status(400).json({ error: 'Thieu psid' });

  if (!['ordered', 'normal', 'clear'].includes(state)) {
    return res.status(400).json({ error: 'state phai la ordered | normal | clear' });
  }

  const mark = state === 'clear' ? (store.clearOrderMark(psid), null) : store.setOrderMark(psid, state, { name, note });

  // Gan / go nhan that trong Page Inbox cho khop voi danh dau trong tool.
  // Loi o buoc nay khong duoc lam hong viec danh dau.
  let sync = null;
  const cfgSync = store.getLabelSync();
  if (cfgSync.syncOrderMark && state !== 'clear') {
    try {
      const labelId = await labelIdFor(cfgSync.orderLabelName);
      if (state === 'ordered') store.addUserLabels(psid, { id: labelId, name: cfgSync.orderLabelName });
      else store.removeUserLabel(psid, labelId);
      if (state === 'ordered') await fb.attachLabel(labelId, psid);
      else await fb.detachLabel(labelId, psid);
      sync = { ok: true, label: cfgSync.orderLabelName, action: state === 'ordered' ? 'gan' : 'go' };
    } catch (e) {
      sync = { ok: false, label: cfgSync.orderLabelName, error: e.message };
    }
  }

  res.json({ ok: true, psid, state, mark, sync });
});

app.post('/api/reset-order-marks', (req, res) => {
  store.resetOrderMarks();
  res.json({ ok: true });
});

/* ---------- Xoa lich su da gui ---------- */
app.post('/api/reset-sent-log', (req, res) => {
  store.resetSentLog();
  res.json({ ok: true });
});

/* =======================================================================
   PHAN COMMENT
   ======================================================================= */

/* ---------- Danh sach bai viet ---------- */
app.get('/api/posts', async (req, res) => {
  try {
    const posts = await cmt.fetchPosts({ limit: Math.min(Number(req.query.limit ?? 25), 50) });
    res.json({ items: posts });
  } catch (e) {
    res.status(400).json(errPayload(e));
  }
});

/* ---------- Comment cua 1 bai ---------- */
app.get('/api/comments', async (req, res) => {
  try {
    const postId = req.query.postId;
    if (!postId) return res.status(400).json({ error: 'Thieu postId' });

    const onlyUnreplied = req.query.onlyUnreplied !== 'false';
    const maxHours = req.query.maxHours ? Number(req.query.maxHours) : null;

    const { pageId } = fb.cfg();
    const raw = await cmt.fetchComments(postId, { maxPages: 5 });
    const log = store.getCommentLog();

    let list = raw
      .map((c) => cmt.normalizeComment(c, pageId))
      .filter((c) => !c.byPage) // bo comment cua chinh page
      .map((c) => ({
        ...c,
        alreadyReplied: Boolean(log[c.commentId]),
        repliedAt: log[c.commentId]?.at || null,
        publicDone: didKind(log[c.commentId], 'công khai'),
        privateDone: didKind(log[c.commentId], 'tin nhắn riêng'),
        canPrivateReply: c.hoursSince != null && c.hoursSince <= 24 * 7,
      }));

    // "Chua tra loi" = con viec chua lam: chua rep cong khai, hoac chua nhan rieng (khi con nhan duoc)
    if (onlyUnreplied) {
      list = list.filter((c) => !(c.pageReplied || c.publicDone) || (c.canPrivateReply && !c.privateDone));
    }
    if (maxHours) list = list.filter((c) => c.hoursSince != null && c.hoursSince <= maxHours);

    list.sort((a, b) => b.hoursSince - a.hoursSince); // cu nhat truoc

    res.json({ total: raw.length, matched: list.length, items: list });
  } catch (e) {
    res.status(400).json(errPayload(e));
  }
});

/* ---------- Mau cau tra loi comment ---------- */
app.get('/api/comment-templates', (req, res) => res.json(store.getCommentTemplates()));

app.post('/api/comment-templates', (req, res) => {
  res.json(store.saveCommentTemplates(Array.isArray(req.body) ? req.body : []));
});

/* ---------- Tra loi comment hang loat (stream NDJSON) ---------- */
app.post('/api/reply-comments', async (req, res) => {
  const {
    targets = [],
    text = '',
    delayMs = 1500,
    skipAlreadyReplied = true,
    publicReply = true,
    sendPrivate = false,
    privateText = '',
  } = req.body || {};

  if (pageMismatch(req)) return res.status(409).json({ error: 'Tool vừa chuyển sang Page khác — tải lại trang rồi chọn lại.' });
  if (publicReply && !text.trim()) {
    return res.status(400).json({ error: 'Chua nhap noi dung tra loi' });
  }
  if (sendPrivate && !privateText.trim() && !text.trim()) {
    return res.status(400).json({ error: 'Chua nhap noi dung tin nhan rieng' });
  }
  if (!publicReply && !sendPrivate) {
    return res.status(400).json({ error: 'Chon it nhat mot kieu tra loi' });
  }
  if (!Array.isArray(targets) || !targets.length) {
    return res.status(400).json({ error: 'Chua chon comment nao' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders?.();

  // Dang gui thi khong cho doi Page (token doi giua chung -> gui nham Page)
  activeJobs++;
  try {

  const write = (obj) => res.write(JSON.stringify(obj) + '\n');
  const log = store.getCommentLog();
  const delay = Math.max(0, Number(delayMs) || 0);

  let ok = 0;
  let fail = 0;
  let skipped = 0;

  const fill = (tpl, name) =>
    Spin.spin(tpl)
      .replaceAll('{{name}}', name || 'anh/chị')
      .replaceAll('{{first_name}}', (name || 'anh/chị').split(' ').slice(-1)[0]);

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const base = { index: i, total: targets.length, commentId: t.commentId, name: t.name };

    // Hai viec lam doc lap: tra loi cong khai va nhan rieng, moi viec co ket qua rieng.
    // results: [{ kind: 'public'|'private', status: 'ok'|'skipped'|'error', note }]
    const entry = log[t.commentId];
    const results = [];
    const done = [];

    if (publicReply) {
      if (skipAlreadyReplied && didKind(entry, 'công khai')) {
        results.push({ kind: 'public', status: 'skipped', note: 'đã rep rồi' });
      } else {
        try {
          const r = await cmt.replyToComment(t.commentId, fill(text, t.name));
          done.push('công khai');
          base.replyId = r.id;
          results.push({ kind: 'public', status: 'ok' });
        } catch (e) {
          results.push({ kind: 'public', status: 'error', note: e.message });
        }
      }
    }

    if (sendPrivate) {
      // Facebook chi cho nhan rieng 1 lan moi comment -> da nhan thi luon bo qua
      if (didKind(entry, 'tin nhắn riêng')) {
        results.push({ kind: 'private', status: 'skipped', note: 'đã nhắn rồi — Facebook chỉ cho 1 lần' });
      } else if (!t.canPrivateReply && t.canPrivateReply !== undefined) {
        results.push({ kind: 'private', status: 'skipped', note: 'comment quá 7 ngày' });
      } else {
        try {
          await cmt.privateReply(t.commentId, fill(privateText || text, t.name));
          done.push('tin nhắn riêng');
          results.push({ kind: 'private', status: 'ok' });
        } catch (e) {
          if (e.fbCode === 10900 || /already replied/i.test(e.message)) {
            // Da nhan rieng tu truoc (bang tay hoac tool khac) -> ghi nho, khong tinh la loi
            store.markCommentReplied(t.commentId, { name: t.name, did: ['tin nhắn riêng'] });
            results.push({ kind: 'private', status: 'skipped', note: 'đã nhắn rồi — Facebook chỉ cho 1 lần' });
          } else {
            results.push({ kind: 'private', status: 'error', note: e.message });
          }
        }
      }
    }

    if (done.length) store.markCommentReplied(t.commentId, { name: t.name, did: done });

    const anyOk = results.some((r) => r.status === 'ok');
    const anyErr = results.some((r) => r.status === 'error');
    const status = anyOk ? 'ok' : anyErr ? 'error' : 'skipped';
    if (status === 'ok') ok++;
    else if (status === 'error') fail++;
    else skipped++;
    write({ ...base, status, results, did: done });

    // Khong goi Facebook thi khong can nghi
    if (delay && done.length && i < targets.length - 1) await new Promise((r) => setTimeout(r, delay));
  }

  write({ status: 'done', ok, fail, skipped, total: targets.length });
  res.end();
  } finally {
    activeJobs--;
  }
});

app.post('/api/reset-comment-log', (req, res) => {
  store.resetCommentLog();
  res.json({ ok: true });
});

/* =======================================================================
   CAP QUYEN — tu dong lay page token vinh vien
   ======================================================================= */

/* ---------- Xem token hien tai co quyen gi ---------- */
app.get('/api/token-info', async (req, res) => {
  try {
    const info = await auth.tokenInfo(process.env.FB_PAGE_TOKEN);
    let page = null;
    try { page = await fb.getPageInfo(); } catch { /* token loi thi thoi */ }
    res.json({ ...info, pageId: page?.id || process.env.FB_PAGE_ID, pageName: page?.name || null });
  } catch (e) {
    res.status(400).json(errPayload(e));
  }
});

/* ---------- Nhieu Page: liet ke / chuyen / bo ---------- */

/** Dung Page nay lam Page dang lam viec: ghi .env (ap dung ngay) + xoa cache cua Page cu */
function activatePage(pageId, pageToken) {
  auth.updateEnv('FB_PAGE_TOKEN', pageToken);
  if (String(pageId) !== String(process.env.FB_PAGE_ID)) auth.updateEnv('FB_PAGE_ID', pageId);
  labelIdCache.clear();
  labelProbe = { at: 0, result: null };
}

app.get('/api/pages', async (req, res) => {
  const active = String(process.env.FB_PAGE_ID || '');
  let pages = store.getPages();
  // Page trong .env nhung chua co trong danh sach (cau hinh tu truoc) -> them vao
  if (active && process.env.FB_PAGE_TOKEN && !pages.some((p) => p.id === active)) {
    let name = '';
    try { name = (await fb.getPageInfo()).name || ''; } catch { /* bo qua */ }
    pages = store.savePages([{ id: active, name, token: process.env.FB_PAGE_TOKEN }]);
  }
  res.json(pages.map((p) => ({ id: p.id, name: p.name || 'Page ' + p.id, active: p.id === active })));
});

/** So luot gui (tin nhan / comment) dang chay */
let activeJobs = 0;
app.get('/api/jobs', (req, res) => res.json({ active: activeJobs }));

app.post('/api/pages/switch', (req, res) => {
  if (activeJobs > 0) {
    return res.status(409).json({ error: 'Đang có lượt gửi chạy dở — đợi gửi xong (hoặc dừng) rồi mới đổi Page được.' });
  }
  const id = String(req.body?.id || '');
  const p = store.getPages().find((x) => x.id === id);
  if (!p) return res.status(404).json({ error: 'Không thấy Page này trong danh sách đã kết nối' });
  activatePage(p.id, p.token);
  res.json({ ok: true, id: p.id, name: p.name });
});

app.post('/api/pages/remove', (req, res) => {
  const id = String(req.body?.id || '');
  if (id === String(process.env.FB_PAGE_ID)) {
    return res.status(400).json({ error: 'Đang dùng Page này — chuyển sang Page khác trước rồi mới bỏ được' });
  }
  store.removePage(id);
  res.json({ ok: true });
});

/** Chan gui nham Page: giao dien dang mo Page A nhung tool vua chuyen sang Page B */
function pageMismatch(req) {
  const want = req.body?.pageId;
  return want && String(want) !== String(process.env.FB_PAGE_ID);
}

/* ---------- Buoc 1: day nguoi dung sang man hinh dong y cua Facebook ---------- */
// ?choose=1 -> dang nhap xong luon hien danh sach Page de chon (doi Page khac)
let forceChoosePage = false;

app.get('/auth/login', (req, res) => {
  try {
    forceChoosePage = req.query.choose === '1';
    res.redirect(auth.loginUrl(req));
  } catch (e) {
    res.status(400).send(page('Lỗi', `<p class="err">${e.message}</p>`));
  }
});

/** Page token cho tung Page vua dang nhap, giu tam 10 phut de nguoi dung chon */
let pendingPages = { at: 0, list: [] };

const escHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Luu token cua Page da chon vao .env roi bao ket qua */
async function finishWithPage(res, { pageId, pageName, pageToken }) {
  activatePage(pageId, pageToken);

  const info = await auth.tokenInfo(pageToken);
  const rows = info.scopes.map((s) => `<li>${s}</li>`).join('');
  const missing = info.missingForComments.length
    ? `<p class="err">Vẫn thiếu: ${info.missingForComments.join(', ')} — có thể bạn đã bỏ tick khi cấp quyền.
       <a href="/auth/login">Cấp lại</a></p>`
    : `<p class="ok">Đủ quyền cho cả tool tin nhắn và tool comment.</p>`;
  const expiry = info.expiresAt === 0 ? 'không bao giờ hết hạn' : `hết hạn lúc ${new Date(info.expiresAt * 1000).toLocaleString('vi-VN')}`;

  res.send(
    page(
      'Đã kết nối xong!',
      `<p class="ok">Đã lưu token của Page <b>${escHtml(pageName)}</b> (${escHtml(pageId)}) vào file .env — ${expiry}
         (bản cũ được sao lưu ở <code>.env.bak</code>).</p>
       ${missing}
       <p>Token có ${info.scopes.length} quyền:</p>
       <ul>${rows}</ul>
       <p><a class="cta" href="/">Dùng tool tin nhắn</a> <a class="cta" href="/comments.html">Dùng tool comment</a>
          <a href="/auth/login?choose=1">Đổi sang Page khác</a></p>`
    )
  );
}

/* ---------- Buoc 3 (neu nhieu Page): chon Page ---------- */
app.get('/auth/pick', async (req, res) => {
  const fresh = Date.now() - pendingPages.at < 10 * 60 * 1000;
  const p = fresh && pendingPages.list.find((x) => String(x.pageId) === String(req.query.id));
  if (!p) {
    return res.status(400).send(page('Hết hạn', `<p class="err">Danh sách Page đã hết hạn. <a href="/auth/login?choose=1">Đăng nhập lại</a></p>`));
  }
  pendingPages = { at: 0, list: [] };
  try {
    await finishWithPage(res, p);
  } catch (e) {
    res.status(400).send(page('Lỗi khi lưu token', `<p class="err">${escHtml(e.message)}</p>`));
  }
});

/* ---------- Buoc 2: Facebook goi ve, tu dong doi ra page token vinh vien ---------- */
app.get('/auth/callback', async (req, res) => {
  if (req.query.error) {
    return res.send(
      page(
        'Bạn đã từ chối cấp quyền',
        `<p class="err">${escHtml(req.query.error_description || req.query.error)}</p>
         <p><a href="/auth/login">Thử lại</a> · <a href="/">Về trang chính</a></p>`
      )
    );
  }

  const code = req.query.code;
  if (!code) return res.status(400).send(page('Thiếu mã xác thực', '<p class="err">Không nhận được code từ Facebook.</p>'));

  try {
    const shortUser = await auth.codeToUserToken(code, req);
    const longUser = await auth.toLongLived(shortUser);
    const pages = await auth.listPages(longUser);
    store.savePages(pages.map((p) => ({ id: p.pageId, name: p.pageName, token: p.pageToken })));

    if (!pages.length) {
      return res.send(
        page('Không thấy Page nào', `<p class="err">Tài khoản này chưa cấp quyền cho Page nào.
          Lúc đăng nhập nhớ tick chọn Page. <a href="/auth/login">Thử lại</a></p>`)
      );
    }

    const current = pages.find((p) => String(p.pageId) === String(process.env.FB_PAGE_ID));
    const choose = forceChoosePage;
    forceChoosePage = false;
    if (!choose && current) return finishWithPage(res, current);
    if (!choose && pages.length === 1) return finishWithPage(res, pages[0]);

    // Nhieu Page -> cho nguoi dung chon
    pendingPages = { at: Date.now(), list: pages };
    const items = pages
      .map((p) => `<li><a class="cta" href="/auth/pick?id=${encodeURIComponent(p.pageId)}">${escHtml(p.pageName)}</a>
                    <span class="tip">${escHtml(p.pageId)}</span></li>`)
      .join('');
    return res.send(page('Chọn Page muốn dùng', `<p>Tài khoản này quản lý ${pages.length} Page. Bấm vào Page muốn dùng với tool:</p><ul>${items}</ul>`));
  } catch (e) {
    res.status(400).send(
      page(
        'Lỗi khi lấy token',
        `<p class="err">${e.message}</p>
         <p>Nếu lỗi nhắc tới <b>redirect URI</b>: vào App → Đăng nhập bằng Facebook → Cài đặt,
            thêm <code>${auth.redirectUri(req)}</code> vào ô "Valid OAuth Redirect URIs" rồi
            <a href="/auth/login">thử lại</a>.</p>`
      )
    );
  }
});

/* ---------- Cach 2: dan user token tu Graph API Explorer, tool tu doi ra token vinh vien ---------- */
app.post('/api/exchange-token', async (req, res) => {
  const raw = String(req.body?.token || '').trim();
  if (!raw) return res.status(400).json({ error: 'Chưa dán token' });

  // Cho phep dan nguyen ca URL co #access_token=... hoac chi mot minh token
  const token = raw.includes('access_token=')
    ? decodeURIComponent(raw.split('access_token=')[1].split(/[&#]/)[0])
    : raw;

  try {
    // Neu la user token ngan han -> doi sang dai han. Neu doi that bai thi dung nguyen ban.
    let longUser = token;
    try {
      longUser = await auth.toLongLived(token);
    } catch { /* co the da la token dai han roi */ }

    const { pageId, pageName, pageToken } = await auth.getPageToken(longUser, process.env.FB_PAGE_ID);

    store.savePages([{ id: pageId, name: pageName, token: pageToken }]);
    activatePage(pageId, pageToken);

    const info = await auth.tokenInfo(pageToken);
    res.json({ ok: true, pageId, pageName, ...info });
  } catch (e) {
    res.status(400).json(errPayload(e));
  }
});

/** Trang HTML don gian cho luong cap quyen */
function page(title, body) {
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><link rel="stylesheet" href="/style.css"></head>
<body class="simple"><header><h1>${title}</h1></header><section>${body}</section></body></html>`;
}

app.listen(PORT, () => {
  console.log(`\n  FB Auto Reply Tool -> http://localhost:${PORT}\n`);
});
