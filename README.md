# Cortex

A voice-powered brain dump and memory extension app. Record your thoughts on your phone, and let AI transcribe and organize them automatically.

## Features

- **PWA Voice Recorder** - Install on your phone, record thoughts anywhere
- **Whisper Transcription** - Accurate, local speech-to-text using OpenAI's Whisper
- **AI-Powered Organization** - Automatically categorizes notes into folders
- **Offline Support** - Record even without internet, sync when connected
- **Self-Hosted** - Your data stays on your server

## Quick Start

1. **Clone and configure**
   ```bash
   git clone git@github.com:YourBr0ther/cortex.git
   cd cortex
   cp .env.example .env
   # Edit .env and add your NANO_GPT_API_KEY
   ```

2. **Start with Docker Compose**
   ```bash
   docker-compose up -d
   ```

3. **Access the app**
   - Open `http://your-server:8000` on your phone
   - Add to Home Screen for PWA experience

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NANO_GPT_API_KEY` | API key from nano-gpt.com | Required |
| `WHISPER_MODEL` | Whisper model size (tiny/base/small/medium/large) | `base` |
| `DATA_DIR` | Directory for storing notes | `/data` |

### Whisper Model Selection

| Model | Size | Speed | Accuracy | RAM |
|-------|------|-------|----------|-----|
| tiny | 39M | Fastest | Good | ~1GB |
| base | 74M | Fast | Better | ~1GB |
| small | 244M | Medium | Great | ~2GB |
| medium | 769M | Slow | Excellent | ~5GB |
| large | 1550M | Slowest | Best | ~10GB |

## Folder Organization

Notes are automatically organized into folders. The AI reads the `data/README.md` file to understand your folder structure.

### Default Folders

- **inbox/** - Uncategorized thoughts
- **ideas/** - Creative concepts and brainstorms
- **tasks/** - Action items and to-dos
- **journal/** - Personal reflections

### Custom Folders

1. Create a new folder through the app or manually in `data/`
2. Edit `data/README.md` to describe what the folder is for
3. The AI will use your description to categorize future notes

## Architecture

```
cortex/
├── frontend/          # PWA frontend
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── manifest.json
│   └── sw.js
├── backend/           # FastAPI backend
│   ├── main.py
│   ├── requirements.txt
│   └── Dockerfile
├── data/              # Your notes (mounted volume)
│   ├── README.md      # Folder descriptions for AI
│   ├── inbox/
│   ├── ideas/
│   ├── tasks/
│   └── journal/
└── docker-compose.yml
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/transcribe` | POST | Upload audio, get transcript |
| `/api/process` | POST | AI categorization and save |
| `/api/folders` | GET | List all folders |
| `/api/folders` | POST | Create new folder |
| `/api/entries` | GET | List recent entries |

## Development

### Local Development

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload

# Frontend is served by the backend
# Open http://localhost:8000
```

### GPU Acceleration

For faster transcription, uncomment the GPU section in `docker-compose.yml` if you have an NVIDIA GPU.

## SSL/HTTPS

For PWA features like microphone access, you need HTTPS. Options:

1. **Cloudflare Tunnel** (recommended)
2. **Caddy reverse proxy** with automatic SSL
3. **nginx with Let's Encrypt**

## Tips for Better Organization

1. **Be clear with intent** - Start with "I have an idea...", "Remind me to...", or "Today I..."
2. **One thought per recording** - Shorter recordings = better categorization
3. **Update the README** - The more context you give the AI, the better it organizes

## Credits

Built with:
- [FastAPI](https://fastapi.tiangolo.com/)
- [OpenAI Whisper](https://github.com/openai/whisper)
- [nano-gpt.com](https://nano-gpt.com)

---

*Capture your thoughts. Let AI do the organizing.*
