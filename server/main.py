import io
import os
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from rembg import remove, new_session

app = FastAPI(title="BG Remover API", version="1.0.0")

# CORS — allow the Vercel frontend (set FRONTEND_ORIGIN env var in production)
allowed_origins = os.environ.get("FRONTEND_ORIGIN", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)

# Pre-load the model at startup so the first request doesn't pay the download cost
print("Loading U2Net model...")
_session = new_session("u2netp")
print("Model loaded.")


@app.get("/health")
async def health():
    return {"status": "ok", "model": "u2netp"}


@app.post("/remove-bg")
async def remove_bg(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    input_bytes = await file.read()
    if len(input_bytes) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image too large (max 25MB)")
    try:
        output_bytes = remove(input_bytes, session=_session)
        return StreamingResponse(
            io.BytesIO(output_bytes),
            media_type="image/png",
            headers={"Cache-Control": "no-store"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")
