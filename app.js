// -----------------------------
// QCM LAS Platform (static, free)
// -----------------------------

const state = {
  mode: "exam",         // exam | train
  theme: "light",
  timerEnabled: true,
  timerPerQuestion: 90,
  timerTotalSec: 0,
  accent: "rosesalmon",
  user: null,
  qcmTitle: "",
  timerRemainingSec: 0,
  timerRunning: false,
  timerLastTick: null,
  quizStartedAt: null,
  quizEndedAt: null,
  questions: [],
  current: 0,
  answers: {},          // {idx: {type, payload}}
  validated: {},        // {idx: {score, errors}}
  finished: false
};

let timerInterval = null;

const PROMPT_TEXT = `Tu es un enseignant en LAS.
Tu dois generer des QCM STRICTEMENT bases sur le cours fourni par l'etudiant.

Contraintes OBLIGATOIRES :
- Langue : francais
- Aucun contenu invente (si l'info n'est pas dans le cours, ne pas l'utiliser)
- Reponse en JSON STRICT (aucun texte hors JSON)
- 80% questions type "multi" et 20% type "tf"
- Toujours 5 propositions/items A->E
- Pour chaque question "multi", choisis un nombre de bonnes reponses ALEATOIRE entre 1 et 5 (distribution uniforme, sans preference).
- Repartitionne les lettres de reponses correctes de facon EQUILIBREE sur l'ensemble du QCM (eviter que les bonnes reponses soient souvent A/B/C).
- Interdiction de pattern : ne pas reutiliser la meme combinaison de lettres de bonnes reponses sur plusieurs questions consecutives.
- Repartition EQUILIBREE du nombre de bonnes reponses : sur l'ensemble du QCM, 1, 2, 3, 4, 5 bonnes reponses doivent apparaitre de maniere proche (ecart max 2 entre categories). Eviter la sur-repetition de 3.
- Equilibre des lettres correctes : sur l'ensemble du QCM, chaque lettre A/B/C/D/E doit apparaitre un nombre proche de fois parmi les bonnes reponses (eviter que A revienne trop souvent).

Format JSON attendu :
{
  "title": "Titre court du QCM",
  "questions": [
    {
      "type": "multi",
      "difficulty": "facile",
      "question": "Parmi les propositions suivantes, ...",
      "options": ["A ...","B ...","C ...","D ...","E ..."],
      "answer_indices": [1,3],
      "explanation": "Explication basee sur le cours.",
      "evidence": [{"page": 3, "excerpt": "copier-coller du cours..."}]
    },
    {
      "type": "tf",
      "difficulty": "moyen",
      "question": "Concernant ...",
      "items": ["A ...","B ...","C ...","D ...","E ..."],
      "truth": [true,false,true,false,false],
      "explanation": "Explication basee sur le cours.",
      "evidence": [{"page": 5, "excerpt": "copier-coller du cours..."}]
    }
  ]
}

Regles :
- options/items doivent commencer exactement par "A ", "B ", "C ", "D ", "E "
- answer_indices contient des indices 0..4
- truth contient 5 booleens
- difficulty doit être "facile", "moyen" ou "difficile" pour chaque question
- explanation est en francais, ne doit pas ajouter d'informations hors cours, et se termine par un resume des bonnes reponses par lettres (ex: "Reponses: ABC")
- evidence est optionnel mais recommande (1 a 3 extraits)
`;

function clampPromptCount(count) {
  if (!Number.isFinite(count)) return 30;
  const n = Math.floor(count);
  return Math.min(40, Math.max(1, n));
}

function clampTimerPerQuestionCount(count) {
  if (!Number.isFinite(count)) return 90;
  const n = Math.floor(count);
  return Math.min(200, Math.max(5, n));
}

function buildPromptText(count) {
  const n = clampPromptCount(count);
  return `${PROMPT_TEXT}\nGenere ${n} questions.`;
}

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
}

function updateTimerDisplay() {
  const el = $("timerDisplay");
  if (!el) return;
  if (state.mode !== "exam" || !state.timerEnabled || !state.questions.length) {
    el.textContent = "--:--";
    return;
  }
  el.textContent = formatTime(state.timerRemainingSec);
}

function initTimerForQuestions() {
  state.timerTotalSec = state.questions.length * state.timerPerQuestion;
  state.timerRemainingSec = state.timerTotalSec;
  state.timerRunning = false;
  state.timerLastTick = null;
  state.quizStartedAt = null;
  state.quizEndedAt = null;
  updateTimerDisplay();
}


function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  state.timerRunning = false;
  state.timerLastTick = null;
  updateTimerDisplay();
}

function tickTimer() {
  if (!state.timerRunning) return stopTimer();
  if (state.mode !== "exam" || !state.timerEnabled) return stopTimer();

  const now = Date.now();
  const last = state.timerLastTick || now;
  const delta = Math.max(1, Math.floor((now - last) / 1000));
  state.timerLastTick = now;
  state.timerRemainingSec = Math.max(0, (state.timerRemainingSec || 0) - delta);

  updateTimerDisplay();

  if (state.timerRemainingSec <= 0) {
    stopTimer();
    state.finished = true;
    goStep("results");
  }
}

function startTimer() {
  if (state.finished) return stopTimer();
  if (state.mode !== "exam" || !state.timerEnabled || !state.questions.length) return stopTimer();
  if (timerInterval) return;

  if (!state.timerTotalSec) {
    initTimerForQuestions();
  }
  if (!state.timerRemainingSec || state.timerRemainingSec <= 0) {
    state.timerRemainingSec = state.timerTotalSec;
  }

  state.timerRunning = true;
  state.timerLastTick = Date.now();
  updateTimerDisplay();
  timerInterval = setInterval(tickTimer, 1000);
}

function setTheme(next) {
  state.theme = next;
  if (next === "light") {
    document.documentElement.setAttribute("data-theme", "light");
    $("btnTheme").querySelector(".icon").textContent = "Clair";
  } else {
    document.documentElement.setAttribute("data-theme", "dark");
    $("btnTheme").querySelector(".icon").textContent = "Sombre";
  }
  saveUserPrefs({ pref_theme: next });
}

function setAccent(next) {
  state.accent = next;
  document.documentElement.setAttribute("data-accent", next);
  document.querySelectorAll(".accent-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.accent === next);
  });
  saveUserPrefs({ pref_accent: next });
}


function goStep(step) {
  // views
  $("view-setup").classList.toggle("hidden", step !== "setup");
  $("view-quiz").classList.toggle("hidden", step !== "quiz");
  $("view-results").classList.toggle("hidden", step !== "results");

  if (step === "quiz") {
    renderQuiz();
    if (!state.quizStartedAt) state.quizStartedAt = Date.now();
    if (state.mode === "exam" && state.timerEnabled) startTimer();
    else stopTimer();
    
  } else {
    stopTimer();
  }
  if (step === "results") {
    validateAllQuestions();
    renderResults();
  }
}

