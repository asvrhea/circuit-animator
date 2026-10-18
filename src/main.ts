import './style.css';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw(width, height);
}

function draw(w: number, h: number): void {
  ctx.fillStyle = '#0b0d10';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#8a94a3';
  ctx.font = '600 18px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('DROP A CIRCUIT SCREENSHOT TO BEGIN', w / 2, h / 2);
}

new ResizeObserver(resize).observe(canvas);
