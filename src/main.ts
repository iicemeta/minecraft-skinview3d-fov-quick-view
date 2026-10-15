import './style.css';

import {
  ANIMATIONS,
  DEFAULT_ANIMATION,
  DEFAULT_FOV,
  DEFAULT_SPEED,
  DEFAULT_ZOOM,
  SPEED_PRESETS,
  applyAnimation,
  ensureViewer,
  loadSkin,
  resetView,
  setYawDeg,
  tuneAnimation,
  wrap180,
  yawDeg,
  type AnimationKey,
} from './viewer';
import {formatCopy, formatReadout, type ReadoutData} from './readout';

/**
 * UI 装配：DOM 只在这里碰。
 *
 * 三种交互的分工（对应侧栏三块）：
 * - 「拖拽 = 转人物」是默认：站点弹窗最终要调的就是人物的初始朝向，
 *   所以主交互直接拧这个值，读数第一行也就是它。
 * - 「拖拽 = 转相机」是备用的：想换个观察高度/绕到别的方位看看时用，
 *   但**它不等价于转人物** —— 库的 `cameraLight` 挂在相机上，转相机时光跟着走，明暗不一样。
 * - 「参考图」可以叠在画布上并调透明度：把要复刻的那张预览图（比如 LittleSkin 的）
 *   半透明压上来对齐轮廓，比来回切窗口用眼睛记要准得多。
 */

/** 站点默认皮肤（`club-party-website/static/img/skins/deepseek-npz.png` 的副本）。 */
const DEFAULT_SKIN = '/skins/deepseek-npz.png';

function need<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`fov-quick-view: 页面里找不到 ${selector}`);
  return element;
}

const canvas = need<HTMLCanvasElement>('#skin-canvas');
const stage = need<HTMLDivElement>('#stage');
const hint = need<HTMLParagraphElement>('#stage-hint');
const readoutEl = need<HTMLPreElement>('#readout');
const historyEl = need<HTMLUListElement>('#history');
const skinMeta = need<HTMLParagraphElement>('#skin-meta');
const yawRange = need<HTMLInputElement>('#yaw-range');
const yawNumber = need<HTMLInputElement>('#yaw-number');
const fovNumber = need<HTMLInputElement>('#fov-number');
const zoomNumber = need<HTMLInputElement>('#zoom-number');
const copyBtn = need<HTMLButtonElement>('#copy');
const snapshotBtn = need<HTMLButtonElement>('#snapshot');
const modeBox = need<HTMLDivElement>('#mode');
const stageSizeBox = need<HTMLDivElement>('#stage-size');
const animationsBox = need<HTMLDivElement>('#animations');
const speedsBox = need<HTMLDivElement>('#speeds');
const toggleRotate = need<HTMLInputElement>('#toggle-rotate');
const togglePause = need<HTMLInputElement>('#toggle-pause');
const resetBtn = need<HTMLButtonElement>('#reset');
const skinDefault = need<HTMLButtonElement>('#skin-default');
const skinFile = need<HTMLInputElement>('#skin-file');
const skinUrl = need<HTMLInputElement>('#skin-url');
const skinUrlLoad = need<HTMLButtonElement>('#skin-url-load');
const refImg = need<HTMLImageElement>('#ref-img');
const refFile = need<HTMLInputElement>('#ref-file');
const refOpacity = need<HTMLInputElement>('#ref-opacity');
const refOpacityOut = need<HTMLOutputElement>('#ref-opacity-out');
const refClear = need<HTMLButtonElement>('#ref-clear');
const refAdjust = need<HTMLInputElement>('#ref-adjust');
const refReset = need<HTMLButtonElement>('#ref-reset');
const refScaleOut = need<HTMLOutputElement>('#ref-scale-out');

/* ------------------------------------------------------------------ 视图 */

const viewer = ensureViewer(canvas);

/** 画布尺寸跟着舞台走。`ResizeObserver` 盯舞台（外层），不盯画布 ——
 *  `viewer.setSize()` 会给画布写死 px 的 style，盯画布就自己触发自己。 */
function fitStage(): void {
  const rect = stage.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return;
  viewer.setSize(rect.width, rect.height);
}

new ResizeObserver(fitStage).observe(stage);
fitStage();

/* ------------------------------------------------------------------ 状态 */

type Mode = 'player' | 'camera';

let mode: Mode = 'player';
let animationKey: AnimationKey = DEFAULT_ANIMATION;
let speed = DEFAULT_SPEED;
let paused = false;
let skinLabel = '站点默认皮肤';

