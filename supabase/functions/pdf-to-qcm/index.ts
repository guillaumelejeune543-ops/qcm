import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { jwtVerify, createRemoteJWKSet, decodeProtectedHeader, decodeJwt } from "https://deno.land/x/jose@v4.15.4/index.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const JWT_SECRET = Deno.env.get("JWT_SECRET") || "";
const PROJECT_URL = Deno.env.get("PROJECT_URL") || "";
const MODEL = "gpt-4o-mini-2024-07-18";
const MAX_PDF_MB = 25;
const MAX_EXISTING_QUESTIONS = 80;
const OPENAI_TIMEOUT_MS = 180000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS"
};

function buildMultiQuestionSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      type: { type: "string", const: "multi" },
      difficulty: { type: "string", enum: ["facile", "moyen", "difficile"] },
      question: { type: "string" },
      options: { type: "array", minItems: 5, maxItems: 5, items: { type: "string" } },
      answer_indices: { type: "array", minItems: 1, maxItems: 5, items: { type: "integer", minimum: 0, maximum: 4 } },
      explanation: { type: "string" },
      evidence: {
        type: "array",
        minItems: 0,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            page: { type: "integer" },
            excerpt: { type: "string" }
          },
          required: ["page", "excerpt"]
        }
      }
    },
    required: ["type", "difficulty", "question", "options", "answer_indices", "explanation", "evidence"]
  };
}

function buildTfQuestionSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      type: { type: "string", const: "tf" },
      difficulty: { type: "string", enum: ["facile", "moyen", "difficile"] },
      question: { type: "string" },
      items: { type: "array", minItems: 5, maxItems: 5, items: { type: "string" } },
      truth: { type: "array", minItems: 5, maxItems: 5, items: { type: "boolean" } },
      explanation: { type: "string" },
      evidence: {
        type: "array",
        minItems: 0,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            page: { type: "integer" },
            excerpt: { type: "string" }
          },
          required: ["page", "excerpt"]
        }
      }
    },
    required: ["type", "difficulty", "question", "items", "truth", "explanation", "evidence"]
  };
}

function buildQuestionSchema() {
  return {
    anyOf: [buildMultiQuestionSchema(), buildTfQuestionSchema()]
  };
}

function buildSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      note: { type: "string" },
      questions: {
        type: "array",
        minItems: 1,
        items: buildQuestionSchema()
      }
    },
    required: ["title", "note", "questions"]
  };
}

function buildRepairSchema(count: number) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      fixed: {
        type: "array",
        minItems: count,
        maxItems: count,
        items: buildTfQuestionSchema()
      }
    },
    required: ["fixed"]
  };
}

function normalizeDifficulty(value: unknown) {
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
  if (["facile", "easy", "simple", "debutant", "debut"].includes(cleaned)) return "facile";
  if (["moyen", "moyenne", "medium", "intermediaire", "intermediate", "mid"].includes(cleaned)) return "moyen";
  if (["difficile", "hard", "difficult", "avance"].includes(cleaned)) return "difficile";
  if (cleaned === "1") return "facile";
  if (cleaned === "2") return "moyen";
  if (cleaned === "3") return "difficile";
  return null;
}

function sanitizeQuestions(data: any, requestedDifficulty?: unknown) {
  if (!data || !Array.isArray(data.questions)) return data;
  const fallback = normalizeDifficulty(requestedDifficulty) || "moyen";
  const ensurePrefixes = (items: any[]) => {
    const labels = ["A", "B", "C", "D", "E"];
    return items.map((raw, i) => {
      const value = typeof raw === "string" ? raw.trim() : String(raw ?? "");
      const label = labels[i] || String(i + 1);
      if (value.startsWith(`${label} `)) return value;
      const stripped = value.replace(/^[A-E]\s+/i, "").trim();
      return `${label} ${stripped}`;
    });
  };
  data.questions = data.questions.map((q: any) => {
    if (!q || typeof q !== "object") return q;
    const normalized = normalizeDifficulty(q.difficulty) || fallback;
    const next: any = { ...q, difficulty: normalized };
    if (Array.isArray(next.options) && next.options.length === 5) {
      next.options = ensurePrefixes(next.options);
    }
    if (Array.isArray(next.items) && next.items.length === 5) {
      next.items = ensurePrefixes(next.items);
    }
    return next;
  });
  return data;
}

