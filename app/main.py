"""
Main FastAPI application with middleware, exception handlers, and lifecycle events.
"""
import time
import uuid
from contextlib import asynccontextmanager
from typing import Callable

from fastapi import FastAPI, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import settings
from app.core.exceptions import ResearchAssistantException
from app.api.v1.router import api_router
from app.api.deps import cleanup_services
from app.utils.logger import app_logger, set_request_id


# ============================================================================
# Lifespan Context Manager
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: warm up services in background. Shutdown: clean up."""
    app_logger.info(f"Starting {settings.app_name} v{settings.app_version}")
    app_logger.info(f"Qdrant: {settings.qdrant_url}")
    app_logger.info(f"Groq model: {settings.groq_model}")

    # Run warm_up in background so health check passes immediately
    import asyncio
    from app.api.deps import warm_up
    asyncio.create_task(warm_up())

    yield

    app_logger.info("Shutting down...")
    await cleanup_services()
    app_logger.info("Shutdown complete")


# ============================================================================
# Create FastAPI Application
# ============================================================================

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description=(
        "**Automated Research Assistant** — RAG-powered academic paper analysis.\n\n"
        "Upload PDFs, ask questions with citations, summarize papers, generate literature reviews.\n\n"
        "**Stack:** FastAPI · Groq (LLM) · Qdrant Cloud (vectors) · sentence-transformers"
    ),
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    debug=settings.debug,
    lifespan=lifespan,
)


# ============================================================================
# Middleware
# ============================================================================

# CORS Middleware - allow all origins for the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# GZip Middleware for response compression
app.add_middleware(GZipMiddleware, minimum_size=1000)


# Request ID and Logging Middleware
@app.middleware("http")
async def add_request_id_and_logging(request: Request, call_next: Callable) -> Response:
    """
    Add request ID to all requests and log request/response.
    """
    # Generate or extract request ID
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4())[:8])
    set_request_id(request_id)
    
    start_time = time.time()
    app_logger.info(f"→ {request.method} {request.url.path}")
    response = await call_next(request)
    elapsed = time.time() - start_time
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Process-Time"] = f"{elapsed:.3f}"
    app_logger.info(f"← {request.method} {request.url.path} {response.status_code} {elapsed:.3f}s")
    return response


# ============================================================================
# Exception Handlers
# ============================================================================

@app.exception_handler(ResearchAssistantException)
async def research_assistant_exception_handler(request: Request, exc: ResearchAssistantException) -> JSONResponse:
    app_logger.error(f"App error {exc.status_code}: {exc.message} — {exc.detail}")
    return JSONResponse(status_code=exc.status_code, content={"error": exc.message, "detail": exc.detail})


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    app_logger.warning(f"HTTP {exc.status_code}: {exc.detail}")
    return JSONResponse(status_code=exc.status_code, content={"error": "HTTP error", "detail": exc.detail})


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    app_logger.warning(f"Validation error: {exc.errors()}")
    return JSONResponse(status_code=422, content={"error": "Validation error", "detail": exc.errors()})


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    app_logger.error(f"Unhandled error: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "detail": str(exc) if settings.debug else "Unexpected error"},
    )


# ============================================================================
# Include Routers
# ============================================================================

app.include_router(api_router)


# ============================================================================
# Static Frontend
# ============================================================================

from pathlib import Path
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

root_dir = Path(__file__).parent.parent
website_dir = root_dir / "website"
frontend_dir = root_dir / "frontend"

if website_dir.exists() and (website_dir / "index.html").exists():
    # Serve the production website (landing + app) built with HTML/CSS/JS.
    app.mount("/assets", StaticFiles(directory=str(website_dir / "assets")), name="assets")

    @app.get("/", include_in_schema=False)
    async def serve_landing():
        return FileResponse(str(website_dir / "index.html"))

    @app.get("/app.html", include_in_schema=False)
    @app.get("/app", include_in_schema=False)
    async def serve_app():
        return FileResponse(str(website_dir / "app.html"))

    @app.get("/index.html", include_in_schema=False)
    async def serve_index():
        return FileResponse(str(website_dir / "index.html"))

    # Keep the legacy single-file frontend available at /ui for reference.
    if frontend_dir.exists() and (frontend_dir / "index.html").exists():
        app.mount("/ui", StaticFiles(directory=str(frontend_dir), html=True), name="legacy_frontend")

elif frontend_dir.exists() and (frontend_dir / "index.html").exists():
    # Fallback: serve the legacy frontend if the website folder is missing.
    app.mount("/ui", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")

    @app.get("/", include_in_schema=False)
    async def serve_frontend():
        return FileResponse(str(frontend_dir / "index.html"))
else:
    @app.get("/", tags=["Root"])
    async def root() -> dict:
        return {
            "name": settings.app_name,
            "version": settings.app_version,
            "status": "running",
            "docs": "/docs",
        }


# ============================================================================
# Run Application (for development)
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        log_level=settings.log_level.lower(),
    )
