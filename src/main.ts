import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { FPS_BY_SPEED } from './engine/constants';
import { createState, defaultConfig, step } from './engine/physics';
import { AiController, type Difficulty } from './engine/ai';
import { IN_LEFT, IN_RIGHT, Phase, type GameEvent, type GameState, type InputFrame, type MatchConfig } from './engine/types';
import { Renderer } from './render/renderer';
import { audio } from './audio/audio';
import {
  applyKeymaps, canBind, cloneKeymap, DEFAULT_KEYMAP_1P, DEFAULT_KEYMAP_2P, Keyboard, KEY_ACTIONS, KEYMAP_1P, KEYMAP_2P,
  keyLabel, keymapSide, menuAction, rebind, type KeyAction, type KeyMap,
} from './input/keyboard';
import { readGamepad } from './input/gamepad';
import { TouchControls, isTouchDevice } from './input/touch';
import {
  allCharacters, displayName, getCharacter, hasCharacter, loadCharacters, statsOf, DEFAULT_CHARACTER, type CharacterPack,
} from './characters/registry';
import { deleteLocalPack, importPackZip, loadLocalPacks } from './characters/localPacks';
import { getLang, setLang, t, type Lang, type MsgKey } from './i18n';
import { loadSettings, saveSettings, type Settings } from './ui/settings';
import { button, h, moveFocus, segmented } from './ui/dom';
import { OnlineMatch, type StartInfo } from './net/online';
import { normalizeCode } from './net/transport';

