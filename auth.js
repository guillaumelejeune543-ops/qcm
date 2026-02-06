// Auth + Supabase
const SUPABASE_URL = "https://tftqrxpgcqkcehzqheqj.supabase.co";
const SUPABASE_ANON = "sb_publishable_aV4d75MGFdQCk-jHtpTFUQ_k1MrDOtS";
const SUPABASE_STORAGE_KEY = "qcm_las_auth";
const QUIZ_RUNS_TABLE = "quiz_runs";
const QCM_FUNCTION_URL = window.QCM_FUNCTION_URL || `${SUPABASE_URL}/functions/v1/pdf-to-qcm`;
const PDF_INDEX_TABLE = "pdf_index";
const MATIERES_TABLE = "matieres";
const CHAPITRES_TABLE = "chapitres";
const QCM_QUESTIONS_TABLE = "qcm_questions";
const FLASH_SETS_TABLE = "flash_sets";

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

if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

const FILES_BUCKET = "pdfs";
let matieres = [];
let chapitres = [];
let currentMatiereId = null;
let currentChapitreId = null;
let pdfRenderToken = 0;
let currentPdfName = null;
let pdfThumbObserver = null;
let pdfThumbQueue = [];
let pdfThumbRunning = 0;
const PDF_THUMB_CONCURRENCY = 2;
let pdfSignedUrlMap = new Map();
let qcmCounts = { total: 0, facile: 0, moyen: 0, difficile: 0 };
const MATIERE_COLORS_KEY = "qcm_matiere_colors";
const CHAPITRE_COLORS_KEY = "qcm_chapitre_colors";
const MATIERE_PALETTE = [
  // Reds / Pinks
  "#FF6B6B", "#FF5C8D", "#FF7A8A", "#FF4D6D",
  // Oranges / Yellows
  "#FF9F43", "#FFC15A", "#FFD166", "#F9C74F",
  // Greens
  "#6BCB77", "#4CDCA0", "#2ED573", "#10AC84",
  // Teals / Cyans
  "#00D2D3", "#1ABC9C", "#22C1C3", "#4DADF7",
  // Blues
  "#4D96FF", "#3A86FF", "#5B8CFF", "#6C63FF",
  // Purples
  "#9B5DE5", "#B983FF", "#7B2CBF", "#6D214F"
];
window.MATIERE_PALETTE = MATIERE_PALETTE;
let paletteCloseHandlerAdded = false;

