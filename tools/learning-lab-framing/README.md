# Learning Lab framing build

Private source lives only in `../../The Learning Lab/` and must never be committed to Git.

To rebuild the protected page:

```powershell
cd tools\learning-lab-framing
npm install
npm run build
```

`npm run build` prompts interactively for the password. The password is not stored in the repository and is not passed on the command line.

The only deployable presentation artifact is:

`../../thelearninglab/approach/index.html`

Preview from the repository root over localhost, not `file://`:

```powershell
cd ..\..
python -m http.server 8000
```

Then open:

`http://localhost:8000/thelearninglab/approach/`

To update the presentation later:

1. Replace or edit the private HTML and/or logos in `../../The Learning Lab/`.
2. Run `npm run build`.
3. Enter the same predefined password.
4. Preview via localhost.
5. Verify the protected page.
6. Commit only the encrypted output and the non-confidential files under `tools/learning-lab-framing/`.
