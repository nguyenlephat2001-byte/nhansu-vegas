'use strict';
/* Quét khuôn mặt (face-api.js) + vị trí GPS + IP mạng wifi. Dùng chung cho trang ngoài nhansu.karaokevegas.vn và trong web.
   VegasCapture.run({face, gps, title}) → Promise<{descriptor?, lat?, lng?, accuracy?, ip?}> */
window.VegasCapture=window.VegasCapture||(()=>{
 const LIB='https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/dist/face-api.js',MODELS='https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model';
 let ready=null;
 const loadScript=src=>new Promise((ok,bad)=>{if(window.faceapi)return ok();const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>bad(new Error('Không tải được bộ nhận diện khuôn mặt. Kiểm tra mạng.'));document.head.append(s);});
 // Máy không có WebGL (card đồ họa cũ, tắt tăng tốc phần cứng…) thì dùng WASM rồi CPU; phải chỉ đường dẫn tệp WASM trước khi khởi động
 const WASM='https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.21.0/dist/';
 const pickBackend=async tf=>{try{tf.setWasmPaths&&tf.setWasmPaths(WASM);}catch(e){}for(const b of ['webgl','wasm','cpu']){try{if(await tf.setBackend(b)){await tf.ready();if(tf.getBackend()===b)return b;}}catch(e){}}throw new Error('Thiết bị không chạy được bộ nhận diện khuôn mặt.');};
 const loadFace=()=>ready||(ready=(async()=>{await loadScript(LIB);const f=window.faceapi;await pickBackend(f.tf);await Promise.all([f.nets.tinyFaceDetector.loadFromUri(MODELS),f.nets.faceLandmark68Net.loadFromUri(MODELS),f.nets.faceRecognitionNet.loadFromUri(MODELS)]);return f;})().catch(e=>{ready=null;throw e;}));
 const gps=()=>new Promise(ok=>{if(!navigator.geolocation)return ok({});navigator.geolocation.getCurrentPosition(p=>ok({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy}),e=>ok({gpsError:e.code===1?'Bạn chưa cho phép truy cập vị trí.':'Không lấy được vị trí.'}),{enableHighAccuracy:true,timeout:15000,maximumAge:0});});
 const ip=()=>Promise.race([fetch('https://api.ipify.org?format=json').then(r=>r.json()).then(j=>({ip:j.ip})).catch(()=>({})),new Promise(ok=>setTimeout(()=>ok({}),5000))]);
 function overlay(title){
  const o=document.createElement('div');o.className='vc-ov';o.innerHTML='<style>.vc-ov{position:fixed;inset:0;z-index:2147483600;background:rgba(10,4,6,.82);display:grid;place-items:center;padding:16px;font:15px system-ui,sans-serif;color:#fff}.vc-box{width:min(420px,100%);background:#1a1014;border-radius:20px;padding:18px;display:grid;gap:12px;text-align:center}.vc-box h3{margin:0;font-size:18px}.vc-cam{position:relative;border-radius:16px;overflow:hidden;background:#000;aspect-ratio:3/4}.vc-cam video{width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}.vc-ring{position:absolute;inset:12% 16%;border:3px solid rgba(255,255,255,.55);border-radius:50%;transition:border-color .2s}.vc-ring.ok{border-color:#3ddc84}.vc-st{min-height:22px;color:#f1d7dd}.vc-x{border:1px solid #6b4a57;background:transparent;color:#fff;border-radius:12px;padding:10px;font:inherit;cursor:pointer}</style><div class="vc-box" role="dialog" aria-label="Quét khuôn mặt"><h3></h3><div class="vc-cam"><video playsinline muted autoplay></video><span class="vc-ring"></span></div><p class="vc-st" role="status">Đang mở camera…</p><button type="button" class="vc-x">Hủy</button></div>';
  o.querySelector('h3').textContent=title||'Quét khuôn mặt';document.body.append(o);return o;
 }
 async function scanFace(title){
  const o=overlay(title),st=o.querySelector('.vc-st'),video=o.querySelector('video'),ring=o.querySelector('.vc-ring');let stream=null,stop=false;
  const cleanup=()=>{stop=true;stream?.getTracks().forEach(t=>t.stop());o.remove();};
  return new Promise(async(ok,bad)=>{
   o.querySelector('.vc-x').onclick=()=>{cleanup();bad(new Error('Đã hủy quét khuôn mặt.'));};
   try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:false});
    video.srcObject=stream;await video.play().catch(()=>{});
    st.textContent='Đang tải bộ nhận diện (lần đầu hơi lâu)…';const f=await loadFace();
    st.textContent='Nhìn thẳng vào camera, giữ yên…';const samples=[];
    while(!stop){
     const r=await f.detectSingleFace(video,new f.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:.55})).withFaceLandmarks().withFaceDescriptor();
     ring.classList.toggle('ok',!!r);
     if(r){samples.push(Array.from(r.descriptor));st.textContent='Đã nhận khuôn mặt ('+samples.length+'/3)…';if(samples.length>=3){const avg=samples[0].map((_,i)=>samples.reduce((s,d)=>s+d[i],0)/samples.length);cleanup();return ok(avg);}}
     else st.textContent='Chưa thấy khuôn mặt — đưa mặt vào khung tròn, đủ sáng.';
     await new Promise(r=>setTimeout(r,250));
    }
   }catch(e){cleanup();bad(new Error(e&&e.name==='NotAllowedError'?'Bạn chưa cho phép dùng camera.':e.message||'Không mở được camera.'));}
  });
 }
 async function run(opts={}){
  const tasks=[opts.gps?gps():Promise.resolve({}),opts.gps||opts.ip?ip():Promise.resolve({})];
  const descriptor=opts.face?await scanFace(opts.title):undefined;
  const [g,i]=await Promise.all(tasks);return {descriptor,...g,...i};
 }
 return {run};
})();
