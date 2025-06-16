import { Common } from '../common/common.js';

export const annotate = {
    current:null,

    async init(){
      Common.ensureLogin(); Common.initNavbar();
      if (!Common.ds()) location.href='/select_dataset.html';

      /* Cache DOM pointers */
      this.status = document.getElementById('status');
      this.qTxt   = document.getElementById('questionText');
      this.imgDiv = document.getElementById('questionMapContainer');
      this.mapDiv = document.getElementById('locationMapContainer');
      this.form   = document.getElementById('qaForm');

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

      if (q.Map){
        const row=document.createElement('div');
        row.style='margin:.5rem 0';
        row.innerHTML=`
          <a class="dlBtn" target="_blank"
             href="/maps/${encodeURIComponent(q.Map)}">Open image</a>
          <a class="dlBtn" download
             href="/maps/${encodeURIComponent(q.Map)}">Download</a>`;
        this.imgDiv.append(row);
      }

      /* optional geo markers */
      // this.mapDiv.innerHTML='';
      // if (q.locations?.length){
      //   const m=new google.maps.Map(this.mapDiv,{center:q.locations[0],zoom:8});
      //   q.locations.forEach(p=>new google.maps.Marker({position:p,map:m}));
      // }else{
      //   this.mapDiv.textContent='No locations.';
      // }
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