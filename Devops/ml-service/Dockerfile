FROM python:3.10-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
RUN adduser --system --group appuser
USER appuser
EXPOSE 8000
CMD ["gunicorn", "--workers", "2", "--bind", "0.0.0.0:8000", "app:app"]
