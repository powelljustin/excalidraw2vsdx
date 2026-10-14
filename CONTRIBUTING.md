# Contributing

Thanks for looking at excalidraw2vsdx. Issues and pull requests are welcome.

## Setup

Install Node.js 20 or newer, then:

```bash
git clone https://github.com/powelljustin/excalidraw2vsdx.git
cd excalidraw2vsdx
npm install
```

## Checks

Before you open a pull request:

```bash
npm test
npm run build
npm run build:web
```

`npm test` is the unit and integration suite. It converts the sample drawings in `test/fixtures/`. If LibreOffice (`soffice`) and `pdftoppm` are installed, it also renders those drawings to PNG. That render step is skipped when LibreOffice is absent, including on the GitHub Actions runner.

The GitHub workflow runs `npm ci`, `npm test`, `npm run build`, `npm run build:web`, and `docker build`.

## What to change

- Converter behavior lives in `src/`. The command-line wrapper is `cli/excalidraw2vsdx.ts`. The browser page is `web/`.
- Add or adjust a Vitest test in `test/` when you change mapping, geometry, or package output.
- The sample drawings are `test/fixtures/pi-audio-chain.excalidraw` and `test/fixtures/home-network.excalidraw`. Keep them free of third-party product names that we do not have the right to publish.
- Preview images in `docs/images/` are the source geometry stacked above a LibreOffice render of the `.vsdx`. Regenerate them when a change is visible in those drawings.
- User-facing behavior belongs in `README.md`. Docker steps belong in `docs/DOCKER.md`. Note a user-visible change in `CHANGELOG.md`.

## Pull requests

Branch from `main`. Describe what changed and how you checked it. A focused change is easier to review than a mixed one.

Do not commit `node_modules/`, `dist/`, `dist-web/`, or generated `.vsdx` files. Those are gitignored.

## License

By contributing, you agree that your contribution is licensed under the MIT license in `LICENSE`. Copyright for the project is held by Justin Powell.
