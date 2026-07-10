"""
Query service — RAG pipeline with citation-awareness and result caching.

Features:
- TTL cache on (question, top_k, filters) — repeated queries skip Qdrant + Groq
- Single-pass confidence assessment
- Hallucination prevention via citation enforcement
"""
import asyncio
import hashlib
import json
import time
from typing import List, Dict, Any, Optional

from app.models.schemas import QueryRequest, QueryResponse, Citation
from app.retrieval.hybrid_retriever import HybridRetriever
from app.services.embedding_service import EmbeddingService
from app.services.llm_service import LLMService
from app.prompts.rag_prompts import RAGPrompts
from app.core.config import settings
from app.core.exceptions import RetrievalError, LLMError
from app.utils.logger import app_logger

# Simple in-process TTL cache: {cache_key: (result, expires_at)}
_QUERY_CACHE: Dict[str, tuple] = {}
_CACHE_TTL = 120  # seconds

# Minimum best-chunk similarity for a question to count as "on-topic".
_RELEVANCE_FLOOR = 0.1


def _cache_key(question: str, top_k: int, filters: Any) -> str:
    raw = json.dumps({"q": question, "k": top_k, "f": filters}, sort_keys=True)
    return hashlib.md5(raw.encode()).hexdigest()


def _cache_get(key: str) -> Optional[QueryResponse]:
    entry = _QUERY_CACHE.get(key)
    if entry and time.time() < entry[1]:
        return entry[0]
    _QUERY_CACHE.pop(key, None)
    return None


def _cache_set(key: str, value: QueryResponse):
    _QUERY_CACHE[key] = (value, time.time() + _CACHE_TTL)