function loadMatiereColors() {
  try {
    const raw = localStorage.getItem(MATIERE_COLORS_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveMatiereColors(map) {
  try {
    localStorage.setItem(MATIERE_COLORS_KEY, JSON.stringify(map || {}));
  } catch {}
}

function getMatiereColor(id) {
  if (!id) return "";
  const map = loadMatiereColors();
  const v = map[id];
  return typeof v === "string" ? v : "";
}

function setMatiereColor(id, color) {
  if (!id) return;
  const map = loadMatiereColors();
  if (!color) {
    delete map[id];
  } else {
    map[id] = color;
  }
  saveMatiereColors(map);
}

function loadChapitreColors() {
  try {
    const raw = localStorage.getItem(CHAPITRE_COLORS_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveChapitreColors(map) {
  try {
    localStorage.setItem(CHAPITRE_COLORS_KEY, JSON.stringify(map || {}));
  } catch {}
}

function getChapitreColor(id) {
  if (!id) return "";
  const map = loadChapitreColors();
  const v = map[id];
  return typeof v === "string" ? v : "";
}

function setChapitreColor(id, color) {
  if (!id) return;
  const map = loadChapitreColors();
  if (!color) {
    delete map[id];
  } else {
    map[id] = color;
  }
  saveChapitreColors(map);
}

function folderMsgEl() {
  return $("folderMsg") || $("pdfMsg");
}

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

function fmtBytes(bytes) {
  if (!Number.isFinite(bytes)) return "-";
  const sizes = ["B","KB","MB","GB"];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + " " + sizes[i];
}

function openPdfInModal(url, name) {
  const wrap = $("pdfInlineViewer");
  const frame = $("pdfInlineFrame");
  const title = $("pdfInlineTitle");
  if (!wrap || !frame) return;
  if (title) title.textContent = name || "PDF";
  frame.src = url;
  frame.title = name || "PDF";
  frame.loading = "lazy";
  wrap.classList.remove("hidden");
  const list = $("pdfList");
  if (list) list.classList.add("hidden");
  const block = $("pdfBlock");
  if (block) block.classList.add("viewer-only");
}

function titleFromFilename(name) {
  if (!name) return "";
  const base = name.replace(/\.[^.]+$/, "");
  return base.replace(/[_-]+/g, " ").trim();
}

function setCurrentMatiere(id) {
  currentMatiereId = id || null;
  renderMatiereList();
  currentChapitreId = null;
  currentPdfName = null;
  if (typeof window.setCardsEnabled === "function") {
    window.setCardsEnabled(false);
  }
  loadChapitres();
}

function setCurrentChapitre(id, opts = {}) {
  currentChapitreId = id || null;
  currentPdfName = null;
  if (typeof window.setCardsEnabled === "function") {
    window.setCardsEnabled(!!currentMatiereId && !!currentChapitreId);
  }
  renderChapitreList();
  const hasChapitre = !!currentChapitreId;
  document.body.classList.toggle("no-chapter", !hasChapitre);
  if (!hasChapitre) {
    try {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    } catch {}
  }
  const pdfInput = $("pdfInput");
  if (pdfInput) pdfInput.disabled = !currentChapitreId;

  const title = $("pdfTitle");
  const headerTitle = $("currentContextTitle");
  const chapTitle = $("chapitreTitle");
  const matiere = matieres.find(m => m.id === currentMatiereId);
  const chapitre = chapitres.find(c => c.id === currentChapitreId);
  const contextLabel = matiere && chapitre
    ? `Matière : ${matiere.name} · Chapitre : ${chapitre.name}`
    : matiere
      ? `Matière : ${matiere.name} · Chapitres`
      : "Chapitres et PDFs";
  const renderContext = (target) => {
    if (!target) return;
    if (!matiere) {
      target.textContent = contextLabel;
      return;
    }
      const mName = escapeHtml(matiere.name || "Matière");
    const cName = chapitre ? escapeHtml(chapitre.name || "Chapitre") : "Chapitres";
      const mColor = getMatiereColor(matiere.id) || "var(--primary)";
      const cColor = chapitre ? (getChapitreColor(chapitre.id) || "var(--primary)") : "var(--primary)";
      target.innerHTML = `
        <span class="context-title">
          <span class="context-left">
            <span class="context-label">Matière</span>
            <span class="context-pill" style="--ctx-color:${mColor}">${mName}</span>
            <span class="context-label">Chapitre</span>
            <span class="context-pill" style="--ctx-color:${cColor}">${cName}</span>
          </span>
          <span class="context-spacer"></span>
        </span>
      `;
    };
  if (title) title.textContent = "PDFs du chapitre";
  renderContext(headerTitle);
  if (chapTitle) {
    chapTitle.textContent = matiere ? `Chapitres — ${matiere.name}` : "Chapitres";
  }
  loadChapterStats();

  if (!opts.skipList) listUserPdfs();
}

async function loadMatieres() {
  if (!state.user) return;
  const { data, error } = await supabaseClient
    .from(MATIERES_TABLE)
    .select("id, name, created_at")
    .eq("user_id", state.user.id)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("loadMatieres error:", error);
    matieres = [];
    setMsg(folderMsgEl(), "err", "Impossible de charger les matières.");
    return;
  }
  matieres = data || [];
  if (!matieres.length) {
    currentMatiereId = null;
    clearMsg(folderMsgEl());
    const msg = $("chapitreMsg");
    if (msg) setMsg(msg, "warn", "Aucune matière. Clique sur + pour en creer une.");
    const pdfInput = $("pdfInput");
    if (pdfInput) pdfInput.disabled = true;
    setChapterCounts(0, 0);
  } else if (!currentMatiereId || !matieres.find(m => m.id === currentMatiereId)) {
    currentMatiereId = matieres[0].id;
  }
  renderMatiereList();
  await loadChapitres();
}

async function loadChapitres() {
  if (!state.user || !currentMatiereId) {
    chapitres = [];
    setCurrentChapitre(null, { skipList: true });
    listUserPdfs();
    return;
  }
  const { data, error } = await supabaseClient
    .from(CHAPITRES_TABLE)
    .select("id, name, created_at, matiere_id")
    .eq("user_id", state.user.id)
    .eq("matiere_id", currentMatiereId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("loadChapitres error:", error);
    chapitres = [];
    setMsg(folderMsgEl(), "err", "Impossible de charger les chapitres.");
    return;
  }
  chapitres = data || [];
  if (!chapitres.length) {
    currentChapitreId = null;
    const msg = $("chapitreMsg");
    if (msg) setMsg(msg, "warn", "Aucun chapitre. Clique sur + pour en creer un.");
    setChapterCounts(0, 0);
  } else if (!currentChapitreId || !chapitres.find(c => c.id === currentChapitreId)) {
    currentChapitreId = chapitres[0].id;
    const msg = $("chapitreMsg");
    if (msg) clearMsg(msg);
  }
  renderMatiereList();
  renderChapitreList();
  setCurrentChapitre(currentChapitreId, { skipList: true });
  listUserPdfs();
}

function renderMatiereList() {
  const list = $("sideMatieresList");
  if (!list) return;
  list.innerHTML = "";
  document.querySelectorAll(".matiere-palette").forEach(p => p.remove());

  matieres.forEach(m => {
    const item = document.createElement("button");
    item.className = "side-item matiere-item" + (currentMatiereId === m.id ? " active" : "");
    const color = getMatiereColor(m.id);
    if (color) item.style.setProperty("--matiere-color", color);
    item.innerHTML = `
      <span class="matiere-bar" aria-hidden="true"></span>
      <span class="side-label">${escapeHtml(m.name)}</span>
      <button class="matiere-trash" type="button" aria-label="Supprimer la matière" title="Supprimer la matière">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 7h16"></path>
          <path d="M9 7V5h6v2"></path>
          <path d="M7 7l1 12h8l1-12"></path>
          <path d="M10 11v6"></path>
          <path d="M14 11v6"></path>
        </svg>
      </button>
    `;
    item.title = m.name || "";
    item.dataset.matiereId = m.id;
    item.addEventListener("click", () => {
      if (currentMatiereId !== m.id) setCurrentMatiere(m.id);
    });
    const trash = item.querySelector(".matiere-trash");
    if (trash) {
      trash.addEventListener("click", (e) => {
        e.stopPropagation();
        confirmDeleteMatiere(m.name || "Matière", () => deleteMatiere(m.id));
      });
    }
    const colorBar = item.querySelector(".matiere-bar");
    if (colorBar) {
      const palette = document.createElement("div");
      palette.className = "matiere-palette";
      palette.dataset.matiereId = m.id;
      MATIERE_PALETTE.forEach((hex) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "palette-color";
        btn.style.background = hex;
        btn.setAttribute("aria-label", `Choisir ${hex}`);
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          item.style.setProperty("--matiere-color", hex);
          setMatiereColor(m.id, hex);
          if (currentMatiereId === m.id) {
            setCurrentChapitre(currentChapitreId, { skipList: true });
          }
          palette.classList.remove("open");
        });
        palette.appendChild(btn);
      });
      colorBar.addEventListener("click", (e) => {
        e.stopPropagation();
        document.querySelectorAll(".matiere-palette.open").forEach(p => p.classList.remove("open"));
        const rect = colorBar.getBoundingClientRect();
        const top = rect.top - 8;
        const left = rect.right - 6;
        palette.style.top = `${top}px`;
        palette.style.left = `${left}px`;
        palette.classList.toggle("open");
      });
      document.body.appendChild(palette);
    }
    list.appendChild(item);
  });
  if (!paletteCloseHandlerAdded) {
    paletteCloseHandlerAdded = true;
    document.addEventListener("click", () => {
      document.querySelectorAll(".matiere-palette.open, .chapitre-palette.open").forEach(p => p.classList.remove("open"));
    });
    window.addEventListener("resize", () => {
      document.querySelectorAll(".matiere-palette.open, .chapitre-palette.open").forEach(p => p.classList.remove("open"));
    });
    list.addEventListener("scroll", () => {
      document.querySelectorAll(".matiere-palette.open, .chapitre-palette.open").forEach(p => p.classList.remove("open"));
    });
  }
}

function renderChapitreList() {
  const list = $("sideChapitresList");
  if (!list) return;
  list.innerHTML = "";

  chapitres.forEach(ch => {
    const item = document.createElement("button");
    item.className = "side-item chapitre-item" + (currentChapitreId === ch.id ? " active" : "");
    const color = getChapitreColor(ch.id) || (currentMatiereId ? getMatiereColor(currentMatiereId) : "");
    if (color) item.style.setProperty("--chapitre-color", color);
    item.innerHTML = `
      <span class="chapitre-bar" aria-hidden="true"></span>
      <span class="side-label">${escapeHtml(ch.name)}</span>
      <button class="chapitre-trash" type="button" aria-label="Supprimer le chapitre" title="Supprimer le chapitre">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 7h16"></path>
          <path d="M9 7V5h6v2"></path>
          <path d="M7 7l1 12h8l1-12"></path>
          <path d="M10 11v6"></path>
          <path d="M14 11v6"></path>
        </svg>
      </button>
    `;
    item.title = ch.name || "";
    item.dataset.chapitreId = ch.id;
    item.addEventListener("click", () => setCurrentChapitre(ch.id));
    const trash = item.querySelector(".chapitre-trash");
    if (trash) {
      trash.addEventListener("click", (e) => {
        e.stopPropagation();
        confirmDeleteChapitre(ch.name || "Chapitre", () => deleteChapitre(ch.id));
      });
    }
    const colorBar = item.querySelector(".chapitre-bar");
    if (colorBar) {
      const palette = document.createElement("div");
      palette.className = "chapitre-palette";
      palette.dataset.chapitreId = ch.id;
      MATIERE_PALETTE.forEach((hex) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "palette-color";
        btn.style.background = hex;
        btn.setAttribute("aria-label", `Choisir ${hex}`);
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          item.style.setProperty("--chapitre-color", hex);
          setChapitreColor(ch.id, hex);
          palette.classList.remove("open");
        });
        palette.appendChild(btn);
      });
      colorBar.addEventListener("click", (e) => {
        e.stopPropagation();
        document.querySelectorAll(".chapitre-palette.open").forEach(p => p.classList.remove("open"));
        const rect = colorBar.getBoundingClientRect();
        const top = rect.top - 8;
        const left = rect.right - 6;
        palette.style.top = `${top}px`;
        palette.style.left = `${left}px`;
        palette.classList.toggle("open");
      });
      document.body.appendChild(palette);
    }
    list.appendChild(item);
  });
}

