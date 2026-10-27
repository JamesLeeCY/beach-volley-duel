# 台灣金排球 Taiwan Gold Volley

純前端的 2D 排球對戰網頁遊戲，主角是 16 種臺灣動物：對戰電腦、每日挑戰、環島巡迴賽、闖關挑戰、同機雙人、P2P 線上對戰（房間碼）、練習模式，附動物圖鑑（TaiCOL 保育資料與冷知識）、成就與造型。支援鍵盤、手機觸控、手把，可安裝為 PWA 離線遊玩。

## 操作

| 動作 | 1P | 2P |
| --- | --- | --- |
| 左／右 | A ／ D | ← ／ → |
| 跳 | W | ↑ |
| 下 | S | ↓ |
| 擊球 | T | M |

- 空中按擊球＝扣殺：無方向平射、上＝高吊、下＝重扣、前／後＝斜射
- 地上按擊球＋左右＝魚躍
- 單人模式（對戰電腦、練習、線上）也可以用方向鍵移動、空白鍵或 J 擊球
- 鍵位可在「設定 → 鍵盤鍵位」重新綁定
- Esc／P 暫停、Enter／空白鍵確認選單；對戰電腦與線上時兩套按鍵都能控制自己
- 選角 4×4：← → 在同一排移動（到邊緣換排）、↑ ↓ 換排、擊球鍵或 Enter 確定、Esc 返回
- 手把：D-pad／左搖桿移動、A 跳、B 或 X 擊球（可在設定頁改）
- 手機（荒野亂鬥式）：畫面填滿全螢幕；左半邊任意處按下出現浮動搖桿；右下大鈕擊球（按住拖曳可瞄準扣殺方向）、旁邊小鈕跳。設定可改成固定搖桿、調大小／透明度、左右互換。iPhone 請「加入主畫面」以全螢幕遊玩

## 本機開發

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 單元測試（決定性、物理、rollback、鍵位、角色包）
npm run test:e2e   # Playwright E2E（首次先執行 npx playwright install chromium）
npm run build      # 輸出到 dist/
npm run gen:assets # 重新產生內建角色圖與圖示
npm run gen:og     # 重新產生連結預覽圖 public/og.jpg
npm run fetch:taicol # 從 TaiCOL 重新抓 16 種動物的保育資料（src/data/conservation.json）
```

需要 Node 20 以上。規格書建議 pnpm，本 repo 使用 npm（換成 pnpm 也可直接執行）。

## 部署（GitHub Pages）

1. 推到 GitHub 的 `main` 分支。
2. Repo → Settings → Pages → Source 選 **GitHub Actions**。
3. `.github/workflows/deploy.yml` 會跑測試、建置並發佈；網址為 `https://<帳號>.github.io/<repo>/`。

`vite.config.ts` 的 `base: './'` 使用相對路徑，放在任何子路徑都能運作。

### 自動檢查與部署（CI/CD）

| 時機 | 做什麼 |
| --- | --- |
| 推到 `main` | 單元測試 → 端對端測試（Chromium＋WebKit）→ 建置 → 部署到 GitHub Pages；任何一步失敗就不部署 |
| 開 Pull Request 到 `main` | 跑同樣的測試與建置，不部署；結果顯示在 PR 頁面，通過後再合併 |
| 手動 | Actions → Deploy to GitHub Pages → Run workflow |

## 線上對戰

- 信令使用 PeerJS 公用伺服器（`0.peerjs.com`），STUN／TURN 使用 PeerJS 預設設定，所以只靠靜態主機就能連線，不需自架後端。
- 房主建立房間得到 6 碼房間碼與連結 `?room=XXXXXX`；對方開連結或輸入房間碼加入。
- 房間畫面有「LINE 邀請朋友」按鈕，朋友點開連結就直接進房，不用輸入房號。手機開 LINE App、電腦用 LINE 官方分享外掛；分享連結帶 `openExternalBrowser=1`，從 LINE 點開會改用手機預設瀏覽器。
- 中繼伺服器（TURN）：PeerJS 內建與常見的公用 TURN 目前都沒有回應，所以兩台裝置無法直連時（例如手機 4G 對家裡 Wi-Fi、路由器不支援回流）會連線逾時。可在 GitHub repo 的 Variables 設定其中一種：
  - `TURN_ENDPOINT`：回傳 ICE 伺服器清單的網址（例如 Metered 的 `https://<app>.metered.live/api/v1/turn/credentials?apiKey=<key>`，或自己的 Cloudflare Worker）。
  - `TURN_URLS`、`TURN_USER`、`TURN_CRED`：固定的 TURN 帳號。
  - 沒設定時只用 STUN（Google、Cloudflare），連線逾時會分成「連不上配對伺服器」與「找不到兩台裝置之間的連線路徑」兩種提示。
