import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { FPS_BY_SPEED } from './engine/constants';
import { createState, defaultConfig, step } from './engine/physics';
import { AiController, type Difficulty } from './engine/ai';
import { IN_LEFT, IN_RIGHT, Phase, type GameEvent, type GameState, type InputFrame, type MatchConfig } from './engine/types';
import { BALL_SKINS, Renderer, paintBall, type BallSkin } from './render/renderer';
import { sceneThumb } from './render/thumbs';
import { SCENES, type SceneId } from './render/scenery';
import { audio } from './audio/audio';
import type { MusicId } from './audio/music';
import { TUTORIAL_STEPS, Tutorial, type TutorialStep } from './ui/tutorial';
import { Coach } from './ui/coach';
import { beats, dareUrl, headline, lineShareUrl, parseDare, stripLinkParams, type Dare } from './ui/dare';
import type { ShareInfo } from './ui/sharecard';
import { clearErrors, errorEntries, installErrorLog, issueUrl, recordError } from './ui/errorlog';
import { STAGE_COUNT, STAGE_DIFFS, STAGE_SCENES, STAGE_TARGET, buildStages, loadBest, saveBest } from './ui/challenge';
import {
  applyKeymaps, canBind, cloneKeymap, DEFAULT_KEYMAP_1P, DEFAULT_KEYMAP_2P, Keyboard, KEY_ACTIONS, KEYMAP_1P, KEYMAP_2P,
  keyLabel, keymapSide, menuAction, rebind, type KeyAction, type KeyMap,
} from './input/keyboard';
import { DEFAULT_PAD_MAP, DPAD_BUTTONS, applyPadMap, padButtonLabel, pressedButtons, readGamepad } from './input/gamepad';
import { TouchControls, isTouchDevice } from './input/touch';
import {
  allCharacters, displayName, getCharacter, hasCharacter, loadCharacters, statsOf, DEFAULT_CHARACTER, type CharacterPack,
} from './characters/registry';
import { deleteLocalPack, importPackZip, loadLocalPacks } from './characters/localPacks';
import { getLang, setLang, t, type Lang, type MsgKey } from './i18n';
import { loadSettings, saveSettings, type Settings } from './ui/settings';
import { button, cardPicker, h, moveFocus, segmented } from './ui/dom';
// 線上模組（含 PeerJS）在進入線上對戰時才載入
import type { OnlineMatch, StartInfo } from './net/online';
import { normalizeCode } from './net/code';

type Mode = 'demo' | 'cpu' | 'local' | 'practice' | 'online';

/** 每個場景的背景音樂曲風 */
const SCENE_MUSIC: Record<SceneId, MusicId> = {
  beach: 'bright', zoo: 'bright', expo: 'bright', ntu: 'bright',
  lake: 'dusk', tamsui: 'dusk', songshan: 'dusk',
  comet: 'night', taipei: 'night',
  yangming: 'mountain',
};

/** 選角操作：左右切換、確認，或直接點選第幾個角色 */
type CharAction = 'left' | 'right' | 'ok' | number;

interface CharSlot {
  idx: number;
  ready: boolean;
  /** 由誰控制：'human' | 'cpu' | 'remote' */
  ctrl: 'human' | 'cpu' | 'remote';
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

class App {
  settings: Settings = loadSettings();
  keyboard = new Keyboard();
  renderer = new Renderer($('#game'));
  touch = new TouchControls($('#app'));
  /** 平板同機雙人時 2P 的觸控按鍵 */
  touch2 = new TouchControls($('#app'));
  overlay = $<HTMLDivElement>('#overlay');
  hud = $<HTMLDivElement>('#hud');
  toastEl = $<HTMLDivElement>('#toast');

  mode: Mode = 'demo';
  cfg: MatchConfig = defaultConfig({ targetScore: 99 });
  state: GameState = createState(1);
  prev: GameState = this.state;
  ais: [AiController | null, AiController | null] = [null, null];
  chars: [string, string] = ['goldie', 'kiki'];
  humanSide: 0 | 1 = 0;
  difficulty: Difficulty = 'normal';
  paused = false;
  running = true;
  resultShown = false;
  acc = 0;
  last = performance.now();
  screenName = '';
  online: OnlineMatch | null = null;
  onlineStarted = false;
  /** 設定頁等待新按鍵時的處理函式（會吃掉下一個按鍵） */
  private keyCapture: ((code: string) => void) | null = null;
  private menuKeyHandler: ((a: 'left' | 'right' | 'up' | 'down' | 'ok', side: 0 | 1 | null) => void) | null = null;
  private backHandler: (() => void) | null = null;
  private padPrev = [0, 0];
  scene: SceneId = 'beach';
  tutorial: Tutorial | null = null;
  private tutorialEl: HTMLDivElement | null = null;
  challenge: { player: string; stages: string[]; idx: number } | null = null;
  ball: BallSkin = 'classic';
  /** 從挑戰連結開始的比賽：要打贏的比分 */
  dare: Dare | null = null;
  /** 第一場比賽的場上提示 */
  coach: Coach | null = null;
  private coachEl: HTMLDivElement | null = null;
  private touchSeen = false;
  private needRefresh: ((reload?: boolean) => Promise<void>) | null = null;

