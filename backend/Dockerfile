FROM python:3.12-slim
ARG TARGETARCH
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-rus tesseract-ocr-eng fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
RUN addgroup --system app && adduser --system --ingroup app app && mkdir -p /var/lib/ncrl/files /var/lib/ncrl/models
COPY pyproject.toml ./
COPY --chown=app:app app ./app
# amd64 uses PyTorch's CPU index; PyPI's official aarch64 wheel is CPU-only.
RUN if [ "$TARGETARCH" = "arm64" ]; then pip install --no-cache-dir torch==2.8.0; else pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.8.0; fi && pip install --no-cache-dir .
COPY --chown=app:app alembic ./alembic
COPY --chown=app:app alembic.ini ./alembic.ini
COPY --chown=app:app tests ./tests
COPY entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
