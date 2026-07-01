# 🔬 Automated Research Assistant

**RAG-powered Q&A on academic papers**

[![Live Demo](https://img.shields.io/badge/🤗%20HuggingFace-Live%20Demo-orange)](https://vamsi-op-automated-research-assistant.hf.space)
[![GitHub](https://img.shields.io/badge/GitHub-Repository-black)](https://github.com/vamsi-op/AUTOMATED-RESEARCH-ASSISTANT)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Upload academic PDFs → Ask questions → Get cited answers

</div>

---

## 🚀 Live Demo

**[https://vamsi-op-automated-research-assistant.hf.space](https://vamsi-op-automated-research-assistant.hf.space)**

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 📄 **PDF Upload** | Drag-and-drop with duplicate detection |
| 💬 **RAG Q&A** | Answers with citations and confidence scores |
| 📝 **Summarization** | Brief, comprehensive, or technical summaries |
| 📊 **Literature Review** | Themes, gaps, and future directions |
| 🤖 **Agent** | LangChain ReAct with intent routing |
| 🔍 **Semantic Search** | 384-dim vector search via Qdrant Cloud |
| 🛡️ **Hallucination Prevention** | Citation enforcement + grounding rules |

---

## 🏗️ Architecture

```
Browser / API Client
        │
        ▼
   FastAPI (uvicorn)
        │
   ┌────┴──────────────────────────┐
   │                               │
   ▼                               ▼
Groq API                    Qdrant Cloud
(llama-3.1-8b-instant)    (vector store, 384-dim)
                                   │
                                   ▼
                         sentence-transformers
                         (all-MiniLM-L6-v2, local)
```

**Stack:**

| Component | Technology |
|-----------|-----------|
| Backend | FastAPI (async) |
| LLM | Groq `llama-3.1-8b-instant` |
| Vector Store | Qdrant Cloud |
| Embeddings | sentence-transformers `all-MiniLM-L6-v2` (384-dim) |
| Agent | LangChain ReAct + 5 tools |
| PDF Processing | PyMuPDF → pdfplumber → pypdf (fallback chain) |
| Frontend | Vanilla JS + Tailwind CSS |

---

## 🚦 Quick Start

### Prerequisites
- Python 3.11+
- Free [Groq API key](https://console.groq.com)
- Free [Qdrant Cloud cluster](https://cloud.qdrant.io)

### Run locally

```bash
git clone https://github.com/vamsi-op/AUTOMATED-RESEARCH-ASSISTANT.git
cd AUTOMATED-RESEARCH-ASSISTANT

pip install -r requirements.txt

cp .env.example .env
# Edit .env with your keys

python main.py
# Open http://localhost:8000
```

### Run with Docker

```bash
cp .env.example .env   # fill in your keys
docker-compose up
```

---

## ⚙️ Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | ✅ | Get free at [console.groq.com](https://console.groq.com) |
| `QDRANT_URL` | ✅ | Your Qdrant Cloud cluster URL |
| `QDRANT_API_KEY` | ✅ | Your Qdrant Cloud API key |
| `GROQ_MODEL` | optional | Default: `llama-3.1-8b-instant` |
| `EMBEDDING_MODEL` | optional | Default: `sentence-transformers/all-MiniLM-L6-v2` |
| `CHUNK_SIZE` | optional | Default: `512` |

---

## 📡 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/papers/upload` | Upload a PDF |
| `GET` | `/api/v1/papers` | List all papers |
| `GET` | `/api/v1/papers/{id}` | Get paper info |
| `DELETE` | `/api/v1/papers/{id}` | Delete a paper |
| `POST` | `/api/v1/query` | Ask a question (RAG) |
| `POST` | `/api/v1/summarize` | Summarize a paper |
| `POST` | `/api/v1/literature-review` | Generate literature review |
| `POST` | `/api/v1/agent` | Agent with tool routing |
| `GET` | `/api/v1/health` | Full health check |

Interactive docs at `/docs`.

---

## 📁 Project Structure

```
app/
├── api/v1/          # FastAPI routers
├── core/            # Config, exceptions
├── services/        # Business logic
│   ├── document_service.py     # PDF ingestion pipeline
│   ├── query_service.py        # RAG + TTL cache
│   ├── embedding_service.py    # sentence-transformers (async)
│   ├── llm_service.py          # Groq client
│   ├── summarization_service.py
│   ├── literature_service.py
│   └── agent_service.py
├── agents/          # LangChain ReAct agent + tools
├── retrieval/       # Qdrant client, hybrid retriever
├── processing/      # PDF extraction, chunking, preprocessing
├── prompts/         # RAG prompt templates
├── models/          # Pydantic schemas
└── utils/           # Logging

frontend/            # Single-page web UI
scripts/             # CLI utilities
```

---

## 🔄 How RAG Works

```
Question
  → Embed (384-dim vector)
  → Search Qdrant (cosine similarity, top-5)
  → Build citation-aware prompt
  → Generate answer (Groq, temp=0.3)
  → Extract citations
  → Assess confidence
  → Return answer + citations + confidence
```

**Hallucination prevention:** Every claim must be cited. The system prompt forbids external knowledge and enforces `[Title, Authors, Year]` citation format.

---

## 🛠️ Scripts

```bash
# Run a quick demo against a running server
python scripts/demo.py

# Upload a PDF and test all endpoints
python scripts/upload_test.py path/to/paper.pdf

# Benchmark query performance (cache speedup)
python scripts/benchmark.py
```

---

## 📄 License

MIT — see [LICENSE](LICENSE)

---

## 👤 Author

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/vamsi-op">
        <img src="https://github.com/vamsi-op.png" width="80px" alt="Vamsi Puttepu"/><br/>
        <sub><b>Vamsi Puttepu</b></sub>
      </a><br/>
      <a href="https://github.com/vamsi-op/AUTOMATED-RESEARCH-ASSISTANT/commits?author=vamsi-op">💻</a>
    </td>
  </tr>
</table>

---

## 🤝 Contributing

Contributions, issues and feature requests are welcome.

1. Fork the repo
2. Create a branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'feat: add your feature'`
4. Push: `git push origin feature/your-feature`
5. Open a Pull Request

---

<div align="center">
  <sub>Built with ❤️ using FastAPI · Groq · Qdrant · sentence-transformers</sub>
</div>
