// ===== 설정 =====
const REQUIRED_KEYS = new Set(['SQUIRREL','RABBIT','DEER']); // 스캔해야할 3종
const SAMPLE_WIDTH = 640;          // 다운스케일 목표 가로(px) → 성능/정확도 밸런스
const TARGET_FPS = 15;             // 스캔 빈도(대략)
const VIBRATE_OK = 25;             // 스캔 피드백(ms)

// ===== 요소 =====
const video   = document.getElementById('qrVideo');
const startBtn= document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const banner  = document.getElementById('banner');

// ===== 상태 =====
let stream = null;
let running = false;
let lastScanTs = 0;
let collected = new Set();

// 오프스크린 캔버스(화면에 붙이지 않음)
const offCanvas = document.createElement('canvas');
const ctx = offCanvas.getContext('2d', { willReadFrequently: true });

function setBanner(msg){ banner.textContent = msg; }

async function startCamera(){
  if (stream) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width:  { ideal: 1280 },      // 원본 해상도(브라우저가 맞춰줌)
        height: { ideal: 720 }
      },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    running = true;
    startBtn.disabled = true;
    stopBtn.disabled  = false;
    setBanner('아이템을 찾아보세요');
    scanLoop();
  } catch(e) {
    setBanner('카메라 접근 실패: ' + e.message);
  }
}

function stopCamera(){
  running = false;
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  startBtn.disabled = false;
  stopBtn.disabled = true;
}

function getKeyFromQR(raw){
  if (!raw) return '';
  let v = String(raw).trim();
  if (v.includes('ANIMAL:')) v = v.split(':').pop();
  return v.toUpperCase();
}

function onHit(raw){
  const k = getKeyFromQR(raw);
  if (!REQUIRED_KEYS.has(k)) return;

  const sizeBefore = collected.size;
  collected.add(k);
  if (collected.size !== sizeBefore && navigator.vibrate) navigator.vibrate(VIBRATE_OK);

  if (isCompleted()){
    stopCamera();
    setBanner('잘했어요');
  } else {
    setBanner(`좋아요! 계속 찾아보세요 (${collected.size}/3)`);
  }
}

function isCompleted(){
  for (const k of REQUIRED_KEYS) if (!collected.has(k)) return false;
  return true;
}

// rVFC가 있으면 정확한 프레임 경계에서 스캔
const useRVFC = ('requestVideoFrameCallback' in HTMLVideoElement.prototype);

function scanLoop(time){
  if (!running || !video.videoWidth) {
    scheduleNext();
    return;
  }

  const now = performance.now();
  const interval = 1000 / TARGET_FPS;
  if (now - lastScanTs >= interval) {
    lastScanTs = now;

    // 다운스케일 사이즈 계산
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.min(1, SAMPLE_WIDTH / vw);
    const sw = Math.max(1, Math.floor(vw * scale));
    const sh = Math.max(1, Math.floor(vh * scale));

    offCanvas.width = sw;
    offCanvas.height = sh;

    // ROI가 필요하면 중앙부만 그리기(예: 80% 영역)
    // const roi = { sx: vw*0.1, sy: vh*0.1, sw: vw*0.8, sh: vh*0.8 };
    // ctx.drawImage(video, roi.sx, roi.sy, roi.sw, roi.sh, 0, 0, sw, sh);
    ctx.drawImage(video, 0, 0, sw, sh);

    const img = ctx.getImageData(0, 0, sw, sh);
    const res = jsQR(img.data, img.width, img.height, {
      inversionAttempts: 'dontInvert' // 조명에 따라 'attemptBoth'로 바꿀 수 있음(조금 느려짐)
    });

    if (res && res.data) onHit(res.data);
  }

  scheduleNext();
}

function scheduleNext(){
  if (!running) return;
  if (useRVFC) {
    video.requestVideoFrameCallback(scanLoop);
  } else {
    requestAnimationFrame(scanLoop);
  }
}

// 탭/백그라운드 전환 시 안전 정지
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') stopCamera();
});

// 버튼
startBtn.addEventListener('click', () => {
  collected = new Set();
  startCamera();
});
stopBtn.addEventListener('click', () => {
  stopCamera();
  setBanner('중지되었습니다. 다시 시작하려면 Start');
});
