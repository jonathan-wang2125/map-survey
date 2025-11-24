import { Common } from '../common/common.js';

export const past = {
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
      `/qresponses/${pid}?dataset=${encodeURIComponent(ds)}`
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

    // Clear & insert filter button + cards container
    wrap.innerHTML = '';
    const usesGroundTruth = ds.endsWith('Accuracy');
    if (usesGroundTruth) {
      const notice = document.createElement('p');
      notice.className = 'info-banner';
      notice.textContent = 'These accuracy-set results are compared to the ground-truth key, not to another annotator.';
      notice.style.marginBottom = '1rem';
      wrap.appendChild(notice);
    }
    const filterBtn = document.createElement('button');
    filterBtn.id = 'filterIncorrectBtn';
    filterBtn.textContent = 'Show Incorrect Only';
    filterBtn.style.marginBottom = '1rem';
    wrap.appendChild(filterBtn);

    const cardsContainer = document.createElement('div');
    cardsContainer.id = 'cardsContainer';
    wrap.appendChild(cardsContainer);

    // 🔹 Parallel-fetch **all** question JSONs
    const questionPromises = responses.map(r =>
      fetch(
        `/get_question_by_uid?dataset=${encodeURIComponent(ds)}&uid=${encodeURIComponent(r.uid)}`
      )
      .then(qr => qr.ok ? qr.json() : null)
      .catch(() => null)
    );
    const questionJSONs = await Promise.all(questionPromises);

    // 3) filter toggle logic (unchanged)…
    let filterOn = false;
    filterBtn.addEventListener('click', () => {
      filterOn = !filterOn;
      filterBtn.textContent = filterOn 
        ? 'Show All Answers' 
        : 'Show Incorrect Only';

      cardsContainer.querySelectorAll('.answer-card').forEach(card => {
        const evalVal = card.getAttribute('data-eval');
        card.style.display = (!filterOn || evalVal === 'Incorrect') 
          ? '' : 'none';
      });
    });

    // 4) build cards using the pre‐fetched questionJSONs
    responses.forEach((r, idx) => {
      const questionJSON = questionJSONs[idx];
      const correctLabel = usesGroundTruth
  ? (r.groundTruth || '')
  : (r.nonconcurred_response || '');

const labelPrefix = usesGroundTruth
  ? 'Ground Truth Answer'
  : 'Other User\'s Response';

      const card = document.createElement('div');
      card.className = 'answer-card';
      card.setAttribute('data-eval', r.llm_eval);

       

        // IMPORTANT: set data-eval so the filter can read it
        card.setAttribute('data-eval', r.llm_eval);

        let elapsedMs = r.stopTime - r.startTime;
        let mins, secs;

        if (isNaN(elapsedMs) || elapsedMs < 0) {
          mins = secs = '--';
        } else {
          secs = String(Math.floor(elapsedMs / 1000) % 60).padStart(2, '0');
          mins = Math.floor(elapsedMs / 60000);
        }

        /* -------- inner HTML -------- */
        card.innerHTML = `
          <p><strong>Q:</strong> ${r.question}</p>
          ${r.adjudication ? `<span class="adjudication-flag">Adjudicated: ${r.adjudication}</span>` : ''}

          <label>Your Answer:
            ${
              r.llm_eval === "Incorrect"
                ? `<input type="text" value="✗ ${r.answer}" style="color:red;">`
                : `<input type="text" value="${r.answer}">`
            }
          </label>

          ${
            r.llm_eval === "Incorrect" 
            ? `<p class="correct-label" style="color:green; margin:0.25rem 0 0 0; font-style:italic;">
                ${labelPrefix}: ${correctLabel}
              </p>`
            : ``
          }

          <br>

          <!--
          <label>Difficulty (1 = Very Easy, 5 = Very Difficult):
            <input type="number" min="1" max="10" value="${r.difficulty ?? ''}">
          </label>
          -->

          <label>Time on question: ${mins}m ${secs.toString().padStart(2,'0')}s</label>

          <label class="bad-label">
            <span class="inline-flex">
              <input type="checkbox" ${r.badQuestion ? 'checked' : ''}>
              Question needs rephrasing
            </span>
          </label>

          <label id="badReasonLabel"
                for="badReason"
                style="display:none; font-weight:500; margin-bottom:.25rem;${r.badQuestion ? '' : 'display:none;'}">
            Provide an answer and difficulty assuming the question is rephrased
          </label>
          <textarea rows="1"
                    placeholder="Rephrase the question so the answer provided is valid."
                    style="width:100%;margin-top:.4rem;resize:vertical;${r.badQuestion ? '' : 'display:none;'}">${r.badReason ?? ''}</textarea>

          <label class="bad-label">
            <span class="inline-flex">
              <input type="checkbox" id="discardQuestion" ${r.discard ? 'checked' : ''}>
              Discard question
            </span>
          </label>

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

        if (r.llm_eval === 'Incorrect' &&
          !Common.ds().endsWith('Accuracy') &&
          !Common.ds().endsWith('Training')) {
          const adjBtn = document.createElement('button');
          adjBtn.textContent = 'Request adjudication';
          adjBtn.style.marginLeft = '0.5rem';
          card.querySelector('div').appendChild(adjBtn);
          adjBtn.addEventListener('click', async () => {
            adjBtn.disabled = true;
            adjBtn.textContent = 'Requested';
            await fetch('/request_adjudication', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pid: Common.pid(), dataset: Common.ds(), uid: r.uid })
            });
          });
        }

        /* -------- grab elements -------- */
        const ansIn   = card.querySelector('input[type=text]');
        // const diffIn  = card.querySelector('input[type=number]');
        const badBox  = card.querySelector('input[type=checkbox]');
        const discardBox = card.querySelector('#discardQuestion');
        const reason  = card.querySelector('textarea');
        const editBt  = card.querySelector('.editBtn');
        const mapBt   = card.querySelector('.mapBtn');

        /* read-only by default */
        [ansIn, badBox, reason, discardBox].forEach(el => (el.disabled = true));

        // Disable everything if the dataset has already been submitted
        if (submitted) {
          [ansIn, badBox, reason, editBt, discardBox].forEach(el => el.disabled = true);
        } else {
          /* show/hide textarea with checkbox */
          badBox.addEventListener('change', () => {
            reason.style.display = badBox.checked ? 'block' : 'none';
          });

          /* edit / save toggle */
          editBt.addEventListener('click', async () => {
            const editing = ansIn.disabled;
            const setDis  = !editing;
            [ansIn, badBox, reason, discardBox].forEach(el => (el.disabled = setDis));
            editBt.textContent = editing ? 'Save' : 'Edit';

            if (!editing) { // now saving
              await fetch(`/edit_qresponse/${Common.pid()}`, {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({
                  dataset:     Common.ds(),
                  uid:         r.uid,
                  answer:      ansIn.value,
                  difficulty:  0,
                  badQuestion: badBox.checked,
                  badReason:   reason.value,
                  discard:      discardBox.checked
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
      });
    }
  };