function setChapterCounts(qcmCount = 0, flashCount = 0) {
  const qcmEl = $("qcmCount");
  const flashEl = $("flashCount");
  if (qcmEl) qcmEl.textContent = String(qcmCount || 0);
  if (flashEl) flashEl.textContent = String(flashCount || 0);
}

async function loadChapterStats() {
  if (!state.user || !currentChapitreId) {
    qcmCounts = { total: 0, facile: 0, moyen: 0, difficile: 0 };
    setChapterCounts(0, 0);
    return;
  }
  try {
    const { count: qcmFacile, error: qcmErr1 } = await supabaseClient
      .from(QCM_QUESTIONS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("user_id", state.user.id)
      .eq("chapitre_id", currentChapitreId)
      .eq("difficulty", "facile");
    const { count: qcmMoyen, error: qcmErr2 } = await supabaseClient
      .from(QCM_QUESTIONS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("user_id", state.user.id)
      .eq("chapitre_id", currentChapitreId)
      .eq("difficulty", "moyen");
    const { count: qcmDiff, error: qcmErr3 } = await supabaseClient
      .from(QCM_QUESTIONS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("user_id", state.user.id)
      .eq("chapitre_id", currentChapitreId)
      .eq("difficulty", "difficile");
    if (qcmErr1) console.error("loadChapterStats qcm facile error:", qcmErr1);
    if (qcmErr2) console.error("loadChapterStats qcm moyen error:", qcmErr2);
    if (qcmErr3) console.error("loadChapterStats qcm difficile error:", qcmErr3);
    qcmCounts = {
      facile: qcmFacile || 0,
      moyen: qcmMoyen || 0,
      difficile: qcmDiff || 0,
      total: (qcmFacile || 0) + (qcmMoyen || 0) + (qcmDiff || 0)
    };

    const { count: flashCount, error: flashErr } = await supabaseClient
      .from(FLASH_SETS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("user_id", state.user.id)
      .eq("chapitre_id", currentChapitreId);
    if (flashErr) console.error("loadChapterStats flash error:", flashErr);

    setChapterCounts(qcmCounts.total || 0, flashCount || 0);
  } catch (err) {
    console.error("loadChapterStats error:", err);
    qcmCounts = { total: 0, facile: 0, moyen: 0, difficile: 0 };
    setChapterCounts(0, 0);
  }
}

function setCurrentPdf(name) {
  currentPdfName = name || null;
}

async function createMatiere(name, color, chapterName) {
  if (!state.user || !name) return;
  const { data, error } = await supabaseClient
    .from(MATIERES_TABLE)
    .insert([{ user_id: state.user.id, name }])
    .select("id")
    .single();
  if (error) {
    console.error("createMatiere error:", error);
    return setMsg(folderMsgEl(), "err", "Creation de la matière impossible.");
  }
  currentMatiereId = data?.id || currentMatiereId;
  if (data?.id && color) {
    setMatiereColor(data.id, color);
  }
  if (data?.id && chapterName) {
    const { data: chapData, error: chapErr } = await supabaseClient
      .from(CHAPITRES_TABLE)
      .insert([{ user_id: state.user.id, matiere_id: data.id, name: chapterName }])
      .select("id")
      .single();
    if (chapErr) {
      console.error("createChapitre error:", chapErr);
      setMsg($("chapitreMsg"), "err", "Creation du chapitre impossible.");
    } else if (chapData?.id) {
      currentChapitreId = chapData.id;
    }
  }
  const msgEl = $("folderMsg") || folderMsgEl();
  setMsg(msgEl, "ok", "Matière créée.");
  setTimeout(() => clearMsg(msgEl), 2200);
  await loadMatieres();
}

async function createChapitre(name) {
  if (!state.user || !name || !currentMatiereId) return;
  const { error } = await supabaseClient
    .from(CHAPITRES_TABLE)
    .insert([{ user_id: state.user.id, matiere_id: currentMatiereId, name }]);
  if (error) {
    console.error("createChapitre error:", error);
    return setMsg(folderMsgEl(), "err", "Creation du chapitre impossible.");
  }
  const msgEl = $("chapitreMsg") || folderMsgEl();
  setMsg(msgEl, "ok", "Chapitre créé.");
  setTimeout(() => clearMsg(msgEl), 2200);
  await loadChapitres();
}

async function renameChapitre(id, name) {
  if (!state.user || !id || !name) return;
  await supabaseClient.from(CHAPITRES_TABLE).update({ name }).eq("id", id).eq("user_id", state.user.id);
  await loadChapitres();
}

async function deleteChapitre(id) {
  if (!state.user || !id) return;
  await supabaseClient
    .from(PDF_INDEX_TABLE)
    .delete()
    .eq("chapitre_id", id)
    .eq("user_id", state.user.id);
  await supabaseClient
    .from(CHAPITRES_TABLE)
    .delete()
    .eq("id", id)
    .eq("user_id", state.user.id);
  if (currentChapitreId === id) currentChapitreId = null;
  const msgEl = $("chapitreMsg") || folderMsgEl();
  setMsg(msgEl, "ok", "Chapitre supprimé.");
  setTimeout(() => clearMsg(msgEl), 2200);
  await loadChapitres();
}

function confirmDeleteMatiere(matiereName, onConfirm) {
  const wrap = document.createElement("div");
  wrap.className = "auth-card";

  const title = document.createElement("div");
  title.className = "confirm-title";
  title.textContent = "Supprimer la matière ?";
  wrap.appendChild(title);

  const desc = document.createElement("div");
  desc.className = "confirm-text";
  desc.textContent = `La matière "${matiereName}" sera supprimée avec ses chapitres, PDFs, QCM et flash cards.`;
  wrap.appendChild(desc);

  const actions = document.createElement("div");
  actions.className = "row";
  actions.style.padding = "0";
  actions.style.marginTop = "10px";

  const btnCancel = document.createElement("button");
  btnCancel.className = "btn btn-ghost";
  btnCancel.textContent = "Annuler";
  btnCancel.addEventListener("click", hideModal);

  const btnDelete = document.createElement("button");
  btnDelete.className = "btn btn-danger";
  btnDelete.textContent = "Supprimer";
  btnDelete.addEventListener("click", () => {
    hideModal();
    onConfirm();
  });

  actions.appendChild(btnCancel);
  actions.appendChild(btnDelete);
  wrap.appendChild(actions);

  showModal("Confirmation", wrap);
}

function confirmDeleteChapitre(chapitreName, onConfirm) {
  const wrap = document.createElement("div");
  wrap.className = "auth-card";

  const title = document.createElement("div");
  title.className = "confirm-title";
  title.textContent = "Supprimer le chapitre ?";
  wrap.appendChild(title);

  const desc = document.createElement("div");
  desc.className = "confirm-text";
  desc.textContent = `Le chapitre "${chapitreName}" et ses données associées seront supprimés.`;
  wrap.appendChild(desc);

  const actions = document.createElement("div");
  actions.className = "row";
  actions.style.padding = "0";
  actions.style.marginTop = "10px";

  const btnCancel = document.createElement("button");
  btnCancel.className = "btn btn-ghost";
  btnCancel.textContent = "Annuler";
  btnCancel.addEventListener("click", hideModal);

  const btnDelete = document.createElement("button");
  btnDelete.className = "btn btn-danger";
  btnDelete.textContent = "Supprimer";
  btnDelete.addEventListener("click", () => {
    hideModal();
    onConfirm();
  });

  actions.appendChild(btnCancel);
  actions.appendChild(btnDelete);
  wrap.appendChild(actions);

  showModal("Confirmation", wrap);
}

async function deleteMatiere(id) {
  if (!state.user || !id) return;
  try {
    const { data: chapRows } = await supabaseClient
      .from(CHAPITRES_TABLE)
      .select("id")
      .eq("user_id", state.user.id)
      .eq("matiere_id", id);
    const chapitreIds = (chapRows || []).map(r => r.id).filter(Boolean);
    if (chapitreIds.length) {
      const { data: pdfRows } = await supabaseClient
        .from(PDF_INDEX_TABLE)
        .select("file_name")
        .eq("user_id", state.user.id)
        .in("chapitre_id", chapitreIds);
      const files = (pdfRows || []).map(r => r.file_name).filter(Boolean);
      if (files.length) {
        await supabaseClient
          .storage
          .from(FILES_BUCKET)
          .remove(files.map(f => `${state.user.id}/${f}`));
      }
      await supabaseClient
        .from(PDF_INDEX_TABLE)
        .delete()
        .eq("user_id", state.user.id)
        .in("chapitre_id", chapitreIds);
      await supabaseClient
        .from(QCM_QUESTIONS_TABLE)
        .delete()
        .eq("user_id", state.user.id)
        .in("chapitre_id", chapitreIds);
      await supabaseClient
        .from(FLASH_SETS_TABLE)
        .delete()
        .eq("user_id", state.user.id)
        .in("chapitre_id", chapitreIds);
      await supabaseClient
        .from(CHAPITRES_TABLE)
        .delete()
        .eq("user_id", state.user.id)
        .eq("matiere_id", id);
    }
    await supabaseClient
      .from(MATIERES_TABLE)
      .delete()
      .eq("user_id", state.user.id)
      .eq("id", id);
    if (currentMatiereId === id) {
      currentMatiereId = null;
      currentChapitreId = null;
      currentPdfName = null;
    }
    const msgEl = $("folderMsg") || folderMsgEl();
    setMsg(msgEl, "ok", "Matière supprimée.");
    setTimeout(() => clearMsg(msgEl), 2200);
    await loadMatieres();
  } catch (err) {
    console.error("deleteMatiere error:", err);
    setMsg(folderMsgEl(), "err", "Suppression impossible.");
  }
}

async function setFileChapitre(fileName, chapitreId) {
  if (!state.user || !fileName || !chapitreId) return;
  await supabaseClient
    .from(PDF_INDEX_TABLE)
    .upsert({ user_id: state.user.id, file_name: fileName, chapitre_id: chapitreId }, { onConflict: "user_id,file_name" });
}

async function createQcmFromPdf(fileName, options = {}) {
  if (!state.user) return setMsg($("pdfMsg"), "warn", "Connecte-toi d'abord.");
  setCurrentPdf(fileName);
  const status = $("pdfMsg");
  setMsg(status, "warn", "Generation du QCM en cours...");

  const { data: urlData, error: urlErr } = await supabaseClient
    .storage
    .from(FILES_BUCKET)
    .createSignedUrl(`${state.user.id}/${fileName}`, 180);
  if (urlErr) return setMsg(status, "err", "Lien temporaire impossible.");

  const { data: refreshed, error: refreshErr } = await supabaseClient.auth.refreshSession();
  const accessToken = refreshed.session?.access_token;
  if (refreshErr) console.error("refreshSession error:", refreshErr);
  if (!accessToken) return setMsg(status, "err", "Session invalide. Reconnecte-toi.");

  let openaiFileId = await getOpenAiFileId(fileName);
  const titleHint = titleFromFilename(fileName);
  try {
    const res = await fetch(QCM_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "apikey": SUPABASE_ANON
      },
      body: JSON.stringify({
        pdfUrl: urlData.signedUrl,
        titleHint,
        openai_file_id: openaiFileId,
        fileName,
        questionCount: options.questionCount,
        difficulty: options.difficulty
      })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload?.data) {
      const msg = payload?.error || "Generation impossible.";
      return setMsg(status, "err", msg);
    }

    if (payload.openai_file_id && payload.openai_file_id !== openaiFileId) {
      await saveOpenAiFileId(fileName, payload.openai_file_id);
    }

    if (currentChapitreId && Array.isArray(payload.data.questions)) {
      await saveQuestionsToBank(payload.data.questions, {
        source: "pdf",
        title: payload.data.title || titleHint || "QCM"
      });
    }

    const jsonText = JSON.stringify(payload.data, null, 2);
    const jsonInput = $("jsonInput");
    if (jsonInput) jsonInput.value = jsonText;
    const titleInput = $("qcmTitleInput");
    if (titleInput) titleInput.value = payload.data.title || titleHint || "";

    const ok = loadQuestionsFromJsonText(jsonText);
    if (ok) {
      setMsg(status, "ok", "QCM genere et charge.");
      goStep("quiz");
    }
  } catch (err) {
    setMsg(status, "err", "Erreur reseau ou serveur.");
  }
}

window.generateQcmFromSelectedPdf = async ({ count, difficulty, statusEl }) => {
  if (!currentPdfName) {
    if (statusEl) setMsg(statusEl, "warn", "Selectionne un PDF d'abord.");
    return;
  }
  if (!currentChapitreId) {
    if (statusEl) setMsg(statusEl, "warn", "Selectionne un chapitre d'abord.");
    return;
  }
  if (!Number.isFinite(count) || count < 1 || count > 60) {
    if (statusEl) setMsg(statusEl, "warn", "Nombre de questions invalide (1-60).");
    return;
  }
  const diffOk = ["facile","moyen","difficile"].includes(difficulty);
  if (!diffOk) {
    if (statusEl) setMsg(statusEl, "warn", "Difficulte invalide.");
    return;
  }
  if (statusEl) setMsg(statusEl, "warn", "Generation du QCM en cours...");
  await createQcmFromPdf(currentPdfName, {
    questionCount: count,
    difficulty
  });
  if (statusEl) clearMsg(statusEl);
};

async function saveQuestionsToBank(questions, meta = {}) {
  if (!state.user || !currentChapitreId || !Array.isArray(questions) || !questions.length) return;
  const rows = questions.map(q => ({
    user_id: state.user.id,
    chapitre_id: currentChapitreId,
    difficulty: q.difficulty || meta.difficulty || "moyen",
    type: q.type || "multi",
    question: q.question || "",
    title: meta.title || null,
    source: meta.source || "json",
    payload: q
  }));
  const { error } = await supabaseClient.from(QCM_QUESTIONS_TABLE).insert(rows);
  if (error) {
    console.error("saveQuestionsToBank error:", error);
  } else {
    loadChapterStats();
  }
}

window.saveQcmQuestionsToBank = async (questions) => {
  if (!currentChapitreId) {
    setMsg($("qcmMsg") || $("pdfMsg"), "warn", "Selectionne un chapitre d'abord.");
    return;
  }
  await saveQuestionsToBank(questions, { source: "json" });
};

window.getQcmCountsByDifficulty = () => ({ ...qcmCounts });

window.fetchQcmQuestions = async (difficulty) => {
  if (!state.user || !currentChapitreId) return [];
  const { data, error } = await supabaseClient
    .from(QCM_QUESTIONS_TABLE)
    .select("payload")
    .eq("user_id", state.user.id)
    .eq("chapitre_id", currentChapitreId)
    .eq("difficulty", difficulty);
  if (error) {
    console.error("fetchQcmQuestions error:", error);
    return [];
  }
  return (data || []).map(r => r.payload).filter(Boolean);
};

async function getOpenAiFileId(fileName) {
  if (!state.user) return null;
  const { data, error } = await supabaseClient
    .from(PDF_INDEX_TABLE)
    .select("openai_file_id")
    .eq("user_id", state.user.id)
    .eq("file_name", fileName)
    .limit(1);
  if (error) return null;
  return data && data[0] ? data[0].openai_file_id : null;
}

async function saveOpenAiFileId(fileName, fileId) {
  if (!state.user) return;
  await supabaseClient
    .from(PDF_INDEX_TABLE)
    .upsert({ user_id: state.user.id, file_name: fileName, openai_file_id: fileId }, { onConflict: "user_id,file_name" });
}

async function listUserPdfs() {
  const token = ++pdfRenderToken;
  const pdfList = $("pdfList");
  if (!pdfList) return;
  pdfList.innerHTML = "";
  if (!state.user) return;
  pdfThumbQueue = [];
  pdfThumbRunning = 0;
  pdfSignedUrlMap = new Map();

  if (!matieres.length || !chapitres.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.style.padding = "10px 4px";
    empty.textContent = "Selectionne une matière et un chapitre pour voir les PDFs.";
    pdfList.appendChild(empty);
    return;
  }

  if (!currentChapitreId) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.style.padding = "10px 4px";
    empty.textContent = "Selectionne un chapitre pour voir les PDFs.";
    pdfList.appendChild(empty);
    return;
  }

  const { data: indexRows } = await supabaseClient
    .from(PDF_INDEX_TABLE)
    .select("file_name, chapitre_id, openai_file_id")
    .eq("user_id", state.user.id);
  if (token !== pdfRenderToken) return;
  const indexMap = new Map((indexRows || []).map(r => [r.file_name, r]));

  const { data, error } = await supabaseClient
    .storage
    .from(FILES_BUCKET)
    .list(state.user.id, { limit: 100, sortBy: { column: "created_at", order: "desc" } });
  if (token !== pdfRenderToken) return;

  if (error || !data) {
    setMsg($("pdfMsg"), "err", "Impossible de lister les fichiers.");
    return;
  }

  const filteredFiles = data.filter(file => {
    const row = indexMap.get(file.name);
    const chapitreId = row ? row.chapitre_id : null;
    return chapitreId === currentChapitreId;
  });

  const fileNames = new Set(filteredFiles.map(f => f.name));
  if (currentPdfName && !fileNames.has(currentPdfName)) {
    setCurrentPdf(null);
  }
  if (!filteredFiles.length) {
    setCurrentPdf(null);
  }

  const renderThumb = async (url, container, localToken) => {
    if (!window.pdfjsLib) return;
    try {
      const loadingTask = window.pdfjsLib.getDocument({ url, disableFontFace: true, useSystemFonts: true });
      const pdf = await loadingTask.promise;
      if (localToken !== pdfRenderToken) return;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const targetWidth = 180;
      const scale = targetWidth / viewport.width;
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = vp.width;
      canvas.height = vp.height;
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      if (localToken !== pdfRenderToken) return;
      container.innerHTML = "";
      container.appendChild(canvas);
    } catch (err) {
      console.error("pdf thumb error:", err);
    }
  };

  const enqueueThumb = async (file, thumbEl, localToken) => {
    if (thumbEl.dataset.rendered === "1") return;
    if (pdfThumbRunning >= PDF_THUMB_CONCURRENCY) {
      pdfThumbQueue.push(() => enqueueThumb(file, thumbEl, localToken));
      return;
    }
    pdfThumbRunning++;
    try {
      const signedUrl = pdfSignedUrlMap.get(file.name);
      if (signedUrl) {
        await renderThumb(signedUrl, thumbEl, localToken);
        thumbEl.dataset.rendered = "1";
      }
    } finally {
      pdfThumbRunning--;
      const next = pdfThumbQueue.shift();
      if (next) next();
    }
  };

  const ensureObserver = (files) => {
    if (pdfThumbObserver) pdfThumbObserver.disconnect();
    pdfThumbObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        pdfThumbObserver.unobserve(el);
        const fileName = el.dataset.fileName;
        if (!fileName) return;
        const file = files.find(f => f.name === fileName);
        if (!file) return;
        enqueueThumb(file, el, token);
      });
    }, { root: null, rootMargin: "200px", threshold: 0.1 });
  };

  const paths = filteredFiles.map(f => `${state.user.id}/${f.name}`);
  if (paths.length) {
    const { data: signedList } = await supabaseClient
      .storage
      .from(FILES_BUCKET)
      .createSignedUrls(paths, 300);
    (signedList || []).forEach(item => {
      if (item?.signedUrl && item?.path) {
        const name = item.path.split("/").slice(1).join("/");
        pdfSignedUrlMap.set(name, item.signedUrl);
      }
    });
  }

  ensureObserver(filteredFiles);

  for (const file of filteredFiles) {
    const item = document.createElement("div");
    item.className = "pdf-card";
    if (currentPdfName === file.name) item.classList.add("active");
    item.addEventListener("click", () => {
      setCurrentPdf(file.name);
      item.classList.add("active");
      pdfList.querySelectorAll(".pdf-card.active").forEach(card => {
        if (card !== item) card.classList.remove("active");
      });
    });

    const thumb = document.createElement("div");
    thumb.className = "pdf-thumb";
    thumb.innerHTML = `<div class="thumb-loader"></div>`;
    thumb.dataset.fileName = file.name;

    const name = document.createElement("div");
    name.className = "pdf-name";
    name.textContent = file.name;

    const meta = document.createElement("div");
    meta.className = "pdf-meta";
    meta.textContent = file.created_at ? new Date(file.created_at).toLocaleDateString("fr-FR") : "";

    const actions = document.createElement("div");
    actions.className = "pdf-actions";


    const btn = document.createElement("button");
    btn.className = "btn btn-ghost";
    btn.textContent = "Ouvrir";
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      setCurrentPdf(file.name);
      const { data: urlData, error: urlErr } = await supabaseClient
        .storage
        .from(FILES_BUCKET)
        .createSignedUrl(`${state.user.id}/${file.name}`, 60);
      if (urlErr) return setMsg($("pdfMsg"), "err", "Lien temporaire impossible.");
      openPdfInModal(urlData.signedUrl, file.name);
    });

    const del = document.createElement("button");
    del.className = "btn btn-ghost";
    del.textContent = "Supprimer";
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (currentPdfName === file.name) setCurrentPdf(null);
      if (!confirm("Supprimer ce PDF ?")) return;
      let openaiId = await getOpenAiFileId(file.name);
      const { error: delErr } = await supabaseClient
        .storage
        .from(FILES_BUCKET)
        .remove([`${state.user.id}/${file.name}`]);
      if (delErr) return setMsg($("pdfMsg"), "err", "Suppression impossible.");
      if (openaiId) {
        try {
          const { data: refreshed } = await supabaseClient.auth.refreshSession();
          const accessToken = refreshed.session?.access_token;
          if (!accessToken) return;
          await fetch(`${QCM_FUNCTION_URL}?file_id=${encodeURIComponent(openaiId)}`, {
            method: "DELETE",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "apikey": SUPABASE_ANON
            }
          });
        } catch {}
      }
      await supabaseClient
        .from(PDF_INDEX_TABLE)
        .delete()
        .eq("user_id", state.user.id)
        .eq("file_name", file.name);
      hideModal();
      item.remove();
      setMsg($("pdfMsg"), "ok", "PDF supprimé.");
      await listUserPdfs();
    });

    actions.appendChild(btn);
    actions.appendChild(del);
    item.appendChild(thumb);
    item.appendChild(name);
    item.appendChild(meta);
    item.appendChild(actions);
    pdfList.appendChild(item);

    if (pdfThumbObserver) pdfThumbObserver.observe(thumb);
  }
}

