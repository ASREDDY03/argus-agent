FROM python:3.10-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && python -c "import nltk; nltk.download('punkt', quiet=True); nltk.download('punkt_tab', quiet=True)"
COPY app.py .
RUN adduser --system --group appuser
USER appuser
EXPOSE 8000
CMD ["python", "app.py"]
