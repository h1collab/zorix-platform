# Zorix Platform

**Official Website:** [zorix.it](https://zorix.it)

Zorix Platform is a comprehensive development platform that provides developers with powerful tools, APIs, and utilities for building modern applications. This repository contains the official Zorix Platform client and configuration tools.

## Overview

Zorix Platform enables developers to leverage robust APIs and development utilities through a simple, integrated workflow. Whether you're building web applications, services, or leveraging Zorix's cloud infrastructure, the platform provides everything you need to get started.

## Getting Started

### Step 1: Register for an API Token

To use Zorix Platform APIs, you first need to request an API token:

1. Visit the **Zorix API Platform**: [zorix.it/api-platform](https://zorix.it/api-platform)
2. Complete the registration form with your developer information
3. Upon successful registration, a unique API token will be generated and sent to your registered email
4. Save your API token securely — you'll need it for configuration

### Step 2: Install the Zorix CLI

Install the official Zorix CLI tool globally using npm:

```bash
npm install -g zorix-official
```

This command installs the `zorix-official` CLI package globally on your system, making it accessible from any terminal window.

### Step 3: Configure Your API Token

After installation, configure your API token with the Zorix CLI:

```bash
zorix config set token <YOUR_API_TOKEN>
```

Replace `<YOUR_API_TOKEN>` with the token you received from [zorix.it/api-platform](https://zorix.it/api-platform).

You can verify your configuration at any time:

```bash
zorix config view
```

## API Documentation

Once configured, you have access to the complete Zorix API suite. Visit the [API Documentation](https://zorix.it/docs/api) for detailed endpoint references, authentication details, and code examples.

## Common Commands

```bash
# View your current configuration
zorix config view

# Update your API token
zorix config set token <NEW_TOKEN>

# Initialize a new Zorix project
zorix init

# Deploy your application
zorix deploy

# View available commands
zorix --help
```

## Project Setup

To get started with a new Zorix project in your repository:

```bash
zorix init
```

This command will guide you through the setup process and create the necessary configuration files.

## Features

- **Comprehensive API Suite**: Access to multiple endpoints for various use cases
- **CLI Tools**: Powerful command-line utilities for development and deployment
- **Secure Token Authentication**: Industry-standard token-based authentication
- **Cross-platform Support**: Works on Windows, macOS, and Linux
- **Development & Production**: Seamless transitions between development and production environments

## Support & Documentation

- **Official Website**: [zorix.it](https://zorix.it)
- **API Platform**: [zorix.it/api-platform](https://zorix.it/api-platform)
- **Documentation**: [zorix.it/docs](https://zorix.it/docs)
- **Community**: [zorix.it/community](https://zorix.it/community)

## Requirements

- Node.js 14.x or higher
- npm 6.x or higher
- Valid Zorix API token from [zorix.it/api-platform](https://zorix.it/api-platform)

## Installation Troubleshooting

### Global Installation Issues

If `npm install -g` requires elevated permissions:

```bash
sudo npm install -g zorix-official
```

### Command Not Found

If the `zorix` command is not found after installation, ensure npm's global bin directory is in your PATH:

```bash
npm config get prefix
```

Then add the printed directory to your system PATH.

### Token Configuration Issues

Ensure you've correctly set your token with the exact command:

```bash
zorix config set token YOUR_TOKEN_HERE
```

## Contributing

We welcome contributions to the Zorix Platform ecosystem! Please visit our [GitHub repository](https://github.com/h1collab/zorix-platform) to submit issues, feature requests, and pull requests.

## License

Please refer to the LICENSE file for licensing information.

## Quick Reference

| Task | Command |
|------|---------|
| Register API Token | Visit [zorix.it/api-platform](https://zorix.it/api-platform) |
| Install CLI | `npm install -g zorix-official` |
| Configure Token | `zorix config set token YOUR_TOKEN` |
| View Config | `zorix config view` |
| Get Help | `zorix --help` |
| Initialize Project | `zorix init` |

---

For more information, visit [zorix.it](https://zorix.it)