/* ------------------------------------------------------------------ 动作 */

for (const item of ANIMATIONS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = item.label;
  button.dataset.animation = item.value;
  button.addEventListener('click', () => setAnimation(item.value));
  animationsBox.append(button);
}

for (const preset of SPEED_PRESETS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = `${preset}×`;
  button.dataset.speed = String(preset);
  button.addEventListener('click', () => setSpeed(preset));
  speedsBox.append(button);
}

function setAnimation(key: AnimationKey): void {
  animationKey = key;
  applyAnimation(key, speed, paused);
  for (const button of animationsBox.querySelectorAll<HTMLButtonElement>('button')) {
    button.classList.toggle('on', button.dataset.animation === key);
  }
}

function setSpeed(next: number): void {
  speed = next;
  tuneAnimation(speed, paused);
  for (const button of speedsBox.querySelectorAll<HTMLButtonElement>('button')) {
    button.classList.toggle('on', Number(button.dataset.speed) === next);
  }
}

function setPaused(next: boolean): void {
  paused = next;
  togglePause.checked = next;
  tuneAnimation(speed, paused);
}

function setAutoRotate(next: boolean): void {
  toggleRotate.checked = next;
  viewer.autoRotate = next;
}

toggleRotate.addEventListener('change', () => setAutoRotate(toggleRotate.checked));
togglePause.addEventListener('change', () => setPaused(togglePause.checked));

/* ------------------------------------------------------------ 人物朝向 */

let sliderActive = false;
let playerDragging = false;
/** 参考图模式的拖拽（移动叠加图，不是转人物） */
let refDragging = false;
let lastX = 0;
let lastY = 0;

function paintYawInputs(deg: number, force = false): void {
  // 自动旋转时滑杆要跟着走；但用户正在拖的时候别去改它，会打架
  if (force || (!sliderActive && !playerDragging)) yawRange.value = String(deg);
  if (force || document.activeElement !== yawNumber) yawNumber.value = deg.toFixed(1);
}

function setYaw(deg: number): void {
  const wrapped = wrap180(deg);
  setYawDeg(wrapped);
  paintYawInputs(wrapped, true);
}

yawRange.addEventListener('pointerdown', () => {
  sliderActive = true;
});
const releaseSlider = () => {
  sliderActive = false;
};
yawRange.addEventListener('pointerup', releaseSlider);
yawRange.addEventListener('pointercancel', releaseSlider);
yawRange.addEventListener('blur', releaseSlider);
yawRange.addEventListener('input', () => setYaw(Number(yawRange.value)));
yawNumber.addEventListener('change', () => setYaw(Number(yawNumber.value) || 0));

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-yaw-step]')) {
  button.addEventListener('click', () => {
    const step = Number(button.dataset.yawStep);
    setYaw(step === 0 ? 0 : yawDeg() + step);
  });
}

canvas.addEventListener('pointerdown', (event) => {
  if (refAdjusting) {
    refDragging = true;
  } else if (mode === 'player') {
    playerDragging = true;
  } else {
    // 转相机模式：交给 OrbitControls
    return;
  }
  lastX = event.clientX;
  lastY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  if (refDragging) {
    refX += event.clientX - lastX;
    refY += event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    paintRef();
    return;
  }
  if (!playerDragging) return;
  const dx = event.clientX - lastX;
  lastX = event.clientX;
  // 0.5°/px；按住 Shift 是 0.1°/px，用来抠最后几度
  setYaw(yawDeg() + dx * (event.shiftKey ? 0.1 : 0.5));
});

const endDrag = (event: PointerEvent) => {
  if (refDragging) refDragging = false;
  if (playerDragging) {
    playerDragging = false;
    paintYawInputs(yawDeg(), true);
  }
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
};

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

/** 调整参考图时滚轮缩放的是叠加图；其余情况交给 OrbitControls 缩放相机。 */
canvas.addEventListener(
  'wheel',
  (event) => {
    if (!refAdjusting) return;
    event.preventDefault();
    refScale = Math.min(Math.max(refScale * Math.exp(-event.deltaY * 0.0015), 0.1), 4);
    paintRef();
  },
  {passive: false},
);

/* -------------------------------------------------------- 模式与舞台尺寸 */

function setMode(next: Mode): void {
  mode = next;
  for (const button of modeBox.querySelectorAll<HTMLButtonElement>('button')) {
    button.classList.toggle('on', button.dataset.mode === next);
  }
  syncControls();
}

