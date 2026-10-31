# Android/Play — configuração de release

Configuration snapshot only; not a complete new Android build. Gradle contains mutually scoped prod/hml/preview definitions and denies PreviewRelease. The exact shared Gradle file is owned here; experimental activities/fixtures are in android_preview, not copied here. No signing key, key.properties or AAB is included.

This repository is an independent local preservation branch. Original paths are retained under source/; source bytes are unchanged except the explicitly documented test path relocation. No F7 Git objects were imported. No remote or deployment workflow is configured.

Sources and tests are preserved for review; dependencies must be composed from the named shared/domain branches without overwriting contracts. Source-manifest.json lists every selected path and hash. This is version control preparation, not a deployable artifact or permission to run financial/administrative scripts.

Previously approved tests were reused; no broad test run or application rebuild was performed. The historical Sandbox credential issue remains separate and the existing remote branches were not rewritten. Any future push requires explicit approval and may trigger an external preview integration; no deployment action is authorized here.
