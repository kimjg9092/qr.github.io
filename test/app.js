// ===== 설정 =====
const REQUIRED_KEYS = new Set(['SQUIRREL','RABBIT','DEER']); // 스캔해야할 3종
const SAMPLE_WIDTH = 640;          // 다운스케일 목표 가로(px)
const TARGET_FPS = 15;             // 스캔 빈도(대략)
const VIBRATE_OK = 25;             // 스캔 피드백(ms)

// ===== 공용 요소 =====
const bgVideoA = document.getElementById('bgVideoA');
const bgVideoB = document.getElementById('bgVideoB');
const pagesRoot = document.getElementById('pages');
const banner  = document.getElementById('banner');

// ===== Page3/4 요소 =====
const video   = document.getElementById('qrVideo');
const uiStart = document.getElementById('uiStart');
const itemsUl = document.getElementById('items');
const centerMsg = document.getElementById('centerMsg');

// ===== 상태 =====
let stream = null;
let running = false;
let lastScanTs = 0;
let collected = new Set();

// 오프스크린 캔버스(화면에 붙이지 않음)
const offCanvas = document.createElement('canvas');
const ctx = offCanvas.getContext('2d', { willReadFrequently: true });

function setBanner(msg){ if (banner) banner.textContent = msg; }
function setCenterMessage(text){ if (centerMsg) centerMsg.textContent = text || ''; }

// === 배경 비디오 소스 ===
const VIDEO_SOURCES = {
  init: 'background.mp4',
  stage1: 'background1.mp4',
  stage2: 'background2.mp4',
  stage3: 'background3.mp4',
};
let activeLayer = 'A';
function setVideoSource(el, src){ if (el && src) { el.src = src; try { el.play(); } catch(_) {} } }
setVideoSource(bgVideoA, VIDEO_SOURCES.init);
setVideoSource(bgVideoB, VIDEO_SOURCES.init);

function crossfadeTo(src){
  const show = activeLayer === 'A' ? bgVideoB : bgVideoA;
  const hide = activeLayer === 'A' ? bgVideoA : bgVideoB;
  setVideoSource(show, src);
  // 페이드
  hide.classList.add('hidden');
  show.classList.remove('hidden');
  activeLayer = activeLayer === 'A' ? 'B' : 'A';
}

// ===== 네비게이션 =====
function resetState(){
  collected = new Set();
  renderItems();
  setCenterMessage('');
  // 초기 배경으로 복귀
  crossfadeTo(VIDEO_SOURCES.init);
}

function goto(id){
  const next = document.getElementById(id);
  if (!next) return;
  // 페이지 전환 시 카메라 안전 정지
  stopCamera();
  for (const sec of pagesRoot.querySelectorAll('.page')) sec.classList.remove('current');
  next.classList.add('current');
  if (id === 'page1') {
    resetState();
  }
}

pagesRoot.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-goto]');
  if (!btn) return;
  const id = btn.getAttribute('data-goto');
  goto(id);
});

// ===== 카메라 로직 =====
async function startCamera(){
  if (stream) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    running = true;
    if (uiStart) uiStart.disabled = true;
    setBanner('아이템을 찾아보세요');
    scanLoop();
  } catch(e) {
    setBanner('카메라 접근 실패: ' + e.message);
  }
}

function stopCamera(){
  running = false;
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (uiStart) uiStart.disabled = false;
}

function getKeyFromQR(raw){
  if (!raw) return '';
  let v = String(raw).trim();
  if (v.includes('ANIMAL:')) v = v.split(':').pop();
  return v.toUpperCase();
}

function renderItems(){
  if (!itemsUl) return;
  itemsUl.innerHTML = '';
  for (const key of collected) {
    const li = document.createElement('li');
    li.textContent = key;
    itemsUl.appendChild(li);
  }
}

function onHit(raw){
  const k = getKeyFromQR(raw);
  if (!REQUIRED_KEYS.has(k)) return;

  const sizeBefore = collected.size;
  collected.add(k);
  if (collected.size !== sizeBefore && navigator.vibrate) navigator.vibrate(VIBRATE_OK);
  renderItems();

  // 동적 메시지 & 배경 전환
  const keyText = `${k}`;
  const count = collected.size;
  if (count === 1) {
    setCenterMessage(`${keyText} 잘 찾았어요`);
    crossfadeTo(VIDEO_SOURCES.stage1);
  } else if (count === 2) {
    setCenterMessage(`${keyText} 좀만 힘내세요`);
    crossfadeTo(VIDEO_SOURCES.stage2);
  } else if (isCompleted()) {
    setCenterMessage(`우와 모두 찾았어요!!\n잘했어요!`);
    crossfadeTo(VIDEO_SOURCES.stage3);
    stopCamera();
  } else {
    setCenterMessage('');
  }
}

function isCompleted(){
  for (const k of REQUIRED_KEYS) if (!collected.has(k)) return false;
  return true;
}

// rVFC가 있으면 정확한 프레임 경계에서 스캔
const useRVFC = ('requestVideoFrameCallback' in HTMLVideoElement.prototype);

function scanLoop(){
  if (!running || !video.videoWidth) {
    scheduleNext();
    return;
  }

  const now = performance.now();
  const interval = 1000 / TARGET_FPS;
  if (now - lastScanTs >= interval) {
    lastScanTs = now;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.min(1, SAMPLE_WIDTH / vw);
    const sw = Math.max(1, Math.floor(vw * scale));
    const sh = Math.max(1, Math.floor(vh * scale));

    offCanvas.width = sw;
    offCanvas.height = sh;
    ctx.drawImage(video, 0, 0, sw, sh);

    const img = ctx.getImageData(0, 0, sw, sh);
    const res = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
    if (res && res.data) onHit(res.data);
  }

  scheduleNext();
}

function scheduleNext(){
  if (!running) return;
  if (useRVFC) {
    video.requestVideoFrameCallback(() => scanLoop());
  } else {
    requestAnimationFrame(() => scanLoop());
  }
}

// 탭/백그라운드 전환 시 안전 정지
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') stopCamera();
});

// Page3 버튼
if (uiStart) uiStart.addEventListener('click', () => {
  resetState();
  goto('page4');
  startCamera();
});
