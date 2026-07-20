#!/bin/bash

# Exit on error, treat unset vars as errors, fail on pipeline errors
set -euo pipefail

# Load environment variables from .env file if it exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | sed 's/#.*//' | xargs)
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print status
print_status() {
    echo -e "${GREEN}==>${NC} $1"
}

# Function to print info
print_info() {
    echo -e "${BLUE}==>${NC} $1"
}

# Function to print warning
print_warning() {
    echo -e "${YELLOW}==>${NC} $1"
}

# Function to print error
print_error() {
    echo -e "${RED}Error:${NC} $1"
}

# Clear output directory
clear_output_dir() {
    print_status "Clearing output directory..."
    
    if [ -d "dist" ]; then
        print_info "Removing existing dist directory..."
        rm -rf dist
    fi
    
    print_info "Output directory cleared"
}

# Load NVM and Node.js environment
setup_node_env() {
    print_info "Setting up Node.js environment..."
    export NVM_DIR="$HOME/.nvm"
    if [ -d "$NVM_DIR" ] && [ -s "$NVM_DIR/nvm.sh" ]; then
        \. "$NVM_DIR/nvm.sh"
        [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
        print_info "NVM environment loaded"
    else
        print_info "NVM not found or using system Node.js"
    fi
}

# Load Rust environment
setup_rust_env() {
    print_info "Setting up Rust environment..."
    if [ -s "$HOME/.cargo/env" ]; then
        source "$HOME/.cargo/env"
    else
        print_info "Rust environment file not found, using system Rust"
    fi
}

# Check if required tools are installed
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Ensure bun is on PATH if installed via installer
    if ! command -v bun &> /dev/null && [ -x "$HOME/.bun/bin/bun" ]; then
        export PATH="$HOME/.bun/bin:$PATH"
    fi

    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed or not in PATH"
        exit 1
    fi
    
    if ! command -v bun &> /dev/null; then
        print_error "Bun is not installed or not in PATH"
        exit 1
    fi
    
    if ! command -v rustc &> /dev/null; then
        print_error "Rust is not installed or not in PATH"
        exit 1
    fi
    
    if ! command -v cargo &> /dev/null; then
        print_error "Cargo is not installed or not in PATH"
        exit 1
    fi
    
    print_info "Node.js version: $(node --version)"
    print_info "Bun version: $(bun --version)"
    print_info "Rust version: $(rustc --version)"
    print_info "Cargo version: $(cargo --version)"
}

# Build native Rust modules
build_native_modules() {
    local platform=$1
    print_status "Building native Rust modules for $platform..."
    
    case $platform in
        "mac")
            # Build for both architectures for release
            ./build-binaries.sh --mac
            ./build-binaries.sh --mac --x64
            ;;
        "windows")
            ./build-binaries.sh --windows
            ;;
        "all")
            # Build for all platforms and architectures for release
            ./build-binaries.sh --mac
            ./build-binaries.sh --mac --x64
            ./build-binaries.sh --windows
            ;;
        *)
            print_error "Invalid platform: $platform. Use 'mac', 'windows', or 'all'"
            exit 1
            ;;
    esac
    
    print_status "Native modules built successfully!"
}

# Build Electron application
build_electron_app() {
    print_status "Building Electron application..."
    
    # Install dependencies if node_modules doesn't exist
    if [ ! -d "node_modules" ]; then
        print_info "Installing dependencies..."
        bun install
    fi
    
    # Build the application using electron-vite
    print_info "Building application with Electron Vite..."
    bun run electron-vite build
    
    print_status "Electron application built successfully!"
}

