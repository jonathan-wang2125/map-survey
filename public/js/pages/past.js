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
  }