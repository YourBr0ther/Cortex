"""
CORTEX - Backend API
Voice transcription and AI-powered note organization
"""

import os
import uuid
import json
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx
import whisper
import aiofiles
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings from environment variables"""
    nano_gpt_api_key: str = ""
    nano_gpt_api_url: str = "https://nano-gpt.com/api/v1/chat/completions"
    data_dir: str = "/data"
    whisper_model: str = "base"  # tiny, base, small, medium, large

    class Config:
        env_file = ".env"


settings = Settings()
app = FastAPI(title="Cortex API", version="1.0.0")

# Load whisper model at startup
whisper_model = None


@app.on_event("startup")
async def startup_event():
    """Load the whisper model on startup"""
    global whisper_model
    print(f"Loading Whisper model: {settings.whisper_model}")
    whisper_model = whisper.load_model(settings.whisper_model)
    print("Whisper model loaded successfully")

    # Ensure data directories exist
    ensure_directories()


def ensure_directories():
    """Create required directories if they don't exist"""
    data_path = Path(settings.data_dir)
    data_path.mkdir(parents=True, exist_ok=True)

    # Create default folders
    default_folders = ["inbox", "ideas", "tasks", "journal"]
    for folder in default_folders:
        folder_path = data_path / folder
        folder_path.mkdir(exist_ok=True)

    # Create README if it doesn't exist
    readme_path = data_path / "README.md"
    if not readme_path.exists():
        create_default_readme(readme_path)


def create_default_readme(path: Path):
    """Create the default README explaining folder structure"""
    readme_content = """# Cortex Brain Dump

This is your personal brain dump powered by Cortex. Voice recordings are transcribed
and automatically organized into folders based on their content.

## Folder Structure

### inbox/
Uncategorized thoughts that haven't been processed yet. The AI will try to move
items to more specific folders, but anything unclear ends up here for manual review.

### ideas/
Creative ideas, concepts, project proposals, and brainstorms. Things you want to
explore or develop further.

### tasks/
Action items, to-dos, reminders, and things you need to do. Format: each note
should represent a specific actionable item.

### journal/
Personal reflections, daily observations, emotions, and experiences. Stream of
consciousness entries that capture how you're feeling or what you're thinking about.

## Adding New Folders

You can create new folders through the app. When you do, add a description here
so the AI knows how to categorize new entries.

## Note Format

Each note is saved as a markdown file with the following structure:
- Filename: `YYYY-MM-DD_HH-MM-SS_<short-title>.md`
- Contains: timestamp, original transcript, and any AI-added metadata

## Tips

1. Speak naturally - the AI will figure out what you mean
2. Start with action words for tasks: "I need to...", "Remind me to..."
3. Use phrases like "I have an idea..." for creative thoughts
4. For journal entries, just talk about how you feel or what happened
"""
    with open(path, "w") as f:
        f.write(readme_content)


# ═══════════════════════════════════════════════════════════════════════════
# MODELS
# ═══════════════════════════════════════════════════════════════════════════

class TranscriptionResponse(BaseModel):
    transcript: str
    timestamp: str
    duration: float


class ProcessRequest(BaseModel):
    transcript: str
    folder: str
    timestamp: str


class ProcessResponse(BaseModel):
    id: str
    preview: str
    folder: str
    file_path: str
    title: str


class FolderInfo(BaseModel):
    name: str
    count: int
    description: str = ""


class CreateFolderRequest(BaseModel):
    name: str
    description: str = ""


class EntryInfo(BaseModel):
    id: str
    preview: str
    folder: str
    timestamp: str
    title: str


# ═══════════════════════════════════════════════════════════════════════════
# API ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@app.post("/api/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(
    audio: UploadFile = File(...),
    folder: str = Form("inbox"),
    timestamp: str = Form(None)
):
    """Transcribe audio file using Whisper"""
    if whisper_model is None:
        raise HTTPException(status_code=503, detail="Whisper model not loaded")

    # Save uploaded file temporarily
    temp_path = f"/tmp/{uuid.uuid4()}.webm"
    try:
        async with aiofiles.open(temp_path, "wb") as f:
            content = await audio.read()
            await f.write(content)

        # Transcribe using Whisper
        result = whisper_model.transcribe(temp_path)

        return TranscriptionResponse(
            transcript=result["text"].strip(),
            timestamp=timestamp or datetime.now().isoformat(),
            duration=result.get("duration", 0)
        )
    finally:
        # Clean up temp file
        if os.path.exists(temp_path):
            os.remove(temp_path)