function validateQuestion(q, idx) {
  const baseErr = (msg) => `Question ${idx+1}: ${msg}`;
  if (!q || typeof q !== "object") throw new Error(baseErr("objet invalide"));

  if (!["multi","tf"].includes(q.type)) throw new Error(baseErr("type doit etre 'multi' ou 'tf'"));
  if (!["facile","moyen","difficile"].includes(q.difficulty)) {
    throw new Error(baseErr("difficulty doit etre 'facile', 'moyen' ou 'difficile'"));
  }
  if (typeof q.question !== "string" || q.question.trim().length < 5) throw new Error(baseErr("question trop courte"));
  if (typeof q.explanation !== "string") q.explanation = "";

  // optional evidence
  if (q.evidence !== undefined) {
    if (!Array.isArray(q.evidence)) throw new Error(baseErr("evidence doit etre un tableau si present"));
    q.evidence.forEach((ev, i) => {
      if (typeof ev !== "object") throw new Error(baseErr(`evidence[${i}] invalide`));
      if (typeof ev.page !== "number") throw new Error(baseErr(`evidence[${i}].page doit etre un nombre`));
      if (typeof ev.excerpt !== "string") throw new Error(baseErr(`evidence[${i}].excerpt doit etre une chaine`));
    });
  }

  const mustPrefix = ["A ","B ","C ","D ","E "];

  if (q.type === "multi") {
    if (!Array.isArray(q.options) || q.options.length !== 5) throw new Error(baseErr("options doit contenir 5 elements"));
    q.options.forEach((s, i) => {
      if (typeof s !== "string") throw new Error(baseErr("options doivent etre des chaines"));
      if (!s.startsWith(mustPrefix[i])) throw new Error(baseErr(`options[${i}] doit commencer par "${mustPrefix[i]}"`));
    });
    if (!Array.isArray(q.answer_indices) || q.answer_indices.length < 1 || q.answer_indices.length > 5) {
      throw new Error(baseErr("answer_indices doit contenir 1 a 5 indices"));
    }
    const set = new Set(q.answer_indices);
    if (set.size !== q.answer_indices.length) throw new Error(baseErr("answer_indices contient des doublons"));
    q.answer_indices.forEach(n => {
      if (!Number.isInteger(n) || n < 0 || n > 4) throw new Error(baseErr("answer_indices doit etre entre 0 et 4"));
    });
  } else {
    if (!Array.isArray(q.items) || q.items.length !== 5) throw new Error(baseErr("items doit contenir 5 elements"));
    q.items.forEach((s, i) => {
      if (typeof s !== "string") throw new Error(baseErr("items doivent etre des chaines"));
      if (!s.startsWith(mustPrefix[i])) throw new Error(baseErr(`items[${i}] doit commencer par "${mustPrefix[i]}"`));
    });
    if (!Array.isArray(q.truth) || q.truth.length !== 5) throw new Error(baseErr("truth doit contenir 5 booleens"));
    q.truth.forEach(b => {
      if (typeof b !== "boolean") throw new Error(baseErr("truth doit contenir des booleens"));
    });
  }

  return q;
}

function loadQuestionsFromJsonText(text) {
  const setupMsg = $("setupMsg");
  clearMsg(setupMsg);

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    setMsg(setupMsg, "err", "JSON invalide : impossible a parser. Verifie les crochets, virgules, guillemets.");
    return false;
  }

  let questions = null;
  let titleFromJson = "";
  if (Array.isArray(data)) {
    questions = data;
  } else if (data && typeof data === "object" && Array.isArray(data.questions)) {
    questions = data.questions;
    const rawTitle =
      (typeof data.title === "string" && data.title) ||
      (typeof data.titre === "string" && data.titre) ||
      (typeof data.name === "string" && data.name) ||
      "";
    titleFromJson = String(rawTitle).trim();
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    setMsg(setupMsg, "err", "Le JSON doit etre un tableau non vide de questions (ou un objet {title, questions}).");
    return false;
  }

  try {
    const validated = questions.map((q,i) => validateQuestion(q,i));
    state.questions = validated;
    state.current = 0;
    state.answers = {};
    state.validated = {};
    state.finished = false;
    state.quizStartedAt = null;
    state.quizEndedAt = null;
    const inputTitle = ($("qcmTitleInput")?.value || "").trim();
    state.qcmTitle = inputTitle || titleFromJson || "QCM";
    initTimerForQuestions();
    const titleInfo = state.qcmTitle ? ` (${state.qcmTitle})` : "";
    clearMsg(setupMsg);
    return true;
  } catch (e) {
    setMsg(setupMsg, "err", e.message || "Erreur de validation du format.");
    return false;
  }
}

function calcLasScore(errors) {
  if (errors === 0) return 1.0;
  if (errors === 1) return 0.5;
  if (errors === 2) return 0.2;
  return 0.0;
}

function scoreMulti(q, userSet) {
  const correct = new Set(q.answer_indices);
  let falseChecked = 0;
  userSet.forEach(i => { if (!correct.has(i)) falseChecked++; });
  let missed = 0;
  correct.forEach(i => { if (!userSet.has(i)) missed++; });

  const errors = falseChecked + missed;
  return { score: calcLasScore(errors), errors };
}

function scoreTF(q, userTruth) {
  let errors = 0;
  for (let i=0;i<5;i++){
    if (userTruth[i] !== q.truth[i]) errors++;
  }
  return { score: calcLasScore(errors), errors };
}

function renderSetup() {
  const promptCount = $("promptQuestionCount");
  if (promptCount) {
    const v = parseInt(promptCount.value, 10);
    promptCount.value = String(clampPromptCount(v));
  }
  const count = parseInt($("promptQuestionCount")?.value || "30", 10);
  $("promptBox").textContent = buildPromptText(count);

  // segmented mode
  document.querySelectorAll(".seg").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === state.mode);
  });

  setAccent(state.accent || "rosesalmon");
  $("timerToggle").checked = state.timerEnabled;
  $("timerPerQuestion").value = String(state.timerPerQuestion || 90);
  if (state.theme === "light") setTheme("light"); else setTheme("dark");
  updateTimerDisplay();
  const titleInput = $("qcmTitleInput");
  if (titleInput) titleInput.value = state.qcmTitle || "";

  if (state.questions.length) {
    setMsg($("setupMsg"), "ok", `QCM en memoire : ${state.questions.length} questions. Tu peux aller a l'etape 2.`);
  } else {
    clearMsg($("setupMsg"));
  }
}

function renderProgress() {
  const n = state.questions.length;
  const idx = state.current;
  const doneCount = Object.keys(state.validated).length;
  const pct = Math.round(((idx+1) / n) * 100);

  $("progressFill").style.width = pct + "%";
  $("progressText").textContent = `Question ${idx+1}/${n}`;
}

