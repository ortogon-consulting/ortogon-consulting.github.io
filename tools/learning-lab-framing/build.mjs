import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import mime from "mime-types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const paths = {
    privateHtmlEn: path.join(repoRoot, "The Learning Lab", "2026-08-26_Ortogon_collective_framing_draft_EN.html"),
    privateHtmlFr: path.join(repoRoot, "The Learning Lab", "2026-08-26_Ortogon_collective_framing_draft_FR.html"),
    privatePdfEn: path.join(repoRoot, "The Learning Lab", "2026-08-26_LearningLab_approach_EN.pdf"),
    privatePdfFr: path.join(repoRoot, "The Learning Lab", "2026-08-26_LearningLab_approach_FR.pdf"),
    privateLearningLogo: path.join(repoRoot, "The Learning Lab", "learning_lab_logo.png"),
    privateOrtogonLogo: path.join(repoRoot, "The Learning Lab", "ortogon_logo.png"),
    publicOrtogonLogo: path.join(repoRoot, "logo.png"),
    template: path.join(__dirname, "password_template.html"),
    tempDir: path.join(__dirname, ".tmp"),
    tempHtml: path.join(__dirname, ".tmp", "index.html"),
    tempTemplate: path.join(__dirname, ".tmp", "password_template.html"),
    outputDir: path.join(repoRoot, "thelearninglab", "approach"),
    outputHtml: path.join(repoRoot, "thelearninglab", "approach", "index.html"),
};

const forbiddenPlaintextPhrases = [
    "Learning Lab appears to be at the intersection of four decisions.",
    "Too early to choose an instrument; too advanced to let the sequence unfold by default.",
    "Fixed-fee mission · CHF 12,500 excl. VAT",
    "Learning Lab semble se trouver à l’intersection de quatre décisions.",
    "Trop tôt pour choisir un instrument, trop avancé pour laisser le séquençage se faire par défaut.",
];

const requiredPreparedMarkers = [
    "data-language=\"en\"",
    "data-language=\"fr\"",
    "const bilingualPayload =",
    "function switchLanguage(language)",
    "function downloadCurrentPdf()",
    "2026-08-26_LearningLab_approach_EN.pdf",
    "2026-08-26_LearningLab_approach_FR.pdf",
    "id=\"presentation-frame\"",
];

const staticryptMarkers = [
    "staticryptInitiator.init",
    "handleDecryptionOfPage",
    "const { subtle } = crypto",
    "staticryptEncryptedMsgUniqueVariableName",
    "staticryptSaltUniqueVariableName",
];

const forbiddenPublicArtifacts = [
    "%PDF-",
    "data:application/pdf;base64,",
    "2026-08-26_Ortogon_collective_framing_draft_FR.html",
    "2026-08-26_Ortogon_collective_framing_draft_EN.html",
];

const minimumOutputBytes = 10000;
const validateOnly = process.argv.includes("--validate-only");

async function main() {
    await verifyPrivateSources();
    await fs.mkdir(paths.tempDir, { recursive: true });
    await fs.mkdir(paths.outputDir, { recursive: true });

    const [sourceHtmlEn, sourceHtmlFr, pdfEnBase64, pdfFrBase64] = await Promise.all([
        fs.readFile(paths.privateHtmlEn, "utf8"),
        fs.readFile(paths.privateHtmlFr, "utf8"),
        fileToBase64(paths.privatePdfEn),
        fileToBase64(paths.privatePdfFr),
    ]);

    const [enrichedHtmlEn, enrichedHtmlFr, templateHtml] = await Promise.all([
        buildSelfContainedHtml(sourceHtmlEn),
        buildSelfContainedHtml(sourceHtmlFr),
        buildTemplateHtml(),
    ]);

    const bilingualWrapperHtml = buildBilingualWrapperHtml({
        htmlEn: enrichedHtmlEn,
        htmlFr: enrichedHtmlFr,
        pdfEnBase64,
        pdfFrBase64,
    });

    await fs.writeFile(paths.tempHtml, bilingualWrapperHtml, "utf8");
    await fs.writeFile(paths.tempTemplate, templateHtml, "utf8");

    validatePreparedPlaintext({
        wrapperHtml: bilingualWrapperHtml,
        htmlEn: enrichedHtmlEn,
        htmlFr: enrichedHtmlFr,
        pdfEnBase64,
        pdfFrBase64,
    });

    if (validateOnly) {
        console.log("Prepared bilingual plaintext and custom template successfully.");
        return;
    }

    await runStaticrypt();
    await validateEncryptedOutput();
}

