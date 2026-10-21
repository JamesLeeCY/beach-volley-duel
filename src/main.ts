import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { FPS_BY_SPEED } from './engine/constants';
import { createState, defaultConfig, step } from './engine/physics';
import { AiController, type Difficulty } from './engine/ai';
import { IN_LEFT, IN_RIGHT, Phase, type GameEvent, type GameState, type InputFrame, type MatchConfig, type Stats } from './engine/types';
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
import { FIRST_OPPONENT, STAGE_COUNT, STAGE_DIFFS, STAGE_SCENES, STAGE_TARGET, buildStages, loadBest, saveBest } from './ui/challenge';
import {
  applyKeymaps, canBind, cloneKeymap, DEFAULT_KEYMAP_1P, DEFAULT_KEYMAP_2P, Keyboard, KEY_ACTIONS, KEYMAP_1P, KEYMAP_2P,
  keyLabel, keymapSide, menuAction, rebind, SOLO_KEYMAP, type KeyAction, type KeyMap,
} from './input/keyboard';
import { initAnalytics, track } from './analytics';
import { CONSERVATION, CONSERVATION_SOURCE, DEX, HABITAT_ROWS, HIDDEN_CHARACTER, iucnLabel, isHome, protectedLabel, redlistLabel, type Habitat } from './data/dex';
import { dailyFor, emojiLine, localDate, type Daily, type DailyRule, type Rally } from './ui/daily';
import { ROUTE, TOUR_TARGET, nextStation, stationHost, stationLevel } from './ui/tour';
import {
  ACHIEVEMENTS, COSMETICS, STAR_REWARDS, ensureTasks, exportCode, importCode, loadProgress, markDaily, ownedCosmetics, recordMatch,
  saveProgress, type Cosmetic, type MatchRecord, type Task, type TaskKind,
} from './ui/progress';
import { paintHat } from './render/extras';
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
  beach: 'bright', zoo: 'bright', expo: 'bright', ntu: 'bright', kinmen: 'bright',
  lake: 'dusk', tamsui: 'dusk', songshan: 'dusk',
  comet: 'night', taipei: 'night',
  yangming: 'mountain', wuling: 'mountain',
};

/** 選角操作：上下左右移動游標、確認，或直接點選第幾個角色 */
type CharAction = 'left' | 'right' | 'up' | 'down' | 'ok' | number;

