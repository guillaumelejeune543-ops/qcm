// -----------------------------
// QCM LAS Platform (static, free)
// -----------------------------

const $ = (id) => document.getElementById(id);

const state = {
  mode: "exam",         // exam | train
  autosave: true,
  theme: "dark",
  questions: [],
  current: 0,
  answers: {},          // {idx: {type, payload}}
  validated: {},        // {idx: {score, errors}}
  flagged: new Set(),
  finished: false
};

// -----------------------------
// TIMER EXAMEN LAS (AJOUT SANS MODIFIER LE RESTE)
// -----------------------------
const TIME_PER_QUESTION = 90; // secondes
let examTimerEnabled = true;
let examTotalTime = 0;
let examRemainingTime = 0;
let examTimerInterval = null;

function formatTimeMMSS(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function startExamTimer() {
  examTimerEnabled =
    state.mode === "exam" &&
    $("timerToggle") &&
    $("timerToggle").checked === true;

  if (!examTimerEnabled) {
    if ($("timerDisplay")) $("timerDisplay").textContent = "⏱️ —";
    return;
  }

  examTotalTime = state.questions.length * TIME_PER_QUESTION;
  examRemainingTime = examTotalTime;

  if ($("timerDisplay")) {
    $("timerDisplay").textContent = "⏱️ " + formatTimeMMSS(examRemainingTime);
  }

  examTimerInterval = setInterval(() => {
    examRemainingTime--;

    if ($("timerDisplay")) {
      $("timerDisplay").textContent = "⏱️ " + formatTimeMMSS(examRemainingTime);
    }

    if (examRemainingTime <= 0) {
      stopExamTimer();
      state.finished = true;
      autosaveMaybe();
      goStep("results");
    }
  }, 1000);
}

function stopExamTimer() {
  if (examTimerInterval) {
    clearInterval(examTimerInterval);
    examTimerInterval = null;
  }
}


const STORAGE_KEY = "qcm_las_v1_state";

const PROMPT_TEXT = `Tu es un enseignant en LAS.
Tu dois générer des QCM STRICTEMENT basés sur le cours fourni par l’étudiant.

Contraintes OBLIGATOIRES :
- Langue : français
- Aucun contenu inventé (si l’info n’est pas dans le cours, ne pas l’utiliser)
- Réponse en JSON STRICT (aucun texte hors JSON)
- 80% questions type "multi" et 20% type "tf"
- Toujours 5 propositions/items A→E

Format JSON attendu :
[
  {
    "type": "multi",
    "question": "Parmi les propositions suivantes, ...",
    "options": ["A ...","B ...","C ...","D ...","E ..."],
    "answer_indices": [1,3],
    "explanation": "Explication basée sur le cours.",
    "evidence": [{"page": 3, "excerpt": "copier-coller du cours..."}]
  },
  {
    "type": "tf",
    "question": "Concernant ...",
    "items": ["A ...","B ...","C ...","D ...","E ..."],
    "truth": [true,false,true,false,false],
    "explanation": "Explication basée sur le cours.",
    "evidence": [{"page": 5, "excerpt": "copier-coller du cours..."}]
  }
]

Règles :
- options/items doivent commencer exactement par "A ", "B ", "C ", "D ", "E "
- answer_indices contient des indices 0..4
- truth contient 5 booléens
- explanation est en français et ne doit pas ajouter d’informations hors cours
- evidence est optionnel mais recommandé (1 à 3 extraits)
`;

function setMsg(el, type, text) {
  el.className = "msg show " + (type || "");
  el.textContent = text;
}

function clearMsg(el) {
  el.className = "msg";
  el.textContent = "";
}

function setTheme(next) {
  state.theme = next;
  if (next === "light") {
    document.documentElement.setAttribute("data-theme", "light");
    $("btnTheme").querySelector(".icon").textContent = "☀️";
  } else {
    document.documentElement.removeAttribute("data-theme");
    $("btnTheme").querySelector(".icon").textContent = "🌙";
  }
  autosaveMaybe();
}

function autosaveMaybe() {
  if (!state.autosave) return;
  const serial = {
    ...state,
    flagged: Array.from(state.flagged)
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serial));
}

