// 從 TaiCOL 臺灣物種名錄 API 取得 16 種角色的保育資料，存成 src/data/conservation.json。
// 遊戲執行時不連外：資料跟著網站一起部署。資料授權 CC BY 4.0，畫面上需註明出處。
// 一定要用學名查詢（用中文俗名會查到同名的其他物種）。
//   npm run fetch:taicol
import { writeFileSync } from 'node:fs';

const SPECIES = {
  yueyue: 'Ursus thibetanus formosanus',
  shishi: 'Prionailurus bengalensis chinensis',
  meimei: 'Cervus nippon taiouanus',
  hoho: 'Macaca cyclopis',
  glidey: 'Petaurista lena',
  jiajia: 'Manis pentadactyla pentadactyla',
  tata: 'Lutra lutra',
  baobao: 'Neofelis nebulosa brachyura',
  mikado: 'Syrmaticus mikado',
  lanlan: 'Urocissa caerulea',
  caicai: 'Psilopogon nuchalis',
  ying: 'Nisaetus nipalensis',
  pipi: 'Platalea minor',
  wawa: 'Rhacophorus arvalis',
  sakura: 'Oncorhynchus formosanus',
  guigui: 'Chelonia mydas',
};

const today = new Date().toISOString().slice(0, 10);
const out = { source: 'TaiCOL 臺灣物種名錄 https://taicol.tw', license: 'CC BY 4.0', fetched: today, species: {} };

for (const [id, name] of Object.entries(SPECIES)) {
  const url = `https://api.taicol.tw/v2/taxon?scientific_name=${encodeURIComponent(name)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
  const json = await res.json();
  const list = json.data ?? [];
  // 優先取有效名（accepted）；學名改過時，舊學名會出現在 synonyms
  const d = list.find((x) => x.taxon_status === 'accepted') ?? list[0];
  if (!d) throw new Error(`${id}: 查無 ${name}`);
  out.species[id] = {
    query: name,
    taxonId: d.taxon_id,
    scientificName: d.simple_name,
    commonName: d.common_name_c,
    endemic: !!d.is_endemic,
    protected: d.protected ?? null,
    redlist: d.redlist ?? null,
    iucn: d.iucn ?? null,
    cites: d.cites ?? null,
  };
  console.log(id.padEnd(8), d.simple_name.padEnd(36), d.common_name_c, d.protected, d.redlist, d.iucn, d.cites);
}

writeFileSync(new URL('../src/data/conservation.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
