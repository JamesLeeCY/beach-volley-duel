// 「請作者喝杯咖啡」：連到綠界「實況主收款」的贊助頁（信用卡、ATM、超商）。
// 網址在建置時設定（GitHub repo 的 Variables → TIP_URL），沒設定就完全不顯示。
// 這是支持作者開發，和圖鑑的「支持牠的保育」（連到保育團體）分開。

const RAW = (import.meta.env.VITE_TIP_URL as string | undefined)?.trim();

/** 只接受 https 網址，避免設定錯誤時連到奇怪的地方 */
export function validTipUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

let url = validTipUrl(RAW);

export function tipUrl(): string | null {
  return url;
}

/** 測試與本機預覽用：不重新建置就換掉贊助網址 */
export function setTipUrl(raw: string | null) {
  url = validTipUrl(raw);
}

/** 結算畫面打完幾場之後才出現，不打擾新玩家 */
export const TIP_AFTER_MATCHES = 5;