/** 相机控件与「调整参考图」是**互斥**的：调参考图时要把相机的拖拽与滚轮让出来，
 *  否则一次拖动会同时改人物、一次滚轮会同时缩放两者。 */
function syncControls(): void {
  viewer.controls.enableRotate = !refAdjusting && mode === 'camera';
  viewer.controls.enableZoom = !refAdjusting;
  hint.textContent = refAdjusting
    ? '调整参考图：拖拽 = 移动 · 滚轮 = 缩放'
    : mode === 'player'
      ? '拖拽 = 转人物（Shift 细调）· 滚轮 = 缩放'
      : '拖拽 = 转相机 · 滚轮 = 缩放';
}

for (const button of modeBox.querySelectorAll<HTMLButtonElement>('button')) {
  button.addEventListener('click', () => {
    setMode(button.dataset.mode === 'camera' ? 'camera' : 'player');
  });
}

function setStageSize(next: 'site' | 'fill'): void {
  stage.dataset.size = next;
  for (const button of stageSizeBox.querySelectorAll<HTMLButtonElement>('button')) {
    button.classList.toggle('on', button.dataset.stageSize === next);
  }
  fitStage();
}

for (const button of stageSizeBox.querySelectorAll<HTMLButtonElement>('button')) {
  button.addEventListener('click', () => {
    setStageSize(button.dataset.stageSize === 'fill' ? 'fill' : 'site');
  });
}

/* -------------------------------------------------------------- fov/zoom */

function applyFovZoom(): void {
  const fov = Number(fovNumber.value);
  const zoom = Number(zoomNumber.value);
  // 两个 setter 都会重算相机距离（库的 adjustCameraDistance），所以顺序无所谓
  if (Number.isFinite(fov) && fov >= 10 && fov <= 120) viewer.fov = fov;
  if (Number.isFinite(zoom) && zoom >= 0.2 && zoom <= 3) viewer.zoom = zoom;
}

fovNumber.addEventListener('change', applyFovZoom);
zoomNumber.addEventListener('change', applyFovZoom);

/* ------------------------------------------------------------------ 读数 */

function readoutData(): ReadoutData {
  const cam = viewer.camera.position;
  const target = viewer.controls.target;
  const ratio = viewer.pixelRatio;
  return {
    mode: mode === 'player' ? '转人物' : '转相机',
    yawDeg: yawDeg(),
    cam: {x: cam.x, y: cam.y, z: cam.z},
    target: {x: target.x, y: target.y, z: target.z},
    distance: cam.distanceTo(target),
    fov: viewer.fov,
    zoom: viewer.zoom,
    cssSize: {w: canvas.clientWidth, h: canvas.clientHeight},
    bufferSize: {w: canvas.width, h: canvas.height},
    pixelRatio: typeof ratio === 'number' ? ratio : window.devicePixelRatio || 1,
    skinLabel,
    animation: animationKey,
    speed,
    paused,
    autoRotate: viewer.autoRotate,
  };
}

let lastPaint = 0;

