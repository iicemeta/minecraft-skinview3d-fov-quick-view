import * as skinview3d from 'skinview3d';

/**
 * 视图层：只负责「怎么转、怎么动」，不掺 DOM 与读数。
 *
 * 全部参数按站点 `club-party-website/src/components/SkinModal/index.tsx` 的口径来 ——
 * 这个工具存在的唯一理由就是**读数能 1:1 搬过去**，所以任何一处不同都要在这里写明原因：
 *
 * - `skinview3d` 版本**精确锁 3.4.2**（见 package.json，不用 `^`）：站点依赖的是 `^3.4.2`，
 *   相机距离、动画幅度这些都写在库里，换版本读数就不作数了。
 * - 像素密度下限 2 倍（站点叫 `MIN_PIXEL_RATIO`）：dpr=1 的屏也按 2 倍渲染再缩下来，
 *   缩采样比 1:1 出图的边缘干净。这不影响角度，只影响「看着像不像」。
 * - `controls`：禁平移、`minDistance 14` / `maxDistance 96`，和站点同一组。
 * - 相机取景用库默认：`fov 50` + `zoom 0.9` → `adjustCameraDistance()` 推出 **距离 43.82**
 *   （`4.5 + 16.5 / tan(fov/2) / zoom`）。站点弹窗的「重置视角」回的就是这一处。
 *
 * 另一个必须记住的库行为：`cameraLight` 是**挂在相机上**的点光源
 * （`viewer.ts`: `this.camera.add(this.cameraLight)`），所以「转人物」和「转相机」的明暗不一样 ——
 * 想让读数搬到站点后还是一个样子，就得跟站点一样只转人物。
 */

/** 站点 `SkinModal` 的同款动作清单（两处要保持一致）。 */
export const ANIMATIONS = [
  {value: 'walk', label: '走路'},
  {value: 'idle', label: '站立'},
  {value: 'run', label: '跑步'},
  {value: 'fly', label: '飞行'},
  {value: 'wave', label: '挥手'},
  {value: 'crouch', label: '潜行'},
  {value: 'hit', label: '受击'},
  {value: 'swim', label: '游泳'},
] as const;

export type AnimationKey = (typeof ANIMATIONS)[number]['value'];

/** 库真正导出的那 8 个动画类名。**不能拿 key 拼**（`run` → `Running`，不是 `Run`）。 */
type PlayerAnimationCtor = new () => skinview3d.PlayerAnimation;

const ANIMATION_CLASSES: Record<AnimationKey, PlayerAnimationCtor> = {
  walk: skinview3d.WalkingAnimation,
  idle: skinview3d.IdleAnimation,
  run: skinview3d.RunningAnimation,
  fly: skinview3d.FlyingAnimation,
  wave: skinview3d.WaveAnimation,
  crouch: skinview3d.CrouchAnimation,
  hit: skinview3d.HitAnimation,
  swim: skinview3d.SwimAnimation,
};

/** 速度档位（同站点，刻意用档位而不是滑块）。 */
export const SPEED_PRESETS = [0.5, 1, 1.5, 2] as const;

export const DEFAULT_ANIMATION: AnimationKey = 'walk';
export const DEFAULT_SPEED = 1;
/** 库默认值：fov 50 / zoom 0.9。 */
export const DEFAULT_FOV = 50;
export const DEFAULT_ZOOM = 0.9;

const MIN_PIXEL_RATIO = 2;
const MAX_PIXEL_RATIO = 3;

export function targetPixelRatio(): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.min(Math.max(dpr, MIN_PIXEL_RATIO), MAX_PIXEL_RATIO);
}

/** 把任意角度折进 (-180, 180]，滑杆与读数都用这个区间。 */
export function wrap180(deg: number): number {
  let value = ((deg + 180) % 360 + 360) % 360 - 180;
  // -180 与 180 是同一处，统一取 180，免得滑杆两端来回跳
  if (value === -180) value = 180;
  return value;
}

let viewer: skinview3d.SkinViewer | null = null;

/** 建视图。`canvas` 必须已经在 DOM 里（three 要立刻量尺寸）。 */
export function ensureViewer(canvas: HTMLCanvasElement): skinview3d.SkinViewer {
  if (viewer) return viewer;

  const instance = new skinview3d.SkinViewer({
    canvas,
    // 与站点弹窗同口径：允许读回绘制缓冲（调尺寸时不会闪黑边）
    preserveDrawingBuffer: true,
  });
  instance.controls.enablePan = false;
  instance.controls.minDistance = 14;
  instance.controls.maxDistance = 96;
  instance.autoRotate = false;
  instance.pixelRatio = targetPixelRatio();

  viewer = instance;
  applyAnimation(DEFAULT_ANIMATION, DEFAULT_SPEED, false);
  return instance;
}

export function applyAnimation(key: AnimationKey, speed: number, paused: boolean): void {
  if (!viewer) return;
  // 每个实例自己存进度，换动作必须新建（库的行为）
  const animation = new ANIMATION_CLASSES[key]();
  animation.speed = speed;
  animation.paused = paused;
  viewer.animation = animation;
}

/** 只改速度 / 暂停时不用新建实例，改当前这个就行。 */
export function tuneAnimation(speed: number, paused: boolean): void {
  if (!viewer?.animation) return;
  viewer.animation.speed = speed;
  viewer.animation.paused = paused;
}

export function setYawDeg(deg: number): void {
  if (!viewer) return;
  viewer.playerWrapper.rotation.y = (deg * Math.PI) / 180;
}

export function yawDeg(): number {
  return viewer ? (viewer.playerWrapper.rotation.y * 180) / Math.PI : 0;
}

export async function loadSkin(source: string): Promise<void> {
  await viewer?.loadSkin(source);
}

/** 复位：相机回库默认取景 **+ 人物自转角归零 + fov/zoom 回默认**。
 *  库的 `resetCameraPose()` 只管相机位置，不碰 `playerWrapper.rotation.y`。 */
export function resetView(): void {
  if (!viewer) return;
  viewer.resetCameraPose();
  viewer.playerWrapper.rotation.y = 0;
  viewer.fov = DEFAULT_FOV;
  viewer.zoom = DEFAULT_ZOOM;
}
