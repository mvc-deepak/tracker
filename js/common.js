'use strict';
const SUBJECTS=[];
async function loadSubjectRegistry(){const root=document.body.dataset.root||'';const response=await fetch(root+'subjects/index.json',{cache:'no-cache'});if(!response.ok)throw new Error('Could not load subjects/index.json');const registry=await response.json();if(!Array.isArray(registry.subjects))throw new Error('subjects/index.json must contain a subjects array');SUBJECTS.splice(0,SUBJECTS.length,...registry.subjects.filter(entry=>entry.id&&entry.label&&entry.topicsPage).map(entry=>({...entry,file:entry.csvFile||'',description:entry.description||'',href:'subjects/'+entry.id+'/'+entry.topicsPage})));return SUBJECTS}
const subjectsReady=loadSubjectRegistry();
const STATUSES=['Not Started','Learning','Revised'];
const STORAGE_KEY='interviewPrep.status.v2';
const READ_TODAY_STORAGE_KEY='interviewPrep.readToday.v1';
const $=id=>document.getElementById(id);
function localDateKey(date=new Date()){return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0')}
function countQuestionsReadToday(){try{const activity=JSON.parse(localStorage.getItem(READ_TODAY_STORAGE_KEY)||'{}');if(!activity||typeof activity!=='object'||Array.isArray(activity))throw new Error('Saved daily reading data has an invalid format.');const today=localDateKey();return Object.values(activity).reduce((total,entry)=>{if(!entry||typeof entry!=='object'||Array.isArray(entry))throw new Error('Saved daily reading data has an invalid format.');if(entry.date!==today)return total;if(!Array.isArray(entry.keys)||entry.keys.some(key=>typeof key!=='string'))throw new Error('Saved daily reading data has an invalid format.');return total+new Set(entry.keys).size},0)}catch(error){console.error('Could not load the daily read count:',error);return null}}
function setupReadTodayCounter(){const brand=document.querySelector('.topbar .brand');if(!brand)return;const counter=document.createElement('span');counter.className='read-today-counter';counter.setAttribute('role','status');counter.setAttribute('aria-label','Questions read today');counter.innerHTML='<span aria-hidden="true">📖</span><strong></strong><span>today</span>';brand.after(counter);const update=()=>{const count=countQuestionsReadToday();counter.hidden=count===null;if(count!==null){counter.querySelector('strong').textContent=String(count);counter.title=count+' '+(count===1?'question':'questions')+' read today'}};window.addEventListener('question-read-today-updated',update);window.addEventListener('storage',event=>{if(event.key===READ_TODAY_STORAGE_KEY)update()});update()}
function getSubjectIdFromPath(){const segments=location.pathname.split('/').filter(Boolean);const subjectIndex=segments.lastIndexOf('subjects');return subjectIndex>=0?decodeURIComponent(segments[subjectIndex+1]||''):''}
function getSaved(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')}catch{return {}}}
function saveSaved(data){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(data))}catch{}}
function keyFor(subject,q){let h=2166136261;const s=subject+'|'+q;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return subject+':'+(h>>>0).toString(36)}
function parseCSV(text){const rows=[];let row=[],field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++}else if(c==='"')quoted=false;else field+=c}else if(c==='"'){if(field)throw Error('Unexpected quote in CSV.');quoted=true}else if(c===','){row.push(field);field=''}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);field='';if(row.some(x=>x.trim()))rows.push(row);row=[]}else field+=c}if(quoted)throw Error('CSV has an unfinished quoted field.');if(field||row.length){row.push(field);if(row.some(x=>x.trim()))rows.push(row)}if(!rows.length)return[];const headers=rows.shift().map(x=>x.trim().replace(/^\uFEFF/,''));const expected=['Question','Answer','CoreConcept','LanguageTag','Status','Importance'];if(headers.join('|')!==expected.join('|'))throw Error('CSV columns must be: '+expected.join(', '));return rows.map((cells,i)=>{if(cells.length!==6)throw Error('Row '+(i+2)+' has '+cells.length+' fields; expected 6.');const r=Object.fromEntries(expected.map((h,j)=>[h,cells[j].trim()]));const importance=Number(r.Importance);if(!r.Question||!r.Answer||!r.CoreConcept||!r.LanguageTag||!STATUSES.includes(r.Status)||!Number.isInteger(importance)||importance<1||importance>5)throw Error('Row '+(i+2)+' has missing text or invalid Status/Importance.');return {question:r.Question,answer:r.Answer,concept:r.CoreConcept,language:r.LanguageTag,csvStatus:r.Status,importance}})}
function escapeHTML(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function answerHTML(text){
  const chunks=String(text).split(/(```[^\n]*\n[\s\S]*?```)/g);
  return chunks.map(chunk=>{
    if(chunk.startsWith('```')&&chunk.endsWith('```')){
      const code=chunk.replace(/^```[^\n]*\n/,'').replace(/```$/,'').replace(/\n$/,'');
      return '<pre><code>'+escapeHTML(code)+'</code></pre>';
    }
    let safe=escapeHTML(chunk);
    safe=safe.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,(_,alt,rawPath)=>{
      const path=rawPath.trim();
      if(/^(javascript|data):/i.test(path)||! /^(https?:\/\/|\/|\.\.?\/|[^\s:]+$)/i.test(path))return '<span class="media-fallback">Image path blocked</span>';
      return '<img src="'+path.replace(/"/g,'&quot;')+'" alt="'+alt.replace(/"/g,'&quot;')+'" loading="lazy" data-zoom tabindex="0" role="button" aria-label="View larger image">';
    });
    safe=safe.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(_,label,url)=>{
      const video=url.match(/^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i);
      if(video)return '<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/'+video[1]+'" title="'+label.replace(/"/g,'&quot;')+'" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>';
      return '<a href="'+url.replace(/"/g,'&quot;')+'" target="_blank" rel="noopener noreferrer">'+label+'</a>';
    });
    safe=safe.replace(/(^|[\s>])(https?:\/\/[^\s<]+)/g,(whole,prefix,url)=>{
      const clean=url.replace(/[.,!?;:]$/,'');
      const video=clean.match(/^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i);
      if(video)return prefix+'<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/'+video[1]+'" title="YouTube video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>';
      return prefix+'<a href="'+clean.replace(/"/g,'&quot;')+'" target="_blank" rel="noopener noreferrer">'+clean+'</a>'+url.slice(clean.length);
    });
    safe=safe.replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
    return safe.split(/\n\n+/).map(paragraph=>{
      const lines=paragraph.split(/<br\s*\/?\s*>/i);
      if(lines.length&&lines.every(line=>/^\s*[-*]\s+/.test(line)))return '<ul>'+lines.map(line=>'<li>'+line.replace(/^\s*[-*]\s+/,'')+'</li>').join('')+'</ul>';
      return '<p>'+paragraph+'</p>';
    }).join('');
  }).join('');
}
function setupTheme(){const saved=localStorage.getItem('interviewPrep.theme');document.documentElement.dataset.theme=saved==='dark'?'dark':'light';const btn=$('themeToggle');if(!btn)return;const update=()=>{const dark=document.documentElement.dataset.theme==='dark';btn.textContent=dark?'☀️':'🌙';btn.setAttribute('aria-label',dark?'Switch to light theme':'Switch to dark theme');btn.title=dark?'Switch to light theme':'Switch to dark theme'};btn.addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;localStorage.setItem('interviewPrep.theme',next);update()});update()}
let lightboxImages=[];
let lightboxIndex=0;
let lightboxTouchStart=null;
let ignoreLightboxClickUntil=0;
function setupLightbox(){
  const box=document.createElement('div');
  box.className='lightbox';
  box.hidden=true;
  box.setAttribute('role','dialog');
  box.setAttribute('aria-modal','true');
  box.setAttribute('aria-label','Image viewer');
  box.innerHTML='<button type="button" class="lightbox-close" aria-label="Close expanded image">×</button><img alt="Expanded supporting image"><span class="lightbox-count" aria-live="polite"></span>';
  document.body.append(box);
  const close=()=>{box.hidden=true;lightboxTouchStart=null};
  const show=(index,direction=0)=>{
    if(!lightboxImages.length)return;
    lightboxIndex=(index+lightboxImages.length)%lightboxImages.length;
    const item=lightboxImages[lightboxIndex];
    const image=box.querySelector('img');
    image.classList.remove('slide-in-left','slide-in-right');
    image.src=item.src;
    image.alt=item.alt;
    if(direction){void image.offsetWidth;image.classList.add(direction>0?'slide-in-right':'slide-in-left')}
    box.querySelector('.lightbox-count').textContent=lightboxImages.length>1?`${lightboxIndex+1} / ${lightboxImages.length}`:'';
  };
  const step=amount=>show(lightboxIndex+amount,amount);
  box.querySelector('.lightbox-close').onclick=close;
  box.onclick=event=>{if(event.target===box)close()};
  box.addEventListener('click',event=>{
    if(event.target!==box.querySelector('img')||Date.now()<ignoreLightboxClickUntil||lightboxImages.length<2)return;
    const bounds=event.target.getBoundingClientRect();
    step(event.clientX<bounds.left+bounds.width/2?-1:1);
  });
  box.addEventListener('pointerdown',event=>{
    if(event.target===box.querySelector('img')&&event.pointerType!=='mouse')lightboxTouchStart={x:event.clientX,y:event.clientY};
  },{passive:true});
  box.addEventListener('pointerup',event=>{
    if(!lightboxTouchStart)return;
    const dx=event.clientX-lightboxTouchStart.x;
    const dy=event.clientY-lightboxTouchStart.y;
    lightboxTouchStart=null;
    if(Math.abs(dx)>48&&Math.abs(dx)>Math.abs(dy)*1.25){ignoreLightboxClickUntil=Date.now()+700;step(dx<0?1:-1)}
  },{passive:true});
  document.addEventListener('keydown',event=>{
    if(box.hidden)return;
    if(event.key==='Escape')close();
    else if(event.key==='ArrowRight')step(1);
    else if(event.key==='ArrowLeft')step(-1);
  });
  document.addEventListener('click',event=>{
    const img=event.target.closest('[data-zoom]');
    if(!img)return;
    lastMediaTrigger=img;
    const card=img.closest('.revision-image-card');
    lightboxImages=card?[...document.querySelectorAll('.revision-image-card img[data-zoom]')].map(item=>({src:item.currentSrc||item.src,alt:item.alt})):[];
    if(card){lightboxIndex=lightboxImages.findIndex(item=>item.src===(img.currentSrc||img.src));if(lightboxIndex<0)lightboxIndex=0}
    else lightboxImages=[{src:img.currentSrc||img.src,alt:img.alt}];
    show(lightboxIndex);
    box.hidden=false;
    box.querySelector('.lightbox-close').focus();
  });
}
async function pageExists(url){try{const response=await fetch(url,{method:'HEAD',cache:'no-cache'});return response.ok}catch{return false}}
const CONTENT_IMAGE_EXTENSIONS=new Set(['.avif','.bmp','.gif','.jpeg','.jpg','.png','.svg','.webp']);
const contentTitleFromName=value=>value.replace(/[-_]+/g,' ').replace(/\b\w/g,character=>character.toLocaleUpperCase());
async function readOptionalJson(directory,fileName,fallback){try{const file=await directory.getFileHandle(fileName);return JSON.parse(await(await file.getFile()).text())}catch(error){if(error.name==='NotFoundError')return fallback;throw error}}
async function readDirectoryFiles(directory,prefix=''){const files=[];for await(const[name,handle]of directory.entries()){if(name.startsWith('.'))continue;const relativePath=prefix?prefix+'/'+name:name;if(handle.kind==='directory')files.push(...await readDirectoryFiles(handle,relativePath));else files.push({file:relativePath,handle})}return files}
async function writeJsonFile(directory,fileName,value){const handle=await directory.getFileHandle(fileName,{create:true});const writable=await handle.createWritable();await writable.write(JSON.stringify(value,null,2)+'\n');await writable.close()}
async function generateIndexesFromLocalCheckout(rootHandle){
  const subjectsDirectory=await rootHandle.getDirectoryHandle('subjects');
  const previousRegistry=await readOptionalJson(subjectsDirectory,'index.json',{subjects:[]});
  const previousSubjects=new Map((Array.isArray(previousRegistry.subjects)?previousRegistry.subjects:[]).map(subject=>[subject.id,subject]));
  const subjects=[];const topicIndexes=[];
  for await(const[id,subjectDirectory]of subjectsDirectory.entries()){
    if(subjectDirectory.kind!=='directory'||id.startsWith('.'))continue;
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))throw new Error(`Invalid subject folder name "${id}". Use lowercase letters, numbers, and hyphens.`);
    let topicsDirectory;try{topicsDirectory=await subjectDirectory.getDirectoryHandle('topics')}catch(error){if(error.name==='NotFoundError')continue;throw error}
    const topicPage=id+'.html';try{await subjectDirectory.getFileHandle(topicPage)}catch(error){if(error.name==='NotFoundError')throw new Error(`Missing subjects/${id}/${topicPage}. Add the subject topic-page shell, then refresh indexes.`);throw error}
    const previousSubject=previousSubjects.get(id)||{};const metadata=await readOptionalJson(subjectDirectory,'subject.json',{});
    const subjectFiles=[];for await(const[name,handle]of subjectDirectory.entries())if(handle.kind==='file')subjectFiles.push(name);
    const csvFiles=subjectFiles.filter(name=>name.toLocaleLowerCase().endsWith('.csv')).sort((a,b)=>a.localeCompare(b));
    const csvFile=csvFiles.includes(id+'.csv')?id+'.csv':csvFiles.length===1?csvFiles[0]:null;
    if(csvFiles.length>1&&!csvFiles.includes(id+'.csv'))throw new Error(`Multiple CSVs in subjects/${id}. Keep one CSV or name the question bank ${id}.csv.`);
    const interviewFile=id+'_interview.html';const interviewPage=csvFile&&subjectFiles.includes(interviewFile)?interviewFile:null;
    const previousManifest=await readOptionalJson(topicsDirectory,'index.json',{topics:[]});
    const previousTopics=new Map((Array.isArray(previousManifest.topics)?previousManifest.topics:[]).map(topic=>[topic.id,topic]));
    const topics=[];
    for await(const[topicId,topicDirectory]of topicsDirectory.entries()){
      if(topicDirectory.kind!=='directory'||topicId.startsWith('.'))continue;
      if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topicId))throw new Error(`Invalid topic folder name "${topicId}" in subjects/${id}/topics.`);
      const previousTopic=previousTopics.get(topicId)||{};const previousPages=new Map((previousTopic.pages||[]).map(page=>[page.file,page]));
      const previousImages=new Map((previousTopic.images||[]).map(image=>[image.file,image]));
      const pages=[];const images=[];
      for(const entry of await readDirectoryFiles(topicDirectory)){
        const extension=entry.file.slice(entry.file.lastIndexOf('.')).toLocaleLowerCase();
        if(extension==='.md'){
          const markdown=await(await entry.handle.getFile()).text();const heading=markdown.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1]?.trim();const previousPage=previousPages.get(entry.file);
          pages.push({file:entry.file,title:previousPage?.title||heading||contentTitleFromName(entry.file.split('/').pop().replace(/\.md$/i,''))});
        }else if(CONTENT_IMAGE_EXTENSIONS.has(extension)){
          const previousImage=previousImages.get(entry.file);images.push({file:entry.file,alt:previousImage?.alt||contentTitleFromName(entry.file.split('/').pop().replace(/\.[^.]+$/,''))});
        }
      }
      pages.sort((a,b)=>a.file.localeCompare(b.file));images.sort((a,b)=>a.file.localeCompare(b.file));
      topics.push({id:topicId,title:previousTopic.title||contentTitleFromName(topicId),description:previousTopic.description||'',pages,images});
    }
    topics.sort((a,b)=>a.title.localeCompare(b.title));topicIndexes.push({directory:topicsDirectory,value:{topics}});
    subjects.push({id,label:metadata.label||previousSubject.label||contentTitleFromName(id),description:metadata.description??previousSubject.description??'',...(csvFile?{csvFile}:{}),topicsPage:topicPage,...(interviewPage?{interviewPage}:{})});
  }
  subjects.sort((a,b)=>a.label.localeCompare(b.label));
  for(const topicIndex of topicIndexes)await writeJsonFile(topicIndex.directory,'index.json',topicIndex.value);
  await writeJsonFile(subjectsDirectory,'index.json',{subjects});
  return{subjectCount:subjects.length,topicCount:topicIndexes.reduce((sum,index)=>sum+index.value.topics.length,0)};
}
async function refreshContentIndexes(button){
  if(!window.showDirectoryPicker){window.alert('Folder access is unavailable in this browser. Use Chrome or Edge on localhost or HTTPS.');return}
  const originalText=button.textContent;button.disabled=true;button.textContent='Choose project folder…';
  try{
    const rootHandle=await window.showDirectoryPicker({id:'interview-prep-index-refresh',mode:'readwrite'});
    let permission=await rootHandle.queryPermission({mode:'readwrite'});if(permission!=='granted')permission=await rootHandle.requestPermission({mode:'readwrite'});if(permission!=='granted')throw new Error('Write permission was not granted.');
    button.textContent='Scanning folders…';const result=await generateIndexesFromLocalCheckout(rootHandle);
    await saveCheckoutHandle(rootHandle);
    window.alert(`Indexes refreshed: ${result.subjectCount} subjects and ${result.topicCount} topics. Review and commit subjects/index.json and the topics/index.json files.`);
    if(location.protocol==='http:'||location.protocol==='https:')window.location.reload();
    else dispatchCheckoutSelected(rootHandle);
  }catch(error){if(error.name!=='AbortError')window.alert('Could not refresh indexes: '+error.message)}
  finally{button.disabled=false;button.textContent=originalText}
}
function createRefreshIndexesButton(){const topbar=document.querySelector('.topbar');if(!topbar)return null;const control=document.createElement('div');control.className='local-checkout-control';const button=document.createElement('button');button.className='button icon-button refresh-indexes-button';button.id='refreshContentIndexes';button.type='button';button.title='Select a local checkout and refresh generated content indexes';button.setAttribute('aria-label','Select local checkout and refresh content indexes');button.textContent='↻';const status=document.createElement('span');status.className='checkout-header-status';status.setAttribute('role','status');button.addEventListener('click',event=>refreshContentIndexes(event.currentTarget));control.append(button,status);topbar.append(control);getSavedCheckoutHandle().then(handle=>{if(handle)dispatchCheckoutSelected(handle,true)}).catch(error=>{status.textContent='Saved checkout unavailable; select it again.';button.title='Could not restore the saved checkout: '+error.message;console.error('Saved checkout could not be restored:',error)});return control}
const CHECKOUT_DB_NAME='interviewPrep.checkout';
function openCheckoutDatabase(){return new Promise((resolve,reject)=>{const request=indexedDB.open(CHECKOUT_DB_NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore('handles');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('Could not open browser checkout storage.'))})}
async function saveCheckoutHandle(handle){const database=await openCheckoutDatabase();try{await new Promise((resolve,reject)=>{const transaction=database.transaction('handles','readwrite');transaction.objectStore('handles').put(handle,'root');transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error||new Error('Could not save the selected checkout.'));transaction.onabort=()=>reject(transaction.error||new Error('Saving the selected checkout was cancelled.'))})}finally{database.close()}}
async function getSavedCheckoutHandle(){const database=await openCheckoutDatabase();try{const handle=await new Promise((resolve,reject)=>{const request=database.transaction('handles','readonly').objectStore('handles').get('root');request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error||new Error('Could not read the saved checkout.'))});if(!handle)return null;return await handle.queryPermission({mode:'readwrite'})==='granted'?handle:null}finally{database.close()}}
function dispatchCheckoutSelected(handle,restored=false){document.dispatchEvent(new CustomEvent('local-checkout-selected',{detail:{handle,restored}}))}
async function setupSiteNavigation(){const checkoutControl=createRefreshIndexesButton();const nav=document.getElementById('siteNav');if(!nav)return;const root=document.body.dataset.root||'';const trackerLink=document.createElement('a');trackerLink.className='tracker-nav-button';trackerLink.href=root+'tracker.html';trackerLink.textContent='📊';trackerLink.title='Tracker';trackerLink.setAttribute('aria-label','Tracker');if(location.pathname===new URL(trackerLink.href,document.baseURI).pathname){trackerLink.classList.add('active');trackerLink.setAttribute('aria-current','page')}if(checkoutControl)checkoutControl.after(trackerLink);else nav.after(trackerLink);try{await subjectsReady;const links=[];for(const subject of SUBJECTS){const topicHref=root+'subjects/'+subject.id+'/'+subject.topicsPage;if(await pageExists(topicHref)){const active=location.pathname===new URL(topicHref,document.baseURI).pathname;links.push(`<a href="${escapeHTML(topicHref)}"${active?' class="active" aria-current="page"':''}>${escapeHTML(subject.label)}</a>`)}}nav.innerHTML=links.join('')}catch(error){nav.replaceChildren();console.error('Subject navigation could not be loaded:',error)}}
function setupHeaderScroll(){const topbar=document.querySelector('.topbar');if(!topbar)return;const update=()=>topbar.classList.toggle('topbar-hidden',window.scrollY>80);window.addEventListener('scroll',update,{passive:true});update()}
setupTheme();setupLightbox();setupReadTodayCounter();setupSiteNavigation();setupHeaderScroll();
let lastMediaTrigger=null;
document.addEventListener('click',event=>{const image=event.target.closest('[data-zoom]');if(!image)return;lastMediaTrigger=image;const box=document.querySelector('.lightbox');box.querySelector('button').focus()});
document.addEventListener('keydown',event=>{const image=event.target.closest('[data-zoom]');if(image&&(event.key==='Enter'||event.key===' ')){event.preventDefault();image.click()}if(event.key==='Escape'&&lastMediaTrigger){lastMediaTrigger.focus();lastMediaTrigger=null}});
document.addEventListener('error',event=>{const image=event.target;if(!image.matches('[data-zoom]'))return;const fallback=document.createElement('span');fallback.className='media-fallback';fallback.textContent='Supporting image unavailable: '+image.getAttribute('src');image.replaceWith(fallback)},true);
const mediaLightbox=document.querySelector('.lightbox');
mediaLightbox.addEventListener('click',event=>{if(event.target!==mediaLightbox&&!event.target.matches('.lightbox-close'))return;if(lastMediaTrigger?.isConnected)lastMediaTrigger.focus();lastMediaTrigger=null});
