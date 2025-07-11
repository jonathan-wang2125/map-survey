import { Common } from '../common/common.js';

export const annotate = {
    current:null,
    annotateStart: null,
    annotateStop: null,

    _clearTimer(){
      if (this._timerInterval){
        clearInterval(this._timerInterval);
        this._timerInterval = null;
      }
    },

async _loadLeaflet() {
   // 1) inject CSS (via jsDelivr)
  const leafletCss = document.createElement('link');
  leafletCss.rel  = 'stylesheet';
  leafletCss.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(leafletCss);

  // 2) inject JS and wait for it to load
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src         = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
    s.onload      = resolve;
    s.onerror     = reject;
    document.head.appendChild(s);
  });
},

    async init(){ 
     await this._loadLeaflet();
  Common.ensureLogin();
  Common.initNavbar();
     
      Common.ensureLogin(); Common.initNavbar();
      if (!Common.ds()) location.href='/select_dataset.html';

      /* Cache DOM pointers */
      this.status = document.getElementById('status');
      this.imgDiv = document.getElementById('questionMapContainer');
      this.mapDiv = document.getElementById('locationMapContainer');
      this.qTxt   = document.getElementById('questionText');
      this.form   = document.getElementById('qaForm');
      
          const hint = document.createElement('div');
          hint.style.fontSize   = '12px';
          hint.style.color      = '#666';
          hint.style.marginTop  = '4px';
          hint.textContent      = 'Tip: press + / – to change zoom level';
          this.form.appendChild(hint);

      this.discardBox = document.getElementById('discardQuestion');     
      this.badBox   = document.getElementById('badQuestion');
      this.badText  = document.getElementById('badReason');
      this.badLabel = document.getElementById('badReasonLabel');

      /* Buttons */
      // document.getElementById('pastAnswersBtn')
      //   .addEventListener('click',()=>location.href='past_answers.html');

      // document.getElementById('popOutBtn')
      //   .addEventListener('click',()=>{
      //     const feat = `toolbar=no,location=no,menubar=no,` +
      //                  `width=${screen.width},height=${screen.height},fullscreen=yes`;
      //     window.open(window.location.href,'_blank',feat);
      //   });

      this.badBox.addEventListener('change', () => {
        const on = this.badBox.checked
        this.badText.style.display = on ? 'block' : 'none';
        this.badLabel.style.display = on ? 'block' : 'none';
        this.badText.required      = on;
      });

      const style = document.createElement('style');
      style.textContent = `
        .zoom-container {
          position: relative;
        }
        .zoom-lens {
          position: absolute;
          border: 1px solid #ccc;
          width: 150px;
          height: 150px;
          opacity: 0.0;
          background-color: white;
          pointer-events: none;
          z-index: 8400;
        }
      `;
      document.head.appendChild(style);
      style.textContent += `
        .maps-btn { opacity: 0.5; transition: opacity 0.2s ease; }
        .maps-btn.active { opacity: 1; }`;

      this.form.addEventListener('submit',e=>this.submit(e));

      this.timerDisplay = document.createElement('div');
      this.timerDisplay.id = 'annotation-timer';
      this.timerDisplay.style.fontSize = '12px';
      this.timerDisplay.style.color = '#333';
      this.timerDisplay.style.marginBottom = '4px';
      this.timerDisplay.textContent = 'Time on question: 0m 00s';
      this.form.insertBefore(this.timerDisplay, this.form.firstChild);

      await this.load();

    },

    async load(){
      this.status.textContent='Loading…';

      const pid = Common.pid();
      const ds  = Common.ds();

      const [data, answered, { total }] = await Promise.all([
        fetch(`/get_questions?prolificID=${pid}&dataset=${encodeURIComponent(ds)}`)
          .then(r => r.json()),
        fetch(`/qresponses/${pid}?dataset=${encodeURIComponent(ds)}`)
          .then(r => r.json()).then(j => j.responses.length + 1),
        fetch(`/dataset_count/${ds}`).then(r => r.json())
      ]);

      this.bar  = document.getElementById('saveProgress');
      this.txt  = document.getElementById('progressText');
      this.bar.style.display = 'block';
      this.bar.max   = total;
      this.bar.value = answered;
      this.txt.textContent = `${answered} / ${total}`;  

      if (data.error){ this.showMsg(data.error); return; }
      if (data.done) {
        this.qTxt.textContent        = '';
        this.imgDiv.innerHTML        = '';
        this.qTxt.style.display      = 'none';
        this.imgDiv.style.display    = 'none';

        this.showMsg("All done! Click 'Submit Dataset' to log your responses.");
      
        // check whether they've already submitted
        const pid = Common.pid();
        const ds  = Common.ds();
        const status = await fetch(`/dataset_submission/${pid}/${ds}`)
                             .then(r => r.json());
        
        // build the button
        const btn = document.createElement('button');

        btn.textContent = status.submitted ? 'Submitted' : 'Submit Dataset';
        btn.disabled   = status.submitted;

        if (status.submitted){
          this.showMsg("All done! Dataset has already been submitted.")
        }
      
        btn.addEventListener('click', async () => {
          if (!window.confirm(
                'Are you sure you want to submit your dataset? You will not be able to modify your answers afterward.'
          )) return;
        
          btn.disabled  = true;
          btn.textContent = 'Running…';
        
          /* show the spinner overlay */
          const loader = document.getElementById('loader');
          loader.hidden = false;
        
          try {
            /* ---- run python autograder ---- */
            const runResp = await fetch('/run-python', {
              method:'POST',
              headers:{ 'Content-Type':'application/json' },
              body: JSON.stringify({ prolificID: pid, dataset: ds })
            });
            const runJson = await runResp.json();
        
            if (!runResp.ok) throw new Error(runJson.error || 'server error');
        
            loader.hidden = true; 
            await this.showModal(runJson.output); 
        
            /* mark submitted */
            // await fetch('/submit_dataset', {
            //   method:'POST',
            //   headers:{ 'Content-Type':'application/json' },
            //   body: JSON.stringify({ prolificID: pid, dataset: ds, value: runJson.output })
            // });
        
            location.href = 'select_dataset.html';
        
          } catch (e) {
            alert('Error running script:\n' + e.message);
            btn.disabled  = false;
            btn.textContent = 'Submit Dataset';
          } finally {
            loader.hidden = true;      // always hide overlay
          }
        });
      
        // insert it right under the status message
        this.status.insertAdjacentElement('afterend', btn);
        return;
      }
      

      this.current=data;

      /* --- reset the bad-question widgets --- */
      this.badBox.checked      = false;   // ensure unchecked
      this.badText.value       = '';      // clear any previous reason
      this.badText.style.display = 'none';
      this.badLabel.style.display = 'none';
      this.badText.required    = false;

      this.annotateStart = Date.now();
      this._clearTimer();               // in case it was running
      this._timerInterval = setInterval(
        () => {
          const elapsedMs = Date.now() - this.annotateStart;
          const secs = Math.floor(elapsedMs / 1000) % 60;
          const mins = Math.floor(elapsedMs / 60000);
          this.timerDisplay.textContent =
            `Time on question: ${mins}m ${secs.toString().padStart(2,'0')}s`;
        },
        1000
      );
    
      this.render();
      this.status.textContent = '';
    },



    showModal(text){
      return new Promise(resolve => {
        const dlg  = document.getElementById('msgBox');
        document.getElementById('msgText').textContent = text;
        dlg.showModal();                   // non-blocking
        dlg.onclose = () => resolve();     // fires when user clicks OK
      });
    },

    showMsg(msg){
      this.status.textContent=msg;
      this.form.style.display='none';
    },

    render(){
      
      // 0) clean up any previous zoom/widget/panel
    document
    .querySelectorAll('.zoom-widget, .zoom-result, .gm-panel')
    .forEach(el => el.remove());

      let lastMapEvent = null;
      
      const q=this.current.question;

      this.qTxt.textContent = q.Question || '(no text)';

      /* map image + open / download links */
      this.imgDiv.innerHTML = q.Map
        ? `<img src="/maps/${encodeURIComponent(q.Map)}" alt="map">`
        : '(no map)';

      if (q.Map) {
          const zoomContainer = document.createElement('div');
          zoomContainer.className = 'zoom-container';
        
          const img = document.createElement('img');
          img.src = `/maps/${encodeURIComponent(q.Map)}`;
          img.alt = 'map';
          img.style.maxWidth = '100%';
          img.style.display = 'block';
          img.style.position = 'relative';
        
          zoomContainer.appendChild(img);
          this.imgDiv.innerHTML = '';
          this.imgDiv.appendChild(zoomContainer);
        
          // Add lens inside container
          const lens = document.createElement('div');
          lens.className = 'zoom-lens';
          lens.style.display = 'none';
          zoomContainer.appendChild(lens);
          
          // 1. change zoomFactor to a let
          let zoomFactor = 1.5;   // initial 1×

          // Add result globally so it floats with cursor
          const result = document.createElement('div');
          result.className = 'zoom-result';
          result.style.display = 'none';
          result.style.position = 'fixed';
          result.style.zIndex = '8000';
          result.style.width = `${150 * zoomFactor}px`;
          result.style.height = `${150 * zoomFactor}px`;
          result.style.border = '1px solid #ccc';
          result.style.backgroundRepeat = 'no-repeat';
          result.style.backgroundSize = 'cover';
          result.style.pointerEvents = 'none';
          result.style.opacity = '1.0';
          result.style.position    = 'fixed';
          result.style.overflow    = 'hidden';   // ensure label never sticks out
          document.body.appendChild(result);

            function getCursorPos(e) {
              const rect = img.getBoundingClientRect();
              return {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
              };
            }
        // move the lens & update the zoom pane
        function moveLens(e) {
          lastMapEvent = e;
          const pos = getCursorPos(e);
          let x = pos.x - lens.offsetWidth  / 2;
          let y = pos.y - lens.offsetHeight / 2;

          x = Math.max(0, Math.min(img.width - lens.offsetWidth, x));
          y = Math.max(0, Math.min(img.height - lens.offsetHeight, y));

          lens.style.left = `${x}px`;
          lens.style.top  = `${y}px`;
          result.style.backgroundPosition = `-${x * zoomFactor}px -${y * zoomFactor}px`;

          // center the result pane on the cursor
          const offsetX = e.clientX - result.offsetWidth  / 2;
          const offsetY = e.clientY - result.offsetHeight / 2;
          result.style.left = `${offsetX}px`;
          result.style.top  = `${offsetY}px`;
        }



           // ────────── WIDGET + ZOOM-TOGGLE SNIPPET ──────────
    // (all changes for the moveable toggle widget live between these borders)

    // 1) Toggle state
    let zoomEnabled = false;
  
    // 2) Draggable widget container
    const widget = document.createElement('div');
    widget.classList.add('zoom-widget');

    // anchor the widget in the top-right of the zoomContainer by default
    widget.style.position = 'fixed';
    widget.style.top      = '115px';   
    widget.style.left    = '60px'; 
    widget.style.zIndex   = '9000';


    document.body.appendChild(widget);

    // ── add the little drag handle ──
const handle = document.createElement('div');
handle.className = 'zoom-handle';
for (let i = 0; i < 3; i++) {
  const dot = document.createElement('span');
  handle.appendChild(dot);
}
widget.appendChild(handle);

        // ─── WIDGET HOVER HIDES ZOOM ─────────────────────
    widget.addEventListener('mouseenter', () => {
      // whenever the cursor goes over the widget, hide any zoom UI
      lens.style.display   = 'none';
      result.style.display = 'none';
    });

    widget.addEventListener('mouseleave', () => {
      if (!zoomEnabled || !lastMapEvent) return;
      lens.style.display   = 'block';
      result.style.display = 'block';
      moveLens(lastMapEvent);
      });

    // ─── END WIDGET HOVER PATCH ─────────────────────

        // 3) Magnifier button
const zoomBtn = document.createElement('button');
zoomBtn.textContent = '🔍';
zoomBtn.title = 'Toggle zoom';
zoomBtn.classList.add('zoom-btn');
widget.appendChild(zoomBtn);

// add divider 
const divider = document.createElement('div');
divider.classList.add('zoom-widget-divider');
widget.appendChild(divider);

zoomBtn.addEventListener('click', () => {
  // flip the flag
  zoomEnabled = !zoomEnabled;
  // dim the button when zoom is off
  zoomBtn.classList.toggle('active', zoomEnabled);

  if (!zoomEnabled) {
    // hide everything when turned off
    lens.style.display = 'none';
    result.style.display = 'none';
  } else {
    // if turning back on and we've got a last position, redisplay at that spot
    if (lastMapEvent) {
      moveLens(lastMapEvent);
      lens.style.display = 'block';
      result.style.display = 'block';
      }}}); 
    // ─── end addition ─────────────────────────────────────────────────────

        const mapsBtn = document.createElement('button');
    mapsBtn.classList.add('maps-btn');
    mapsBtn.title = 'Open Google Maps';
    mapsBtn.style.border = 'none';
    mapsBtn.style.background = 'transparent';
    mapsBtn.style.padding = '0';
    mapsBtn.classList.add('maps-btn');
    mapsBtn.innerHTML = `
  <img src="assets/map.png" 
    alt="Open map" style="width:28px; height:28px; display:block;">`;
    widget.appendChild(mapsBtn);
    

    mapsBtn.addEventListener('click', async () => {
     
      const opening = !document.querySelector('.gm-panel');
     
      // if exsisting then delete window
      const existing = document.querySelector('.gm-panel');
  if (existing) {
    existing.remove();
    mapsBtn.classList.remove('active');
    return;
  }
      
const { bottom } = widget.getBoundingClientRect();
const containerRect = zoomContainer.getBoundingClientRect();
const panelLeft = containerRect.left;

  // 1) build panel
 const panel = document.createElement('div');
  panel.className = 'gm-panel';
  const PANEL_WIDTH = 300;
  Object.assign(panel.style, {
    position:   'absolute',
    top:  `${bottom}px`,       // same vertical placement
    left: `${panelLeft}px`,    // always flush to left edge of image
    width:      `${PANEL_WIDTH}px`,
    background: '#fff',
    border:     '1px solid #ccc',
    padding:    '8px',
    zIndex:     8500,        // above the widget
    boxShadow:  '0 2px 6px rgba(0,0,0,0.2)'
  });



  // 2) floating pill-shaped search bar
const searchForm = document.createElement('form');
searchForm.classList.add('gm-search-wrapper');

const input = document.createElement('input');
input.type = 'text';
input.placeholder = 'Search places…';

const go = document.createElement('button');
go.type = 'submit';
go.innerHTML = `
  <img src="assets/search_icon.png" 
  alt="Search" style="width:24px; height:24px; display:block;">`;

searchForm.append(input, go);
panel.appendChild(searchForm);

  // 3) map container
  const mapDiv = document.createElement('div');
  mapDiv.id = 'osm-map';
  Object.assign(mapDiv.style, { width: '100%', height: '300px' });
  panel.appendChild(mapDiv);

  widget.appendChild(panel);
  

  // 4) init Leaflet map 
const map = L.map(mapDiv, { zoomControl: false }).setView([0, 0], 2);

// add tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);
L.control.zoom({ position: 'bottomleft' }).addTo(map);

  let marker = null;
  // 5) geocode & recenter via Nominatim
  searchForm.addEventListener('submit', async e => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const hits = await res.json();
    if (!hits.length) {
    // <-- NEW: inform the user
    alert('No results found for "' + q + '". Please try a different query.');
    return;
  }

     const { lat, lon } = hits[0];
  map.setView([+lat, +lon], 12);
  if (marker) map.removeLayer(marker);
  marker = L.marker([+lat, +lon]).addTo(map);
  });

  // 6) finally insert
document.body.appendChild(panel);
mapsBtn.classList.add('active');


 // ── make panel draggable ──
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  panel.addEventListener('mousedown', e => {
    if (
    e.target.closest('#osm-map') ||
    e.target.closest('.gm-search-wrapper')
  ) {
    return;
  }
  dragOffsetX = e.clientX - panel.offsetLeft;
  dragOffsetY = e.clientY - panel.offsetTop;
  document.body.style.userSelect = 'none';
  isDragging = true;
});

  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    panel.style.left = (e.clientX - dragOffsetX) + 'px';
    panel.style.top  = (e.clientY - dragOffsetY) + 'px';
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
    document.body.style.userSelect = '';
  });

});

    // make the widget draggable
