# Learning Lab framing build

Private source lives only in `../../The Learning Lab/` and must remain ignored and untracked by Git.

The private source folder must contain:

- `2026-08-26_Ortogon_collective_framing_draft_EN.html`
- `2026-08-26_Ortogon_collective_framing_draft_FR.html`
- `2026-08-26_LearningLab_approach_EN.pdf`
- `2026-08-26_LearningLab_approach_FR.pdf`
- `learning_lab_logo.png`
- `ortogon_logo.png`

One build produces one bilingual encrypted artifact:

`../../thelearninglab/approach/index.html`

The decrypted page keeps both full presentations inside the encrypted payload, switches instantly between `EN | FR`, and reconstructs the matching PDF download in the browser after unlock. No public EN/FR HTML page or public PDF file is generated.

To build:

```powershell
cd "C:\Users\cleme\Documents\Apps\Ortogon\Website Repo\ortogon-consulting.github.io\tools\learning-lab-framing"
npm run build
```

`npm run build` prompts interactively for the password. The password is not stored in the repository and is not passed on the command line.

To validate the prepared plaintext and build checks without entering the password:

```powershell
cd "C:\Users\cleme\Documents\Apps\Ortogon\Website Repo\ortogon-consulting.github.io\tools\learning-lab-framing"
node build.mjs --validate-only
```

Preview from the repository root over localhost, not `file://`:

```powershell
cd "C:\Users\cleme\Documents\Apps\Ortogon\Website Repo\ortogon-consulting.github.io"
python -m http.server 8000
```

Then open:

`http://localhost:8000/thelearninglab/approach/`

Update workflow:

1. Replace or edit the private EN/FR HTML, EN/FR PDF, and logos in `../../The Learning Lab/`.
2. Run `npm run build`.
3. Enter the predefined password interactively.
4. Preview via localhost.
5. Verify the protected page unlocks once, defaults to EN, switches between `EN | FR` without prompting again, and downloads the matching PDF only after unlock.
6. Commit only the encrypted output and the non-confidential tracked files under `tools/learning-lab-framing/`.
