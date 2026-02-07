import os
import re
import json
import math
import hashlib
from collections import Counter
from typing import Any, Dict, List, Optional, Set, Tuple

import fitz  # PyMuPDF


PAGE_NUM_RE = re.compile(
    r"^(page\s*)?\d+(\s*(/|of)\s*\d+)?$", re.IGNORECASE
)
QCM_QUESTION_RE = re.compile(r"^question\s+\d+", re.IGNORECASE)
QCM_ANSWER_RE = re.compile(r"^r[eé]ponses?\s*:?", re.IGNORECASE)
PUNCT_END_RE = re.compile(r"[.:;!?…]$")
SUB_BULLET_PREFIX = "  - "
BULLET_ONLY = {
    "": "• ",
    "•": "• ",
    "": SUB_BULLET_PREFIX,
    "o": SUB_BULLET_PREFIX,
    "O": SUB_BULLET_PREFIX,
    "-": "- ",
}
SUB_BULLET_RE = re.compile(r"^[oO]\s+(.+)$")
SUB_BULLET_SQUARE_RE = re.compile(r"^[]\s+(.+)$")
SMALL_AREA_THRESHOLD = 200 * 200
LOGO_REPEAT_RATIO = 0.6
LABEL_KEYWORDS = {
    "conclusion",
    "definition",
    "définition",
    "bilan",
    "graphique",
    "resume",
    "résumé",
    "synthese",
    "synthèse",
    "objectif",
    "objectifs",
    "remarque",
    "remarques",
    "attention",
    "note",
    "notes",
}


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def norm_text(s: str) -> str:
    if not s:
        return ""
    # remove soft hyphen / zero-width, normalize spaces
    s = s.replace("\u00ad", "")
    s = s.replace("\u00a0", " ")
    s = s.replace("\u200b", "")
    s = s.replace("\u200c", "")
    s = s.replace("\u200d", "")
    s = s.replace("\ufeff", "")
    return " ".join(s.split()).strip()


def median(values: List[float]) -> float:
    vs = sorted(values)
    n = len(vs)
    if n == 0:
        return 0.0
    mid = n // 2
    return vs[mid] if n % 2 == 1 else (vs[mid - 1] + vs[mid]) / 2.0


def quantize_size(size: float, step: float = 0.5) -> float:
    if size <= 0:
        return 0.0
    return round(size / step) * step


def has_alpha(s: str) -> bool:
    return any(ch.isalpha() for ch in s)


def line_y_range(line: Dict[str, Any], spans: List[Dict[str, Any]]) -> Tuple[float, float]:
    lb = line.get("bbox", None)
    if lb:
        return (float(lb[1]), float(lb[3]))
    y0 = min(float(sp.get("bbox", [0, 0, 0, 0])[1]) for sp in spans)
    y1 = max(float(sp.get("bbox", [0, 0, 0, 0])[3]) for sp in spans)
    return (y0, y1)


def spans_text(spans: List[Dict[str, Any]]) -> str:
    return norm_text(" ".join(sp.get("text", "") for sp in spans))


def is_new_bullet(text: str) -> bool:
    t = text.lstrip()
    if not t:
        return False
    if t.startswith("•"):
        return True
    if t.startswith("–") or t.startswith("—"):
        return True
    if t.startswith("- "):
        return True
    if t.startswith("") or t.startswith(""):
        return True
    # handle "o " bullet cases
    if len(t) >= 2 and t[0] in ("o", "O") and t[1].isspace():
        return True
    return False


def normalize_sub_bullets(blocks: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], int]:
    out: List[Dict[str, Any]] = []
    count = 0
    for blk in blocks:
        text = blk.get("text", "")
        t = text.lstrip()
        m = SUB_BULLET_RE.match(t) or SUB_BULLET_SQUARE_RE.match(t)
        if m:
            rest = m.group(1).strip()
            if rest:
                nb = dict(blk)
                nb["text"] = f"{SUB_BULLET_PREFIX}{rest}"
                out.append(nb)
                count += 1
                continue
        out.append(blk)
    return (out, count)


def is_title_case_label(label: str) -> bool:
    words = [w for w in label.split() if w]
    if not (1 <= len(words) <= 3):
        return False
    if len(label) > 24:
        return False
    first = words[0]
    if not first[0].isupper():
        return False
    for w in words[1:]:
        lw = w.lower()
        if lw in ("de", "du", "des", "la", "le", "les"):
            continue
        if "'" in w or "’" in w:
            head = w.split("'")[0].split("’")[0].lower()
            if head in ("d", "l"):
                continue
        if w and w[0].isupper():
            continue
        return False
    return True


