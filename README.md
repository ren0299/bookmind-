# BookMind

BookMind is an Electron desktop app for reading and organizing books, downloading chapters from supported public novel websites, and generating AI chapter summaries.

## Features

- Import and read PDF books.
- Keep a local library of PDF and TXT books, with reading progress saved on this device.
- Parse public novel catalogs from supported websites, download chapters, resume interrupted tasks, and export books as UTF-8 TXT files.
- Configure per-site download concurrency, request spacing, retry behavior, and site pause state.
- Preview public pages and import saved HTML for adapter analysis when a site permits that workflow.
- Use the AI Workbench to analyze TXT chapters with Google Gemini. Chapter summaries and job progress are stored locally and can resume after an app restart.

Website support depends on each site's public page structure and access rules. The project includes adapters for Project Gutenberg and jpxs123.com, plus user-created adapters that must be validated against real catalog and chapter pages. BookMind does not bypass login requirements, paywalls, CAPTCHA, or other access controls.

## Technology

- Electron for the desktop shell and main process.
- React and TypeScript for the user interface and shared types.
- Vite for development and production builds.
- SQLite (`node:sqlite`) for AI analysis jobs and chapter summaries.
- Local JSON files and files under Electron's `userData` directory for library, download-task, and integration settings.
- `pdfjs-dist` for PDF rendering and `cheerio` for static HTML parsing.

## Requirements

- Node.js and npm versions compatible with the dependencies in `package.json`.
- A supported desktop environment for Electron.

## Getting started

Install dependencies:

```bash
npm install
```

Start the development app (Vite also launches Electron):

```bash
npm run dev
```

Create a production build and launch it locally:

```bash
npm run build
npm start
```

## AI setup and API keys

Configure an AI provider in **Novel Downloader → API Settings**. Chapter analysis currently requires Google Gemini. API keys are encrypted with Electron `safeStorage` and kept in the local application data directory; they are not part of the source repository. Do not add API keys, `.env` files, local application data, or diagnostic exports to a commit.

## Tests and linting

```bash
npm test
npm run lint
npm run build
```

## Local data

The library state, download tasks and chapter files, AI provider settings, adapter data, and SQLite analysis database are stored locally in Electron's `userData` directory. Downloaded book exports are also written to the configured local documents folder. These files are not required to build the application and should not be committed.

## Project status

BookMind is under active development. Supported sites, parsing behavior, and AI features can change as the project evolves. Whole-book question answering, vector search, and character relationship graphs are not currently included.
