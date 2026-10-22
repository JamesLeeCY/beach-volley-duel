// Cloudflare Worker：替遊戲產生短期的 TURN 中繼憑證。
// 長期的 TURN 金鑰（TURN_KEY_ID、TURN_KEY_API_TOKEN）只存在 Worker 的 secret 裡，不會出現在網頁程式碼。
// 遊戲在建立連線前 GET 這個網址，拿到 { iceServers: [...] }。
// 只接受遊戲網址（ALLOWED_ORIGINS）來的請求，避免被別人拿去用。

const TTL = 4 * 60 * 60; // 憑證有效 4 小時（一場線上對戰綽綽有餘）

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!allowed.includes(origin)) return new Response('forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'GET') return new Response('method not allowed', { status: 405, headers: cors(origin) });

    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TTL }),
      },
    );
    if (!res.ok) return new Response('turn unavailable', { status: 502, headers: cors(origin) });
    const data = await res.json();
    // 瀏覽器會擋 53 埠，留著只會讓連線多等一個逾時
    const iceServers = (data.iceServers ?? []).map((s) => ({
      ...s,
      urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)),
    }));
    return new Response(JSON.stringify({ iceServers }), {
      headers: { ...cors(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  },
};
