# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, email **private4445@gmail.com** with:

- A description of the vulnerability
- Steps to reproduce it
- The potential impact

You will receive a response within 72 hours. If the issue is confirmed, a fix will be released as soon as possible and you will be credited in the release notes (unless you prefer to remain anonymous).

## Scope

This plugin runs locally inside Claude Code. It:

- Reads and writes files under `.claude/sessions/` in your project directory
- Makes one outbound HTTPS request to fetch current model pricing from the LiteLLM repository (`raw.githubusercontent.com`) — this request carries no user data and can be disabled by blocking the URL at the network level; the plugin falls back to its hardcoded pricing table
- Does not transmit session data, token counts, or cost figures to any external service
- Does not store credentials or API keys

## Out of scope

- Vulnerabilities in Claude Code itself — report those to Anthropic
- Issues that require physical access to the machine
- Social engineering