@app.post("/api/process", response_model=ProcessResponse)
async def process_transcript(request: ProcessRequest):
    """Process transcript with AI to categorize and save"""

    # Read README for folder context
    readme_content = get_readme_content()

    # Call nano-gpt API
    ai_response = await call_ai(request.transcript, readme_content, request.folder)

    # Parse AI response
    parsed = parse_ai_response(ai_response, request.folder)

    # Generate unique ID
    entry_id = str(uuid.uuid4())[:8]

    # Create filename
    dt = datetime.fromisoformat(request.timestamp.replace("Z", "+00:00"))
    filename = f"{dt.strftime('%Y-%m-%d_%H-%M-%S')}_{parsed['slug']}.md"

    # Save the note
    folder_path = Path(settings.data_dir) / parsed["folder"]
    folder_path.mkdir(exist_ok=True)
    file_path = folder_path / filename

    note_content = create_note_content(
        transcript=request.transcript,
        timestamp=request.timestamp,
        title=parsed["title"],
        folder=parsed["folder"],
        summary=parsed.get("summary", "")
    )

    async with aiofiles.open(file_path, "w") as f:
        await f.write(note_content)

    return ProcessResponse(
        id=entry_id,
        preview=parsed.get("summary", request.transcript[:100]),
        folder=parsed["folder"],
        file_path=str(file_path),
        title=parsed["title"]
    )


def get_readme_content() -> str:
    """Read the README file for AI context"""
    readme_path = Path(settings.data_dir) / "README.md"
    if readme_path.exists():
        with open(readme_path) as f:
            return f.read()
    return ""


async def call_ai(transcript: str, readme_content: str, default_folder: str) -> str:
    """Call nano-gpt API to process the transcript"""

    if not settings.nano_gpt_api_key:
        # Return a mock response if no API key
        return json.dumps({
            "folder": default_folder,
            "title": transcript[:30] + "..." if len(transcript) > 30 else transcript,
            "summary": transcript[:100],
            "slug": "note"
        })

    system_prompt = f"""You are an AI assistant that helps organize voice notes into folders.

Based on the folder structure described below, analyze the transcript and decide:
1. Which folder it belongs in
2. A short title (max 50 chars)
3. A brief summary (max 100 chars)
4. A URL-safe slug for the filename (lowercase, hyphens, max 30 chars)

## Folder Structure:
{readme_content}

Respond with JSON only:
{{"folder": "folder_name", "title": "Short Title", "summary": "Brief summary", "slug": "url-safe-slug"}}"""

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                settings.nano_gpt_api_url,
                headers={
                    "Authorization": f"Bearer {settings.nano_gpt_api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "gpt-4o-mini",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": f"Transcript: {transcript}"}
                    ],
                    "max_tokens": 200
                }
            )

            if response.status_code == 200:
                data = response.json()
                return data["choices"][0]["message"]["content"]
            else:
                print(f"AI API error: {response.status_code} - {response.text}")
                return json.dumps({
                    "folder": default_folder,
                    "title": transcript[:30],
                    "summary": transcript[:100],
                    "slug": "note"
                })
    except Exception as e:
        print(f"AI API error: {e}")
        return json.dumps({
            "folder": default_folder,
            "title": transcript[:30],
            "summary": transcript[:100],
            "slug": "note"
        })


def parse_ai_response(response: str, default_folder: str) -> dict:
    """Parse the AI response JSON"""
    try:
        # Extract JSON from response (in case there's extra text)
        start = response.find("{")
        end = response.rfind("}") + 1
        if start >= 0 and end > start:
            data = json.loads(response[start:end])
            return {
                "folder": data.get("folder", default_folder),
                "title": data.get("title", "Untitled"),
                "summary": data.get("summary", ""),
                "slug": data.get("slug", "note")
            }
    except json.JSONDecodeError:
        pass

    return {
        "folder": default_folder,
        "title": "Untitled",
        "summary": "",
        "slug": "note"
    }


