/**
 * Dockerfile definition for the ClashCode sandbox container.
 */

export const IMAGE_NAME = 'clashcode-sandbox'

export const DOCKERFILE = `FROM debian:bookworm-slim

# Avoid interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install base packages
RUN apt-get update && apt-get install -y --no-install-recommends \\
    curl \\
    git \\
    build-essential \\
    python3 \\
    python3-pip \\
    ripgrep \\
    ca-certificates \\
    gnupg \\
  && rm -rf /var/lib/apt/lists/*

# Install Node.js 20.x via NodeSource
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \\
  && apt-get install -y --no-install-recommends nodejs \\
  && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -u 1000 -s /bin/bash sandbox

# Create workspace directory
RUN mkdir -p /workspace && chown sandbox:sandbox /workspace

WORKDIR /workspace

USER sandbox
`
