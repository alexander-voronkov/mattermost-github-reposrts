.PHONY: all clean server webapp dist dist-linux

PLUGIN_ID := com.fambear.github-reports
PLUGIN_VERSION := 0.1.0

all: dist

clean:
	rm -rf dist
	rm -rf webapp/dist
	rm -rf webapp/node_modules

server:
	cd server && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o ../plugin-linux-amd64

server-darwin:
	cd server && CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -o ../plugin-darwin-amd64
	cd server && CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -o ../plugin-darwin-arm64

server-windows:
	cd server && CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -o ../plugin-windows-amd64.exe

webapp:
	cd webapp && npm install && npm run build

dist: clean server webapp
	mkdir -p dist
	tar -czf dist/github-reports-$(PLUGIN_VERSION).tar.gz \
		plugin.json \
		plugin-linux-amd64 \
		webapp/

dist-linux: clean
	@echo "Building distribution for Linux AMD64..."
	cd server && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o ../plugin-linux-amd64
	cd webapp && npm install && npm run build
	mkdir -p dist
	tar -czf dist/github-reports-$(PLUGIN_VERSION).tar.gz \
		plugin.json \
		plugin-linux-amd64 \
		webapp/
	@echo "Distribution created: dist/github-reports-$(PLUGIN_VERSION).tar.gz"
