// Auth + Supabase
const SUPABASE_URL = "https://tftqrxpgcqkcehzqheqj.supabase.co";
const SUPABASE_ANON = "sb_publishable_aV4d75MGFdQCk-jHtpTFUQ_k1MrDOtS";
const SUPABASE_STORAGE_KEY = "qcm_las_auth";
const QUIZ_RUNS_TABLE = "quiz_runs";

var supabaseClient = window.supabaseClient || (window.supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: SUPABASE_STORAGE_KEY,
      storage: window.localStorage
    }
  }
));

function setAuthStatus(type, text) {
  const el = $("authStatus");
  if (!el) return;
  if (!text) return clearMsg(el);
  setMsg(el, type, text);
}

function setGateStatus(type, text) {
  const el = $("gateStatus");
  if (!el) return;
  if (!text) return clearMsg(el);
  setMsg(el, type, text);
}

function needsProfile(user) {
  if (!user) return false;
  const meta = user.user_metadata || {};
  return !meta.first_name || !meta.last_name || !meta.birthdate;
}

function showGateScreen(which) {
  const login = $("gateLogin");
  const signup = $("gateSignup");
  if (!login || !signup) return;
  login.classList.toggle("hidden", which !== "login");
  signup.classList.toggle("hidden", which !== "signup");
  clearMsg($("gateStatus"));
}

function renderAuth(user) {
  state.user = user || null;
  const email = $("authUser");
  if (email) email.textContent = user ? `Connecte: ${user.email}` : "Non connecte";
  const outBtn = $("btnSignOut");
  if (outBtn) outBtn.style.display = user ? "" : "none";

  const gate = $("authGate");
  const profileGate = $("profileGate");
  const mustProfile = !!user && needsProfile(user);

  if (gate) gate.classList.toggle("hidden", !!user);
  if (!user) showGateScreen("login");
  if (profileGate) profileGate.classList.toggle("hidden", !mustProfile);

  if (mustProfile) {
    const meta = user.user_metadata || {};
    if ($("profileFirstName")) $("profileFirstName").value = meta.first_name || "";
    if ($("profileLastName")) $("profileLastName").value = meta.last_name || "";
    if ($("profileBirthdate")) $("profileBirthdate").value = meta.birthdate || "";
  }

  const locked = !user || mustProfile;
  document.body.classList.toggle("auth-locked", locked);
}

async function signUpWith(email, password, meta, statusFn) {
  if (!email || !password) return statusFn("warn", "Email et mot de passe requis.");
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: window.location.href,
      data: meta || {}
    }
  });
  if (error) return statusFn("err", error.message);
  statusFn("ok", "Compte cree. Verifie tes emails.");
  if (data?.user) renderAuth(data.user);
}

async function signInWith(email, password, statusFn) {
  if (!email || !password) return statusFn("warn", "Email et mot de passe requis.");
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) return statusFn("err", error.message);
  statusFn("ok", "Connecte.");
}

async function resetWith(email, statusFn) {
  if (!email) return statusFn("warn", "Entre ton email.");
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href
  });
  if (error) return statusFn("err", error.message);
  statusFn("ok", "Email de reinitialisation envoye.");
}

async function updateProfile(meta, statusFn) {
  if (!meta?.first_name || !meta?.last_name || !meta?.birthdate) {
    return statusFn("warn", "Prenom, nom et date de naissance requis.");
  }
  const { data, error } = await supabaseClient.auth.updateUser({ data: meta });
  if (error) return statusFn("err", error.message);
  statusFn("ok", "Profil enregistre.");
  if (data?.user) renderAuth(data.user);
}

async function insertQuizRun(payload) {
  const { error } = await supabaseClient.from(QUIZ_RUNS_TABLE).insert([payload]);
  if (error) {
    console.error("Quiz run insert failed:", error);
  } else {
    console.info("Quiz run saved.");
  }
}

