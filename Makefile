SHELL := /bin/bash

.DEFAULT_GOAL := help

GO ?= go
NPM ?= npm
DOCKER_COMPOSE ?= docker compose

WEB_DIR := web
WEB_DIST := $(WEB_DIR)/dist/index.html
MANAGEMENT_ASSET := internal/managementasset/management.html
BINARY ?= CLIProxyAPI

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo none)
BUILD_DATE ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)

GO_LDFLAGS := -s -w -X 'main.Version=$(VERSION)' -X 'main.Commit=$(COMMIT)' -X 'main.BuildDate=$(BUILD_DATE)'

.PHONY: \
	help \
	print-build-meta \
	web-install \
	web-dev \
	web-build \
	web-preview \
	web-lint \
	web-format \
	web-type-check \
	build-web-embed \
	build-go \
	build \
	run \
	test-go \
	test-web \
	test \
	refresh-models \
	docker-build \
	docker-up \
	docker-up-local \
	docker-logs \
	clean

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*## "}; /^[a-zA-Z0-9_.-]+:.*## / {printf "%-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST) | sort

print-build-meta: ## Print resolved build metadata
	@echo "VERSION=$(VERSION)"
	@echo "COMMIT=$(COMMIT)"
	@echo "BUILD_DATE=$(BUILD_DATE)"
	@echo "BINARY=$(BINARY)"

web-install: ## Install Web UI dependencies
	cd $(WEB_DIR) && $(NPM) ci

web-dev: web-install ## Start the Web UI dev server
	cd $(WEB_DIR) && $(NPM) run dev

web-build: web-install ## Build the Web UI single-file bundle
	cd $(WEB_DIR) && $(NPM) run build

web-preview: web-build ## Preview the built Web UI
	cd $(WEB_DIR) && $(NPM) run preview

web-lint: web-install ## Lint the Web UI
	cd $(WEB_DIR) && $(NPM) run lint

web-format: web-install ## Format the Web UI source files
	cd $(WEB_DIR) && $(NPM) run format

web-type-check: web-install ## Type-check the Web UI
	cd $(WEB_DIR) && $(NPM) run type-check

build-web-embed: web-build ## Copy the built Web UI into the embedded management asset
	cp $(WEB_DIST) $(MANAGEMENT_ASSET)

build-go: ## Build the Go server binary with version metadata
	$(GO) build -ldflags="$(GO_LDFLAGS)" -o $(BINARY) ./cmd/server

build: build-web-embed build-go ## Build the embedded Web UI and Go server binary

run: ## Run the Go server without rebuilding assets
	$(GO) run ./cmd/server

test-go: ## Run Go tests
	$(GO) test ./...

test-web: web-type-check web-lint ## Run Web UI checks

test: test-go test-web ## Run Go tests and Web UI checks

refresh-models: ## Refresh the embedded model catalog from router-for-me/models
	git fetch --depth 1 https://github.com/router-for-me/models.git main
	git show FETCH_HEAD:models.json > internal/registry/models/models.json

docker-build: ## Build the Docker image with current build metadata
	VERSION="$(VERSION)" COMMIT="$(COMMIT)" BUILD_DATE="$(BUILD_DATE)" $(DOCKER_COMPOSE) build

docker-up: ## Start the Docker service
	$(DOCKER_COMPOSE) up -d --remove-orphans

docker-up-local: ## Start the locally built Docker image without pulling
	CLI_PROXY_IMAGE=cli-proxy-api:local $(DOCKER_COMPOSE) up -d --remove-orphans --pull never

docker-logs: ## Follow Docker logs
	$(DOCKER_COMPOSE) logs -f

clean: ## Remove local build outputs
	rm -f $(BINARY)
	rm -rf $(WEB_DIR)/dist
