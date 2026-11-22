# Tool rep tin nhắn / comment Facebook Page

Chi tiết tính năng xem `README.md`. File này ghi bối cảnh vận hành.

## Facebook app & Page đang dùng

- App: **rep-tin-xuong-bat** — App ID `1149862550779026` (chế độ Development, chưa publish,
  chưa gắn business portfolio). Dashboard: https://developers.facebook.com/apps/1149862550779026/
- Use case: *Engage with customers on Messenger* + *Manage everything on your Page*.
- Page: **Cốm Ngon** — ID `1314207451785364`.
- Token Page (trong `.env` → `FB_PAGE_TOKEN`) là **token vĩnh viễn** (`expires_at: 0`), có đủ:
  `pages_messaging, pages_show_list, pages_read_engagement, pages_read_user_content,
  pages_manage_engagement, pages_manage_metadata, business_management`.
- **Data access hết hạn ~21/02/2027** (90 ngày). Làm mới: chạy server rồi mở
  `http://localhost:3000/auth/login?choose=1` → Continue → chọn Page. Tool tự ghi token mới vào `.env`.
- App cũ trước đây là `rep-page-mess` (README còn nhắc tên này ở phần Graph API Explorer) — đã thay.

## Nhiều Page

- Mỗi lần đăng nhập (`/auth/login`), tool lưu token của **mọi Page** nick đó cấp quyền vào `data/pages.json`
  (có token — đã thêm vào `.gitignore`). Page đang dùng = `FB_PAGE_ID`/`FB_PAGE_TOKEN` trong `.env`.
- Chuyển Page: menu tên Page ở thanh trên cùng, hoặc trang Kết nối → `POST /api/pages/switch` ghi lại `.env`.
- Gửi tin / trả lời comment kèm `pageId`; server trả 409 nếu Page vừa bị đổi ở tab khác.

## Bí mật

- `.env` chứa `FB_APP_ID, FB_APP_SECRET, FB_PAGE_ID, FB_PAGE_TOKEN`; `data/pages.json` chứa token của các Page.
  **Không in giá trị secret/token ra terminal hay chat.** Khi cần kiểm tra token, dùng
  `debug_token` và chỉ in các trường như `is_valid`, `expires_at`, `scopes`.
- Mỗi lần ghi token, tool tự tạo bản sao lưu `.env.bak` (bản `.env` ngay trước đó).

## Chạy

- `npm start` → http://localhost:3000 (Express, `server.js`). Sửa `.env` thì phải khởi động lại server.
- Kiểm tra token:
  ```bash
  set -a && . ./.env && set +a && curl -s "https://graph.facebook.com/v21.0/debug_token?input_token=$FB_PAGE_TOKEN&access_token=$FB_APP_ID|$FB_APP_SECRET" \
    | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(d['is_valid'],d['expires_at'],d.get('scopes'))"
  ```

## Lưu ý Facebook

- Chỗ nào Facebook hỏi mật khẩu thì dừng lại cho người dùng tự nhập.
- Trình duyệt: dùng Chrome tên **"test"** (profile đã đăng nhập tài khoản developer quản lý Page Cốm Ngon).
