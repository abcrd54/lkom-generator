FROM golang:1.24-alpine AS builder
WORKDIR /app
RUN go mod init go-proxy
RUN go get github.com/aws/aws-sdk-go-v2/aws github.com/aws/aws-sdk-go-v2/config github.com/aws/aws-sdk-go-v2/credentials github.com/aws/aws-sdk-go-v2/service/s3
COPY main.go .
RUN CGO_ENABLED=0 go build -o go-proxy main.go

FROM alpine:latest
RUN apk --no-cache add ca-certificates
COPY --from=builder /app/go-proxy /usr/local/bin/go-proxy
ENV PORT=20129
EXPOSE 20129
CMD ["go-proxy"]
