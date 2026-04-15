FROM python:3.11-slim

WORKDIR /app

# Install uv
RUN pip install uv --no-cache-dir

# Copy dependency files first for layer caching
COPY pyproject.toml uv.lock ./

# Install dependencies (production only, no dev extras)
RUN uv sync --frozen --no-dev

# Copy source
COPY src/ ./src/

# Expose port
EXPOSE 8000

# Run the FastAPI app
CMD ["uv", "run", "uvicorn", "policy_memo_agent.api.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
