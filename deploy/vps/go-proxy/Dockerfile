FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY main.go .
RUN CGO_ENABLED=0 go build -o go-proxy main.go

FROM alpine:latest
RUN apk --no-cache add ca-certificates
RUN mkdir -p /data/images
COPY --from=builder /app/go-proxy /usr/local/bin/go-proxy
VOLUME ["/data/images"]
ENV PORT=20129
EXPOSE 20129
CMD ["go-proxy"]
