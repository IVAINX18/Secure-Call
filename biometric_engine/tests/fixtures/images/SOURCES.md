# Test image fixtures — origin and license

All face images below are bundled demo images shipped inside the
`insightface` Python package (`insightface/data/images/`), copied here
so the test suite does not depend on package internals at runtime.
The `insightface` package is MIT-licensed
(https://github.com/deepinsight/insightface/blob/master/LICENSE);
these demo files ship with it and are used here as test fixtures only.
No fixture image is stored or transmitted by the service — only
embeddings are persisted (see plan guardrails).

| File             | Origin (package path)                        | Content                              | License |
| ---------------- | -------------------------------------------- | ------------------------------------ | ------- |
| `single_face.jpg` | Cropped from `multi_face.jpg` (face #2 at x464-572/y266-415 +80% margin, JPEG q95) | One frontal face (284x388) | MIT (via insightface bundle) |
| `multi_face.jpg`  | `insightface/data/images/t1.jpg`              | Six faces around a poker table        | MIT (via insightface bundle) |
| `no_face.jpg`     | `insightface/data/images/mask_white.jpg`      | Close-up of a surgical mask, no face  | MIT (via insightface bundle) |
| `dark_face.png`   | Generated: `single_face.jpg` at 30% brightness via `cv2` (`img * 0.30`) | Same face, darkened | Derived from single_face.jpg (same license) |

NOTE: the bundled `Tom_Hanks_54745.png` (112x112 aligned thumbnail) was
evaluated as a single-face fixture but rejected: `buffalo_sc` detects 0
faces in it. The crop above detects reliably (1 face, det_score ~0.86).