function loadAutosave() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);

    // minimal restore
    state.mode = saved.mode || "exam";
    state.autosave = saved.autosave ?? true;
    state.theme = saved.theme || "dark";
    state.questions = saved.questions || [];
    state.current = saved.current || 0;
    state.answers = saved.answers || {};
    state.validated = saved.validated || {};
    state.flagged = new Set(saved.flagged || []);
    state.finished = saved.finished || false;

    return Array.isArray(state.questions) && state.questions.length > 0;
  } catch {
    return false;
  }
}

function resetAll(confirmUser=true) {
  stopExamTimer();
  if (confirmUser && !confirm("Tout réinitialiser (QCM + réponses) ?")) return;
  state.questions = [];
  state.current = 0;
  state.answers = {};
  state.validated = {};
  state.flagged = new Set();
  state.finished = false;
  localStorage.removeItem(STORAGE_KEY);
  goStep("setup");
  renderSetup();
}

function goStep(step) {
  // step buttons
  document.querySelectorAll(".step").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.step === step);
  });

  // views
  $("view-setup").classList.toggle("hidden", step !== "setup");
  $("view-quiz").classList.toggle("hidden", step !== "quiz");
  $("view-results").classList.toggle("hidden", step !== "results");

  if (step === "quiz") {
    renderQuiz();
    startExamTimer();
  }
  if (step === "results") {
    stopExamTimer();
    renderResults();
  }
}

