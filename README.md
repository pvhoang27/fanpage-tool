# Tool rep tin nhắn Page hàng loạt

Giao diện web để lọc các hội thoại Messenger **lâu chưa được trả lời** và gửi câu trả lời chọn sẵn cho hàng loạt người.

## Chạy

```bash
npm install
npm start
# mở http://localhost:3000
```

`.env` cần có:

```
FB_PAGE_ID=...
FB_PAGE_TOKEN=...      # Page Access Token, quyền pages_messaging
FB_GRAPH_VERSION=v21.0 # tuỳ chọn
PORT=3000              # tuỳ chọn
```

## Cách dùng

1. **Lọc** — chọn "chưa rep quá N giờ/ngày". Bật *chỉ tin khách nhắn cuối* để chỉ lấy hội thoại mà Page chưa trả lời.
2. **Chọn người nhận** — tick từng người, hoặc "Chọn tất cả" / "Chọn cái chưa gửi".
3. **Câu trả lời** — chọn mẫu có sẵn hoặc gõ mới. Dùng `{{name}}` (tên đầy đủ) và `{{first_name}}` để cá nhân hoá. Bấm *Lưu mẫu* để dùng lại lần sau.
4. **Gửi** — tool gửi tuần tự, giãn cách mặc định 1200ms, log kết quả từng người theo thời gian thực.

## Tự động bỏ qua khách đã đặt hàng

Khách đã chốt đơn và đang chờ hàng về thì **không nên** nhận tin chào mời — dễ gây phiền và bị
report. Tool lọc nhóm này theo hai lớp:

**1. Tự đoán** (`lib/order.js`) — đọc ~25 tin gần nhất của mỗi hội thoại, chấm điểm dấu hiệu đơn
hàng, ≥ 3 điểm là coi như đã đặt. Không dấu tiếng Việt vẫn nhận ("chốt đơn" = "chot don"):

| Nguồn | Dấu hiệu | Điểm |
|---|---|---|
| Shop | lên đơn, mã vận đơn, đã gửi hàng, đang giao, shipper, GHTK/GHN/J&T/VNPost… | 3 |
| Shop | dự kiến giao, đã nhận cọc, cảm ơn đã đặt hàng | 2 |
| Khách | đã chuyển khoản / đã CK / đã cọc / đã thanh toán, chốt đơn | 3 |
| Khách | khi nào hàng tới, đơn của mình đâu, hàng tới chưa | 3 |
| Khách | đặt hàng, mình lấy 1, cho em 1, địa chỉ nhận hàng | 2 |
| Khách | số điện thoại (`0xxxxxxxxx`), địa chỉ (≥2 từ khoá: số nhà/đường/phường/quận…) | 2 |

Nếu tin **huỷ đơn / không lấy nữa / hoàn hàng** mới hơn dấu hiệu đặt hàng thì huỷ kết quả — khách
lại nhắn được bình thường.

**2. Nhãn Page Inbox** — tool đọc được danh sách nhãn của Page (`/{page-id}/custom_labels?fields=page_label_name`)
và cho bạn tick nhãn nào nghĩa là "đã đặt hàng" (mặc định tự tick theo tên: *Đã đặt hàng*, *Đã thanh toán*…),
lưu ở `data/order-labels.json`.

> **Không dùng được, và không phải do thiếu quyền.** Facebook chỉ cho tra nhãn theo từng người qua
> `GET /{PSID}/custom_labels`, không có endpoint ngược lại (lấy danh sách người trong một nhãn).
> Endpoint đó trả `(#100) subcode 33` với **mọi** PSID, trên **mọi** phiên bản Graph từ v12 → v26.
>
> Đã kiểm chứng bằng thực nghiệm: app **tạo được** nhãn mới (`POST /{page-id}/custom_labels`) và
> **gắn được** nhãn đó cho đúng PSID đang thử (`POST /{label-id}/label` → `{"success":true}`),
> nhưng đọc ngược lại vẫn `subcode 33`. Tức là app có đủ quyền thao tác trên chính người đó —
> chiều **ghi sống, chiều đọc chết**. Xin App Review / Advanced Access sẽ không giải quyết được.
>
> Code đọc nhãn vẫn giữ trong `lib/fb.js` và tự dò lại mỗi 5 phút, phòng khi Meta mở lại endpoint.
> Cho tới lúc đó, việc lọc dựa vào tự đoán nội dung chat + đánh dấu tay.