async function verifyPrivateSources() {
    const requiredSources = [
        paths.privateHtmlEn,
        paths.privateHtmlFr,
        paths.privatePdfEn,
        paths.privatePdfFr,
        paths.privateLearningLogo,
        paths.privateOrtogonLogo,
    ];

    for (const sourcePath of requiredSources) {
        try {
            await fs.access(sourcePath);
        } catch {
            throw new Error(`Missing required private source file: ${path.relative(repoRoot, sourcePath)}`);
        }
    }
}

async function buildSelfContainedHtml(sourceHtml) {
    let html = sourceHtml;

    html = await inlineImage(html, "learning_lab_logo", paths.privateLearningLogo);
    html = await inlineImage(html, "ortogon_logo", paths.privateOrtogonLogo);
    html = ensureRobotsMeta(html);

    return html;
}

async function inlineImage(html, token, filePath) {
    const dataUrl = await fileToDataUrl(filePath);
    const pattern = new RegExp(`(<img[^>]+src=["'][^"']*${token}\\.png["'])`, "gi");
    let replacements = 0;

    const updated = html.replace(pattern, (match) => {
        replacements += 1;
        return match.replace(/src=["'][^"']*["']/, `src="${dataUrl}"`);
    });

    if (replacements === 0) {
        throw new Error(`Could not find an <img> reference for ${token}.png in the private source HTML.`);
    }

    return updated;
}

