import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { jwtVerify, createRemoteJWKSet, decodeProtectedHeader, decodeJwt } from "https://deno.land/x/jose@v4.15.4/index.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const JWT_SECRET = Deno.env.get("JWT_SECRET") || "";
const PROJECT_URL = Deno.env.get("PROJECT_URL") || "";
const MODEL = "gpt-4o-mini-2024-07-18";
const MAX_PDF_MB = 25;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS"
};

function buildSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      questions: {
        type: "array",
        minItems: 1,
        items: {
          anyOf: [
            {
              type: "object",
              additionalProperties: false,
              properties: {
                type: { type: "string", const: "multi" },
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
              required: ["type", "question", "options", "answer_indices", "explanation", "evidence"]
            },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                type: { type: "string", const: "tf" },
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
              required: ["type", "question", "items", "truth", "explanation", "evidence"]
            }
          ]
        }
      }
    },
    required: ["title", "questions"]
  };
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
  const { pdfUrl, titleHint, questionCount, openai_file_id, fileName } = body || {};
  if (!pdfUrl && !openai_file_id) {
    return new Response(JSON.stringify({ error: "pdfUrl manquant" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
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
  const countLine = questionCount ? `Genere ${questionCount} questions.` : "Genere un nombre raisonnable de questions (entre 10 et 25).";
  const instructions = `Tu es un enseignant LAS. Genere un QCM STRICTEMENT base sur le PDF fourni.\n\nContraintes:\n- Langue: francais\n- Aucun contenu invente\n- 80% questions type \"multi\" et 20% type \"tf\"\n- Toujours 5 propositions/items A->E\n- options/items commencent par \"A ", \"B ", \"C ", \"D ", \"E \"\n- evidence doit toujours etre un tableau (peut etre vide) avec 0 a 3 extraits courts\n${countLine}\n${hint}\n\nNe renvoie que le JSON valide conforme au schema.`;

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
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeout);
  } catch (err) {
    console.error("[pdf-to-qcm] OpenAI fetch error", String(err));
    return new Response(JSON.stringify({ error: "OpenAI fetch error", details: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const openaiJson = await openaiRes.json().catch(() => ({}));
  if (!openaiRes.ok) {
    console.error("[pdf-to-qcm] OpenAI error", openaiRes.status, openaiJson);
    return new Response(JSON.stringify({ error: "OpenAI error", details: openaiJson }), {
      status: 500,
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

  return new Response(JSON.stringify({ ok: true, data: parsedJson, openai_file_id: fileId }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
});
