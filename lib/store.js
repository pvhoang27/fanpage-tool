'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json');
const SENT_LOG_FILE = path.join(DATA_DIR, 'sent-log.json');
const CMT_TEMPLATES_FILE = path.join(DATA_DIR, 'comment-templates.json');
const CMT_LOG_FILE = path.join(DATA_DIR, 'replied-comments.json');
const ORDER_FILE = path.join(DATA_DIR, 'orders.json');
const ORDER_LABELS_FILE = path.join(DATA_DIR, 'order-labels.json');
const LABEL_SYNC_FILE = path.join(DATA_DIR, 'label-sync.json');
const USER_LABELS_FILE = path.join(DATA_DIR, 'user-labels.json');
const SKIP_LABELS_FILE = path.join(DATA_DIR, 'skip-labels.json');
const PAGES_FILE = path.join(DATA_DIR, 'pages.json');

const DEFAULT_LABEL_SYNC = {
  // Bam "Danh dau da dat hang" trong tool -> gan luon nhan that trong Page Inbox
  syncOrderMark: true,
  orderLabelName: 'Đã đặt hàng',
  // Gui tin hang loat xong -> gan nhan cho nhung nguoi vua nhan tin
  tagSent: true,
  sentLabelName: 'Tool đã nhắn',
};

const DEFAULT_CMT_TEMPLATES = [
  {
    id: 'c1',
    title: 'Mời kiểm tra tin nhắn',
    text: 'Dạ anh/chị kiểm tra tin nhắn giúp em với ạ, em nhắn cho mình rồi đó ạ!',
  },
  {
    id: 'c2',
    title: 'Đã inbox báo giá',
    text: 'Dạ em đã inbox báo giá cho anh/chị rồi ạ, anh/chị check tin nhắn giúp em nhé!',
  },
];

const DEFAULT_TEMPLATES = [
  {
    id: 't1',
    title: 'Xin loi tra loi cham',
    text: 'Chao {{name}}, ben minh xin loi vi phan hoi cham a. Ban con can ho tro gi khong a? Minh san sang tu van ngay ạ!',
  },
  {
    id: 't2',
    title: 'Hoi lai nhu cau',
    text: 'Chao {{name}}, minh thay tin nhan cua ban chua duoc phan hoi. Ban dang quan tam san pham nao a? Minh gui bang gia ngay nhe!',
  },
  {
    id: 't3',
    title: 'Uu dai',
    text: 'Chao {{name}}, hien ben minh dang co uu dai cho khach cu. Ban nhan tin lai de minh giu suat cho ban nhe!',
  },
];

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function getTemplates() {
  ensureDir();
  if (!fs.existsSync(TEMPLATES_FILE)) writeJson(TEMPLATES_FILE, DEFAULT_TEMPLATES);
  return readJson(TEMPLATES_FILE, DEFAULT_TEMPLATES);
}

function saveTemplates(list) {
  writeJson(TEMPLATES_FILE, list);
  return list;
}

function getSentLog() {
  return readJson(SENT_LOG_FILE, {});
}

function markSent(psid, info) {
  const log = getSentLog();
  log[psid] = { at: new Date().toISOString(), ...info };
  writeJson(SENT_LOG_FILE, log);
  return log[psid];
}

function resetSentLog() {
  writeJson(SENT_LOG_FILE, {});
}

/* ---------- phan comment ---------- */

function getCommentTemplates() {
  ensureDir();
  if (!fs.existsSync(CMT_TEMPLATES_FILE)) writeJson(CMT_TEMPLATES_FILE, DEFAULT_CMT_TEMPLATES);
  return readJson(CMT_TEMPLATES_FILE, DEFAULT_CMT_TEMPLATES);
}

function saveCommentTemplates(list) {
  writeJson(CMT_TEMPLATES_FILE, list);
  return list;
}

function getCommentLog() {
  return readJson(CMT_LOG_FILE, {});
}

function markCommentReplied(commentId, info) {
  const log = getCommentLog();
  log[commentId] = { at: new Date().toISOString(), ...info };
  writeJson(CMT_LOG_FILE, log);
  return log[commentId];
}

function resetCommentLog() {
  writeJson(CMT_LOG_FILE, {});
}

/* ---------- danh dau khach da dat hang ---------- */
/**
 * File data/orders.json:
 *   { "<psid>": { state: 'ordered' | 'normal', at, source: 'manual'|'auto', note } }
 * state 'normal' = nguoi dung da bo danh dau -> may KHONG duoc tu dong nhan lai.
 */

function getOrderMarks() {
  return readJson(ORDER_FILE, {});
}

function setOrderMark(psid, state, info = {}) {
  const log = getOrderMarks();
  if (!psid) return null;
  log[psid] = { state, at: new Date().toISOString(), source: 'manual', ...info };
  writeJson(ORDER_FILE, log);
  return log[psid];
}

