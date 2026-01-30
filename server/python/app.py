from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from standardize_txt import FormatKind, standardize

app = FastAPI(
    title="File Parser Service",
    description="Service for parsing and processing files",
    version="0.1.0"
)


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