async function uploadPdf(file) {
  if (!state.user) return setMsg($("pdfMsg"), "warn", "Connecte-toi d'abord.");
  if (!currentChapitreId) {
    return setMsg($("pdfMsg"), "warn", "Selectionne un chapitre d'abord.");
  }
  if (!file || file.type !== "application/pdf") {
    return setMsg($("pdfMsg"), "warn", "Choisis un fichier PDF.");
  }
  const cleanName = (name) => {
    const base = String(name || "document.pdf");
    const normalized = base.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const safe = normalized
      .replace(/[^a-zA-Z0-9._ -]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/ /g, "_");
    return safe || "document.pdf";
  };
  const safeName = cleanName(file.name);
  const key = `${state.user.id}/${safeName}`;
  const { error } = await supabaseClient
    .storage
    .from(FILES_BUCKET)
    .upload(key, file, { contentType: "application/pdf", upsert: false });
  if (error) {
    console.error("Upload PDF error:", error);
    return setMsg($("pdfMsg"), "err", error.message || "Upload impossible.");
  }
  await setFileChapitre(safeName, currentChapitreId);
  setMsg($("pdfMsg"), "ok", "PDF uploadé.");
  await listUserPdfs();
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
  const sideName = $("sideUserName");
  const sideEmail = $("sideUserEmail");
  const sideAvatar = $("sideAvatar");

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
    const first = (meta.first_name || "").trim();
    const last = (meta.last_name || "").trim();
    const fullName = (first || last) ? `${first} ${last}`.trim() : "Mon compte";
    if (sideName) sideName.textContent = fullName;
    if (sideEmail) sideEmail.textContent = user.email || "";
    if (sideAvatar) {
      const avatarUrl = meta.avatar_url || meta.picture || "";
      if (avatarUrl) {
        sideAvatar.innerHTML = `<img src="${avatarUrl}" alt="Profil" />`;
      } else {
        const initials = (first || last)
          ? `${first ? first[0] : ""}${last ? last[0] : ""}`.toUpperCase()
          : (user.email ? user.email[0].toUpperCase() : "U");
        sideAvatar.textContent = initials || "U";
      }
    }
    if (meta.pref_theme && meta.pref_theme !== state.theme) {
      state.theme = meta.pref_theme;
      setTheme(meta.pref_theme);
      try { localStorage.setItem("qcm_pref_theme", meta.pref_theme); } catch {}
    }
    if (meta.pref_accent && meta.pref_accent !== state.accent) {
      state.accent = meta.pref_accent;
      setAccent(meta.pref_accent);
      try { localStorage.setItem("qcm_pref_accent", meta.pref_accent); } catch {}
    }
  } else {
    if (sideName) sideName.textContent = "Compte";
    if (sideEmail) sideEmail.textContent = "non connecte";
    if (sideAvatar) sideAvatar.textContent = "?";
  }

  const locked = !user || mustProfile;
  document.body.classList.toggle("auth-locked", locked);

  if (user) {
    loadMatieres().then(() => listUserPdfs());
  } else {
    currentMatiereId = null;
    currentChapitreId = null;
    currentPdfName = null;
  }
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