function renderQuiz() {
  if (!state.questions.length) {
    goStep("setup");
    return;
  }

  const q = state.questions[state.current];
  const idx = state.current;

  const headerTitle = state.qcmTitle ? `QCM: ${state.qcmTitle} · ` : "";
  $("quizMeta").textContent = `${headerTitle}Mode: ${state.mode === "exam" ? "Examen" : "Entrainement"} - ${state.questions.length} questions`;
  updateTimerDisplay();

  renderProgress();

  const card = $("questionCard");
  card.innerHTML = "";
  const corrBox = $("trainCorrection");
  if (corrBox) {
    corrBox.classList.add("hidden");
    corrBox.innerHTML = "";
  }

  const titleEl = document.createElement("div");
  titleEl.className = "q-title";
  titleEl.textContent = q.question;
  card.appendChild(titleEl);

  const meta = document.createElement("div");
  meta.className = "q-meta";
  meta.textContent = q.type === "multi" ? "QCM" : "Vrai/Faux par items (A->E)";
  card.appendChild(meta);

  // previous saved answer
  const saved = state.answers[idx];

  if (q.type === "multi") {
    const chosen = new Set(saved?.payload?.indices || []);

    q.options.forEach((opt, i) => {
      const row = document.createElement("label");
      row.className = "choice";

      const letter = document.createElement("div");
      letter.className = "choice-letter";
      letter.textContent = opt.slice(0, 1);

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = chosen.has(i);
      cb.addEventListener("change", () => {
        const cur = getCurrentAnswerPayload();
        state.answers[idx] = { type: "multi", payload: cur };
      });

      const txt = document.createElement("div");
      txt.className = "choice-text";
      txt.textContent = opt.slice(2);

      row.appendChild(letter);
      row.appendChild(cb);
      row.appendChild(txt);
      card.appendChild(row);
    });
  } else {
    // tf
    const savedTruth = saved?.payload?.truth ?? [null,null,null,null,null];

    q.items.forEach((item, i) => {
      const row = document.createElement("div");
      row.className = "tf-row";

      const it = document.createElement("div");
      it.className = "item";
      it.textContent = item;

      const pillV = document.createElement("button");
      pillV.type = "button";
      pillV.className = "pill" + (savedTruth[i] === true ? " active" : "");
      pillV.textContent = "Vrai";
      pillV.addEventListener("click", () => {
        savedTruth[i] = true;
        state.answers[idx] = { type: "tf", payload: { truth: savedTruth } };
        renderQuiz(); // re-render to update pills
      });

      const pillF = document.createElement("button");
      pillF.type = "button";
      pillF.className = "pill" + (savedTruth[i] === false ? " active" : "");
      pillF.textContent = "Faux";
      pillF.addEventListener("click", () => {
        savedTruth[i] = false;
        state.answers[idx] = { type: "tf", payload: { truth: savedTruth } };
        renderQuiz();
      });

      row.appendChild(it);
      row.appendChild(pillV);
      row.appendChild(pillF);
      card.appendChild(row);
    });
  }

  // message for validation
  clearMsg($("quizMsg"));
  if (state.mode === "train" && state.validated[idx]) {
    const v = state.validated[idx];
    // no long message; score shown inside correction block
    if (corrBox) {
      corrBox.classList.remove("hidden");
      corrBox.appendChild(buildCorrectionBlock(idx));
    }
  }

  const atStart = idx === 0;
  const atEnd = idx === state.questions.length - 1;
  const prevBtn = $("btnPrev");
  const nextBtn = $("btnNext");
  if (prevBtn) {
    prevBtn.disabled = atStart;
    prevBtn.classList.toggle("hidden", atStart);
  }
  if (nextBtn) {
    nextBtn.disabled = atEnd;
    nextBtn.classList.toggle("hidden", atEnd);
  }

  const validateBtn = $("btnValidate");
  if (validateBtn) {
    validateBtn.classList.toggle("hidden", state.mode === "exam");
    validateBtn.textContent = state.mode === "train" ? "Corriger" : "Valider";
  }
}

function getCurrentAnswerPayload() {
  const q = state.questions[state.current];
  const idx = state.current;

  if (q.type === "multi") {
    const inputs = $("questionCard").querySelectorAll('input[type="checkbox"]');
    const indices = [];
    inputs.forEach((cb, i) => { if (cb.checked) indices.push(i); });
    return { indices };
  } else {
    // tf: stored in state.answers
    const cur = state.answers[idx]?.payload?.truth ?? [null,null,null,null,null];
    return { truth: cur };
  }
}

function validateCurrent() {
  const q = state.questions[state.current];
  const idx = state.current;

  const quizMsg = $("quizMsg");
  clearMsg(quizMsg);

  // ensure answer exists
  const payload = getCurrentAnswerPayload();
  state.answers[idx] = { type: q.type, payload };

  let result;
  if (q.type === "multi") {
    const set = new Set(payload.indices || []);
    result = scoreMulti(q, set);
  } else {
    const truth = payload.truth || [];
    // require all answered
    const missing = truth.filter(v => v === null || v === undefined).length;
    if (missing > 0) {
      setMsg(quizMsg, "warn", "Il manque des reponses (Vrai/Faux) sur au moins un item.");
      return;
    }
    result = scoreTF(q, truth);
  }

  state.validated[idx] = result;

  if (state.mode === "train") {
    const t = result.errors === 0 ? "ok" : (result.errors <= 2 ? "warn" : "err");
    setMsg(quizMsg, t, `Valide - erreurs=${result.errors} - score=${result.score}`);
  } else {
    setMsg(quizMsg, "ok", "Reponse enregistree. (Correction complete a la fin - mode Examen)");
  }
}

function validateAllQuestions() {
  if (!state.questions.length) return;
  for (let i = 0; i < state.questions.length; i++) {
    if (state.validated[i]) continue;
    const q = state.questions[i];
    const a = state.answers[i]?.payload;
    let result;
    if (q.type === "multi") {
      const set = new Set(a?.indices || []);
      result = scoreMulti(q, set);
    } else {
      const truth = a?.truth || [null, null, null, null, null];
      result = scoreTF(q, truth);
    }
    state.validated[i] = result;
  }
}

function computeFinalMetrics() {
  const n = state.questions.length;
  let sum = 0;
  let done = 0;
  for (let i=0;i<n;i++){
    const v = state.validated[i];
    if (v) { sum += v.score; done++; }
    else { sum += 0; }
  }
  const mean = sum / n;
  const note20 = mean * 20;
  return { mean, note20, done };
}

async function saveRunIfAuthed() {
  if (!state.user) {
    console.warn("saveRunIfAuthed: no user session, skip.");
    return;
  }
  const payload = {
    user_id: state.user.id,
    mode: state.mode,
    title: state.qcmTitle || null,
    metrics: computeFinalMetrics(),
    questions: state.questions,
    answers: state.answers,
    validated: state.validated,
  };
  await insertQuizRun(payload);
}