function ensureRobotsMeta(html) {
    const robotsTag = '<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">';

    if (/<meta\s+name=["']robots["']/i.test(html)) {
        return html.replace(/<meta\s+name=["']robots["'][^>]*>/i, robotsTag);
    }

    if (!/<\/head>/i.test(html)) {
        throw new Error("Private source HTML is missing a closing </head> tag.");
    }

    return html.replace(/<\/head>/i, `  ${robotsTag}\n</head>`);
}

function buildBilingualWrapperHtml({ htmlEn, htmlFr, pdfEnBase64, pdfFrBase64 }) {
    const payload = {
        en: {
            html: htmlEn,
            pdfBase64: pdfEnBase64,
            pdfFileName: "2026-08-26_LearningLab_approach_EN.pdf",
            downloadLabel: "Download PDF",
            langLabel: "English presentation",
        },
        fr: {
            html: htmlFr,
            pdfBase64: pdfFrBase64,
            pdfFileName: "2026-08-26_LearningLab_approach_FR.pdf",
            downloadLabel: "Télécharger le PDF",
            langLabel: "Présentation française",
        },
    };

    return `<!DOCTYPE html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <title>Learning Lab | Protected approach</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex,nofollow,noarchive,nosnippet" />
        <style>
            :root {
                color-scheme: light;
                --ivory: #f7f3ec;
                --ivory-strong: #efe8dc;
                --navy: #062e62;
                --navy-soft: #35547f;
                --gold: #cb8d18;
                --line: rgba(6, 46, 98, 0.14);
                --shadow: 0 28px 80px rgba(6, 46, 98, 0.11);
            }

            * {
                box-sizing: border-box;
            }

            html,
            body {
                margin: 0;
                min-height: 100%;
                background:
                    radial-gradient(circle at top left, rgba(203, 141, 24, 0.07), transparent 34%),
                    linear-gradient(180deg, #fbf8f1 0%, var(--ivory) 100%);
                color: var(--navy);
            }

            body {
                font-family: Arial, sans-serif;
            }

            button {
                font: inherit;
            }

            .page-shell {
                width: min(100%, 1320px);
                margin: 0 auto;
                padding: 28px 18px 40px;
            }

            .viewer-shell {
                background: rgba(255, 255, 255, 0.66);
                border: 1px solid rgba(6, 46, 98, 0.09);
                box-shadow: var(--shadow);
                backdrop-filter: blur(10px);
                overflow: hidden;
            }

            .viewer-bar {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 16px;
                padding: 16px 20px;
                background: rgba(247, 243, 236, 0.88);
                border-bottom: 1px solid var(--line);
            }

            .language-switch {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                color: var(--navy-soft);
                font-size: 0.92rem;
                letter-spacing: 0.08em;
                text-transform: uppercase;
            }

            .language-button,
            .download-button {
                border: 0;
                background: transparent;
                color: var(--navy-soft);
                cursor: pointer;
            }

            .language-button {
                padding: 0;
                letter-spacing: 0.08em;
                text-transform: uppercase;
            }

            .language-button[aria-pressed="true"] {
                color: var(--navy);
                font-weight: 700;
            }

            .language-divider {
                color: rgba(6, 46, 98, 0.28);
            }

            .download-button {
                padding: 9px 14px;
                border: 1px solid rgba(6, 46, 98, 0.15);
                color: var(--navy);
                background: rgba(255, 255, 255, 0.72);
                font-size: 0.94rem;
            }

            .download-button:hover,
            .download-button:focus-visible,
            .language-button:hover,
            .language-button:focus-visible {
                color: var(--navy);
                outline: none;
            }

            .presentation-frame {
                width: 100%;
                min-height: calc(100vh - 140px);
                border: 0;
                display: block;
                background: var(--ivory);
            }

            @media (max-width: 700px) {
                .page-shell {
                    padding: 0;
                }

                .viewer-shell {
                    border: 0;
                    box-shadow: none;
                }

                .viewer-bar {
                    flex-direction: column;
                    align-items: stretch;
                    padding: 14px 16px;
                }

                .language-switch {
                    justify-content: center;
                }

                .download-button {
                    width: 100%;
                }

                .presentation-frame {
                    min-height: calc(100vh - 188px);
                }
            }
        </style>
    </head>
    <body>
        <main class="page-shell">
            <section class="viewer-shell" aria-label="Protected Learning Lab approach presentation">
                <div class="viewer-bar">
                    <div class="language-switch" role="group" aria-label="Presentation language">
                        <button type="button" class="language-button" data-language="en" aria-pressed="true">EN</button>
                        <span class="language-divider" aria-hidden="true">|</span>
                        <button type="button" class="language-button" data-language="fr" aria-pressed="false">FR</button>
                    </div>
                    <button id="download-button" type="button" class="download-button">Download PDF</button>
                </div>

                <iframe
                    id="presentation-frame"
                    class="presentation-frame"
                    title="Learning Lab protected presentation"
                    loading="eager"
                    referrerpolicy="no-referrer"
                ></iframe>
            </section>
        </main>

        <script>
            const bilingualPayload = ${JSON.stringify(payload)};
            const frame = document.getElementById("presentation-frame");
            const downloadButton = document.getElementById("download-button");
            const languageButtons = Array.from(document.querySelectorAll(".language-button"));
            let currentLanguage = "en";

            function setFrameHeight() {
                if (!frame.contentDocument) {
                    return;
                }

                const root = frame.contentDocument.documentElement;
                const body = frame.contentDocument.body;
                const nextHeight = Math.max(
                    root ? root.scrollHeight : 0,
                    body ? body.scrollHeight : 0,
                    window.innerHeight - 140
                );

                frame.style.height = nextHeight + "px";
            }

            function updateControls(language) {
                const activeDocument = bilingualPayload[language];

                languageButtons.forEach((button) => {
                    const isActive = button.dataset.language === language;
                    button.setAttribute("aria-pressed", String(isActive));
                });

                downloadButton.textContent = activeDocument.downloadLabel;
                downloadButton.setAttribute("aria-label", activeDocument.downloadLabel);
                frame.title = activeDocument.langLabel;
                document.documentElement.lang = language === "fr" ? "fr" : "en";
            }

            function switchLanguage(language) {
                if (!bilingualPayload[language]) {
                    throw new Error("Unknown language selection: " + language);
                }

                currentLanguage = language;
                updateControls(language);
                frame.addEventListener("load", setFrameHeight, { once: true });
                frame.srcdoc = bilingualPayload[language].html;
                window.requestAnimationFrame(() => {
                    setFrameHeight();
                });
            }

            function base64ToUint8Array(base64) {
                const binary = atob(base64);
                const bytes = new Uint8Array(binary.length);

                for (let index = 0; index < binary.length; index += 1) {
                    bytes[index] = binary.charCodeAt(index);
                }

                return bytes;
            }

            function downloadCurrentPdf() {
                const activeDocument = bilingualPayload[currentLanguage];
                const pdfBytes = base64ToUint8Array(activeDocument.pdfBase64);
                const blob = new Blob([pdfBytes], { type: "application/pdf" });
                const objectUrl = URL.createObjectURL(blob);
                const anchor = document.createElement("a");

                anchor.href = objectUrl;
                anchor.download = activeDocument.pdfFileName;
                anchor.rel = "noopener";
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();

                window.setTimeout(() => {
                    URL.revokeObjectURL(objectUrl);
                }, 0);
            }

            languageButtons.forEach((button) => {
                button.addEventListener("click", () => {
                    switchLanguage(button.dataset.language);
                });
            });

            downloadButton.addEventListener("click", () => {
                downloadCurrentPdf();
            });

            window.addEventListener("resize", setFrameHeight);
            switchLanguage(currentLanguage);
        </script>
    </body>
</html>`;
}

async function buildTemplateHtml() {
    const template = await fs.readFile(paths.template, "utf8");
    const logoDataUrl = await fileToDataUrl(paths.publicOrtogonLogo);
    return template.replaceAll("__ORTOGON_LOGO_DATA_URL__", logoDataUrl);
}

async function fileToDataUrl(filePath) {
    const base64 = await fileToBase64(filePath);
    const mimeType = mime.lookup(filePath);

    if (!mimeType) {
        throw new Error(`Could not determine MIME type for ${filePath}.`);
    }

    return `data:${mimeType};base64,${base64}`;
}

async function fileToBase64(filePath) {
    const fileBuffer = await fs.readFile(filePath);
    return fileBuffer.toString("base64");
}

function validatePreparedPlaintext({ wrapperHtml, htmlEn, htmlFr, pdfEnBase64, pdfFrBase64 }) {
    const dataUrlMatchesEn = htmlEn.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g) ?? [];
    const dataUrlMatchesFr = htmlFr.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g) ?? [];

    if (dataUrlMatchesEn.length < 2 || dataUrlMatchesFr.length < 2) {
        throw new Error("Expected both private logos to be embedded as data URLs in both presentations before encryption.");
    }

    for (const html of [htmlEn, htmlFr]) {
        if (/src=["'][^"']*(learning_lab_logo|ortogon_logo)\.png["']/i.test(html)) {
            throw new Error("A logo path reference remains in one presentation instead of an embedded data URL.");
        }

        if (!html.includes('content="noindex,nofollow,noarchive,nosnippet"')) {
            throw new Error("One presentation is missing the required robots noindex metadata.");
        }
    }

    if (wrapperHtml.includes("Assets/learning_lab_logo.png") || wrapperHtml.includes("Assets/ortogon_logo.png")) {
        throw new Error("A public logo asset reference remains in the bilingual wrapper.");
    }

    if (!wrapperHtml.includes(pdfEnBase64) || !wrapperHtml.includes(pdfFrBase64)) {
        throw new Error("Both embedded PDFs must be present in the plaintext wrapper before encryption.");
    }

    for (const marker of requiredPreparedMarkers) {
        if (!wrapperHtml.includes(marker)) {
            throw new Error(`Prepared plaintext is missing required bilingual marker: ${marker}`);
        }
    }
}

async function runStaticrypt() {
    const staticryptCli = path.join(__dirname, "node_modules", "staticrypt", "cli", "index.js");

    const args = [
        staticryptCli,
        paths.tempHtml,
        "--directory",
        paths.outputDir,
        "--template",
        paths.tempTemplate,
        "--remember",
        "false",
        "--template-title",
        "Private document",
        "--template-instructions",
        "Enter the password provided to you to continue.",
        "--template-placeholder",
        "Password",
        "--template-button",
        "Access document",
        "--template-error",
        "Incorrect password.",
        "--template-toggle-show",
        "Show password",
        "--template-toggle-hide",
        "Hide password",
    ];

    await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, {
            cwd: __dirname,
            stdio: "inherit",
        });

        child.on("error", reject);
        child.on("exit", (code) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(`StatiCrypt exited with code ${code}.`));
        });
    });
}

