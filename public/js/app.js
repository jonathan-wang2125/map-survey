/* ------------------------------------------------
 * Common helpers – shared across pages
 * ------------------------------------------------ */
const Common = {
  initNavbar() {
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
      localStorage.clear();
      location.href = '/login.html';
    });
  },
  ensureLogin() {
    if (!localStorage.getItem('prolificID')) {
      location.href = '/login.html';
      throw 'redirect';
    }
  },
  pid() { return localStorage.getItem('prolificID'); },
  ds () { return localStorage.getItem('datasetID'); }
};

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

/* ------------------------------------------------
 * Pages – each key matches <body data‑page="…">
 * ------------------------------------------------ */
const Pages = {

  /* ---------- login ---------- */
  login: {
    init() {
      document.getElementById('loginBtn').addEventListener('click', async () => {
        const pid    = document.getElementById('prolificIDInput').value.trim();
        if (!pid) { alert('Enter your Prolific ID'); return; }
    
        const dsParam = new URLSearchParams(window.location.search).get('dataset');
        const resp    = await fetch('/login', {
          method: 'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ prolificID: pid, datasetID: dsParam })
        });
        const ok = await resp.json();
    
        if (!ok.success) {
          return alert('Login failed');
        }
    
        // store user (and dataset if present)
        localStorage.setItem('prolificID', pid);
        if (dsParam) localStorage.setItem('datasetID', dsParam);
    
        // redirect new users to instructions, others to select page
        if (ok.isNew) {
          location.href = 'instructions.html';
        } else {
          location.href = 'select_dataset.html';
        }
      });
    }
  },

  /* ---------- dataset select ---------- */
  select: {
    async init () {
      Common.ensureLogin();
      Common.initNavbar();

      const pid   = Common.pid();
      const wrap  = document.getElementById('datasetButtons');
      wrap.textContent = 'Loading…';
  
      /* datasets this user may access */
      const datasets = await fetch(`/user_datasets/${pid}`).then(r => r.json());
  
      if (!datasets.length) {
        wrap.textContent = 'No datasets have been assigned to your account.';
        return;
      }
  
      wrap.innerHTML = '';  // clear loading text
  
      for (const ds of datasets) {
        const card = document.createElement('div');

        const { submitted } = await fetch(
          `/dataset_submission/${pid}/${ds.id}`
        ).then(r => r.json());
  
        /* title */
        const h = document.createElement('h3');
        h.textContent = ds.label;
        card.append(h);
  
        /* Annotate */
        const anno = document.createElement('button');
        anno.textContent = 'Annotate';
        anno.onclick = () => {
          localStorage.setItem('datasetID', ds.id);
          location.href = 'index.html';
        };
        // if(submitted){
        //   anno.disabled = true;
        // }
        card.append(anno);
  
        /* Past answers */
        const past = document.createElement('button');
        past.textContent = 'Past answers';
        past.disabled = true;
        past.onclick = () => {
          localStorage.setItem('datasetID', ds.id);
          location.href = 'past_answers.html';
        };
        card.append(past);

        /* Status */
        const badge = document.createElement('span');
        badge.classList.add(
          'status-badge',
          submitted ? 'complete' : 'incomplete'
        );
        badge.textContent = submitted ? 'Submitted' : 'Pending';
        card.append(badge);
  
        /* enable Past answers if any exist */
        (async () => {
          const j = await fetch(
            `/qresponses/${pid}?dataset=${encodeURIComponent(ds.id)}`
          ).then(r => r.json());
          if (j.responses.length) past.disabled = false;
        })();
  
        wrap.append(card);
      }
    }
  },

  /* ---------- annotate ---------- */
  annotate: {
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
      document.getElementById('pastAnswersBtn')
        .addEventListener('click',()=>location.href='past_answers.html');

      document.getElementById('popOutBtn')
        .addEventListener('click',()=>{
          const feat = `toolbar=no,location=no,menubar=no,` +
                       `width=${screen.width},height=${screen.height},fullscreen=yes`;
          window.open(window.location.href,'_blank',feat);
        });

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

      const bar  = document.getElementById('saveProgress');
      const txt  = document.getElementById('progressText');
      bar.style.display = 'block';
      bar.max   = total;
      bar.value = answered;
      txt.textContent = `${answered} / ${total}`;  

      if (data.error){ this.showMsg(data.error); return; }
      if (data.done) {
        this.showMsg("All done! Click 'Submit Dataset' to grade your responses.");
      
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
          )) {
            return;
          }
        
          btn.disabled    = true;
          btn.textContent = 'Running…';
      
          // 1) run your python script
          const runResp = await fetch('/run-python', { method: 'POST' });
          const runJson = await runResp.json();
          if (!runResp.ok) {
            alert('Error running script:\n' + runJson.error);
            btn.disabled    = false;
            btn.textContent = 'Submit Dataset';
            return;
          } 

          alert('Response:\n' + runJson.output)

          // 2) mark as submitted so it's disabled on reload
          await fetch('/submit_dataset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prolificID: pid, dataset: ds })
          });
      
          btn.textContent = 'Submitted';
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
        QID:           q.uid,
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
  },

  /* ---------- past answers ---------- */
  past: {
    async init () {
      Common.ensureLogin();
      Common.initNavbar();
      if (!Common.ds()) location.href = '/select_dataset.html';

      // 1) Figure out whether this dataset has been submitted already
      const pid = Common.pid();
      const ds  = Common.ds();
      const { submitted } = await fetch(
        `/dataset_submission/${pid}/${ds}`
      ).then(r => r.json());

      const wrap = document.getElementById('answersList');
      wrap.textContent = 'Loading…';

      const rsp = await fetch(
        `/qresponses/${Common.pid()}?dataset=${encodeURIComponent(Common.ds())}`
      );
      if (!rsp.ok) { wrap.textContent = 'Server error – try again later.'; return; }

      const { responses } = await rsp.json();
      if (!responses.length) { wrap.textContent = 'No answers yet.'; return; }

      wrap.innerHTML = '';

      responses.forEach(r => {
        const card = document.createElement('div');
        card.className = 'answer-card';

        /* -------- inner HTML -------- */
        card.innerHTML = `
          <p><strong>Q:</strong> ${r.question}</p>

          <label>Your Answer:
            <input type="text" value="${r.answer}">
          </label>

          <label>Difficulty (1-10):
            <input type="number" min="1" max="10" value="${r.difficulty ?? ''}">
          </label>

          <label class="bad-label">
            <span class="inline-flex">
              <input type="checkbox" ${r.badQuestion ? 'checked' : ''}>
              Bad&nbsp;Question
            </span
          </label>

          <label id="badReasonLabel"
              for="badReason"
              style="display:none; font-weight:500; margin-bottom:.25rem;${r.badQuestion ? '' : 'display:none;'}">
            Provide an answer and difficulty assuming the question is fixed
          </label>
          <textarea rows="1"
                    placeholder="Why is it bad / ambiguous / impossible?"
                    style="width:100%;margin-top:.4rem;resize:vertical;${
                      r.badQuestion ? '' : 'display:none;'
                    }">${r.badReason ?? ''}</textarea>

          <div style="margin-top:.4rem;">
            <button class="editBtn">Edit</button>
            ${
              r.mapFile
                ? `<button class="mapBtn" data-file="${encodeURIComponent(r.mapFile)}">
                    Open map
                  </button>`
                : ''
            }
          </div>
        `;

        /* -------- grab elements -------- */
        const ansIn   = card.querySelector('input[type=text]');
        const diffIn  = card.querySelector('input[type=number]');
        const badBox  = card.querySelector('input[type=checkbox]');
        const reason  = card.querySelector('textarea');
        const editBt  = card.querySelector('.editBtn');
        const mapBt   = card.querySelector('.mapBtn');

        /* read-only by default */
        [ansIn, diffIn, badBox, reason].forEach(el => (el.disabled = true));

        // Disable everything if the dataset has already been submitted
        if (submitted) {
          [ansIn, diffIn, badBox, reason, editBt].forEach(el => el.disabled = true);
        } else {
          /* show/hide textarea with checkbox */
          badBox.addEventListener('change', () => {
            reason.style.display = badBox.checked ? 'block' : 'none';
          });

          /* edit / save toggle */
          editBt.addEventListener('click', async () => {
            const editing = ansIn.disabled;
            const setDis  = !editing;
            [ansIn, diffIn, badBox, reason].forEach(el => (el.disabled = setDis));
            editBt.textContent = editing ? 'Save' : 'Edit';

            if (!editing) {                      // now saving
              await fetch(`/edit_qresponse/${Common.pid()}`, {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({
                  dataset:     Common.ds(),
                  responseID:  r.responseID,
                  answer:      ansIn.value,
                  difficulty:  diffIn.value,
                  badQuestion: badBox.checked,
                  badReason:   reason.value
                })
              });
            }
          });
        }

        /* open map */
        if (mapBt) {
          mapBt.addEventListener('click', () =>
            window.open(`/maps/${mapBt.dataset.file}`, '_blank'));
        }

        wrap.append(card);
      });
    }
  },

  /* ---------- instructions ---------- */
  instructions: {
    async init () {
      Common.ensureLogin();
      Common.initNavbar();

      /* fetch markdown */
      const md = await fetch('/instructions.md').then(r => r.text());

      /* convert → HTML with marked (GFM + line breaks) */
      const html = marked.parse(md, { gfm: true, breaks: true });

      /* inject + style */
      const box = document.getElementById('mdContent');
      box.className = 'markdown-body';   // class from github-markdown-css
      box.innerHTML = html;

      /* optional – syntax highlight for fenced code blocks */
      import('https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js')
        .then(m => {
          box.querySelectorAll('pre code').forEach(block => m.default.highlightElement(block));
        });
    }
  }
};