def normalize_label_key(text: str) -> str:
    t = text.strip().lower()
    t = t.replace("’", "'")
    t = t.replace("é", "e").replace("è", "e").replace("ê", "e").replace("ë", "e")
    t = t.replace("à", "a").replace("â", "a").replace("ä", "a")
    t = t.replace("î", "i").replace("ï", "i")
    t = t.replace("ô", "o").replace("ö", "o")
    t = t.replace("ù", "u").replace("û", "u").replace("ü", "u")
    return t


def is_label_line(text: str) -> bool:
    t = text.strip()
    if not t:
        return False
    t_norm = normalize_label_key(t).rstrip(":")
    if t_norm in LABEL_KEYWORDS:
        return True
    if t.endswith(":") and len(t) <= 80:
        return True
    return False


def is_title_line(text: str) -> bool:
    t = text.strip()
    if not t:
        return False
    if len(t) > 60:
        return False
    if PUNCT_END_RE.search(t):
        return False
    if is_title_case_label(t):
        return True
    return False


def parse_bullet(text: str) -> Tuple[bool, Optional[int], str]:
    if not text:
        return (False, None, "")
    leading = len(text) - len(text.lstrip())
    stripped = text.lstrip()
    if stripped.startswith("•"):
        return (True, 0, stripped[1:].lstrip())
    if stripped.startswith("-"):
        level = max(0, leading // 2)
        return (True, level, stripped[1:].lstrip())
    return (False, None, text.strip())


def annotate_blocks(blocks: List[Dict[str, Any]], kind_override: Optional[str] = None) -> None:
    for blk in blocks:
        text = blk.get("text", "")
        is_bullet, level, norm = parse_bullet(text)
        kind = kind_override
        if not kind:
            if is_qcm_line(text):
                kind = "qcm"
            elif is_bullet:
                kind = "bullet"
            elif is_label_line(text):
                kind = "label"
            elif is_title_line(text):
                kind = "title"
            else:
                kind = "paragraph"
        blk["kind"] = kind
        blk["bullet_level"] = level
        blk["normalized_text"] = norm


def split_label_lines(blocks: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], int]:
    out: List[Dict[str, Any]] = []
    count = 0
    for blk in blocks:
        text = blk.get("text", "").strip()
        if not text or is_new_bullet(text):
            out.append(blk)
            continue
        m = re.search(r"\bEn France\b", text)
        if not m:
            out.append(blk)
            continue
        label = text[: m.start()].strip()
        rest = text[m.start() :].strip()
        if not label or not rest:
            out.append(blk)
            continue
        if label.endswith((",", ":", ";", ".")):
            out.append(blk)
            continue
        if not is_title_case_label(label):
            out.append(blk)
            continue
        if len(rest) < 25 or len(rest) < (len(label) + 10):
            out.append(blk)
            continue
        out.append({"page": blk.get("page"), "text": label})
        out.append({"page": blk.get("page"), "text": rest})
        count += 1
    return (out, count)


def starts_with_lower_or_continuation(text: str) -> bool:
    t = text.lstrip()
    if not t:
        return False
    lower = t.lower()
    for prefix in (
        "d'",
        "d’",
        "l'",
        "l’",
        "de ",
        "du ",
        "des ",
        "et ",
        "ou ",
        "au ",
        "aux ",
        "a ",
        "à ",
        "en ",
        "par ",
        "pour ",
        "avec ",
        "sans ",
        "sur ",
        "sous ",
        "chez ",
        "dont ",
        "qui ",
        "que ",
        "où ",
    ):
        if lower.startswith(prefix):
            return True
    for ch in t:
        if ch.isalpha():
            return ch.islower()
        if ch.isdigit():
            return False
    return False


def should_merge_lines(text: str, next_text: str) -> bool:
    if not text or not next_text:
        return False
    if is_new_bullet(next_text):
        return False
    t = text.strip()
    n = next_text.lstrip()
    short_line = len(t) <= 18
    ends_with_punct = bool(PUNCT_END_RE.search(t))
    if not (short_line or not ends_with_punct):
        return False
    if starts_with_lower_or_continuation(n):
        return True
    return False


def merge_line_text(text: str, next_text: str) -> str:
    lead = text[: len(text) - len(text.lstrip())]
    t = text.lstrip().rstrip()
    n = next_text.lstrip()
    if t.endswith("-") and not t.endswith(" -"):
        return f"{lead}{t[:-1]}{n}"
    return f"{lead}{t} {n}"