class QueryService:
    """RAG-based query processing with citation-awareness."""

    def __init__(self, store, embedding_service: EmbeddingService, llm_service: LLMService):
        self.embedding_service = embedding_service
        self.llm_service = llm_service
        self.retriever = HybridRetriever(
            embedding_service=embedding_service,
            semantic_weight=settings.hybrid_search_weight,
        )
        app_logger.info("QueryService initialized")

    async def query(self, request: QueryRequest) -> QueryResponse:
        start = time.time()

        # Check cache first
        key = _cache_key(request.question, request.top_k, request.filters)
        cached = _cache_get(key)
        if cached:
            app_logger.info(f"Cache hit for query: {request.question[:60]}")
            return cached

        # Handle greetings / small talk without touching the RAG pipeline.
        smalltalk = self._handle_smalltalk(request.question)
        if smalltalk is not None:
            return QueryResponse(
                answer=smalltalk,
                citations=[],
                confidence=1.0,
                processing_time=time.time() - start,
                retrieved_chunks=0,
            )

        try:
            # 1. Retrieve (async embedding inside)
            chunks = await self._retrieve_chunks(request)
            if not chunks:
                return self._no_results(request, start)

            # Relevance guard: if even the best chunk barely matches, the question
            # is off-topic for the indexed papers — don't force an answer.
            top_score = max((c.get("score", 0.0) for c in chunks), default=0.0)
            if top_score < _RELEVANCE_FLOOR:
                return self._no_results(request, start)

            # 2. Build prompt
            prompt = RAGPrompts.build_rag_prompt(
                question=request.question,
                context_chunks=chunks,
                include_confidence=True,
            )

            # 3. Generate answer
            answer = await self.llm_service.generate(
                prompt=prompt,
                system_prompt=RAGPrompts.SYSTEM_PROMPT,
                temperature=0.3,
                max_tokens=settings.groq_max_tokens,
            )

            # 4–6. Citations, confidence, clean (all sync, fast)
            clean = self._clean_answer(answer)
            citations = self._extract_citations(clean, chunks) if request.include_citations else []
            confidence = self._assess_confidence(clean, chunks)

            result = QueryResponse(
                answer=clean,
                citations=citations,
                confidence=confidence,
                processing_time=time.time() - start,
                retrieved_chunks=len(chunks),
            )

            _cache_set(key, result)
            return result

        except (RetrievalError, LLMError):
            raise
        except Exception as e:
            app_logger.error(f"Query error: {e}", exc_info=True)
            raise LLMError("Failed to process query", detail=str(e))

    async def _retrieve_chunks(self, request: QueryRequest) -> List[Dict[str, Any]]:
        try:
            return await self.retriever.retrieve(
                query=request.question,
                top_k=request.top_k,
                filters=request.filters,
                boost_key_sections=self._should_boost(request.question),
                min_score=settings.min_similarity_score,
            )
        except Exception as e:
            raise RetrievalError("Failed to retrieve chunks", detail=str(e))

    def _extract_citations(self, answer: str, chunks: List[Dict]) -> List[Citation]:
        """Build one citation per source paper actually used as context.

        The answer is grounded on these retrieved chunks, so we surface them as
        citation chips regardless of whether the title is quoted in the prose.
        Keeps the highest-scoring chunk per paper.
        """
        # Skip citations for explicit "no information" answers.
        if "don't have information" in answer.lower():
            return []

        # Best-scoring chunk per paper.
        best_by_paper: Dict[str, Dict] = {}
        for chunk in chunks:
            pid = chunk.get("paper_id", "")
            if not pid:
                continue
            if pid not in best_by_paper or chunk.get("score", 0.0) > best_by_paper[pid].get("score", 0.0):
                best_by_paper[pid] = chunk

        if not best_by_paper:
            return []

        # Only cite papers whose best chunk is genuinely relevant (cleared the
        # primary threshold). This avoids citing a paper that only had a weak,
        # tangential match. If none cleared it (fallback retrieval), cite just
        # the single best-matching paper.
        threshold = settings.min_similarity_score
        relevant = {
            pid: c for pid, c in best_by_paper.items()
            if c.get("score", 0.0) >= threshold
        }
        if not relevant:
            top_pid = max(best_by_paper, key=lambda p: best_by_paper[p].get("score", 0.0))
            relevant = {top_pid: best_by_paper[top_pid]}

        citations = []
        for pid, chunk in relevant.items():
            meta = chunk.get("paper_metadata", {})
            text = chunk.get("text", "")
            snippet = text[:200] + ("..." if len(text) > 200 else "")
            citations.append(Citation(
                paper_id=pid,
                paper_title=meta.get("title", "Unknown Paper"),
                authors=meta.get("authors", []),
                chunk_id=chunk.get("chunk_id", ""),
                page_number=chunk.get("page_number"),
                relevance_score=chunk.get("score", 0.0),
                text_snippet=snippet,
            ))
        return citations

    def _assess_confidence(self, answer: str, chunks: List[Dict]) -> float:
        """Single-pass confidence scoring based on grounding + certainty."""
        a = answer.lower()
        no_info = any(p in a for p in (
            "don't have information", "not in the provided", "cannot find",
            "insufficient information", "not mentioned",
        ))
        if no_info:
            return 0.3

        uncertainty = sum(1 for p in (
            "may", "might", "possibly", "perhaps", "suggests", "appears", "seems",
        ) if p in a)

        # Best retrieval score reflects how well the sources match the question.
        top_score = max((c.get("score", 0.0) for c in chunks), default=0.0)

        return round(
            0.55                                      # grounded in retrieved sources
            + max(0.0, 1.0 - uncertainty * 0.1) * 0.25  # certainty of language
            + min(top_score, 1.0) * 0.2,              # relevance of best source
            2,
        )

    def _clean_answer(self, answer: str) -> str:
        for marker in ("CONFIDENCE ASSESSMENT:", "Confidence Level:", "Confidence:", "VERIFICATION:"):
            if marker in answer:
                return answer.split(marker)[0].strip()
        return answer

    def _handle_smalltalk(self, question: str) -> Optional[str]:
        """Return a friendly reply for greetings / small talk, else None."""
        q = question.strip().lower().rstrip("!.?")

        greetings = {
            "hi", "hii", "hey", "hello", "helo", "yo", "hola", "sup",
            "good morning", "good afternoon", "good evening", "greetings",
            "hi there", "hey there", "hello there", "howdy",
        }
        thanks = {"thanks", "thank you", "thx", "ty", "thankyou", "appreciate it"}
        farewells = {"bye", "goodbye", "see you", "cya", "later"}
        howareyou = {"how are you", "how's it going", "hows it going", "what's up", "whats up"}

        if q in greetings or q in howareyou:
            return (
                "Hi! I'm your research assistant. Upload a paper and ask me about it — "
                "for example: “What is the main contribution?”, “Summarize the methodology”, "
                "or “What are the limitations?”"
            )
        if q in thanks:
            return "You're welcome! Ask me anything about your papers."
        if q in farewells:
            return "Goodbye! Come back anytime you need to dig into a paper."
        return None

    def _should_boost(self, question: str) -> bool:
        q = question.lower()
        return any(k in q for k in ("what is", "overview", "summary", "main", "key", "explain"))

    def _no_results(self, request: QueryRequest, start: float) -> QueryResponse:
        return QueryResponse(
            answer=(
                "I don't have any relevant information in the indexed papers to answer this question.\n"
                "1. No papers in the database discuss this topic\n"
                "2. Try rephrasing or using different keywords"
            ),
            citations=[],
            confidence=0.0,
            processing_time=time.time() - start,
            retrieved_chunks=0,
        )
