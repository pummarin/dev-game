type LoadingProgressDetail = { progress: number; message: string };

const PROGRESS_EVENT = 'dragon-hunt:loading-progress';
const READY_EVENT = 'dragon-hunt:ready';
const ERROR_EVENT = 'dragon-hunt:loading-error';

export function reportLoadingProgress(progress: number, message: string) {
  window.dispatchEvent(new CustomEvent<LoadingProgressDetail>(PROGRESS_EVENT, {
    detail: { progress: Math.max(0, Math.min(1, progress)), message },
  }));
}

export function reportLoadingError(message: string) {
  window.dispatchEvent(new CustomEvent<string>(ERROR_EVENT, { detail: message }));
}

export function reportGameReady() {
  window.dispatchEvent(new Event(READY_EVENT));
}

export function initializeLoadingScreen() {
  const screen = document.getElementById('loading-screen');
  const fill = document.getElementById('loading-progress-fill');
  const bar = document.querySelector<HTMLElement>('.loading-progress');
  const label = document.getElementById('loading-message');
  const percent = document.getElementById('loading-percent');
  const error = document.getElementById('loading-error');
  if (!screen || !fill || !bar || !label || !percent || !error) return;

  window.addEventListener(PROGRESS_EVENT, (event) => {
    const { progress, message } = (event as CustomEvent<LoadingProgressDetail>).detail;
    const value = Math.round(progress * 100);
    fill.style.width = `${value}%`;
    bar.setAttribute('aria-valuenow', `${value}`);
    label.textContent = message;
    percent.textContent = `${value}%`;
  });
  window.addEventListener(ERROR_EVENT, (event) => {
    error.textContent = (event as CustomEvent<string>).detail;
    error.hidden = false;
  });
  window.addEventListener(READY_EVENT, () => {
    fill.style.width = '100%';
    bar.setAttribute('aria-valuenow', '100');
    percent.textContent = '100%';
    label.textContent = 'พร้อมออกเดินทาง';
    window.setTimeout(() => screen.classList.add('is-ready'), 260);
  }, { once: true });
}
