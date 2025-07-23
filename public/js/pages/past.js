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
        const correctLabel = questionJSON?.Label ?? r.nonconcurred_response ?? '';

        // Create the card
        const card = document.createElement('div');
        card.className = 'answer-card';

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
            r.llm_eval === "Incorrect" && correctLabel !== null
            ? `<p class="correct-label" style="color:green; margin:0.25rem 0 0 0; font-style:italic;">
                ${questionJSON?.Label ? 'Correct Answer' : 'Other User\'s Response'}: ${correctLabel}
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
      }
    }
  }