def merge_bullets_blocks(blocks: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], int]:
    merged: List[Dict[str, Any]] = []
    merges = 0
    i = 0
    while i < len(blocks):
        cur = blocks[i]
        text = cur.get("text", "").strip()
        if text in BULLET_ONLY:
            page = cur.get("page")
            j = i + 1
            merged_here = False
            while j < len(blocks):
                nxt = blocks[j]
                if nxt.get("page") != page:
                    break
                next_text = nxt.get("text", "").strip()
                if not next_text:
                    j += 1
                    continue
                if is_new_bullet(next_text):
                    break
                merged.append(
                    {"page": nxt["page"], "text": f"{BULLET_ONLY[text]}{next_text}"}
                )
                merges += 1
                i = j + 1
                merged_here = True
                break
            if merged_here:
                continue
        merged.append(cur)
        i += 1
    return (merged, merges)


def merge_wrap_blocks(blocks: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], int]:
    merged: List[Dict[str, Any]] = []
    merges = 0
    i = 0
    while i < len(blocks):
        cur = blocks[i]
        raw = cur.get("text", "")
        if not raw or not raw.strip():
            i += 1
            continue
        page = cur.get("page")
        out_text = raw.rstrip()
        j = i
        while j + 1 < len(blocks) and blocks[j + 1].get("page") == page:
            next_raw = blocks[j + 1].get("text", "")
            if not next_raw or not next_raw.strip():
                j += 1
                continue
            if not should_merge_lines(out_text, next_raw):
                break
            out_text = merge_line_text(out_text, next_raw)
            merges += 1
            j += 1
        merged.append({"page": page, "text": out_text})
        i = j + 1
    return (merged, merges)


def is_qcm_line(text: str) -> bool:
    if not text:
        return False
    return bool(QCM_QUESTION_RE.match(text) or QCM_ANSWER_RE.match(text))


def split_qcm_blocks(
    blocks: List[Dict[str, Any]], qcm_mode: str
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], bool]:
    if qcm_mode == "include":
        return (blocks, [], False)
    course: List[Dict[str, Any]] = []
    qcm: List[Dict[str, Any]] = []
    in_qcm = False
    found = False
    for blk in blocks:
        text = blk.get("text", "").strip()
        if not in_qcm and is_qcm_line(text):
            in_qcm = True
            found = True
        if in_qcm:
            if qcm_mode == "separate":
                qcm.append(blk)
        else:
            course.append(blk)
    return (course, qcm, found)


def postprocess_sections(
    sections: List[Dict[str, Any]],
    merge_bullets: bool,
    merge_wrap: bool,
    qcm_mode: str,
) -> Dict[str, int]:
    stats = {
        "o_normalized_count": 0,
        "bullets_merged": 0,
        "lonely_bullets_merged_count": 0,
        "wraps_merged": 0,
        "label_splits_count": 0,
        "qcm_sections": 0,
        "qcm_blocks": 0,
    }
    for sec in sections:
        blocks = sec.get("blocks", [])
        if merge_bullets:
            blocks, m = normalize_sub_bullets(blocks)
            stats["o_normalized_count"] += m
            blocks, m = merge_bullets_blocks(blocks)
            stats["bullets_merged"] += m
            stats["lonely_bullets_merged_count"] += m
        if merge_wrap:
            blocks, m = merge_wrap_blocks(blocks)
            stats["wraps_merged"] += m
            blocks, m = split_label_lines(blocks)
            stats["label_splits_count"] += m
        course, qcm, found = split_qcm_blocks(blocks, qcm_mode)
        sec["blocks"] = course
        annotate_blocks(sec["blocks"])
        if qcm_mode == "separate":
            sec["qcm_blocks"] = qcm
            annotate_blocks(sec["qcm_blocks"], kind_override="qcm")
            stats["qcm_blocks"] += len(qcm)
        if found:
            stats["qcm_sections"] += 1
    return stats


