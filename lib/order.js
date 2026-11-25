'use strict';

/**
 * Do xem mot cuoc hoi thoai da "chot don / dang giao hang" chua,
 * de KHONG nhan tin lam phien nhung khach dang cho hang ve.
 *
 * Cach lam: cham diem cac dau hieu trong vai chuc tin nhan gan nhat.
 * Diem >= THRESHOLD thi coi nhu da dat hang.
 */

const THRESHOLD = 3;

/** Bo dau tieng Viet + ha chu thuong, de khop ca "chốt đơn" lan "chot don" */
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ');
}

/**
 * Dau hieu tu PAGE (minh nhan cho khach) — thuong chac chan nhat,
 * vi chi khi da chot don shop moi nhac toi ma van don / shipper.
 */
const PAGE_SIGNALS = [
  // chac chan da co don
  { w: 3, k: ['len don', 'da len don', 'chot don', 'da chot don', 'don cua minh', 'don hang cua'] },
  { w: 3, k: ['ma van don', 'van don', 'ma don hang', 'tracking'] },
  { w: 3, k: ['da gui hang', 'gui hang cho', 'da giao cho ben van chuyen', 'da dong goi', 'da xuat kho'] },
  { w: 3, k: ['dang giao', 'shipper', 'ben van chuyen', 'don vi van chuyen', 'buu ta'] },
  { w: 3, k: ['ghtk', 'giao hang tiet kiem', 'ghn', 'giao hang nhanh', 'j&t', 'jt express', 'viettel post', 'vnpost', 'spx', 'best express', 'ninja van'] },
  // kha chac
  { w: 2, k: ['du kien giao', 'du kien nhan hang', 'hang se toi', 'nhan hang xong'] },
  { w: 2, k: ['da nhan duoc coc', 'da nhan chuyen khoan', 'da nhan tien'] },
  { w: 2, k: ['cam on ban da dat hang', 'cam on anh da dat hang', 'cam on chi da dat hang', 'shop da nhan don'] },
];

/** Dau hieu tu KHACH */
const CUSTOMER_SIGNALS = [
  { w: 3, k: ['da chuyen khoan', 'da ck', 'ck roi', 'chuyen khoan roi', 'da thanh toan', 'thanh toan roi', 'da coc', 'coc roi'] },
  { w: 3, k: ['chot don', 'minh chot', 'em chot', 'chot nhe', 'chot don nhe'] },
  { w: 2, k: ['dat hang', 'minh dat', 'em dat', 'dat 1', 'dat 2', 'minh lay', 'em lay', 'lay 1', 'lay 2', 'cho minh 1', 'cho em 1', 'minh mua', 'em mua'] },
  { w: 2, k: ['dia chi cua minh', 'dia chi cua em', 'dia chi nhan hang', 'giao ve', 'giao toi', 'ship ve', 'ship toi'] },
  // khach hoi ve don da co san
  { w: 3, k: ['don cua minh dau', 'don cua em dau', 'khi nao hang toi', 'bao gio hang toi', 'hang toi chua', 'hang den chua', 'don hang toi dau roi', 'kiem tra don giup'] },
];

/** Dia chi + so dien thoai do khach gui — cong lai la du diem */
const ADDRESS_WORDS = [
  'so nha', 'duong', 'phuong ', 'quan ', 'huyen ', 'thi tran', 'thi xa', ' xa ', 'thon ', 'ap ', 'to ', 'ngo ', 'hem ',
  'tinh ', 'tp ', 'tp.', 'thanh pho', 'chung cu', 'toa nha', 'block ', 'can ho',
];

/** Da huy don thi lai duoc phep nhan tin binh thuong */
const CANCEL_WORDS = [
  'huy don', 'da huy', 'khong lay nua', 'ko lay nua', 'khong mua nua', 'ko mua nua',
  'huy giup minh', 'huy giup em', 'boom hang', 'hoan hang', 'tra hang', 'khong dat nua',
];

const PHONE_RE = /(?:^|[^\d])(0|\+84|84)(3|5|7|8|9)\d{8}(?!\d)/;

function hasAny(text, list) {
  return list.filter((k) => text.includes(k));
}

/**
 * @param {Array} messages - [{ text, fromPage, time }] moi nhat truoc
 * @returns {{ordered:boolean, score:number, reasons:string[], cancelled:boolean}}
 */
