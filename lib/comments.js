'use strict';

const { cfg, graph, GRAPH } = require('./fb');

/**
 * Lay danh sach bai viet cua page.
 */
async function fetchPosts({ limit = 25 } = {}) {
  const { version, pageId, token } = cfg();
  const fields = [
    'id',
    'message',
    'created_time',
    'permalink_url',
    'full_picture',
    'comments.summary(total_count).limit(0)',
  ].join(',');

  const url =
    `${GRAPH}/${version}/${pageId}/posts` +
    `?fields=${encodeURIComponent(fields)}` +
    `&limit=${limit}` +
    `&access_token=${encodeURIComponent(token)}`;

  const json = await graph(url);
  return (json.data || []).map((p) => ({
    id: p.id,
    message: p.message || '(bài không có chữ)',
    createdTime: p.created_time,
    permalink: p.permalink_url,
    picture: p.full_picture || null,
    commentCount: p.comments?.summary?.total_count ?? 0,
  }));
}

/**
 * Lay comment cua 1 bai viet, kem cac reply de biet page da tra loi chua.
 */
async function fetchComments(postId, { maxPages = 5 } = {}) {
  const { version, token } = cfg();
  const fields = [
    'id',
    'message',
    'created_time',
    'like_count',
    'from{id,name}',
    'comments.limit(20){id,from{id,name},message,created_time}',
  ].join(',');

  let url =
    `${GRAPH}/${version}/${postId}/comments` +
    `?filter=toplevel&order=reverse_chronological` +
    `&fields=${encodeURIComponent(fields)}` +
    `&limit=100` +
    `&access_token=${encodeURIComponent(token)}`;

  const all = [];
  for (let i = 0; i < maxPages && url; i++) {
    const json = await graph(url);
    if (Array.isArray(json.data)) all.push(...json.data);
    url = json.paging?.next || null;
  }
  return all;
}

/**
 * Chuan hoa comment: da duoc page tra loi chua, bao lau roi.
 */
function normalizeComment(c, pageId) {
  const replies = c.comments?.data || [];
  const pageReplied = replies.some((r) => String(r.from?.id) === String(pageId));
  const ts = c.created_time ? new Date(c.created_time).getTime() : 0;
  const byPage = String(c.from?.id) === String(pageId);

  return {
    commentId: c.id,
    userId: c.from?.id || null,
    name: c.from?.name || '(ẩn danh)',
    message: c.message || '',
    createdTime: c.created_time,
    likeCount: c.like_count ?? 0,
    replyCount: replies.length,
    pageReplied,
    byPage,
    hoursSince: ts ? (Date.now() - ts) / 3600000 : null,
  };
}

/** Tra loi cong khai duoi comment. Can quyen pages_manage_engagement. */
async function replyToComment(commentId, message) {
  const { version, token } = cfg();
  return graph(`${GRAPH}/${version}/${commentId}/comments?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
}

/**
 * Nhan tin rieng cho nguoi comment (private reply).
 * Chi gui duoc 1 lan cho moi comment, va trong vong 7 ngay ke tu luc comment.
 * Can quyen pages_messaging.
 */
async function privateReply(commentId, message) {
  const { version, pageId, token } = cfg();
  return graph(`${GRAPH}/${version}/${pageId}/messages?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { comment_id: commentId },
      message: { text: message },
    }),
  });
}

module.exports = { fetchPosts, fetchComments, normalizeComment, replyToComment, privateReply };