const HABITAT_LABELS: Record<Habitat, MsgKey> = { forest: 'habForest', night: 'habNight', sky: 'habSky', water: 'habWater' };
const DAILY_RULE_LABELS: Record<DailyRule, MsgKey> = {
  none: 'ruleNone', wind: 'ruleWind', night: 'ruleNight', melon: 'ruleMelon', boba: 'ruleBoba',
};
const TASK_LABELS: Record<TaskKind, MsgKey> = {
  winWith: 'taskWinWith', playAt: 'taskPlayAt', spikes: 'taskSpikes', dives: 'taskDives', daily: 'taskDaily', win: 'taskWin',
};

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
  chars: [string, string] = ['shishi', 'meimei'];
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
  /** 玩家進度（解鎖、集章、成就…） */
  progress = loadProgress();
  /** 正在打的每日挑戰／環島站 */
  daily: Daily | null = null;
  tour: { idx: number; hard: boolean } | null = null;
  /** 第一場比賽的場上提示 */
  coach: Coach | null = null;
  private coachEl: HTMLDivElement | null = null;
  private touchSeen = false;
  private needRefresh: ((reload?: boolean) => Promise<void>) | null = null;

  async init() {
    installErrorLog();
    setLang(this.settings.lang);
    this.difficulty = this.settings.difficulty;
    this.humanSide = this.settings.cpuSide;
    initAnalytics();
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
        onNeedRefresh: () => this.applyUpdate(),
        onOfflineReady: () => this.toast(t('offlineReady')),
        // 分頁一直開著時，每 30 分鐘檢查一次有沒有新版本
        onRegisteredSW: (_url, reg) => reg && setInterval(() => void reg.update().catch(() => {}), 30 * 60_000),
      });
    } catch {
      // 開發模式或不支援
    }
    try {
      if (sessionStorage.getItem('bvd.updated')) {
        sessionStorage.removeItem('bvd.updated');
        setTimeout(() => this.toast(t('updated'), [], 2500), 800);
      }
    } catch {
      // 忽略
    }
  }

  /**
   * 有新版本：不在比賽中、也不在線上房間時直接換成新版（不再詢問，避免玩家按「稍後」一直玩舊版）。
   * 比賽或連線中就等回到選單再換。
   */
  private applyUpdate() {
    if (this.mode !== 'demo' || this.online || this.screenName === 'settings') {
      setTimeout(() => this.applyUpdate(), 3000);
      return;
    }
    try {
      sessionStorage.setItem('bvd.updated', '1');
    } catch {
      // 忽略
    }
    void this.needRefresh?.(true);
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
    this.checkOrientation();
  }

  // ---------------------------------------------------------------- 手機直式／橫式
  private isPortraitTouch() {
    return isTouchDevice() && innerHeight > innerWidth;
  }

  /** 等手機轉成橫向後才執行（按下任何遊戲模式時就先提示，不要等選完角） */
  private pendingLandscape: (() => void) | null = null;

  private requireLandscape(action: () => void) {
    if (!this.isPortraitTouch()) {
      action();
      return;
    }
    this.pendingLandscape = action;
    document.body.classList.add('want-landscape');
    // 手機鎖定直向、轉不過來時可以取消
    const hint = $('#rotate-hint');
    let cancel = hint.querySelector<HTMLButtonElement>('.rotate-cancel');
    if (!cancel) {
      cancel = button(t('back'), () => {
        this.pendingLandscape = null;
        document.body.classList.remove('want-landscape');
      }, 'secondary small rotate-cancel');
      hint.append(cancel);
    }
    this.enterFullscreen();
  }

  /** 本機比賽中轉成直式：暫停；轉回橫式後倒數 3、2、1 再繼續 */
  private rotatePaused = false;

  private checkOrientation() {
    const portrait = this.isPortraitTouch();
    if (!portrait && this.pendingLandscape) {
      const fn = this.pendingLandscape;
      this.pendingLandscape = null;
      document.body.classList.remove('want-landscape');
      fn();
    }
    if (!this.isLocalMatch() || this.resultShown) return;
    if (portrait && !this.rotatePaused && !this.screenName) {
      this.rotatePaused = true;
      this.paused = true;
    } else if (!portrait && this.rotatePaused) {
      this.rotatePaused = false;
      this.localCountdown();
    }
  }

  /** 本機比賽暫停中倒數 3、2、1 後繼續 */
  private localCountdown(then?: () => void) {
    this.paused = true;
    if (this.countdownTimer !== null) clearInterval(this.countdownTimer);
    let n = 3;
    const banner = h('div', { class: 'banner' }, String(n));
    this.overlay.replaceChildren(banner);
    this.screenName = '';
    this.countdownTimer = window.setInterval(() => {
      n--;
      if (n > 0) {
        banner.textContent = String(n);
        audio.blip();
        return;
      }
      clearInterval(this.countdownTimer!);
      this.countdownTimer = null;
      banner.remove();
      this.paused = false;
      this.acc = 0;
      then?.();
    }, 1000);
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
      hats: this.hats(),
      night: this.mode !== 'demo' && this.daily?.rule === 'night',
    };
    this.renderer.draw(this.prev, this.state, this.paused ? 1 : this.acc / stepMs, view, now);
  }

  /** 頭上的造型：只戴在自己的角色上（同機雙人戴在 1P） */
  private hats(): [string | null, string | null] {
    const hat = this.progress.cosmetics.equipped;
    if (!hat || this.mode === 'demo' || !ownedCosmetics(this.progress).includes(hat as Cosmetic)) return [null, null];
    const me = this.mode === 'online' && this.online ? this.online.localSide : this.mode === 'local' ? 0 : this.humanSide;
    return me === 0 ? [hat, null] : [null, hat];
  }

  private humanInput(): InputFrame {
    return (
      this.keyboard.read(KEYMAP_1P) | this.keyboard.read(KEYMAP_2P) | this.keyboard.read(SOLO_KEYMAP) |
      this.touch.read() | readGamepad(0) | readGamepad(1)
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
    if (this.mode !== 'demo') this.countEvents(this.state.events, this.mode === 'local' ? 0 : this.humanSide);
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
    // 每日挑戰的特殊球
    if (this.daily?.rule === 'melon' || this.daily?.rule === 'boba') this.ball = this.daily.rule;
    // 能力值：平衡模式時都是 0；在自己的主場（棲地場景）速度 +1
    const homeBonus: string[] = [];
    const stats = ([0, 1] as const).map((i) => {
      const st: Stats = this.settings.balance ? { speed: 0, jump: 0, power: 0 } : statsOf(this.chars[i]);
      // 電腦在新手、入門、簡單難度時不吃主場加成，讓前幾場維持好打
      const cpuEasy = mode === 'cpu' && i !== this.humanSide && ['rookie', 'beginner', 'easy'].includes(this.difficulty);
      if (mode !== 'practice' && !cpuEasy && isHome(this.chars[i], this.scene)) {
        st.speed = Math.min(2, st.speed + 1);
        homeBonus.push(displayName(getCharacter(this.chars[i]), getLang()));
      }
      return st;
    }) as [Stats, Stats];
    this.cfg = defaultConfig({
      targetScore: opts.target ?? this.settings.targetScore,
      practice: mode === 'practice',
      balance: false,
      stats,
      wind: this.daily?.rule === 'wind' ? 6 : 0,
    });
    this.resetMatchStats();
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
    else if (homeBonus.length) this.toast(t('homeBonus', { name: homeBonus.join('、'), scene: t(App.SCENE_LABELS[this.scene]) }), [], 3000);
    if (this.daily?.rule === 'wind') this.toast(t('ruleWind'), [], 3000);
    track('match_start', { mode: this.challenge ? 'challenge' : this.dare ? 'dare' : mode, n: this.settings.matchesPlayed });
    // 前 3 場開打前先暫停 3 秒，疊上這台裝置的按鍵說明
    if (mode !== 'practice' && this.settings.matchesPlayed < 3) this.showControlsCard();
  }

  /** 開打前的按鍵說明卡（鍵盤／觸控各自的說明），3 秒後自動開始 */
  private showControlsCard() {
    const k = (m: KeyMap, a: KeyAction) => m[a].map(keyLabel).join('/');
    const rows: [string, string][] = isTouchDevice()
      ? [[t('ctlMove'), t('ctlMoveTouch')], [t('ctlJump'), t('ctlJumpTouch')], [t('ctlHit'), t('ctlHitTouch')]]
      : [
        [t('ctlMove'), `${k(KEYMAP_1P, 'left')} ${k(KEYMAP_1P, 'right')} ／ ← →`],
        [t('ctlJump'), `${k(KEYMAP_1P, 'up')} ／ ↑`],
        [t('ctlHit'), `${k(KEYMAP_1P, 'hit')} ／ ${t('ctlSpace')} ／ J`],
      ];
    if (this.mode === 'local') rows.splice(0, 3, [t('ctl1p'), `${k(KEYMAP_1P, 'left')} ${k(KEYMAP_1P, 'right')} ${k(KEYMAP_1P, 'up')} ＋ ${k(KEYMAP_1P, 'hit')}`],
      [t('ctl2p'), `← → ↑ ＋ ${k(KEYMAP_2P, 'hit')}`]);
    const card = h('div', { class: 'controls-card' },
      h('b', {}, t('ctlTitle')),
      h('table', {}, ...rows.map(([a, b]) => h('tr', {}, h('th', {}, a), h('td', {}, b)))),
      h('p', {}, t('ctlSpike')),
    );
    // 卡片下方倒數 3、2、1，倒數完直接發球
    this.localCountdown();
    this.overlay.prepend(card);
    const stop = window.setInterval(() => {
      if (!this.paused || !card.isConnected) {
        clearInterval(stop);
        card.remove();
      }
    }, 100);
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
    // 前 5 場在觸控按鈕上顯示「跳」「擊球」
    this.touch.setLabels(this.settings.matchesPlayed < 5 ? [t('ctlJump'), t('ctlHit')] : null);
    this.touch2.setLabels(this.settings.matchesPlayed < 5 ? [t('ctlJump'), t('ctlHit')] : null);
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
    if (code === 'Escape' && this.modalClose) {
      this.modalClose();
      return;
    }
    if (code === 'Escape') {
      if (this.isLocalMatch() && !this.screenName) this.showPause();
      else if (this.screenName === 'pause') this.resume();
      else this.backHandler?.();
      return;
    }
    // P 暫停（空白鍵在單人模式是擊球鍵）
    if (code === 'KeyP' && this.isLocalMatch() && (!this.screenName || this.screenName === 'pause')) {
      if (this.screenName === 'pause') this.resume();
      else if (!this.paused) this.showPause();
      return;
    }
    // 選單：Enter／空白鍵按下目前選取的按鈕
    if ((code === 'Enter' || code === 'Space' || code === 'NumpadEnter') && this.screenName) {
      const f = document.activeElement;
      if (f instanceof HTMLButtonElement && this.overlay.contains(f)) {
        e.preventDefault();
        f.click();
        return;
      }
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
        button(`▶ ${t('start')}`, () => this.requireLandscape(() => this.quickStart()), 'primary big'),
        button(t('moreModes'), () => this.showModes(), 'secondary'),
      ),
      h('p', { class: 'help' }, t(isTouchDevice() ? 'quickHintTouch' : 'quickHint')),
    );
    this.show('title', el);
  }

  /** 標題畫面的「開始」：用上次的角色（或預設角色）和隨機對手直接開打 */
  quickStart() {
    audio.unlock();
    this.endTutorial();
    this.challenge = null;
    this.dare = null;
    this.daily = null;
    this.tour = null;
    const me = hasCharacter(this.settings.lastChar) && this.isUnlocked(this.settings.lastChar) ? this.settings.lastChar : DEFAULT_CHARACTER;
    const first = !this.settings.firstMatchDone;
    const others = this.selectableIds().filter((id) => id !== me && !getCharacter(id).local);
    // 第一場固定對梅梅（和闖關第 1 關一樣），之後隨機
    const opp = first ? (me === FIRST_OPPONENT ? 'shishi' : FIRST_OPPONENT) : others[(Math.random() * others.length) | 0];
    this.chars = [me, opp ?? me];
    this.humanSide = 0;
    // 第一場：最簡單的電腦、5 分短賽，邊打邊教
    if (first) this.difficulty = 'beginner';
    this.startLocalMatch('cpu', first ? { target: 5 } : {});
    if (first) this.startCoach();
  }

  showModes() {
    audio.unlock();
    if (this.mode !== 'demo') this.startDemo();
    const smallTouch = isTouchDevice() && Math.min(innerWidth, innerHeight) < 600;
    const land = (fn: () => void) => this.requireLandscape(fn);
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
    const newbie = this.settings.matchesPlayed < 3;
    const d = this.todayDaily();
    const dailyDone = !!this.progress.daily.played[d.date];
    const tourStamps = this.progress.tour.stamps.length;
    const el = h('div', { class: 'screen modes-screen' },
      h('h1', {}, t('title')),
      // 新手最需要的「教學」放在最上面（打過幾場後才把對戰電腦放第一）
      newbie ? h('div', { class: 'menu' }, button(`🎓 ${t('tutorial')}`, () => land(() => this.startTutorial()), 'primary')) : null,
      h('div', { class: 'menu grid2' },
        button(t('vsCpu'), () => land(() => this.showCharSelect('cpu')), newbie ? 'secondary' : 'primary'),
        button(`📅 ${t('daily')} #${d.no}${dailyDone ? ' ✔' : ''}${this.progress.daily.streak ? ` 🔥${this.progress.daily.streak}` : ''}`, () => this.showDaily(), newbie ? 'secondary' : 'primary'),
        button(`🗺️ ${t('tour')} ${tourStamps}/${ROUTE.length}`, () => this.showTour(), 'secondary'),
        button(t('challenge'), () => land(() => this.showCharSelect('challenge')), 'secondary'),
        smallTouch ? null : button(t('local2p'), () => land(() => this.showCharSelect('local')), 'secondary'),
        button(t('online'), () => this.showOnlineMenu(), 'secondary'),
        button(t('practice'), () => land(() => this.showCharSelect('practice')), 'secondary'),
        newbie ? null : button(`🎓 ${t('tutorial')}`, () => land(() => this.startTutorial()), 'secondary'),
      ),
      h('div', { class: 'menu row' },
        button(`📖 ${t('dex')}`, () => this.showDex(), 'secondary small'),
        button(`🏅 ${t('achievements')}`, () => this.showAchievements(), 'secondary small'),
        button(t('settings'), () => this.showSettings(() => this.showModes()), 'secondary small'),
        button(t('help'), () => this.showHelp(), 'secondary small'),
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

  /** 角色是否可以選（隱藏角色要先解鎖） */
  isUnlocked(id: string) {
    const pack = getCharacter(id);
    return !pack.manifest.hidden || this.progress.unlocked.includes(id);
  }

  /** 選得到的角色（不含還沒解鎖的隱藏角色） */
  private selectableIds() {
    return allCharacters().filter((c) => this.isUnlocked(c.id)).map((c) => c.id);
  }

  /**
   * 角色選擇（本機模式）：4×4 格子，一排一種棲地。
   * 單人模式：點格子＝選角，再點一次（或按下方「開始」、擊球鍵、Enter）＝確定。
   * 同機雙人：1P 用 WASD＋T、2P 用方向鍵＋M，各自一個游標；點滑鼠時由還沒準備好的玩家選。
   */
  showCharSelect(mode: 'cpu' | 'local' | 'practice' | 'challenge' | 'tour') {
    const list = allCharacters();
    const idxOf = (id: string) => Math.max(0, list.findIndex((c) => c.id === id));
    const single = mode !== 'local';
    if (mode === 'cpu') this.humanSide = this.settings.cpuSide;
    else if (single) this.humanSide = 0;
    const me = single ? this.humanSide : 0;
    const remembered = hasCharacter(this.settings.lastChar) && this.isUnlocked(this.settings.lastChar) ? this.settings.lastChar : DEFAULT_CHARACTER;
    const slots: [CharSlot, CharSlot] = [
      { idx: idxOf(this.chars[0]), ready: false, ctrl: 'human' },
      { idx: idxOf(this.chars[1]), ready: false, ctrl: 'human' },
    ];
    slots[me].idx = idxOf(this.isUnlocked(remembered) ? remembered : DEFAULT_CHARACTER);
    if (single) {
      const cpu = slots[1 - me];
      cpu.ctrl = 'cpu';
      cpu.ready = true;
      const pool = this.selectableIds().filter((id) => id !== list[slots[me].idx].id);
      cpu.idx = idxOf(pool[(Math.random() * pool.length) | 0] ?? list[0].id);
    }
    const finish = () => {
      this.chars = [list[slots[0].idx].id, list[slots[1].idx].id];
      this.dare = null;
      this.settings.lastChar = this.chars[me];
      saveSettings(this.settings);
      if (mode === 'challenge') this.startChallenge(this.chars[me]);
      else if (mode === 'tour') this.showTour();
      else this.startLocalMatch(mode);
    };
    let finishing = false;
    const grid = this.buildCharGrid(list, slots, single ? [me === 0, me === 1] : [true, true], (side, action) => {
      const s = slots[side];
      if (finishing) return;
      if (action === 'ok') {
        if (!this.isUnlocked(list[s.idx].id)) {
          audio.blip(false);
          grid.refresh();
          return;
        }
        if (single) s.ready = true;
        else s.ready = !s.ready;
      } else if (!s.ready) {
        if (typeof action === 'number') {
          // 單人模式點已選的格子＝確定
          if (single && action === s.idx && this.isUnlocked(list[action].id)) s.ready = true;
          s.idx = action;
        } else s.idx = grid.move(s.idx, action);
      }
      audio.blip(action !== 'left' && action !== 'up');
      grid.refresh();
      if (slots[0].ready && slots[1].ready) {
        finishing = true;
        setTimeout(finish, 220);
      }
    });
    const difficulty = mode === 'cpu'
      ? segmented<Difficulty>([
        { value: 'beginner', label: t('beginner') }, { value: 'easy', label: t('easy') },
        { value: 'normal', label: t('normal') }, { value: 'hard', label: t('hard') },
      ], this.difficulty === 'rookie' ? 'beginner' : this.difficulty, (v) => {
        this.difficulty = v;
        this.settings.difficulty = v;
        saveSettings(this.settings);
      })
      : null;
    const back = () => (mode === 'tour' ? this.showTour() : this.showModes());
    const startBtn = single ? button(`▶ ${t('start')}`, () => grid.act(me, 'ok'), 'primary') : null;
    const dice = button('🎲', () => {
      const pool = this.selectableIds();
      for (const side of [0, 1] as const) {
        if (slots[side].ctrl !== 'human' || slots[side].ready) continue;
        slots[side].idx = idxOf(pool[(Math.random() * pool.length) | 0]);
      }
      audio.blip(true);
      grid.refresh();
    }, 'secondary small');
    dice.title = t('randomChar');
    const looks = h('details', { class: 'look-details' },
      h('summary', {}, `${t('scene')}／${t('ballSkin')}`),
      this.lookPickers(),
    );
    const el = h('div', { class: 'screen wide charsel' },
      h('div', { class: 'charsel-body' },
        h('h2', {}, mode === 'tour' ? t('tourPick') : t('chooseChar')),
        grid.el,
        mode === 'tour' ? null : looks,
      ),
      h('div', { class: 'charsel-foot' },
        button(t('back'), back, 'secondary small'),
        dice,
        difficulty ? h('div', { class: 'foot-diff' }, difficulty) : null,
        startBtn ?? h('span', { class: 'help' }, t('confirmHint2p')),
      ),
    );
    this.show('charSelect', el, back);
    this.menuKeyHandler = (a, side) => {
      const target: 0 | 1 = mode === 'local' ? (side ?? 0) : me;
      grid.act(target, a);
    };
  }

  /**
   * 4×4 角色格子＋每位玩家的資訊卡（動畫、名字・物種、能力值、準備狀態）。
   * act(side, action)：action 是方向、'ok'，或直接點的第幾格。
   */
  private buildCharGrid(
    list: CharacterPack[],
    slots: [CharSlot, CharSlot],
    visible: [boolean, boolean],
    act: (side: 0 | 1, action: CharAction) => void,
  ) {
    const lang = getLang();
    // 點格子：單人時是自己；雙人時由還沒準備好的玩家（1P 優先）選
    const clickSide = (): 0 | 1 | null => {
      const humans = ([0, 1] as const).filter((s) => slots[s].ctrl === 'human' && visible[s]);
      return humans.find((s) => !slots[s].ready) ?? humans[0] ?? null;
    };
    const cells = list.map((pack, i) => {
      const locked = !this.isUnlocked(pack.id);
      const b = h('button', {
        type: 'button', class: `cell${locked ? ' locked' : ''}`, 'data-id': pack.id,
        title: locked ? '？？？' : displayName(pack, lang),
        onclick: () => {
          const s = clickSide();
          if (s !== null) act(s, i);
        },
      });
      if (pack.portrait) b.append(h('img', { src: pack.portrait, alt: '', draggable: 'false' }));
      else b.style.background = pack.manifest.themeColor;
      b.append(h('span', { class: 'cell-name' }, locked ? '？？？' : displayName(pack, lang)));
      b.style.setProperty('--theme', pack.manifest.themeColor);
      return b;
    });
    // 一排一種棲地；不在圖鑑排列裡的（匯入的角色）放最後一排
    const rows: HTMLElement[] = [];
    const used = new Set<string>();
    for (const row of HABITAT_ROWS) {
      const items = row.ids.map((id) => list.findIndex((c) => c.id === id)).filter((i) => i >= 0);
      if (!items.length) continue;
      items.forEach((i) => used.add(list[i].id));
      rows.push(h('div', { class: 'grid-row' }, h('span', { class: 'row-label' }, t(HABITAT_LABELS[row.id])), ...items.map((i) => cells[i])));
    }
    const extra = list.map((c, i) => (used.has(c.id) ? -1 : i)).filter((i) => i >= 0);
    for (let k = 0; k < extra.length; k += 4) {
      rows.push(h('div', { class: 'grid-row' }, h('span', { class: 'row-label' }, k ? '' : t('packs')), ...extra.slice(k, k + 4).map((i) => cells[i])));
    }
    const gridEl = h('div', { class: 'char-grid' }, ...rows);
    // 畫面上的排列順序（list 的索引）：游標依這個順序移動
    const order: number[] = [];
    for (const row of HABITAT_ROWS) for (const id of row.ids) {
      const i = list.findIndex((c) => c.id === id);
      if (i >= 0) order.push(i);
    }
    order.push(...extra);
    const COLS = 4;
    /** ← → 在同一排移動，走到邊緣換排；↑ ↓ 換排，最上面再往上回到最下面 */
    const move = (idx: number, dir: 'left' | 'right' | 'up' | 'down') => {
      const n = order.length;
      const pos = Math.max(0, order.indexOf(idx));
      const rowsN = Math.ceil(n / COLS);
      const r = Math.floor(pos / COLS), c = pos % COLS;
      let np = pos;
      if (dir === 'left') np = (pos - 1 + n) % n;
      else if (dir === 'right') np = (pos + 1) % n;
      else np = Math.min(n - 1, (((r + (dir === 'up' ? -1 : 1)) % rowsN + rowsN) % rowsN) * COLS + c);
      return order[np];
    };

    const infos = ([0, 1] as const).map((side) => {
      const canvas = h('canvas', { width: 96, height: 96 });
      const name = h('div', { class: 'name' });
      const species = h('div', { class: 'species' });
      const stats = h('div', { class: 'stats' });
      const status = h('div', { class: 'status' });
      const who = h('div', { class: 'who' });
      const okBtn = button(t('readyBtn'), () => slots[side].ctrl === 'human' && act(side, 'ok'), 'small');
      const dexBtn = button('📖', () => this.openDexCard(list[slots[side].idx].id), 'secondary small');
      dexBtn.append(h('span', { class: 'lbl' }, ` ${t('dex')}`));
      dexBtn.title = t('dex');
      const root = h('div', { class: `char-info p${side + 1}` },
        h('div', { class: 'info-pic' }, canvas),
        h('div', { class: 'info-text' }, who, name, species, stats, h('div', { class: 'info-btns' }, status, okBtn, dexBtn)),
      );
      if (!visible[side] && slots[side].ctrl === 'human') root.style.display = 'none';
      return { root, canvas, name, species, stats, status, who, okBtn, dexBtn };
    });
    const infoRow = h('div', { class: 'char-infos' }, ...infos.map((x) => x.root));
    const wrap = h('div', { class: 'char-select-grid' }, gridEl, infoRow);

    const draw = (time: number) => {
      infos.forEach((p, side) => {
        const pack = list[slots[side].idx];
        const g = p.canvas.getContext('2d')!;
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.clearRect(0, 0, 96, 96);
        const locked = !this.isUnlocked(pack.id);
        if (pack.sprite) {
          const anim = slots[side].ready ? pack.manifest.animations.win ?? pack.manifest.animations.idle : pack.manifest.animations.idle;
          const fi = Math.floor((time / 1000) * anim.fps) % anim.frames;
          const [fw, fh] = pack.manifest.frameSize;
          g.save();
          if (side === 1) {
            g.translate(96, 0);
            g.scale(-1, 1);
          }
          if (locked) g.filter = 'brightness(0) opacity(0.75)';
          g.drawImage(pack.sprite, fi * fw, anim.row * fh, fw, fh, 0, 0, 96, 96);
          g.restore();
        } else {
          g.fillStyle = pack.manifest.themeColor;
          g.beginPath();
          g.arc(48, 54, 36, 0, Math.PI * 2);
          g.fill();
        }
      });
      if (wrap.isConnected) requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);

    const statBar = (label: string, v: number) => {
      const bar = h('div', { class: 'bar' });
      for (let i = -2; i <= 2; i++) bar.append(h('i', { class: i <= v ? 'on' : '' }));
      return h('div', { class: 'stat' }, h('span', {}, label), bar);
    };
    const refresh = () => {
      cells.forEach((c) => c.classList.remove('p1', 'p2'));
      infos.forEach((p, side) => {
        const s = slots[side];
        const pack = list[s.idx];
        const locked = !this.isUnlocked(pack.id);
        if (visible[side] || s.ctrl !== 'cpu') cells[s.idx].classList.add(`p${side + 1}`);
        p.root.classList.toggle('ready', s.ready);
        p.root.style.borderColor = pack.manifest.themeColor;
        p.who.textContent = `${side === 0 ? '1P' : '2P'} · ${s.ctrl === 'cpu' ? t('cpu') : s.ctrl === 'remote' ? t('opponent') : t('you')}`;
        p.name.textContent = locked ? '？？？' : displayName(pack, lang);
        const sp = pack.manifest.species;
        p.species.textContent = locked ? t('lockedHint') : sp ? sp[lang] ?? sp.en ?? '' : '';
        const st = pack.manifest.stats;
        p.stats.replaceChildren(
          ...(locked ? [] : [statBar(t('speed'), st.speed), statBar(t('jump'), st.jump), statBar(t('power'), st.power)]),
          ...(!locked && st.dive ? [statBar(t('diveStat'), st.dive)] : []),
        );
        p.status.textContent = s.ready ? t('ready') : t('notReady');
        p.status.classList.toggle('ready', s.ready);
        // 單人模式用下方的「開始」；同機雙人與線上才在資訊卡上顯示「準備」
        p.okBtn.style.display = s.ctrl === 'human' && slots[1 - side].ctrl !== 'cpu' ? '' : 'none';
        p.okBtn.textContent = s.ready ? '✕' : t('readyBtn');
        p.okBtn.disabled = locked;
        p.dexBtn.style.display = locked || !DEX[pack.id] ? 'none' : '';
      });
      // 單人模式只有一位玩家的格子可以點；對手（電腦／遠端）準備好或還沒都不影響
      for (const c of cells) c.disabled = false;
      const focusIdx = slots[clickSide() ?? 0].idx;
      const strip = cells[focusIdx];
      strip.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    };
    refresh();
    return { el: wrap, refresh, act, move };
  }

  // ---------------------------------------------------------------- 場景／排球選擇
  private static readonly SCENE_LABELS: Record<SceneId, MsgKey> = {
    beach: 'sceneBeach', lake: 'sceneLake', comet: 'sceneComet', taipei: 'sceneTaipei', zoo: 'sceneZoo',
    ntu: 'sceneNtu', songshan: 'sceneSongshan', expo: 'sceneExpo', yangming: 'sceneYangming', tamsui: 'sceneTamsui',
    kinmen: 'sceneKinmen', wuling: 'sceneWuling',
  };

  private static readonly BALL_LABELS: Record<BallSkin, MsgKey> = {
    classic: 'ballClassic', red: 'ballRed', blue: 'ballBlue', ultra: 'ballUltra', melon: 'ballMelon', boba: 'ballBoba',
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
      row(t('cpuSide'), segmented<0 | 1>([{ value: 0, label: t('left') }, { value: 1, label: t('right') }], s.cpuSide, (v) => {
        s.cpuSide = v;
        this.humanSide = v;
        save();
      })),
      row(t('progressCode'), h('div', { class: 'seg' },
        button(t('progressExport'), async () => {
          try {
            await navigator.clipboard.writeText(exportCode(this.progress));
            this.toast(t('copied'), [], 1800);
          } catch {
            // 不允許寫入剪貼簿：直接顯示讓玩家自己複製
            window.prompt(t('progressCode'), exportCode(this.progress));
          }
        }, 'small'),
        button(t('progressImport'), () => {
          const code = window.prompt(t('progressPaste'));
          if (!code) return;
          const p = importCode(code);
          if (!p) {
            this.toast(t('progressBad'), [], 2500);
            return;
          }
          this.progress = p;
          saveProgress(p);
          this.toast(t('progressImported'), [], 2500);
        }, 'small secondary'),
      )),
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
    this.daily = null;
    this.tour = null;
    this.modalClose?.();
    if (this.online) {
      this.online.close();
      this.online = null;
    }
    this.startDemo();
    this.showModes();
  }

  private showResult(winner: number) {
    this.resultShown = true;
    this.settings.matchesPlayed++;
    saveSettings(this.settings);
    {
      const me = this.mode === 'online' && this.online ? this.online.localSide : this.humanSide;
      track('match_end', {
        mode: this.challenge ? 'challenge' : this.dare ? 'dare' : this.mode,
        won: this.mode === 'local' ? true : winner === me,
        my: this.state.score[me], opp: this.state.score[1 - me], first: !!this.coach,
      });
    }
    const firstDone = !!this.coach;
    if (firstDone) {
      // 第一場（邊打邊教）打完了：之後按「開始」就是一般比賽
      this.endCoach();
      this.settings.firstMatchDone = true;
      saveSettings(this.settings);
    }
    const progressLines = this.recordProgress(winner);
    if (this.challenge && this.mode === 'cpu') {
      this.showStageResult(winner === this.humanSide, progressLines);
      return;
    }
    const winnerName = displayName(getCharacter(this.chars[winner]), getLang());
    let title = t('winner', { name: winnerName });
    if (this.mode === 'cpu') title = winner === this.humanSide ? t('youWin') : t('youLose');
    if (this.mode === 'online' && this.online) title = winner === this.online.localSide ? t('youWin') : t('youLose');
    const again = () => {
      track('rematch', { mode: this.mode });
      if (this.mode === 'online') {
        this.online?.requestRematch();
        againBtn.disabled = true;
        againBtn.textContent = t('waitRematch');
      } else if (this.dare) {
        this.startDare(this.dare);
      } else if (this.daily) {
        this.startDaily(this.daily);
      } else if (this.tour) {
        this.startTourStation(this.tour.idx, this.tour.hard);
      } else {
        this.startLocalMatch(this.mode as 'cpu' | 'local' | 'practice');
      }
    };
    const againBtn = button(this.daily ? t('dailyAgain') : t('rematch'), again, 'primary');
    const share = this.resultShare(winner);
    // 環島：贏了就前往下一站（全部蓋完看證書）
    let tourBtn: HTMLButtonElement | null = null;
    if (this.tour && winner === this.humanSide) {
      const tr = this.tour;
      const stamps = tr.hard ? this.progress.tour.hardStamps : this.progress.tour.stamps;
      const next = nextStation(stamps);
      tourBtn = next >= 0
        ? button(`▶ ${t('tourNext')}：${t(App.SCENE_LABELS[ROUTE[next].scene])}`, () => this.startTourStation(next, tr.hard), 'primary')
        : button(`📜 ${tr.hard ? t('tourCertHard') : t('tourCert')}`, () => this.showCertificate(tr.hard), 'primary');
      againBtn.className = 'secondary';
    }
    // 每日挑戰：Wordle 式的 emoji 戰績
    const dailyBox = this.daily
      ? h('div', {},
        h('p', { class: 'emoji-line' }, `#${this.daily.no} ${emojiLine(this.rallies)} ${share.mine[0]}:${share.mine[1]}`),
        this.dailyShareButtons(this.daily, emojiLine(this.rallies), share.mine),
      )
      : null;
    // 挑戰連結記錄這場實際的難度後，下一場電腦再升一級（入門 → 簡單）
    if (firstDone && this.difficulty === 'beginner') {
      this.difficulty = 'easy';
      this.settings.difficulty = 'easy';
      saveSettings(this.settings);
    }
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
      progressLines,
      dailyBox,
      // 矮螢幕（手機橫向）時戰績卡在左、按鈕在右
      h('div', { class: 'result-body' },
        this.daily ? null : share.preview,
        h('div', { class: 'result-actions' },
          h('div', { class: 'menu' }, tourBtn, againBtn),
          this.daily ? null : share.buttons,
          h('div', { class: 'menu row' },
            this.mode === 'cpu' && !this.daily && !this.tour ? button(t('changeLook'), () => {
              this.dare = null;
              this.showCharSelect('cpu');
            }, 'secondary small') : null,
            this.tour ? button(`🗺️ ${t('tour')}`, () => {
              this.startDemo();
              this.showTour();
            }, 'secondary small') : null,
            button(t('toTitle'), () => this.quitToModes(), 'secondary small'),
          ),
        ),
      ),
    );
    this.show('result', el, () => this.quitToModes());
    this.showPendingUnlock();
  }

  /** 剛解鎖的隱藏角色：跳出圖鑑卡片 */
  private showPendingUnlock() {
    const id = this.pendingUnlock;
    if (!id) return;
    this.pendingUnlock = null;
    track('unlock', { id });
    setTimeout(() => {
      this.toast(`🎉 ${t('unlockTitle')}`, [], 4000);
      this.openDexCard(id);
    }, 600);
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
        track('share', { kind: 'image', dare: canDare });
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
        track('share', { kind: 'copy', dare: canDare });
        this.toast(t('copied'), [], 1800);
      } catch {
        // 不允許寫入剪貼簿
      }
    }, 'secondary small');
    const buttons = h('div', { class: 'menu row share-row' },
      button(t('lineChallenge'), () => {
        track('share', { kind: 'line', dare: canDare });
        window.open(lineShareUrl(text), '_blank', 'noopener');
      }, 'line small'),
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
    track('tutorial_done');
    this.paused = true;
    const el = h('div', { class: 'screen' },
      h('h2', {}, t('tutDone')),
      h('p', {}, t('tutDoneText')),
      h('div', { class: 'menu' },
        button(t('vsCpu'), () => {
          this.endTutorial();
          this.showCharSelect('cpu');
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
    this.daily = null;
    this.tour = null;
    this.chars = [d.me, d.opp];
    this.humanSide = 0;
    this.difficulty = d.level;
    this.startLocalMatch('cpu', { target: d.target, scene: d.scene });
    if (!this.settings.firstMatchDone) this.startCoach();
  }

  // ---------------------------------------------------------------- 動物圖鑑
  /** 圖鑑：16 隻動物，一排一種棲地；還沒解鎖的隱藏角色是剪影 */
  showDex() {
    const lang = getLang();
    const rows = HABITAT_ROWS.map((row) => h('div', { class: 'grid-row' },
      h('span', { class: 'row-label' }, t(HABITAT_LABELS[row.id])),
      ...row.ids.filter((id) => hasCharacter(id)).map((id) => {
        const pack = getCharacter(id);
        const locked = !this.isUnlocked(id);
        const b = h('button', {
          type: 'button', class: `cell${locked ? ' locked' : ''}`,
          onclick: () => this.openDexCard(id),
        });
        if (pack.portrait) b.append(h('img', { src: pack.portrait, alt: '', draggable: 'false' }));
        b.append(h('span', { class: 'cell-name' }, locked ? '？？？' : pack.manifest.species?.[lang] ?? displayName(pack, lang)));
        b.style.setProperty('--theme', pack.manifest.themeColor);
        return b;
      }),
    ));
    const el = h('div', { class: 'screen wide' },
      h('h2', {}, `📖 ${t('dex')}`),
      h('p', { class: 'help' }, t('dexIntro')),
      h('div', { class: 'char-grid dex-grid' }, ...rows),
      h('p', { class: 'help source' }, t('dexSource', { date: CONSERVATION_SOURCE.fetched })),
      h('div', { class: 'menu row' }, button(t('back'), () => this.showModes(), 'secondary')),
    );
    this.show('dex', el, () => this.showModes());
  }

  /** 圖鑑卡片（蓋在目前畫面上，關掉後回到原本的畫面） */
  openDexCard(id: string) {
    const lang = getLang();
    const pack = getCharacter(id);
    const locked = !this.isUnlocked(id);
    const con = CONSERVATION[id];
    const entry = DEX[id];
    const close = () => {
      modal.remove();
      this.modalClose = null;
    };
    const row = (k: string, v: string, cls = '') => h('tr', { class: cls }, h('th', {}, k), h('td', {}, v));
    const pic = pack.portrait ? h('img', { src: pack.portrait, alt: '', class: `dex-pic${locked ? ' locked' : ''}` }) : null;
    const body = locked
      ? h('div', {}, h('h2', {}, '？？？'), h('p', {}, t('lockedHint')))
      : h('div', {},
        h('h2', {}, `${displayName(pack, lang)}・${pack.manifest.species?.[lang] ?? ''}`),
        con ? h('p', { class: 'sci' }, h('i', {}, con.scientificName)) : null,
        con ? h('table', { class: 'dex-table' },
          row(t('dexEndemic'), con.endemic ? `✔ ${t('yes')}` : '–'),
          row(t('dexProtected'), protectedLabel(con.protected, lang), con.protected ? 'warn' : ''),
          row(t('dexRedlist'), redlistLabel(con.redlist, lang), con.redlist && /CR|EN|RE/.test(con.redlist) ? 'warn' : ''),
          row('IUCN', iucnLabel(con.iucn, lang)),
          row('CITES', con.cites ? t('dexAppendix', { n: con.cites }) : '–'),
          entry ? row(t('dexHome'), entry.home.map((s) => t(App.SCENE_LABELS[s])).join('、')) : null,
        ) : null,
        entry ? h('ul', { class: 'trivia' }, ...entry.trivia.map((x) => h('li', {}, x[lang]))) : null,
        con ? h('p', { class: 'help source' }, t('dexSource', { date: CONSERVATION_SOURCE.fetched })) : null,
      );
    const modal: HTMLDivElement = h('div', { class: 'modal', onclick: (e: Event) => e.target === modal && close() },
      h('div', { class: 'screen dex-card' },
        h('div', { class: 'dex-head' }, pic, body),
        h('div', { class: 'menu row' }, button(t('close'), close, 'primary')),
      ),
    );
    this.modalClose?.();
    this.modalClose = close;
    $('#app').append(modal);
    modal.querySelector<HTMLButtonElement>('button.primary')?.focus({ preventScroll: true });
  }

  /** 目前開著的圖鑑卡片（Esc 先關它） */
  private modalClose: (() => void) | null = null;

  // ---------------------------------------------------------------- 每日挑戰
  private todayDaily(): Daily {
    const ids = HABITAT_ROWS.flatMap((r) => r.ids).filter((id) => hasCharacter(id) && id !== HIDDEN_CHARACTER);
    return dailyFor(localDate(), ids, SCENES);
  }

  showDaily() {
    const d = this.todayDaily();
    const p = this.progress.daily;
    const played = p.played[d.date];
    const packs = [getCharacter(d.me), getCharacter(d.opp)];
    const face = (pk: CharacterPack) => (pk.portrait ? h('img', { src: pk.portrait, class: 'stage-portrait', alt: '' }) : null);
    const lang = getLang();
    const el = h('div', { class: 'screen' },
      h('h2', {}, `📅 ${t('daily')} #${d.no}`),
      h('div', { class: 'dare-vs' }, face(packs[0]), h('b', {}, 'VS'), face(packs[1])),
      h('p', { class: 'sub' }, t('dailyText', {
        me: displayName(packs[0], lang), opp: displayName(packs[1], lang),
        scene: t(App.SCENE_LABELS[d.scene]), level: this.levelName(d.level),
      })),
      h('p', { class: 'daily-rule' }, `${t(DAILY_RULE_LABELS[d.rule])}`),
      h('p', {}, t('dailyStreak', { n: p.streak, best: p.best, m: p.makeups })),
      played ? h('p', { class: 'emoji-line' }, `${played.emoji} ${played.score[0]}:${played.score[1]}`) : null,
      h('div', { class: 'menu' },
        button(`▶ ${played ? t('dailyAgain') : t('start')}`, () => this.requireLandscape(() => this.startDaily(d)), 'primary big'),
        played ? this.dailyShareButtons(d, played.emoji, played.score) : null,
        button(t('back'), () => this.showModes(), 'secondary'),
      ),
    );
    this.show('daily', el, () => this.showModes());
  }

  private startDaily(d: Daily) {
    audio.unlock();
    this.endTutorial();
    this.challenge = null;
    this.dare = null;
    this.tour = null;
    this.daily = d;
    this.chars = [d.me, d.opp];
    this.humanSide = 0;
    this.difficulty = d.level;
    this.startLocalMatch('cpu', { target: d.target, scene: d.scene });
  }

  private dailyShareButtons(d: Daily, emoji: string, score: [number, number]) {
    const url = `${location.origin}${location.pathname}`;
    const text = `🏐 ${t('title')} #${d.no} ${emoji} ${score[0]}:${score[1]}\n${url}`;
    return h('div', { class: 'menu row share-row' },
      button(t('lineShare'), () => {
        track('share', { kind: 'daily_line' });
        window.open(lineShareUrl(text), '_blank', 'noopener');
      }, 'line small'),
      button(t('copyLink'), async () => {
        try {
          if (navigator.share && isTouchDevice()) await navigator.share({ text });
          else await navigator.clipboard.writeText(text);
          track('share', { kind: 'daily_copy' });
          this.toast(t('copied'), [], 1800);
        } catch {
          // 取消
        }
      }, 'secondary small'),
    );
  }

  // ---------------------------------------------------------------- 環島巡迴賽
  showTour() {
    const p = this.progress.tour;
    const hard = p.stamps.length >= ROUTE.length;
    const stamps = hard ? p.hardStamps : p.stamps;
    const next = nextStation(stamps);
    const me = hasCharacter(this.settings.lastChar) && this.isUnlocked(this.settings.lastChar) ? this.settings.lastChar : DEFAULT_CHARACTER;
    const lang = getLang();
    const map = h('ol', { class: 'tour-map' }, ...ROUTE.map((st, i) => {
      const done = stamps.includes(st.scene);
      const host = getCharacter(stationHost(st, me));
      return h('li', { class: `${done ? 'done' : ''}${i === next ? ' next' : ''}` },
        h('span', { class: 'stamp' }, done ? '🏐' : String(i + 1)),
        h('span', { class: 'st-name' }, t(App.SCENE_LABELS[st.scene])),
        h('span', { class: 'st-host' }, `${t('tourHost')} ${displayName(host, lang)}`),
      );
    }));
    const finished = next < 0;
    const el = h('div', { class: 'screen wide' },
      h('h2', {}, `🗺️ ${hard ? t('tourHard') : t('tour')}`),
      h('p', { class: 'help' }, t('tourIntro', { n: stamps.length, total: ROUTE.length })),
      map,
      h('div', { class: 'menu row' },
        finished ? null : button(`▶ ${t('tourGo', { name: t(App.SCENE_LABELS[ROUTE[next].scene]) })}`, () => this.requireLandscape(() => this.startTourStation(next, hard)), 'primary'),
        p.stamps.length >= ROUTE.length ? button(`📜 ${t('tourCert')}`, () => this.showCertificate(false), 'secondary') : null,
        p.hardStamps.length >= ROUTE.length ? button(`📜 ${t('tourCertHard')}`, () => this.showCertificate(true), 'secondary') : null,
      ),
      h('div', { class: 'menu row' },
        button(`${t('changeChar')}（${displayName(getCharacter(me), lang)}）`, () => this.showCharSelect('tour'), 'secondary small'),
        button(t('back'), () => this.showModes(), 'secondary small'),
      ),
    );
    this.show('tour', el, () => this.showModes());
  }

  private startTourStation(i: number, hard: boolean) {
    const st = ROUTE[i];
    const me = hasCharacter(this.settings.lastChar) && this.isUnlocked(this.settings.lastChar) ? this.settings.lastChar : DEFAULT_CHARACTER;
    audio.unlock();
    this.endTutorial();
    this.challenge = null;
    this.dare = null;
    this.daily = null;
    this.tour = { idx: i, hard };
    this.chars = [me, stationHost(st, me)];
    this.humanSide = 0;
    this.difficulty = stationLevel(st, hard);
    this.startLocalMatch('cpu', { target: TOUR_TARGET, scene: st.scene });
  }

  /** 環島證書：12 個章＋角色，可以分享成圖片 */
  private async showCertificate(hard: boolean) {
    const me = getCharacter(hasCharacter(this.settings.lastChar) ? this.settings.lastChar : DEFAULT_CHARACTER);
    const preview = h('div', { class: 'card-preview' });
    const el = h('div', { class: 'screen result-screen' },
      h('h2', {}, `📜 ${hard ? t('tourCertHard') : t('tourCert')}`),
      preview,
      h('div', { class: 'menu row share-row' },
        button(t('shareCard'), async () => {
          const { renderCertificate, cardBlob } = await import('./ui/sharecard');
          const c = await renderCertificate(this.certInfo(me, hard));
          const blob = await cardBlob(c);
          if (!blob) return;
          const file = new File([blob], 'taiwan-gold-volley-tour.png', { type: 'image/png' });
          const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
          track('share', { kind: 'certificate' });
          if (nav.share && nav.canShare?.({ files: [file] })) await nav.share({ files: [file], text: `${t('tourCert')} 🏐 ${location.origin}${location.pathname}` }).catch(() => {});
          else {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = file.name;
            a.click();
            this.toast(t('imageSaved'), [], 2500);
          }
        }, 'secondary small'),
        button(t('back'), () => this.showTour(), 'secondary small'),
      ),
    );
    this.show('certificate', el, () => this.showTour());
    const { renderCertificate } = await import('./ui/sharecard');
    const c = await renderCertificate(this.certInfo(me, hard));
    preview.replaceChildren(h('img', { src: c.toDataURL('image/jpeg', 0.85), alt: t('tourCert') }));
  }

  private certInfo(me: CharacterPack, hard: boolean) {
    return {
      title: hard ? t('tourCertHard') : t('tourCert'),
      name: displayName(me, getLang()),
      portrait: me.portrait,
      color: me.manifest.themeColor,
      stations: ROUTE.map((st) => ({ name: t(App.SCENE_LABELS[st.scene]), done: (hard ? this.progress.tour.hardStamps : this.progress.tour.stamps).includes(st.scene) })),
      footer: `${t('title')} · ${new Date().toLocaleDateString()}`,
      url: `${location.origin}${location.pathname}`,
    };
  }

  // ---------------------------------------------------------------- 成就、每日任務、造型
  showAchievements() {
    const p = this.progress;
    ensureTasks(p, localDate(), this.visibleIds(), SCENES);
    saveProgress(p);
    const lang = getLang();
    const taskText = (k: Task) => {
      const arg = k.kind === 'winWith' ? displayName(getCharacter(k.arg ?? DEFAULT_CHARACTER), lang)
        : k.kind === 'playAt' ? t(App.SCENE_LABELS[(k.arg ?? 'beach') as SceneId]) : '';
      return t(TASK_LABELS[k.kind], { arg, n: k.n ?? 1 });
    };
    const tasks = h('ul', { class: 'task-list' }, ...p.tasks.list.map((k) =>
      h('li', { class: k.done ? 'done' : '' }, `${k.done ? '⭐' : '☆'} ${taskText(k)}${k.n && !k.done ? `（${Math.min(k.have, k.n)}/${k.n}）` : ''}`)));
    const achs = h('ul', { class: 'ach-list' }, ...ACHIEVEMENTS.map((a) => {
      const got = !!p.ach[a.id];
      return h('li', { class: got ? 'done' : '' },
        h('b', {}, `${got ? '🏅' : '🔒'} ${t(`ach_${a.id}` as MsgKey)}`),
        h('span', {}, ` ${t(`achd_${a.id}` as MsgKey)}`),
        a.reward ? h('span', { class: 'reward' }, ` → ${t(`cos_${a.reward}` as MsgKey)}`) : null,
      );
    }));
    const owned = ownedCosmetics(p);
    if (p.cosmetics.equipped && !owned.includes(p.cosmetics.equipped as Cosmetic)) p.cosmetics.equipped = null;
    const wardrobe = h('div', { class: 'wardrobe' },
      ...[null, ...COSMETICS].map((c) => {
        const have = c === null || owned.includes(c);
        const b = button(c ? t(`cos_${c}` as MsgKey) : t('cosNone'), () => {
          if (!have) return;
          p.cosmetics.equipped = c;
          saveProgress(p);
          this.showAchievements();
        }, `small ${p.cosmetics.equipped === c ? 'on' : 'secondary'}`);
        if (!have) {
          b.disabled = true;
          const stars = c ? STAR_REWARDS[c] : undefined;
          b.title = stars ? t('cosStars', { n: stars }) : t('cosLocked');
          b.textContent = `🔒 ${b.textContent}`;
        }
        return b;
      }),
    );
    const me = getCharacter(hasCharacter(this.settings.lastChar) ? this.settings.lastChar : DEFAULT_CHARACTER);
    const prev = h('canvas', { width: 96, height: 96, class: 'wardrobe-preview' });
    this.paintWithHat(prev, me, p.cosmetics.equipped);
    const el = h('div', { class: 'screen wide' },
      h('h2', {}, `🏅 ${t('achievements')}`),
      h('h3', {}, `${t('todayTasks')} · ⭐ ${p.stars}`),
      tasks,
      h('h3', {}, t('wardrobe')),
      h('div', { class: 'wardrobe-row' }, prev, wardrobe),
      h('h3', {}, t('achTitle')),
      achs,
      h('div', { class: 'menu row' }, button(t('back'), () => this.showModes(), 'secondary')),
    );
    this.show('achievements', el, () => this.showModes());
  }

  /** 角色頭像＋造型的預覽 */
  private paintWithHat(c: HTMLCanvasElement, pack: CharacterPack, hat: string | null) {
    const g = c.getContext('2d')!;
    const draw = () => {
      g.clearRect(0, 0, c.width, c.height);
      if (!pack.sprite) return;
      const [fw, fh] = pack.manifest.frameSize;
      g.save();
      g.scale(c.width / 64, c.height / 64);
      g.imageSmoothingQuality = 'high';
      g.drawImage(pack.sprite, 0, 0, fw, fh, 0, 0, 64, 64);
      const head = hat ? pack.manifest.heads?.[0]?.[0] : null;
      if (hat && head) paintHat(g, hat, head[0], head[1], head[2]);
      g.restore();
    };
    if (pack.sprite?.complete) draw();
    else pack.sprite?.addEventListener('load', draw, { once: true });
  }

  /** 選得到、而且在圖鑑裡的角色（任務、成就用） */
  private visibleIds() {
    return HABITAT_ROWS.flatMap((r) => r.ids).filter((id) => hasCharacter(id) && id !== HIDDEN_CHARACTER);
  }

  // ---------------------------------------------------------------- 比賽結束：進度
  /** 記錄這場比賽的進度；回傳要顯示在結算畫面的訊息 */
  private recordProgress(winner: number): HTMLElement | null {
    if (this.mode === 'practice') return null;
    const p = this.progress;
    const meSide = this.mode === 'online' && this.online ? this.online.localSide : this.mode === 'local' ? 0 : this.humanSide;
    const won = winner === meSide;
    const date = localDate();
    const lines: string[] = [];
    const mode: MatchRecord['mode'] = this.daily ? 'daily' : this.tour ? 'tour' : this.challenge ? 'challenge' : this.dare ? 'dare'
      : this.mode === 'online' ? 'online' : this.mode === 'local' ? 'local' : 'cpu';
    // 每日挑戰：只記錄當天第一次的成績，連續天數
    if (this.daily && this.daily.date === date) {
      const emoji = emojiLine(this.rallies);
      if (!p.daily.played[date]) {
        p.daily.played[date] = { won, score: [this.state.score[meSide], this.state.score[1 - meSide]], emoji };
        // 只保留最近 30 天
        for (const k of Object.keys(p.daily.played).sort().slice(0, -30)) delete p.daily.played[k];
      }
      const { usedMakeup } = markDaily(p, date);
      if (usedMakeup) lines.push(t('dailyMakeup'));
      lines.push(t('dailyStreakNow', { n: p.daily.streak }));
    }
    // 環島：贏了就蓋章
    if (this.tour && won) {
      const st = ROUTE[this.tour.idx];
      const list = this.tour.hard ? p.tour.hardStamps : p.tour.stamps;
      if (!list.includes(st.scene)) {
        list.push(st.scene);
        lines.push(t('tourStamp', { name: t(App.SCENE_LABELS[st.scene]) }));
      }
      // 第一次環島完成：解鎖臺灣雲豹
      if (p.tour.stamps.length >= ROUTE.length && !p.unlocked.includes(HIDDEN_CHARACTER)) {
        p.unlocked.push(HIDDEN_CHARACTER);
        this.pendingUnlock = HIDDEN_CHARACTER;
      }
    }
    const out = recordMatch(p, {
      mode, me: this.chars[meSide], opp: this.chars[1 - meSide], scene: this.scene, won,
      score: [this.state.score[meSide], this.state.score[1 - meSide]],
      spikes: this.matchStats.spikes, dives: this.matchStats.dives, saveStreak: this.matchStats.saveMax,
    }, date, { visibleChars: this.visibleIds(), scenes: SCENES });
    saveProgress(p);
    if (out.tasksDone.length) lines.push(`⭐ ${t('taskDone')}${out.tasksDone.length > 1 ? ` ×${out.tasksDone.length}` : ''}`);
    for (const a of out.newAch) lines.push(`🏅 ${t(`ach_${a.id}` as MsgKey)}`);
    for (const c of out.newCosmetics) lines.push(`🎁 ${t('cosNew', { name: t(`cos_${c}` as MsgKey) })}`);
    for (const a of out.newAch) track('achievement', { id: a.id });
    return lines.length ? h('div', { class: 'progress-lines' }, ...lines.map((x) => h('p', {}, x))) : null;
  }

  /** 剛解鎖的隱藏角色：結算後跳出圖鑑卡片 */
  private pendingUnlock: string | null = null;

  /** 這一場的統計（扣殺、魚躍、連續救起扣殺）與每一球的結果 */
  private matchStats = { spikes: 0, dives: 0, saveRun: 0, saveMax: 0, oppSpike: false };
  private rallies: Rally[] = [];

  private resetMatchStats() {
    this.matchStats = { spikes: 0, dives: 0, saveRun: 0, saveMax: 0, oppSpike: false };
    this.rallies = [];
  }

  /** 從事件累計這一場的統計（me = 自己是哪一邊） */
  private countEvents(events: GameEvent[], me: number) {
    const m = this.matchStats;
    for (const e of events) {
      if (e.type === 'spike') {
        if (e.who === me) m.spikes++;
        else m.oppSpike = true;
      } else if (e.type === 'dive' && e.who === me) m.dives++;
      else if (e.type === 'bump' && e.who === me && m.oppSpike) {
        m.oppSpike = false;
        m.saveRun++;
        m.saveMax = Math.max(m.saveMax, m.saveRun);
      } else if (e.type === 'score') {
        if (e.who !== me && m.oppSpike) m.saveRun = 0;
        m.oppSpike = false;
        this.rallies.push(e.who === me ? 'w' : 'l');
      }
    }
  }

  // ---------------------------------------------------------------- 闖關挑戰
  private startChallenge(player: string) {
    this.endTutorial();
    this.daily = null;
    this.tour = null;
    this.challenge = { player, stages: buildStages(player, this.selectableIds()), idx: 0 };
    this.showStageIntro();
  }

  private levelName(d: Difficulty) {
    return t(d === 'rookie' ? 'beginner' : d);
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

  private showStageResult(won: boolean, progressLines: HTMLElement | null = null) {
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
      progressLines,
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
          this.countEvents(ev, o.localSide);
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
        button(t('lineInvite'), () => {
          track('share', { kind: 'invite' });
          window.open(lineShareUrl(text), '_blank', 'noopener');
        }, 'line'),
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
    const panels = this.buildCharGrid(list, slots, [true, true], (side, action) => {
      if (side !== me) return;
      const s = slots[side];
      if (action === 'ok') s.ready = this.isUnlocked(list[s.idx].id) ? !s.ready : false;
      else if (!s.ready) s.idx = typeof action === 'number' ? action : panels.move(s.idx, action);
      audio.blip(action !== 'left' && action !== 'up');
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
    this.menuKeyHandler = (a) => panels.act(me, a);
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