**Chiều ghi thì dùng được** — tool ghi nhãn ngược lên Page Inbox, bật/tắt trong *Cài đặt nâng cao*
(lưu ở `data/label-sync.json`, cả hai đang **bật sẵn**):

| Cài đặt | Việc nó làm | Tên nhãn mặc định |
|---|---|---|
| `syncOrderMark` | Bấm *Đánh dấu đã đặt hàng* trong tool → gắn nhãn thật vào hội thoại; bấm *Chưa đặt hàng* → gỡ nhãn | `Đã đặt hàng` |
| `tagSent` | Gửi tin hàng loạt xong → gắn nhãn cho mọi người vừa nhận (Batch API, 50 người/request) | `Tool đã nhắn` |

Nhãn chưa tồn tại thì tool tự tạo; đã có thì dùng lại đúng nhãn đó, không tạo trùng. Nhãn Page là
ghi chú nội bộ — **khách không nhìn thấy**. Lỗi khi ghi nhãn không làm hỏng việc gửi tin hay đánh
dấu, chỉ hiện cảnh báo.

**Bỏ qua khách theo nhãn** — ở bước 1, tick nhãn nào trong *Bỏ qua khách có nhãn* thì người mang
nhãn đó bị ẩn và bị chặn lúc gửi (lưu ở `data/skip-labels.json`). Vì không đọc được nhãn từ Facebook,
tool tự nhớ nhãn **do chính nó gắn** (`data/user-labels.json`): nút *+ Gắn nhãn…* trên từng khách,
nút đánh dấu đã đặt hàng, nhãn gắn sau khi gửi. Nhãn gắn tay trong Business Suite thì tool không thấy.
Page chưa có nhãn cần dùng thì gõ tên và bấm *➕ Tạo nhãn*.

**3. Đánh dấu tay** — mỗi khách có nút *Đánh dấu đã đặt hàng* / *Chưa đặt hàng*, lưu ở
`data/orders.json` và **luôn thắng** hai cách trên. Dùng khi tool đoán sai.

Thứ tự ưu tiên: **đánh dấu tay → nhãn Facebook → tự đoán nội dung chat**.

Ngoài ra, hội thoại đã bấm **Xong** trong Page Inbox (`folder=page_done`) vốn không nằm trong
thư mục `inbox` mà tool đọc, nên đã tự động bị loại sẵn.

Ở bước 1 có ô chọn *Khách đã đặt hàng*: **Bỏ qua** (mặc định) / **Chỉ xem nhóm này** / **Hiện tất
cả**. Kể cả khi bạn chọn "hiện tất cả" rồi lỡ tick, server vẫn chặn lần cuối lúc gửi (tắt được
bằng ô *Chặn gửi cho khách đã đặt hàng* trong Cài đặt nâng cao).

## Giới hạn của Facebook (quan trọng)

Cửa sổ 24h: sau khi khách nhắn, Page chỉ được trả lời tự do trong 24 giờ. Ngoài 24h phải gắn *message tag*.

| Kiểu gửi | Dùng được khi | Điều kiện |
|---|---|---|
| Không tag (`RESPONSE`) | trong 24h | luôn được |
| `HUMAN_AGENT` | 24h → 7 ngày | **app phải được Meta duyệt tính năng Human Agent** |
| `ACCOUNT_UPDATE` | bất kỳ lúc nào | chỉ cho thông báo thay đổi tài khoản/đơn hàng |
| `POST_PURCHASE_UPDATE` | bất kỳ lúc nào | chỉ cho việc sau khi khách đã mua |
| `CONFIRMED_EVENT_UPDATE` | bất kỳ lúc nào | chỉ cho lịch hẹn/sự kiện đã xác nhận |
| — | quá 7 ngày, không tag | FB chặn hoàn toàn |

Lỗi `(#100) Không thể gắn thẻ tin nhắn là "HUMAN_AGENT" khi chưa được phê duyệt` = app chưa
được duyệt. Xin duyệt tại **developers.facebook.com → App → App Review → Permissions and Features
→ Human Agent → Request**.

