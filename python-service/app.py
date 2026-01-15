from fastapi import FastAPI

app = FastAPI(
    title="File Parser Service",
    description="Service for parsing and processing files",
    version="0.1.0"
)

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