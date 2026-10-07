FROM python:3.12-slim-bookworm
LABEL org.opencontainers.image.title="DatabaseDoc" \
    org.opencontainers.image.description="Database documentation and central data warehouse planning" \
    org.opencontainers.image.source="https://github.com/phillipunzen/database_doc" \
    org.opencontainers.image.url="https://github.com/phillipunzen/database_doc"
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg unixodbc tzdata fonts-dejavu-core && \
    curl -fsSL https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb -o /tmp/ms.deb && \
    dpkg -i /tmp/ms.deb && rm /tmp/ms.deb && apt-get update && \
    ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock
COPY app ./app
RUN useradd -r -u 10001 appuser
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health', timeout=4)"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-server-header", "--no-access-log"]