let dragging = false;
let offsetX = 0, offsetY = 0;
let parentRect = null;

widget.addEventListener('mousedown', e => {
  if (e.target.closest('.gm-panel')) return;
  parentRect = widget.parentElement.getBoundingClientRect();
  const wRect = widget.getBoundingClientRect();
  offsetX = e.clientX - wRect.left;
  offsetY = e.clientY - wRect.top;
  dragging = true;
  widget.style.cursor = 'grabbing';
  e.preventDefault();
});

document.addEventListener('mousemove', e => {
   if (!dragging) return;

  const parentRect = widget.parentElement.getBoundingClientRect();
  let x = e.clientX - parentRect.left - offsetX;
  let y = e.clientY - parentRect.top  - offsetY;

  // clamp removed — widget can now move anywhere
  widget.style.left = `${x}px`;
  widget.style.top  = `${y}px`;
});

document.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  widget.style.cursor = 'grab';
});


    // ──────── END WIDGET + ZOOM-TOGGLE SNIPPET ─────────

          // add a label element
          const zoomLabel = document.createElement('div');
          zoomLabel.style.position   = 'absolute';
          zoomLabel.style.bottom     = '4px';
          zoomLabel.style.right      = '4px';
          zoomLabel.style.padding    = '2px 4px';
          zoomLabel.style.fontSize   = '12px';
          zoomLabel.style.background = 'rgba(0,0,0,0.5)';
          zoomLabel.style.color      = 'white';
          zoomLabel.style.borderRadius = '3px';
          zoomLabel.textContent      = `${zoomFactor.toFixed(1)}×`;
          result.appendChild(zoomLabel);

          // 2. register a key listener once
          document.addEventListener('keydown', e => {
            if (e.key === '+' || e.key === '=') {        // on US keyboards '+' is shift+'='
              zoomFactor = Math.min(5, zoomFactor + 0.5); // cap at 5×
            }
            else if (e.key === '-' || e.key === '_') {
              zoomFactor = Math.max(1.0, zoomFactor - 0.5); // floor at 0.5×
            }

            result.style.width = `${150 * zoomFactor}px`;
            result.style.height = `${150 * zoomFactor}px`;
            result.style.backgroundSize = `${img.clientWidth * zoomFactor}px ${img.clientHeight * zoomFactor}px`;
            zoomLabel.textContent = `${zoomFactor.toFixed(1)}×`;
          });

          const keystrokeHint = document.createElement('div');
          keystrokeHint.style.position   = 'absolute';
          keystrokeHint.style.top        = '4px';
          keystrokeHint.style.left       = '4px';
          keystrokeHint.style.fontSize   = '11px';
          keystrokeHint.style.color      = 'rgba(0, 0, 0, 0.8)';
          keystrokeHint.textContent      = '+ / – = zoom';
          result.appendChild(keystrokeHint);
        
          img.onload = () => {
            result.style.backgroundImage = `url('${img.src}')`;
            result.style.backgroundSize = `${img.clientWidth * zoomFactor}px ${img.clientHeight * zoomFactor}px`;
        
           
        
              // ─── GATED ZOOM HANDLERS ─────────────────────────────────
              zoomContainer.addEventListener('mouseenter', () => {
                if (!zoomEnabled) return;
                lens.style.display   = 'block';
                result.style.display = 'block';
              });
              zoomContainer.addEventListener('mouseleave', () => {
                lens.style.display   = 'none';
                result.style.display = 'none';
              });
              zoomContainer.addEventListener('mousemove', e => {
                if (zoomEnabled) moveLens(e);
              });
              lens.addEventListener  ('mousemove', e => { if (zoomEnabled) moveLens(e); });
              img.addEventListener   ('mousemove', e => { if (zoomEnabled) moveLens(e); });
              // ─── END GATED HANDLERS ──────────────────────────────────
          };
        
          // Download/Open buttons
          const row = document.createElement('div');
          row.style = 'margin:.5rem 0';
          row.innerHTML = `
            <a class="dlBtn" target="_blank" href="${img.src}">Open image</a>
            <a class="dlBtn" download href="${img.src}">Download</a>`;
           document.getElementById('downloadRow')?.remove();
            row.id = 'downloadRow';
            document.querySelector('.question-column').appendChild(row);
        }                
    },

    scrollAfterImage () {
         // grab the scrollable question pane
  const qCol = document.querySelector('.question-column');
  if (qCol) {
    // jump back to its top
    qCol.scrollTo({ top: 0, behavior: 'auto' });
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
},

    async submit (e) {
      e.preventDefault();
    
      /* show progress bar */
      // const bar = document.getElementById('saveProgress');
      // bar.style.display = 'block';
      // bar.removeAttribute('value');          // indeterminate
    
      /* disable form while saving */
      this.form.querySelector('button[type=submit]').disabled = true;

      this.annotateStop = Date.now();
      this._clearTimer();
    
      const q = this.current.question;
      const payload = {
        dataset:       Common.ds(),
        prolificID:    Common.pid(),
        questionIndex: this.current.questionIndex,
        uid:           q.uid,
        question:      q.Question,
        answer:        document.getElementById('qAnswer').value,
        difficulty:    0, //document.getElementById('difficulty').value,
        badQuestion:   this.badBox.checked,
        badReason:     this.badBox.checked ? this.badText.value : '',
        discard:       this.discardBox.checked,
        startTime:     this.annotateStart,
        stopTime:      this.annotateStop
      };
      
      const resp = await fetch('/submit_question', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
    
      /* hide progress bar & re-enable submit */
      // bar.style.display = 'none';
      this.form.querySelector('button[type=submit]').disabled = false;
    
      if (!resp.ok) {                        // show error only if it failed
        const j = await resp.json().catch(()=>({}));
        this.status.textContent = j.error || 'Save failed';
        return;
      }
    
      /* clear form & load next question (no alert) */
      this.form.reset();
      const timestart = await this.load();

      this.scrollAfterImage();
    }
  }