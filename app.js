/* =========================
   QCM LAS — app.js (v6)
   ========================= */

// ---------- HELPERS ----------
const $ = (id) => document.getElementById(id);

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

// ---------- STATE ----------
let state = {
  questions: [],
  answers: {},
  flags: new Set(),
  index: 0,
  mode: "exam"
};

// ---------- TIMER ----------
let timerEnabled = true;
let timePerQuestion = 90; // secondes
let totalTime = 0;
let remainingTime = 0;
let timerInterval = null;

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// ---------- INIT ----------
function init() {
  hide($("view-quiz"));
  hide($("view-results"));
  hideModal();

  $("btnLoadJson").onclick = loadFromTextarea;
  $("fileInput").onchange = loadFromFile;
  $("btnDemo").onclick = loadDemo;
  $("btnPrev").onclick = prevQuestion;
  $("btnNext").onclick = nextQuestion;
  $("btnValidate").onclick = validateQuestion;
  $("btnFinish").onclick = finishQuiz;
  $("btnBackToSetup").onclick = resetAll;
  $("modalClose").onclick = hideModal;

  document.querySelectorAll(".seg").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".seg").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.mode = btn.dataset.mode;
    };
  });
}

document.addEventListener("DOMContentLoaded", init);

// ---------- LOAD QCM ----------
function loadFromTextarea() {
  try {
    const data = JSON.parse($("jsonInput").value);
    startQuiz(data);
  } catch {
    alert("JSON invalide");
  }
}

function loadFromFile(e) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      startQuiz(JSON.parse(reader.result));
    } catch {
      alert("JSON invalide");
    }
  };
  reader.readAsText(e.target.files[0]);
}

function loadDemo() {
  startQuiz([
    {
      type: "multi",
      question: "Concernant le cœur humain :",
      options: [
        "A Il comporte 4 cavités",
        "B Il est situé dans l'abdomen",
        "C Il possède une valve mitrale",
        "D Il est innervé par le SNC",
        "E Il pompe le sang"
      ],
      answer_indices: [0, 2, 4],
      explanation: "Le cœur a 4 cavités, une valve mitrale et pompe le sang."
    }
  ]);
}

// ---------- START QUIZ ----------
function startQuiz(questions) {
  state.questions = questions;
  state.answers = {};
  state.flags.clear();
  state.index = 0;

  hide($("view-setup"));
  hide($("view-results"));
  show($("view-quiz"));

  // INIT TIMER
  timerEnabled = $("timerToggle").checked && state.mode === "exam";
  if (timerEnabled) {
    totalTime = state.questions.length * timePerQuestion;
    remainingTime = totalTime;
    $("timerDisplay").textContent = "⏱️ " + formatTime(remainingTime);

    timerInterval = setInterval(() => {
      remainingTime--;
      $("timerDisplay").textContent = "⏱️ " + formatTime(remainingTime);
      if (remainingTime <= 0) {
        clearInterval(timerInterval);
        finishQuiz();
      }
    }, 1000);
  } else {
    $("timerDisplay").textContent = "⏱️ —";
  }

  renderQuestion();
}

// ---------- RENDER QUESTION ----------
function renderQuestion() {
  const q = state.questions[state.index];
  const container = $("questionCard");
  container.innerHTML = "";

  const title = document.createElement("div");
  title.className = "q-title";
  title.textContent = q.question;
  container.appendChild(title);

  if (q.type === "multi") {
    q.options.forEach((opt, i) => {
      const div = document.createElement("div");
      div.className = "choice";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = state.answers[state.index]?.includes(i) || false;
      cb.onchange = () => {
        state.answers[state.index] = state.answers[state.index] || [];
        if (cb.checked) state.answers[state.index].push(i);
        else state.answers[state.index] = state.answers[state.index].filter(x => x !== i);
      };
      div.append(cb, document.createTextNode(" " + opt));
      container.appendChild(div);
    });
  }
}

// ---------- NAVIGATION ----------
function prevQuestion() {
  if (state.index > 0) {
    state.index--;
    renderQuestion();
  }
}

function nextQuestion() {
  if (state.index < state.questions.length - 1) {
    state.index++;
    renderQuestion();
  }
}

function validateQuestion() {
  alert("Réponse enregistrée");
}

// ---------- FINISH ----------
function finishQuiz() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  hide($("view-quiz"));
  show($("view-results"));

  let totalScore = 0;
  state.questions.forEach((q, i) => {
    const user = state.answers[i] || [];
    const correct = q.answer_indices || [];
    const errors =
      user.filter(x => !correct.includes(x)).length +
      correct.filter(x => !user.includes(x)).length;

    let score = 0;
    if (errors === 0) score = 1;
    else if (errors === 1) score = 0.5;
    else if (errors === 2) score = 0.2;
    totalScore += score;
  });

  const mean = totalScore / state.questions.length;
  $("metricMean").textContent = mean.toFixed(2);
  $("metric20").textContent = (mean * 20).toFixed(1);
}

// ---------- RESET ----------
function resetAll() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  show($("view-setup"));
  hide($("view-quiz"));
  hide($("view-results"));
}

// ---------- MODAL ----------
function hideModal() {
  $("modal").classList.add("hidden");
}
