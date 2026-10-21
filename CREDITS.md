# CREDITS

本專案的所有程式碼、圖像與聲音皆為原創，未使用任何第三方遊戲素材。

| 資產 | 來源 |
| --- | --- |
| 角色精靈圖（16 種臺灣動物，吉卜力式手繪上色，128×128；造型配件以 Canvas 即時繪製） | `scripts/gen-assets.mjs` 以程式逐像素繪製（原創角色，未參考任何既有角色造型） |
| PWA 圖示 | 同上 |
| 場景（夏日海灘、黃昏湖畔、彗星之夜、信義夜景、木柵動物園、台大椰林大道、松菸大巨蛋、圓山花博、陽明山溫泉、淡水夕陽、金門古厝、武陵溪谷；景點皆為原創繪製、未使用官方標誌：天空、積雲、光束、鏡頭光斑、星空、彗星、流星、山稜、湖面倒影、沙灘、網子、排球配色） | `src/render/scenery.ts`、`src/render/cityzoo.ts`、`src/render/landmarks.ts`、`src/render/islands.ts`、`src/render/renderer.ts` 以 Canvas 2D 即時繪製 |
| 音效與背景音樂 | `src/audio/audio.ts` 以 Web Audio API 即時合成 |

## 資料

- 動物的保育等級（臺灣特有、保育類、臺灣紅皮書、IUCN、CITES）與學名：[TaiCOL 臺灣物種名錄](https://taicol.tw)，CC BY 4.0。以 `npm run fetch:taicol` 用學名查詢 API，存成 `src/data/conservation.json`，遊戲內註明出處與擷取日期。
- 冷知識取自整理稿，並參考：[台灣生命大百科](https://taieol.tw)（白面鼯鼠）、Newtalk 2026-04-17 黑面琵鷺普查報導、屏科大熊鷹仿真羽毛相關報導。

## 參考（僅參考遊戲行為，未複製任何程式碼或素材）

- 1997 年「対戦ぴかちゅ～ビーチバレー編」的操作手感
- [gorisanson/pikachu-volleyball](https://github.com/gorisanson/pikachu-volleyball) 網頁版的選單選項與操作方式
- [gorisanson/pikachu-volleyball-p2p-online](https://github.com/gorisanson/pikachu-volleyball-p2p-online) README 中「共用亂數種子、只傳輸入」的連線概念

## 開源套件

- [PeerJS](https://peerjs.com/)（MIT）— WebRTC 連線與公用信令伺服器
- [zod](https://zod.dev/)（MIT）— 角色包 manifest 驗證
- [Vite](https://vite.dev/)、[vite-plugin-pwa](https://vite-pwa-org.netlify.app/)、[Vitest](https://vitest.dev/)、TypeScript（MIT / Apache-2.0）
