import { Common } from '../common/common.js';

export const annotate = {
    current:null,

    async init(){
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
          z-index: 1000;
        }
      `;
      document.head.appendChild(style);


      this.form.addEventListener('submit',e=>this.submit(e));

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
            /* ---- run the long python job ---- */
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
          result.style.zIndex = '10000';
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
              zoomFactor = Math.max(0.5, zoomFactor - 0.5); // floor at 0.5×
            }

            result.style.width = `${150 * zoomFactor}px`;
            result.style.height = `${150 * zoomFactor}px`;
            result.style.backgroundSize = `${img.naturalWidth * zoomFactor}px ${img.naturalHeight * zoomFactor}px`;
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
            const scaleX = img.naturalWidth / img.clientWidth;
            const scaleY = img.naturalHeight / img.clientHeight;
        
            result.style.backgroundImage = `url('${img.src}')`;
            result.style.backgroundSize = `${img.naturalWidth * zoomFactor}px ${img.naturalHeight * zoomFactor}px`;
        
            function getCursorPos(e) {
              const rect = img.getBoundingClientRect();
              return {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
              };
            }
        
            function moveLens(e) {
              const pos = getCursorPos(e);
              let x = pos.x - lens.offsetWidth / 2;
              let y = pos.y - lens.offsetHeight / 2;
        
              // Clamp lens position
              if (x < 0) x = 0;
              if (y < 0) y = 0;
              if (x > img.width - lens.offsetWidth) x = img.width - lens.offsetWidth;
              if (y > img.height - lens.offsetHeight) y = img.height - lens.offsetHeight;

              lens.style.left = `${x}px`;
              lens.style.top = `${y}px`;
        
              result.style.backgroundPosition = `-${x * scaleX * zoomFactor + 20}px -${y * scaleY * zoomFactor + 20}px`;
        
              // Position zoom result next to cursor
              const offsetX = e.clientX - result.offsetWidth / 2;
              const offsetY = e.clientY - result.offsetHeight / 2;
              result.style.left = `${offsetX}px`;
              result.style.top = `${offsetY}px`;
            }
        
            // Show zoom
            zoomContainer.addEventListener('mouseenter', () => {
              lens.style.display = 'block';
              result.style.display = 'block';
            });
        
            zoomContainer.addEventListener('mouseleave', () => {
              lens.style.display = 'none';
              result.style.display = 'none';
            });
        
            zoomContainer.addEventListener('mousemove', moveLens);
            lens.addEventListener('mousemove', moveLens);
            img.addEventListener('mousemove', moveLens);
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
      const img = document.querySelector('#questionMapContainer img');
    
      const doScroll = () =>
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' });
    
      if (img && !img.complete) {         // wait if still loading
        img.addEventListener('load', doScroll, { once: true });
      } else {
        doScroll();                       // image was cached / instant
      }
    },

    async submit (e) {
      e.preventDefault();
    
      /* show progress bar */
      // const bar = document.getElementById('saveProgress');
      // bar.style.display = 'block';
      // bar.removeAttribute('value');          // indeterminate
    
      /* disable form while saving */
      this.form.querySelector('button[type=submit]').disabled = true;
    
      const q = this.current.question;
      const payload = {
        dataset:       Common.ds(),
        prolificID:    Common.pid(),
        questionIndex: this.current.questionIndex,
        uid:           q.uid,
        question:      q.Question,
        answer:        document.getElementById('qAnswer').value,
        difficulty:    document.getElementById('difficulty').value,
        badQuestion:   this.badBox.checked,
        badReason:     this.badBox.checked ? this.badText.value : ''
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
      await this.load();

      this.scrollAfterImage();
    }
  }