type Mode = 'demo' | 'cpu' | 'local' | 'practice' | 'online';

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
  overlay = $<HTMLDivElement>('#overlay');
  hud = $<HTMLDivElement>('#hud');
  toastEl = $<HTMLDivElement>('#toast');

  mode: Mode = 'demo';
  cfg: MatchConfig = defaultConfig({ targetScore: 99 });
  state: GameState = createState(1);
  prev: GameState = this.state;
  ais: [AiController | null, AiController | null] = [null, null];
  chars: [string, string] = ['momo', 'kit'];
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
  private needRefresh: ((reload?: boolean) => Promise<void>) | null = null;

  async init() {
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
      if (e.pointerType === 'touch' && document.body.classList.contains('in-match')) this.touch.setVisible(true);
    });
    window.addEventListener('keydown', unlock);
    window.addEventListener('pagehide', () => this.online?.close());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.isLocalMatch() && !this.paused) this.showPause();
    });

    const room = new URLSearchParams(location.search).get('room');
    const code = room ? normalizeCode(room) : null;
    if (code) this.showOnlineJoin(code);
    else this.showTitle();

    this.setupPwa();
    requestAnimationFrame((t0) => this.frame(t0));
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
    for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n as MsgKey);
    document.title = t('title') + ' — Beach Volley Duel';
  }

  resize() {
    const r = $('#stage').getBoundingClientRect();
    this.renderer.resize(r.width, r.height);
  }

  // ---------------------------------------------------------------- loop
  private frame(now: number) {
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
    const view = {
      mirror: this.mode === 'online' && this.online?.localSide === 1 && this.settings.selfLeft,
      chars: [getCharacter(this.chars[0]), getCharacter(this.chars[1])] as [CharacterPack, CharacterPack],
      hueShift2: this.chars[0] === this.chars[1],
      smooth: this.settings.graphics === 'smooth',
    };
    this.renderer.draw(this.prev, this.state, this.paused ? 1 : this.acc / stepMs, view, now);
    requestAnimationFrame((t1) => this.frame(t1));
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
      in2 = this.keyboard.read(KEYMAP_2P) | readGamepad(1);
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
    if (this.state.phase === Phase.Over && this.state.phaseTimer === 0 && !this.resultShown) {
      if (this.mode === 'demo') this.startDemo();
      else this.showResult(this.state.winner);
    }
  }

  private tickOnline() {
    const o = this.online;
    if (!o || !o.session || !this.onlineStarted || o.ended) return;
    let input = this.humanInput();
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
  private startDemo() {
    this.mode = 'demo';
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

  private startLocalMatch(mode: 'cpu' | 'local' | 'practice') {
    this.mode = mode;
    const seed = (Math.random() * 2 ** 31) | 0;
    this.cfg = defaultConfig({
      targetScore: this.settings.targetScore,
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
    if (mode === 'practice') this.toast(t('practiceHint'), [], 3000);
  }

  private isLocalMatch() {
    return this.mode === 'cpu' || this.mode === 'local' || this.mode === 'practice';
  }

  private setInMatch(v: boolean) {
    document.body.classList.toggle('in-match', v);
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
    if (this.screenName === 'title') {
      this.showModes();
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

  private pollGamepadMenu() {
    if (!this.screenName) return;
    for (let i = 0; i < 2; i++) {
      const v = readGamepad(i);
      const edge = v & ~this.padPrev[i];
      this.padPrev[i] = v;
      if (!edge) continue;
      if (this.screenName === 'title') {
        this.showModes();
        return;
      }
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

  showTitle() {
    if (this.mode !== 'demo') this.startDemo();
    const el = h('div', { class: 'screen transparent', onclick: () => this.showModes() },
      h('h1', {}, t('title')),
      h('p', { class: 'sub' }, 'Beach Volley Duel'),
      h('p', { class: 'blink' }, t('pressStart')),
    );
    this.show('title', el);
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
        button(t('practice'), () => this.showCharSelect('practice')),
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
          { value: 'easy', label: t('easy') }, { value: 'normal', label: t('normal') }, { value: 'hard', label: t('hard') },
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
  showCharSelect(mode: 'cpu' | 'local' | 'practice') {
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
    if (mode === 'practice') {
      slots[1].ctrl = 'cpu';
      slots[1].ready = true;
      this.humanSide = 0;
    }
    const finish = () => {
      this.chars = [list[slots[0].idx].id, list[slots[1].idx].id];
      this.startLocalMatch(mode);
    };
    const panels = this.buildCharPanels(list, slots, mode === 'practice' ? [true, false] : [true, true], (side, action) => {
      const s = slots[side];
      if (action === 'ok') {
        if (s.ready && s.ctrl === 'human') s.ready = false;
        else s.ready = true;
      } else if (!s.ready || s.ctrl === 'cpu') {
        s.idx = (s.idx + (action === 'left' ? list.length - 1 : 1)) % list.length;
        if (s.ctrl === 'cpu') s.ready = true;
      }
      audio.blip(action !== 'left');
      panels.refresh();
      if (slots[0].ready && slots[1].ready) setTimeout(finish, 250);
    });
    const el = h('div', { class: 'screen wide' },
      h('h2', {}, t('chooseChar')),
      panels.el,
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
    act: (side: 0 | 1, action: 'left' | 'right' | 'ok') => void,
  ) {
    const wrap = h('div', { class: 'char-select' });
    const parts: { root: HTMLElement; canvas: HTMLCanvasElement; name: HTMLElement; stats: HTMLElement; status: HTMLElement; who: HTMLElement; okBtn: HTMLButtonElement }[] = [];
    for (const side of [0, 1] as const) {
      const canvas = h('canvas', { width: 64, height: 64 });
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
      if (!visible[side]) root.style.display = 'none';
      wrap.append(root);
      parts.push({ root, canvas, name, stats, status, who, okBtn });
    }
    let raf = 0;
    const draw = (time: number) => {
      parts.forEach((p, side) => {
        const pack = list[slots[side].idx];
        const g = p.canvas.getContext('2d')!;
        g.imageSmoothingEnabled = false;
        g.clearRect(0, 0, 64, 64);
        if (pack.sprite) {
          const anim = slots[side].ready ? pack.manifest.animations.win ?? pack.manifest.animations.idle : pack.manifest.animations.idle;
          const fi = Math.floor((time / 1000) * anim.fps) % anim.frames;
          const [fw, fh] = pack.manifest.frameSize;
          g.save();
          if (side === 1) {
            g.translate(64, 0);
            g.scale(-1, 1);
          }
          g.drawImage(pack.sprite, fi * fw, anim.row * fh, fw, fh, 0, 0, 64, 64);
          g.restore();
          if (side === 1 && slots[0].idx === slots[1].idx) {
            g.globalCompositeOperation = 'hue';
            g.fillStyle = 'rgba(80,120,255,0.6)';
            g.fillRect(0, 0, 64, 64);
            g.globalCompositeOperation = 'destination-in';
            g.save();
            g.translate(64, 0);
            g.scale(-1, 1);
            g.drawImage(pack.sprite, fi * fw, anim.row * fh, fw, fh, 0, 0, 64, 64);
            g.restore();
            g.globalCompositeOperation = 'source-over';
          }
        } else {
          g.fillStyle = pack.manifest.themeColor;
          g.beginPath();
          g.arc(32, 36, 24, 0, Math.PI * 2);
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
        p.okBtn.textContent = s.ready ? '✕' : t('ready');
      });
    };
    refresh();
    return { el: wrap, refresh, act };
  }

  // ---------------------------------------------------------------- settings
  showSettings(back: () => void) {
    const s = this.settings;
    const save = () => {
      saveSettings(s);
      this.applySettings();
    };
    const row = (label: string, ctrl: HTMLElement) => h('div', { class: 'opt-row' }, h('label', {}, label), ctrl);
    const onOff = (k: 'bgm' | 'balance' | 'touchSwap' | 'vibrate' | 'selfLeft') =>
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
      row(t('touchSwap'), onOff('touchSwap')),
      row(t('vibrate'), onOff('vibrate')),
      row(t('selfLeft'), onOff('selfLeft')),
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
    if (this.online) {
      this.online.close();
      this.online = null;
    }
    this.startDemo();
    this.showModes();
  }

  private showResult(winner: number) {
    this.resultShown = true;
    const winnerName = displayName(getCharacter(this.chars[winner]), getLang());
    let title = t('winner', { name: winnerName });
    if (this.mode === 'cpu') title = winner === this.humanSide ? t('youWin') : t('youLose');
    if (this.mode === 'online' && this.online) title = winner === this.online.localSide ? t('youWin') : t('youLose');
    const again = () => {
      if (this.mode === 'online') {
        this.online?.requestRematch();
        againBtn.disabled = true;
        againBtn.textContent = t('waitRematch');
      } else {
        this.startLocalMatch(this.mode as 'cpu' | 'local' | 'practice');
      }
    };
    const againBtn = button(t('rematch'), again, 'primary');
    const el = h('div', { class: 'screen' },
      h('h2', {}, title),
      h('p', { class: 'code', style: 'letter-spacing:2px' }, `${this.state.score[0]} - ${this.state.score[1]}`),
      h('div', { class: 'menu' }, againBtn, button(t('toTitle'), () => this.quitToModes(), 'secondary')),
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

  private newOnline(): OnlineMatch {
    this.online?.close();
    const o = new OnlineMatch(
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
        onError: (msg) => this.onlineError(msg),
      },
      () => ({ speed: this.settings.speed, targetScore: this.settings.targetScore, balance: this.settings.balance }),
      (id) => statsOf(id),
    );
    this.online = o;
    this.onlineStarted = false;
    return o;
  }

  private showOnlineHost() {
    const o = this.newOnline();
    const el = h('div', { class: 'screen' },
      h('h2', {}, t('createRoom')),
      h('p', {}, t('connecting')),
      h('div', { class: 'menu row' }, button(t('back'), () => this.leaveOnline(), 'secondary')),
    );
    this.show('room', el, () => this.leaveOnline());
    o.host();
  }

  private onRoomCode(code: string) {
    const link = `${location.origin}${location.pathname}?room=${code}`;
    const copyBtn = button(t('shareLink'), async () => {
      try {
        if (navigator.share && isTouchDevice()) await navigator.share({ title: t('title'), url: link });
        else await navigator.clipboard.writeText(link);
        copyBtn.textContent = t('copied');
      } catch {
        // 使用者取消
      }
    }, 'primary');
    const el = h('div', { class: 'screen' },
      h('h2', {}, t('roomCode')),
      h('div', { class: 'code' }, code),
      h('p', { style: 'word-break:break-all;font-size:12px' }, link),
      h('div', { class: 'menu' }, copyBtn),
      h('p', { class: 'blink' }, t('waitingOpponent')),
      h('div', { class: 'menu row' }, button(t('back'), () => this.leaveOnline(), 'secondary')),
    );
    this.show('room', el, () => this.leaveOnline());
  }

  showOnlineJoin(code: string) {
    const o = this.newOnline();
    const el = h('div', { class: 'screen' },
      h('h2', {}, t('joinRoom')),
      h('div', { class: 'code' }, code),
      h('p', { class: 'blink' }, t('connecting')),
      h('div', { class: 'menu row' }, button(t('back'), () => this.leaveOnline(), 'secondary')),
    );
    this.show('room', el, () => this.leaveOnline());
    o.join(code);
  }

  private onlineError(msg: string) {
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
      else if (!s.ready) s.idx = (s.idx + (action === 'left' ? list.length - 1 : 1)) % list.length;
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

  private onlineCountdown(info: StartInfo) {
    this.mode = 'online';
    this.chars = info.chars;
    this.resultShown = false;
    this.onlineStarted = false;
    this.ais = [null, null];
    this.state = this.prev = this.online!.session!.state;
    this.setInMatch(true);
    this.renderHud();
    let n = 3;
    const banner = h('div', { class: 'banner' }, String(n));
    this.clearScreen();
    this.overlay.replaceChildren(banner);
    const iv = setInterval(() => {
      n--;
      if (n > 0) {
        banner.textContent = String(n);
        audio.blip();
      } else {
        clearInterval(iv);
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
