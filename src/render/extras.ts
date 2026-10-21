// 額外的造型與特殊球：
// - 造型（帽子、墨鏡、花圈…）：畫在角色頭上，位置用角色包 manifest 的 heads（每一幀頭頂的座標）。
// - 每日挑戰的特殊球：西瓜、珍珠奶茶。
type G = CanvasRenderingContext2D;

/** 頭部位置：x、頭頂 y、頭的半徑（64 單位座標，角色畫在 64×64 的框裡，原點在框的中心） */
export type Head = [number, number, number];

/**
 * 在角色頭上畫造型。座標已平移到角色中心、面向右（面向左時呼叫端已左右翻轉）。
 * hx、top 為頭頂中心，r 為頭的半徑。
 */
export function paintHat(g: G, kind: string, hx: number, top: number, r: number) {
  g.save();
  g.lineJoin = 'round';
  const ink = 'rgba(30,20,20,0.85)';
  g.lineWidth = 0.9;
  g.strokeStyle = ink;
  const eyeY = top + r * 0.95;
  switch (kind) {
    case 'headband': {
      // 紅色頭帶，後面綁兩條帶子
      g.fillStyle = '#e04040';
      g.beginPath();
      g.ellipse(hx, top + r * 0.45, r * 0.98, r * 0.22, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(hx - r * 0.9, top + r * 0.45);
      g.lineTo(hx - r * 1.5, top + r * 0.2);
      g.lineTo(hx - r * 1.4, top + r * 0.8);
      g.closePath();
      g.fill();
      g.stroke();
      break;
    }
    case 'straw': {
      // 斗笠
      g.fillStyle = '#e2c27a';
      g.beginPath();
      g.moveTo(hx - r * 1.5, top + r * 0.35);
      g.lineTo(hx + r * 0.1, top - r * 0.75);
      g.lineTo(hx + r * 1.6, top + r * 0.35);
      g.closePath();
      g.fill();
      g.stroke();
      g.strokeStyle = 'rgba(140,100,40,0.7)';
      for (let i = -2; i <= 2; i++) {
        g.beginPath();
        g.moveTo(hx + r * 0.1, top - r * 0.7);
        g.lineTo(hx + r * 0.1 + i * r * 0.6, top + r * 0.3);
        g.stroke();
      }
      break;
    }
    case 'sunglasses': {
      g.fillStyle = '#1a1a22';
      for (const dx of [0.25, 0.85]) {
        g.beginPath();
        g.ellipse(hx + r * dx, eyeY, r * 0.3, r * 0.22, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = '#1a1a22';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(hx - r * 0.4, eyeY - r * 0.1);
      g.lineTo(hx + r * 1.1, eyeY - r * 0.1);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.fillRect(hx + r * 0.15, eyeY - r * 0.12, r * 0.12, r * 0.06);
      break;
    }
    case 'goggles': {
      // 泳鏡
      g.strokeStyle = '#2a7ad0';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(hx - r, eyeY);
      g.lineTo(hx + r * 0.1, eyeY);
      g.stroke();
      g.fillStyle = 'rgba(120,200,255,0.55)';
      g.lineWidth = 1.1;
      for (const dx of [0.3, 0.85]) {
        g.beginPath();
        g.ellipse(hx + r * dx, eyeY, r * 0.27, r * 0.24, 0, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
      break;
    }
    case 'cap': {
      // 鴨舌帽（帽簷朝臉的方向）
      g.fillStyle = '#2f7fe0';
      g.beginPath();
      g.arc(hx, top + r * 0.5, r * 0.85, Math.PI, 0);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#1d5fb0';
      g.beginPath();
      g.ellipse(hx + r * 0.95, top + r * 0.48, r * 0.6, r * 0.14, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#ffc531';
      g.beginPath();
      g.arc(hx, top - r * 0.35, r * 0.13, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'flower': {
      // 耳邊的扶桑花
      const fx = hx - r * 0.55, fy = top + r * 0.25;
      g.fillStyle = '#f05a7a';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.beginPath();
        g.ellipse(fx + Math.cos(a) * r * 0.26, fy + Math.sin(a) * r * 0.26, r * 0.22, r * 0.15, a, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#ffd84a';
      g.beginPath();
      g.arc(fx, fy, r * 0.11, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'party': {
      // 派對尖帽
      g.fillStyle = '#9a5ae0';
      g.beginPath();
      g.moveTo(hx - r * 0.5, top + r * 0.2);
      g.lineTo(hx + r * 0.05, top - r * 1.15);
      g.lineTo(hx + r * 0.55, top + r * 0.2);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#ffd84a';
      for (const t of [0.3, 0.65]) g.fillRect(hx - r * 0.45 * (1 - t) - 0.5, top + r * 0.2 - t * r * 1.3, r * 0.9 * (1 - t) + 1, 1);
      g.beginPath();
      g.arc(hx + r * 0.05, top - r * 1.2, r * 0.16, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'cny': {
      // 過年的紅色小帽＋金色毛球
      g.fillStyle = '#d82c2c';
      g.beginPath();
      g.arc(hx, top + r * 0.42, r * 0.8, Math.PI, 0);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#f2c84a';
      g.fillRect(hx - r * 0.85, top + r * 0.32, r * 1.7, r * 0.18);
      g.beginPath();
      g.arc(hx, top - r * 0.42, r * 0.2, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'lei': {
      // 脖子上的花圈
      const ny = top + r * 2.05;
      const colors = ['#f05a7a', '#ffd84a', '#ff8a3a', '#f8f0f0'];
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * (0.05 + (i / 8) * 0.9);
        g.fillStyle = colors[i % colors.length];
        g.beginPath();
        g.arc(hx + Math.cos(a) * r * 0.85, ny + Math.sin(a) * r * 0.32 - r * 0.15, r * 0.17, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'crown':
    case 'goldcrown': {
      const gold = kind === 'goldcrown';
      const w = r * (gold ? 0.75 : 0.6), h = r * (gold ? 0.7 : 0.55);
      g.fillStyle = gold ? '#ffcf3a' : '#e8c060';
      g.beginPath();
      g.moveTo(hx - w, top + r * 0.15);
      g.lineTo(hx - w, top - h);
      g.lineTo(hx - w * 0.5, top - h * 0.45);
      g.lineTo(hx, top - h * 1.05);
      g.lineTo(hx + w * 0.5, top - h * 0.45);
      g.lineTo(hx + w, top - h);
      g.lineTo(hx + w, top + r * 0.15);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = gold ? '#e83a5a' : '#3a8ae0';
      g.beginPath();
      g.arc(hx, top - r * 0.12, r * 0.13, 0, Math.PI * 2);
      g.fill();
      break;
    }
  }
  g.restore();
}

/** 西瓜球：綠色條紋的外皮，一小塊切面露出紅色果肉和黑籽 */
export function paintMelon(g: G, R: number, angle: number) {
  g.save();
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.fillStyle = '#4a9a3a';
  g.fill();
  g.clip();
  g.rotate(angle);
  g.strokeStyle = '#1e5a22';
  g.lineWidth = 2;
  for (let i = -3; i <= 3; i++) {
    g.beginPath();
    g.moveTo(i * R * 0.38 - R * 0.1, -R);
    g.bezierCurveTo(i * R * 0.38 + R * 0.2, -R * 0.3, i * R * 0.38 - R * 0.2, R * 0.3, i * R * 0.38 + R * 0.1, R);
    g.stroke();
  }
  g.restore();
  // 切面
  g.save();
  g.rotate(angle);
  g.fillStyle = '#f8f0d8';
  g.beginPath();
  g.moveTo(0, 0);
  g.arc(0, 0, R * 0.95, -0.9, -0.2);
  g.closePath();
  g.fill();
  g.fillStyle = '#e8384a';
  g.beginPath();
  g.moveTo(0, 0);
  g.arc(0, 0, R * 0.82, -0.88, -0.22);
  g.closePath();
  g.fill();
  g.fillStyle = '#1a1414';
  for (const [a, d] of [[-0.6, 0.5], [-0.4, 0.62], [-0.7, 0.68]]) {
    g.beginPath();
    g.ellipse(Math.cos(a) * R * d, Math.sin(a) * R * d, 0.9, 0.6, a, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** 珍珠奶茶球：圓圓的杯子、奶茶色、底部的黑珍珠、粗吸管 */
export function paintBoba(g: G, R: number, angle: number) {
  g.save();
  g.rotate(angle * 0.3);
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.fillStyle = 'rgba(240,248,255,0.95)';
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = '#c8955e';
  g.fillRect(-R, -R * 0.45, R * 2, R * 2);
  g.fillStyle = '#2a1a14';
  for (const [x, y] of [[-0.5, 0.55], [-0.15, 0.7], [0.2, 0.6], [0.5, 0.45], [0, 0.35], [-0.35, 0.3], [0.35, 0.78]]) {
    g.beginPath();
    g.arc(x * R, y * R, R * 0.14, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  // 封膜與吸管
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.fillRect(-R * 0.9, -R * 0.5, R * 1.8, R * 0.1);
  g.strokeStyle = '#e8384a';
  g.lineWidth = R * 0.22;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(R * 0.15, R * 0.4);
  g.lineTo(R * 0.45, -R * 1.25);
  g.stroke();
  g.restore();
}
