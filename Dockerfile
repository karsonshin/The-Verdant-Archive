# Static site image. Build context is the repo root; .dockerignore keeps the private originals and tooling out.
FROM nginxinc/nginx-unprivileged:1.27-alpine
# Pull in the latest security fixes for the system packages in the base image (the scan in .github/workflows/security.yml fails on fixable HIGH/CRITICAL issues), then drop back to the unprivileged user.
USER root
RUN apk upgrade --no-cache
USER 101
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html site.config.json /usr/share/nginx/html/
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js
COPY data /usr/share/nginx/html/data
COPY media /usr/share/nginx/html/media
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
