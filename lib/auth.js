'use strict';

const fs = require('fs');
const path = require('path');
const { GRAPH, graph } = require('./fb');

const ENV_FILE = path.join(__dirname, '..', '.env');

const SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_read_engagement',
  'pages_read_user_content', // doc comment cua khach tren bai viet
  'pages_manage_engagement',
  'pages_manage_metadata',
  'business_management',
];

function appCfg() {
  const version = process.env.FB_GRAPH_VERSION || 'v21.0';
  const appId = process.env.FB_APP_ID;
  const appSecret = process.env.FB_APP_SECRET;
  if (!appId || !appSecret) throw new Error('Thieu FB_APP_ID hoac FB_APP_SECRET trong .env');
  return { version, appId, appSecret };
}

function redirectUri(req) {
  const port = process.env.PORT || 3000;
  return `http://localhost:${port}/auth/callback`;
}

/** URL man hinh dong y quyen cua Facebook */
function loginUrl(req) {
  const { version, appId } = appCfg();
  const p = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri(req),
    scope: SCOPES.join(','),
    response_type: 'code',
    auth_type: 'rerequest', // hoi lai ca nhung quyen tung bi tu choi
  });
  return `https://www.facebook.com/${version}/dialog/oauth?${p}`;
}

/** Doi code -> user token ngan han */
async function codeToUserToken(code, req) {
  const { version, appId, appSecret } = appCfg();
  const p = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri(req),
    code,
  });
  const j = await graph(`${GRAPH}/${version}/oauth/access_token?${p}`);
  return j.access_token;
}

/** User token ngan han -> user token dai han (60 ngay) */
async function toLongLived(userToken) {
  const { version, appId, appSecret } = appCfg();
  const p = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: userToken,
  });
  const j = await graph(`${GRAPH}/${version}/oauth/access_token?${p}`);
  return j.access_token;
}

/**
 * Lay page token vinh vien.
 * Page token sinh tu user token dai han thi khong het han.
 */
/** Tat ca Page ma tai khoan quan ly, kem page token (vinh vien) cua tung Page */
async function listPages(longLivedUserToken) {
  const { version } = appCfg();
  const j = await graph(
    `${GRAPH}/${version}/me/accounts?fields=id,name,access_token&limit=100` +
      `&access_token=${encodeURIComponent(longLivedUserToken)}`
  );
  return (j.data || []).map((p) => ({ pageId: p.id, pageName: p.name, pageToken: p.access_token }));
}

async function getPageToken(longLivedUserToken, wantPageId) {
  const { version } = appCfg();
  const j = await graph(
    `${GRAPH}/${version}/me/accounts?fields=id,name,access_token&limit=100` +
      `&access_token=${encodeURIComponent(longLivedUserToken)}`
  );
  const pages = j.data || [];
  const match = wantPageId ? pages.find((p) => String(p.id) === String(wantPageId)) : pages[0];
  if (!match) {
    const names = pages.map((p) => `${p.name} (${p.id})`).join(', ') || 'không có page nào';
    throw new Error(`Không tìm thấy Page ${wantPageId} trong tài khoản. Các page bạn quản lý: ${names}`);
  }
  return { pageId: match.id, pageName: match.name, pageToken: match.access_token };
}

/** Ghi de mot bien trong .env, giu nguyen phan con lai. Co sao luu. */
function updateEnv(key, value) {
  const original = fs.readFileSync(ENV_FILE, 'utf8');
  fs.writeFileSync(ENV_FILE + '.bak', original, 'utf8');

  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  const updated = re.test(original)
    ? original.replace(re, line)
    : original.replace(/\n*$/, '\n') + line + '\n';

  fs.writeFileSync(ENV_FILE, updated, 'utf8');
  process.env[key] = value; // ap dung ngay, khong can khoi dong lai
}

/** Xem token hien tai co nhung quyen gi */
async function tokenInfo(token) {
  const { version, appId, appSecret } = appCfg();
  const j = await graph(
    `${GRAPH}/${version}/debug_token?input_token=${encodeURIComponent(token)}` +
      `&access_token=${encodeURIComponent(appId + '|' + appSecret)}`
  );
  const d = j.data || {};
  const scopes = d.scopes || [];
  const need = ['pages_read_engagement', 'pages_manage_engagement'];
  return {
    valid: d.is_valid,
    type: d.type,
    expiresAt: d.expires_at, // 0 = vinh vien
    dataAccessExpiresAt: d.data_access_expires_at || null, // het han quyen doc du lieu (~90 ngay)
    profileId: d.profile_id || null,
    scopes,
    missingForComments: need.filter((s) => !scopes.includes(s)),
    canMessage: scopes.includes('pages_messaging'),
  };
}

module.exports = { SCOPES, listPages, loginUrl, codeToUserToken, toLongLived, getPageToken, updateEnv, tokenInfo, redirectUri };