function detectOrder(messages = []) {
  let score = 0;
  const reasons = [];

  // Neu tin huy don moi hon dau hieu dat hang -> coi nhu khong con don
  let newestOrderIdx = -1;
  let newestCancelIdx = -1;

  messages.forEach((m, idx) => {
    const text = norm(m.text);
    if (!text) return;

    const cancelHit = hasAny(text, CANCEL_WORDS);
    if (cancelHit.length && newestCancelIdx === -1) newestCancelIdx = idx;

    const groups = m.fromPage ? PAGE_SIGNALS : CUSTOMER_SIGNALS;
    let msgScore = 0;
    const msgHits = [];

    for (const g of groups) {
      const hit = hasAny(text, g.k);
      if (hit.length) {
        msgScore = Math.max(msgScore, g.w); // moi tin chi tinh dau hieu manh nhat
        msgHits.push(hit[0]);
      }
    }

    // Khach gui so dien thoai / dia chi = dang dat hang
    if (!m.fromPage) {
      if (PHONE_RE.test(text)) {
        msgScore = Math.max(msgScore, 2);
        msgHits.push('số điện thoại');
      }
      const addr = hasAny(text, ADDRESS_WORDS);
      if (addr.length >= 2 || (addr.length === 1 && PHONE_RE.test(text))) {
        msgScore = Math.max(msgScore, 2);
        msgHits.push('địa chỉ nhận hàng');
      }
    }

    if (msgScore > 0) {
      score += msgScore;
      if (newestOrderIdx === -1) newestOrderIdx = idx;
      const who = m.fromPage ? 'shop' : 'khách';
      msgHits.slice(0, 2).forEach((h) => reasons.push(`${who}: "${h}"`));
    }
  });

  // messages[0] la tin moi nhat -> index nho hon = moi hon
  const cancelled =
    newestCancelIdx !== -1 && (newestOrderIdx === -1 || newestCancelIdx < newestOrderIdx);

  return {
    ordered: !cancelled && score >= THRESHOLD,
    score,
    cancelled,
    reasons: [...new Set(reasons)].slice(0, 4),
  };
}

/**
 * So dien thoai VN: di dong 0[35789]xxxxxxxx, ban 02xxxxxxxxx, chap nhan +84/84.
 * Cho phep cach so bang dau cach / cham / gach: "0912 345 678", "0912.345.678".
 */
const PHONE_FIND_RE = /(?:^|[^\d])((?:\+?84|0)(?:[35789]\d{8}|2\d{9}))(?!\d)/g;

function phonesIn(text) {
  const flat = String(text || '').replace(/(\d)[ .\-]+(?=\d)/g, '$1');
  const out = [];
  for (const m of flat.matchAll(PHONE_FIND_RE)) out.push(m[1].replace(/^\+?84/, '0'));
  return out;
}

/**
 * Tim SDT do KHACH gui (khong tinh so shop tu gui — thuong la so tu van).
 * Neu khach nhac lai dung so ma shop da gui thi cung bo qua.
 * @param {Array} messages - [{ text, fromPage }] moi nhat truoc
 * @returns {string|null} so dien thoai moi nhat khach gui
 */
function findCustomerPhone(messages = []) {
  const shopPhones = new Set();
  messages.filter((m) => m.fromPage).forEach((m) => phonesIn(m.text).forEach((p) => shopPhones.add(p)));
  for (const m of messages) {
    if (m.fromPage) continue;
    const hit = phonesIn(m.text).find((p) => !shopPhones.has(p));
    if (hit) return hit;
  }
  return null;
}

/**
 * Doan xem mot nhan cua Page Inbox co nghia la "khach da dat hang" khong,
 * dung lam goi y san khi nguoi dung chua tu chon.
 * VD: "Đã đặt hàng", "Chốt đơn", "Đang giao", "Đã ship".
 */
const ORDER_LABEL_HINTS = [
  'da dat hang', 'dat hang', 'chot don', 'da chot', 'len don', 'da len don',
  'dang giao', 'da giao', 'da ship', 'dang ship', 'da gui hang', 'don hang',
  'da mua', 'da thanh toan', 'da coc', 'cho nhan hang', 'van chuyen',
];

function looksLikeOrderLabel(name) {
  const n = norm(name);
  if (!n) return false;
  if (n.startsWith('ad_id')) return false; // nhan tu dong cua quang cao
  return ORDER_LABEL_HINTS.some((h) => n.includes(h));
}

/**
 * Tin "#chotdon" do CHINH PAGE gui = chac chan da chot don.
 * Chap nhan "#chotdon", "#chốt đơn", "# chot don", hoa/thuong deu duoc.
 * @param {Array} messages - [{ text, fromPage, time }] moi nhat truoc
 * @returns {string|null} thoi diem tin #chotdon moi nhat (ISO), null neu khong co
 */
const CHOT_TAG = '#chotdon';
function findChotDon(messages = []) {
  for (const m of messages) {
    if (!m.fromPage) continue;
    if (norm(m.text).replace(/\s+/g, '').includes(CHOT_TAG)) return m.time || new Date().toISOString();
  }
  return null;
}

module.exports = { findChotDon, CHOT_TAG, detectOrder, findCustomerPhone, phonesIn, norm, THRESHOLD, looksLikeOrderLabel, ORDER_LABEL_HINTS };
