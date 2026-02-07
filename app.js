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

function clampTimerPerQuestionCount(count) {
  if (!Number.isFinite(count)) return 90;
  const n = Math.floor(count);
  return Math.min(200, Math.max(5, n));
}

function bindQcmSettingsControls(container) {
  if (!container) return;

  const segWrap = container.querySelector(".segmented");
  const segButtons = Array.from(container.querySelectorAll(".seg"));
  const setSegIndex = (mode) => {
    if (!segWrap) return;
    const idx = mode === "train" ? 1 : 0;
    segWrap.style.setProperty("--seg-index", String(idx));
  };
  setSegIndex(state.mode);
  segButtons.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === state.mode);
    btn.addEventListener("click", () => {
      segButtons.forEach(b => b.classList.remove("active"));
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

  const timerToggleEl = container.querySelector("#timerToggle");
  if (timerToggleEl) {
    timerToggleEl.checked = !!state.timerEnabled;
    timerToggleEl.addEventListener("change", (e) => {
      state.timerEnabled = e.target.checked;
      if (!state.timerEnabled) {
        stopTimer();
      } else if (state.mode === "exam" && !$("view-quiz").classList.contains("hidden")) {
        startTimer();
      }
      updateTimerDisplay();
    });
  }

  const timerPerQuestionEl = container.querySelector("#timerPerQuestion");
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
    timerPerQuestionEl.value = String(state.timerPerQuestion || 90);
    timerPerQuestionEl.addEventListener("input", (e) => {
      applyTimerPerQuestion(e.target.value, false);
    });
    timerPerQuestionEl.addEventListener("blur", (e) => {
      applyTimerPerQuestion(e.target.value, true);
    });
  }

  const setupSelectMenuScoped = (wrapId, toggleId, menuId, onPick) => {
    const wrap = container.querySelector(`#${wrapId}`);
    const toggle = container.querySelector(`#${toggleId}`);
    const menu = container.querySelector(`#${menuId}`);
    if (!wrap || !toggle || !menu) return;
    if (wrap.dataset.bound === "1") return;
    wrap.dataset.bound = "1";
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
    const onDocClick = (e) => {
      if (!wrap.isConnected) {
        document.removeEventListener("click", onDocClick);
        return;
      }
      if (!e.target.closest(`#${wrapId}`)) closeMenu();
    };
    document.addEventListener("click", onDocClick);
  };

  setupSelectMenuScoped("timerPerQuestionWrap", "timerPerQuestionToggle", "timerPerQuestionMenu", (v) => {
    const next = clampTimerPerQuestionCount(v);
    if (timerPerQuestionEl) {
      timerPerQuestionEl.value = String(next);
      applyTimerPerQuestion(String(next), true);
    }
  });
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
  const normalizedDifficulty = normalizeDifficulty(q.difficulty);
  if (!normalizedDifficulty) {
    throw new Error(baseErr("difficulty doit etre 'facile', 'moyen' ou 'difficile'"));
  }
  q.difficulty = normalizedDifficulty;
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
  const ensurePrefixes = (items) => {
    const labels = ["A", "B", "C", "D", "E"];
    return items.map((raw, i) => {
      const value = typeof raw === "string" ? raw.trim() : String(raw ?? "");
      const label = labels[i] || String(i + 1);
      const stripped = value.replace(/^[A-E]\s+/i, "").trim();
      return `${label} ${stripped}`;
    });
  };
  const stripItemPrefix = (value) => String(value ?? "").trim().replace(/^[A-E]\s+/i, "").trim();
  const isLikelyBogusTfItem = (value) => {
    const text = stripItemPrefix(value);
    if (!text) return true;
    const lower = text.toLowerCase();
    if (/^(vrai|faux|true|false)(\s*[\).,;:!?'"]*)?$/.test(lower)) return true;
    const badKeys = [
      "truth",
      "explanation",
      "evidence",
      "answer_indices",
      "options",
      "items",
      "difficulty",
      "question",
      "type",
      "note"
    ];
    const badPattern = new RegExp(`^(${badKeys.join("|")})(\\s*[:\\[{,]|$)`);
    if (badPattern.test(lower)) return true;
    return false;
  };

  if (q.type === "multi") {
    if (!Array.isArray(q.options) || q.options.length !== 5) throw new Error(baseErr("options doit contenir 5 elements"));
    q.options = ensurePrefixes(q.options);
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
    q.items = ensurePrefixes(q.items);
    q.items.forEach((s, i) => {
      if (typeof s !== "string") throw new Error(baseErr("items doivent etre des chaines"));
      if (!s.startsWith(mustPrefix[i])) throw new Error(baseErr(`items[${i}] doit commencer par "${mustPrefix[i]}"`));
      if (isLikelyBogusTfItem(s)) throw new Error(baseErr(`items[${i}] semble invalide (ex: "Vrai/Faux" ou champ JSON)`));
    });
    if (!Array.isArray(q.truth) || q.truth.length !== 5) throw new Error(baseErr("truth doit contenir 5 booleens"));
    q.truth.forEach(b => {
      if (typeof b !== "boolean") throw new Error(baseErr("truth doit contenir des booleens"));
    });
  }

  return q;
}

function filterValidQuestions(list) {
  const questions = Array.isArray(list) ? list : [];
  const cleaned = [];
  let dropped = 0;
  questions.forEach((q, i) => {
    try {
      cleaned.push(validateQuestion(q, i));
    } catch (err) {
      dropped += 1;
      console.warn("Question invalide ignoree:", err);
    }
  });
  return { questions: cleaned, dropped };
}

function normalizeDifficulty(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  const cleaned = raw
    .replace(/[éèêë]/g, "e")
    .replace(/[àâä]/g, "a")
    .replace(/[îï]/g, "i")
    .replace(/[ôö]/g, "o")
    .replace(/[ùûü]/g, "u")
    .replace(/[^a-z0-9]/g, "");
  if (["facile","easy","simple","debutant","debut"].includes(cleaned)) return "facile";
  if (["moyen","moyenne","medium","intermediaire","intermediate","mid"].includes(cleaned)) return "moyen";
  if (["difficile","hard","difficult","avance"].includes(cleaned)) return "difficile";
  if (cleaned === "1") return "facile";
  if (cleaned === "2") return "moyen";
  if (cleaned === "3") return "difficile";
  return null;
}

function calcLasScore(errors) {
  if (errors === 0) return 1.0;
  if (errors === 1) return 0.5;
  if (errors === 2) return 0.2;
  return 0.0;
}

function stripTfPrefix(value) {
  return String(value ?? "").trim().replace(/^[A-E]\s+/i, "").trim();
}

function isTrueToken(value) {
  const v = stripTfPrefix(value).toLowerCase();
  return v === "vrai" || v === "true";
}

function isFalseToken(value) {
  const v = stripTfPrefix(value).toLowerCase();
  return v === "faux" || v === "false";
}

function getTfMode(q) {
  if (!q || !Array.isArray(q.items)) return "multi";
  const items = q.items.map(stripTfPrefix).filter(Boolean);
  const vfCount = items.filter((t) => {
    const l = t.toLowerCase();
    return l === "vrai" || l === "faux" || l === "true" || l === "false";
  }).length;
  const nonVfCount = items.length - vfCount;
  if (vfCount >= 2 && nonVfCount === 0) return "single";
  return "multi";
}

function getTfThemeFromItems(q) {
  if (!q || !Array.isArray(q.items)) return "";
  const items = q.items.map(stripTfPrefix).filter(Boolean);
  if (items.length < 2) return "";
  const wordsList = items.map((text) => text.split(/\s+/).filter(Boolean));
  const minLen = Math.min(...wordsList.map((w) => w.length));
  if (!Number.isFinite(minLen) || minLen <= 0) return "";

  const normalizeWord = (word) =>
    String(word || "")
      .toLowerCase()
      .replace(/[’'"]/g, "")
      .replace(/[.,;:!?]+$/g, "");

  const prefix = [];
  for (let i = 0; i < minLen; i++) {
    const token = normalizeWord(wordsList[0][i]);
    if (!token) break;
    const matches = wordsList.every((w) => normalizeWord(w[i]) === token);
    if (!matches) break;
    prefix.push(wordsList[0][i]);
  }

  let candidate = prefix.join(" ").trim();
  if (!candidate) return "";
  candidate = candidate.replace(/[.,;:!?]+$/g, "").trim();
  if (candidate.length < 3) return "";

  const stop = new Set([
    "le","la","les","l","de","des","du","un","une","au","aux","en","et","d","a"
  ]);
  const wordsLower = candidate
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const meaningful = wordsLower.some((w) => !stop.has(w));
  if (!meaningful) return "";

  return candidate;
}

function getQuestionTitle(q) {
  if (!q || typeof q !== "object") return "";
  if (q.type !== "tf") return q.question || "";
  const tfMode = getTfMode(q);
  if (tfMode !== "multi") return q.question || "";
  const theme = getTfThemeFromItems(q);
  if (theme) return theme;
  return q.question || "";
}

function getTfSingleExpectedTruth(q) {
  if (!q || !Array.isArray(q.items) || !Array.isArray(q.truth)) return null;
  const items = q.items.map(stripTfPrefix);
  const truth = q.truth;
  let idx = items.findIndex(isTrueToken);
  if (idx >= 0) return !!truth[idx];
  idx = items.findIndex(isFalseToken);
  if (idx >= 0) return !truth[idx];
  return null;
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

function scoreTfSingle(q, userTruthValue) {
  const expected = getTfSingleExpectedTruth(q);
  if (expected === null) return { score: 0, errors: 1 };
  const ok = userTruthValue === expected;
  return { score: calcLasScore(ok ? 0 : 1), errors: ok ? 0 : 1 };
}

function renderSetup() {
  // segmented mode
  document.querySelectorAll(".seg").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === state.mode);
  });

  setAccent(state.accent || "rosesalmon");
  const timerToggle = $("timerToggle");
  if (timerToggle) timerToggle.checked = state.timerEnabled;
  const timerPerQuestion = $("timerPerQuestion");
  if (timerPerQuestion) timerPerQuestion.value = String(state.timerPerQuestion || 90);
  if (state.theme === "light") setTheme("light"); else setTheme("dark");
  updateTimerDisplay();

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
  titleEl.textContent = getQuestionTitle(q);
  card.appendChild(titleEl);

  const meta = document.createElement("div");
  meta.className = "q-meta";
  if (q.type === "multi") {
    meta.textContent = "QCM";
  } else {
    const tfMode = getTfMode(q);
    meta.textContent = tfMode === "single" ? "Vrai/Faux" : "Vrai/Faux par items (A->E)";
  }
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
    const tfMode = getTfMode(q);

    if (tfMode === "single") {
      const row = document.createElement("div");
      row.className = "tf-row";

      const it = document.createElement("div");
      it.className = "item";
      it.textContent = "Réponse";

      const pillV = document.createElement("button");
      pillV.type = "button";
      pillV.className = "pill" + (savedTruth[0] === true ? " active" : "");
      pillV.textContent = "Vrai";
      pillV.addEventListener("click", () => {
        savedTruth[0] = true;
        state.answers[idx] = { type: "tf", payload: { truth: savedTruth } };
        renderQuiz(); // re-render to update pills
      });

      const pillF = document.createElement("button");
      pillF.type = "button";
      pillF.className = "pill" + (savedTruth[0] === false ? " active" : "");
      pillF.textContent = "Faux";
      pillF.addEventListener("click", () => {
        savedTruth[0] = false;
        state.answers[idx] = { type: "tf", payload: { truth: savedTruth } };
        renderQuiz();
      });

      row.appendChild(it);
      row.appendChild(pillV);
      row.appendChild(pillF);
      card.appendChild(row);
    } else {
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
    const tfMode = getTfMode(q);
    if (tfMode === "single") {
      if (truth[0] === null || truth[0] === undefined) {
        setMsg(quizMsg, "warn", "Il manque la reponse Vrai/Faux.");
        return;
      }
      result = scoreTfSingle(q, truth[0]);
    } else {
      // require all answered
      const missing = truth.filter(v => v === null || v === undefined).length;
      if (missing > 0) {
        setMsg(quizMsg, "warn", "Il manque des reponses (Vrai/Faux) sur au moins un item.");
        return;
      }
      result = scoreTF(q, truth);
    }
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
      const tfMode = getTfMode(q);
      if (tfMode === "single") {
        result = scoreTfSingle(q, truth[0]);
      } else {
        result = scoreTF(q, truth);
      }
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
    validated: state.validated
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
                      <div class="muted">${escapeHtml(getQuestionTitle(q))}</div>`;

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
// Events
// -----------------------------
function init() {
  setTheme(state.theme || "light");
  setAccent(state.accent || "rosesalmon");

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
  const btnToggleMatieres = $("btnToggleMatieres");
  const matList = $("sideMatieresList");
  const storedMat = localStorage.getItem("qcm_matieres_collapsed");
  if (storedMat === "1") {
    matList?.classList.add("collapsed");
    if (btnToggleMatieres) btnToggleMatieres.classList.remove("open");
  } else {
    if (btnToggleMatieres) btnToggleMatieres.classList.add("open");
  }
  if (btnToggleMatieres) {
    btnToggleMatieres.addEventListener("click", () => {
      const isCollapsed = matList?.classList.toggle("collapsed");
      btnToggleMatieres.classList.toggle("open", !isCollapsed);
      localStorage.setItem("qcm_matieres_collapsed", isCollapsed ? "1" : "0");
    });
  }
  const openNameModal = (title, placeholder, onSubmit, opts = {}) => {
    const wrap = document.createElement("div");
    wrap.className = "auth-card";

    const row = document.createElement("div");
    row.className = "auth-row";
    row.innerHTML = `
      <label class="label">${title}</label>
      <input id="modalNameInput" class="input" type="text" placeholder="${placeholder}" />
    `;
    wrap.appendChild(row);

    let chapterInput = null;
    if (opts.showChapter) {
      const chapterRow = document.createElement("div");
      chapterRow.className = "auth-row";
      const chapterPlaceholder = opts.chapterPlaceholder || "Ex: Chapitre 1";
      chapterRow.innerHTML = `
        <label class="label">Chapitre</label>
        <input id="modalChapterInput" class="input" type="text" placeholder="${chapterPlaceholder}" />
      `;
      wrap.appendChild(chapterRow);
      chapterInput = chapterRow.querySelector("#modalChapterInput");
    }

    let pickedColor = null;
    if (opts.showColor) {
      const colorRow = document.createElement("div");
      colorRow.className = "auth-row color-row";
      const defaultColor = opts.defaultColor || "#6b9df5";
      pickedColor = defaultColor;
      const palette = Array.isArray(window.MATIERE_PALETTE) && window.MATIERE_PALETTE.length
        ? window.MATIERE_PALETTE
        : [defaultColor];
      colorRow.innerHTML = `
        <label class="label">Couleur</label>
        <div class="color-picker compact">
          <span class="color-swatch" style="--pick-color:${defaultColor}"></span>
          <span class="color-triangle" aria-hidden="true"></span>
        </div>
        <div class="modal-palette hidden"></div>
      `;
      wrap.appendChild(colorRow);
      const paletteEl = colorRow.querySelector(".modal-palette");
      if (paletteEl) {
        palette.forEach((hex) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "palette-color";
          btn.style.background = hex;
          btn.setAttribute("aria-label", `Choisir ${hex}`);
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            pickedColor = hex;
            const swatch = colorRow.querySelector(".color-swatch");
            if (swatch) swatch.style.setProperty("--pick-color", hex);
            paletteEl.classList.add("hidden");
          });
          paletteEl.appendChild(btn);
        });
      }
      const picker = colorRow.querySelector(".color-picker");
      if (picker && paletteEl) {
        picker.addEventListener("click", (e) => {
          e.stopPropagation();
          paletteEl.classList.toggle("hidden");
        });
      }
    }

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
      const chapterValue = chapterInput ? (chapterInput.value || "").trim() : "";
      if (opts.showChapter && !chapterValue) {
        return setMsg($("modalNameMsg"), "warn", "Chapitre manquant.");
      }
      const picked = pickedColor || null;
      await onSubmit(value, picked, chapterValue);
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
    openNameModal("Nouvelle matière", "Ex: Physiologie", async (name, color, chapterName) => {
      await createMatiere(name, color, chapterName);
    }, { showColor: true, defaultColor: "#6b9df5", showChapter: true, chapterPlaceholder: "Ex: Chapitre 1" });
  });
  const btnAddChapitre = $("btnAddChapitre");
  const btnToggleChapitres = $("btnToggleChapitres");
  const chapList = $("sideChapitresList");
  const storedChap = localStorage.getItem("qcm_chapitres_collapsed");
  if (storedChap === "1") {
    chapList?.classList.add("collapsed");
    if (btnToggleChapitres) btnToggleChapitres.classList.remove("open");
  } else {
    if (btnToggleChapitres) btnToggleChapitres.classList.add("open");
  }
  if (btnToggleChapitres) {
    btnToggleChapitres.addEventListener("click", () => {
      const isCollapsed = chapList?.classList.toggle("collapsed");
      btnToggleChapitres.classList.toggle("open", !isCollapsed);
      localStorage.setItem("qcm_chapitres_collapsed", isCollapsed ? "1" : "0");
    });
  }
  if (btnAddChapitre) btnAddChapitre.addEventListener("click", async () => {
    if (!currentMatiereId) return setMsg($("chapitreMsg"), "warn", "Selectionne une matière.");
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

  setupSelectMenu("qcmCountWrap", "qcmCountToggle", "qcmCountMenu", (v) => {
    const next = Math.min(20, Math.max(1, Math.floor(v)));
    const qcmCountEl = $("qcmQuestionCount");
    if (qcmCountEl) {
      qcmCountEl.value = String(next);
      qcmCountEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });

  // import cards (right panel)
  const qcmView = $("qcmView");
  const cardPlaceholder = $("cardPlaceholder");
  const cardPlaceholderTitle = $("cardPlaceholderTitle");
  const cardPlaceholderText = $("cardPlaceholderText");
  const setInputMode = (mode) => {
    document.querySelectorAll("#importCards .mode-card").forEach(c => {
      c.classList.toggle("active", c.dataset.view === mode);
    });
    if (mode === "qcm") {
      qcmView?.classList.remove("hidden");
      cardPlaceholder?.classList.add("hidden");
    } else {
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
  setInputMode("qcm");
  const setCardsEnabled = (enabled) => {
    document.querySelectorAll("#importCards .mode-card").forEach(card => {
      card.classList.toggle("disabled", !enabled);
      card.disabled = !enabled;
    });
    if (!enabled) setInputMode("qcm");
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
  const btnUnlockQcm = $("btnUnlockQcm");
  const qcmCountInput = $("qcmQuestionCount");
  const clampQcmCount = () => {
    if (!qcmCountInput) return;
    const raw = parseInt(qcmCountInput.value || "1", 10);
    const value = Number.isFinite(raw) ? Math.min(20, Math.max(1, raw)) : 20;
    qcmCountInput.value = String(value);
    if (btnUnlockQcm) {
      btnUnlockQcm.textContent = `Obtenir ${value} question${value > 1 ? "s" : ""}`;
    }
  };
  if (qcmCountInput) {
    qcmCountInput.addEventListener("input", clampQcmCount);
    qcmCountInput.addEventListener("blur", clampQcmCount);
  }
  clampQcmCount();
  if (btnGenerateQcm) btnGenerateQcm.addEventListener("click", async () => {
    clampQcmCount();
    const count = 20;
    const msg = $("qcmMsg");
    if (msg) clearMsg(msg);
    if (typeof window.generateQcmFromSelectedPdf !== "function") {
      if (msg) setMsg(msg, "err", "Fonction QCM indisponible.");
      return;
    }
    btnGenerateQcm.disabled = true;
    await window.generateQcmFromSelectedPdf({ count, statusEl: msg });
    if (typeof window.applyPdfGenerationBlock === "function") {
      window.applyPdfGenerationBlock();
      if (typeof window.isPdfGenerationBlockedForCurrentPdf === "function") {
        btnGenerateQcm.disabled = window.isPdfGenerationBlockedForCurrentPdf();
      } else {
        btnGenerateQcm.disabled = false;
      }
    } else {
      btnGenerateQcm.disabled = false;
    }
  });

  if (btnUnlockQcm) btnUnlockQcm.addEventListener("click", async () => {
    clampQcmCount();
    const countRaw = parseInt($("qcmQuestionCount")?.value || "1", 10);
    const count = Number.isFinite(countRaw) ? Math.min(20, Math.max(1, countRaw)) : 1;
    const msg = $("qcmMsg");
    if (msg) clearMsg(msg);
    if (typeof window.unlockQcmQuestions !== "function") {
      if (msg) setMsg(msg, "err", "Fonction indisponible.");
      return;
    }
    btnUnlockQcm.disabled = true;
    const res = await window.unlockQcmQuestions(count);
    btnUnlockQcm.disabled = false;
    if (!res.ok) {
      if (msg) setMsg(msg, "warn", res.message || "Impossible de débloquer.");
      return;
    }
    if (msg) setMsg(msg, "ok", `${res.unlocked} question(s) ajoutée(s) à la banque.`);
    if (typeof window.applyPdfGenerationBlock === "function") {
      window.applyPdfGenerationBlock();
    }
  });

  const confirmDanger = ({ title, warning, detail, confirmLabel }) => {
    return new Promise((resolve) => {
      const wrap = document.createElement("div");
      wrap.className = "confirm-card";

      const t = document.createElement("div");
      t.className = "confirm-title";
      t.textContent = title || "Confirmation";
      wrap.appendChild(t);

      const warn = document.createElement("div");
      warn.className = "confirm-warning";
      warn.innerHTML = `
        <div class="confirm-warning-title">Attention</div>
        <div>${warning || "Cette action est irreversible."}</div>
      `;
      wrap.appendChild(warn);

      if (detail) {
        const meta = document.createElement("div");
        meta.className = "confirm-meta";
        meta.textContent = detail;
        wrap.appendChild(meta);
      }

      const actions = document.createElement("div");
      actions.className = "confirm-actions";
      const btnCancel = document.createElement("button");
      btnCancel.className = "btn btn-ghost";
      btnCancel.textContent = "Annuler";
      const btnOk = document.createElement("button");
      btnOk.className = "btn btn-danger";
      btnOk.textContent = confirmLabel || "Supprimer";
      actions.appendChild(btnCancel);
      actions.appendChild(btnOk);
      wrap.appendChild(actions);

      let resolved = false;
      const finish = (value) => {
        if (resolved) return;
        resolved = true;
        hideModal();
        resolve(value);
      };
      btnCancel.addEventListener("click", () => finish(false));
      btnOk.addEventListener("click", () => finish(true));
      const modal = $("modal");
      if (modal) {
        const onBackdrop = (e) => {
          if (e.target === modal) finish(false);
        };
        modal.addEventListener("click", onBackdrop, { once: true });
      }
      showModal(title || "Confirmation", wrap);
    });
  };

  const btnManageQcmBank = $("btnManageQcmBank");
  if (btnManageQcmBank) btnManageQcmBank.addEventListener("click", async () => {
    const wrap = document.createElement("div");
    wrap.className = "qcm-bank";

    const head = document.createElement("div");
    head.className = "qcm-bank-head";
    head.innerHTML = `
      <div>
        <div class="qcm-bank-title">Banque de questions</div>
        <div class="muted">Gère et supprime les questions de ce chapitre.</div>
      </div>
      <div class="qcm-bank-actions">
        <button id="qcmBankSelectAll" class="btn btn-ghost">Tout sélectionner</button>
        <button id="qcmBankDelete" class="btn btn-danger" disabled>Supprimer</button>
        <button id="qcmBankReset" class="btn btn-secondary">Tout réinitialiser</button>
      </div>
    `;
    wrap.appendChild(head);

    const msg = document.createElement("div");
    msg.id = "qcmBankMsg";
    msg.className = "msg";
    wrap.appendChild(msg);

    const list = document.createElement("div");
    list.className = "qcm-bank-list";
    wrap.appendChild(list);

    showModal("Banque QCM", wrap);

    const stateSel = new Set();
    const btnSelectAll = () => $("qcmBankSelectAll");
    const btnDelete = () => $("qcmBankDelete");

    const updateActions = () => {
      if (btnDelete()) btnDelete().disabled = stateSel.size === 0;
      if (btnSelectAll()) {
        btnSelectAll().textContent = stateSel.size ? "Tout deselectionner" : "Tout sélectionner";
      }
    };

    const renderList = (rows) => {
      list.innerHTML = "";
      if (!rows.length) {
        const empty = document.createElement("div");
        empty.className = "qcm-bank-empty";
        empty.textContent = "Aucune question en banque pour ce chapitre.";
        list.appendChild(empty);
        return;
      }
      rows.forEach((row) => {
        const item = document.createElement("label");
        item.className = "qcm-bank-item";
        item.dataset.id = row.id;
        const checked = stateSel.has(row.id);
        item.innerHTML = `
          <input type="checkbox" class="qcm-bank-check" ${checked ? "checked" : ""} />
          <div class="qcm-bank-body">
            <div class="qcm-bank-question">${escapeHtml(row.question || "")}</div>
            <div class="qcm-bank-meta">
              <span class="qcm-pill">${row.difficulty || "moyen"}</span>
              <span class="qcm-pill">${row.type || "multi"}</span>
            </div>
          </div>
        `;
        const box = item.querySelector("input");
        box.addEventListener("change", () => {
          if (box.checked) stateSel.add(row.id);
          else stateSel.delete(row.id);
          updateActions();
        });
        list.appendChild(item);
      });
      updateActions();
    };

    const load = async () => {
      if (msg) clearMsg(msg);
      if (typeof window.fetchQcmBankList !== "function") {
        setMsg(msg, "err", "Fonction indisponible.");
        renderList([]);
        return;
      }
      const res = await window.fetchQcmBankList();
      if (!res.ok) {
        setMsg(msg, "warn", res.message || "Impossible de charger.");
        renderList([]);
        return;
      }
      renderList(res.data || []);
    };

    await load();

    btnSelectAll()?.addEventListener("click", () => {
      const rows = Array.from(list.querySelectorAll(".qcm-bank-item"));
      const allSelected = rows.length && stateSel.size === rows.length;
      stateSel.clear();
      rows.forEach((row) => {
        const box = row.querySelector(".qcm-bank-check");
        if (!box) return;
        if (allSelected) {
          box.checked = false;
        } else {
          box.checked = true;
          const id = row.dataset?.id;
          if (id) stateSel.add(id);
        }
      });
      updateActions();
    });

    btnDelete()?.addEventListener("click", async () => {
      const ok = await confirmDanger({
        title: "Supprimer des questions",
        warning: "Les questions sélectionnées seront supprimées définitivement.",
        confirmLabel: "Supprimer"
      });
      if (!ok) return;
      if (typeof window.deleteQcmBankQuestions !== "function") return;
      const res = await window.deleteQcmBankQuestions(Array.from(stateSel));
      if (!res.ok) return setMsg(msg, "err", res.message || "Suppression impossible.");
      stateSel.clear();
      await load();
    });

    $("qcmBankReset")?.addEventListener("click", async () => {
      const ok = await confirmDanger({
        title: "Réinitialiser la banque",
        warning: "Toutes les questions du chapitre seront supprimées.",
        confirmLabel: "Tout supprimer"
      });
      if (!ok) return;
      if (typeof window.clearQcmBankForChapter !== "function") return;
      const res = await window.clearQcmBankForChapter();
      if (!res.ok) return setMsg(msg, "err", res.message || "Suppression impossible.");
      stateSel.clear();
      await load();
    });
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

    const settings = document.createElement("div");
    settings.className = "bank-controls";
    settings.innerHTML = `
      <div class="field" style="margin:0;">
        <div class="label-row">
          <label class="label">Mode</label>
          <button class="info-tip" type="button" aria-label="Informations sur les modes" data-tip="Examen : correction à la fin du QCM.&#10;Entraînement : correction disponible après chaque question.">i</button>
        </div>
        <div class="segmented">
          <button class="seg" data-mode="exam">Examen</button>
          <button class="seg" data-mode="train">Entraînement</button>
        </div>
      </div>
      <div class="field" style="margin:0;">
        <label class="label">Minuteur</label>
        <div class="toggle">
          <input id="timerToggle" type="checkbox" />
          <label for="timerToggle">
            Activer le minuteur
          </label>
        </div>
        <div class="row" style="margin-top:8px;">
          <label class="label" style="margin:0;">Secondes / question</label>
          <div class="select-wrap" id="timerPerQuestionWrap">
            <input id="timerPerQuestion" class="select" type="number" min="5" max="200" step="5" value="90" />
            <button id="timerPerQuestionToggle" class="btn btn-ghost icon-btn select-toggle" type="button" aria-label="Choisir un temps">
              <span class="icon">▾</span>
            </button>
            <div id="timerPerQuestionMenu" class="select-menu" role="listbox" aria-label="Presets de secondes">
              <button class="select-item" type="button" data-value="30">30</button>
              <button class="select-item" type="button" data-value="60">60</button>
              <button class="select-item" type="button" data-value="90">90</button>
              <button class="select-item" type="button" data-value="120">120</button>
            </div>
          </div>
        </div>
      </div>
    `;
    wrap.appendChild(settings);

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

    bindQcmSettingsControls(settings);
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

  const btnPdfImmersive = $("btnPdfImmersive");
  const pdfExpandIcon = `
      <span class="icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
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
        </svg>
      </span>`;
  const pdfExitIcon = `
      <span class="icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
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
        </svg>
      </span>`;
  const updatePdfImmersiveButton = () => {
    if (!btnPdfImmersive) return;
    const active = document.body.classList.contains("pdf-immersive");
    btnPdfImmersive.innerHTML = active ? pdfExitIcon : pdfExpandIcon;
    btnPdfImmersive.title = active ? "Quitter plein ecran" : "Plein ecran";
    btnPdfImmersive.setAttribute("aria-label", btnPdfImmersive.title);
  };
  window.updatePdfImmersiveButton = updatePdfImmersiveButton;
  if (btnPdfImmersive) {
    btnPdfImmersive.addEventListener("click", () => {
      const active = document.body.classList.contains("pdf-immersive");
      document.body.classList.toggle("pdf-immersive", !active);
      updatePdfImmersiveButton();
    });
    updatePdfImmersiveButton();
  }

  const closeInlinePdf = () => {
    document.body.classList.remove("pdf-immersive");
    updatePdfImmersiveButton();
    const wrap = $("pdfInlineViewer");
    const frame = $("pdfInlineFrame");
    const list = $("pdfList");
    if (frame) frame.src = "";
    if (wrap) wrap.classList.add("hidden");
    if (list) list.classList.remove("hidden");
    const block = $("pdfBlock");
    if (block) block.classList.remove("viewer-only");
  };
  const btnCloseInlinePdf = $("btnCloseInlinePdf");
  if (btnCloseInlinePdf) btnCloseInlinePdf.addEventListener("click", closeInlinePdf);
  const btnBackToPdfList = $("btnBackToPdfList");
  if (btnBackToPdfList) btnBackToPdfList.addEventListener("click", closeInlinePdf);

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
  const updateSidebarIcon = () => {
    const isCollapsed = appShell?.classList.contains("collapsed");
    btnSidebar?.setAttribute("aria-label", isCollapsed ? "Ouvrir le menu" : "Fermer le menu");
    btnSidebar?.setAttribute("title", isCollapsed ? "Ouvrir le menu" : "Fermer le menu");
    if (btnSidebar) btnSidebar.classList.toggle("is-collapsed", !!isCollapsed);
  };
  updateSidebarIcon();
  if (btnSidebar) {
    btnSidebar.addEventListener("click", () => {
      appShell?.classList.toggle("collapsed");
      sidebar?.classList.toggle("collapsed");
      const isCollapsed = appShell?.classList.contains("collapsed");
      localStorage.setItem("qcm_sidebar_collapsed", isCollapsed ? "1" : "0");
      updateSidebarIcon();
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