# Create macOS DMG installer
create_dmg() {
    print_status "Creating macOS DMG installer..."
    
    # Determine stage and handle notarization: only enforce in prod
    local stage="${ITO_ENV:-prod}"
    if [ "$stage" = "prod" ]; then
      if [ -z "$APPLE_ID" ] || [ -z "$APPLE_APP_SPECIFIC_PASSWORD" ] || [ -z "$APPLE_TEAM_ID" ]; then
        print_error "Prod build requires notarization credentials (APPLE_ID, APPLE_TEAM_ID, APPLE_APP_SPECIFIC_PASSWORD)."
        exit 1
      else
        print_info "Prod build: notarization credentials found."
      fi
    else
      print_info "Non-prod build ('$stage'): skipping notarization and code signing auto-discovery."
      export CSC_IDENTITY_AUTO_DISCOVERY=false
    fi
    
    print_info "Packaging application with Electron Builder (forcing DMG target)..."
    # Ensure Vite embeds the stage for runtime
    if [ -z "${VITE_ITO_ENV:-}" ]; then
      export VITE_ITO_ENV="${ITO_ENV:-dev}"
      print_info "Set VITE_ITO_ENV=${VITE_ITO_ENV} for build-time embedding"
    fi
    bun run electron-vite build
    bunx electron-builder --config electron-builder.config.js --mac dmg zip --universal --publish=never
    
    print_status "macOS DMG installer created successfully!"
    
    # Show output location and stage-specific DMG name
    if [ -d "dist" ]; then
        print_info "Build output location: $(pwd)/dist"
        local dmg_name
        if [ "$stage" = "prod" ]; then
          dmg_name="Ito-Installer.dmg"
        else
          dmg_name="Ito-${stage}-Installer.dmg"
        fi
        ls -la "dist/${dmg_name}" 2>/dev/null || print_warning "${dmg_name} not found in dist directory"
    fi
}

# Detect whether we are running on a Windows host (MinGW/MSYS2 shell)
is_windows_host() {
    [[ "${OSTYPE:-}" == "msys" ]] || [[ "${OSTYPE:-}" == "win32" ]] || [[ "${OS:-}" == "Windows_NT" ]]
}

# Package the Windows app natively (Windows host only: no Docker, no wine)
build_windows_native() {
    print_info "Windows host detected: packaging natively (no Docker)..."

    # Use the shared system cache so Electron/NSIS are not re-downloaded every build
    unset ELECTRON_BUILDER_CACHE || true

    # electron-builder does not recognise bun.lock, so it falls back to probing the
    # environment and picks pnpm whenever PNPM_HOME is set. pnpm then refuses to run
    # because package.json still declares "packageManager": "yarn". Pin the npm
    # collector instead: bun installs a hoisted, npm-like node_modules layout, and this
    # is the same collector the Docker build ends up using.
    unset PNPM_HOME || true
    export npm_config_user_agent="npm"

    local targets="nsis"
    if [ "$WITH_ZIP" = true ]; then
        targets="nsis zip"
    else
        print_info "Building NSIS installer only (pass --with-zip to also produce the .zip)"
    fi

    # shellcheck disable=SC2086
    bunx electron-builder --config electron-builder.config.js --win $targets --x64 --publish=never
}

