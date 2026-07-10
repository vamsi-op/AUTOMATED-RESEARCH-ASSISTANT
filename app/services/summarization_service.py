"""
Summarization service — Groq LLM with result caching.

Improvements:
- imports moved to module level
- TTL cache on (paper_id, summary_type) — same paper never summarized twice
- Token budget uses ~1500 tokens ≈ 6000 chars (unchanged) but comment is accurate
"""
import json
import re
import time
from datetime import datetime
from typing import Dict, Optional

from app.models.schemas import SummarizeRequest, PaperSummary
from app.services.llm_service import LLMService
from app.core.exceptions import PaperNotFoundError
from app.utils.logger import app_logger

# ── Cache ─────────────────────────────────────────────────────────────────────
_SUMMARY_CACHE: Dict[str, tuple] = {}
_CACHE_TTL = 600  # 10 minutes


def _cache_key(paper_id: str, summary_type: str) -> str:
    return f"{paper_id}:{summary_type}"


def _cache_get(key: str) -> Optional[PaperSummary]:
    entry = _SUMMARY_CACHE.get(key)
    if entry and time.time() < entry[1]:
        return entry[0]
    _SUMMARY_CACHE.pop(key, None)
    return None


def _cache_set(key: str, value: PaperSummary):
    _SUMMARY_CACHE[key] = (value, time.time() + _CACHE_TTL)


# ── Prompts ───────────────────────────────────────────────────────────────────

SYSTEM = (
    "You are a research paper summarization expert. "
    "Summarize accurately and concisely based only on the provided text. "
    "Never add information not present in the source."
)

# Per-type specification: depth, findings count, methodology detail, token budget.
SUMMARY_SPECS = {
    "brief": {
        "instruction": (
            "Write a BRIEF summary: 2-3 sentences capturing only the core problem "
            "and the single main contribution. Keep it high-level and accessible to "
            "a non-specialist. Do not go into technical detail."
        ),
        "findings": "exactly 2-3 short, plain-language key findings",
        "methodology": "one short sentence describing the overall approach",
        "max_tokens": 500,
    },
    "comprehensive": {
        "instruction": (
            "Write a COMPREHENSIVE summary: 2-3 full paragraphs covering the problem, "
            "the proposed approach, the main results, and why they matter. Balance "
            "depth with readability."
        ),
        "findings": "4-6 key findings, each a complete sentence",
        "methodology": "a short paragraph describing the methodology and design",
        "max_tokens": 1100,
    },
    "technical": {
        "instruction": (
            "Write a TECHNICAL deep-dive summary aimed at domain experts. Emphasize "
            "the architecture/model details, datasets, training setup, evaluation "
            "metrics and quantitative results. Use precise technical terminology and "
            "include specific numbers where the text provides them."
        ),
        "findings": "5-8 technical key findings with concrete specifics (methods, metrics, numbers)",
        "methodology": "a detailed technical description of the methodology, components and experimental setup",
        "max_tokens": 1600,
    },
}

PROMPT = """Summarize the following research paper.

Paper sections:
{text}

INSTRUCTIONS:
{instruction}
- key_findings: provide {findings}.
- methodology: {methodology}.
- Base everything ONLY on the provided text; never invent details.

Return ONLY valid JSON with this exact structure (no extra text):
{{
  "title": "paper title",
  "summary": "the summary text following the instructions above",
  "key_findings": ["..."],
  "methodology": "...",
  "limitations": "limitations if mentioned, else null"
}}"""

SECTION_PRIORITY = ["abstract", "introduction", "results", "conclusion",
                    "methodology", "methods", "unknown"]


class SummarizationService:
    """Paper summarization using Groq LLM with caching."""

    def __init__(self, store, llm_service: LLMService):
        self.store = store
        self.llm_service = llm_service
        app_logger.info("SummarizationService initialized")

    async def summarize(self, request: SummarizeRequest) -> PaperSummary:
        key = _cache_key(request.paper_id, request.summary_type)
        cached = _cache_get(key)
        if cached:
            app_logger.info(f"Summary cache hit: {request.paper_id}")
            return cached

        chunks = await self.store.get_paper_chunks(request.paper_id)
        if not chunks:
            raise PaperNotFoundError(f"Paper not found: {request.paper_id}")

        paper_title = (chunks[0].get("paper_metadata", {}).get("title") or "Unknown Paper")

        # Assemble text from sections in priority order (~6000 chars ≈ 1500 tokens)
        sections: dict = {}
        for chunk in chunks:
            sec = (chunk.get("section") or "unknown").lower()
            sections.setdefault(sec, []).append(chunk["text"])

        assembled, budget = [], 6000
        for sec in SECTION_PRIORITY:
            if sec in sections and budget > 0:
                block = f"[{sec.upper()}]\n" + " ".join(sections[sec])
                block = block[:budget]
                assembled.append(block)
                budget -= len(block)
        for sec, texts in sections.items():
            if sec not in SECTION_PRIORITY and budget > 0:
                block = f"[{sec.upper()}]\n" + " ".join(texts)[:budget]
                assembled.append(block)
                budget -= len(block)

        spec = SUMMARY_SPECS.get(request.summary_type, SUMMARY_SPECS["comprehensive"])
        prompt = PROMPT.format(
            text="\n\n".join(assembled),
            instruction=spec["instruction"],
            findings=spec["findings"],
            methodology=spec["methodology"],
        )

        raw = ""
        try:
            raw = await self.llm_service.generate(
                prompt=prompt,
                system_prompt=SYSTEM,
                temperature=0.2,
                max_tokens=spec["max_tokens"],
            )
            match = re.search(r'\{.*\}', raw, re.DOTALL)
            data = json.loads(match.group() if match else raw)

            result = PaperSummary(
                paper_id=request.paper_id,
                paper_title=data.get("title", paper_title),
                summary=data.get("summary", raw),
                key_findings=data.get("key_findings", []),
                methodology=data.get("methodology"),
                limitations=data.get("limitations"),
                summary_type=request.summary_type,
                generated_at=datetime.utcnow(),
            )
        except Exception as e:
            app_logger.error(f"Summarization failed: {e}")
            result = PaperSummary(
                paper_id=request.paper_id,
                paper_title=paper_title,
                summary=raw or str(e),
                key_findings=[],
                methodology=None,
                limitations=None,
                summary_type=request.summary_type,
                generated_at=datetime.utcnow(),
            )

        _cache_set(key, result)
        return result
