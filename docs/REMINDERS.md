## Start NLI backend

```
cd backend
uv run uvicorn policy_memo_agent.api.app:create_app --factory --reload
```

Note: you might have to also run uv sync --extra nli
from backend directory.

## Run

```
npm run pipeline        # real Groq + Gemini calls
npm run dev             # full UI at localhost:3000
```