def compute_text_stats(
    doc: fitz.Document, sample_pages: int = 8
) -> Tuple[float, float]:
    """
    Heuristic: gather font sizes from first pages, pick a robust body size,
    set title threshold = max(body + 2.5, body * 1.18)
    """
    sizes: List[float] = []
    size_counts: Counter = Counter()
    for i in range(min(sample_pages, len(doc))):
        page = doc[i]
        d = page.get_text("dict")
        for b in d.get("blocks", []):
            if b.get("type") != 0:
                continue
            for line in b.get("lines", []):
                for sp in line.get("spans", []):
                    t = norm_text(sp.get("text", ""))
                    if t:
                        size = float(sp.get("size", 0.0))
                        if size > 0:
                            sizes.append(size)
                            size_counts[quantize_size(size)] += 1

    body_median = median(sizes) or 12.0
    body_mode = None
    if size_counts:
        body_mode = max(size_counts.items(), key=lambda kv: (kv[1], -kv[0]))[0]

    body = body_mode if body_mode else body_median
    if body_mode and body_median:
        # If mode is far from median, prefer median (covers weird font mixes)
        if body_mode < 0.7 * body_median or body_mode > 1.3 * body_median:
            body = body_median

    title_threshold = max(body + 2.5, body * 1.18)
    return (body, title_threshold)


def collect_repeated_header_footer_texts(
    doc: fitz.Document,
    header_band: float,
    footer_band: float,
    title_threshold: float,
    repeat_ratio: float = 0.6,
    min_repeat_pages: int = 3,
    max_len: int = 120,
) -> Tuple[Set[str], Set[str], Dict[str, Any]]:
    header_counts: Counter = Counter()
    footer_counts: Counter = Counter()
    page_count = len(doc)

    for pno in range(page_count):
        page = doc[pno]
        h = float(page.rect.height)
        d = page.get_text("dict")
        for b in d.get("blocks", []):
            if b.get("type") != 0:
                continue
            for line in b.get("lines", []):
                spans = line.get("spans", [])
                if not spans:
                    continue
                y0, y1 = line_y_range(line, spans)
                text = spans_text(spans)
                if not text:
                    continue
                if len(text) > max_len:
                    continue
                if PAGE_NUM_RE.match(text):
                    continue
                # Do not consider large text for repeated headers/footers (likely titles)
                max_size = max(float(sp.get("size", 0.0)) for sp in spans)
                if max_size >= title_threshold:
                    continue
                if y0 < header_band * h:
                    header_counts[text] += 1
                elif y1 > (1.0 - footer_band) * h:
                    footer_counts[text] += 1

    threshold = max(min_repeat_pages, math.ceil(page_count * repeat_ratio))
    repeated_headers = {t for t, c in header_counts.items() if c >= threshold}
    repeated_footers = {t for t, c in footer_counts.items() if c >= threshold}
    meta = {
        "repeat_ratio": repeat_ratio,
        "repeat_min_pages": min_repeat_pages,
        "repeat_threshold": threshold,
        "repeated_headers_count": len(repeated_headers),
        "repeated_footers_count": len(repeated_footers),
    }
    return (repeated_headers, repeated_footers, meta)


def is_title_candidate(
    text: str,
    max_size: float,
    median_size: float,
    title_threshold: float,
    max_title_chars: int,
) -> bool:
    if not text:
        return False
    if len(text) > max_title_chars:
        return False
    if PAGE_NUM_RE.match(text):
        return False
    if not has_alpha(text):
        return False
    if max_size < title_threshold:
        return False
    # If only one span is large, avoid false positives (drop caps, etc.)
    if median_size < (title_threshold * 0.85) and (max_size - median_size) > 2.0:
        return False
    return True


