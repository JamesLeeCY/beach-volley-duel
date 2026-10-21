// 動物圖鑑：棲地分排（選角 4×4 也照這個排）、主場、冷知識、隱藏角色的解鎖條件。
// 保育等級來自 conservation.json（npm run fetch:taicol 從 TaiCOL 取得，CC BY 4.0）。
// 冷知識取自整理好的建議稿；有數字的條目標註年份，上線前建議再對照林業保育署的物種介紹確認。
import type { Lang } from '../i18n';
import type { SceneId } from '../render/scenery';
import data from './conservation.json';

export type Habitat = 'forest' | 'night' | 'sky' | 'water';

/** 4 排 × 4 隻；每排是一種棲地 */
export const HABITAT_ROWS: { id: Habitat; ids: string[] }[] = [
  { id: 'forest', ids: ['yueyue', 'shishi', 'meimei', 'hoho'] },
  { id: 'night', ids: ['glidey', 'jiajia', 'tata', 'baobao'] },
  { id: 'sky', ids: ['mikado', 'lanlan', 'caicai', 'ying'] },
  { id: 'water', ids: ['pipi', 'wawa', 'sakura', 'guigui'] },
];

export const HIDDEN_CHARACTER = 'baobao';

type Text = Record<Lang, string>;

export interface DexEntry {
  /** 主場：在這些場景比賽時有小加成（選野外棲地，不用動物園） */
  home: SceneId[];
  trivia: Text[];
}

const T = (zh: string, en: string): Text => ({ 'zh-TW': zh, en });

export const DEX: Record<string, DexEntry> = {
  yueyue: {
    home: ['wuling'],
    trivia: [
      T('胸前的白色 V 字斑紋是招牌特徵，每隻熊的形狀都不太一樣。', 'The white V on its chest is its trademark, and every bear\'s V is a little different.'),
      T('臺灣唯一的原生熊類，也是臺灣最大的陸域哺乳動物。', 'Taiwan\'s only native bear and its largest land mammal.'),
      T('秋天會大量吃青剛櫟的橡實，為冬天儲存脂肪。', 'In autumn it feasts on oak acorns to store fat for winter.'),
    ],
  },
  shishi: {
    home: ['yangming'],
    trivia: [
      T('臺灣雲豹被認定滅絕後，石虎成了臺灣唯一現存的原生貓科動物。', 'Since the clouded leopard was declared gone, the leopard cat is Taiwan\'s only surviving native wild cat.'),
      T('額頭有兩條白色縱紋，耳朵背面有白色斑點，是辨認重點。', 'Look for two white stripes on its forehead and white spots on the backs of its ears.'),
      T('最大威脅之一是路殺，在石虎出沒的路段要放慢車速。', 'Road kills are one of its biggest threats, so slow down where leopard cats live.'),
    ],
  },
  meimei: {
    home: ['yangming'],
    trivia: [
      T('曾經在野外絕跡，墾丁從 1980 年代開始復育，才讓牠們重回山林。', 'Once gone from the wild, it returned thanks to a reintroduction program in Kenting starting in the 1980s.'),
      T('夏天身上的白色斑點最明顯，冬天會變淡。', 'Its white spots are brightest in summer and fade in winter.'),
      T('公鹿的角每年都會脫落，再重新長出來。', 'Stags shed their antlers every year and grow new ones.'),
    ],
  },
  hoho: {
    home: ['yangming'],
    trivia: [
      T('臺灣唯一的原生猴類。', 'Taiwan\'s only native monkey.'),
      T('臉頰內側有頰囊，可以先把食物塞進去，晚點再慢慢吃。', 'It has cheek pouches to stash food and eat it later.'),
      T('族群恢復得很好，2019 年從保育類名單中移除。但餵食仍然違法，也會讓牠們變得愛搶食物。', 'Its numbers recovered and it left the protected list in 2019. Feeding it is still illegal and teaches it to snatch food.'),
    ],
  },
  glidey: {
    home: ['comet'],
    trivia: [
      T('前肢到後肢之間有一大片飛膜，一次可以滑翔超過 50 公尺。', 'A big membrane between its legs lets it glide more than 50 m in one go.'),
      T('夜行性，白天躲在樹洞裡睡覺，日落後才出來吃嫩葉、嫩芽和果實。', 'Nocturnal: it sleeps in tree holes by day and eats leaves, buds and fruit after sunset.'),
      T('尾巴比身體還長，滑翔時用來平衡和轉向。', 'Its tail is longer than its body and steers it while gliding.'),
    ],
  },
  jiajia: {
    home: ['yangming'],
    trivia: [
      T('遇到危險會捲成一顆球，鱗片和人的指甲一樣是角蛋白構成的。', 'When threatened it rolls into a ball. Its scales are keratin, like your fingernails.'),
    ],
  },
  tata: {
    home: ['kinmen'],
    trivia: [
      T('臺灣本島的野外族群幾乎消失，現在主要剩金門還有。', 'Almost gone from Taiwan\'s main island, it now lives mainly on Kinmen.'),
    ],
  },
  baobao: {
    home: ['wuling'],
    trivia: [
      T('研究團隊在山區長期架設自動相機，一隻都沒拍到，因此被認定在臺灣已經消失。', 'Years of camera traps in the mountains never caught one, so it is considered gone from Taiwan.'),
      T('你在遊戲裡見到了牠，但野外已經找不到了。', 'You met it in the game, but it can no longer be found in the wild.'),
    ],
  },
  mikado: {
    home: ['wuling'],
    trivia: [
      T('現行千元鈔票的背面，就印著帝雉和玉山。', 'The back of the NT$1000 bill shows the Mikado pheasant and Yushan.'),
      T('英文名 Mikado 是日文「天皇」的意思。這個物種最早是靠獵人頭飾上的兩根尾羽才被命名。', '"Mikado" means emperor in Japanese. The species was first named from two tail feathers on a hunter\'s headdress.'),
    ],
  },
  lanlan: {
    home: ['yangming'],
    trivia: [
      T('2007 年網路票選國鳥時拿下第一名，俗稱「長尾山娘」。', 'It won Taiwan\'s online national bird vote in 2007. Locals call it the "long-tailed mountain lady".'),
      T('會「合作育雛」，前一年出生的哥哥姊姊會留下來幫忙餵弟妹。', 'Older siblings from last year stay to help feed the new chicks.'),
      T('護巢非常兇，太靠近鳥巢可能會被俯衝攻擊。', 'It guards its nest fiercely and may dive at you if you get too close.'),
    ],
  },
  caicai: {
    home: ['ntu'],
    trivia: [
      T('叫聲「郭、郭、郭」很像敲木魚，所以俗稱「花和尚」。', 'Its "kok-kok-kok" call sounds like a temple wood block, earning it the nickname "flower monk".'),
      T('會在枯木上自己啄出樹洞當巢。', 'It carves its own nest hole in dead trees.'),
    ],
  },
  ying: {
    home: ['wuling'],
    trivia: [
      T('臺灣體型最大的日行性猛禽，住在中高海拔的原始森林。', 'Taiwan\'s largest daytime raptor, living in old-growth mountain forests.'),
      T('排灣族和魯凱族相傳，領袖過世後會化為熊鷹守護部落，鷹羽只有領袖能佩戴。', 'Paiwan and Rukai stories say chiefs become hawk-eagles to guard the village; only chiefs may wear its feathers.'),
      T('為了保護熊鷹，屏科大從 2018 年起推動「仿真羽毛」，讓部落改用手繪的仿羽。', 'Since 2018 NPUST has promoted hand-painted replica feathers to protect the real birds.'),
    ],
  },
  pipi: {
    home: ['tamsui'],
    trivia: [
      T('用湯匙狀的嘴在水中左右掃動，碰到魚蝦就立刻夾住。', 'It sweeps its spoon-shaped bill through water and snaps up any fish or shrimp it touches.'),
      T('2026 年全球普查共 7,746 隻，其中 4,719 隻在臺灣度冬，約占 61%，創下新高。', 'The 2026 global census counted 7,746 birds; a record 4,719 (about 61%) wintered in Taiwan.'),
      T('繁殖季頭上會長出冠羽，胸前也會轉為黃色。', 'In breeding season it grows a crest and its chest turns yellow.'),
    ],
  },
  wawa: {
    home: ['lake'],
    trivia: [
      T('名字裡的「諸羅」是嘉義的舊稱，取自牠被發現的地方。', '"Chuluo" is the old name of Chiayi, where it was discovered.'),
    ],
  },
  sakura: {
    home: ['wuling'],
    trivia: [
      T('冰河時期留下的魚，被困在高山溪流裡生存至今。', 'An Ice Age relic, trapped in high mountain streams ever since.'),
    ],
  },
  guigui: {
    home: ['beach'],
    trivia: [
      T('卵的溫度決定性別，越熱越容易孵出母龜。', 'Nest temperature decides the sex: warmer sand hatches more females.'),
      T('澎湖望安是臺灣重要的產卵地。', 'Wang-an in Penghu is an important nesting beach in Taiwan.'),
    ],
  },
};