- 雙方各自跑同一個決定性引擎，只交換每幀 1 byte 的輸入（輸入延遲 1～3 幀＋rollback），每 30 幀對帳一次 hash。

## 分享與挑戰連結

- 一打開按「▶ 開始」就直接和電腦打；第一場是入門電腦的 5 分短賽，場上會依序提示操作。
- 賽後的戰績卡寫著「我用石虎 7:3 打爆台灣黑熊 🏐」與「挑戰我」，可用 LINE 傳給朋友、分享圖片或複製連結。
- 挑戰連結格式：`?vs=<對手角色>&as=<自己角色>&scene=<場景>&score=<自己>-<對手>&lv=<難度>&to=<幾分勝>`。朋友點開就是同一組對戰，分差比分享者大就算贏。匯入的角色不會產生挑戰連結（朋友那邊沒有）。
- 本機跑 E2E 時，如果 Windows 保留了 5199 連接埠，可改用其他連接埠：`E2E_PORT=5420 npm run test:e2e`。

## 玩法與進度

- **第一次玩**：前 3 場開打前顯示 3 秒按鍵說明並倒數；前 5 場觸控按鈕上有「跳」「擊球」文字；新玩家預設入門難度。選邊（左／右）收在設定頁。
- **手機**：直式時按下任何遊戲模式會先要求轉成橫向；比賽中轉回直式會暫停，轉好後倒數 3、2、1 再繼續。
- **每日挑戰**：用日期當亂數種子，每天固定角色、對手、場景、難度與特殊規則（颱風強風、停電之夜、西瓜球、珍奶球）。打完可分享 `🏐 台灣金排球 #42 🟩🟩🟥🟩🟩 7:3`，連結 `?daily=日期` 點開直接進今天那關。連續天數漏一天可用「補簽」。
- **環島巡迴賽**：台北 7 站 → 武陵 → 合歡山 → 日月潭 → 墾丁 → 金門，共 12 站，畫面上有臺灣地圖，各站有站長動物，贏了蓋章，集滿可分享環島證書並解鎖隱藏角色臺灣雲豹，之後開放困難的二刷環島。
- **主場加成**：動物在自己的棲地場景（例如水獺在金門、櫻花鉤吻鮭在武陵）速度 +1。
- **角色特效**：每隻動物在扣殺、接球、跳躍、魚躍、得分時有自己的特效（例如黑熊的爪痕、梅花鹿的梅花瓣、水獺的水花、五色鳥的五色彩帶、熊鷹俯衝的閃光），扣殺時畫面閃光、震動、鏡頭推近；不顯示狀聲詞文字。設定頁可改成「簡潔」（粒子減半、不閃光不震動）。程式在 `src/render/fx.ts`。
- **精彩重播**：本機比賽會記下每一幀的輸入（引擎是決定性的，可以完整重演）。結算畫面按「🎬 精彩重播」會挑一球最精彩的（自己扣殺得分優先），重播得分前 4 秒、得分瞬間慢動作，同時用瀏覽器內建的 MediaRecorder 錄成影片（支援時錄 MP4，否則 WebM），可以分享或下載。線上對戰與練習模式不錄。程式在 `src/replay/`。
- **動物圖鑑**：學名、臺灣特有、保育類、臺灣紅皮書、IUCN、CITES、主場、冷知識，資料出處為 TaiCOL（CC BY 4.0）。每張卡片有「支持牠的保育」按鈕，連到相關保育團體自己的捐款頁（遊戲不經手任何款項；連結清單在 `src/data/dex.ts` 的 `SUPPORT`）。
- **成就與任務**：10 個成就、每日 3 個小任務（把玩家帶到還沒玩過的角色與場景），獎勵是頭上的造型（帽子、墨鏡、花圈等，只有外觀）。進度存在本機，可在設定頁「進度備份」匯出／匯入進度碼。

