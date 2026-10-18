# CREDITS

本專案的所有程式碼、圖像與聲音皆為原創，未使用任何第三方遊戲素材。

| 資產 | 來源 |
| --- | --- |
| 角色精靈圖（桃桃 momo、雲雲 yunyun、小葉 kit） | `scripts/gen-assets.mjs` 以程式逐像素繪製 |
| PWA 圖示 | 同上 |
| 場景（天空、雲、海浪、沙灘、網子、球） | `src/render/renderer.ts` 以 Canvas 2D 即時繪製 |
| 音效與背景音樂 | `src/audio/audio.ts` 以 Web Audio API 即時合成 |

## 參考（僅參考遊戲行為，未複製任何程式碼或素材）

- 1997 年「対戦ぴかちゅ～ビーチバレー編」的操作手感
- [gorisanson/pikachu-volleyball](https://github.com/gorisanson/pikachu-volleyball) 網頁版的選單選項與操作方式
- [gorisanson/pikachu-volleyball-p2p-online](https://github.com/gorisanson/pikachu-volleyball-p2p-online) README 中「共用亂數種子、只傳輸入」的連線概念

## 開源套件

- [PeerJS](https://peerjs.com/)（MIT）— WebRTC 連線與公用信令伺服器
- [zod](https://zod.dev/)（MIT）— 角色包 manifest 驗證
- [Vite](https://vite.dev/)、[vite-plugin-pwa](https://vite-pwa-org.netlify.app/)、[Vitest](https://vitest.dev/)、TypeScript（MIT / Apache-2.0）
