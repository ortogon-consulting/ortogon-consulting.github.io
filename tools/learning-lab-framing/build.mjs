import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import mime from "mime-types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const paths = {
    privateHtml: path.join(repoRoot, "The Learning Lab", "2026-08-26_Ortogon_collective_framing_draft_EN.html"),
    privateLearningLogo: path.join(repoRoot, "The Learning Lab", "learning_lab_logo.png"),
    privateOrtogonLogo: path.join(repoRoot, "The Learning Lab", "ortogon_logo.png"),
    publicOrtogonLogo: path.join(repoRoot, "logo.png"),
    template: path.join(__dirname, "password_template.html"),
    config: path.join(__dirname, ".staticrypt.json"),
    tempDir: path.join(__dirname, ".tmp"),
    tempHtml: path.join(__dirname, ".tmp", "index.html"),
    tempTemplate: path.join(__dirname, ".tmp", "password_template.html"),
    outputDir: path.join(repoRoot, "thelearninglab", "framing"),
    outputHtml: path.join(repoRoot, "thelearninglab", "framing", "index.html"),
};

const forbiddenPlaintextPhrases = [
    "Learning Lab appears to be at the intersection of four decisions.",
    "Too early to choose an instrument; too advanced to let the sequence unfold by default.",
    "Fixed-fee mission · CHF 12,500 excl. VAT",
];

const minimumOutputBytes = 10000;
const validateOnly = process.argv.includes("--validate-only");

async function main() {
    await fs.mkdir(paths.tempDir, { recursive: true });
    await fs.mkdir(paths.outputDir, { recursive: true });

    const sourceHtml = await fs.readFile(paths.privateHtml, "utf8");
    const enrichedHtml = await buildSelfContainedHtml(sourceHtml);

    await fs.writeFile(paths.tempHtml, enrichedHtml, "utf8");

    const templateHtml = await buildTemplateHtml();
    await fs.writeFile(paths.tempTemplate, templateHtml, "utf8");

    validatePreparedPlaintext(enrichedHtml);

    if (validateOnly) {
        console.log("Prepared self-contained plaintext and custom template successfully.");
        return;
    }

    await runStaticrypt();
    await validateEncryptedOutput();
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

async function buildTemplateHtml() {
    const template = await fs.readFile(paths.template, "utf8");
    const logoDataUrl = await fileToDataUrl(paths.publicOrtogonLogo);
    return template.replaceAll("__ORTOGON_LOGO_DATA_URL__", logoDataUrl);
}

async function fileToDataUrl(filePath) {
    const fileBuffer = await fs.readFile(filePath);
    const mimeType = mime.lookup(filePath);

    if (!mimeType) {
        throw new Error(`Could not determine MIME type for ${filePath}.`);
    }

    return `data:${mimeType};base64,${fileBuffer.toString("base64")}`;
}

function validatePreparedPlaintext(html) {
    const dataUrlMatches = html.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g) ?? [];

    if (dataUrlMatches.length < 2) {
        throw new Error("Expected both private logos to be embedded as data URLs before encryption.");
    }

    if (/src=["'][^"']*(learning_lab_logo|ortogon_logo)\.png["']/i.test(html)) {
        throw new Error("A logo path reference remains in the plaintext HTML instead of an embedded data URL.");
    }

    if (!html.includes('content="noindex,nofollow,noarchive,nosnippet"')) {
        throw new Error("The self-contained plaintext HTML is missing the required robots noindex metadata.");
    }
}

async function runStaticrypt() {
    const staticryptCli = path.join(
        __dirname,
        "node_modules",
        "staticrypt",
        "cli",
        "index.js"
    );

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

    const staticryptMarkers = [
        "staticryptInitiator.init",
        "handleDecryptionOfPage",
        "const { subtle } = crypto",
        "staticryptEncryptedMsgUniqueVariableName",
        "staticryptSaltUniqueVariableName",
    ];

    for (const marker of staticryptMarkers) {
        if (!outputContent.includes(marker)) {
            throw new Error(`Build failed: encrypted output is missing expected StatiCrypt/WebCrypto marker: ${marker}`);
        }
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
