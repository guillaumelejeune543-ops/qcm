// UI helpers
const $ = (id) => document.getElementById(id);

function setMsg(el, type, text) {
  el.className = "msg show " + (type || "");
  el.textContent = text;
}

function clearMsg(el) {
  el.className = "msg";
  el.textContent = "";
}

function format1(x) {
  return (Math.round(x * 10) / 10).toFixed(1);
}

function formatDateShort(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("fr-FR", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
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

function escapeHtml(str) {
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function buildCorrectionFromData({ question, validated, userAnswer }) {
  const q = question;
  const v = validated;
  const box = document.createElement("div");

  // answer from user
  const user = userAnswer;

  if (v) {
    const meta = document.createElement("div");
    meta.className = "corr-meta";
    meta.textContent = `Score: ${v.score}`;
    box.appendChild(meta);
  }

  const list = document.createElement("div");
  list.className = "corr-list";

  let rows = [];

  if (q.type === "multi") {
    const correct = new Set(q.answer_indices);
    const userSet = new Set(user?.indices || []);

    rows = [];
    for (let k=0;k<5;k++){
      const opt = q.options[k];
      const isC = correct.has(k);
      const isU = userSet.has(k);

      let state = "neutral";
      let label = "";
      if (isC && isU) { state = "ok"; label = "Correct"; }
      else if (isC && !isU) { state = "miss"; label = "Oublie"; }
      else if (!isC && isU) { state = "bad"; label = "Faux"; }

      rows.push({ text: opt, state, label });
    }
  } else {
    const truth = q.truth;
    const u = user?.truth || [null,null,null,null,null];

    rows = [];
    for (let k=0;k<5;k++){
      const item = q.items[k];
      const expected = truth[k] ? "Vrai" : "Faux";
      const got = (u[k] === null || u[k] === undefined) ? "-" : (u[k] ? "Vrai" : "Faux");

      let state = "neutral";
      let label = "";
      let suffix = "";
      if (got === "-") { state = "miss"; label = "Non repondu"; suffix = `attendu: ${expected}`; }
      else if ((u[k] === truth[k])) { state = "ok"; label = "Correct"; suffix = got; }
      else { state = "bad"; label = "Faux"; suffix = `${got} (attendu: ${expected})`; }

      rows.push({ text: item, state, label, suffix });
    }
  }

  rows.forEach(r => {
    const line = document.createElement("div");
    line.className = `corr-line ${r.state}`;
    line.innerHTML = `
      <span class="corr-tag">${r.label}</span>
      <span class="corr-text">${escapeHtml(r.text)}</span>
      ${r.suffix ? `<span class="corr-suffix">${escapeHtml(r.suffix)}</span>` : ""}
    `;
    list.appendChild(line);
  });

  const exp = document.createElement("div");
  exp.style.marginTop = "10px";
  exp.innerHTML = `<div class="muted" style="font-weight:800;margin-bottom:6px;">Explication</div>
                   <div>${escapeHtml(q.explanation || "-")}</div>`;

  box.appendChild(list);
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
