from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from chat_routes import router as chat_router
from chat.database import create_db_and_tables, seed_db
from standardize_txt import FormatKind, standardize

app = FastAPI(
    title="ChatSight Python Service",
    description="Unified backend: file parser (DSC10/CSE8A standardize-txt) and Chat API with LLM (conversations, messages).",
    version="0.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

create_db_and_tables()
seed_db()
app.include_router(chat_router)

class StandardizeTxtRequest(BaseModel):
    content: str
    format_hint: FormatKind | None = None


class StandardizeTxtResponse(BaseModel):
    content: str
    format: str


@app.get("/")
def read_root():
    return {"message": "File Parser Service is running"}


@app.get("/api/v1/health")
def health_check():
    return {
        "status": "healthy",
        "service": "file-parser",
        "version": "0.1.0"
    }


@app.post("/api/v1/standardize-txt", response_model=StandardizeTxtResponse)
def standardize_txt(req: StandardizeTxtRequest) -> StandardizeTxtResponse:
    """Standardize DSC10 or CSE8A TXT conversation exports to a common format."""
    try:
        out, fmt = standardize(req.content, format_hint=req.format_hint)
        return StandardizeTxtResponse(content=out, format=fmt or "unknown")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