function renderResults(filter="all") {
  if (!state.questions.length) {
    goStep("setup");
    return;
  }

  const metrics = computeFinalMetrics();
  const resultsTitle = $("resultsTitle");
  if (resultsTitle) {
    resultsTitle.textContent = state.qcmTitle ? `Résultats — ${state.qcmTitle}` : "Résultats";
  }
  const elapsedSec = state.quizStartedAt ? Math.max(0, Math.floor(((state.quizEndedAt || Date.now()) - state.quizStartedAt) / 1000)) : 0;
  const avgPerQ = state.questions.length ? Math.round(elapsedSec / state.questions.length) : 0;
  $("metric20").textContent = format1(metrics.note20);
  const el = $("metricTimeTotal");
  if (el) el.textContent = elapsedSec ? formatTime(elapsedSec) : "--:--";
  const elAvg = $("metricTimeAvg");
  if (elAvg) elAvg.textContent = avgPerQ ? formatTime(avgPerQ) : "--:--";

  const list = $("resultsList");
  list.innerHTML = "";

  for (let i=0;i<state.questions.length;i++){
    const q = state.questions[i];
    const v = state.validated[i];
    const score = v ? v.score : 0.0;
    const errors = v ? v.errors : null;

    const isWrong = v ? (v.errors >= 1) : true; // non valide = considere erreur
    const shouldShow =
      filter === "all" ||
      (filter === "wrong" && isWrong);

    if (!shouldShow) continue;

    const item = document.createElement("div");
    item.className = "result-item";

    const head = document.createElement("div");
    head.className = "result-head";

    const left = document.createElement("div");
    left.innerHTML = `<div class="result-title">Q${i+1} - ${q.type === "multi" ? "Multi" : "V/F"}</div>
                      <div class="muted">${escapeHtml(q.question)}</div>`;

    const tags = document.createElement("div");
    tags.className = "result-tags";

    const tagScore = document.createElement("span");
    const tagType = document.createElement("span");
    tagScore.className = "tag " + (score === 1.0 ? "ok" : (score >= 0.2 ? "warn" : "bad"));
    tagScore.textContent = `score ${score}`;

    tagType.className = "tag";
    tagType.textContent = errors === null ? "non validee" : `${errors} erreur(s)`;

    tags.appendChild(tagScore);
    tags.appendChild(tagType);

    head.appendChild(left);
    head.appendChild(tags);

    const details = document.createElement("div");
    details.className = "details";

    const corr = buildCorrectionBlock(i);
    details.appendChild(corr);

    head.addEventListener("click", () => {
      details.classList.toggle("show");
    });

    item.appendChild(head);
    item.appendChild(details);
    list.appendChild(item);
  }

}

function restartWithQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return setMsg($("setupMsg"), "warn", "Aucune question a relancer.");
  }
  stopTimer();
  state.questions = questions;
  state.current = 0;
  state.answers = {};
  state.validated = {};
    state.finished = false;
  state.quizStartedAt = null;
  state.quizEndedAt = null;
  initTimerForQuestions();
  renderSetup();
  goStep("quiz");
}

function restartAllCurrent() {
  restartWithQuestions(state.questions || []);
}

function restartWrongCurrent() {
  const qs = state.questions || [];
  if (!qs.length) return restartWithQuestions([]);
  const wrongIdx = qs.map((_, i) => i).filter(i => {
    const v = state.validated[i];
    return !v || v.errors >= 1;
  });
  const wrongQs = wrongIdx.map(i => qs[i]);
  restartWithQuestions(wrongQs);
}

async function launchQcmFromBank(difficulty, count, msgEl) {
  if (typeof window.fetchQcmQuestions !== "function") {
    if (msgEl) setMsg(msgEl, "err", "Fonction indisponible.");
    return;
  }
  let all = [];
  if (difficulty === "mix") {
    const [a, b, c] = await Promise.all([
      window.fetchQcmQuestions("facile"),
      window.fetchQcmQuestions("moyen"),
      window.fetchQcmQuestions("difficile")
    ]);
    all = [...a, ...b, ...c];
  } else {
    all = await window.fetchQcmQuestions(difficulty);
  }
  if (!all.length) {
    if (msgEl) setMsg(msgEl, "warn", "Aucune question disponible.");
    return;
  }
  let picked = all;
  if (count !== "all") {
    const n = parseInt(count, 10);
    if (!Number.isFinite(n) || n < 1) {
      if (msgEl) setMsg(msgEl, "warn", "Nombre invalide.");
      return;
    }
    const shuffled = all.slice().sort(() => Math.random() - 0.5);
    picked = shuffled.slice(0, Math.min(n, shuffled.length));
  }
  if (msgEl) clearMsg(msgEl);
  restartWithQuestions(picked);
  hideModal();
}

function buildCorrectionBlock(i) {
  return buildCorrectionFromData({
    question: state.questions[i],
    validated: state.validated[i],
    userAnswer: state.answers[i]?.payload
  });
}

function openQuestionGrid() {
  const wrap = document.createElement("div");
  wrap.className = "qgrid";

  for (let i=0;i<state.questions.length;i++){
    const btn = document.createElement("button");
    btn.className = "qbtn";
    btn.textContent = (i+1);

    if (state.validated[i]) btn.classList.add("done");
    if (i === state.current) btn.classList.add("current");

    btn.addEventListener("click", () => {
      state.current = i;
      hideModal();
      goStep("quiz");
    });

    wrap.appendChild(btn);
  }

  showModal("Aller a une question", wrap);
}

// -----------------------------
// Demo JSON
// -----------------------------
const DEMO = [
  {
    "type": "multi",
    "difficulty": "moyen",
    "question": "Parmi les propositions suivantes concernant le bareme LAS, lesquelles sont correctes ?",
    "options": [
      "A 0 erreur donne 1.0 point.",
      "B 1 erreur donne 0.5 point.",
      "C 2 erreurs donnent 0.2 point.",
      "D 3 erreurs donnent 0.2 point.",
      "E >=3 erreurs donnent 0.0 point."
    ],
    "answer_indices": [0,1,2,4],
    "explanation": "Le bareme LAS attribue 1.0 / 0.5 / 0.2 / 0.0 selon le nombre d'erreurs.",
    "evidence": [{"page": 1, "excerpt": "Nombre d'erreurs: 0->1.0 ; 1->0.5 ; 2->0.2 ; >=3->0.0"}]
  },
  {
    "type": "tf",
    "difficulty": "facile",
    "question": "Concernant la structure des questions, chaque item A->E doit etre present.",
    "items": [
      "A Une question multi comporte 5 propositions A->E.",
      "B Une question multi peut avoir 1 a 5 bonnes reponses.",
      "C Une question V/F a 5 items A->E.",
      "D La plateforme accepte moins de 5 items pour V/F.",
      "E Le format impose une reponse JSON stricte."
    ],
    "truth": [true,true,true,false,true],
    "explanation": "Le format impose 5 options/items et une structure JSON stricte.",
    "evidence": [{"page": 1, "excerpt": "Types: multi (5 propositions) ; tf (5 items). JSON strict requis."}]
  }
];

