# Chat, reports and possible-condition guidance

The existing forest-green, sage, cream and burgundy palette is retained. Chat uses a separate conversation rail, bounded message history and a compact composer. Enter sends a valid draft; Shift+Enter inserts a newline. Empty drafts, pending submissions and IME composition do not trigger a send.

Reports separates the original document, extracted-value review and interpretation into accessible workflow tabs. Edits remain mounted when switching tabs. Marking a revision reviewed opens interpretation; unsaved changes block interpretation and report-chat actions. The upload area collapses after a document opens. Original entries, filters, factual PDF export, revision history, private preview and deletion remain available. Synthetic practice/comparison tools live in expandable sections.

## Possible conditions

Reviewed report responses can include possible_conditions with a condition name, rationale, exact supporting test names, uncertainty and physician follow-up. These are model-generated differential suggestions or blood patterns, never a confirmed diagnosis. Evidence must refer to known abnormal measurements from the selected saved revision. Normal, unknown and inconclusive entries cannot support condition cards. A normal CBC does not rule out illness; an empty suggestion list does not establish health. No probability percentages or treatment recommendations are requested.

Symptoms requests ask the model for plausible conditions supported by supplied symptoms, with uncertainty and clinician questions. Missing severity remains unknown. Emergency heuristics also consider notes and return urgent escalation before inference; these rules and model output are not clinically validated.

Reference for the product boundary: [MedlinePlus CBC](https://medlineplus.gov/lab-tests/complete-blood-count-cbc/) explains that providers consider symptoms, history and other factors when diagnosing; [NHLBI anemia diagnosis](https://www.nhlbi.nih.gov/health/anemia/diagnosis) describes clinician assessment and blood tests. These references explain the feature design and are not retrieved citations attached to generated findings.

## Verification

FastAPI tests cover abnormal reviewed evidence, rejection of normal/unknown evidence, normal-report empty suggestions, unknown severity, invalid certainty labels and emergency notes. Express tests cover condition mapping, invalid evidence and existing revision/privacy fencing. Browser checks use a disposable database and explicitly synthetic provider responses for keyboard behavior, correction retention, condition cards, PDF export, report chat, symptom cards, desktop/mobile layout and page errors. Actual-model checks use synthetic data only. Software checks do not demonstrate clinical accuracy.

Local verification passed: 26 FastAPI tests, 6 focused Express provider/revision tests, 14 frontend tests, lint/build and the disposable browser workflow. Actual llama3.2:3b report interpretation returned HTTP 200 with supported condition suggestions and physician follow-up; actual symptom assessment also returned HTTP 200. This is software verification with synthetic inputs.
