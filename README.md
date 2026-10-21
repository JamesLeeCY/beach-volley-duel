# 台灣金排球 Taiwan Gold Volley

純前端的 2D 排球對戰網頁遊戲：對戰電腦、同機雙人、P2P 線上對戰（房間碼）、練習模式。支援鍵盤、手機觸控、手把，可安裝為 PWA 離線遊玩。

## 操作

| 動作 | 1P | 2P |
| --- | --- | --- |
| 左／右 | A ／ D | ← ／ → |
| 跳 | W | ↑ |
| 下 | S | ↓ |
| 擊球 | T | M |

- 空中按擊球＝扣殺：無方向平射、上＝高吊、下＝重扣、前／後＝斜射
- 地上按擊球＋左右＝魚躍
- 鍵位可在「設定 → 鍵盤鍵位」重新綁定
- Esc 選單、空白鍵暫停、Enter／空白鍵確認選單；對戰電腦與線上時兩套按鍵都能控制自己
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
- 房間畫面有「LINE 邀請朋友」按鈕，朋友點開連結就直接進房，不用輸入房號。
- 雙方各自跑同一個決定性引擎，只交換每幀 1 byte 的輸入（輸入延遲 1～3 幀＋rollback），每 30 幀對帳一次 hash。

## 分享與挑戰連結

- 一打開按「▶ 開始」就直接和電腦打；第一場是入門電腦的 5 分短賽，場上會依序提示操作。
- 賽後的戰績卡寫著「我用石虎 7:3 打爆台灣黑熊 🏐」與「挑戰我」，可用 LINE 傳給朋友、分享圖片或複製連結。
- 挑戰連結格式：`?vs=<對手角色>&as=<自己角色>&scene=<場景>&score=<自己>-<對手>&lv=<難度>&to=<幾分勝>`。朋友點開就是同一組對戰，分差比分享者大就算贏。匯入的角色不會產生挑戰連結（朋友那邊沒有）。
- 本機跑 E2E 時，如果 Windows 保留了 5199 連接埠，可改用其他連接埠：`E2E_PORT=5420 npm run test:e2e`。

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
