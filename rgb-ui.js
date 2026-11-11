const $ = (id) => document.getElementById(id);
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// --- タブ ---
const show = (name) => document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
$("tab-gen").onclick = () => show("gen");
$("tab-scan").onclick = () => show("scan");

// --- 生成 ---
$("cap-table").textContent =
  "サイズ別の最大バイト数: " + [12, 16, 20, 24, 32, 40, 48].map((n) => `${n}×${n}=${RGBCode.capacity(n)}B`).join(" / ");

$("gen-btn").onclick = () => {
  const bytes = new TextEncoder().encode($("input-text").value);
  const info = $("gen-info");
  info.style.display = "block";
  try {
    const r = RGBCode.encode(bytes);
    const img = RGBCode.render(r.grid, r.N, Math.max(6, Math.floor(560 / (r.N + 2))), 1);
    const c = $("gen-canvas");
    c.width = img.width;
    c.height = img.height;
    c.getContext("2d").putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    info.className = "result-box";
    info.innerHTML = `${bytes.length}バイト → <b>${r.N}×${r.N}</b>マス(このサイズの最大${r.capacity}バイト) / マスク${r.mask}`;
    $("download-btn").style.display = "inline-block";
  } catch (e) {
    info.className = "result-box error";
    info.textContent = e.message;
  }
};
$("download-btn").onclick = () => {
  const a = document.createElement("a");
  a.download = "rgb-code.png";
  a.href = $("gen-canvas").toDataURL("image/png");
  a.click();
};

// --- 読取 ---
const video = $("video-preview"), scanCanvas = $("scan-canvas"), box = $("scan-result");
const scanCtx = scanCanvas.getContext("2d", { willReadFrequently: true });
let stream = null, scanning = false;

function showResult(r) {
  box.style.display = "block";
  box.className = r.ok ? "result-box" : "result-box error";
  box.innerHTML = r.ok
    ? `<b>読取成功!</b> ${r.N}×${r.N} / ${r.bytes.length}バイト / ${r.errs}シンボル訂正<br>${esc(new TextDecoder().decode(r.bytes))}`
    : esc(r.msg);
}
function updateGuide() {
  if (!video.clientWidth) return;
  const s = Math.min(video.clientWidth, video.clientHeight) * 0.7; // 検出側の scale:0.7 と一致させる
  $("guide-frame").style.width = $("guide-frame").style.height = s + "px";
}
window.addEventListener("resize", updateGuide);
video.addEventListener("loadedmetadata", () => requestAnimationFrame(updateGuide));

async function startCamera() {
  try {
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } }); }
    catch { stream = await navigator.mediaDevices.getUserMedia({ video: true }); }
    video.srcObject = stream;
    $("camera-container").style.display = "block";
    $("start-camera-btn").style.display = "none";
    $("stop-camera-btn").style.display = "inline-block";
    await video.play();
    requestAnimationFrame(() => requestAnimationFrame(updateGuide));
    box.style.display = "none";
    scanning = true;
    scanLoop();
  } catch (e) { alert("カメラの起動に失敗しました: " + e.message); }
}
function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null; scanning = false;
  $("camera-container").style.display = "none";
  $("start-camera-btn").style.display = "inline-block";
  $("stop-camera-btn").style.display = "none";
}
function scanLoop() {
  if (!scanning) return;
  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    scanCanvas.width = video.videoWidth;
    scanCanvas.height = video.videoHeight;
    scanCtx.drawImage(video, 0, 0);
    const r = RGBCode.scanFrame(scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height), [{ scale: 0.7 }]);
    if (r.ok) { stopCamera(); showResult(r); return; }
  }
  setTimeout(scanLoop, 200);
}
$("start-camera-btn").onclick = startCamera;
$("stop-camera-btn").onclick = stopCamera;

$("file-input").onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  stopCamera();
  const img = new Image();
  img.onload = () => {
    scanCanvas.width = img.width;
    scanCanvas.height = img.height;
    scanCtx.drawImage(img, 0, 0);
    scanCanvas.style.display = "block";
    // 保存PNG(周囲に1マスの余白)→ 余白なし/枠合わせ の順に試す
    showResult(RGBCode.scanFrame(scanCtx.getImageData(0, 0, img.width, img.height), [{ quiet: 1 }, { scale: 0.7 }, { scale: 0.85 }]));
  };
  img.src = URL.createObjectURL(f);
};
