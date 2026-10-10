FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=7860 \
    REQUIRE_DATABASE_URL=1

RUN useradd --create-home --uid 1000 user

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH
WORKDIR /home/user/app

COPY --chown=user requirements.txt .
RUN pip install --user --no-cache-dir -r requirements.txt

COPY --chown=user . .
RUN chmod +x start.sh

EXPOSE 7860

CMD ["./start.sh"]