/* ---------- admin ---------- */
Pages.admin = {
  users:    [],
  datasets: [],        // [{id,label,description}]
  current:  null,      // active pid

  async init () {
    /* fetch initial data */
    [this.users, this.datasets] = await Promise.all([
      fetch('/admin/users').then(r => r.json()),
      fetch('/admin/datasets').then(r => r.json())   // includes meta
    ]);

    /* build filterable user selector */
    this.sel   = document.getElementById('userSelect');
    this.input = document.getElementById('userFilter');
    this.buildOptions('');                          // initial full list
    this.input.addEventListener('input', () =>
      this.buildOptions(this.input.value.trim().toLowerCase()));
    this.sel.addEventListener('change', () =>
      this.loadForUser(this.sel.value));

    /* auto-select first user */
    if (this.users.length) {
      this.sel.value = this.users[0];
      this.loadForUser(this.users[0]);
    } else {
      document.getElementById('status').textContent = 'No users found.';
    }
  },

  buildOptions (substr) {
    this.sel.innerHTML = '';
    this.users
      .filter(pid => pid.toLowerCase().includes(substr))
      .forEach(pid => {
        const o = document.createElement('option');
        o.value = o.textContent = pid;
        this.sel.append(o);
      });
  },

  async loadForUser (pid) {
    this.current = pid;
    document.getElementById('status').textContent =
      `Loading datasets for ${pid}…`;

    const assigned = new Set(
      await fetch(`/admin/user_datasets/${pid}`).then(r => r.json())
    );

    const tbl = document.getElementById('dsTable');
    tbl.innerHTML = '';
    const head = tbl.insertRow();
    head.innerHTML = '<th>Dataset</th><th>Description</th><th>Assigned?</th>';

    this.datasets.forEach(ds => {
      const row = tbl.insertRow();

      /* label + edit button */
      const labelTd = row.insertCell();
      labelTd.innerHTML = `
        <div class="dataset-header">
          <span class="dsLabel" data-id="${ds.id}">${ds.label}</span>
          <div class="dataset-actions">
            <button class="editMeta" data-id="${ds.id}">✎ Edit</button>
            <button class="inviteBtn" data-id="${ds.id}">➕ Invite</button>
          </div>
        </div>`;
      /* description cell */
      const descTd = row.insertCell();
      descTd.className = 'dsDesc';
      descTd.dataset.id = ds.id;
      descTd.textContent = ds.description || '';

      /* assignment checkbox */
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = assigned.has(ds.id);
      cb.addEventListener('change', () =>
        this.toggleAssign(pid, ds.id, cb.checked));
      row.insertCell().append(cb);
    });

    /* attach meta-edit handlers */
    tbl.querySelectorAll('.editMeta').forEach(btn =>
      btn.addEventListener('click', () => this.editMeta(btn.dataset.id)));

    tbl.querySelectorAll('.inviteBtn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const dsID = btn.dataset.id;
        const link = `${window.location.origin}/login.html?dataset=${encodeURIComponent(dsID)}`;
    
        const ta = document.createElement('textarea');
        ta.value = link;
        ta.style.position = 'fixed';
        ta.style.opacity  = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        let ok = false;
        try {
          ok = document.execCommand('copy');
        } catch (e) {
          console.error('Fallback copy failed:', e);
        }
        document.body.removeChild(ta);
        showToast(ok ? 'Invite link copied!' : 'Copy failed');
      });
    });

    document.getElementById('status').textContent =
      `Editing assignments for ${pid}`;
  },

  async toggleAssign (pid, dsID, allow) {
    const r = await fetch('/admin/assign', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ prolificID:pid, datasetID:dsID, allow })
    });
    if (!r.ok) { alert('DB error — change reverted'); this.loadForUser(pid); }
  },

  /* inline metadata editor for label + description */
  async editMeta (dsID) {
    const labelSpan = document.querySelector(`.dsLabel[data-id="${dsID}"]`);
    const descTd    = document.querySelector(`.dsDesc[data-id="${dsID}"]`);

    const newLabel = prompt('Dataset label:', labelSpan.textContent.trim());
    if (newLabel === null) return;
    const newDesc  = prompt('Dataset description:', descTd.textContent.trim());
    if (newDesc === null) return;

    const r = await fetch(`/admin/dataset_meta/${dsID}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ label:newLabel, description:newDesc })
    });
    if (!r.ok) { alert('Save failed'); return; }

    /* update UI */
    labelSpan.textContent = newLabel;
    descTd.textContent    = newDesc;

    /* keep local cache in sync so a reload keeps edits */
    const ds = this.datasets.find(d => d.id === dsID);
    if (ds) { ds.label = newLabel; ds.description = newDesc; }
  }
};




/* ------------------------------------------------
 * Auto‑boot when DOM ready
 * ------------------------------------------------ */
document.addEventListener('DOMContentLoaded', ()=>
  Pages[document.body.dataset.page]?.init?.());