function frame(now: number): void {
  // ~8Hz 就够了：这是给人看的数字，跑满帧只会让数字抖得看不清
  if (now - lastPaint >= 120) {
    lastPaint = now;
    readoutEl.textContent = formatReadout(readoutData());
    paintYawInputs(yawDeg());
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // 剪贴板 API 要安全上下文；http://127.0.0.1 算，正常走不到这里
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

function flash(button: HTMLButtonElement, text: string): void {
  const original = button.textContent;
  button.textContent = text;
  window.setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

copyBtn.addEventListener('click', () => {
  void copyText(formatCopy(readoutData())).then(() => flash(copyBtn, '已复制 ✓'));
});

type Snapshot = {label: string; text: string};

const snapshots: Snapshot[] = [];

function renderHistory(): void {
  historyEl.replaceChildren();
  for (const snapshot of snapshots) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = snapshot.label;
    button.title = '点击复制这一笔';
    button.addEventListener('click', () => {
      void copyText(snapshot.text).then(() => flash(button, '已复制 ✓'));
    });
    item.append(button);
    historyEl.append(item);
  }
}

snapshotBtn.addEventListener('click', () => {
  const data = readoutData();
  snapshots.unshift({
    label: `${data.yawDeg.toFixed(1)}° · ${data.animation} · ${new Date().toLocaleTimeString('zh-CN', {hour12: false})}`,
    text: formatCopy(data),
  });
  if (snapshots.length > 12) snapshots.length = 12;
  renderHistory();
});

/* ------------------------------------------------------------------ 皮肤 */

let skinObjectUrl: string | null = null;
let refObjectUrl: string | null = null;

async function measureImage(src: string): Promise<string> {
  const image = new Image();
  image.src = src;
  try {
    await image.decode();
  } catch {
    return '';
  }
  return `${image.naturalWidth}×${image.naturalHeight}`;
}

async function useSkin(src: string, label: string): Promise<void> {
  await loadSkin(src);
  const size = await measureImage(src);
  skinLabel = size ? `${label} · ${size}` : label;
  skinMeta.textContent = skinLabel;
}

function loadSkinOrReport(src: string, label: string): void {
  skinMeta.textContent = '载入中…';
  void useSkin(src, label).catch((error: unknown) => {
    // 载入失败要看得见 —— 悄悄留着上一张皮肤会让人以为「看的就是这张」
    skinMeta.textContent = `载入失败：${label}（${String(error)}）`;
  });
}

skinDefault.addEventListener('click', () => loadSkinOrReport(DEFAULT_SKIN, '站点默认皮肤'));

skinFile.addEventListener('change', () => {
  const file = skinFile.files?.[0];
  if (!file) return;
  if (skinObjectUrl) URL.revokeObjectURL(skinObjectUrl);
  skinObjectUrl = URL.createObjectURL(file);
  loadSkinOrReport(skinObjectUrl, file.name);
});

skinUrlLoad.addEventListener('click', () => {
  const url = skinUrl.value.trim();
  if (!url) return;
  loadSkinOrReport(url, url.split('/').pop() || url);
});

/* ---------------------------------------------------------------- 参考图 */

/** 叠加图的缩放/位移**只是对齐用的标尺**，不进读数：它不改站点里的任何参数。
 *  之所以非有不可 —— 参考图（比如 LittleSkin 的预览）里的人物往往比我们舞台里的小一截，
 *  不缩放根本叠不上轮廓。 */
let refScale = 1;
let refX = 0;
let refY = 0;
let refAdjusting = false;

function paintRef(): void {
  refImg.style.transform = `translate(${refX}px, ${refY}px) scale(${refScale})`;
  refScaleOut.value = `${Math.round(refScale * 100)}%`;
}

function resetRefTransform(): void {
  refScale = 1;
  refX = 0;
  refY = 0;
  paintRef();
}

function setRefAdjusting(next: boolean): void {
  refAdjusting = next;
  refAdjust.checked = next;
  syncControls();
}

refFile.addEventListener('change', () => {
  const file = refFile.files?.[0];
  if (!file) return;
  if (refObjectUrl) URL.revokeObjectURL(refObjectUrl);
  refObjectUrl = URL.createObjectURL(file);
  refImg.src = refObjectUrl;
  refImg.hidden = false;
  resetRefTransform();
});

refOpacity.addEventListener('input', () => {
  const percent = Number(refOpacity.value);
  refImg.style.opacity = String(percent / 100);
  refOpacityOut.value = `${percent}%`;
});

refAdjust.addEventListener('change', () => setRefAdjusting(refAdjust.checked));
refReset.addEventListener('click', resetRefTransform);

refClear.addEventListener('click', () => {
  refImg.hidden = true;
  refImg.removeAttribute('src');
  refFile.value = '';
  resetRefTransform();
  setRefAdjusting(false);
  if (refObjectUrl) {
    URL.revokeObjectURL(refObjectUrl);
    refObjectUrl = null;
  }
});

/* ------------------------------------------------------------------ 复位 */

resetBtn.addEventListener('click', () => {
  resetView();
  fovNumber.value = String(DEFAULT_FOV);
  zoomNumber.value = String(DEFAULT_ZOOM);
  setSpeed(DEFAULT_SPEED);
  setPaused(false);
  setAnimation(DEFAULT_ANIMATION);
  setAutoRotate(false);
  setYaw(0);
});

/* ------------------------------------------------------------------ 启动 */

setMode('player');
setStageSize('site');
setSpeed(DEFAULT_SPEED);
setPaused(false);
setAnimation(DEFAULT_ANIMATION);
setAutoRotate(false);
setYaw(0);
renderHistory();
loadSkinOrReport(DEFAULT_SKIN, '站点默认皮肤');
