# Hồ sơ xin Meta duyệt app (App Review)

Mục tiêu: app **rep-tin-xuong-bat** (App ID `1149862550779026`) chuyển sang **Live** để nhắn tin,
nhắn riêng từ comment và thấy tên **khách thật** — không chỉ admin.

- Privacy Policy URL: https://pvhoang27.github.io/fanpage-tool/privacy.html
- Data Deletion Instructions URL: https://pvhoang27.github.io/fanpage-tool/data-deletion.html

---

## Bước 1 — Cài đặt cơ bản (App settings → Basic)

| Ô | Điền |
|---|---|
| Privacy Policy URL | `https://pvhoang27.github.io/fanpage-tool/privacy.html` |
| User data deletion | chọn *Data deletion instructions URL* → `https://pvhoang27.github.io/fanpage-tool/data-deletion.html` |
| Category | Business and Pages |
| App icon | ảnh vuông 1024×1024 (logo cửa hàng) |
| Contact email | email bạn dùng để nhận thông báo từ Meta |

Bấm **Save changes**.

## Bước 2 — Xác minh doanh nghiệp (Business Verification)

1. App settings → Basic → **Business portfolio**: gắn app vào Business portfolio đang quản lý Page Xưởng may bạt.
2. business.facebook.com → **Settings → Security Center → Start verification**.
3. Cần: tên doanh nghiệp đúng giấy tờ, địa chỉ, số điện thoại, website hoặc Page, và **một giấy tờ** có tên cửa hàng
   (giấy phép kinh doanh / đăng ký hộ kinh doanh / hoá đơn điện, nước, internet).
4. Chờ 1–5 ngày. Không có bước này thì không xin được Advanced Access.

## Bước 3 — Xin quyền (App Review → Permissions and Features)

Bấm **Request advanced access** cho từng quyền bên dưới. Ô mô tả: **copy đúng đoạn tiếng Anh**.
Video: dùng chung 1 video theo kịch bản ở Bước 4, tải lên cho từng quyền.

### `pages_messaging`
```
Our shop uses this app as an internal customer-care tool for our own Facebook Page
("Xưởng may bạt mái kéo, mái xếp"). Customers message the Page to ask for prices and products.
The app lists conversations where the customer is still waiting, and lets our staff write and send
a reply to customers who messaged the Page within the standard 24-hour messaging window.
It also sends one private reply to a person who commented on our Page's post, so we can answer
their question (usually a price request) in Messenger.
Messages are only sent to people who contacted the Page first. We never send promotional broadcasts
outside the 24-hour window and we do not use message tags for marketing.
```

### `pages_read_user_content`
```
Our staff need to see who commented on our Page's posts and what they asked (for example
"price for 1m2?"), so they can answer each customer. This permission lets the app read the
comments and the commenter's name on posts published by our own Page. The data is only shown
to our staff inside the tool and is not shared or stored beyond a record of which comments
have already been answered.
```

### `pages_manage_engagement`
```
After reading a customer's comment on our Page's post, our staff reply publicly under that
comment from the Page (for example "We have sent you the price list in Messenger").
This permission is used only to post replies, written by our staff, to comments on our own Page's posts.
```

### `pages_read_engagement`
```
Used to list the posts published by our own Page together with their comment counts, so staff
can choose which post's comments to answer.
```

### `pages_show_list`
```
Used once when the Page admin logs in, to list the Pages they manage so they can choose which
of their own Pages the tool should work with.
```

### `pages_manage_metadata`
```
Used to read and update Page Inbox labels on our own Page's conversations (for example marking a
conversation as "Ordered"), so staff do not send unnecessary messages to customers who already bought.
```

> Nếu Meta hỏi *"How will people use this?"* hoặc ô **Test instructions**, dán:
> ```
> This is an internal tool run by the Page owner on the shop's computer; there is no public website
> to log in to. The screencast shows the complete flow: Page admin logs in with Facebook, selects the
> Page, sees customers who messaged or commented, writes a reply, sends it, and the reply appears
> in Messenger / under the comment.
> ```

## Bước 4 — Kịch bản quay video (2–3 phút)

Chuẩn bị: một nick Facebook phụ (vai **khách**) đã nhắn tin cho Page và comment một bài của Page.
Quay toàn màn hình, **tiếng Anh hoặc có phụ đề tiếng Anh** (có thể chèn chữ khi dựng).

1. **(0:00)** Mở `http://localhost:3000/setup.html`. Bấm **Kết nối lại** → màn hình đăng nhập Facebook
   hiện ra → tick quyền → chọn Page → Done. *(Meta bắt buộc thấy màn hình xin quyền.)*
2. **(0:30)** Trang Kết nối hiện tên Page và danh sách quyền.
3. **(0:45)** Tab **Tin nhắn**: thấy nick khách vừa nhắn. Chọn khách, gõ câu trả lời, bấm **Gửi**.
4. **(1:10)** Chuyển sang Messenger của nick khách: **tin trả lời đã tới**.
5. **(1:30)** Tab **Comment**: chọn bài viết → thấy comment kèm **tên** nick khách.
   Tick *Trả lời công khai* + *Nhắn tin riêng*, gõ nội dung, bấm **Trả lời**.
6. **(2:00)** Mở bài viết trên Facebook: thấy **câu trả lời của Page dưới comment**.
   Mở Messenger nick khách: thấy **tin nhắn riêng**.
7. **(2:20)** Kết thúc.

Mẹo: đặt chữ chú thích tiếng Anh ở góc video cho từng bước, ví dụ
*"Staff replies to a customer who messaged the Page"*.

## Bước 5 — Gửi duyệt và bật Live

1. App Review → **Requests** → kiểm tra đủ quyền → **Submit for review**.
2. Thường 3–10 ngày. Bị từ chối: đọc lý do, sửa video / mô tả, gửi lại.
3. Duyệt xong: thanh trên cùng của app gạt **App Mode: Development → Live**.
4. Mở tool → trang Kết nối → **Kết nối lại** một lần để lấy token mới.

## Những điều KHÔNG nên ghi trong đơn

- “gửi hàng loạt”, “broadcast”, “marketing”, “quảng cáo”, “spam”, “xào tin”.
- Nhắn cho người **chưa từng** nhắn / comment Page.
- Dùng message tag để chào hàng ngoài 24 giờ.