## 請作者喝杯咖啡（選用）

設定頁、主選單下方、打完 5 場後的結算畫面與環島證書會出現小小的「☕ 請作者喝杯咖啡」，先說明這是支持作者（不是保育捐款），再開綠界「實況主收款」的贊助頁。在 GitHub repo 的 Variables 設定 `TIP_URL`（例如 `https://p.ecpay.com.tw/xxxxxx`）後重新部署就會出現；沒設定就不顯示。

## 成效追蹤（選用）

程式內建輕量追蹤（不用 cookie、不送個人資料），漏斗事件：`visit`（含距第一次來訪的天數，用來算 D1／D7）→ `match_start` → `match_end`（含比分）→ `rematch` → `share`，另有 `tutorial_done`、`achievement`、`unlock`。預設關閉；在 GitHub repo 的 **Settings → Secrets and variables → Actions → Variables** 設定其中一個即可開啟：

- `PLAUSIBLE_DOMAIN`：Plausible 的網域（例如 `jamesleecy.github.io`）
- `GOATCOUNTER`：GoatCounter 的代號（`<代號>.goatcounter.com`）

## 新增角色包

1. 在 `public/characters/<id>/` 放入：
   - `manifest.json`（格式見下方或現有角色）
   - `sprite.png`：每格 64×64、**面向右**繪製；列＝動畫，欄＝影格
   - `portrait.png`（選用）
2. 把 `<id>` 加進 `public/characters/index.json`。

```json
{
  "id": "myhero",
  "name": { "zh-TW": "我的角色", "en": "My Hero" },
  "sprite": "sprite.png",
  "frameSize": [64, 64],
  "animations": {
    "idle":  { "row": 0, "frames": 5, "fps": 8 },
    "run":   { "row": 0, "frames": 5, "fps": 12 },
    "jump":  { "row": 1, "frames": 5, "fps": 10 },
    "spike": { "row": 2, "frames": 5, "fps": 15 },
    "dive":  { "row": 3, "frames": 3, "fps": 10 },
    "win":   { "row": 4, "frames": 5, "fps": 6 },
    "lose":  { "row": 5, "frames": 5, "fps": 6 },
    "bump":  { "row": 7, "frames": 5, "fps": 20 },
    "cheer": { "row": 8, "frames": 5, "fps": 10 },
    "oops":  { "row": 9, "frames": 5, "fps": 8 }
  },
  "stats": { "speed": 0, "jump": 0, "power": 0 },
  "portrait": "portrait.png",
  "themeColor": "#F5C542"
}
```

- `stats` 每項 −2～+2（各 ±5%），平衡模式開啟時忽略。
- 碰撞箱固定 64×64，外觀不影響物理。
- `bump`（接球）、`cheer`（得分）、`oops`（失分）為選用的反應動畫，沒有就不播
- manifest 用 zod 驗證；缺少的動畫退回 `idle`，圖片載入失敗時以純色佔位圖顯示，不會當機。
- 使用他人的角色圖前，請自行確認授權。

內建 13 位原創角色（雲雲／雲朵精靈，以及台灣動物：橘子／貓、金金／黃金獵犬、滑滑／白面鼯鼠、藍藍／台灣藍鵲、月月／台灣黑熊、帝帝／帝雉、鷹鷹／熊鷹、梅梅／梅花鹿、琵琵／黑面琵鷺、猴猴／台灣獼猴、石石／石虎、彩彩／五色鳥）由 `npm run gen:assets` 重新產生；精靈圖每格 128×128，繪製時縮放到 64×64 的碰撞箱。

## 專案結構

```
src/
  engine/      決定性純邏輯：物理、規則、AI、PRNG（整數運算、不碰 DOM）
  render/      Canvas 繪圖、內插、特效
  input/       鍵盤、觸控、手把 → InputFrame
  net/         PeerJS 傳輸、rollback、線上協定
  characters/  角色包載入與驗證、.zip 匯入（IndexedDB）
  audio/       Web Audio 合成音效與背景音樂
  ui/          設定、DOM 工具
  i18n/        繁體中文、英文
scripts/       原創像素素材產生器
tests/         Vitest 單元測試
e2e/           Playwright E2E（本機 PeerJS 信令伺服器、模擬延遲／丟包）
```