def extract_structure_fast(
    pdf_path: str,
    header_band: float = 0.10,
    footer_band: float = 0.12,
    max_title_chars: int = 90,
    sample_pages: int = 8,
    repeat_ratio: float = 0.6,
    min_repeat_pages: int = 3,
    merge_bullets: bool = True,
    merge_wrap: bool = True,
    qcm_mode: str = "separate",
    image_dedup: str = "xref",
) -> Dict[str, Any]:
    with fitz.open(pdf_path) as doc:
        body_size, title_threshold = compute_text_stats(doc, sample_pages=sample_pages)
        repeated_headers, repeated_footers, repeat_meta = (
            collect_repeated_header_footer_texts(
                doc,
                header_band=header_band,
                footer_band=footer_band,
                title_threshold=title_threshold,
                repeat_ratio=repeat_ratio,
                min_repeat_pages=min_repeat_pages,
            )
        )

        title_merge_gap = max(4.0, body_size * 0.8)

        sections: List[Dict[str, Any]] = []
        current = {"title": "Sans titre", "page_start": 1, "blocks": []}
        pending_title: Dict[str, Any] = {}
        images: List[Dict[str, Any]] = []
        images_by_xref: Dict[int, Dict[str, Any]] = {}
        seen_image_keys: Set[Tuple[int, int]] = set()
        stats = {
            "lines_total": 0,
            "lines_kept": 0,
            "lines_dropped_page_num": 0,
            "lines_dropped_repeated": 0,
            "lines_dropped_footer_short": 0,
            "titles_found": 0,
            "images_total": 0,
            "images_unique": 0,
            "o_normalized_count": 0,
            "lonely_bullets_merged_count": 0,
            "label_splits_count": 0,
            "logos_flagged_count": 0,
        }

        for pno in range(len(doc)):
            page = doc[pno]
            for img in page.get_images(full=True):
                xref = img[0]
                width = img[2]
                height = img[3]
                bpc = img[4]
                colorspace = img[5]
                stats["images_total"] += 1
                if image_dedup == "xref":
                    if xref in images_by_xref:
                        images_by_xref[xref]["pages"].add(pno + 1)
                    else:
                        images_by_xref[xref] = {
                            "xref": xref,
                            "width": width,
                            "height": height,
                            "bpc": bpc,
                            "colorspace": str(colorspace),
                            "pages": {pno + 1},
                        }
                else:
                    key = (xref, pno + 1)
                    if key in seen_image_keys:
                        continue
                    seen_image_keys.add(key)
                    images.append(
                        {
                            "page": pno + 1,
                            "xref": xref,
                            "width": width,
                            "height": height,
                            "bpc": bpc,
                            "colorspace": str(colorspace),
                        }
                    )
            h = float(page.rect.height)
            d = page.get_text("dict")

            for b in d.get("blocks", []):
                if b.get("type") != 0:  # 0=text, 1=image, 2=drawing
                    continue

                # Collect line text + max font size + bbox y-range
                for line in b.get("lines", []):
                    spans = line.get("spans", [])
                    if not spans:
                        continue

                    y0, y1 = line_y_range(line, spans)

                    text = spans_text(spans)
                    if not text:
                        continue

                    stats["lines_total"] += 1

                    in_header = y0 < header_band * h
                    in_footer = y1 > (1.0 - footer_band) * h

                    # Drop page numbers in header/footer
                    if (in_header or in_footer) and PAGE_NUM_RE.match(text):
                        stats["lines_dropped_page_num"] += 1
                        continue

                    # Drop repeated headers/footers
                    if in_header and text in repeated_headers:
                        stats["lines_dropped_repeated"] += 1
                        continue
                    if in_footer and text in repeated_footers:
                        stats["lines_dropped_repeated"] += 1
                        continue

                    # In footers, skip short leftover lines (often page metadata)
                    if in_footer and len(text) < 20:
                        stats["lines_dropped_footer_short"] += 1
                        continue

                    max_size = max(float(sp.get("size", 0.0)) for sp in spans)
                    med_size = median([float(sp.get("size", 0.0)) for sp in spans])

                    # Title heuristic: bigger font + short line
                    is_title = is_title_candidate(
                        text=text,
                        max_size=max_size,
                        median_size=med_size,
                        title_threshold=title_threshold,
                        max_title_chars=max_title_chars,
                    )

                    if is_title:
                        stats["titles_found"] += 1
                        if pending_title and pending_title.get("page") == pno + 1:
                            gap = y0 - float(pending_title.get("y1", 0.0))
                            if gap <= title_merge_gap:
                                pending_title["text"] = (
                                    f"{pending_title['text']} {text}"
                                )
                                pending_title["y1"] = y1
                                continue
                        # finalize previous pending title
                        if pending_title:
                            if current["blocks"]:
                                sections.append(current)
                            current = {
                                "title": pending_title["text"],
                                "page_start": pending_title["page"],
                                "blocks": [],
                            }
                        pending_title = {"text": text, "page": pno + 1, "y1": y1}
                    else:
                        if pending_title:
                            if current["blocks"]:
                                sections.append(current)
                            current = {
                                "title": pending_title["text"],
                                "page_start": pending_title["page"],
                                "blocks": [],
                            }
                            pending_title = {}
                        current["blocks"].append({"page": pno + 1, "text": text})
                        stats["lines_kept"] += 1

        if pending_title:
            if current["blocks"]:
                sections.append(current)
            current = {
                "title": pending_title["text"],
                "page_start": pending_title["page"],
                "blocks": [],
            }
            pending_title = {}

        if current["blocks"]:
            sections.append(current)

        post_stats = postprocess_sections(
            sections=sections,
            merge_bullets=merge_bullets,
            merge_wrap=merge_wrap,
            qcm_mode=qcm_mode,
        )
        stats.update(post_stats)

        if image_dedup == "xref":
            images = []
            total_pages = len(doc)
            for meta in images_by_xref.values():
                pages = sorted(meta.pop("pages"))
                meta["page"] = pages[0] if pages else None
                meta["pages"] = pages
                area = int(meta.get("width", 0)) * int(meta.get("height", 0))
                is_logo = False
                if total_pages > 0:
                    ratio = len(pages) / float(total_pages)
                    is_logo = (ratio >= LOGO_REPEAT_RATIO) and (
                        area < SMALL_AREA_THRESHOLD
                    )
                meta["is_repeated_logo"] = is_logo
                if is_logo:
                    stats["logos_flagged_count"] += 1
                images.append(meta)

        stats["images_unique"] = len(images)

        return {
            "pdf": os.path.basename(pdf_path),
            "pages": len(doc),
            "body_size": body_size,
            "title_threshold": title_threshold,
            "stats": stats,
            "filters": {
                "header_band": header_band,
                "footer_band": footer_band,
                "max_title_chars": max_title_chars,
                "title_merge_gap": title_merge_gap,
                "sample_pages": sample_pages,
                "merge_bullets": merge_bullets,
                "merge_wrap": merge_wrap,
                "qcm_mode": qcm_mode,
                "image_dedup": image_dedup,
                **repeat_meta,
            },
            "sections": sections,
            "images": images,  # metadata only; export lazy
        }