# Package the Windows app through Docker + wine (cross-compilation from macOS/Linux)
build_windows_docker() {
    print_info "Using Docker for Windows build on ${OSTYPE:-unknown}..."

    # Set npm config to avoid symlink issues on Windows
    export npm_config_cache=$PWD/.npm-cache
    export ELECTRON_BUILDER_CACHE=$PWD/.electron-builder-cache

    # Check if Docker is available
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker Desktop."
        exit 1
    fi
    
    # Check if Docker is running (skip in CI environments)
    if [ -z "${CI:-}" ] && ! docker info &> /dev/null; then
        print_error "Docker is not running. Please start Docker."
        exit 1
    fi
    
    # Use Docker for cross-compilation with ARM64 compatibility and bun
    # Get absolute path in a cross-platform way
    if [[ "$OSTYPE" == "msys" ]]; then
        # On MinGW/MSYS2, convert to Windows path format for Docker
        PROJECT_PATH="$(cygpath -w "$(pwd)" | sed 's|\\|/|g')"
    else
        PROJECT_PATH="$(pwd)"
    fi
    
    docker run --rm --platform linux/amd64 \
      --env CSC_IDENTITY_AUTO_DISCOVERY=false \
      --env SKIP_SIGNING=true \
      --env VITE_ITO_VERSION="${VITE_ITO_VERSION:-}" \
      --env ITO_ENV="${ITO_ENV:-}" \
      --env VITE_ITO_ENV="${VITE_ITO_ENV:-}" \
      -v "${PROJECT_PATH}":/project \
      electronuserland/builder:wine \
      bash -euo pipefail -c "
        set -euo pipefail
        # Install bun with retry
        curl -fsSL https://bun.sh/install | bash || curl -fsSL https://bun.sh/install | bash
        export PATH=\"/root/.bun/bin:\$PATH\"
        
        # Verify bun installation
        bun --version
        
        # Use container-local output to avoid host AV deleting electron.exe mid-build
        OUT_DIR=\"/tmp/ito-dist\"
        rm -rf \"\$OUT_DIR\"

        # Change to project and debug file paths
        cd /project
        echo 'Current directory:' \$(pwd)
        echo 'Directory contents:'
        ls -la
        
        # Install dependencies (let SQLite3 use prebuilt binaries for Electron)
        export npm_config_target_platform=win32
        export npm_config_target_arch=x64
        export npm_config_runtime=electron

        export npm_config_electron_version=\$(node -p \"require('./package.json').devDependencies.electron.replace('^', '')\")
        bun install || bun install --force || bun install
        
        # Run electron-builder
        bunx electron-builder --config electron-builder.config.js --win --x64 --publish=never -c.directories.output=\"\$OUT_DIR\"

        # Copy artifacts back to mounted workspace
        mkdir -p /project/dist
        cp -r \"\$OUT_DIR\"/* /project/dist/

        # Copy versioned installer to static name for CDN (supports prod and dev names)
        exe_path=\$(ls -t /project/dist/Ito*.exe 2>/dev/null | head -n 1)
        if [ -n \"\$exe_path\" ]; then
          dest_name=\$([ \"\${ITO_ENV:-dev}\" = \"prod\" ] && echo \"Ito-Installer.exe\" || echo \"Ito-\${ITO_ENV}-Installer.exe\")
          echo \"Copying \$exe_path to dist/\$dest_name for CDN\"
          cp \"\$exe_path\" \"/project/dist/\$dest_name\"
        else
          echo 'No Windows installer .exe found to copy'
        fi
      "
}

# Copy the versioned installer to a stable name (used by the CDN and for local installs)
copy_installer_static_name() {
    local exe_path
    exe_path=$(ls -t dist/Ito*.exe 2>/dev/null | grep -v 'Ito-Installer.exe' | head -n 1 || true)

    if [ -z "$exe_path" ]; then
        print_warning "No Windows installer .exe found to copy"
        return
    fi

    local dest_name
    if [ "${ITO_ENV:-dev}" = "prod" ]; then
        dest_name="Ito-Installer.exe"
    else
        dest_name="Ito-${ITO_ENV}-Installer.exe"
    fi

    print_info "Copying $exe_path to dist/$dest_name"
    cp "$exe_path" "dist/$dest_name"
}

# Create Windows installer
create_windows_installer() {
    print_status "Creating Windows installer..."

    print_info "Packaging application with Electron Builder..."
    # Ensure Vite embeds the stage for runtime
    if [ -z "${VITE_ITO_ENV:-}" ]; then
      export VITE_ITO_ENV="${ITO_ENV:-dev}"
      print_info "Set VITE_ITO_ENV=${VITE_ITO_ENV} for build-time embedding"
    fi
    bun run electron-vite build

    # Disable code signing completely
    export CSC_IDENTITY_AUTO_DISCOVERY=false
    export CSC_LINK=""
    export CSC_KEY_PASSWORD=""
    export SKIP_SIGNING=true
    export WIN_CSC_LINK=""

    # Native packaging on a Windows host is dramatically faster than Docker + wine,
    # which exists only to cross-compile from macOS/Linux.
    if is_windows_host && [ "$FORCE_DOCKER" = false ]; then
        build_windows_native
    else
        build_windows_docker
    fi

    copy_installer_static_name

    print_status "Windows installer created successfully!"

    # Show output location
    if [ -d "dist" ]; then
        print_info "Build output location: $(pwd)/dist"
        ls -la dist/*.exe 2>/dev/null || print_warning "No .exe files found in dist directory"
    fi
}

# Show usage information
show_usage() {
    echo "Usage: $0 [PLATFORM] [OPTIONS]"
    echo ""
    echo "PLATFORMS:"
    echo "  mac, macos          Build for macOS (default)"
    echo "  win, windows        Build for Windows"
    echo ""
    echo "OPTIONS:"
    echo "  --skip-binaries     Skip building native Rust modules"
    echo "  --with-zip          Windows: also build the .zip target (nsis only by default)"
    echo "  --docker            Windows: force the Docker + wine path even on a Windows host"
    echo "  --help, -h          Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                  # Build for macOS"
    echo "  $0 mac              # Build for macOS"
    echo "  $0 windows          # Build for Windows"
    echo "  $0 mac --skip-binaries    # Build macOS without rebuilding Rust modules"
    echo ""
    echo "NOTE: On a Windows host the Windows build runs natively (no Docker, no wine),"
    echo "      which is far faster. Docker is only used to cross-compile from macOS/Linux."
}

# Main build function
main() {
    # Parse command line arguments
    PLATFORM="mac"  # default platform
    SKIP_BINARIES=false
    WITH_ZIP=false
    FORCE_DOCKER=false

    for arg in "$@"; do
        case $arg in
            "mac"|"macos")
                PLATFORM="mac"
                shift
                ;;
            "win"|"windows")
                PLATFORM="windows"
                shift
                ;;
            --skip-binaries)
                SKIP_BINARIES=true
                shift
                ;;
            --with-zip)
                WITH_ZIP=true
                shift
                ;;
            --docker)
                FORCE_DOCKER=true
                shift
                ;;
            --help|-h)
                show_usage
                exit 0
                ;;
            *)
                # Unknown option
                print_warning "Unknown option: $arg"
                ;;
        esac
    done
    
    print_status "Starting Ito $PLATFORM build process..."
    echo
    
    # Clear output directory first
    clear_output_dir
    echo
    
    # In CI, the environment is set up by the workflow.
    if [ -z "${CI:-}" ]; then
        # Setup environments
        setup_node_env
        setup_rust_env
    fi
    
    # Check prerequisites
    check_prerequisites
    echo
    
    # Build native modules (unless skipped)
    if [ "$SKIP_BINARIES" = false ]; then
        case $PLATFORM in
            "mac")
                build_native_modules "mac"
                ;;
            "windows")
                build_native_modules "windows"
                ;;
        esac
        echo
    else
        print_info "Skipping native modules build (--skip-binaries flag passed)"
        echo
    fi
    
    # Build for the specified platform(s)
    case $PLATFORM in
        "mac")
            create_dmg
            echo
            print_status "macOS build process completed successfully! 🎉"
            if [ -z "${ITO_ENV:-}" ] || [ "${ITO_ENV}" = "prod" ]; then
              print_info "Your DMG installer is ready: dist/Ito-Installer.dmg"
            else
              print_info "Your DMG installer is ready: dist/Ito-${ITO_ENV}-Installer.dmg"
            fi
            ;;
        "windows")
            create_windows_installer
            echo
            print_status "Windows build process completed successfully! 🎉"
            print_info "Your Windows installer is ready in the dist/ directory"
            ;;
    esac
}

# Run main function
main "$@"