Ba tag còn lại không cần duyệt riêng, nhưng **chỉ được dùng đúng mục đích**. Dùng chúng để gửi
nội dung chào hàng ngoài 24h là sai chính sách Meta và có thể bị hạn chế Page. Tool có dropdown
*Kiểu gửi* để bạn tự chọn, kèm tuỳ chọn tự thử lại bằng tag khác khi tag đầu bị từ chối.

## Tool rep comment (`/comments.html`)

Chọn bài viết → chọn comment chưa được trả lời → trả lời hàng loạt. Có 2 kiểu, tick cái nào cũng được, tick cả hai càng tốt:

- **Trả lời công khai** dưới comment (cần `pages_manage_engagement`)
- **Nhắn tin riêng** cho người comment (cần `pages_messaging` — đã có sẵn)

Nhắn riêng qua comment là cách hợp lệ để mở cuộc trò chuyện với người chưa từng inbox.
Giới hạn: mỗi comment chỉ nhắn riêng được **1 lần**, và trong vòng **7 ngày** kể từ lúc họ comment.

### Quyền cho tool comment

Token hiện tại chỉ có `pages_show_list`, `business_management`, `pages_messaging`, `pages_manage_metadata`.
Cần thêm **`pages_read_engagement`** (đọc bài + comment) và **`pages_manage_engagement`** (trả lời comment).

Hai quyền này **không cần Meta duyệt** khi bạn là admin của Page và của app — chỉ cần cấp lại token:

1. Mở [Graph API Explorer](https://developers.facebook.com/tools/explorer/).
2. Góc phải chọn đúng app **rep-page-mess**.
3. Bấm **Permissions** → tick thêm `pages_read_engagement` và `pages_manage_engagement`
   (giữ nguyên `pages_messaging`, `pages_show_list`, `pages_manage_metadata`).
4. Bấm **Generate Access Token** → đăng nhập → chọn Page → Done.
5. Đổi từ *User Token* sang **Page Token** của Page bạn ở dropdown phía trên.
6. Token này ngắn hạn (1–2 giờ). Đổi sang token vĩnh viễn:

```bash
# B1: đổi user token ngắn hạn → user token dài hạn (60 ngày)
curl "https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token\
&client_id=$FB_APP_ID&client_secret=$FB_APP_SECRET&fb_exchange_token=<USER_TOKEN_NGẮN_HẠN>"

# B2: lấy page token vĩnh viễn từ user token dài hạn
curl "https://graph.facebook.com/v21.0/me/accounts?access_token=<USER_TOKEN_DÀI_HẠN>"
```

7. Chép `access_token` của Page vào `FB_PAGE_TOKEN` trong `.env`, khởi động lại tool.

Kiểm tra token đang có những quyền gì:

```bash
. ./.env && curl -s "https://graph.facebook.com/v21.0/debug_token?input_token=$FB_PAGE_TOKEN\
&access_token=$FB_APP_ID|$FB_APP_SECRET" | python3 -m json.tool
```

## Dữ liệu lưu cục bộ

- `data/templates.json` — mẫu câu trả lời tin nhắn.
- `data/sent-log.json` — ai đã được gửi tin (tránh gửi trùng).
- `data/comment-templates.json` — mẫu câu trả lời comment.
- `data/replied-comments.json` — comment nào đã trả lời (tránh rep trùng).
- `data/orders.json` — khách bạn tự đánh dấu đã / chưa đặt hàng.
- `data/order-labels.json` — nhãn Page nào được coi là "đã đặt hàng".
- `data/label-sync.json` — bật/tắt ghi nhãn ngược lên Page Inbox và tên nhãn dùng.

## Cấu trúc

- `server.js` — Express + toàn bộ API.
- `lib/fb.js` — Graph API phần tin nhắn: lấy hội thoại, lọc, gửi tin, tự thử lại khi lỗi mạng.
- `lib/comments.js` — Graph API phần comment: lấy bài viết, lấy comment, trả lời, nhắn riêng.
- `lib/order.js` — dò xem hội thoại đã chốt đơn / đang giao hàng chưa.
- `lib/store.js` — đọc/ghi mẫu câu, lịch sử, đánh dấu đơn hàng.
- `public/index.html` + `app.js` — tool tin nhắn · `public/comments.html` + `comments.js` — tool comment ·
  `public/setup.html` — trang Kết nối.
- `public/common.js` — hàm dùng chung (thanh trên cùng, thông báo nhỏ, avatar…) · `public/style.css` — giao diện chung.
