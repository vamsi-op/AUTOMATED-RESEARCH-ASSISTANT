"""
Hybrid retriever — async embedding + Qdrant semantic search.
"""
import asyncio
import time
from typing import List, Dict, Any, Optional

from app.retrieval.qdrant_client import QdrantVectorStore
from app.services.embedding_service import EmbeddingService
from app.core.config import settings
from app.core.exceptions import RetrievalError
from app.utils.logger import app_logger


class HybridRetriever:
    """Retriever using Qdrant semantic search with async embedding."""

    def __init__(
        self,
        embedding_service: EmbeddingService = None,
        semantic_weight: float = 0.5,
        qdrant_store: QdrantVectorStore = None,
        **_kwargs,  # absorb any legacy keyword args
    ):
        from app.retrieval.qdrant_client import get_qdrant_client
        self.qdrant = qdrant_store or get_qdrant_client()
        self.embedding_service = embedding_service
        self.semantic_weight = semantic_weight
        app_logger.info("HybridRetriever initialized")

    async def retrieve(
        self,
        query: str,
        top_k: int = 5,
        filters: Optional[Dict[str, Any]] = None,
        boost_key_sections: bool = True,
        min_score: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        start = time.time()
        try:
            # Ensure Qdrant is initialized
            if self.qdrant.client is None:
                await self.qdrant.initialize()

            # Async embedding — does NOT block the event loop
            embedding = await self.embedding_service.embed_query_async(query)

            threshold = min_score if min_score is not None else settings.min_similarity_score

            results = await self.qdrant.search(
                query_embedding=embedding,
                top_k=top_k,
                filters=filters,
                score_threshold=threshold,
            )

            # Fallback: generic/abstract questions can score below the threshold
            # for every chunk, returning nothing even when relevant papers exist.
            # Retry without the threshold so the best-matching chunks are still
            # surfaced and the LLM can ground its answer.
            if not results and threshold > 0:
                results = await self.qdrant.search(
                    query_embedding=embedding,
                    top_k=top_k,
                    filters=filters,
                    score_threshold=0.0,
                )
                app_logger.info(
                    f"Threshold {threshold} filtered all results; "
                    f"fallback returned {len(results)} chunks"
                )

            app_logger.info(f"Retrieved {len(results)} chunks in {time.time()-start:.3f}s")
            return results

        except Exception as e:
            app_logger.error(f"Retrieval failed: {e}", exc_info=True)
            raise RetrievalError("Failed to retrieve chunks", detail=str(e))

    async def retrieve_by_paper(
        self, paper_id: str, top_k: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        if self.qdrant.client is None:
            await self.qdrant.initialize()
        chunks = await self.qdrant.get_paper_chunks(paper_id)
        return chunks[:top_k] if top_k else chunks

    async def retrieve_by_section(
        self, query: str, sections: List[str], top_k: int = 5
    ) -> List[Dict[str, Any]]:
        return await self.retrieve(
            query=query, top_k=top_k, filters={"section": sections}
        )


__all__ = ["HybridRetriever"]