function clearOrderMark(psid) {
  const log = getOrderMarks();
  delete log[psid];
  writeJson(ORDER_FILE, log);
}

function resetOrderMarks() {
  writeJson(ORDER_FILE, {});
}

/**
 * Nhung nhan cua Page duoc coi la "khach da dat hang".
 * Luu mang id nhan; null = chua chon bao gio -> dung goi y theo ten.
 */
function getOrderLabelIds() {
  const v = readJson(ORDER_LABELS_FILE, null);
  return Array.isArray(v) ? v : null;
}

function saveOrderLabelIds(ids) {
  const list = Array.isArray(ids) ? ids.map(String) : [];
  writeJson(ORDER_LABELS_FILE, list);
  return list;
}

/* ---------- nhan cua tung khach (ban sao trong tool) ----------
 * Facebook khong cho doc nhan cua tung khach, nen moi lan tool gan / go nhan
 * thi ghi lai o day de con biet ai dang mang nhan nao.
 * File data/user-labels.json:
 *   { "<psid>": { "<labelId>": { name, at } } }
 */

function getUserLabels() {
  return readJson(USER_LABELS_FILE, {});
}

function addUserLabels(psids, label) {
  if (!label?.id) return;
  const all = getUserLabels();
  const at = new Date().toISOString();
  (Array.isArray(psids) ? psids : [psids]).forEach((p) => {
    if (!p) return;
    all[p] = all[p] || {};
    all[p][String(label.id)] = { name: label.name, at };
  });
  writeJson(USER_LABELS_FILE, all);
}

function removeUserLabel(psid, labelId) {
  const all = getUserLabels();
  if (!all[psid]) return;
  delete all[psid][String(labelId)];
  if (!Object.keys(all[psid]).length) delete all[psid];
  writeJson(USER_LABELS_FILE, all);
}

/**
 * Nhan dung de BO QUA khach khi loc / gui.
 * Luu mang id nhan; null = chua chon bao gio -> dung goi y theo ten.
 */
function getSkipLabelIds() {
  const v = readJson(SKIP_LABELS_FILE, null);
  if (Array.isArray(v)) return v;
  return getOrderLabelIds(); // lan dau: lay lua chon cu "nhan = da dat hang"
}

function saveSkipLabelIds(ids) {
  const list = Array.isArray(ids) ? [...new Set(ids.map(String))] : [];
  writeJson(SKIP_LABELS_FILE, list);
  return list;
}

/* ---------- cac Page da ket noi ----------
 * Moi lan dang nhap Facebook, tool luu token cua TAT CA Page ma nick do quan ly
 * de chuyen qua lai khong can dang nhap lai.
 * File data/pages.json (CO TOKEN — khong chia se file nay):
 *   [{ id, name, token, savedAt }]
 */

function getPages() {
  const v = readJson(PAGES_FILE, []);
  return Array.isArray(v) ? v : [];
}

/** Them / cap nhat theo id, giu nguyen cac Page khac */
function savePages(list) {
  const byId = new Map(getPages().map((p) => [String(p.id), p]));
  const at = new Date().toISOString();
  (list || []).forEach((p) => {
    if (!p?.id || !p?.token) return;
    byId.set(String(p.id), { id: String(p.id), name: p.name || '', token: p.token, savedAt: at });
  });
  const all = [...byId.values()];
  writeJson(PAGES_FILE, all);
  return all;
}

function removePage(id) {
  const all = getPages().filter((p) => String(p.id) !== String(id));
  writeJson(PAGES_FILE, all);
  return all;
}

/* ---------- dong bo nhan len Page Inbox ---------- */

function getLabelSync() {
  return { ...DEFAULT_LABEL_SYNC, ...readJson(LABEL_SYNC_FILE, {}) };
}

function saveLabelSync(patch) {
  const next = { ...getLabelSync(), ...(patch || {}) };
  next.syncOrderMark = Boolean(next.syncOrderMark);
  next.tagSent = Boolean(next.tagSent);
  next.orderLabelName = String(next.orderLabelName || '').trim() || DEFAULT_LABEL_SYNC.orderLabelName;
  next.sentLabelName = String(next.sentLabelName || '').trim() || DEFAULT_LABEL_SYNC.sentLabelName;
  writeJson(LABEL_SYNC_FILE, next);
  return next;
}

module.exports = {
  getPages,
  savePages,
  removePage,
  getUserLabels,
  addUserLabels,
  removeUserLabel,
  getSkipLabelIds,
  saveSkipLabelIds,
  getLabelSync,
  saveLabelSync,
  getOrderLabelIds,
  saveOrderLabelIds,
  getOrderMarks,
  setOrderMark,
  clearOrderMark,
  resetOrderMarks,
  getTemplates,
  saveTemplates,
  getSentLog,
  markSent,
  resetSentLog,
  getCommentTemplates,
  saveCommentTemplates,
  getCommentLog,
  markCommentReplied,
  resetCommentLog,
  DEFAULT_TEMPLATES,
};