async function validateEncryptedOutput() {
    const outputExists = await exists(paths.outputHtml);
    if (!outputExists) {
        throw new Error("Build failed: encrypted output was not created at the expected path.");
    }

    await validatePublicOutputDirectory();

    const outputContent = await fs.readFile(paths.outputHtml, "utf8");
    const stats = await fs.stat(paths.outputHtml);

    if (stats.size < minimumOutputBytes) {
        throw new Error(`Build failed: encrypted output is implausibly small (${stats.size} bytes).`);
    }

    for (const phrase of forbiddenPlaintextPhrases) {
        if (outputContent.includes(phrase)) {
            throw new Error(`Security failure: confidential plaintext remains visible in public output: ${phrase}`);
        }
    }

    for (const artifact of forbiddenPublicArtifacts) {
        if (outputContent.includes(artifact)) {
            throw new Error(`Security failure: forbidden plaintext public artifact remains visible in encrypted output: ${artifact}`);
        }
    }

    for (const marker of staticryptMarkers) {
        if (!outputContent.includes(marker)) {
            throw new Error(`Build failed: encrypted output is missing expected StatiCrypt/WebCrypto marker: ${marker}`);
        }
    }
}

async function validatePublicOutputDirectory() {
    const entries = await fs.readdir(paths.outputDir, { withFileTypes: true });
    const publicEntries = entries
        .filter((entry) => !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .sort();

    if (publicEntries.length !== 1 || publicEntries[0] !== "index.html") {
        throw new Error(
            `Public output directory must contain only index.html, found: ${publicEntries.join(", ") || "(empty)"}`
        );
    }
}

async function exists(targetPath) {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

try {
    await main();
} finally {
    await Promise.allSettled([
        fs.rm(paths.tempHtml, { force: true }),
        fs.rm(paths.tempTemplate, { force: true }),
    ]);
}
