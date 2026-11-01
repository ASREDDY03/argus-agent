# ── Build stage: install Python dependencies into an isolated virtualenv ───────
# Using a virtualenv makes the installed packages trivially portable — the
# entire /opt/venv directory is copied to the runtime stage, leaving pip and
# any native build tools behind.
FROM python:3.10-slim AS builder
WORKDIR /app
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Runtime stage ─────────────────────────────────────────────────────────────
# pip, setuptools, and wheel are not present — only the installed packages and
# the application code are in this layer.
FROM python:3.10-slim AS runtime
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /app
COPY app.py .
RUN adduser --system --group appuser
USER appuser
EXPOSE 8000
CMD ["gunicorn", "--workers", "2", "--bind", "0.0.0.0:8000", "app:app"]
