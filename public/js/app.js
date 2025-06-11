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

  select: {
    async init() {
      Common.ensureLogin();
      Common.initNavbar();
  
      const pid = Common.pid();
  
      // 1) load all datasets for this user
      const datasets = await fetch(`/user_datasets/${pid}`).then(r => r.json());
      if (!datasets.length) {
        const msg = document.createElement('p');
        msg.textContent = 'No datasets have been assigned to your account.';
        document.body.append(msg);
        return;
      }
  
      // 2) group by topic
      const byTopic = {};
      for (const ds of datasets) {
        const topic = ds.topic || 'Uncategorized';
        (byTopic[topic] ||= []).push(ds);
      }
  
      // 3) for each topic, create a standalone container
      for (const [topic, list] of Object.entries(byTopic)) {
        // a) container div under <body>
        const container = document.createElement('div');
        container.classList.add('container');
  
        // b) topic title
        const h2 = document.createElement('h2');
        h2.textContent = topic;
        container.append(h2);
  
        // c) inner buttons wrapper with id="datasetButtons"
        const buttonsDiv = document.createElement('div');
        buttonsDiv.id = 'datasetButtons';
        container.append(buttonsDiv);
  
        // d) for each dataset in this topic, build a .dataset-card
        for (const ds of list) {
          // fetch whether it’s been submitted
          const { submitted } = await fetch(
            `/dataset_submission/${pid}/${ds.id}`
          ).then(r => r.json());
  
          // card element
          const card = document.createElement('div');
          card.classList.add('dataset-card');
  
          // title
          const h3 = document.createElement('h3');
          h3.textContent = ds.label;
          card.append(h3);
  
          // annotate button
          const anno = document.createElement('button');
          anno.textContent = 'Annotate';
          anno.onclick = () => {
            localStorage.setItem('datasetID', ds.id);
            location.href = 'index.html';
          };
  
          // past answers button
          const past = document.createElement('button');
          past.textContent = 'Past answers';
          past.disabled = true;
          past.onclick = () => {
            localStorage.setItem('datasetID', ds.id);
            location.href = 'past_answers.html';
          };
  
          // status badge
          const badge = document.createElement('span');
          badge.classList.add(
            'status-badge',
            submitted ? 'complete' : 'incomplete'
          );
          badge.textContent = submitted ? 'Submitted' : 'Pending';
  
          // actions wrapper
          const actions = document.createElement('div');
          actions.classList.add('actions');
          actions.append(anno, past, badge);
          card.append(actions);
  
          // enable Past answers if any exist
          (async () => {
            const { responses } = await fetch(
              `/qresponses/${pid}?dataset=${encodeURIComponent(ds.id)}`
            ).then(r => r.json());
            if (responses.length) past.disabled = false;
          })();
  
          buttonsDiv.append(card);
        }
  
        // e) append this topic container to the document body
        document.body.append(container);
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
  },

  /* ---------- past answers ---------- */
  past: {
    async init () {
      Common.ensureLogin();
      Common.initNavbar();
      if (!Common.ds()) location.href = '/select_dataset.html';

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
      if (!rsp.ok) { 
        wrap.textContent = 'Server error – try again later.'; 
        return; 
      }

      const { responses } = await rsp.json();
      if (!responses.length) { 
        wrap.textContent = 'No answers yet.'; 
        return; 
      }

      // Clear and then insert the filter button
      wrap.innerHTML = '';

      // 1) Create the filter toggle button
      const filterBtn = document.createElement('button');
      filterBtn.id = 'filterIncorrectBtn';
      filterBtn.textContent = 'Show Incorrect Only';
      filterBtn.style.marginBottom = '1rem';
      wrap.appendChild(filterBtn);

      // 2) Create a container for all cards
      const cardsContainer = document.createElement('div');
      cardsContainer.id = 'cardsContainer';
      wrap.appendChild(cardsContainer);

      // 3) Boolean tracking whether filter is on
      let filterOn = false;

      // 4) When the button is clicked, toggle filter
      filterBtn.addEventListener('click', () => {
        filterOn = !filterOn;
        filterBtn.textContent = filterOn 
          ? 'Show All Answers' 
          : 'Show Incorrect Only';

        // Show/hide cards based on their data-eval attribute
        const allCards = cardsContainer.querySelectorAll('.answer-card');
        allCards.forEach(card => {
          const evalVal = card.getAttribute('data-eval');
          if (filterOn) {
            // if filtering: hide any card that is not "Incorrect"
            if (evalVal !== 'Incorrect') {
              card.style.display = 'none';
            }
          } else {
            // if not filtering: show all cards
            card.style.display = '';
          }
        });
      });

      // 5) Now build each card inside cardsContainer
      for (const r of responses) {
        // (a) Attempt to load the stored question JSON (to get its Label)
        let questionJSON = null;
        try {
          const qobj = await fetch(
            `/get_question_by_uid?dataset=${encodeURIComponent(ds)}&uid=${encodeURIComponent(r.uid)}`
          );
          if (qobj.ok) {
            questionJSON = await qobj.json();
          } else {
            console.warn(`Could not fetch question ${r.uid}: ${qobj.status}`);
          }
        } catch (e) {
          console.warn(`Error fetching question ${r.uid}:`, e);
        }

        // If for some reason we didn’t get a Label, fall back to an empty string
        const correctLabel = questionJSON?.Label ?? '';

        // Create the card
        const card = document.createElement('div');
        card.className = 'answer-card';

        // IMPORTANT: set data-eval so the filter can read it
        card.setAttribute('data-eval', r.llm_eval);

        /* -------- inner HTML -------- */
        card.innerHTML = `
          <p><strong>Q:</strong> ${r.question}</p>

          <label>Your Answer:
            ${
              r.llm_eval === "Incorrect"
                ? `<input type="text" value="✗ ${r.answer}" style="color:red;">`
                : `<input type="text" value="${r.answer}">`
            }
          </label>

          ${
            r.llm_eval === "Incorrect" && correctLabel !== null
            ? `<p class="correct-label" style="color:green; margin:0.25rem 0 0 0; font-style:italic;">
                Correct answer: ${correctLabel}
              </p>`
            : ``
          }

          <br>

          <label>Difficulty (1 = Very Easy, 5 = Very Difficult):
            <input type="number" min="1" max="10" value="${r.difficulty ?? ''}">
          </label>

          <label class="bad-label">
            <span class="inline-flex">
              <input type="checkbox" ${r.badQuestion ? 'checked' : ''}>
              Bad&nbsp;Question
            </span>
          </label>

          <label id="badReasonLabel"
                for="badReason"
                style="display:none; font-weight:500; margin-bottom:.25rem;${r.badQuestion ? '' : 'display:none;'}">
            Provide an answer and difficulty assuming the question is fixed
          </label>
          <textarea rows="1"
                    placeholder="Why is it bad / ambiguous / impossible?"
                    style="width:100%;margin-top:.4rem;resize:vertical;${r.badQuestion ? '' : 'display:none;'}">${r.badReason ?? ''}</textarea>

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

            if (!editing) { // now saving
              await fetch(`/edit_qresponse/${Common.pid()}`, {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({
                  dataset:     Common.ds(),
                  uid:         r.uid,
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

        // Append the card into cardsContainer (not directly into wrap)
        cardsContainer.appendChild(card);
      }
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
    head.innerHTML =
      '<th>Dataset</th><th>Topic</th><th>Description</th><th>Assigned?</th>';
  
    this.datasets.forEach(ds => {
      const row = tbl.insertRow();
  
      /* ── Dataset label + actions ───────────────────────── */
      const labelTd = row.insertCell();
      labelTd.innerHTML = `
        <div class="dataset-header">
          <span class="dsLabel" data-id="${ds.id}">${ds.label}</span>
          <div class="dataset-actions">
            <button class="editLabel"  data-id="${ds.id}">✎</button>
            <button class="inviteBtn" data-id="${ds.id}">➕ Invite</button>
          </div>
        </div>`;
  
      /* ── Topic (with inline edit) ──────────────────────── */
      const topicTd = row.insertCell();
      topicTd.innerHTML = `
        <span class="dsTopic" data-id="${ds.id}">${ds.topic || ''}</span>
        <button class="editTopic" data-id="${ds.id}">✎</button>`;
  
      /* ── Description (with inline edit) ────────────────── */
      const descTd = row.insertCell();
      descTd.innerHTML = `
        <span class="dsDesc" data-id="${ds.id}">${ds.description || ''}</span>
        <button class="editDesc" data-id="${ds.id}">✎</button>`;
  
      /* ── Assignment checkbox ───────────────────────────── */
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = assigned.has(ds.id);
      cb.addEventListener('change', () =>
        this.toggleAssign(pid, ds.id, cb.checked));
      row.insertCell().append(cb);
    });
  
    /* ── Attach handlers for every edit button ───────────── */
    tbl.querySelectorAll('.editLabel')
       .forEach(btn => btn.addEventListener('click',
         () => this.editField(btn.dataset.id, 'label')));
  
    tbl.querySelectorAll('.editTopic')
       .forEach(btn => btn.addEventListener('click',
         () => this.editField(btn.dataset.id, 'topic')));
  
    tbl.querySelectorAll('.editDesc')
       .forEach(btn => btn.addEventListener('click',
         () => this.editField(btn.dataset.id, 'description')));
  
    /* invite-link code stays exactly the same */
    tbl.querySelectorAll('.inviteBtn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const dsID = btn.dataset.id;
        const link = `${window.location.origin}/login.html?dataset=${encodeURIComponent(dsID)}`;
        const ta = document.createElement('textarea');
        ta.value = link;
        ta.style.position = 'fixed';
        ta.style.opacity  = '0';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch {}
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
  
  /* ----------------------------------------------------- */
  /* generic one-field editor (label / topic / description)*/
  async editField (dsID, field) {
    const ds = this.datasets.find(d => d.id === dsID);        // cache row
  
    const current = ds?.[field] ?? '';
    const promptText = {
      label:       'Dataset label:',
      topic:       'Dataset topic:',
      description: 'Dataset description:'
    }[field];
  
    const newVal = prompt(promptText, current);
    if (newVal === null) return;            // user hit Cancel
  
    /* 1) build a *complete* payload that preserves the other two columns */
    const body = {
      label:       field === 'label'       ? newVal : ds.label       ?? dsID,
      description: field === 'description' ? newVal : ds.description ?? '',
      topic:       field === 'topic'       ? newVal : ds.topic       ?? ''
    };
  
    /* 2) save to server */
    const r = await fetch(`/admin/dataset_meta/${dsID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) { alert('Save failed'); return; }
  
    /* 3) update UI + local cache */
    ds[field] = newVal;                          // cache stays in sync
    const cellSel = {
      label: '.dsLabel',
      topic: '.dsTopic',
      description: '.dsDesc'
    }[field];
    document.querySelector(`${cellSel}[data-id="${dsID}"]`).textContent = newVal;
  }
};

/* ------------------------------------------------
 * Pages.status – drives status.html
 * ------------------------------------------------ */
Pages.status = {
  async init () {
    Common.initNavbar();

    const topics = ['Military', 'Natural World', 'Urban', 'Aviation', 'Test']; // extend as needed
    const statusBox = document.getElementById('status');              // lives in the **first** container
    statusBox.textContent = 'Loading…';

    /* small helper to build <table> w/ header row */
    const makeTable = headers => {
      const tbl = document.createElement('table');
      tbl.innerHTML = `<tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr>`;
      return tbl;
    };

    for (const topic of topics) {
      let data;
      try {
        const r = await fetch(`/admin/campaign_status/${topic}`);
        if (!r.ok) throw new Error();
        data = await r.json();
      } catch {
        console.warn(`Campaign “${topic}” not found or empty`);
        continue;                       // skip missing campaigns
      }

      /* ── build one independent dashboard per campaign ── */
      const container = document.createElement('div');
      container.className = 'container';

      /* header */
      const h = document.createElement('h2');
      h.textContent = `${topic} Campaign`;
      container.append(h);

      /* campaign metadata */
      if (data.meta) {
        const p = document.createElement('p');
        p.style.marginTop = '.25rem';
        p.textContent =
          `Current index: ${data.meta.curIndex}   •   `
        + `Max images: ${data.meta.numImages}`;
        container.append(p);
      }

      /* accuracy table (User • Accuracy) */
      const accTbl = makeTable(['User', 'Accuracy']);
      data.users.forEach(u => {
        const tr = accTbl.insertRow();
        tr.innerHTML = `
          <td>${u.pid}</td>
          <td>${
            u.accuracy != null && Number.isFinite(parseFloat(u.accuracy))
              ? (parseFloat(u.accuracy) * 100).toFixed(1) + '%'
              : '—'
          }</td>`;
      });
      container.append(accTbl);

      /* progress table (Dataset • User • Status • Answered • Last) */
      const progTbl = makeTable(
        ['Dataset', 'User', 'Status', 'Answered', 'Last Response']
      );
      
      /* --- group rows by dataset so we can rowspan the first cell --- */
      const byDataset = {};
      data.progress.forEach(p => {
        (byDataset[p.dataset] ||= []).push(p);
      });
      
      Object.entries(byDataset).forEach(([dsName, rows]) => {
        /* keep the order stable – alphabetical by user */
        rows.sort((a, b) => a.pid.localeCompare(b.pid));
        const span = rows.length;
      
        rows.forEach((p, idx) => {
          const tr = progTbl.insertRow();
      
          /* first row → output the dataset cell with rowspan */
          if (idx === 0) {
            const td = tr.insertCell();
            td.rowSpan = span;
            td.textContent = dsName;
          }

          const userTd = tr.insertCell();
          userTd.classList.add('user-cell');
          userTd.innerHTML = `
            <span class="user-name">${p.pid}</span>
            <button
              class="removeUserBtn"
              data-pid="${p.pid}"
              data-dataset="${dsName}"
              aria-label="Remove ${p.pid}"
            >✖</button>
          `;
      
          const badge = p.submitted
            ? '<span class="badge complete">Completed</span>'
            : '<span class="badge pending">Pending</span>';
          const last  = p.lastTS ? new Date(p.lastTS).toLocaleString() : '—';
      
          // tr.insertCell().textContent = p.pid;               // User
          tr.insertCell().innerHTML   = badge;               // Status
          tr.insertCell().textContent = `${p.answered} / ${p.total}`;
          tr.insertCell().textContent = last;
        });
      });
      
      container.append(progTbl);
      container.querySelectorAll('.removeUserBtn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const pid = btn.dataset.pid;
          const dataset = btn.dataset.dataset;
          if (!confirm(`Remove user ${pid} from dataset ${dataset}?`)) return;

          try {
            const resp = await fetch('/admin/assign', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                prolificID: pid,
                datasetID: dataset,
                allow: false  // revoke access
              })
            });
            if (!resp.ok) throw new Error();
            // on success, remove the row from the table:
            btn.closest('tr').remove();
            showToast(`Removed ${pid} from ${dataset}`);
            setTimeout(() => location.reload(), 300);
          } catch {
            alert('Failed to remove user; please try again.');
          }
        });
      });

      /* add the whole block after the initial “status” container */
      document.body.appendChild(container);
    }

    statusBox.textContent = '';      // clear “Loading…”
  }
};



/* ------------------------------------------------
 * Auto‑boot when DOM ready
 * ------------------------------------------------ */
document.addEventListener('DOMContentLoaded', ()=>
  Pages[document.body.dataset.page]?.init?.());
