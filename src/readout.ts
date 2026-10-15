/**
 * 读数：把「现在这一眼」的**全部**参数摊成纯文本，好整段复制贴给 AI。
 *
 * 三种格式各有用途：
 * - `formatReadout`：给人看（也是「记一笔」存下来的东西）；
 * - `formatJson`：一行 JSON，数字精确、无二义 —— AI 直接照着填，不用从散文里抠值；
 * - `formatSnippet`：直接能粘进 `SkinModal/index.tsx` 的常量写法。
 *
 * 刻意把「人物朝向」放在第一行：它才是这个工具要标定的主结果。
 * 相机位置只在「转相机」模式下才有意义（站点默认取景是固定的 0,0,43.82）。
 */

export type ReadoutData = {
  mode: '转人物' | '转相机';
  yawDeg: number;
  cam: {x: number; y: number; z: number};
  target: {x: number; y: number; z: number};
  distance: number;
  fov: number;
  zoom: number;
  cssSize: {w: number; h: number};
  bufferSize: {w: number; h: number};
  pixelRatio: number;
  skinLabel: string;
  animation: string;
  speed: number;
  paused: boolean;
  autoRotate: boolean;
};

const n = (value: number, digits = 2): string =>
  Number.isFinite(value) ? value.toFixed(digits) : '—';

const vec = (v: {x: number; y: number; z: number}): string =>
  `${n(v.x)}, ${n(v.y)}, ${n(v.z)}`;

/** 本地时间，形如 2026-10-15 15:12:07（`sv-SE` 恰好就是 ISO 那种排法）。 */
function stamp(): string {
  return new Date()
    .toLocaleString('sv-SE', {hour12: false})
    .replace('T', ' ')
    .slice(0, 19);
}

export function formatReadout(data: ReadoutData): string {
  const rad = (data.yawDeg * Math.PI) / 180;
  return [
    `fov-quick-view 读数 · ${stamp()}`,
    `皮肤      ${data.skinLabel}`,
    `模式      ${data.mode}`,
    `人物朝向  ${data.yawDeg >= 0 ? ' ' : ''}${n(data.yawDeg, 1)}°   ${n(rad, 4)} rad`,
    `相机位置  (${vec(data.cam)})`,
    `相机目标  (${vec(data.target)})`,
    `距离      ${n(data.distance)}   fov ${n(data.fov, 0)}°   zoom ${n(data.zoom)}`,
    `画布      ${data.cssSize.w}×${data.cssSize.h} css · ${data.bufferSize.w}×${data.bufferSize.h} buffer (dpr ${data.pixelRatio})`,
    `动作      ${data.animation} · ${n(data.speed, 1)}× · ${data.paused ? '暂停' : '播放中'} · 自转 ${data.autoRotate ? 'on' : 'off'}`,
  ].join('\n');
}

export function formatSnippet(data: ReadoutData): string {
  return [
    '--- 落到站点 SkinModal 的值 ---',
    `viewer.playerWrapper.rotation.y = ${n((data.yawDeg * Math.PI) / 180, 4)};   // = ${n(data.yawDeg, 1)}°`,
    `fov ${n(data.fov, 0)} / zoom ${n(data.zoom)}   → 相机距离 ${n(data.distance)}`,
    `动作 ${data.animation} · 速度 ${n(data.speed, 1)}× · ${data.paused ? '暂停' : '播放'}`,
  ].join('\n');
}

export function formatJson(data: ReadoutData): string {
  return JSON.stringify({
    yawDeg: Number(n(data.yawDeg, 1)),
    yawRad: Number(n((data.yawDeg * Math.PI) / 180, 4)),
    fov: Number(n(data.fov, 0)),
    zoom: Number(n(data.zoom, 2)),
    cam: [Number(n(data.cam.x)), Number(n(data.cam.y)), Number(n(data.cam.z))],
    dist: Number(n(data.distance)),
    animation: data.animation,
    speed: Number(n(data.speed, 1)),
    paused: data.paused,
    autoRotate: data.autoRotate,
    canvas: `${data.cssSize.w}x${data.cssSize.h}`,
  });
}

/** 点「复制」时进剪贴板的东西：散文段 + 可粘贴的代码段 + 一行 JSON（数字无二义）。 */
export function formatCopy(data: ReadoutData): string {
  return `${formatReadout(data)}\n\n${formatSnippet(data)}\n\n${formatJson(data)}\n`;
}
