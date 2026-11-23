'use strict';

const GRAPH = 'https://graph.facebook.com';

function cfg() {
  const version = process.env.FB_GRAPH_VERSION || 'v21.0';
  const pageId = process.env.FB_PAGE_ID;
  const token = process.env.FB_PAGE_TOKEN;
  if (!pageId || !token) {
    throw new Error('Thieu FB_PAGE_ID hoac FB_PAGE_TOKEN trong .env');
  }
  return { version, pageId, token };
}

// Loi tam thoi cua Facebook: 1/2 = loi noi bo, 4/17/32/613 = qua gioi han tan suat
const TRANSIENT_CODES = [1, 2, 4, 17, 32, 613];

async function graph(url, options = {}, attempt = 0) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (netErr) {
    // Rot mang / DNS / dut ket noi -> thu lai
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      return graph(url, options, attempt + 1);
    }
    throw new Error(`Khong ket noi duoc Facebook: ${netErr.message}`);
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Graph API tra ve du lieu khong hop le: ${text.slice(0, 300)}`);
  }
  if (!res.ok || json.error) {
    const e = json.error || {};

    // Thu lai toi da 3 lan voi loi tam thoi (cho lau dan: 1s, 2s, 4s)
    if (TRANSIENT_CODES.includes(e.code) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      return graph(url, options, attempt + 1);
    }

    const err = new Error(e.message || `HTTP ${res.status}`);
    err.fbCode = e.code;
    err.fbSubcode = e.error_subcode;
    err.fbType = e.type;
    err.status = res.status;
    throw err;
  }
  return json;
}

/**
 * Kiem tra token. Uu tien lay ten page; neu app thieu quyen
 * pages_read_engagement thi chi can kiem tra doc duoc conversations la du.
 */
async function getPageInfo() {
  const { version, pageId, token } = cfg();
  try {
    return await graph(
      `${GRAPH}/${version}/${pageId}?fields=id,name,username&access_token=${encodeURIComponent(token)}`
    );
  } catch {
    // Fallback: chi can quyen pages_messaging la doc duoc hop thoai
    await graph(
      `${GRAPH}/${version}/${pageId}/conversations?platform=messenger&limit=1&access_token=${encodeURIComponent(token)}`
    );
    return { id: pageId, name: 'Page ' + pageId, limited: true };
  }
}

/**
 * Lay danh sach conversation cua page (co phan trang).
 * @param {{maxPages?: number, pageSize?: number, platform?: string}} opts
 */
async function fetchConversations(opts = {}) {
  const { version, pageId, token } = cfg();
  const maxPages = opts.maxPages ?? 10;
  const pageSize = opts.pageSize ?? 50;
  const platform = opts.platform || 'messenger';
  // Lay nhieu tin gan nhat de con do duoc dau hieu "da chot don"
  const msgLimit = Math.min(Number(opts.msgLimit) || 25, 50);

  const fields = [
    'id',
    'updated_time',
    'unread_count',
    'message_count',
    'participants',
    `messages.limit(${msgLimit}){id,created_time,from,message}`,
  ].join(',');

  let url =
    `${GRAPH}/${version}/${pageId}/conversations` +
    `?platform=${platform}` +
    `&fields=${encodeURIComponent(fields)}` +
    `&limit=${pageSize}` +
    `&access_token=${encodeURIComponent(token)}`;

  const all = [];
  for (let i = 0; i < maxPages && url; i++) {
    const json = await graph(url);
    if (Array.isArray(json.data)) all.push(...json.data);
    url = json.paging?.next || null;
  }
  return { pageId, conversations: all };
}

/* =========================================================================
   NHAN (label) CUA PAGE INBOX — vi du "Da dat hang", "Intake"...
   Ten nhan doc duoc thoai mai. Nhung "khach nao mang nhan nao" thi Facebook
   chi cho doc qua /{PSID}/custom_labels, va endpoint do doi app co quyen
   nang cao; neu chua co se tra loi code 100 subcode 33.
   ========================================================================= */

/** Danh sach nhan cua Page. Chu y: field ten la `page_label_name`. */
async function fetchPageLabels() {
  const { version, pageId, token } = cfg();
  const url =
    `${GRAPH}/${version}/${pageId}/custom_labels` +
    `?fields=page_label_name&limit=100&access_token=${encodeURIComponent(token)}`;

  const seen = new Map();
  let next = url;
  for (let i = 0; i < 5 && next; i++) {
    const json = await graph(next);
    (json.data || []).forEach((l) => {
      if (l.page_label_name) seen.set(l.id, { id: l.id, name: l.page_label_name });
    });
    next = json.paging?.next || null;
  }
  return [...seen.values()];
}

/** Nhan cua 1 khach. Nem loi neu app chua du quyen. */
async function fetchUserLabels(psid) {
  const { version, token } = cfg();
  const json = await graph(
    `${GRAPH}/${version}/${psid}/custom_labels?fields=page_label_name&access_token=${encodeURIComponent(token)}`
  );
  return (json.data || []).map((l) => ({ id: l.id, name: l.page_label_name }));
}

/**
 * Doc nhan cua nhieu khach mot luc bang Batch API (50 nguoi / 1 request)
 * de khoi ban hang tram request le.
 * @returns {Promise<Object>} { psid: [{id,name}] } — psid nao loi thi bo qua
 */
async function fetchUserLabelsBatch(psids) {
  const { version, token } = cfg();
  const out = {};

  for (let i = 0; i < psids.length; i += 50) {
    const chunk = psids.slice(i, i + 50);
    const batch = chunk.map((p) => ({
      method: 'GET',
      relative_url: `${p}/custom_labels?fields=page_label_name`,
    }));

    const body = new URLSearchParams({
      access_token: token,
      include_headers: 'false',
      batch: JSON.stringify(batch),
    });

    const res = await graph(`${GRAPH}/${version}/`, { method: 'POST', body });
    (Array.isArray(res) ? res : []).forEach((r, idx) => {
      if (!r || r.code !== 200) return;
      try {
        const data = JSON.parse(r.body).data || [];
        out[chunk[idx]] = data.map((l) => ({ id: l.id, name: l.page_label_name }));
      } catch { /* bo qua ban ghi hong */ }
    });
  }
  return out;
}

/** Tao nhan moi cho Page, tra ve id. */
async function createLabel(name) {
  const { version, pageId, token } = cfg();
  const body = new URLSearchParams({ page_label_name: name, access_token: token });
  const json = await graph(`${GRAPH}/${version}/${pageId}/custom_labels`, { method: 'POST', body });
  return json.id;
}

/** Tim nhan theo ten (khong phan biet hoa thuong), chua co thi tao moi. */
async function ensureLabel(name) {
  const wanted = String(name || '').trim();
  if (!wanted) throw new Error('Ten nhan de trong');

  const labels = await fetchPageLabels();
  const found = labels.find((l) => l.name.toLowerCase() === wanted.toLowerCase());
  if (found) return found.id;
  return createLabel(wanted);
}

/** Gan nhan cho 1 khach. */
async function attachLabel(labelId, psid) {
  const { version, token } = cfg();
  const body = new URLSearchParams({ user: String(psid), access_token: token });
  return graph(`${GRAPH}/${version}/${labelId}/label`, { method: 'POST', body });
}

/** Go nhan khoi 1 khach. */
async function detachLabel(labelId, psid) {
  const { version, token } = cfg();
  return graph(
    `${GRAPH}/${version}/${labelId}/label?user=${encodeURIComponent(psid)}&access_token=${encodeURIComponent(token)}`,
    { method: 'DELETE' }
  );
}

/**
 * Gan 1 nhan cho nhieu khach bang Batch API (50 nguoi / request).
 * @returns {Promise<{ok:number, fail:number, errors:string[], okPsids:string[]}>}
 */
async function attachLabelBatch(labelId, psids) {
  const { version, token } = cfg();
  let ok = 0;
  let fail = 0;
  const errors = [];
  const okPsids = [];

  for (let i = 0; i < psids.length; i += 50) {
    const chunk = psids.slice(i, i + 50);
    const batch = chunk.map((p) => ({
      method: 'POST',
      relative_url: `${labelId}/label`,
      body: `user=${encodeURIComponent(p)}`,
    }));

    const body = new URLSearchParams({
      access_token: token,
      include_headers: 'false',
      batch: JSON.stringify(batch),
    });

    const res = await graph(`${GRAPH}/${version}/`, { method: 'POST', body });
    (Array.isArray(res) ? res : []).forEach((r, idx) => {
      if (r && r.code === 200) {
        ok++;
        okPsids.push(chunk[idx]);
      } else {
        fail++;
        if (errors.length < 3 && r?.body) errors.push(String(r.body).slice(0, 120));
      }
    });
  }
  return { ok, fail, errors, okPsids };
}

/**
 * Thu doc nhan cua 1 khach de biet app co du quyen khong.
 * @returns {Promise<{available:boolean, reason?:string, code?:number}>}
 */
async function probeLabelAccess(psid) {
  if (!psid) return { available: false, reason: 'Chua co hoi thoai nao de thu' };
  try {
    await fetchUserLabels(psid);
    return { available: true };
  } catch (e) {
    return { available: false, reason: e.message, code: e.fbCode, subcode: e.fbSubcode };
  }
}

/**
 * Chuan hoa 1 conversation thanh dang de hien thi.
 */
function normalizeConversation(conv, pageId) {
  const msgs = conv.messages?.data || [];
  // Graph tra ve tin moi nhat truoc
  const last = msgs[0] || null;

  const participants = conv.participants?.data || [];
  const customer = participants.find((p) => String(p.id) !== String(pageId)) || participants[0] || {};

  const lastFromPage = last ? String(last.from?.id) === String(pageId) : false;
  const lastTime = last?.created_time || conv.updated_time;
  const lastTs = lastTime ? new Date(lastTime).getTime() : 0;

  // Tin nhan cuoi cung cua khach (de biet khach hoi gi)
  const lastCustomerMsg = msgs.find((m) => String(m.from?.id) !== String(pageId)) || null;
  const lastCustomerTs = lastCustomerMsg?.created_time ? new Date(lastCustomerMsg.created_time).getTime() : 0;

  return {
    conversationId: conv.id,
    psid: customer.id || null,
    name: customer.name || '(khong ro ten)',
    updatedTime: conv.updated_time,
    unreadCount: conv.unread_count ?? 0,
    messageCount: conv.message_count ?? msgs.length,
    lastMessage: last?.message || '',
    lastMessageTime: lastTime,
    lastMessageTs: lastTs,
    lastFromPage,
    lastCustomerMessage: lastCustomerMsg?.message || '',
    lastCustomerTime: lastCustomerMsg?.created_time || null,
    hoursSinceLast: lastTs ? (Date.now() - lastTs) / 3600000 : null,
    // Facebook tinh cua so 24h tu tin cuoi cua KHACH, khong phai cua Page
    lastCustomerTs,
    hoursSinceCustomer: lastCustomerTs ? (Date.now() - lastCustomerTs) / 3600000 : null,
    // Tin moi nhat truoc — dung de do "da dat hang chua"
    messages: msgs.map((m) => ({
      text: m.message || '',
      fromPage: String(m.from?.id) === String(pageId),
      time: m.created_time || null,
    })),
  };
}

/**
 * Loc cac cuoc hoi thoai "lau chua rep".
 *
 * Hai cach loc, dung 1 trong 2:
 *  - Tuong doi: minHours / maxHours (bao lau tinh tu bay gio)
 *  - Theo ngay: fromTs / toTs (moc thoi gian, ms epoch)
 *
 * @param {Array} items ket qua normalizeConversation
 * lastFrom: 'customer' (khach nhan cuoi, minh chua rep) | 'page' (minh nhan cuoi) | 'all'
 *
 * @param {{minHours?:number, maxHours?:number, fromTs?:number, toTs?:number, lastFrom?:string}} filter
 */
function filterStale(items, filter) {
  const lastFrom = filter.lastFrom || 'customer';
  const useDate = filter.fromTs != null || filter.toTs != null;

  const minHours = Number(filter.minHours) || 0;
  const maxHours = filter.maxHours ? Number(filter.maxHours) : null;
  const fromTs = filter.fromTs != null ? Number(filter.fromTs) : null;
  const toTs = filter.toTs != null ? Number(filter.toTs) : null;

  // by = 'customer': tinh theo tin cuoi cua khach (dung cho cua so 24h cua Facebook)
  const byCustomer = filter.by === 'customer';
  const tsOf = (it) => (byCustomer ? it.lastCustomerTs : it.lastMessageTs);
  const hoursOf = (it) => (byCustomer ? it.hoursSinceCustomer : it.hoursSinceLast);

  return items
    .filter((it) => it.psid)
    .filter((it) => {
      if (lastFrom === 'customer') return !it.lastFromPage;
      if (lastFrom === 'page') return it.lastFromPage;
      return true; // 'all'
    })
    .filter((it) => {
      const ts = tsOf(it);
      const h = hoursOf(it);
      if (!ts) return false;
      if (useDate) {
        if (fromTs != null && ts < fromTs) return false;
        if (toTs != null && ts > toTs) return false;
        return true;
      }
      if (h == null || h < minHours) return false;
      if (maxHours && h > maxHours) return false;
      return true;
    })
    .sort((a, b) => tsOf(a) - tsOf(b)); // cu nhat truoc
}

const VALID_TAGS = [
  'HUMAN_AGENT',
  'ACCOUNT_UPDATE',
  'POST_PURCHASE_UPDATE',
  'CONFIRMED_EVENT_UPDATE',
];

async function postMessage({ psid, text, tag }) {
  const { version, pageId, token } = cfg();
  const url = `${GRAPH}/${version}/${pageId}/messages?access_token=${encodeURIComponent(token)}`;

  const body = {
    recipient: { id: psid },
    message: { text },
    messaging_type: tag ? 'MESSAGE_TAG' : 'RESPONSE',
  };
  if (tag) body.tag = tag;

  const json = await graph(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ...json, usedTag: tag || null };
}

/**
 * Gui tin nhan toi 1 nguoi dung.
 *
 * tagMode:
 *   'none'   -> khong bao gio dung tag (chi gui duoc trong 24h)
 *   'auto'   -> <24h: RESPONSE, >=24h: HUMAN_AGENT (app phai duoc duyet Human Agent)
 *   '<TAG>'  -> <24h: RESPONSE, >=24h: dung dung tag do
 *
 * fallbackTag: neu lan gui dau bi tu choi vi tag (code 100/10/200) thi thu lai
 * mot lan bang tag nay.
 */
async function sendMessage({ psid, text, hoursSinceLast, tagMode = 'auto', fallbackTag = null }) {
  const outside24h = hoursSinceLast == null || hoursSinceLast >= 24;

  let tag = null;
  if (outside24h && tagMode !== 'none') {
    tag = tagMode === 'auto' ? 'HUMAN_AGENT' : tagMode;
    if (!VALID_TAGS.includes(tag)) tag = 'HUMAN_AGENT';
  }

  try {
    return await postMessage({ psid, text, tag });
  } catch (e) {
    const tagRejected = tag && [10, 100, 200].includes(e.fbCode);
    if (tagRejected && fallbackTag && VALID_TAGS.includes(fallbackTag) && fallbackTag !== tag) {
      const r = await postMessage({ psid, text, tag: fallbackTag });
      return { ...r, fellBackFrom: tag };
    }
    throw e;
  }
}

module.exports = {
  GRAPH,
  graph,
  VALID_TAGS,
  cfg,
  getPageInfo,
  fetchPageLabels,
  createLabel,
  ensureLabel,
  attachLabel,
  detachLabel,
  attachLabelBatch,
  fetchUserLabels,
  fetchUserLabelsBatch,
  probeLabelAccess,
  fetchConversations,
  normalizeConversation,
  filterStale,
  sendMessage,
};