function stripItemPrefix(value: unknown) {
  return String(value ?? "").trim().replace(/^[A-E]\s+/i, "").trim();
}

function isTrueToken(value: unknown) {
  const v = stripItemPrefix(value).toLowerCase();
  return v === "vrai" || v === "true";
}

function isFalseToken(value: unknown) {
  const v = stripItemPrefix(value).toLowerCase();
  return v === "faux" || v === "false";
}

function isSingleTfPattern(items: unknown[]) {
  if (!Array.isArray(items)) return false;
  const tokens = items.map(stripItemPrefix).filter(Boolean);
  const vfCount = tokens.filter((t) => {
    const l = String(t).toLowerCase();
    return l === "vrai" || l === "faux" || l === "true" || l === "false";
  }).length;
  const nonVfCount = tokens.length - vfCount;
  return vfCount >= 2 && nonVfCount === 0;
}

function isLikelyBogusTfItem(value: unknown) {
  const text = stripItemPrefix(value);
  if (!text) return true;
  const lower = text.toLowerCase();
  if (/^(vrai|faux|true|false)(\s*[\).,;:!?'"]*)?$/.test(lower)) return false;
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
  const badPattern = new RegExp(`^(${badKeys.join("|")})(\\s*[:\\[{,]|$)`, "i");
  return badPattern.test(text);
}

function findInvalidTfIndices(questions: any[]) {
  const bad: number[] = [];
  if (!Array.isArray(questions)) return bad;
  questions.forEach((q, i) => {
    if (!q || typeof q !== "object" || q.type !== "tf") return;
    if (isSingleTfPattern(q.items)) return;
    if (!Array.isArray(q.items) || q.items.length !== 5) {
      bad.push(i);
      return;
    }
    if (q.items.some((item: unknown) => isLikelyBogusTfItem(item))) {
      bad.push(i);
    }
  });
  return bad;
}

function extractOutputText(resp: any) {
  if (!resp) return "";
  if (typeof resp.output_text === "string") return resp.output_text;
  let text = "";
  const out = Array.isArray(resp.output) ? resp.output : [];
  out.forEach((item) => {
    const content = Array.isArray(item.content) ? item.content : [];
    content.forEach((part) => {
      if (part.type === "output_text" && typeof part.text === "string") {
        text += part.text;
      }
    });
  });
  return text;
}

async function callOpenAI(payload: unknown) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  } finally {
    clearTimeout(timeout);
  }
}