def export_image_by_xref(pdf_path: str, xref: int, out_path: str) -> None:
    with fitz.open(pdf_path) as doc:
        pix = fitz.Pixmap(doc, xref)
        # Convert CMYK/other to RGB
        if pix.n - pix.alpha >= 4:
            pix = fitz.Pixmap(fitz.csRGB, pix)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        pix.save(out_path)


def main():
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", help="Path to PDF")
    ap.add_argument("--out", default="out", help="Output directory")
    ap.add_argument("--force", action="store_true", help="Reprocess even if cached")
    ap.add_argument("--header-band", type=float, default=0.10)
    ap.add_argument("--footer-band", type=float, default=0.12)
    ap.add_argument("--max-title-chars", type=int, default=90)
    ap.add_argument("--sample-pages", type=int, default=8)
    ap.add_argument("--repeat-ratio", type=float, default=0.6)
    ap.add_argument("--min-repeat-pages", type=int, default=3)
    ap.add_argument(
        "--qcm-mode",
        choices=["separate", "ignore", "include"],
        default="separate",
        help="How to handle existing QCM blocks",
    )
    ap.add_argument(
        "--no-merge-bullets",
        action="store_true",
        help="Disable bullet line merging",
    )
    ap.add_argument(
        "--no-merge-wrap",
        action="store_true",
        help="Disable line wrap merging",
    )
    ap.add_argument(
        "--image-dedup",
        choices=["xref", "page"],
        default="xref",
        help="Image dedup strategy: by xref (unique) or by (xref,page)",
    )
    args = ap.parse_args()

    pdf_path = args.pdf
    out_dir = args.out
    os.makedirs(out_dir, exist_ok=True)

    if not os.path.isfile(pdf_path):
        print(f"[err] PDF not found: {pdf_path}")
        return

    file_hash = sha256_file(pdf_path)
    json_path = os.path.join(out_dir, f"{file_hash}.json")

    # Cache: if already processed, skip
    if os.path.exists(json_path) and not args.force:
        print(f"[cache] JSON already exists: {json_path}")
        return

    data = extract_structure_fast(
        pdf_path,
        header_band=args.header_band,
        footer_band=args.footer_band,
        max_title_chars=args.max_title_chars,
        sample_pages=args.sample_pages,
        repeat_ratio=args.repeat_ratio,
        min_repeat_pages=args.min_repeat_pages,
        merge_bullets=not args.no_merge_bullets,
        merge_wrap=not args.no_merge_wrap,
        qcm_mode=args.qcm_mode,
        image_dedup=args.image_dedup,
    )

    data["sha256"] = file_hash
    data["image_export_hint"] = (
        "Use /image/{xref} endpoint (or export_image_by_xref) for lazy export."
    )

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"[ok] Wrote: {json_path}")
    print(
        f"[ok] Sections: {len(data['sections'])} | Images(meta): {len(data['images'])}"
    )


if __name__ == "__main__":
    main()
