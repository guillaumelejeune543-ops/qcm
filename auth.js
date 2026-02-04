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

let prefsTimer = null;
function saveUserPrefs(prefs) {
  if (!state.user) return;
  if (!prefs || typeof prefs !== "object") return;
  if (prefsTimer) clearTimeout(prefsTimer);
  prefsTimer = setTimeout(async () => {
    const meta = state.user?.user_metadata || {};
    const next = {
      ...meta,
      pref_theme: prefs.pref_theme ?? meta.pref_theme,
      pref_accent: prefs.pref_accent ?? meta.pref_accent
    };
    await supabaseClient.auth.updateUser({ data: next });
  }, 400);
}

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

  if (user) {
    const meta = user.user_metadata || {};
    if (meta.pref_theme && meta.pref_theme !== state.theme) {
      state.theme = meta.pref_theme;
      setTheme(meta.pref_theme);
    }
    if (meta.pref_accent && meta.pref_accent !== state.accent) {
      state.accent = meta.pref_accent;
      setAccent(meta.pref_accent);
    }
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
    .select("id, created_at, mode, title, metrics, questions, answers, validated, flagged")
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
    const titleText = row.title || (row.mode === "exam" ? "Examen" : "Entrainement");
    left.innerHTML = `
      <div class="history-title">${titleText}</div>
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
  const modeLabel = row.title || (row.mode === "exam" ? "Examen" : "Entrainement");
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
  const btnFlag = document.createElement("button");
  btnFlag.className = "btn btn-secondary";
  btnFlag.textContent = "Recommencer les marquées";
  btnFlag.addEventListener("click", () => {
    hideModal();
    const qs = Array.isArray(row.questions) ? row.questions : [];
    const flagged = Array.isArray(row.flagged) ? row.flagged : [];
    const flaggedQs = flagged.map(i => qs[i]).filter(Boolean);
    restartWithQuestions(flaggedQs);
  });
  actions.appendChild(btnFlag);
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

async function openStats(days = 30) {
  const wrap = document.createElement("div");
  wrap.className = "stats-wrap";

  if (!state.user) {
    const msg = document.createElement("div");
    msg.className = "muted";
    msg.textContent = "Connecte-toi pour voir tes statistiques.";
    wrap.appendChild(msg);
    return showModal("Stats", wrap);
  }

  const loading = document.createElement("div");
  loading.className = "muted";
  loading.textContent = "Chargement...";
  wrap.appendChild(loading);
  showModal("Stats", wrap);

  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);

  const { data, error } = await supabaseClient
    .from(QUIZ_RUNS_TABLE)
    .select("created_at, metrics")
    .eq("user_id", state.user.id)
    .gte("created_at", start.toISOString())
    .order("created_at", { ascending: true });

  wrap.innerHTML = "";

  if (error) {
    const err = document.createElement("div");
    err.className = "msg err show";
    err.textContent = "Impossible de charger les stats.";
    wrap.appendChild(err);
    return;
  }

  wrap.appendChild(buildStatsView(data || [], days));
}

function buildStatsView(rows, days) {
  const wrap = document.createElement("div");
  wrap.className = "stats-view";

  const controls = document.createElement("div");
  controls.className = "stats-controls";
  [7, 30, 90].forEach(d => {
    const btn = document.createElement("button");
    btn.className = "btn btn-secondary" + (d === days ? " active" : "");
    btn.textContent = `${d} jours`;
    btn.addEventListener("click", () => openStats(d));
    controls.appendChild(btn);
  });
  wrap.appendChild(controls);

  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);

  const dayKey = (d) => d.toISOString().slice(0, 10);
  const map = new Map();
  rows.forEach(r => {
    const d = new Date(r.created_at);
    const key = dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
    const entry = map.get(key) || { count: 0, sum: 0 };
    const note = r.metrics?.note20;
    if (typeof note === "number") {
      entry.sum += note;
    }
    entry.count += 1;
    map.set(key, entry);
  });

  const labels = [];
  const counts = [];
  const avgs = [];
  let totalCount = 0;
  let totalSum = 0;

  for (let i=0;i<days;i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = dayKey(d);
    const entry = map.get(key);
    labels.push(key.slice(5)); // MM-DD
    const count = entry ? entry.count : 0;
    const avg = entry && entry.count ? (entry.sum / entry.count) : null;
    counts.push(count);
    avgs.push(avg);
    totalCount += count;
    if (avg !== null) totalSum += avg;
  }

  const overallAvg = totalCount ? (rows.reduce((acc, r) => acc + (r.metrics?.note20 || 0), 0) / totalCount) : 0;

  const summary = document.createElement("div");
  summary.className = "stats-summary";
  summary.innerHTML = `
    <div class="stat"><div class="muted">QCM</div><div class="stat-val">${totalCount}</div></div>
    <div class="stat"><div class="muted">Note moyenne</div><div class="stat-val">${overallAvg ? format1(overallAvg) : "0.0"}/20</div></div>
    <div class="muted">Période: ${days} jours</div>
  `;
  wrap.appendChild(summary);

  const chart = document.createElement("div");
  chart.className = "stats-chart";
  chart.innerHTML = renderStatsSvg(labels, counts, avgs);
  wrap.appendChild(chart);

  const legend = document.createElement("div");
  legend.className = "stats-legend";
  legend.innerHTML = `
    <span class="dot line"></span> Note moyenne
    <span class="dot bar"></span> Nombre de QCM
  `;
  wrap.appendChild(legend);

  return wrap;
}

function renderStatsSvg(labels, counts, avgs) {
  const w = 700;
  const h = 240;
  const pad = { l: 36, r: 12, t: 16, b: 28 };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;
  const maxCount = Math.max(1, ...counts);
  const step = cw / labels.length;
  const barW = step * 0.35;

  const yNote = (v) => pad.t + (1 - (v / 20)) * ch;
  const yCount = (v) => pad.t + (1 - (v / maxCount)) * ch;

  let bars = "";
  for (let i=0;i<labels.length;i++) {
    const x = pad.l + i * step + (step - barW) / 2;
    const y = yCount(counts[i]);
    const bh = pad.t + ch - y;
    bars += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${bh.toFixed(2)}" rx="3" class="bar" />`;
  }

  let path = "";
  let started = false;
  for (let i=0;i<labels.length;i++) {
    const v = avgs[i];
    if (typeof v !== "number") {
      started = false;
      continue;
    }
    const x = pad.l + i * step + step / 2;
    const y = yNote(v);
    if (!started) {
      path += `M ${x.toFixed(2)} ${y.toFixed(2)} `;
      started = true;
    } else {
      path += `L ${x.toFixed(2)} ${y.toFixed(2)} `;
    }
  }

  const grid = [0,10,20].map(v => {
    const y = yNote(v);
    return `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" class="grid" />` +
           `<text x="6" y="${y + 4}" class="label">${v}</text>`;
  }).join("");

  const labelStride = labels.length > 30 ? 7 : (labels.length > 14 ? 5 : 2);
  const xLabels = labels.map((l, i) => {
    if (i % labelStride !== 0 && i !== labels.length - 1) return "";
    const x = pad.l + i * step + step / 2;
    return `<text x="${x}" y="${h - 6}" class="xlabel" text-anchor="middle">${l}</text>`;
  }).join("");

  return `
<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img">
  <g class="grid-lines">${grid}</g>
  <g class="bars">${bars}</g>
  <path d="${path}" class="line" fill="none" />
  ${xLabels}
</svg>`;
}
