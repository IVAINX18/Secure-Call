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
| `face_leveled.jpg` | Derived from `single_face.jpg` (Fase 7): eye-line derotation + 25%-margin bbox crop, JPEG q95->q98 (see recipe below) | One level frontal face | Derived from single_face.jpg (same license) |

NOTE: the bundled `Tom_Hanks_54745.png` (112x112 aligned thumbnail) was
evaluated as a single-face fixture but rejected: `buffalo_sc` detects 0
faces in it. The crop above detects reliably (1 face, det_score ~0.86).

## face_leveled.jpg — derivation recipe (Fase 7)

`single_face.jpg` scores quality 0.43 on the real stack (pose 0.028: the
subject's head tilts ~14.86 deg, so it fails the 0.7 enroll gate by design
and must never be enrolled directly). The leveled variant passes (0.7628):

1. `InsightFaceAdapter.detect_face(single_face.jpg)` -> 5-point landmarks;
   eye-line tilt = atan2(R.y - L.y, R.x - L.x) with L=(117,174), R=(166,187)
   = **+14.8586 deg** (right eye lower).
2. Derotate with `cv2.warpAffine` + `INTER_LANCZOS4` at native resolution
   (angle +14.8586 in cv2 convention = right side up; note PIL's
   `Image.rotate` rejects LANCZOS entirely, and an earlier LINEAR + 2x CUBIC
   upscale attempt cratered sharpness 0.96 -> 0.10 -- never upscale).
3. Re-detect on the rotated image (bbox 133,149-239,299, det_score ~0.74),
   crop the bbox expanded by a 25% margin on each side (no upscale), save
   JPEG quality=98.
4. `validate_image_quality` on the result: overall **0.7628** (brightness
   0.47, sharpness 1.0, face_size 0.46, pose 0.92) >= 0.7 gate.