async function openHistory() {
  const wrap = document.createElement("div");
  wrap.className = "history-list";

  if (!state.user) {
    const msg = document.createElement("div");
    msg.className = "muted";
    msg.textContent = "Connecte-toi pour voir ton historique.";
    wrap.appendChild(msg);
    return showModal("Historique QCM", wrap);
  }

  const loading = document.createElement("div");
  loading.className = "muted";
  loading.textContent = "Chargement...";
  wrap.appendChild(loading);
  showModal("Historique QCM", wrap);

  const { data, error } = await supabaseClient
    .from(QUIZ_RUNS_TABLE)
    .select("id, created_at, mode, metrics, questions, answers, validated")
    .eq("user_id", state.user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  wrap.innerHTML = "";

  if (error) {
    const err = document.createElement("div");
    err.className = "msg err show";
    err.textContent = "Impossible de charger l'historique.";
    wrap.appendChild(err);
    return;
  }

  if (!data || data.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "Aucun QCM enregistre pour le moment.";
    wrap.appendChild(empty);
    return;
  }

  data.forEach(row => {
    const item = document.createElement("div");
    item.className = "history-item";

    const left = document.createElement("div");
    left.className = "history-meta";
    left.innerHTML = `
      <div class="history-title">${row.mode === "exam" ? "Examen" : "Entrainement"}</div>
      <div class="muted">${formatDateShort(row.created_at)}</div>
    `;

    const right = document.createElement("div");
    right.className = "history-score";
    const note = row.metrics?.note20 ?? null;
    right.textContent = note === null ? "-" : `${format1(note)}/20`;

    item.appendChild(left);
    item.appendChild(right);
    item.addEventListener("click", () => {
      showModal("Details du QCM", buildHistoryDetails(row));
    });
    wrap.appendChild(item);
  });
}

function buildHistoryDetails(row) {
  const wrap = document.createElement("div");
  wrap.className = "history-details";

  const header = document.createElement("div");
  header.className = "history-head";
  const modeLabel = row.mode === "exam" ? "Examen" : "Entrainement";
  header.innerHTML = `
    <div>
      <div class="history-title">${modeLabel}</div>
      <div class="muted">${formatDateShort(row.created_at)}</div>
    </div>
    <div class="history-score">${row.metrics?.note20 !== undefined ? `${format1(row.metrics.note20)}/20` : "-"}</div>
  `;
  wrap.appendChild(header);

  const actions = document.createElement("div");
  actions.className = "row";
  const btnAll = document.createElement("button");
  btnAll.className = "btn btn-primary";
  btnAll.textContent = "Recommencer tout le QCM";
  btnAll.addEventListener("click", () => {
    hideModal();
    restartWithQuestions(Array.isArray(row.questions) ? row.questions : []);
  });
  const btnWrong = document.createElement("button");
  btnWrong.className = "btn btn-secondary";
  btnWrong.textContent = "Recommencer les erreurs";
  btnWrong.addEventListener("click", () => {
    hideModal();
    const qs = Array.isArray(row.questions) ? row.questions : [];
    const vmap = row.validated || {};
    const wrong = qs.filter((_, i) => !vmap[i] || vmap[i].errors >= 1);
    restartWithQuestions(wrong);
  });
  actions.appendChild(btnAll);
  actions.appendChild(btnWrong);
  wrap.appendChild(actions);

  const qList = Array.isArray(row.questions) ? row.questions : [];
  const answers = row.answers || {};
  const validated = row.validated || {};

  if (!qList.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "Aucune question disponible pour ce run.";
    wrap.appendChild(empty);
    return wrap;
  }

  qList.forEach((q, i) => {
    const block = document.createElement("div");
    block.className = "history-q";

    const title = document.createElement("div");
    title.className = "q-title";
    title.textContent = `Q${i+1} - ${q.type === "multi" ? "Multi" : "V/F"}`;
    block.appendChild(title);

    const question = document.createElement("div");
    question.className = "q-meta";
    question.innerHTML = escapeHtml(q.question || "");
    block.appendChild(question);

    const corr = buildCorrectionFromData({
      question: q,
      validated: validated[i],
      userAnswer: answers[i]?.payload
    });
    block.appendChild(corr);

    wrap.appendChild(block);
  });

  return wrap;
}