function validateQuestion(q, idx) {
  const baseErr = (msg) => `Question ${idx+1}: ${msg}`;
  if (!q || typeof q !== "object") throw new Error(baseErr("objet invalide"));

  if (!["multi","tf"].includes(q.type)) throw new Error(baseErr("type doit être 'multi' ou 'tf'"));
  if (typeof q.question !== "string" || q.question.trim().length < 5) throw new Error(baseErr("question trop courte"));
  if (typeof q.explanation !== "string") q.explanation = "";

  // optional evidence
  if (q.evidence !== undefined) {
    if (!Array.isArray(q.evidence)) throw new Error(baseErr("evidence doit être un tableau si présent"));
    q.evidence.forEach((ev, i) => {
      if (typeof ev !== "object") throw new Error(baseErr(`evidence[${i}] invalide`));
      if (typeof ev.page !== "number") throw new Error(baseErr(`evidence[${i}].page doit être un nombre`));
      if (typeof ev.excerpt !== "string") throw new Error(baseErr(`evidence[${i}].excerpt doit être une chaîne`));
    });
  }

  const mustPrefix = ["A ","B ","C ","D ","E "];

  if (q.type === "multi") {
    if (!Array.isArray(q.options) || q.options.length !== 5) throw new Error(baseErr("options doit contenir 5 éléments"));
    q.options.forEach((s, i) => {
      if (typeof s !== "string") throw new Error(baseErr("options doivent être des chaînes"));
      if (!s.startsWith(mustPrefix[i])) throw new Error(baseErr(`options[${i}] doit commencer par "${mustPrefix[i]}"`));
    });
    if (!Array.isArray(q.answer_indices) || q.answer_indices.length < 1 || q.answer_indices.length > 5) {
      throw new Error(baseErr("answer_indices doit contenir 1 à 5 indices"));
    }
    const set = new Set(q.answer_indices);
    if (set.size !== q.answer_indices.length) throw new Error(baseErr("answer_indices contient des doublons"));
    q.answer_indices.forEach(n => {
      if (!Number.isInteger(n) || n < 0 || n > 4) throw new Error(baseErr("answer_indices doit être entre 0 et 4"));
    });
  } else {
    if (!Array.isArray(q.items) || q.items.length !== 5) throw new Error(baseErr("items doit contenir 5 éléments"));
    q.items.forEach((s, i) => {
      if (typeof s !== "string") throw new Error(baseErr("items doivent être des chaînes"));
      if (!s.startsWith(mustPrefix[i])) throw new Error(baseErr(`items[${i}] doit commencer par "${mustPrefix[i]}"`));
    });
    if (!Array.isArray(q.truth) || q.truth.length !== 5) throw new Error(baseErr("truth doit contenir 5 booléens"));
    q.truth.forEach(b => {
      if (typeof b !== "boolean") throw new Error(baseErr("truth doit contenir des booléens"));
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
    setMsg(setupMsg, "err", "JSON invalide : impossible à parser. Vérifie les crochets, virgules, guillemets.");
    return false;
  }

  if (!Array.isArray(data) || data.length === 0) {
    setMsg(setupMsg, "err", "Le JSON doit être un tableau non vide de questions.");
    return false;
  }

  try {
    const validated = data.map((q,i) => validateQuestion(q,i));
    state.questions = validated;
    state.current = 0;
    state.answers = {};
    state.validated = {};
    state.flagged = new Set();
    state.finished = false;
    autosaveMaybe();
    setMsg(setupMsg, "ok", `✅ QCM chargé : ${validated.length} questions. Tu peux démarrer.`);
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
  $("promptBox").textContent = PROMPT_TEXT;

  // segmented mode
  document.querySelectorAll(".seg").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === state.mode);
  });

  $("autosaveToggle").checked = state.autosave;
  if (state.theme === "light") setTheme("light"); else setTheme("dark");

  if (state.questions.length) {
    setMsg($("setupMsg"), "ok", `✅ QCM en mémoire : ${state.questions.length} questions. Tu peux aller à l’étape 2.`);
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
  $("progressText").textContent = `Question ${idx+1}/${n} — Validées: ${doneCount}/${n}`;
}

function renderQuiz() {
  if (!state.questions.length) {
    goStep("setup");
    return;
  }

  const q = state.questions[state.current];
  const idx = state.current;

  $("quizMeta").textContent = `Mode: ${state.mode === "exam" ? "Examen" : "Entraînement"} • ${state.questions.length} questions`;

  renderProgress();

  const isFlagged = state.flagged.has(idx);
  $("btnFlag").style.borderColor = isFlagged ? "rgba(255,204,102,.65)" : "";
  $("btnFlag").textContent = isFlagged ? "⭐ Marquée" : "⭐ À revoir";

  const card = $("questionCard");
  card.innerHTML = "";

  const title = document.createElement("div");
  title.className = "q-title";
  title.textContent = q.question;
  card.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "q-meta";
  meta.textContent = q.type === "multi" ? "QCM multi-réponses (A→E)" : "Vrai/Faux par items (A→E)";
  card.appendChild(meta);

  // previous saved answer
  const saved = state.answers[idx];

  if (q.type === "multi") {
    const chosen = new Set(saved?.payload?.indices || []);

    q.options.forEach((opt, i) => {
      const row = document.createElement("label");
      row.className = "choice";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = chosen.has(i);
      cb.addEventListener("change", () => {
        const cur = getCurrentAnswerPayload();
        state.answers[idx] = { type: "multi", payload: cur };
        autosaveMaybe();
      });

      const txt = document.createElement("div");
      txt.textContent = opt;

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
        autosaveMaybe();
        renderQuiz(); // re-render to update pills
      });

      const pillF = document.createElement("button");
      pillF.type = "button";
      pillF.className = "pill" + (savedTruth[i] === false ? " active" : "");
      pillF.textContent = "Faux";
      pillF.addEventListener("click", () => {
        savedTruth[i] = false;
        state.answers[idx] = { type: "tf", payload: { truth: savedTruth } };
        autosaveMaybe();
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
    setMsg($("quizMsg"), v.errors === 0 ? "ok" : (v.errors <= 2 ? "warn" : "err"),
      `Correction : erreurs=${v.errors}, score=${v.score}. Va aux résultats pour le détail.`);
  }

  $("btnPrev").disabled = idx === 0;
  $("btnNext").disabled = idx === state.questions.length - 1;
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
      setMsg(quizMsg, "warn", "Il manque des réponses (Vrai/Faux) sur au moins un item.");
      autosaveMaybe();
      return;
    }
    result = scoreTF(q, truth);
  }

  state.validated[idx] = result;
  autosaveMaybe();

  if (state.mode === "train") {
    const t = result.errors === 0 ? "ok" : (result.errors <= 2 ? "warn" : "err");
    setMsg(quizMsg, t, `✅ Validé — erreurs=${result.errors} — score=${result.score}`);
  } else {
    setMsg(quizMsg, "ok", "✅ Réponse enregistrée. (Correction complète à la fin — mode Examen)");
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
  return { mean, note20, done, flagged: state.flagged.size };
}

function format1(x) {
  return (Math.round(x * 10) / 10).toFixed(1);
}

function renderResults(filter="all") {
  if (!state.questions.length) {
    goStep("setup");
    return;
  }

  const metrics = computeFinalMetrics();
  $("metricMean").textContent = metrics.mean.toFixed(2);
  $("metric20").textContent = format1(metrics.note20);
  $("metricDone").textContent = `${metrics.done}/${state.questions.length}`;
  $("metricFlag").textContent = `${metrics.flagged}`;

  const list = $("resultsList");
  list.innerHTML = "";

  for (let i=0;i<state.questions.length;i++){
    const q = state.questions[i];
    const v = state.validated[i];
    const isFlag = state.flagged.has(i);

    const score = v ? v.score : 0.0;
    const errors = v ? v.errors : null;

    const isWrong = v ? (v.errors >= 1) : true; // non validé = considéré erreur
    const shouldShow =
      filter === "all" ||
      (filter === "wrong" && isWrong) ||
      (filter === "flag" && isFlag);

    if (!shouldShow) continue;

    const item = document.createElement("div");
    item.className = "result-item";

    const head = document.createElement("div");
    head.className = "result-head";

    const left = document.createElement("div");
    left.innerHTML = `<div class="result-title">Q${i+1} — ${q.type === "multi" ? "Multi" : "V/F"}</div>
                      <div class="muted">${escapeHtml(q.question)}</div>`;

    const tags = document.createElement("div");
    tags.className = "result-tags";

    const tagScore = document.createElement("span");
    const tagType = document.createElement("span");
    const tagFlag = document.createElement("span");

    tagScore.className = "tag " + (score === 1.0 ? "ok" : (score >= 0.2 ? "warn" : "bad"));
    tagScore.textContent = `score ${score}`;

    tagType.className = "tag";
    tagType.textContent = errors === null ? "non validée" : `${errors} erreur(s)`;

    tagFlag.className = "tag" + (isFlag ? " warn" : "");
    tagFlag.textContent = isFlag ? "⭐" : "";

    tags.appendChild(tagScore);
    tags.appendChild(tagType);
    if (isFlag) tags.appendChild(tagFlag);

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

  autosaveMaybe();
}

function buildCorrectionBlock(i) {
  const q = state.questions[i];
  const box = document.createElement("div");

  // answer from user
  const user = state.answers[i]?.payload;

  const pre = document.createElement("pre");

  if (q.type === "multi") {
    const correct = new Set(q.answer_indices);
    const userSet = new Set(user?.indices || []);

    let lines = [];
    for (let k=0;k<5;k++){
      const opt = q.options[k];
      const isC = correct.has(k);
      const isU = userSet.has(k);

      if (isC && isU) lines.push(`✅ ${opt}`);
      else if (isC && !isU) lines.push(`⚠️ (oublié) ${opt}`);
      else if (!isC && isU) lines.push(`❌ ${opt}`);
      else lines.push(`• ${opt}`);
    }

    pre.textContent = lines.join("\n");
  } else {
    const truth = q.truth;
    const u = user?.truth || [null,null,null,null,null];

    let lines = [];
    for (let k=0;k<5;k++){
      const item = q.items[k];
      const expected = truth[k] ? "Vrai" : "Faux";
      const got = (u[k] === null || u[k] === undefined) ? "—" : (u[k] ? "Vrai" : "Faux");

      if (got === "—") lines.push(`⚠️ (non répondu) ${item} — attendu: ${expected}`);
      else if ((u[k] === truth[k])) lines.push(`✅ ${item} — ${got}`);
      else lines.push(`❌ ${item} — ${got} (attendu: ${expected})`);
    }
    pre.textContent = lines.join("\n");
  }

  const exp = document.createElement("div");
  exp.style.marginTop = "10px";
  exp.innerHTML = `<div class="muted" style="font-weight:800;margin-bottom:6px;">Explication</div>
                   <div>${escapeHtml(q.explanation || "—")}</div>`;

  box.appendChild(pre);
  box.appendChild(exp);

  if (Array.isArray(q.evidence) && q.evidence.length) {
    const evTitle = document.createElement("div");
    evTitle.style.marginTop = "12px";
    evTitle.innerHTML = `<div class="muted" style="font-weight:800;margin-bottom:6px;">Preuves (cours)</div>`;
    box.appendChild(evTitle);

    q.evidence.slice(0,3).forEach(ev => {
      const evBox = document.createElement("pre");
      evBox.textContent = `Page ${ev.page}:\n${ev.excerpt}`;
      box.appendChild(evBox);
    });
  }

  return box;
}

function showModal(title, bodyNode) {
  $("modalTitle").textContent = title;
  const mb = $("modalBody");
  mb.innerHTML = "";
  mb.appendChild(bodyNode);
  $("modal").classList.remove("hidden");
}

function hideModal() {
  $("modal").classList.add("hidden");
}

function openQuestionGrid() {
  const wrap = document.createElement("div");
  wrap.className = "qgrid";

  for (let i=0;i<state.questions.length;i++){
    const btn = document.createElement("button");
    btn.className = "qbtn";
    btn.textContent = (i+1);

    if (state.validated[i]) btn.classList.add("done");
    if (state.flagged.has(i)) btn.classList.add("flag");
    if (i === state.current) btn.classList.add("current");

    btn.addEventListener("click", () => {
      state.current = i;
      autosaveMaybe();
      hideModal();
      goStep("quiz");
    });

    wrap.appendChild(btn);
  }

  showModal("Aller à une question", wrap);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// -----------------------------
// Demo JSON
// -----------------------------
const DEMO = [
  {
    "type": "multi",
    "question": "Parmi les propositions suivantes concernant le barème LAS, lesquelles sont correctes ?",
    "options": [
      "A 0 erreur donne 1.0 point.",
      "B 1 erreur donne 0.5 point.",
      "C 2 erreurs donnent 0.2 point.",
      "D 3 erreurs donnent 0.2 point.",
      "E ≥3 erreurs donnent 0.0 point."
    ],
    "answer_indices": [0,1,2,4],
    "explanation": "Le barème LAS attribue 1.0 / 0.5 / 0.2 / 0.0 selon le nombre d’erreurs.",
    "evidence": [{"page": 1, "excerpt": "Nombre d’erreurs: 0→1.0 ; 1→0.5 ; 2→0.2 ; ≥3→0.0"}]
  },
  {
    "type": "tf",
    "question": "Concernant la structure des questions, chaque item A→E doit être présent.",
    "items": [
      "A Une question multi comporte 5 propositions A→E.",
      "B Une question multi peut avoir 1 à 5 bonnes réponses.",
      "C Une question V/F a 5 items A→E.",
      "D La plateforme accepte moins de 5 items pour V/F.",
      "E Le format impose une réponse JSON stricte."
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
  // theme default
  const restored = loadAutosave();
  setTheme(state.theme || "dark");

  // set prompt
  $("promptBox").textContent = PROMPT_TEXT;

  // restore UI
  renderSetup();

  if (restored) {
    setMsg($("setupMsg"), "ok", `✅ Reprise auto : ${state.questions.length} questions en mémoire.`);
  }

  // steps nav
  document.querySelectorAll(".step").forEach(btn => {
    btn.addEventListener("click", () => {
      const step = btn.dataset.step;
      if (step !== "setup" && !state.questions.length) return goStep("setup");
      goStep(step);
    });
  });

  // segmented mode
  document.querySelectorAll(".seg").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".seg").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.mode = btn.dataset.mode;
      autosaveMaybe();
      setMsg($("setupMsg"), "ok", `Mode réglé sur : ${state.mode === "exam" ? "Examen" : "Entraînement"}.`);
    });
  });

  // autosave toggle
  $("autosaveToggle").addEventListener("change", (e) => {
    state.autosave = e.target.checked;
    if (!state.autosave) localStorage.removeItem(STORAGE_KEY);
    else autosaveMaybe();
  });

  // copy prompt
  $("btnCopyPrompt").addEventListener("click", async () => {
    await navigator.clipboard.writeText(PROMPT_TEXT);
    setMsg($("setupMsg"), "ok", "✅ Prompt copié. Colle-le dans ChatGPT.");
  });

  // load JSON from textarea
  $("btnLoadJson").addEventListener("click", () => {
    const ok = loadQuestionsFromJsonText($("jsonInput").value.trim());
    if (ok) goStep("quiz");
  });

  // demo
  $("btnDemo").addEventListener("click", () => {
    $("jsonInput").value = JSON.stringify(DEMO, null, 2);
    const ok = loadQuestionsFromJsonText($("jsonInput").value);
    if (ok) goStep("quiz");
  });

  // import file
  $("fileInput").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    $("jsonInput").value = text;
    const ok = loadQuestionsFromJsonText(text);
    if (ok) goStep("quiz");
  });

  // quiz buttons
  $("btnPrev").addEventListener("click", () => {
    if (state.current > 0) state.current--;
    autosaveMaybe();
    renderQuiz();
  });
  $("btnNext").addEventListener("click", () => {
    if (state.current < state.questions.length - 1) state.current++;
    autosaveMaybe();
    renderQuiz();
  });
  $("btnValidate").addEventListener("click", () => {
    validateCurrent();
    autosaveMaybe();
    renderQuiz();
  });
  $("btnFinish").addEventListener("click", () => {
    stopExamTimer();
    state.finished = true;
    autosaveMaybe();
    goStep("results");
  });

  $("btnFlag").addEventListener("click", () => {
    const i = state.current;
    if (state.flagged.has(i)) state.flagged.delete(i);
    else state.flagged.add(i);
    autosaveMaybe();
    renderQuiz();
  });

  $("btnReview").addEventListener("click", () => openQuestionGrid());

  // modal close
  $("modalClose").addEventListener("click", hideModal);
  $("modal").addEventListener("click", (e) => {
    if (e.target === $("modal")) hideModal();
  });

  // results filters
  $("btnShowAll").addEventListener("click", () => renderResults("all"));
  $("btnShowWrong").addEventListener("click", () => renderResults("wrong"));
  $("btnShowFlag").addEventListener("click", () => renderResults("flag"));

  // export results
  $("btnExportResults").addEventListener("click", () => {
    const payload = {
      generated_at: new Date().toISOString(),
      mode: state.mode,
      metrics: computeFinalMetrics(),
      questions: state.questions,
      answers: state.answers,
      validated: state.validated,
      flagged: Array.from(state.flagged)
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "resultats_qcm_las.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("btnBackToSetup").addEventListener("click", () => goStep("setup"));

  // theme toggle
  $("btnTheme").addEventListener("click", () => {
    setTheme(state.theme === "light" ? "dark" : "light");
  });

  // reset
  $("btnResetAll").addEventListener("click", () => resetAll(true));
    // FIX: fermer la modale quoi qu'il arrive au chargement
  hideModal();

  // FIX: touche Échap pour fermer la modale si elle s'affiche
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideModal();
  });
}

init();