async function repairInvalidTfQuestions(params: {
  fileId: string;
  questions: any[];
  invalidIndices: number[];
  existingQuestions: string[];
}) {
  const { fileId, questions, invalidIndices, existingQuestions } = params;
  const invalid = invalidIndices.map((i) => questions[i]).filter(Boolean);
  if (!invalid.length) return null;

  const schema = buildRepairSchema(invalid.length);
  const avoidBlock = existingQuestions.length
    ? `\n\nQuestions deja existantes (ne jamais les reproduire ni paraphraser):\n${existingQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
    : "";
  const invalidBlock = invalid.map((q, i) => {
    const payload = {
      question: q.question || "",
      difficulty: q.difficulty || "moyen",
      items: q.items || [],
      truth: q.truth || [],
      explanation: q.explanation || ""
    };
    return `${i + 1}. ${JSON.stringify(payload)}`;
  }).join("\n");

  const instructions = `Tu dois corriger ${invalid.length} questions V/F invalides a partir du PDF.\n\nRegles obligatoires pour chaque question V/F :\n- type = "tf"\n- question = TITRE/THEME court (pas une affirmation)\n- items = 5 affirmations A->E tirees du PDF, sans mots-cles JSON\n- items ne contiennent aucun mot-cle JSON (type, truth, explanation, evidence, items, options, answer_indices, difficulty, note)\n- truth = 5 booleens correspondant aux items\n- difficulty = facile/moyen/difficile\n- explanation en francais, basee sur le PDF\n- evidence = tableau (0 a 3 extraits)\n\nRetourne EXACTEMENT ${invalid.length} questions dans "fixed", dans le meme ordre que la liste ci-dessous.\n${avoidBlock}\n\nQuestions a corriger (JSON) :\n${invalidBlock}\n\nNe renvoie que le JSON valide conforme au schema.`;

  const payload = {
    model: MODEL,
    input: [
      { role: "user", content: [{ type: "input_file", file_id: fileId }, { type: "input_text", text: instructions }] }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "qcm_fix",
        strict: true,
        schema
      }
    },
    temperature: 0.2
  };

  let openaiRes: Response;
  let openaiJson: any;
  try {
    const out = await callOpenAI(payload);
    openaiRes = out.res;
    openaiJson = out.json;
  } catch (err) {
    console.error("[pdf-to-qcm] repair OpenAI fetch error", String(err));
    return null;
  }

  if (!openaiRes.ok) {
    console.error("[pdf-to-qcm] repair OpenAI error", openaiRes.status, openaiJson);
    return null;
  }

  const outputText = extractOutputText(openaiJson);
  if (!outputText) {
    console.error("[pdf-to-qcm] repair empty output", openaiJson);
    return null;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    console.error("[pdf-to-qcm] repair JSON parse error", outputText.slice(0, 500));
    return null;
  }

  const fixed = Array.isArray(parsed?.fixed) ? parsed.fixed : [];
  if (fixed.length !== invalid.length) return null;
  const sanitized = sanitizeQuestions({ questions: fixed }, null);
  return Array.isArray(sanitized?.questions) ? sanitized.questions : fixed;
}

async function uploadPdfToOpenAI(pdfBuffer: ArrayBuffer, filename: string) {
  const form = new FormData();
  form.append("purpose", "user_data");
  const blob = new Blob([pdfBuffer], { type: "application/pdf" });
  form.append("file", blob, filename || "document.pdf");

  const uploadRes = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}` },
    body: form
  });
  const uploadJson = await uploadRes.json();
  if (!uploadRes.ok) {
    throw new Error(`OpenAI upload error: ${JSON.stringify(uploadJson)}`);
  }
  return uploadJson.id as string;
}

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY manquant." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const url = new URL(req.url);

    // Manual JWT verification (secure even if verify_jwt = false)
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return new Response(JSON.stringify({ error: "JWT manquant." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    try {
      const origin = PROJECT_URL || new URL(req.url).origin;
      const header = decodeProtectedHeader(token);
      const claims = decodeJwt(token);
      console.log("[auth] jwt header", { alg: header.alg, kid: header.kid });
      console.log("[auth] jwt iss", claims.iss);
      const issuer = `${origin}/auth/v1`;
      if (header.alg && header.alg.startsWith("HS")) {
        if (!JWT_SECRET) {
          return new Response(JSON.stringify({ error: "JWT_SECRET manquant pour HS256." }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        await jwtVerify(token, new TextEncoder().encode(JWT_SECRET), { issuer });
      } else {
        const jwksUrl = new URL("/auth/v1/.well-known/jwks.json", origin);
        const jwks = createRemoteJWKSet(jwksUrl);
        await jwtVerify(token, jwks, { issuer });
      }
    } catch (err) {
      console.error("[auth] JWT invalid", String(err));
      return new Response(JSON.stringify({ error: "JWT invalide." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (req.method === "DELETE") {
      const body = await req.json().catch(() => ({}));
      const fileId = url.searchParams.get("file_id") || body?.file_id;
      if (!fileId) {
        return new Response(JSON.stringify({ error: "file_id manquant" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      const delRes = await fetch(`https://api.openai.com/v1/files/${fileId}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${OPENAI_API_KEY}` }
      });
      const delJson = await delRes.json().catch(() => ({}));
      if (!delRes.ok) {
        console.error("[delete] OpenAI error", delRes.status, delJson);
        return new Response(JSON.stringify({ error: "OpenAI delete error", details: delJson }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ ok: true, data: delJson }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const body = await req.json().catch(() => ({}));
    console.log("[pdf-to-qcm] request", {
      hasPdfUrl: !!body?.pdfUrl,
      hasFileId: !!body?.openai_file_id,
      fileName: body?.fileName || null
    });
  let { pdfUrl, titleHint, questionCount, openai_file_id, fileName, existingQuestions, pageRange } = body || {};
  if (!pdfUrl && !openai_file_id) {
    return new Response(JSON.stringify({ error: "pdfUrl manquant" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  if (questionCount !== undefined && questionCount !== null) {
    const n = Number(questionCount);
    if (Number.isFinite(n)) {
      questionCount = Math.min(20, Math.max(1, Math.floor(n)));
    } else {
      questionCount = null;
    }
  }

    let fileId = openai_file_id || null;

    if (!fileId) {
      console.log("[pdf-to-qcm] fetching pdf...");
      const pdfRes = await fetch(pdfUrl);
      if (!pdfRes.ok) {
        console.error("[pdf-to-qcm] download failed", pdfRes.status);
        return new Response(JSON.stringify({ error: `Telechargement PDF impossible (${pdfRes.status}).` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      const sizeHeader = pdfRes.headers.get("content-length");
      if (sizeHeader) {
        const mb = Number(sizeHeader) / (1024 * 1024);
        if (mb > MAX_PDF_MB) {
          console.error("[pdf-to-qcm] file too big", mb);
          return new Response(JSON.stringify({ error: `PDF trop lourd (${mb.toFixed(1)} Mo). Limite ${MAX_PDF_MB} Mo.` }), {
            status: 413,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }
      const pdfBuffer = await pdfRes.arrayBuffer();
      try {
        fileId = await uploadPdfToOpenAI(pdfBuffer, fileName || "document.pdf");
        console.log("[pdf-to-qcm] uploaded file", fileId);
      } catch (err) {
        console.error("[pdf-to-qcm] upload error", String(err));
        return new Response(JSON.stringify({ error: "OpenAI upload error", details: String(err) }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    } else {
      console.log("[pdf-to-qcm] using existing fileId", fileId);
    }

    const schema = buildSchema();
    const hint = titleHint ? `Titre suggere: ${titleHint}.` : "";
    const countLine = questionCount ? `Genere ${questionCount} questions.` : "Genere un nombre raisonnable de questions (entre 10 et 20).";
    const rangeLine = pageRange ? `Tu dois travailler uniquement sur les pages ${pageRange}.` : "";
    const existingList = Array.isArray(existingQuestions)
      ? existingQuestions
          .slice(0, MAX_EXISTING_QUESTIONS)
          .map((q) => String(q || "").trim())
          .filter(Boolean)
          .map((q) => (q.length > 240 ? `${q.slice(0, 240)}…` : q))
      : [];
    const avoidBlock = existingList.length
      ? `\n\nQuestions deja existantes (ne jamais les reproduire ni paraphraser):\n${existingList.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
      : "";
    const instructions = `Tu es un enseignant LAS. Genere un QCM STRICTEMENT base sur le PDF fourni.\n\nContraintes:\n- Langue: francais\n- Aucun contenu invente\n- 80% questions type \"multi\" et 20% type \"tf\"\n- Toujours 5 propositions/items A->E\n- options/items commencent par \"A ", \"B ", \"C ", \"D ", \"E \"\n- Pour les questions \"tf\" : \"question\" est un TITRE/THEME court (pas une affirmation), les items sont 5 affirmations A->E\n- Ne jamais inclure les mots-cles de structure JSON dans items/options (type, truth, explanation, evidence, items, options, answer_indices, difficulty, note)\n- evidence doit toujours etre un tableau (peut etre vide) avec 0 a 3 extraits courts\n- chaque question doit avoir une difficulty exactement parmi: facile, moyen, difficile (minuscules, sans accents)\n- determine toi-meme la difficulty de chaque question\n- les questions doivent etre nouvelles et differentes des questions deja existantes\n- le champ \"note\" est obligatoire : si tout est OK, mets une chaine vide \"\" ; si tu ne peux pas generer ${questionCount || "le nombre demande"} questions nouvelles, explique pourquoi dans \"note\"\n${countLine}\n${rangeLine}\n${hint}${avoidBlock}\n\nNe renvoie que le JSON valide conforme au schema.`;

  const payload = {
    model: MODEL,
    input: [
      { role: "system", content: [{ type: "input_text", text: "Tu es un expert des QCM LAS. Tu dois respecter strictement le schema." }] },
      { role: "user", content: [{ type: "input_file", file_id: fileId }, { type: "input_text", text: instructions }] }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "qcm_las",
        strict: true,
        schema
      }
    },
    temperature: 0.2
  };

    console.log("[pdf-to-qcm] calling OpenAI...");
    let openaiRes: Response;
    let openaiJson: any;
    try {
      const out = await callOpenAI(payload);
      openaiRes = out.res;
      openaiJson = out.json;
    } catch (err) {
      console.error("[pdf-to-qcm] OpenAI fetch error", String(err));
      return new Response(JSON.stringify({ error: "OpenAI fetch error", details: String(err) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (!openaiRes.ok) {
      console.error("[pdf-to-qcm] OpenAI error", openaiRes.status, openaiJson);
      return new Response(JSON.stringify({ error: "OpenAI error", details: openaiJson }), {
        status: openaiRes.status === 429 ? 429 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const outputText = extractOutputText(openaiJson);
    if (!outputText) {
      console.error("[pdf-to-qcm] Empty output", openaiJson);
      return new Response(JSON.stringify({ error: "Reponse OpenAI vide." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(outputText);
    } catch {
      console.error("[pdf-to-qcm] JSON parse error", outputText.slice(0, 500));
      return new Response(JSON.stringify({ error: "JSON invalide renvoye par OpenAI.", raw: outputText.slice(0, 500) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (parsedJson && typeof parsedJson === "object" && (parsedJson as any).note === undefined) {
      (parsedJson as any).note = "";
    }
    let sanitized = sanitizeQuestions(parsedJson, null);
    if (sanitized && Array.isArray((sanitized as any).questions)) {
      const invalidTf = findInvalidTfIndices((sanitized as any).questions);
      if (invalidTf.length) {
        console.warn("[pdf-to-qcm] invalid TF items detected, attempting repair", invalidTf);
        const fixed = await repairInvalidTfQuestions({
          fileId,
          questions: (sanitized as any).questions,
          invalidIndices: invalidTf,
          existingQuestions: existingList
        });
        if (fixed && fixed.length === invalidTf.length) {
          invalidTf.forEach((idx, i) => {
            (sanitized as any).questions[idx] = fixed[i];
          });
        } else {
          console.warn("[pdf-to-qcm] repair failed, returning original questions");
        }
      }
    }
    return new Response(JSON.stringify({ ok: true, data: sanitized, openai_file_id: fileId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("[pdf-to-qcm] Unhandled error", String(err));
    return new Response(JSON.stringify({ error: "Unhandled error", details: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