  async init() {
    installErrorLog();
    setLang(this.settings.lang);
    this.applySettings();
    await loadCharacters();
    await loadLocalPacks();
    // 拖放檔案只在設定頁處理；其他地方不要讓瀏覽器開啟檔案而離開遊戲
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());
    this.startDemo();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('fullscreenchange', () => this.resize());
    this.resize();
    this.keyboard.onPress((code, e) => this.onKey(code, e));
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', (e) => {
      unlock();
      if (e.pointerType === 'touch') {
        if (!this.touchSeen) {
          this.touchSeen = true;
          this.resize();
        }
        if (document.body.classList.contains('in-match')) this.touch.setVisible(true);
        // 手機一碰畫面就進入全螢幕（需要使用者手勢）
        this.enterFullscreen();
      }
    });
    window.addEventListener('keydown', unlock);
    window.addEventListener('pagehide', () => this.online?.close());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.isLocalMatch() && !this.paused) this.showPause();
    });

    // 邀請連結（?room=房號）直接進房；挑戰連結（?vs=…）直接進挑戰畫面
    const params = new URLSearchParams(location.search);
    const room = params.get('room');
    const code = room ? normalizeCode(room) : null;
    const dare = parseDare(location.search, {
      char: (id) => hasCharacter(id) && !getCharacter(id).local,
      scenes: SCENES,
    });
    if (params.has('vs')) history.replaceState(null, '', stripLinkParams(location.href));
    if (code) this.showOnlineJoin(code, true);
    else if (dare) this.showDare(dare);
    else {
      this.showTitle();
      if (params.has('vs')) this.toast(t('dareInvalid'), [], 4000);
    }

    this.setupPwa();
    this.maybeIosHint();
    requestAnimationFrame((t0) => this.frame(t0));
  }

  /** iPhone Safari 沒有全螢幕 API：提示加到主畫面（以 App 開啟即為全螢幕） */
  private maybeIosHint() {
    const ios = /iPhone|iPod/.test(navigator.userAgent);
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
    if (ios && !standalone) setTimeout(() => this.toast(t('iosHint'), [], 6000), 1500);
  }

  private setupPwa() {
    try {
      this.needRefresh = registerSW({
        onNeedRefresh: () => this.offerUpdate(),
        onOfflineReady: () => this.toast(t('offlineReady')),
      });
    } catch {
      // 開發模式或不支援
    }
  }

  private offerUpdate() {
    // 比賽中不打斷，等回到選單
    if (this.mode !== 'demo') {
      setTimeout(() => this.offerUpdate(), 5000);
      return;
    }
    this.toast(t('updateReady'), [
      [t('update'), () => this.needRefresh?.(true)],
      [t('later'), () => this.hideToast()],
    ], 0);
  }

  applySettings() {
    const s = this.settings;
    setLang(s.lang);
    applyKeymaps(s.keys[0], s.keys[1]);
    $('#game').classList.toggle('smooth', s.graphics === 'smooth');
    audio.configure(s.sfx, s.bgm);
    this.touch.apply(s);
    this.touch2.apply({ ...s, touchSwap: false });
    applyPadMap(s.padMap);
    for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n as MsgKey);
    document.title = t('title');
  }

  resize() {
    const r = $('#stage').getBoundingClientRect();
    this.renderer.resize(r.width, r.height, isTouchDevice());
  }

  // ---------------------------------------------------------------- loop
  /** 每個畫面幀：先排下一幀，再更新與繪圖；任何一幀出錯都只跳過那一幀，遊戲不會停住 */
  private frame(now: number) {
    requestAnimationFrame((t1) => this.frame(t1));
    const t0 = performance.now();
    try {
      this.frameBody(now);
    } catch (err) {
      this.frameErrors++;
      recordError('frame', err);
      // 繪圖到一半出錯時，畫布可能停在 save() 之後的狀態：重設畫布
      this.renderer.recover();
      // 同樣的錯誤只記錄前幾次，避免洗版
      if (this.frameErrors <= 3) console.error('[frame] 已略過出錯的一幀', err);
    }
    this.updatePerf(now, performance.now() - t0, this.lastTicks);
  }

  private frameErrors = 0;
  private lastTicks = 0;

  // ---------------------------------------------------------------- 效能顯示
  private perfEl: HTMLDivElement | null = null;
  private perf = { frames: 0, ticks: 0, work: 0, worst: 0, since: 0 };

  /** 每 0.5 秒更新一次：畫面 FPS、平均／最差每幀耗時、邏輯幀率、解析度 */
  private updatePerf(now: number, workMs: number, ticks: number) {
    if (!this.settings.showFps) {
      if (this.perfEl) this.perfEl.style.display = 'none';
      return;
    }
    if (!this.perfEl) {
      this.perfEl = h('div', { class: 'perf' });
      $('#app').append(this.perfEl);
    }
    this.perfEl.style.display = '';
    const p = this.perf;
    if (!p.since) p.since = now;
    p.frames++;
    p.ticks += ticks;
    p.work += workMs;
    p.worst = Math.max(p.worst, workMs);
    const span = now - p.since;
    if (span < 500) return;
    const fps = (p.frames * 1000) / span;
    const tps = (p.ticks * 1000) / span;
    const c = this.renderer.canvas;
    this.perfEl.textContent =
      `${fps.toFixed(0)} FPS · ${(p.work / p.frames).toFixed(1)} ms (max ${p.worst.toFixed(1)}) · ` +
      `${tps.toFixed(0)} tick/s · ${c.width}×${c.height}`;
    this.perfEl.classList.toggle('bad', fps < 50 || p.worst > 12);
    this.perf = { frames: 0, ticks: 0, work: 0, worst: 0, since: now };
  }

  private frameBody(now: number) {
    const dt = Math.min(250, now - this.last);
    this.last = now;
    this.pollGamepadMenu();
    const fps = this.mode === 'online' && this.online?.info ? FPS_BY_SPEED[this.online.info.rules.speed] : FPS_BY_SPEED[this.settings.speed];
    const stepMs = 1000 / fps;
    if (!this.paused) this.acc += dt;
    let steps = 0;
    while (this.acc >= stepMs && steps < 8) {
      this.acc -= stepMs;
      this.tick();
      steps++;
    }
    if (steps >= 8) this.acc = 0;
    this.lastTicks = steps;
    const view = {
      mirror: this.mode === 'online' && this.online?.localSide === 1 && this.settings.selfLeft,
      chars: [getCharacter(this.chars[0]), getCharacter(this.chars[1])] as [CharacterPack, CharacterPack],
      hueShift2: this.chars[0] === this.chars[1],
      smooth: this.settings.graphics === 'smooth',
      scene: this.scene,
      ball: this.ball,
    };
    this.renderer.draw(this.prev, this.state, this.paused ? 1 : this.acc / stepMs, view, now);
  }

  private humanInput(): InputFrame {
    return (
      this.keyboard.read(KEYMAP_1P) | this.keyboard.read(KEYMAP_2P) | this.touch.read() | readGamepad(0) | readGamepad(1)
    );
  }

  private tick() {
    if (this.mode === 'online') {
      this.tickOnline();
      return;
    }
    if (!this.running) return;
    let in1 = 0;
    let in2 = 0;
    if (this.mode === 'local') {
      in1 = this.keyboard.read(KEYMAP_1P) | readGamepad(0) | this.touch.read();
      in2 = this.keyboard.read(KEYMAP_2P) | readGamepad(1) | this.touch2.read();
    } else if (this.mode === 'cpu' || this.mode === 'practice') {
      const human = this.humanInput();
      if (this.humanSide === 0) in1 = human;
      else in2 = human;
    }
    if (this.ais[0]) in1 = this.ais[0].decide(this.state);
    if (this.ais[1]) in2 = this.ais[1].decide(this.state);
    this.prev = this.state;
    this.state = step(this.state, in1, in2, this.cfg);
    this.handleEvents(this.state.events, false);
    if (this.tutorial && this.tutorial.update(this.state, this.state.events)) this.onTutorialStep();
    if (this.coach) {
      const r = this.coach.update(this.state, this.state.events);
      if (r) this.renderCoach(r === 'done');
    }
    if (this.state.phase === Phase.Over && this.state.phaseTimer === 0 && !this.resultShown) {
      if (this.mode === 'demo') this.startDemo();
      else this.showResult(this.state.winner);
    }
  }

  private tickOnline() {
    const o = this.online;
    if (!o || !o.session || !this.onlineStarted || o.ended) return;
    // 推進不了（等待對方）時不讀取輸入，快速點擊會保留到真正推進的那一幀
    let input = o.session.canAdvance() ? this.humanInput() : 0;
    // 鏡像顯示時左右對調，讓「往左」在畫面上就是往左
    if (o.localSide === 1 && this.settings.selfLeft) {
      const l = input & IN_LEFT;
      const r = input & IN_RIGHT;
      input = (input & ~(IN_LEFT | IN_RIGHT)) | (l ? IN_RIGHT : 0) | (r ? IN_LEFT : 0);
    }
    const before = o.session.state;
    if (o.tick(input)) this.prev = before;
    this.state = o.session.state;
    this.updateOnlineHud();
    if (this.state.phase === Phase.Over && this.state.phaseTimer === 0 && !this.resultShown) {
      this.showResult(this.state.winner);
    }
  }

  private handleEvents(events: GameEvent[], mirrorOverride: boolean) {
    const mirror = mirrorOverride;
    this.renderer.spawnEffects(events, mirror);
    if (this.mode === 'demo' && this.screenName !== 'title') return;
    for (const e of events) audio.play(e.type, mirror ? 432 - e.x : e.x);
  }

  // ---------------------------------------------------------------- matches
  /** 依設定決定這一場的場景與排球（隨機時每場重抽） */
  private rollLook() {
    const pick = <T,>(list: readonly T[]) => list[(Math.random() * list.length) | 0];
    const s = this.settings;
    this.scene = s.scene === 'random' ? pick(SCENES) : s.scene;
    this.ball = s.ball === 'random' ? pick(Object.keys(BALL_SKINS) as BallSkin[]) : s.ball;
    audio.setMusic(SCENE_MUSIC[this.scene] ?? 'bright');
  }

  private startDemo() {
    this.mode = 'demo';
    this.rollLook();
    this.cfg = defaultConfig({ targetScore: 99 });
    const seed = (Math.random() * 2 ** 31) | 0;
    this.state = this.prev = createState(seed);
    const all = allCharacters();
    const pick = () => all[(Math.random() * all.length) | 0]?.id ?? DEFAULT_CHARACTER;
    this.chars = [pick(), pick()];
    this.ais = [new AiController(0, 'hard', seed), new AiController(1, 'hard', seed + 1)];
    this.resultShown = false;
    this.paused = false;
    this.running = true;
    this.setInMatch(false);
  }

  private startLocalMatch(mode: 'cpu' | 'local' | 'practice', opts: { target?: number; scene?: SceneId } = {}) {
    this.mode = mode;
    this.rollLook();
    if (opts.scene) {
      this.scene = opts.scene;
      audio.setMusic(SCENE_MUSIC[this.scene] ?? 'bright');
    }
    const seed = (Math.random() * 2 ** 31) | 0;
    this.cfg = defaultConfig({
      targetScore: opts.target ?? this.settings.targetScore,
      practice: mode === 'practice',
      balance: this.settings.balance,
      stats: [statsOf(this.chars[0]), statsOf(this.chars[1])],
    });
    this.state = this.prev = createState(seed, mode === 'practice' ? this.humanSide : 0);
    this.ais = [null, null];
    if (mode === 'cpu') this.ais[1 - this.humanSide] = new AiController(1 - this.humanSide, this.difficulty, seed);
    this.resultShown = false;
    this.paused = false;
    this.running = true;
    this.setInMatch(true);
    this.clearScreen();
    this.renderHud();
    if (mode === 'practice' && !this.tutorial) this.toast(t('practiceHint'), [], 3000);
  }

  private isLocalMatch() {
    return this.mode === 'cpu' || this.mode === 'local' || this.mode === 'practice';
  }

  private setInMatch(v: boolean) {
    document.body.classList.toggle('in-match', v);
    // 平板（短邊 ≥ 600px）同機雙人：左右各一組觸控按鍵
    const tablet2p = v && this.mode === 'local' && isTouchDevice() && Math.min(innerWidth, innerHeight) >= 600;
    this.touch.setLayout(tablet2p ? 'left' : 'full');
    this.touch2.setLayout('right');
    this.touch2.setVisible(tablet2p);
    this.touch.setVisible(v && isTouchDevice());
    if (v && isTouchDevice()) this.enterFullscreen();
    if (!v) this.hud.replaceChildren();
  }

  private enterFullscreen() {
    const el = document.documentElement;
    try {
      if (!document.fullscreenElement && el.requestFullscreen) {
        void el.requestFullscreen({ navigationUI: 'hide' }).then(() => {
          const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
          o.lock?.('landscape').catch(() => {});
        }).catch(() => {});
      }
    } catch {
      // iOS Safari 不支援
    }
  }

  // ---------------------------------------------------------------- input for menus
  private onKey(code: string, e: KeyboardEvent) {
    if (this.keyCapture) {
      e.preventDefault();
      this.keyCapture(code);
      return;
    }
    if (e.target instanceof HTMLInputElement) {
      if (code === 'Escape') this.backHandler?.();
      return;
    }
    if (code === 'Escape') {
      if (this.isLocalMatch() && !this.screenName) this.showPause();
      else if (this.screenName === 'pause') this.resume();
      else this.backHandler?.();
      return;
    }
    if (code === 'Space' && this.isLocalMatch() && (!this.screenName || this.screenName === 'pause')) {
      if (this.paused) this.resume();
      else this.showPause();
      return;
    }
    const a = menuAction(code);
    if (a) this.menuInput(a, keymapSide(code));
  }

  private menuInput(a: 'left' | 'right' | 'up' | 'down' | 'ok', side: 0 | 1 | null) {
    if (!this.screenName) return;
    if (this.menuKeyHandler) {
      this.menuKeyHandler(a, side);
      return;
    }
    if (a === 'ok') {
      const f = document.activeElement;
      if (f instanceof HTMLButtonElement && this.overlay.contains(f)) f.click();
      else moveFocus(this.overlay, 'down');
    } else {
      moveFocus(this.overlay, a);
      audio.blip();
    }
  }

  /** 設定頁等待「按下要綁定的手把按鈕」 */
  private padCapture: { action: 'jump' | 'hit'; prev: Set<number>; back: () => void; since: number } | null = null;

  private pollPadCapture(): boolean {
    const c = this.padCapture;
    if (!c) return false;
    const now = pressedButtons();
    // 8 秒沒有按就取消
    if (performance.now() - c.since > 8000) {
      this.padCapture = null;
      this.showSettings(c.back);
      return true;
    }
    for (const b of now) {
      if (c.prev.has(b) || DPAD_BUTTONS.has(b)) continue;
      const s = this.settings;
      const other = c.action === 'jump' ? 'hit' : 'jump';
      s.padMap[c.action] = [b];
      s.padMap[other] = s.padMap[other].filter((x) => x !== b);
      if (!s.padMap[other].length) s.padMap[other] = [...DEFAULT_PAD_MAP[other]].filter((x) => x !== b);
      saveSettings(s);
      this.applySettings();
      this.padCapture = null;
      this.padPrev = [0xff, 0xff]; // 避免剛綁定的按鍵同時觸發選單
      this.showSettings(c.back);
      return true;
    }
    c.prev = new Set([...c.prev].filter((b) => now.has(b)));
    return true;
  }

  private pollGamepadMenu() {
    if (this.pollPadCapture()) return;
    if (!this.screenName) return;
    for (let i = 0; i < 2; i++) {
      const v = readGamepad(i);
      const edge = v & ~this.padPrev[i];
      this.padPrev[i] = v;
      if (!edge) continue;
      const side = i as 0 | 1;
      if (edge & 1) this.menuInput('left', side);
      if (edge & 2) this.menuInput('right', side);
      if (edge & 8) this.menuInput('down', side);
      if (edge & 4) this.menuInput('up', side);
      if (edge & 16) this.menuInput('ok', side);
    }
  }

  // ---------------------------------------------------------------- screens
  private show(name: string, el: HTMLElement, back: (() => void) | null = null) {
    this.screenName = name;
    this.menuKeyHandler = null;
    this.keyCapture = null;
    this.backHandler = back;
    this.overlay.replaceChildren(el);
    const first = el.querySelector<HTMLButtonElement>('button.primary, button');
    if (first && !isTouchDevice()) first.focus({ preventScroll: true });
  }

  private clearScreen() {
    this.screenName = '';
    this.menuKeyHandler = null;
    this.backHandler = null;
    this.overlay.replaceChildren();
  }

  /** 標題：一個「開始」直接和電腦打，其他玩法收在「更多玩法」 */
  showTitle() {
    if (this.mode !== 'demo') this.startDemo();
    const el = h('div', { class: 'screen transparent title-screen' },
      h('h1', {}, t('title')),
      h('p', { class: 'sub' }, getLang() === 'en' ? '台灣金排球' : 'Taiwan Gold Volley'),
      h('div', { class: 'menu' },
        button(`▶ ${t('start')}`, () => this.quickStart(), 'primary big'),
        button(t('moreModes'), () => this.showModes(), 'secondary'),
      ),
      h('p', { class: 'help' }, t('quickHint')),
    );
    this.show('title', el);
  }

  /** 標題畫面的「開始」：用上次的角色（或預設角色）和隨機對手直接開打 */
  quickStart() {
    audio.unlock();
    this.endTutorial();
    this.challenge = null;
    this.dare = null;
    const me = hasCharacter(this.settings.lastChar) ? this.settings.lastChar : DEFAULT_CHARACTER;
    const others = allCharacters().filter((c) => c.id !== me && !c.local);
    this.chars = [me, others[(Math.random() * others.length) | 0]?.id ?? me];
    this.humanSide = 0;
    const first = !this.settings.firstMatchDone;
    // 第一場：最簡單的電腦、5 分短賽，邊打邊教
    if (first) this.difficulty = 'beginner';
    this.startLocalMatch('cpu', first ? { target: 5 } : {});
    if (first) this.startCoach();
  }

  showModes() {
    audio.unlock();
    if (this.mode !== 'demo') this.startDemo();
    const smallTouch = isTouchDevice() && Math.min(innerWidth, innerHeight) < 600;
    const langBtn = segmented<Lang>(
      [{ value: 'zh-TW', label: '繁中' }, { value: 'en', label: 'EN' }],
      getLang(),
      (v) => {
        this.settings.lang = v;
        saveSettings(this.settings);
        this.applySettings();
        this.showModes();
      },
    );
    const el = h('div', { class: 'screen' },
      h('h1', {}, t('title')),
      h('div', { class: 'menu' },
        button(t('vsCpu'), () => this.showCpuSetup(), 'primary'),
        smallTouch ? null : button(t('local2p'), () => this.showCharSelect('local')),
        button(t('online'), () => this.showOnlineMenu()),
        button(t('challenge'), () => this.showCharSelect('challenge')),
        button(t('practice'), () => this.showCharSelect('practice')),
        button(t('tutorial'), () => this.startTutorial(), 'secondary'),
        h('div', { class: 'menu row' },
          button(t('settings'), () => this.showSettings(() => this.showModes()), 'secondary small'),
          button(t('help'), () => this.showHelp(), 'secondary small'),
        ),
      ),
      h('div', { style: 'margin-top:10px' }, langBtn),
    );
    this.show('modes', el, () => this.showTitle());
  }

  showHelp() {
    const el = h('div', { class: 'screen' },
      h('h2', {}, t('help')),
      h('div', { class: 'help', style: 'font-size:15px;text-align:left' },
        ...([KEYMAP_1P, KEYMAP_2P] as const).map((m, i) => {
          const k = (a: KeyAction) => m[a].map(keyLabel).join('/') || '—';
          return h('p', {}, t('helpKeys', { p: `${i + 1}P`, l: k('left'), r: k('right'), u: k('up'), d: k('down'), h: k('hit') }));
        }),
        h('p', {}, t('helpMoves')), h('p', {}, t('helpOther')),
      ),
      h('div', { class: 'menu' }, button(t('back'), () => this.showModes())),
    );
    this.show('help', el, () => this.showModes());
  }

  showCpuSetup() {
    const el = h('div', { class: 'screen' },
      h('h2', {}, t('vsCpu')),
      h('div', { class: 'opt-row' }, h('label', {}, t('side')),
        segmented<0 | 1>([{ value: 0, label: t('left') }, { value: 1, label: t('right') }], this.humanSide, (v) => (this.humanSide = v))),
      h('div', { class: 'opt-row' }, h('label', {}, t('difficulty')),
        segmented<Difficulty>([
          { value: 'beginner', label: t('beginner') }, { value: 'easy', label: t('easy') }, { value: 'normal', label: t('normal') }, { value: 'hard', label: t('hard') },
        ], this.difficulty, (v) => (this.difficulty = v))),
      h('div', { class: 'menu row' },
        button(t('back'), () => this.showModes(), 'secondary'),
        button(t('start'), () => this.showCharSelect('cpu'), 'primary'),
      ),
    );
    this.show('cpuSetup', el, () => this.showModes());
    el.querySelector<HTMLButtonElement>('button.primary')?.focus();
  }

  /** 角色選擇（本機模式） */
  showCharSelect(mode: 'cpu' | 'local' | 'practice' | 'challenge') {
    const list = allCharacters();
    const idxOf = (id: string) => Math.max(0, list.findIndex((c) => c.id === id));
    const slots: [CharSlot, CharSlot] = [
      { idx: idxOf(this.chars[0]), ready: false, ctrl: 'human' },
      { idx: idxOf(this.chars[1]), ready: false, ctrl: 'human' },
    ];
    if (mode === 'cpu') {
      slots[1 - this.humanSide].ctrl = 'cpu';
      slots[1 - this.humanSide].ready = true;
      slots[1 - this.humanSide].idx = (Math.random() * list.length) | 0;
    }
    if (mode === 'practice' || mode === 'challenge') {
      slots[1].ctrl = 'cpu';
      slots[1].ready = true;
      this.humanSide = 0;
    }
    const finish = () => {
      this.chars = [list[slots[0].idx].id, list[slots[1].idx].id];
      this.dare = null;
      this.settings.lastChar = this.chars[mode === 'local' ? 0 : this.humanSide];
      saveSettings(this.settings);
      if (mode === 'challenge') this.startChallenge(this.chars[0]);
      else this.startLocalMatch(mode);
    };
    const single = mode === 'practice' || mode === 'challenge';
    const panels = this.buildCharPanels(list, slots, single ? [true, false] : [true, true], (side, action) => {
      const s = slots[side];
      if (action === 'ok') {
        if (s.ready && s.ctrl === 'human') s.ready = false;
        else s.ready = true;
      } else if (!s.ready || s.ctrl === 'cpu') {
        s.idx = typeof action === 'number' ? action : (s.idx + (action === 'left' ? list.length - 1 : 1)) % list.length;
        if (s.ctrl === 'cpu') s.ready = true;
      }
      audio.blip(action !== 'left');
      panels.refresh();
      if (slots[0].ready && slots[1].ready) setTimeout(finish, 250);
    });
    const el = h('div', { class: 'screen wide' },
      h('h2', {}, t('chooseChar')),
      panels.el,
      this.lookPickers(),
      h('p', { class: 'help' }, t('confirmHint')),
      h('div', { class: 'menu row' }, button(t('back'), () => (mode === 'cpu' ? this.showCpuSetup() : this.showModes()), 'secondary')),
    );
    this.show('charSelect', el, () => this.showModes());
    this.menuKeyHandler = (a, side) => {
      if (a === 'up' || a === 'down') return;
      let target: 0 | 1;
      if (mode === 'local') target = side ?? 0;
      else target = this.humanSide;
      panels.act(target, a);
    };
  }

  private buildCharPanels(
    list: CharacterPack[],
    slots: [CharSlot, CharSlot],
    visible: [boolean, boolean],
    act: (side: 0 | 1, action: CharAction) => void,
  ) {
    const wrap = h('div', { class: 'char-select' });
    const parts: {
      root: HTMLElement; canvas: HTMLCanvasElement; name: HTMLElement; stats: HTMLElement; status: HTMLElement;
      who: HTMLElement; okBtn: HTMLButtonElement; thumbs: HTMLButtonElement[];
    }[] = [];
    for (const side of [0, 1] as const) {
      const canvas = h('canvas', { width: 128, height: 128 });
      const name = h('div', { class: 'name' });
      const stats = h('div');
      const status = h('div', { class: 'status' });
      const who = h('div', { class: 'who' });
      const canAct = () => slots[side].ctrl !== 'remote';
      const okBtn = button(t('ready'), () => canAct() && act(side, 'ok'), 'small');
      const root = h('div', { class: 'char-panel' },
        who,
        h('div', { class: 'pick' },
          button('◀', () => canAct() && act(side, 'left'), 'small secondary'),
          canvas,
          button('▶', () => canAct() && act(side, 'right'), 'small secondary'),
        ),
        name, stats, status, okBtn,
      );
      // 所有角色的小頭像：直接點選，不用一個個切換
      const thumbs = list.map((pack, i) => {
        const b = h('button', { type: 'button', class: 'thumb', title: displayName(pack, getLang()), onclick: () => canAct() && act(side, i) });
        if (pack.portrait) b.append(h('img', { src: pack.portrait, alt: '', draggable: 'false' }));
        else b.style.background = pack.manifest.themeColor;
        b.style.setProperty('--theme', pack.manifest.themeColor);
        return b;
      });
      root.insertBefore(h('div', { class: 'thumbs' }, ...thumbs), name);
      if (!visible[side]) root.style.display = 'none';
      wrap.append(root);
      parts.push({ root, canvas, name, stats, status, who, okBtn, thumbs });
    }
    let raf = 0;
    const draw = (time: number) => {
      parts.forEach((p, side) => {
        const pack = list[slots[side].idx];
        const g = p.canvas.getContext('2d')!;
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.clearRect(0, 0, 128, 128);
        if (pack.sprite) {
          const anim = slots[side].ready ? pack.manifest.animations.win ?? pack.manifest.animations.idle : pack.manifest.animations.idle;
          const fi = Math.floor((time / 1000) * anim.fps) % anim.frames;
          const [fw, fh] = pack.manifest.frameSize;
          g.save();
          if (side === 1) {
            g.translate(128, 0);
            g.scale(-1, 1);
          }
          g.drawImage(pack.sprite, fi * fw, anim.row * fh, fw, fh, 0, 0, 128, 128);
          g.restore();
          if (side === 1 && slots[0].idx === slots[1].idx) {
            g.globalCompositeOperation = 'hue';
            g.fillStyle = 'rgba(80,120,255,0.6)';
            g.fillRect(0, 0, 128, 128);
            g.globalCompositeOperation = 'destination-in';
            g.save();
            g.translate(128, 0);
            g.scale(-1, 1);
            g.drawImage(pack.sprite, fi * fw, anim.row * fh, fw, fh, 0, 0, 128, 128);
            g.restore();
            g.globalCompositeOperation = 'source-over';
          }
        } else {
          g.fillStyle = pack.manifest.themeColor;
          g.beginPath();
          g.arc(64, 72, 48, 0, Math.PI * 2);
          g.fill();
        }
      });
      if (wrap.isConnected) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    void raf;
    const statBar = (label: string, v: number) => {
      const bar = h('div', { class: 'bar' });
      for (let i = -2; i <= 2; i++) bar.append(h('i', { class: i <= v ? 'on' : '' }));
      return h('div', { class: 'stat' }, h('span', {}, label), bar);
    };
    const refresh = () => {
      parts.forEach((p, side) => {
        const s = slots[side];
        const pack = list[s.idx];
        p.root.classList.toggle('ready', s.ready);
        p.root.style.borderColor = s.ready ? '' : pack.manifest.themeColor;
        p.name.textContent = displayName(pack, getLang());
        const st = pack.manifest.stats;
        p.stats.replaceChildren(statBar(t('speed'), st.speed), statBar(t('jump'), st.jump), statBar(t('power'), st.power));
        p.who.textContent = `${side === 0 ? '1P' : '2P'} · ${s.ctrl === 'cpu' ? t('cpu') : s.ctrl === 'remote' ? t('opponent') : t('you')}`;
        p.status.textContent = s.ready ? t('ready') : t('notReady');
        p.status.classList.toggle('ready', s.ready);
        p.okBtn.style.display = s.ctrl === 'human' ? '' : 'none';
        p.thumbs.forEach((b, i) => {
          b.classList.toggle('sel', i === s.idx);
          // 小頭像可以左右滑動時，讓選中的那個保持在看得到的位置
          if (i === s.idx && b.parentElement && b.parentElement.scrollWidth > b.parentElement.clientWidth) {
            const strip = b.parentElement;
            strip.scrollLeft = Math.max(0, b.offsetLeft - strip.offsetLeft - strip.clientWidth / 2 + b.offsetWidth / 2);
          }
          b.disabled = s.ctrl === 'remote' || (s.ready && s.ctrl === 'human');
        });
        p.okBtn.textContent = s.ready ? '✕' : t('ready');
      });
    };
    refresh();
    return { el: wrap, refresh, act };
  }

  // ---------------------------------------------------------------- 場景／排球選擇
  private static readonly SCENE_LABELS: Record<SceneId, MsgKey> = {
    beach: 'sceneBeach', lake: 'sceneLake', comet: 'sceneComet', taipei: 'sceneTaipei', zoo: 'sceneZoo',
    ntu: 'sceneNtu', songshan: 'sceneSongshan', expo: 'sceneExpo', yangming: 'sceneYangming', tamsui: 'sceneTamsui',
  };

  private static readonly BALL_LABELS: Record<BallSkin, MsgKey> = {
    classic: 'ballClassic', red: 'ballRed', blue: 'ballBlue', ultra: 'ballUltra',
  };

  /** 場景卡片：每張卡片是該場景的縮圖 */
  private sceneSeg() {
    const s = this.settings;
    const options: Settings['scene'][] = [...SCENES, 'random'];
    return cardPicker(
      options.map((id) => ({
        value: id,
        label: t(id === 'random' ? 'random' : App.SCENE_LABELS[id]),
        thumb: (el: HTMLElement) => {
          if (id === 'random') {
            el.textContent = '🎲';
            return;
          }
          void sceneThumb(id).then((url) => {
            el.style.backgroundImage = `url(${url})`;
          });
        },
      })),
      s.scene,
      (v) => {
        s.scene = v;
        saveSettings(s);
        this.rollLook();
      },
      'scene-cards',
    );
  }

  /** 排球卡片：畫出每種配色的球 */
  private ballSeg() {
    const s = this.settings;
    const options: Settings['ball'][] = [...(Object.keys(BALL_SKINS) as BallSkin[]), 'random'];
    return cardPicker(
      options.map((id) => ({
        value: id,
        label: t(id === 'random' ? 'random' : App.BALL_LABELS[id]),
        thumb: (el: HTMLElement) => {
          if (id === 'random') {
            el.textContent = '🎲';
            return;
          }
          const c = h('canvas', { width: 80, height: 80 });
          const g = c.getContext('2d')!;
          g.scale(2, 2);
          paintBall(g, 20, 20, 17, 0.5, id);
          el.append(c);
        },
      })),
      s.ball,
      (v) => {
        s.ball = v;
        saveSettings(s);
        this.rollLook();
      },
      'ball-cards',
    );
  }

  /** 選角畫面下方的場景、排球選擇（選了背景會立刻換） */
  private lookPickers() {
    return h('div', { class: 'look-pickers' },
      h('div', { class: 'opt-block' }, h('label', {}, t('scene')), this.sceneSeg()),
      h('div', { class: 'opt-block' }, h('label', {}, t('ballSkin')), this.ballSeg()),
    );
  }

  // ---------------------------------------------------------------- settings
  showSettings(back: () => void) {
    const s = this.settings;
    const save = () => {
      saveSettings(s);
      this.applySettings();
    };
    const row = (label: string, ctrl: HTMLElement) => h('div', { class: 'opt-row' }, h('label', {}, label), ctrl);
    const onOff = (k: 'bgm' | 'balance' | 'touchSwap' | 'vibrate' | 'selfLeft' | 'showFps') =>
      segmented<boolean>([{ value: true, label: t('on') }, { value: false, label: t('off') }], s[k], (v) => {
        s[k] = v;
        save();
      });
    const el = h('div', { class: 'screen wide' },
      h('h2', {}, t('settings')),
      row(t('speedOpt'), segmented([
        { value: 'slow', label: t('slow') }, { value: 'normal', label: t('normal') }, { value: 'fast', label: t('fast') },
      ], s.speed, (v) => { s.speed = v as Settings['speed']; save(); })),
      row(t('targetScore'), segmented([{ value: 5, label: '5' }, { value: 10, label: '10' }, { value: 15, label: '15' }],
        s.targetScore, (v) => { s.targetScore = v as Settings['targetScore']; save(); })),
      h('div', { class: 'opt-block' }, h('label', {}, t('scene')), this.sceneSeg()),
      h('div', { class: 'opt-block' }, h('label', {}, t('ballSkin')), this.ballSeg()),
      row(t('graphics'), segmented([{ value: 'sharp', label: t('sharp') }, { value: 'smooth', label: t('smooth') }],
        s.graphics, (v) => { s.graphics = v as Settings['graphics']; save(); })),
      row(t('bgm'), onOff('bgm')),
      row(t('sfx'), segmented([
        { value: 'stereo', label: t('stereo') }, { value: 'mono', label: t('mono') }, { value: 'off', label: t('off') },
      ], s.sfx, (v) => { s.sfx = v as Settings['sfx']; save(); })),
      row(t('balance'), onOff('balance')),
      row(t('touchSize'), segmented([
        { value: 'small', label: t('small') }, { value: 'medium', label: t('medium') }, { value: 'large', label: t('large') },
      ], s.touchSize, (v) => { s.touchSize = v as Settings['touchSize']; save(); })),
      row(t('touchOpacity'), segmented([0.3, 0.45, 0.6, 0.8].map((v) => ({ value: v, label: `${Math.round(v * 100)}%` })),
        s.touchOpacity, (v) => { s.touchOpacity = v; save(); })),
      row(t('touchStick'), segmented([{ value: 'float', label: t('stickFloat') }, { value: 'fixed', label: t('stickFixed') }],
        s.touchStick, (v) => { s.touchStick = v as Settings['touchStick']; save(); })),
      row(t('touchSwap'), onOff('touchSwap')),
      row(t('vibrate'), onOff('vibrate')),
      row(t('selfLeft'), onOff('selfLeft')),
      row(t('showFps'), onOff('showFps')),
      row(t('padKeys'), h('div', { class: 'seg' },
        ...(['jump', 'hit'] as const).map((action) => button(
          this.padCapture?.action === action
            ? `${t(action === 'jump' ? 'padJump' : 'padHit')}：${t('padPress')}`
            : `${t(action === 'jump' ? 'padJump' : 'padHit')}：${s.padMap[action].map(padButtonLabel).join(' / ')}`,
          () => {
            this.padCapture = { action, prev: pressedButtons(), back, since: performance.now() };
            this.showSettings(back);
          },
          'small',
        )),
        button(t('padReset'), () => {
          s.padMap = { jump: [...DEFAULT_PAD_MAP.jump], hit: [...DEFAULT_PAD_MAP.hit] };
          save();
          this.showSettings(back);
        }, 'small secondary'),
      )),
      row(t('errorLog'), h('div', { class: 'seg' },
        h('span', { class: 'sub', style: 'align-self:center' }, t('errorCount', { n: errorEntries().length })),
        button(t('reportIssue'), () => {
          window.open(issueUrl({ scene: this.scene, mode: this.mode, speed: this.settings.speed }), '_blank', 'noopener');
        }, 'small'),
        button(t('clearLog'), () => {
          clearErrors();
          this.showSettings(back);
        }, 'small secondary'),
      )),
      h('h3', {}, t('controls')),
      this.keyBindingRows(),
      h('h3', {}, t('packs')),
      this.packImportBox(() => this.showSettings(back)),
      row(t('language'), segmented<Lang>([{ value: 'zh-TW', label: '繁體中文' }, { value: 'en', label: 'English' }], s.lang, (v) => {
        s.lang = v;
        save();
        this.showSettings(back);
      })),
      h('div', { class: 'menu row' }, button(t('back'), back, 'primary')),
    );
    this.show('settings', el, back);
  }

  /** 鍵位重新綁定：點按鈕後按下新按鍵（Esc 取消） */
  private keyBindingRows(): HTMLElement {
    const box = h('div', { class: 'keybinds' });
    const hint = h('p', { class: 'help', style: 'margin-top:4px' });
    const names: Record<KeyAction, MsgKey> = { left: 'keyLeft', right: 'keyRight', up: 'keyUp', down: 'keyDown', hit: 'keyHit' };
    const focusBind = (id: string) => box.querySelector<HTMLButtonElement>(`[data-bind="${id}"]`)?.focus({ preventScroll: true });
    const render = (capturing: string | null) => {
      const rows = ([0, 1] as const).map((side) => {
        const map = this.settings.keys[side];
        const btns = KEY_ACTIONS.map((a) => {
          const id = `${side}-${a}`;
          const label = id === capturing ? '…' : map[a].map(keyLabel).join('/') || '—';
          const b = button(`${t(names[a])} ${label}`, () => startCapture(side, a), id === capturing ? 'on' : '');
          b.dataset.bind = id;
          return b;
        });
        return h('div', { class: 'opt-row' }, h('label', {}, `${side + 1}P`), h('div', { class: 'seg' }, ...btns));
      });
      const reset = button(t('resetKeys'), () => {
        this.keyCapture = null;
        commit([cloneKeymap(DEFAULT_KEYMAP_1P), cloneKeymap(DEFAULT_KEYMAP_2P)]);
      }, 'secondary small');
      hint.textContent = capturing ? t('pressKey') : '';
      box.replaceChildren(...rows, hint, h('div', { class: 'menu row' }, reset));
      if (capturing) focusBind(capturing);
    };
    const commit = (keys: [KeyMap, KeyMap]) => {
      this.settings.keys = keys;
      saveSettings(this.settings);
      applyKeymaps(keys[0], keys[1]);
      render(null);
    };
    const startCapture = (side: 0 | 1, a: KeyAction) => {
      const id = `${side}-${a}`;
      render(id);
      this.keyCapture = (code) => {
        if (code === 'Escape') {
          this.keyCapture = null;
          render(null);
          focusBind(id);
          return;
        }
        if (!canBind(code)) return; // 保留鍵：繼續等待
        this.keyCapture = null;
        audio.blip(true);
        commit(rebind(this.settings.keys, side, a, code));
        focusBind(id);
      };
    };
    render(null);
    return box;
  }

  /** 匯入角色包：拖入 .zip 或選擇檔案，存進 IndexedDB，只在本機可見 */
  private packImportBox(refresh: () => void): HTMLElement {
    const status = h('p', { class: 'help', id: 'pack-status', style: 'margin-top:4px' });
    const file = h('input', { type: 'file', accept: '.zip,application/zip', style: 'display:none' });
    const doImport = async (f: File | null | undefined) => {
      if (!f) return;
      status.classList.remove('error');
      status.textContent = '…';
      try {
        const pack = await importPackZip(f);
        this.toast(t('packImported', { name: displayName(pack, getLang()) }));
        refresh();
      } catch (e) {
        status.classList.add('error');
        status.textContent = t('packError', { msg: e instanceof Error ? e.message : String(e) });
      }
    };
    file.addEventListener('change', () => void doImport(file.files?.[0]));
    const zone = h('div', { class: 'drop-zone', id: 'pack-drop' },
      h('span', {}, t('packDrop')),
      button(t('packChoose'), () => file.click(), 'secondary small'),
      file,
    );
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('over');
      const files = [...(e.dataTransfer?.files ?? [])];
      void doImport(files.find((x) => x.name.toLowerCase().endsWith('.zip')) ?? files[0]);
    });
    const local = allCharacters().filter((c) => c.local);
    const rows = local.map((c) => h('div', { class: 'opt-row pack-row' },
      h('label', {}, displayName(c, getLang())),
      button(t('packDelete'), async () => {
        await deleteLocalPack(c.id);
        this.chars = this.chars.map((x) => (x === c.id ? DEFAULT_CHARACTER : x)) as [string, string];
        refresh();
      }, 'secondary small'),
    ));
    return h('div', {},
      zone, status,
      ...(rows.length ? rows : [h('p', { class: 'help', style: 'margin-top:4px' }, t('packNone'))]),
      h('p', { class: 'help', style: 'margin-top:4px' }, t('packLocalOnly')),
    );
  }

  // ---------------------------------------------------------------- pause / result
  showPause() {
    if (!this.isLocalMatch()) return;
    this.paused = true;
    const el = h('div', { class: 'screen' },
      h('h2', {}, t('paused')),
      h('div', { class: 'menu' },
        button(t('resume'), () => this.resume(), 'primary'),
        button(t('settings'), () => this.showSettings(() => this.showPause()), 'secondary'),
        button(t('quit'), () => this.quitToModes(), 'secondary'),
      ),
    );
    this.show('pause', el, () => this.resume());
  }

  resume() {
    this.paused = false;
    this.acc = 0;
    this.clearScreen();
  }

  private quitToModes() {
    this.paused = false;
    this.endTutorial();
    this.endCoach();
    this.challenge = null;
    this.dare = null;
    if (this.online) {
      this.online.close();
      this.online = null;
    }
    this.startDemo();
    this.showModes();
  }

  private showResult(winner: number) {
    this.resultShown = true;
    const firstDone = !!this.coach;
    if (firstDone) {
      // 第一場（邊打邊教）打完了：之後按「開始」就是一般比賽
      this.endCoach();
      this.settings.firstMatchDone = true;
      saveSettings(this.settings);
    }
    if (this.challenge && this.mode === 'cpu') {
      this.showStageResult(winner === this.humanSide);
      return;
    }
    const winnerName = displayName(getCharacter(this.chars[winner]), getLang());
    let title = t('winner', { name: winnerName });
    if (this.mode === 'cpu') title = winner === this.humanSide ? t('youWin') : t('youLose');
    if (this.mode === 'online' && this.online) title = winner === this.online.localSide ? t('youWin') : t('youLose');
    const again = () => {
      if (this.mode === 'online') {
        this.online?.requestRematch();
        againBtn.disabled = true;
        againBtn.textContent = t('waitRematch');
      } else if (this.dare) {
        this.startDare(this.dare);
      } else {
        this.startLocalMatch(this.mode as 'cpu' | 'local' | 'practice');
      }
    };
    const againBtn = button(t('rematch'), again, 'primary');
    const share = this.resultShare(winner);
    // 挑戰連結記錄這場實際的難度後，下一場電腦再升一級（入門 → 簡單）
    if (firstDone && this.difficulty === 'beginner') this.difficulty = 'easy';
    let dareLine: HTMLElement | null = null;
    if (this.dare && this.mode === 'cpu') {
      const mine = share.mine;
      const fmt = (s: readonly [number, number]) => `${s[0]}:${s[1]}`;
      const won = beats(mine, this.dare.score);
      dareLine = h('p', { class: `dare-line ${won ? 'ok' : ''}` },
        t(won ? 'dareBeat' : 'dareMiss', { mine: fmt(mine), theirs: fmt(this.dare.score) }));
    }
    const el = h('div', { class: 'screen result-screen' },
      h('h2', {}, title),
      h('p', { class: 'code', style: 'letter-spacing:2px' }, `${this.state.score[0]} - ${this.state.score[1]}`),
      dareLine,
      // 矮螢幕（手機橫向）時戰績卡在左、按鈕在右
      h('div', { class: 'result-body' },
        share.preview,
        h('div', { class: 'result-actions' },
          h('div', { class: 'menu' }, againBtn),
          share.buttons,
          h('div', { class: 'menu row' },
            this.mode === 'cpu' ? button(t('changeLook'), () => {
              this.dare = null;
              this.showCharSelect('cpu');
            }, 'secondary small') : null,
            button(t('toTitle'), () => this.quitToModes(), 'secondary small'),
          ),
        ),
      ),
    );
    this.show('result', el, () => this.quitToModes());
  }

  /**
   * 結算畫面的分享區：戰績卡預覽、「LINE 挑戰朋友」、「分享戰績圖」、「複製連結」。
   * 戰績卡與文字都以玩家自己的角度寫（「我用石虎 7:3 打爆台灣黑熊」），
   * 連結是挑戰連結：朋友點開就是同一組對戰，要打出比這更好的比分。
   */
  private resultShare(winner: number, resultText?: string) {
    const o = this.online;
    // 自己是哪一邊；同機雙人以贏的一方為主角
    const meSide = this.mode === 'online' && o ? o.localSide : this.mode === 'local' ? winner : this.humanSide;
    const self = this.mode !== 'local';
    const mine: [number, number] = [this.state.score[meSide], this.state.score[1 - meSide]];
    const ids = [this.chars[meSide], this.chars[1 - meSide]];
    const packs = ids.map((id) => getCharacter(id));
    const names = packs.map((p) => displayName(p, getLang()));
    const line = headline(getLang(), names[0], names[1], mine, self);
    const base = `${location.origin}${location.pathname}`;
    const target = this.mode === 'online' && o?.info ? o.info.rules.targetScore : this.cfg.targetScore;
    // 只有正常打完、雙方都是內建角色時才產生挑戰連結（朋友那邊沒有匯入的角色）
    const canDare = (this.mode === 'cpu' || this.mode === 'online') && Math.max(...mine) >= target && mine[0] !== mine[1]
      && packs.every((p) => !p.local);
    const link = canDare
      ? dareUrl(base, {
        me: ids[0], opp: ids[1], scene: this.scene, score: mine, target,
        level: this.mode === 'online' ? 'hard' : this.difficulty,
      })
      : base;
    const text = canDare ? t('dareShareText', { headline: line, url: link }) : `${line}\n${link}`;
    const info: ShareInfo = {
      title: t('title'),
      result: resultText ?? line,
      headline: line,
      cta: canDare ? t('dareCta') : undefined,
      text,
      score: mine,
      players: packs.map((p, i) => ({ name: names[i], portrait: p.portrait, color: p.manifest.themeColor })),
      sceneId: this.scene,
      sceneName: t(App.SCENE_LABELS[this.scene]),
      url: link,
    };
    // 戰績卡預覽（在背景產生，產生好之前分享按鈕會自己產生一次）
    const preview = h('div', { class: 'card-preview' });
    let canvas: HTMLCanvasElement | undefined;
    void import('./ui/sharecard').then(async ({ renderShareCard }) => {
      canvas = await renderShareCard(info);
      const img = h('img', { src: canvas.toDataURL('image/jpeg', 0.85), alt: line });
      preview.replaceChildren(img);
    }).catch((err) => recordError('error', err));
    const imgBtn = button(t('shareCard'), async () => {
      imgBtn.disabled = true;
      try {
        const { shareCard } = await import('./ui/sharecard');
        const outcome = await shareCard(info, canvas);
        if (outcome === 'downloaded') this.toast(t('imageSaved'), [], 2500);
      } catch (err) {
        recordError('error', err);
      } finally {
        imgBtn.disabled = false;
      }
    }, 'secondary small');
    const copyBtn = button(t('copyLink'), async () => {
      try {
        await navigator.clipboard.writeText(text);
        this.toast(t('copied'), [], 1800);
      } catch {
        // 不允許寫入剪貼簿
      }
    }, 'secondary small');
    const buttons = h('div', { class: 'menu row share-row' },
      button(t('lineChallenge'), () => window.open(lineShareUrl(text), '_blank', 'noopener'), 'line small'),
      imgBtn,
      copyBtn,
    );
    return { preview, buttons, mine, link, text };
  }

  // ---------------------------------------------------------------- 新手教學
  private startTutorial() {
    this.challenge = null;
    if (!this.chars[0]) this.chars[0] = DEFAULT_CHARACTER;
    this.humanSide = 0;
    this.tutorial = null;
    this.startLocalMatch('practice', { scene: 'beach' });
    this.hideToast();
    this.tutorial = new Tutorial(this.state);
    this.tutorialEl?.remove();
    this.tutorialEl = h('div', { class: 'tutorial' });
    $('#app').append(this.tutorialEl);
    this.renderTutorial();
  }

  private tutorialText(i: number) {
    return this.stepText(TUTORIAL_STEPS[i]);
  }

  private stepText(step: TutorialStep) {
    const m = KEYMAP_1P;
    const k = (a: KeyAction) => m[a].map(keyLabel).join('/') || '—';
    const vars = { l: k('left'), r: k('right'), u: k('up'), d: k('down'), h: k('hit') };
    return t(isTouchDevice() ? step.touch : step.kb, vars);
  }

  private renderTutorial() {
    const tut = this.tutorial;
    if (!tut || !this.tutorialEl) return;
    const items = TUTORIAL_STEPS.map((_, i) =>
      h('li', { class: i < tut.step ? 'done' : i === tut.step ? 'now' : '' }, (i < tut.step ? '✔ ' : `${i + 1}. `) + this.tutorialText(i)),
    );
    this.tutorialEl.replaceChildren(
      h('div', { class: 'tut-head' }, h('b', {}, `${t('tutTitle')} ${Math.min(tut.step + 1, TUTORIAL_STEPS.length)}/${TUTORIAL_STEPS.length}`),
        button(t('tutSkip'), () => this.quitToModes(), 'small secondary')),
      h('ol', {}, ...items),
    );
  }

  private onTutorialStep() {
    audio.play('score');
    this.renderTutorial();
    if (!this.tutorial?.finished) return;
    this.paused = true;
    const el = h('div', { class: 'screen' },
      h('h2', {}, t('tutDone')),
      h('p', {}, t('tutDoneText')),
      h('div', { class: 'menu' },
        button(t('vsCpu'), () => {
          this.endTutorial();
          this.showCpuSetup();
        }, 'primary'),
        button(t('toTitle'), () => this.quitToModes(), 'secondary'),
      ),
    );
    this.show('tutorialDone', el, () => this.quitToModes());
  }

  private endTutorial() {
    this.tutorial = null;
    this.tutorialEl?.remove();
    this.tutorialEl = null;
  }

  // ---------------------------------------------------------------- 第一場的場上提示
  private startCoach() {
    this.endCoach();
    this.coach = new Coach(this.state);
    this.coachEl = h('div', { class: 'coach' });
    $('#app').append(this.coachEl);
    this.renderCoach(false);
  }

  /** 顯示目前這句提示；剛做到上一步時先閃一下「很好！」 */
  private renderCoach(good: boolean) {
    const el = this.coachEl;
    const c = this.coach;
    if (!el || !c) return;
    const show = () => {
      if (this.coachEl !== el) return;
      const cur = c.current;
      if (!cur) {
        this.endCoach();
        return;
      }
      el.classList.remove('good');
      el.replaceChildren(h('span', { class: 'coach-tag' }, t('coachTag')), h('span', {}, this.stepText(cur)));
    };
    if (good) {
      audio.blip(true);
      el.classList.add('good');
      el.replaceChildren(h('span', {}, `✔ ${t('coachGood')}`));
      setTimeout(show, 900);
    } else {
      show();
    }
  }

  private endCoach() {
    this.coach = null;
    this.coachEl?.remove();
    this.coachEl = null;
  }

  // ---------------------------------------------------------------- 挑戰連結
  /** 朋友分享的挑戰：顯示對戰組合與要打贏的比分，一個按鈕就開打 */
  showDare(d: Dare) {
    if (this.mode !== 'demo') this.startDemo();
    // 背景先換成挑戰的場景
    this.scene = d.scene;
    audio.setMusic(SCENE_MUSIC[d.scene] ?? 'bright');
    const packs = [getCharacter(d.me), getCharacter(d.opp)];
    const s = `${d.score[0]}:${d.score[1]}`;
    const face = (p: CharacterPack) => (p.portrait ? h('img', { src: p.portrait, class: 'stage-portrait', alt: '' }) : null);
    const el = h('div', { class: 'screen' },
      h('h2', {}, t('dareTitle')),
      h('div', { class: 'dare-vs' }, face(packs[0]), h('b', {}, 'VS'), face(packs[1])),
      h('p', { class: 'sub' }, t('dareText', { me: displayName(packs[0], getLang()), opp: displayName(packs[1], getLang()), s })),
      h('p', {}, t('dareGoal', { scene: t(App.SCENE_LABELS[d.scene]), s })),
      h('div', { class: 'menu' },
        button(`▶ ${t('dareAccept')}`, () => this.startDare(d), 'primary big'),
        button(t('moreModes'), () => this.showModes(), 'secondary'),
      ),
    );
    this.show('dare', el, () => this.showModes());
  }

  private startDare(d: Dare) {
    audio.unlock();
    this.endTutorial();
    this.challenge = null;
    this.dare = d;
    this.chars = [d.me, d.opp];
    this.humanSide = 0;
    this.difficulty = d.level;
    this.startLocalMatch('cpu', { target: d.target, scene: d.scene });
    if (!this.settings.firstMatchDone) this.startCoach();
  }

  // ---------------------------------------------------------------- 闖關挑戰
  private startChallenge(player: string) {
    this.endTutorial();
    this.challenge = { player, stages: buildStages(player, allCharacters().map((c) => c.id)), idx: 0 };
    this.showStageIntro();
  }

  private levelName(d: Difficulty) {
    return t(d);
  }

  private showStageIntro() {
    const c = this.challenge;
    if (!c) return;
    this.paused = false;
    if (this.mode !== 'demo') this.startDemo();
    const opp = getCharacter(c.stages[c.idx]);
    const portrait = opp.portrait ? h('img', { src: opp.portrait, class: 'stage-portrait', alt: '' }) : null;
    const el = h('div', { class: 'screen' },
      h('h2', {}, t('stageN', { n: c.idx + 1, total: STAGE_COUNT })),
      portrait,
      h('p', { class: 'sub' }, t('stageVs', { name: displayName(opp, getLang()), level: this.levelName(STAGE_DIFFS[c.idx]) })),
      h('p', {}, t('challengeBest', { n: loadBest(), total: STAGE_COUNT })),
      h('div', { class: 'menu' },
        button(t('start'), () => this.startStage(), 'primary'),
        button(t('giveUp'), () => this.quitToModes(), 'secondary'),
      ),
    );
    this.show('stageIntro', el, () => this.quitToModes());
  }

  private startStage() {
    const c = this.challenge;
    if (!c) return;
    this.chars = [c.player, c.stages[c.idx]];
    this.humanSide = 0;
    this.difficulty = STAGE_DIFFS[c.idx];
    this.startLocalMatch('cpu', { target: STAGE_TARGET, scene: STAGE_SCENES[c.idx] });
  }

  private showStageResult(won: boolean) {
    const c = this.challenge!;
    if (won) {
      c.idx++;
      saveBest(c.idx);
      audio.play('win');
    }
    const cleared = won && c.idx >= STAGE_COUNT;
    const share = this.resultShare(won ? this.humanSide : 1 - this.humanSide);
    const el = h('div', { class: 'screen result-screen' },
      h('h2', {}, cleared ? t('challengeClear') : won ? t('stageWin') : t('stageLose')),
      h('p', { class: 'code', style: 'letter-spacing:2px' }, `${this.state.score[0]} - ${this.state.score[1]}`),
      cleared ? h('p', { class: 'sub' }, t('challengeClearText')) : null,
      h('p', {}, t('challengeBest', { n: loadBest(), total: STAGE_COUNT })),
      h('div', { class: 'result-body' },
        share.preview,
        h('div', { class: 'result-actions' },
          h('div', { class: 'menu' },
            cleared ? null : button(won ? t('nextStage') : t('tryAgain'), () => (won ? this.showStageIntro() : this.startStage()), 'primary'),
          ),
          share.buttons,
          h('div', { class: 'menu row' }, button(t('toTitle'), () => this.quitToModes(), cleared ? 'primary' : 'secondary small')),
        ),
      ),
    );
    this.show('result', el, () => this.quitToModes());
  }

  // ---------------------------------------------------------------- HUD
  private renderHud() {
    this.hud.replaceChildren();
    if (this.mode === 'online') {
      const ping = h('span', { class: 'pill', id: 'hud-ping' });
      const warn = h('span', { class: 'pill warn', id: 'hud-warn', style: 'display:none' }, '⚠ ' + t('unstable'));
      const emoteBtn = button('💬', () => {
        const box = $('#emote-box');
        box.style.display = box.style.display === 'none' ? 'flex' : 'none';
      }, 'pause-btn');
      const emotes = h('div', { class: 'emotes pill', id: 'emote-box', style: 'display:none' });
      for (let i = 1; i <= 6; i++) {
        emotes.append(button(t(`emote${i}` as MsgKey), () => {
          this.online?.sendEmote(i);
          this.showEmote(i, true);
          emotes.style.display = 'none';
        }, 'small'));
      }
      this.hud.append(ping, warn, emoteBtn, emotes);
    } else if (this.isLocalMatch()) {
      this.hud.append(button('❚❚', () => this.showPause(), 'pause-btn'));
    }
  }

  private updateOnlineHud() {
    const o = this.online;
    if (!o) return;
    const ping = document.getElementById('hud-ping');
    if (ping) {
      const bars = o.rtt < 60 ? '▂▄▆█' : o.rtt < 120 ? '▂▄▆' : o.rtt < 200 ? '▂▄' : '▂';
      ping.textContent = `${bars} ${t('ping')} ${o.rtt}ms`;
    }
    const warn = document.getElementById('hud-warn');
    if (warn) warn.style.display = o.stalled > 3 ? '' : 'none';
  }

  private showEmote(id: number, mine: boolean) {
    const o = this.online;
    let side = mine ? o?.localSide ?? 0 : 1 - (o?.localSide ?? 0);
    if (o && o.localSide === 1 && this.settings.selfLeft) side = 1 - side;
    const b = h('div', { class: `bubble ${side === 0 ? 'left' : 'right'}` }, t(`emote${id}` as MsgKey));
    $('#app').append(b);
    setTimeout(() => b.remove(), 2300);
  }

  // ---------------------------------------------------------------- online
  showOnlineMenu() {
    const input = h('input', { class: 'code-input', maxlength: 6, placeholder: 'ABC234', autocomplete: 'off', inputmode: 'text' }) as HTMLInputElement;
    const err = h('p', { class: 'error' });
    const doJoin = () => {
      const code = normalizeCode(input.value);
      if (!code) {
        err.textContent = t('enterCode');
        return;
      }
      this.showOnlineJoin(code);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doJoin();
    });
    const el = h('div', { class: 'screen' },
      h('h2', {}, t('online')),
      h('div', { class: 'menu' }, button(t('createRoom'), () => this.showOnlineHost(), 'primary')),
      h('p', { style: 'margin-top:16px' }, t('joinRoom')),
      h('div', { class: 'menu row' }, input, button(t('join'), doJoin)),
      err,
      h('p', { class: 'help' }, t('hostRules')),
      h('div', { class: 'menu row' }, button(t('back'), () => this.showModes(), 'secondary')),
    );
    this.show('online', el, () => this.showModes());
  }

  private onlineToken = 0;

  /** 載入線上模組並建立連線物件；載入期間使用者若已離開畫面則回傳 null */
  private async newOnline(): Promise<OnlineMatch | null> {
    this.online?.close();
    this.online = null;
    const token = ++this.onlineToken;
    let mod: typeof import('./net/online');
    try {
      mod = await import('./net/online');
    } catch {
      this.onlineError('offline');
      return null;
    }
    if (token !== this.onlineToken) return null;
    const o = new mod.OnlineMatch(
      {
        onCode: (code) => this.onRoomCode(code),
        onConnected: () => this.showOnlineCharSelect(),
        onRemoteChar: () => this.onlinePanels?.sync(),
        onCountdown: (info) => this.onlineCountdown(info),
        onEvents: (ev) => {
          const mirror = o.localSide === 1 && this.settings.selfLeft;
          this.handleEvents(ev, mirror);
        },
        onEmote: (id) => this.showEmote(id, false),
        onRematchAsk: () => this.toast(t('rematchAsk'), [], 3000),
        onResume: () => this.onlineResume(),
        onDisconnect: (left) => {
          if (left === null) this.hideToast();
          else this.toast(t('disconnected', { s: left }), [], 0);
        },
        onForfeit: () => {
          this.hideToast();
          this.toast(t('forfeitWin'), [], 4000);
          this.showResult(o.localSide);
        },
        onLeft: () => this.onOpponentLeft(),
        onPackReceived: () => {
          // 重建選角畫面，讓對方的角色出現在清單裡
          if (this.screenName === 'onlineChar') this.showOnlineCharSelect();
        },
        onError: (msg) => this.onlineError(msg),
      },
      () => ({ speed: this.settings.speed, targetScore: this.settings.targetScore, balance: this.settings.balance }),
      (id) => statsOf(id),
    );
    this.online = o;
    this.onlineStarted = false;
    return o;
  }

  private async showOnlineHost() {
    const el = h('div', { class: 'screen' },
      h('h2', {}, t('createRoom')),
      h('p', {}, t('connecting')),
      h('div', { class: 'menu row' }, button(t('back'), () => this.leaveOnline(), 'secondary')),
    );
    this.show('room', el, () => this.leaveOnline());
    const o = await this.newOnline();
    o?.host();
  }

  private onRoomCode(code: string) {
    const link = `${location.origin}${location.pathname}?room=${code}`;
    const text = t('inviteText', { url: link });
    const copyBtn = button(t('shareLink'), async () => {
      try {
        if (navigator.share && isTouchDevice()) await navigator.share({ title: t('title'), text });
        else await navigator.clipboard.writeText(text);
        copyBtn.textContent = t('copied');
      } catch {
        // 使用者取消
      }
    }, 'secondary');
    const el = h('div', { class: 'screen' },
      h('h2', {}, t('roomCode')),
      h('div', { class: 'code' }, code),
      h('p', { style: 'word-break:break-all;font-size:12px' }, link),
      // 朋友點開連結就直接進這一間房，不用輸入房號
      h('div', { class: 'menu' },
        button(t('lineInvite'), () => window.open(lineShareUrl(text), '_blank', 'noopener'), 'line'),
        copyBtn,
      ),
      h('p', { class: 'blink' }, t('waitingOpponent')),
      h('div', { class: 'menu row' }, button(t('back'), () => this.leaveOnline(), 'secondary')),
    );
    this.show('room', el, () => this.leaveOnline());
  }

  async showOnlineJoin(code: string, invited = false) {
    const el = h('div', { class: 'screen' },
      h('h2', {}, t('joinRoom')),
      h('div', { class: 'code' }, code),
      h('p', { class: 'blink' }, invited ? t('invited') : t('connecting')),
      h('div', { class: 'menu row' }, button(t('back'), () => this.leaveOnline(), 'secondary')),
    );
    this.show('room', el, () => this.leaveOnline());
    const o = await this.newOnline();
    o?.join(code);
  }

  private onlineError(msg: string) {
    recordError('net', `online: ${msg}`);
    const map: Record<string, string> = {
      version: t('versionMismatch'),
      'room-not-found': `${t('roomCode')} ✕`,
      full: 'Room full',
      timeout: 'timeout',
    };
    const text = msg === 'version' ? map.version : t('connFailed', { msg: map[msg] ?? msg });
    const code = this.online?.transport.code;
    const isHost = this.online?.isHost;
    this.online?.close();
    this.online = null;
    this.startDemo();
    const el = h('div', { class: 'screen' },
      h('h2', {}, t('online')),
      h('p', { class: 'error' }, text),
      h('div', { class: 'menu row' },
        button(t('retry'), () => (isHost || !code ? this.showOnlineHost() : this.showOnlineJoin(code)), 'primary'),
        button(t('back'), () => this.showOnlineMenu(), 'secondary'),
      ),
    );
    this.show('onlineError', el, () => this.showOnlineMenu());
  }

  private onOpponentLeft() {
    if (!this.online) return;
    const wasPlaying = this.onlineStarted && this.state.phase !== Phase.Over;
    const side = this.online.localSide;
    this.online.close();
    this.online = null;
    if (wasPlaying) {
      this.toast(t('forfeitWin'), [], 4000);
      this.mode = 'online';
      this.showResultOffline(side);
      return;
    }
    this.startDemo();
    const el = h('div', { class: 'screen' },
      h('h2', {}, t('oppLeft')),
      h('div', { class: 'menu' }, button(t('toTitle'), () => this.showModes(), 'primary')),
    );
    this.show('left', el, () => this.showModes());
  }

  private showResultOffline(winner: number) {
    this.resultShown = true;
    const el = h('div', { class: 'screen' },
      h('h2', {}, winner === this.online?.localSide || this.online === null ? t('youWin') : t('youLose')),
      h('div', { class: 'menu' }, button(t('toTitle'), () => this.quitToModes(), 'primary')),
    );
    this.show('result', el, () => this.quitToModes());
  }

  private leaveOnline() {
    this.onlineToken++;
    this.online?.close();
    this.online = null;
    history.replaceState(null, '', location.pathname);
    this.startDemo();
    this.showOnlineMenu();
  }

  private onlinePanels: { sync: () => void } | null = null;

  private showOnlineCharSelect() {
    const o = this.online;
    if (!o) return;
    this.startDemo();
    const list = allCharacters();
    const idxOf = (id: string) => Math.max(0, list.findIndex((c) => c.id === id));
    const me = o.localSide;
    const slots: [CharSlot, CharSlot] = [
      { idx: idxOf(o.localChar), ready: false, ctrl: 'human' },
      { idx: idxOf(o.remoteChar), ready: false, ctrl: 'remote' },
    ];
    if (me === 1) slots.reverse();
    const panels = this.buildCharPanels(list, slots, [true, true], (side, action) => {
      if (side !== me) return;
      const s = slots[side];
      if (action === 'ok') s.ready = !s.ready;
      else if (!s.ready) s.idx = typeof action === 'number' ? action : (s.idx + (action === 'left' ? list.length - 1 : 1)) % list.length;
      audio.blip(action !== 'left');
      o.setChar(list[s.idx].id, s.ready);
      panels.refresh();
    });
    this.onlinePanels = {
      sync: () => {
        const r = slots[1 - me];
        r.idx = hasCharacter(o.remoteChar) ? idxOf(o.remoteChar) : idxOf(DEFAULT_CHARACTER);
        r.ready = o.remoteReady;
        panels.refresh();
      },
    };
    this.onlinePanels.sync();
    const el = h('div', { class: 'screen wide' },
      h('h2', {}, `${t('connected')} · ${t('chooseChar')}`),
      panels.el,
      h('p', { class: 'help' }, `${t('confirmHint')} · ${t('hostRules')}`),
      h('div', { class: 'menu row' }, button(t('back'), () => this.leaveOnline(), 'secondary')),
    );
    this.show('onlineChar', el, () => this.leaveOnline());
    this.menuKeyHandler = (a) => {
      if (a === 'left' || a === 'right' || a === 'ok') panels.act(me, a);
    };
    o.setChar(list[slots[me].idx].id, false);
  }

  /** 斷線重連後：保留比分，倒數 3 秒後繼續 */
  private onlineResume() {
    const o = this.online;
    if (!o?.session) return;
    this.hideToast();
    this.onlineStarted = false;
    this.state = this.prev = o.session.state;
    this.toast(t('reconnected'), [], 2500);
    this.runCountdown();
  }

  private onlineCountdown(info: StartInfo) {
    this.mode = 'online';
    this.rollLook();
    this.chars = info.chars;
    this.resultShown = false;
    this.onlineStarted = false;
    this.ais = [null, null];
    this.state = this.prev = this.online!.session!.state;
    this.setInMatch(true);
    this.renderHud();
    this.runCountdown();
  }

  private countdownTimer: number | null = null;

  /** 3、2、1 倒數後開始推進線上模擬 */
  private runCountdown() {
    if (this.countdownTimer !== null) clearInterval(this.countdownTimer);
    let n = 3;
    const banner = h('div', { class: 'banner' }, String(n));
    this.clearScreen();
    this.overlay.replaceChildren(banner);
    this.countdownTimer = window.setInterval(() => {
      n--;
      if (n > 0) {
        banner.textContent = String(n);
        audio.blip();
      } else {
        clearInterval(this.countdownTimer!);
        this.countdownTimer = null;
        banner.remove();
        this.onlineStarted = true;
        this.acc = 0;
      }
    }, 1000);
  }

  // ---------------------------------------------------------------- toast
  private toastTimer: number | null = null;

  toast(text: string, actions: [string, () => void][] = [], ms = 2500) {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastEl.replaceChildren(h('span', {}, text), ...actions.map(([l, fn]) => button(l, fn, 'small')));
    this.toastEl.classList.add('show');
    if (ms > 0) this.toastTimer = window.setTimeout(() => this.hideToast(), ms);
  }

  hideToast() {
    this.toastEl.classList.remove('show');
  }
}

const app = new App();
if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;
void app.init();