// -----------------------------
// Events
// -----------------------------
function init() {
  setTheme(state.theme || "light");
  setAccent(state.accent || "rosesalmon");

  // set prompt
  const initCount = parseInt($("promptQuestionCount")?.value || "30", 10);
  $("promptBox").textContent = buildPromptText(initCount);

  // restore UI
  renderSetup();

  // auth init
  supabaseClient.auth.getSession().then(({ data }) => {
    renderAuth(data.session?.user || null);
  });
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    renderAuth(session?.user || null);
  });

  const btnSignOut = $("btnSignOut");
  if (btnSignOut) btnSignOut.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    setAuthStatus("ok", "Deconnecte.");
  });
  const btnAccountInfo = $("btnAccountInfo");
  if (btnAccountInfo) btnAccountInfo.addEventListener("click", () => {
    $("accountMenu").classList.add("hidden");
    const wrap = document.createElement("div");
    wrap.className = "auth-card";

    const p = document.createElement("div");
    p.className = "muted";
    p.textContent = "Change ton mot de passe. Plus d'options arriveront bientôt.";
    wrap.appendChild(p);

    const row1 = document.createElement("div");
    row1.className = "auth-row";
    row1.innerHTML = `
      <label class="label">Nouveau mot de passe</label>
      <input id="accountNewPassword" class="input" type="password" placeholder="Nouveau mot de passe" />
    `;
    wrap.appendChild(row1);

    const row2 = document.createElement("div");
    row2.className = "auth-row";
    row2.innerHTML = `
      <label class="label">Confirmer</label>
      <input id="accountNewPassword2" class="input" type="password" placeholder="Confirmer" />
    `;
    wrap.appendChild(row2);

    const actions = document.createElement("div");
    actions.className = "row";
    actions.style.padding = "0";
    actions.style.marginTop = "6px";
    const btnSave = document.createElement("button");
    btnSave.className = "btn btn-primary";
    btnSave.textContent = "Mettre a jour";
    btnSave.addEventListener("click", async () => {
      const p1 = $("accountNewPassword")?.value || "";
      const p2 = $("accountNewPassword2")?.value || "";
      if (p1.length < 8) {
        return setMsg($("accountPwdMsg"), "warn", "Mot de passe trop court (min 8).");
      }
      if (p1 !== p2) {
        return setMsg($("accountPwdMsg"), "warn", "Les mots de passe ne correspondent pas.");
      }
      const { error } = await supabaseClient.auth.updateUser({ password: p1 });
      if (error) return setMsg($("accountPwdMsg"), "err", error.message || "Erreur.");
      setMsg($("accountPwdMsg"), "ok", "Mot de passe mis a jour.");
      $("accountNewPassword").value = "";
      $("accountNewPassword2").value = "";
    });
    actions.appendChild(btnSave);
    wrap.appendChild(actions);

    const msg = document.createElement("div");
    msg.id = "accountPwdMsg";
    msg.className = "msg";
    wrap.appendChild(msg);

    showModal("Information du compte", wrap);
  });
  const btnHistory = $("btnHistory");
  if (btnHistory) btnHistory.addEventListener("click", () => {
    $("accountMenu").classList.add("hidden");
    openHistory();
  });
  const btnStats = $("btnStats");
  if (btnStats) btnStats.addEventListener("click", () => {
    $("accountMenu").classList.add("hidden");
    openStats(30);
  });

  const pdfInput = $("pdfInput");
  if (pdfInput) pdfInput.addEventListener("change", async () => {
    const file = pdfInput.files?.[0];
    await uploadPdf(file);
    pdfInput.value = "";
  });
  const btnSidePlus = $("btnSidePlus");
  const openNameModal = (title, placeholder, onSubmit) => {
    const wrap = document.createElement("div");
    wrap.className = "auth-card";

    const row = document.createElement("div");
    row.className = "auth-row";
    row.innerHTML = `
      <label class="label">${title}</label>
      <input id="modalNameInput" class="input" type="text" placeholder="${placeholder}" />
    `;
    wrap.appendChild(row);

    const actions = document.createElement("div");
    actions.className = "row";
    actions.style.padding = "0";
    actions.style.marginTop = "6px";

    const btnSave = document.createElement("button");
    btnSave.className = "btn btn-primary";
    btnSave.textContent = "Creer";
    btnSave.addEventListener("click", async () => {
      const value = $("modalNameInput")?.value?.trim() || "";
      if (!value) return setMsg($("modalNameMsg"), "warn", "Nom manquant.");
      await onSubmit(value);
      hideModal();
    });

    const btnCancel = document.createElement("button");
    btnCancel.className = "btn btn-ghost";
    btnCancel.textContent = "Annuler";
    btnCancel.addEventListener("click", hideModal);

    actions.appendChild(btnSave);
    actions.appendChild(btnCancel);
    wrap.appendChild(actions);

    const msg = document.createElement("div");
    msg.id = "modalNameMsg";
    msg.className = "msg";
    wrap.appendChild(msg);

    showModal(title, wrap);
    const input = $("modalNameInput");
    if (input) {
      input.focus();
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") btnSave.click();
      });
    }
  };

  if (btnSidePlus) btnSidePlus.addEventListener("click", async () => {
    openNameModal("Nouvelle matiere", "Ex: Physiologie", async (name) => {
      await createMatiere(name);
    });
  });
  const btnAddChapitre = $("btnAddChapitre");
  if (btnAddChapitre) btnAddChapitre.addEventListener("click", async () => {
    if (!currentMatiereId) return setMsg($("chapitreMsg"), "warn", "Selectionne une matiere.");
    openNameModal("Nouveau chapitre", "Ex: Chapitre 1", async (name) => {
      await createChapitre(name);
    });
  });
  const btnNewPdf = $("btnNewPdf");
  if (btnNewPdf) btnNewPdf.addEventListener("click", () => {
    const input = $("pdfInput");
    if (input) input.click();
    if (sidePlusMenu) sidePlusMenu.classList.add("hidden");
  });

  // gate buttons
  $("btnGateSignUp").addEventListener("click", async () => {
    const first = $("gateFirstName").value.trim();
    const last = $("gateLastName").value.trim();
    const birth = $("gateBirthdate").value;
    const email = $("gateEmail2").value.trim();
    const password = $("gatePassword2").value;
    if (!first || !last || !birth) {
      return setGateStatus("warn", "Prenom, nom et date de naissance requis.");
    }
    await signUpWith(email, password, { first_name: first, last_name: last, birthdate: birth }, setGateStatus);
  });
  $("btnGateSignIn").addEventListener("click", async () => {
    const email = $("gateEmail").value.trim();
    const password = $("gatePassword").value;
    await signInWith(email, password, setGateStatus);
  });
  $("btnGateReset").addEventListener("click", async () => {
    const email = $("gateEmail").value.trim();
    await resetWith(email, setGateStatus);
  });
  $("btnShowSignUp").addEventListener("click", () => showGateScreen("signup"));
  $("btnShowLogin").addEventListener("click", () => showGateScreen("login"));

  $("btnSaveProfile").addEventListener("click", async () => {
    const first = $("profileFirstName").value.trim();
    const last = $("profileLastName").value.trim();
    const birth = $("profileBirthdate").value;
    await updateProfile({ first_name: first, last_name: last, birthdate: birth }, (t, m) => {
      const el = $("profileStatus");
      if (!el) return;
      if (!m) return clearMsg(el);
      setMsg(el, t, m);
    });
  });


  // segmented mode
  const segWrap = document.querySelector(".segmented");
  const setSegIndex = (mode) => {
    if (!segWrap) return;
    const idx = mode === "train" ? 1 : 0;
    segWrap.style.setProperty("--seg-index", String(idx));
  };
  setSegIndex(state.mode);
  document.querySelectorAll(".seg").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".seg").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.mode = btn.dataset.mode;
      setSegIndex(state.mode);
      if (state.mode !== "exam") {
        stopTimer();
      } else if (state.timerEnabled && !$("view-quiz").classList.contains("hidden")) {
        startTimer();
      }
      updateTimerDisplay();
      clearMsg($("setupMsg"));
    });
  });

  // accent theme menu
  $("btnAccent").addEventListener("click", (e) => {
    e.stopPropagation();
    $("accentMenu").classList.toggle("hidden");
  });
  document.querySelectorAll(".accent-item").forEach(btn => {
    btn.addEventListener("click", () => {
      setAccent(btn.dataset.accent || "rosesalmon");
      $("accentMenu").classList.add("hidden");
    });
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".theme-menu")) {
      $("accentMenu").classList.add("hidden");
    }
  });

  // account menu (sidebar only)
  const btnSideAccount = $("btnSideAccount");
  if (btnSideAccount) btnSideAccount.addEventListener("click", (e) => {
    e.stopPropagation();
    $("accountMenu").classList.add("from-sidebar");
    $("accountMenu").classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#accountMenu") && !e.target.closest("#btnSideAccount")) {
      $("accountMenu").classList.add("hidden");
    }
  });

  $("timerToggle").addEventListener("change", (e) => {
    state.timerEnabled = e.target.checked;
    if (!state.timerEnabled) {
      stopTimer();
    } else if (state.mode === "exam" && !$("view-quiz").classList.contains("hidden")) {
      startTimer();
    }
    updateTimerDisplay();
  });

  const timerPerQuestionEl = $("timerPerQuestion");
  const applyTimerPerQuestion = (raw, forceClamp) => {
    const v = parseInt(raw, 10);
    if (!Number.isFinite(v)) {
      if (forceClamp) {
        const next = clampTimerPerQuestionCount(90);
        if (timerPerQuestionEl) timerPerQuestionEl.value = String(next);
        state.timerPerQuestion = next;
        initTimerForQuestions();
        if (state.mode === "exam" && !$("view-quiz").classList.contains("hidden")) {
          startTimer();
        }
        updateTimerDisplay();
      }
      return;
    }
    const next = forceClamp ? clampTimerPerQuestionCount(v) : Math.floor(v);
    if (forceClamp && timerPerQuestionEl) timerPerQuestionEl.value = String(next);
    state.timerPerQuestion = next;
    initTimerForQuestions();
    if (state.mode === "exam" && !$("view-quiz").classList.contains("hidden")) {
      startTimer();
    }
    updateTimerDisplay();
  };
  if (timerPerQuestionEl) {
    timerPerQuestionEl.addEventListener("input", (e) => {
      applyTimerPerQuestion(e.target.value, false);
    });
    timerPerQuestionEl.addEventListener("blur", (e) => {
      applyTimerPerQuestion(e.target.value, true);
    });
  }

  // copy prompt
  $("btnCopyPrompt").addEventListener("click", async () => {
    const count = parseInt($("promptQuestionCount")?.value || "30", 10);
    await navigator.clipboard.writeText(buildPromptText(count));
    setMsg($("setupMsg"), "ok", "Prompt copie. Colle-le dans ChatGPT.");
  });

  const promptCountEl = $("promptQuestionCount");
  if (promptCountEl) {
    const applyPromptCount = (raw, forceClamp) => {
      const v = parseInt(raw, 10);
      if (!Number.isFinite(v)) {
        if (forceClamp) {
          const next = clampPromptCount(30);
          promptCountEl.value = String(next);
          $("promptBox").textContent = buildPromptText(next);
        }
        return;
      }
      const next = forceClamp ? clampPromptCount(v) : Math.floor(v);
      if (forceClamp) promptCountEl.value = String(next);
      $("promptBox").textContent = buildPromptText(next);
    };
    promptCountEl.addEventListener("input", (e) => {
      applyPromptCount(e.target.value, false);
    });
    promptCountEl.addEventListener("blur", (e) => {
      applyPromptCount(e.target.value, true);
    });
  }

  const setupSelectMenu = (wrapId, toggleId, menuId, onPick) => {
    const wrap = $(wrapId);
    const toggle = $(toggleId);
    const menu = $(menuId);
    if (!wrap || !toggle || !menu) return;
    const closeMenu = () => menu.classList.remove("open");
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.toggle("open");
    });
    menu.querySelectorAll(".select-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = parseInt(btn.dataset.value || "", 10);
        onPick(v);
        closeMenu();
      });
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(`#${wrapId}`)) closeMenu();
    });
  };

  setupSelectMenu("promptCountWrap", "promptCountToggle", "promptCountMenu", (v) => {
    const next = clampPromptCount(v);
    promptCountEl.value = String(next);
    promptCountEl.dispatchEvent(new Event("input", { bubbles: true }));
  });

  setupSelectMenu("timerPerQuestionWrap", "timerPerQuestionToggle", "timerPerQuestionMenu", (v) => {
    const next = clampTimerPerQuestionCount(v);
    if (timerPerQuestionEl) {
      timerPerQuestionEl.value = String(next);
      applyTimerPerQuestion(String(next), true);
    }
  });

  // import cards (right panel)
  const jsonBlock = $("jsonBlock");
  const settingsView = $("settingsView");
  const qcmView = $("qcmView");
  const cardPlaceholder = $("cardPlaceholder");
  const cardPlaceholderTitle = $("cardPlaceholderTitle");
  const cardPlaceholderText = $("cardPlaceholderText");
  const setInputMode = (mode) => {
    document.querySelectorAll("#importCards .mode-card").forEach(c => {
      c.classList.toggle("active", c.dataset.view === mode);
    });
    if (mode === "settings") {
      jsonBlock?.classList.add("hidden");
      qcmView?.classList.add("hidden");
      cardPlaceholder?.classList.add("hidden");
      settingsView?.classList.remove("hidden");
      return;
    }
    settingsView?.classList.add("hidden");
    if (mode === "json") {
      jsonBlock?.classList.remove("hidden");
      qcmView?.classList.add("hidden");
      cardPlaceholder?.classList.add("hidden");
    } else if (mode === "qcm") {
      jsonBlock?.classList.add("hidden");
      qcmView?.classList.remove("hidden");
      cardPlaceholder?.classList.add("hidden");
    } else {
      jsonBlock?.classList.add("hidden");
      qcmView?.classList.add("hidden");
      cardPlaceholder?.classList.remove("hidden");
      if (cardPlaceholderTitle) {
        const title = document.querySelector(`#importCards .mode-card[data-view="${mode}"] .mode-card-title`);
        cardPlaceholderTitle.textContent = title ? title.textContent : "En construction";
      }
      if (cardPlaceholderText) {
        cardPlaceholderText.textContent = "Cette section arrive bientôt.";
      }
    }
  };
  setInputMode("settings");
  const setCardsEnabled = (enabled) => {
    document.querySelectorAll("#importCards .mode-card").forEach(card => {
      if (card.dataset.view === "settings") return;
      card.classList.toggle("disabled", !enabled);
      card.disabled = !enabled;
    });
    if (!enabled) {
      setInputMode("settings");
    }
  };
  window.setCardsEnabled = setCardsEnabled;
  setCardsEnabled(false);
  document.querySelectorAll("#importCards .mode-card").forEach((card) => {
    card.addEventListener("click", () => {
      if (card.classList.contains("disabled")) return;
      setInputMode(card.dataset.view);
    });
  });

  const btnGenerateQcm = $("btnGenerateQcm");
  if (btnGenerateQcm) btnGenerateQcm.addEventListener("click", async () => {
    const countRaw = parseInt($("qcmQuestionCount")?.value || "30", 10);
    const count = Number.isFinite(countRaw) ? Math.min(60, Math.max(1, countRaw)) : 30;
    const diff = $("qcmDifficulty")?.value || "moyen";
    const msg = $("qcmMsg");
    if (msg) clearMsg(msg);
    if (typeof window.generateQcmFromSelectedPdf !== "function") {
      if (msg) setMsg(msg, "err", "Fonction QCM indisponible.");
      return;
    }
    btnGenerateQcm.disabled = true;
    await window.generateQcmFromSelectedPdf({ count, difficulty: diff, statusEl: msg });
    btnGenerateQcm.disabled = false;
  });

  const qcmCountCard = $("qcmCountCard");
  if (qcmCountCard) qcmCountCard.addEventListener("click", () => {
    if (typeof window.getQcmCountsByDifficulty !== "function") return;
    const counts = window.getQcmCountsByDifficulty();
    const wrap = document.createElement("div");
    wrap.className = "bank-modal";

    const header = document.createElement("div");
    header.className = "bank-head";
    header.innerHTML = `
      <div>
        <div class="bank-title">QCM disponibles</div>
        <div class="muted">Choisis une difficulté ou mélange-les.</div>
      </div>
    `;
    wrap.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "bank-grid";
    grid.innerHTML = `
      <div class="bank-card">
        <div class="bank-card-label">Facile</div>
        <div class="bank-card-value">${counts.facile}</div>
      </div>
      <div class="bank-card">
        <div class="bank-card-label">Moyen</div>
        <div class="bank-card-value">${counts.moyen}</div>
      </div>
      <div class="bank-card">
        <div class="bank-card-label">Difficile</div>
        <div class="bank-card-value">${counts.difficile}</div>
      </div>
    `;
    wrap.appendChild(grid);

    const controls = document.createElement("div");
    controls.className = "bank-controls";
    controls.innerHTML = `
      <div class="bank-diff">
        <label class="bank-radio"><input type="radio" name="diff" value="facile" checked /> Facile</label>
        <label class="bank-radio"><input type="radio" name="diff" value="moyen" /> Moyen</label>
        <label class="bank-radio"><input type="radio" name="diff" value="difficile" /> Difficile</label>
        <label class="bank-check"><input id="bankMix" type="checkbox" /> Mélanger les difficultés</label>
      </div>
      <div class="bank-count">
        <div class="bank-count-label">Nombre de questions</div>
        <div class="bank-count-row">
          <button id="bankMinus" class="btn btn-ghost" type="button">-</button>
          <input id="bankQuestionCount" class="select" type="number" min="1" step="1" value="10" />
          <button id="bankPlus" class="btn btn-ghost" type="button">+</button>
        </div>
        <div id="bankMaxInfo" class="muted"></div>
      </div>
    `;
    wrap.appendChild(controls);

    const msg = document.createElement("div");
    msg.id = "bankMsg";
    msg.className = "msg";
    wrap.appendChild(msg);

    const actions = document.createElement("div");
    actions.className = "bank-actions";
    const btnAll = document.createElement("button");
    btnAll.className = "btn btn-secondary";
    btnAll.textContent = "Lancer (tout)";
    const btnN = document.createElement("button");
    btnN.className = "btn btn-primary";
    btnN.textContent = "Lancer (N)";
    actions.appendChild(btnAll);
    actions.appendChild(btnN);
    wrap.appendChild(actions);

    const getSelectedDiff = () => {
      const checked = wrap.querySelector('input[name="diff"]:checked');
      return checked ? checked.value : "facile";
    };
    const mixEl = () => $("bankMix");
    const countEl = () => $("bankQuestionCount");
    const maxEl = () => $("bankMaxInfo");
    const minusEl = () => $("bankMinus");
    const plusEl = () => $("bankPlus");
    const setButtonsDisabled = (disabled) => {
      btnAll.disabled = disabled;
      btnN.disabled = disabled;
      if (countEl()) countEl().disabled = disabled;
      if (minusEl()) minusEl().disabled = disabled;
      if (plusEl()) plusEl().disabled = disabled;
    };
    const setCountValue = (value) => {
      if (!countEl()) return;
      countEl().value = String(value);
    };
    const getCountValue = () => {
      const value = parseInt(countEl()?.value || "0", 10);
      return Number.isFinite(value) ? value : 0;
    };
    const updateMax = () => {
      const mix = mixEl()?.checked;
      const diff = getSelectedDiff();
      const max = mix
        ? (counts.facile + counts.moyen + counts.difficile)
        : (counts[diff] || 0);
      if (countEl()) {
        countEl().max = String(Math.max(1, max));
        countEl().min = max === 0 ? "0" : "1";
      }
      let cur = getCountValue();
      if (cur < 1) cur = 1;
      if (cur > max && max > 0) cur = max;
      if (max === 0) cur = 0;
      setCountValue(cur);
      if (maxEl()) maxEl().textContent = max ? `max ${max}` : "aucune question";
      setButtonsDisabled(max === 0);
      if (max === 0 && msg) setMsg(msg, "err", "Aucune question disponible pour ce choix.");
      if (max > 0 && msg) clearMsg(msg);
    };

    wrap.querySelectorAll('input[name="diff"]').forEach(r => {
      r.addEventListener("change", updateMax);
    });
    const mix = mixEl();
    if (mix) mix.addEventListener("change", () => {
      const disabled = mix.checked;
      wrap.querySelectorAll('input[name="diff"]').forEach(r => {
        r.disabled = disabled;
      });
      updateMax();
    });
    if (countEl()) {
      countEl().addEventListener("input", updateMax);
    }
    if (minusEl()) minusEl().addEventListener("click", () => {
      const max = parseInt(countEl()?.max || "1", 10);
      const next = Math.max(1, getCountValue() - 1);
      if (max > 0) setCountValue(Math.min(next, max));
      updateMax();
    });
    if (plusEl()) plusEl().addEventListener("click", () => {
      const max = parseInt(countEl()?.max || "1", 10);
      const next = getCountValue() + 1;
      if (max > 0) setCountValue(Math.min(next, max));
      updateMax();
    });
    updateMax();

    btnAll.addEventListener("click", async () => {
      const diff = mixEl()?.checked ? "mix" : getSelectedDiff();
      await launchQcmFromBank(diff, "all", msg);
    });
    btnN.addEventListener("click", async () => {
      const diff = mixEl()?.checked ? "mix" : getSelectedDiff();
      const n = parseInt(countEl()?.value || "0", 10);
      await launchQcmFromBank(diff, n, msg);
    });

    showModal("QCM disponibles", wrap);
  });

  // load JSON from textarea
  $("btnLoadJson").addEventListener("click", () => {
    const ok = loadQuestionsFromJsonText($("jsonInput").value.trim());
    if (ok) {
      if (typeof window.saveQcmQuestionsToBank === "function") {
        window.saveQcmQuestionsToBank(state.questions);
      }
      goStep("quiz");
    }
  });

  // demo
  $("btnDemo").addEventListener("click", () => {
    $("jsonInput").value = JSON.stringify(DEMO, null, 2);
    if ($("qcmTitleInput")) $("qcmTitleInput").value = "Exemple QCM";
    const ok = loadQuestionsFromJsonText($("jsonInput").value);
    if (ok) goStep("quiz");
  });

  // quiz buttons
  $("btnPrev").addEventListener("click", () => {
    if (state.current > 0) state.current--;
    renderQuiz();
  });
  $("btnNext").addEventListener("click", () => {
    if (state.current < state.questions.length - 1) state.current++;
    renderQuiz();
  });
  $("btnValidate").addEventListener("click", () => {
    validateCurrent();
    renderQuiz();
  });
  $("btnFinish").addEventListener("click", () => {
    state.finished = true;
    state.quizEndedAt = Date.now();
    validateAllQuestions();
    saveRunIfAuthed();
    goStep("results");
  });

  $("btnReview").addEventListener("click", () => openQuestionGrid());

  // modal close
  $("modalClose").addEventListener("click", hideModal);
  $("modal").addEventListener("click", (e) => {
    if (e.target === $("modal")) hideModal();
  });

  const btnCloseInlinePdf = $("btnCloseInlinePdf");
  if (btnCloseInlinePdf) btnCloseInlinePdf.addEventListener("click", () => {
    const wrap = $("pdfInlineViewer");
    const frame = $("pdfInlineFrame");
    const list = $("pdfList");
    if (frame) frame.src = "";
    if (wrap) wrap.classList.add("hidden");
    if (list) list.classList.remove("hidden");
    const block = $("pdfBlock");
    if (block) block.classList.remove("viewer-only");
  });

  // results filters
  $("btnShowAll").addEventListener("click", () => renderResults("all"));
  $("btnShowWrong").addEventListener("click", () => renderResults("wrong"));

  $("btnBackToSetup").addEventListener("click", () => goStep("setup"));
  $("btnRestartAll").addEventListener("click", () => restartAllCurrent());
  $("btnRestartWrong").addEventListener("click", () => restartWrongCurrent());

  // theme toggle
  $("btnTheme").addEventListener("click", () => {
    setTheme(state.theme === "light" ? "dark" : "light");
  });

  // sidebar toggle
  const appShell = document.querySelector(".app-shell");
  const sidebar = document.querySelector(".sidebar");
  const btnSidebar = $("btnSidebar");
  const stored = localStorage.getItem("qcm_sidebar_collapsed");
  if (stored === "1") {
    appShell?.classList.add("collapsed");
    sidebar?.classList.add("collapsed");
  }
  if (btnSidebar) {
    btnSidebar.addEventListener("click", () => {
      appShell?.classList.toggle("collapsed");
      sidebar?.classList.toggle("collapsed");
      const isCollapsed = appShell?.classList.contains("collapsed");
      localStorage.setItem("qcm_sidebar_collapsed", isCollapsed ? "1" : "0");
    });
  }

  // fullscreen
  const btnFullscreen = $("btnFullscreen");
  if (btnFullscreen) {
    const iconExpand = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10 10L4.5 4.5"></path>
        <path d="M4.5 4.5h4.5"></path>
        <path d="M4.5 4.5v4.5"></path>
        <path d="M14 10l5.5-5.5"></path>
        <path d="M19.5 4.5h-4.5"></path>
        <path d="M19.5 4.5v4.5"></path>
        <path d="M10 14l-5.5 5.5"></path>
        <path d="M4.5 19.5h4.5"></path>
        <path d="M4.5 19.5v-4.5"></path>
        <path d="M14 14l5.5 5.5"></path>
        <path d="M19.5 19.5h-4.5"></path>
        <path d="M19.5 19.5v-4.5"></path>
      </svg>`;
    const iconExit = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4.5 4.5L10 10"></path>
        <path d="M10 10H6"></path>
        <path d="M10 10V6"></path>
        <path d="M19.5 4.5L14 10"></path>
        <path d="M14 10h4"></path>
        <path d="M14 10V6"></path>
        <path d="M4.5 19.5L10 14"></path>
        <path d="M10 14H6"></path>
        <path d="M10 14v4"></path>
        <path d="M19.5 19.5L14 14"></path>
        <path d="M14 14h4"></path>
        <path d="M14 14v4"></path>
      </svg>`;
    const updateFsLabel = () => {
      const icon = btnFullscreen.querySelector(".icon");
      if (icon) icon.innerHTML = document.fullscreenElement ? iconExit : iconExpand;
      btnFullscreen.title = document.fullscreenElement ? "Quitter plein ecran" : "Plein ecran";
      btnFullscreen.setAttribute("aria-label", btnFullscreen.title);
    };
    btnFullscreen.addEventListener("click", async () => {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
      updateFsLabel();
    });
    document.addEventListener("fullscreenchange", updateFsLabel);
    updateFsLabel();
  }

  // FIX: fermer la modale quoi qu'il arrive au chargement
  hideModal();

  // FIX: touche Echap pour fermer la modale si elle s'affiche
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideModal();
  });
}

init();