export interface Conservation {
  scientificName: string;
  commonName: string;
  endemic: boolean;
  protected: string | null;
  redlist: string | null;
  iucn: string | null;
  cites: string | null;
}

export const CONSERVATION = data.species as Record<string, Conservation>;
export const CONSERVATION_SOURCE = { fetched: data.fetched };

/** 臺灣紅皮書代碼 → 中英文 */
const REDLIST: Record<string, Text> = {
  RE: T('區域滅絕', 'Regionally extinct'),
  NCR: T('極危', 'Critically endangered'),
  NEN: T('瀕危', 'Endangered'),
  NVU: T('易危', 'Vulnerable'),
  NNT: T('接近受脅', 'Near threatened'),
  NLC: T('暫無危機', 'Least concern'),
  NDD: T('資料缺乏', 'Data deficient'),
  NA: T('不適用', 'Not applicable'),
};

const PROTECTED: Record<string, Text> = {
  I: T('第一級 瀕臨絕種', 'Class I – endangered'),
  II: T('第二級 珍貴稀有', 'Class II – rare and valuable'),
  III: T('第三級 其他應予保育', 'Class III – other conservation-deserving'),
};

const IUCN: Record<string, Text> = {
  LC: T('無危', 'Least concern'),
  NT: T('近危', 'Near threatened'),
  VU: T('易危', 'Vulnerable'),
  EN: T('瀕危', 'Endangered'),
  CR: T('極危', 'Critically endangered'),
};

export function redlistLabel(code: string | null, lang: Lang) {
  return code ? (REDLIST[code]?.[lang] ?? code) : '–';
}

export function protectedLabel(code: string | null, lang: Lang) {
  return code ? (PROTECTED[code]?.[lang] ?? code) : lang === 'en' ? 'Not protected' : '非保育類';
}

export function iucnLabel(code: string | null, lang: Lang) {
  return code ? `${code} ${IUCN[code]?.[lang] ?? ''}`.trim() : '–';
}

export function habitatOf(id: string): Habitat | null {
  return HABITAT_ROWS.find((r) => r.ids.includes(id))?.id ?? null;
}

export function isHome(id: string, scene: SceneId) {
  return DEX[id]?.home.includes(scene) ?? false;
}