def create_note_content(
    transcript: str,
    timestamp: str,
    title: str,
    folder: str,
    summary: str
) -> str:
    """Create markdown note content"""
    dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    formatted_date = dt.strftime("%B %d, %Y at %I:%M %p")

    return f"""# {title}

**Date:** {formatted_date}
**Folder:** {folder}

---

{transcript}

---

*Captured with Cortex*
"""


@app.get("/api/folders", response_model=list[FolderInfo])
async def list_folders():
    """List all folders with entry counts"""
    data_path = Path(settings.data_dir)
    folders = []

    for item in data_path.iterdir():
        if item.is_dir() and not item.name.startswith("."):
            count = len(list(item.glob("*.md")))
            folders.append(FolderInfo(
                name=item.name,
                count=count,
                description=""
            ))

    # Sort with inbox first, then alphabetically
    folders.sort(key=lambda f: (f.name != "inbox", f.name))
    return folders


@app.post("/api/folders", response_model=FolderInfo)
async def create_folder(request: CreateFolderRequest):
    """Create a new folder"""
    folder_name = request.name.lower().replace(" ", "-")
    folder_path = Path(settings.data_dir) / folder_name

    if folder_path.exists():
        raise HTTPException(status_code=400, detail="Folder already exists")

    folder_path.mkdir(parents=True)

    return FolderInfo(
        name=folder_name,
        count=0,
        description=request.description
    )


@app.get("/api/entries", response_model=list[EntryInfo])
async def list_entries(folder: Optional[str] = None, limit: int = 10):
    """List recent entries, optionally filtered by folder"""
    data_path = Path(settings.data_dir)
    entries = []

    # Get all markdown files
    if folder:
        folder_path = data_path / folder
        if folder_path.exists():
            files = list(folder_path.glob("*.md"))
        else:
            files = []
    else:
        files = list(data_path.glob("*/*.md"))

    # Sort by modification time (newest first)
    files.sort(key=lambda f: f.stat().st_mtime, reverse=True)

    for file_path in files[:limit]:
        try:
            async with aiofiles.open(file_path) as f:
                content = await f.read()

            # Parse the markdown
            lines = content.split("\n")
            title = lines[0].lstrip("# ").strip() if lines else "Untitled"

            # Get preview (first paragraph after the separator)
            separator_idx = content.find("---")
            if separator_idx > 0:
                after_sep = content[separator_idx + 3:].strip()
                second_sep = after_sep.find("---")
                preview_text = after_sep[:second_sep].strip() if second_sep > 0 else after_sep[:100]
            else:
                preview_text = content[:100]

            # Get timestamp from filename
            filename = file_path.stem
            parts = filename.split("_")
            if len(parts) >= 2:
                date_str = parts[0]
                time_str = parts[1].replace("-", ":")
                timestamp = f"{date_str}T{time_str}"
            else:
                timestamp = datetime.fromtimestamp(file_path.stat().st_mtime).isoformat()

            entries.append(EntryInfo(
                id=filename[:8],
                preview=preview_text[:100],
                folder=file_path.parent.name,
                timestamp=timestamp,
                title=title
            ))
        except Exception as e:
            print(f"Error reading {file_path}: {e}")
            continue

    return entries


# ═══════════════════════════════════════════════════════════════════════════
# STATIC FILES & FRONTEND
# ═══════════════════════════════════════════════════════════════════════════

# Mount static files for frontend
frontend_path = Path(__file__).parent.parent / "frontend"
if frontend_path.exists():
    app.mount("/icons", StaticFiles(directory=frontend_path / "icons"), name="icons")

    @app.get("/manifest.json")
    async def manifest():
        return FileResponse(frontend_path / "manifest.json")

    @app.get("/sw.js")
    async def service_worker():
        return FileResponse(frontend_path / "sw.js", media_type="application/javascript")

    @app.get("/styles.css")
    async def styles():
        return FileResponse(frontend_path / "styles.css", media_type="text/css")

    @app.get("/app.js")
    async def app_js():
        return FileResponse(frontend_path / "app.js", media_type="application/javascript")

    @app.get("/")
    async def index():
        return FileResponse(frontend_path / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
