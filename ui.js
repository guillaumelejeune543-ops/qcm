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
      else if (isC && !isU) { state = "bad"; label = "Oublié"; }
      else if (!isC && isU) { state = "bad"; label = "Faux"; }
      else if (!isC && !isU) { state = "ok"; label = "Correct"; }

      rows.push({ text: opt, state, label, userChecked: isU });
    }
  } else {
    const stripTfPrefix = (value) => String(value ?? "").trim().replace(/^[A-E]\s+/i, "").trim();
    const isTrueToken = (value) => {
      const v = stripTfPrefix(value).toLowerCase();
      return v === "vrai" || v === "true";
    };
    const isFalseToken = (value) => {
      const v = stripTfPrefix(value).toLowerCase();
      return v === "faux" || v === "false";
    };
    const getTfMode = (qq) => {
      if (!qq || !Array.isArray(qq.items)) return "multi";
      const items = qq.items.map(stripTfPrefix).filter(Boolean);
      const vfCount = items.filter((t) => {
        const l = t.toLowerCase();
        return l === "vrai" || l === "faux" || l === "true" || l === "false";
      }).length;
      const nonVfCount = items.length - vfCount;
      if (vfCount >= 2 && nonVfCount === 0) return "single";
      return "multi";
    };
    const getTfSingleExpectedTruth = (qq) => {
      if (!qq || !Array.isArray(qq.items) || !Array.isArray(qq.truth)) return null;
      const items = qq.items.map(stripTfPrefix);
      const truth = qq.truth;
      let idx = items.findIndex(isTrueToken);
      if (idx >= 0) return !!truth[idx];
      idx = items.findIndex(isFalseToken);
      if (idx >= 0) return !truth[idx];
      return null;
    };

    const truth = q.truth;
    const u = user?.truth || [null,null,null,null,null];
    const tfMode = getTfMode(q);

    rows = [];
    if (tfMode === "single") {
      const expectedTruth = getTfSingleExpectedTruth(q);
      const gotVal = (u[0] === null || u[0] === undefined) ? null : !!u[0];
      const expectedLabel = expectedTruth === null ? "-" : (expectedTruth ? "Vrai" : "Faux");
      const gotLabel = gotVal === null ? "-" : (gotVal ? "Vrai" : "Faux");
      let state = "neutral";
      let label = "";
      let suffix = "";
      if (gotVal === null) { state = "miss"; label = "Non repondu"; suffix = `Attendu : ${expectedLabel}`; }
      else if (expectedTruth !== null && gotVal === expectedTruth) { state = "ok"; label = "Correct"; suffix = `Coché : ${gotLabel}`; }
      else { state = "bad"; label = "Faux"; suffix = `Coché : ${gotLabel} · Attendu : ${expectedLabel}`; }
      rows.push({ text: "Réponse", state, label, suffix, letter: "" });
    } else {
      rows = [];
      for (let k=0;k<5;k++){
        const item = q.items[k];
        const expected = truth[k] ? "Vrai" : "Faux";
        const got = (u[k] === null || u[k] === undefined) ? "-" : (u[k] ? "Vrai" : "Faux");

        let state = "neutral";
        let label = "";
        let suffix = "";
        if (got === "-") { state = "miss"; label = "Non repondu"; suffix = `Attendu : ${expected}`; }
        else if ((u[k] === truth[k])) { state = "ok"; label = "Correct"; suffix = `Coché : ${got}`; }
        else { state = "bad"; label = "Faux"; suffix = `Coché : ${got} · Attendu : ${expected}`; }

        rows.push({ text: item, state, label, suffix });
      }
    }
  }

  rows.forEach(r => {
    const line = document.createElement("div");
    line.className = `corr-line ${r.state}`;
    const check = r.userChecked !== undefined
      ? `<span class="corr-check ${r.userChecked ? "on" : "off"}" aria-hidden="true"></span>`
      : "";
    const raw = r.text ?? "";
    let letter = r.letter;
    let body = r.body;
    if (body === undefined) {
      const match = String(raw).match(/^([A-E])\s+(.*)$/);
      if (match) {
        letter = letter === undefined ? match[1] : letter;
        body = match[2];
      } else {
        body = String(raw);
      }
    }
    if (letter === undefined) letter = "";
    line.innerHTML = `
      ${letter ? `<span class="corr-letter">${escapeHtml(letter)}</span>` : ""}
      <span class="corr-tag">${r.label}</span>
      <span class="corr-text">${check}${escapeHtml(body)}</span>
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
    const details = document.createElement("details");
    details.className = "evidence";
    const summary = document.createElement("summary");
    summary.textContent = "Preuves (cours)";
    details.appendChild(summary);

    q.evidence.slice(0,3).forEach(ev => {
      const evBox = document.createElement("pre");
      evBox.textContent = `Page ${ev.page}:\n${ev.excerpt}`;
      details.appendChild(evBox);
    });
    box.appendChild(details);
  }

  return box;
}
