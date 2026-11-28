'use strict';
/* Chấm công: quét khuôn mặt (face-api.js · SSD MobileNet v1 + 68 điểm + mô tả 128 chiều) + vị trí GPS + IP wifi.
   Dùng chung cho trang ngoài nhansu.karaokevegas.vn (capture.js) và trong web.
   VegasCapture.run({face, gps, title}) → Promise<{descriptor?, samples?, live?, quality?, lat?, lng?, accuracy?, gpsFixes?, ip?}>
   Quét 5 giây: lấy mẫu khi nhìn thẳng (mặt đủ lớn, rõ nét), bắt buộc quay mặt trái rồi phải (chống ảnh / màn hình),
   gửi ~10 mẫu để máy chủ so từng mẫu. GPS theo dõi suốt thời gian quét, giữ điểm có sai số nhỏ nhất. */
window.VegasCapture=window.VegasCapture||(()=>{
 const LIB='https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/dist/face-api.js',MODELS='https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model';
 const WASM='https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.21.0/dist/';
 const SCAN_MS=5000,MIN_GOOD=4,MAX_SAMPLES=12;
 let ready=null,detector='ssd';
 const loadScript=src=>new Promise((ok,bad)=>{if(window.faceapi)return ok();const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>bad(new Error('Không tải được bộ nhận diện khuôn mặt. Kiểm tra mạng.'));document.head.append(s);});
 // Máy không có WebGL thì dùng WASM rồi CPU
 const pickBackend=async tf=>{try{tf.setWasmPaths&&tf.setWasmPaths(WASM);}catch(e){}for(const b of ['webgl','wasm','cpu']){try{if(await tf.setBackend(b)){await tf.ready();if(tf.getBackend()===b)return b;}}catch(e){}}throw new Error('Thiết bị không chạy được bộ nhận diện khuôn mặt.');};
 // Bộ dò SSD MobileNet v1 chính xác hơn TinyFaceDetector; máy yếu (CPU) thì dùng Tiny cho kịp 10 giây
 const loadFace=()=>ready||(ready=(async()=>{await loadScript(LIB);const f=window.faceapi,backend=await pickBackend(f.tf);
  const nets=[f.nets.faceLandmark68Net.loadFromUri(MODELS),f.nets.faceRecognitionNet.loadFromUri(MODELS)];
  if(backend==='cpu'){detector='tiny';nets.push(f.nets.tinyFaceDetector.loadFromUri(MODELS));}
  else{nets.push(f.nets.ssdMobilenetv1.loadFromUri(MODELS).catch(()=>new Promise(r=>setTimeout(r,800)).then(()=>f.nets.ssdMobilenetv1.loadFromUri(MODELS))).catch(async()=>{detector='tiny';await f.nets.tinyFaceDetector.loadFromUri(MODELS);}));}
  await Promise.all(nets);
  try{const c=document.createElement('canvas');c.width=c.height=160;await f.detectSingleFace(c,detOpts(f)).withFaceLandmarks();await f.computeFaceDescriptor(c);}catch(e){}return f;})().catch(e=>{ready=null;throw e;}));
 const detOpts=f=>detector==='ssd'?new f.SsdMobilenetv1Options({minConfidence:.55,maxResults:1}):new f.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:.5});
 // GPS: theo dõi liên tục trong lúc quét, giữ điểm có sai số nhỏ nhất (điện thoại thường trả vị trí thô trước rồi mới chính xác dần)
 function watchGps(){
  const fixes=[];let id=null,err='';
  const done=new Promise(ok=>{
   if(!navigator.geolocation){err='Thiết bị không hỗ trợ định vị.';return ok();}
   id=navigator.geolocation.watchPosition(p=>{fixes.push({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,t:Date.now()});},e=>{err=e.code===1?'Bạn chưa cho phép truy cập vị trí.':'Không lấy được vị trí.';if(e.code===1)ok();},{enableHighAccuracy:true,timeout:20000,maximumAge:0});
   watchGps.stopper=ok;
  });
  // Chờ tới khi có ≥3 điểm đạt sai số mục tiêu (hoặc hết thời gian); trong lúc chờ hiện "Đang bắt định vị chính xác ±x m"
  const fine=t=>fixes.filter(x=>x.accuracy<=t).length;
  return {fixes,stop:async(waitMs=0,target=10)=>{const t0=Date.now();let ui=null;
   while(waitMs&&Date.now()-t0<waitMs&&!(fine(target)>=3)&&!(err&&!fixes.length&&Date.now()-t0>3000)){
    if(!ui&&Date.now()-t0>600){ui=document.createElement('div');ui.setAttribute('role','status');ui.style.cssText='position:fixed;inset:0;z-index:2147483600;display:grid;place-items:center;background:rgba(10,4,6,.78);color:#fff;font:15px system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center;padding:16px';document.body.append(ui);}
    if(ui){const b=fixes.length?Math.round(Math.min(...fixes.map(x=>x.accuracy))):null;ui.innerHTML='<div style="background:#1a1014;border-radius:18px;padding:18px 20px;max-width:340px;line-height:1.45"><b>Đang bắt định vị chính xác…</b><br>'+(b===null?'Đang chờ GPS':'Sai số hiện tại ±'+b+' m')+'<br><small style="color:#c9a9b3">Giữ yên điện thoại, bật Vị trí chính xác, đứng chỗ thoáng.</small></div>';}
    await new Promise(r=>setTimeout(r,250));}
   ui?.remove();if(id!==null)navigator.geolocation.clearWatch(id);
   if(!fixes.length)return {gpsError:err||'Không lấy được vị trí (bật GPS / định vị chính xác rồi thử lại).'};
   // Lấy trung bình có trọng số (1/sai số²) các điểm tốt nhất để giảm nhiễu GPS → vị trí sát thực tế hơn 1 điểm đơn lẻ
   const best=Math.min(...fixes.map(x=>x.accuracy)),good=fixes.filter(x=>x.accuracy<=best+3).slice(-15);
   let w=0,la=0,lo=0;good.forEach(x=>{const k=1/Math.max(1,x.accuracy)**2;w+=k;la+=x.lat*k;lo+=x.lng*k;});
   return {lat:la/w,lng:lo/w,accuracy:best,gpsFixes:fixes.length};}};
 }
 const ip=()=>Promise.race([fetch('https://api.ipify.org?format=json').then(r=>r.json()).then(j=>({ip:j.ip})).catch(()=>({})),new Promise(ok=>setTimeout(()=>ok({}),5000))]);
 // ---- Hình học khuôn mặt từ 68 điểm ----
 const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 const ear=e=>(dist(e[1],e[5])+dist(e[2],e[4]))/(2*dist(e[0],e[3])); // tỉ lệ mở mắt (Eye Aspect Ratio)
 function pose(lm){const p=lm.positions,l=p.slice(36,42),r=p.slice(42,48),eyeL=p[36],eyeR=p[45],nose=p[30],mid={x:(eyeL.x+eyeR.x)/2,y:(eyeL.y+eyeR.y)/2},w=dist(eyeL,eyeR)||1;
  return {ear:(ear(l)+ear(r))/2,yaw:(nose.x-mid.x)/w,roll:Math.atan2(eyeR.y-eyeL.y,eyeR.x-eyeL.x)*180/Math.PI};}
 // Camera: mở 1 lần rồi giữ lại (tắt sau 3 phút không dùng) để không phải xin quyền lại mỗi lần quét trong cùng lần mở web
 let camStream=null,camIdle=null;
 const camAlive=()=>camStream&&camStream.getVideoTracks().some(t=>t.readyState==='live');
 async function getCam(){
  clearTimeout(camIdle);
  if(camAlive()){camStream.getVideoTracks().forEach(t=>t.enabled=true);return camStream;}
  camStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:720},height:{ideal:960}},audio:false});return camStream;
 }
 function releaseCam(){if(!camStream)return;camStream.getVideoTracks().forEach(t=>t.enabled=false);clearTimeout(camIdle);camIdle=setTimeout(()=>{camStream?.getTracks().forEach(t=>t.stop());camStream=null;},180000);}
 addEventListener('pagehide',()=>{camStream?.getTracks().forEach(t=>t.stop());camStream=null;});
 // Gợi ý để trình duyệt NHỚ quyền camera (không hỏi lại các lần sau)
 async function camTip(){
  const ua=navigator.userAgent||'';
  if(/Zalo|FBAN|FBAV|Instagram|Line\/|MicroMessenger/i.test(ua))return 'Bạn đang mở trong ứng dụng (Zalo / Facebook…) nên điện thoại sẽ hỏi quyền camera mỗi lần. Hãy mở web bằng Chrome hoặc Safari.';
  try{const p=await navigator.permissions.query({name:'camera'});if(p.state==='granted')return '';}catch(e){}
  return /iPhone|iPad|iPod/i.test(ua)?'Lần đầu: bấm "Cho phép". Để không hỏi lại: Cài đặt › Safari › Camera › Cho phép.':'Lần đầu: chọn "Cho phép khi truy cập trang web" / "Allow on every visit" để lần sau không phải hỏi lại.';
 }
 function overlay(title){
  const o=document.createElement('div');o.className='vc-ov';
  o.innerHTML='<style>.vc-ov{position:fixed;inset:0;z-index:2147483600;background:rgba(10,4,6,.86);display:grid;place-items:center;padding:16px;font:15px system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff}'+
   '.vc-box{width:min(420px,100%);background:#1a1014;border-radius:22px;padding:18px;display:grid;gap:12px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5)}.vc-box h3{margin:0;font-size:18px}'+
   '.vc-cam{position:relative;border-radius:18px;overflow:hidden;background:#000;aspect-ratio:3/4}.vc-cam video{width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}'+
   '.vc-oval{position:absolute;inset:10% 15% 14%;border-radius:50%;box-shadow:0 0 0 9999px rgba(0,0,0,.38);border:3px solid rgba(255,255,255,.5);transition:border-color .2s}.vc-oval.ok{border-color:#3ddc84}.vc-oval.warn{border-color:#ffb347}'+
   '.vc-ring{position:absolute;right:10px;top:10px;width:58px;height:58px}.vc-ring circle{fill:none;stroke-width:5}.vc-ring .bg{stroke:rgba(255,255,255,.2)}.vc-ring .fg{stroke:#3ddc84;stroke-linecap:round;transform:rotate(-90deg);transform-origin:50% 50%;transition:stroke-dashoffset .2s linear}'+
   '.vc-ring text{fill:#fff;font:700 17px system-ui;text-anchor:middle;dominant-baseline:central}'+
   '.vc-arrow{position:absolute;top:50%;width:64px;height:64px;margin-top:-32px;border-radius:50%;background:rgba(139,26,46,.85);display:none;place-items:center;font-size:34px;font-weight:700;animation:vcp 0.9s ease-in-out infinite}.vc-arrow.l{left:8px}.vc-arrow.r{right:8px}.vc-arrow.on{display:grid}'+
   '@keyframes vcp{0%,100%{transform:translateX(0)}50%{transform:translateX(var(--dx,0))}}.vc-arrow.l{--dx:-8px}.vc-arrow.r{--dx:8px}@media(prefers-reduced-motion:reduce){.vc-arrow{animation:none}}'+
   '.vc-chips{display:flex;gap:6px;justify-content:center;flex-wrap:wrap}.vc-chip{font-size:12.5px;padding:4px 10px;border-radius:999px;background:#2a1c22;color:#d9c2c9}.vc-chip.on{background:#1f3d2c;color:#7ff0a8}.vc-chip.bad{background:#3d2a1a;color:#ffc27a}'+
   '.vc-st{min-height:40px;margin:0;color:#f1d7dd;line-height:1.4}.vc-tip{margin:0;font-size:12.5px;color:#c9a9b3;line-height:1.4}.vc-btns{display:flex;gap:8px}.vc-btns button{flex:1;border:1px solid #6b4a57;background:transparent;color:#fff;border-radius:12px;padding:11px;font:inherit;cursor:pointer}.vc-btns .vc-retry{background:#8B1A2E;border-color:#8B1A2E}</style>'+
   '<div class="vc-box" role="dialog" aria-label="Quét khuôn mặt"><h3></h3><div class="vc-cam"><video playsinline muted autoplay></video><span class="vc-oval"></span><span class="vc-arrow l" aria-hidden="true">‹</span><span class="vc-arrow r" aria-hidden="true">›</span>'+
   '<svg class="vc-ring" viewBox="0 0 58 58" aria-hidden="true"><circle class="bg" cx="29" cy="29" r="25"/><circle class="fg" cx="29" cy="29" r="25" stroke-dasharray="157.1" stroke-dashoffset="157.1"/><text x="29" y="29">'+Math.round(SCAN_MS/1000)+'</text></svg></div>'+
   '<div class="vc-chips"><span class="vc-chip" data-c="face">Khuôn mặt</span><span class="vc-chip" data-c="left">Quay trái</span><span class="vc-chip" data-c="right">Quay phải</span><span class="vc-chip" data-c="gps" hidden>Vị trí</span></div>'+
   '<p class="vc-st" role="status" aria-live="polite">Đang mở camera…</p><p class="vc-tip" hidden></p><div class="vc-btns"><button type="button" class="vc-x">Hủy</button></div></div>';
  o.querySelector('h3').textContent=title||'Quét khuôn mặt';document.body.append(o);return o;
 }
 // Quét 5 giây: nhìn thẳng (lấy mẫu) → quay mặt sang trái → sang phải (chống ảnh / video giả). Trả {descriptor, samples, live, quality}
 async function scanFace(title,g){
  const o=overlay(title),st=o.querySelector('.vc-st'),tip=o.querySelector('.vc-tip'),video=o.querySelector('video'),oval=o.querySelector('.vc-oval'),fg=o.querySelector('.vc-ring .fg'),num=o.querySelector('.vc-ring text');
  const arrL=o.querySelector('.vc-arrow.l'),arrR=o.querySelector('.vc-arrow.r');
  const chip=k=>o.querySelector('[data-c="'+k+'"]');let stream=null,stop=false,gpsTimer=null;
  if(g){chip('gps').hidden=false;gpsTimer=setInterval(()=>{const f=g.fixes;if(!f.length)return;const a=Math.round(Math.min(...f.map(x=>x.accuracy)));const c=chip('gps');c.textContent='Vị trí ±'+a+' m';c.classList.toggle('on',a<=10);c.classList.toggle('bad',a>10);},500);}
  const cleanup=()=>{stop=true;clearInterval(gpsTimer);releaseCam();o.remove();};
  return new Promise(async(ok,bad)=>{
   o.querySelector('.vc-x').onclick=()=>{cleanup();bad(new Error('Đã hủy quét khuôn mặt.'));};
   try{
    const loading=loadFace();
    if(!camAlive()){const tx=await camTip();if(tx){tip.textContent=tx;tip.hidden=false;}}
    const ask=setTimeout(()=>{if(!stream&&!stop)st.textContent='Trình duyệt đang hỏi quyền camera — bấm "Cho phép" (Allow).';},1500);
    const s=await getCam();clearTimeout(ask);
    if(stop){releaseCam();return;}
    stream=s;video.srcObject=stream;await video.play().catch(()=>{});
    let f=null;const slow=setTimeout(()=>{if(!f&&!stop)st.textContent='Đang tải bộ nhận diện (chỉ lần đầu)…';},400);
    f=await loading;clearTimeout(slow);if(stop)return;
    tip.hidden=true;
    const opt=detOpts(f),good=[];let turnL=false,turnR=false,t0=0,faceSeen=0,lastMsg='';
    const say=m=>{if(m!==lastMsg){st.textContent=m;lastMsg=m;}};
    say('Đặt mặt vào khung oval, nhìn thẳng camera…');
    while(!stop){
     if(video.readyState<2){await new Promise(r=>setTimeout(r,50));continue;}
     const r=await f.detectSingleFace(video,opt).withFaceLandmarks().withFaceDescriptor();if(stop)break;
     const vw=video.videoWidth||640,vh=video.videoHeight||480;
     let ok1=false,why='',need='';
     if(r){const b=r.detection.box,p=pose(r.landmarks),cx=(b.x+b.width/2)/vw,cy=(b.y+b.height/2)/vh;
      if(!t0)t0=Date.now();faceSeen=Date.now();
      // Ảnh camera trước chưa lật: người dùng quay sang TRÁI của họ → mũi lệch về bên phải ảnh (yaw dương)
      if(good.length>=2&&p.yaw>.2)turnL=true;
      if(turnL&&p.yaw<-.2)turnR=true;
      need=good.length<2?'':!turnL?'left':!turnR?'right':'';
      if(b.width<vw*.26)why='Đưa mặt lại gần camera hơn.';
      else if(b.width>vw*.88)why='Lùi ra xa một chút.';
      else if(Math.abs(cx-.5)>.22||Math.abs(cy-.5)>.24)why='Đưa mặt vào giữa khung oval.';
      else if(Math.abs(p.roll)>14)why='Giữ đầu thẳng, đừng nghiêng.';
      else if(r.detection.score<(detector==='ssd'?.75:.6))why='Hình chưa rõ — tìm chỗ đủ sáng, bỏ khẩu trang / kính râm.';
      else if(Math.abs(p.yaw)<.12&&p.ear>.2){ok1=true;good.push({d:Array.from(r.descriptor),s:r.detection.score});}
     }else why=t0&&Date.now()-faceSeen<1200?'Giữ mặt trong khung…':'Chưa thấy khuôn mặt — đưa mặt vào khung, quay về phía đèn.';
     oval.classList.toggle('ok',ok1);oval.classList.toggle('warn',!!r&&!ok1&&!need);
     arrL.classList.toggle('on',need==='left');arrR.classList.toggle('on',need==='right');
     chip('face').classList.toggle('on',good.length>=MIN_GOOD);chip('face').textContent='Khuôn mặt '+Math.min(good.length,MIN_GOOD)+'/'+MIN_GOOD;
     chip('left').classList.toggle('on',turnL);chip('left').textContent=turnL?'Quay trái ✓':'Quay trái';
     chip('right').classList.toggle('on',turnR);chip('right').textContent=turnR?'Quay phải ✓':'Quay phải';
     const left=t0?Math.max(0,SCAN_MS-(Date.now()-t0)):SCAN_MS;fg.setAttribute('stroke-dashoffset',(157.1*left/SCAN_MS).toFixed(1));num.textContent=Math.ceil(left/1000);
     if(t0)say(need==='left'?'Quay mặt sang TRÁI ‹':need==='right'?'Giờ quay mặt sang PHẢI ›':why||(good.length<MIN_GOOD?'Nhìn thẳng camera, giữ yên…':'Xong — nhìn thẳng camera…'));
     // Đủ mẫu + đã quay 2 bên → xong ngay, không cần chờ hết giờ
     if(good.length>=MIN_GOOD&&turnL&&turnR){cleanup();return ok(pack(good));}
     if(t0&&left<=0){
      const reason=!turnL||!turnR?'Chưa thấy bạn quay mặt sang '+(!turnL?'trái':'phải')+' (để chống dùng ảnh).':'Chưa đủ khung hình rõ ('+good.length+'/'+MIN_GOOD+').';
      stop=true;clearInterval(gpsTimer);arrL.classList.remove('on');arrR.classList.remove('on');
      st.textContent=reason+' Bấm "Quét lại": nhìn thẳng, rồi quay trái, quay phải.';
      const btns=o.querySelector('.vc-btns'),retry=document.createElement('button');retry.type='button';retry.className='vc-retry';retry.textContent='Quét lại';btns.append(retry);
      retry.onclick=()=>{o.remove();scanFace(title,g).then(ok,bad);};
      o.querySelector('.vc-x').onclick=()=>{releaseCam();o.remove();bad(new Error('Đã hủy quét khuôn mặt.'));};
      return;
     }
     await new Promise(r=>setTimeout(r,60));
    }
   }catch(e){cleanup();bad(new Error(e&&e.name==='NotAllowedError'?'Bạn chưa cho phép dùng camera. Mở cài đặt trang web (biểu tượng ổ khóa cạnh địa chỉ) › Camera › Cho phép.':e.message||'Không mở được camera.'));}
  });
 } // Bỏ mẫu lệch nhiều so với trung bình, giữ tối đa 12 mẫu rõ nhất
 function pack(good){
  const mean=list=>list[0].map((_,i)=>list.reduce((s,d)=>s+d[i],0)/list.length);
  let d=good.map(x=>x.d);const m0=mean(d),dd=v=>Math.sqrt(v.reduce((s,x,i)=>s+(x-m0[i])**2,0));
  const sorted=good.map(x=>({...x,e:dd(x.d)})).sort((a,b)=>a.e-b.e);
  const keep=sorted.slice(0,Math.max(MIN_GOOD,Math.ceil(sorted.length*.8))).sort((a,b)=>b.s-a.s).slice(0,MAX_SAMPLES);
  const r=v=>v.map(x=>Math.round(x*1e5)/1e5);
  return {descriptor:r(mean(keep.map(x=>x.d))),samples:keep.map(x=>r(x.d)),live:true,quality:{frames:good.length,detector}};
 }
 async function run(opts={}){
  if(opts.preload){await loadFace();return {};}
  const g=opts.gps?watchGps():null,ipTask=opts.gps||opts.ip?ip():Promise.resolve({});
  let face={};
  if(opts.face)face=await scanFace(opts.title,g).catch(async e=>{if(g)await g.stop();throw e;});
  // Chấm công: sau 5 giây quét mặt chờ thêm tối đa 10 giây tới khi GPS đạt ±10 m.
  // "Lấy vị trí hiện tại" (cài tọa độ cơ sở): chờ tối đa 20 giây tới khi đạt ±5 m để tọa độ gốc thật chuẩn.
  const pos=g?await g.stop(opts.face?10000:20000,opts.face?10:5):{};
  return {...face,...pos,...await ipTask};
 }
 return {run};
})();
