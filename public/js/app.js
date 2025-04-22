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

/* ------------------------------------------------
 * Pages – each key matches <body data‑page="…">
 * ------------------------------------------------ */
const Pages = {

  /* ---------- login ---------- */
  login: {
    init() {
      document.getElementById('loginBtn').addEventListener('click', async () => {
        const pid = document.getElementById('prolificIDInput').value.trim();
        if (!pid) { alert('Enter your Prolific ID'); return; }

        const ok = await fetch('/login',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({prolificID:pid})
        }).then(r=>r.json());

        if (ok.success) {
          localStorage.setItem('prolificID', pid);
          location.href = 'select_dataset.html';
        }
      });
    }
  },

  /* ---------- dataset select ---------- */
  select: {
    async init() {
      Common.ensureLogin(); Common.initNavbar();
      const pid       = Common.pid();
      const datasets  = await fetch('/datasets').then(r=>r.json());
      const firstID   = datasets[0].id;

      /* ask once whether user finished first dataset */
      const doneFirst = (await fetch(
        `/get_questions?prolificID=${pid}&dataset=${encodeURIComponent(firstID)}`
      ).then(r=>r.json())).done;

      const wrap = document.getElementById('datasetButtons');

      /* Build the grid */
      for (const ds of datasets){
        const card = document.createElement('div');

        /* dataset title */
        const h = document.createElement('h3');
        h.textContent = ds.label;
        card.append(h);

        /* Annotate button */
        const anno = document.createElement('button');
        anno.textContent = 'Annotate';
        anno.disabled = (ds.id!==firstID && !doneFirst);
        anno.onclick  = () => {
          localStorage.setItem('datasetID', ds.id);
          location.href='index.html';
        };
        card.append(anno);

        /* Past answers button */
        const past = document.createElement('button');
        past.textContent = 'Past answers';
        past.disabled = true;          // default; we enable below if any answer exists
        past.onclick  = () => {
          localStorage.setItem('datasetID', ds.id);
          location.href='past_answers.html';
        };
        card.append(past);

        /* async check whether user has any responses */
        (async ()=>{
          const j = await fetch(
            `/qresponses/${pid}?dataset=${encodeURIComponent(ds.id)}`
          ).then(r=>r.json());
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

      /* Buttons */
      document.getElementById('pastAnswersBtn')
        .addEventListener('click',()=>location.href='past_answers.html');

      document.getElementById('popOutBtn')
        .addEventListener('click',()=>{
          const feat = `toolbar=no,location=no,menubar=no,` +
                       `width=${screen.width},height=${screen.height},fullscreen=yes`;
          window.open(window.location.href,'_blank',feat);
        });

      this.form.addEventListener('submit',e=>this.submit(e));
      await this.load();
    },

    async load(){
      this.status.textContent='Loading…';
      const data = await fetch(
        `/get_questions?prolificID=${Common.pid()}&dataset=${encodeURIComponent(Common.ds())}`
      ).then(r=>r.json());

      if (data.error){ this.showMsg(data.error); return; }
      if (data.done ){ this.showMsg('All done!'); return; }

      this.current=data;
      this.render();
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
      this.mapDiv.innerHTML='';
      if (q.locations?.length){
        const m=new google.maps.Map(this.mapDiv,{center:q.locations[0],zoom:8});
        q.locations.forEach(p=>new google.maps.Marker({position:p,map:m}));
      }else{
        this.mapDiv.textContent='No locations.';
      }
    },

    async submit(e){
      e.preventDefault();
      const q=this.current.question;
      const payload={
        dataset:Common.ds(), prolificID:Common.pid(),
        questionIndex:this.current.questionIndex,
        QID:q.QID, question:q.Question,
        answer:document.getElementById('qAnswer').value,
        difficulty:document.getElementById('difficulty').value
      };
      const r=await fetch('/submit_question',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)});
      const j=await r.json();
      if (!r.ok){ alert(j.error); return; }
      alert('Saved!');
      this.form.reset();
      this.load();
    }
  },

  /* ---------- past answers ---------- */
past: {
  async init () {
    Common.ensureLogin(); Common.initNavbar();
    if (!Common.ds()) location.href = '/select_dataset.html';

    const wrap = document.getElementById('answersList');
    wrap.innerHTML = 'Loading…';

    const rsp = await fetch(
      `/qresponses/${Common.pid()}?dataset=${encodeURIComponent(Common.ds())}`
    );
    if (!rsp.ok) {
      wrap.textContent = 'Server error – try again later.'; return;
    }

    const { responses } = await rsp.json();

    /* strict client‑side filter (safety belt) */
    const real = responses.filter(r =>
      r &&
      r.prolificID === Common.pid() &&
      // r.dataset     === Common.ds() &&
      r.question && r.question !== '(dummy)' &&
      r.answer   && r.answer   !== '(none)'
    );

    if (!real.length) {
      wrap.textContent = 'No answers yet.'; return;
    }

    wrap.innerHTML = '';   // clear “Loading…”

    real.forEach(r => {
      const card = document.createElement('div');
      card.className = 'answer-card';
      card.innerHTML = `
        <p><strong>Q:</strong> ${r.question}</p>

        <label>Answer:
          <input type="text" value="${r.answer}">
        </label>

        <label>Difficulty:
          <input type="number" min="1" max="10"
                 value="${r.difficulty ?? ''}">
        </label>

        <button class="editBtn">Edit</button>
      `;

      const ansIn  = card.querySelector('input[type=text]');
      const diffIn = card.querySelector('input[type=number]');
      const btn    = card.querySelector('.editBtn');

      ansIn.disabled = diffIn.disabled = true;

      btn.addEventListener('click', async () => {
        const editing = ansIn.disabled;
        ansIn.disabled = diffIn.disabled = !editing;
        btn.textContent = editing ? 'Save' : 'Edit';

        if (!editing) {
          await fetch(`/edit_qresponse/${Common.pid()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dataset:    Common.ds(),
              responseID: r.responseID,
              answer:     ansIn.value,
              difficulty: diffIn.value
            })
          });
        }
      });

      wrap.append(card);
    });
  }
},


  /* ---------- instructions ---------- */
  instructions:{
    async init(){
      Common.ensureLogin(); Common.initNavbar();
      const md=await fetch('/instructions.md').then(r=>r.text());
      document.getElementById('mdContent').innerHTML = marked.parse(md);
    }
  }
};

/* ------------------------------------------------
 * Auto‑boot when DOM ready
 * ------------------------------------------------ */
document.addEventListener('DOMContentLoaded', ()=>
  Pages[document.body.dataset.page]?.init?.());



       

