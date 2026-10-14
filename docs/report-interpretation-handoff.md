# Reviewed report investigation

Changes in this checkpoint are limited to the React client and Express server.
Pre-existing OCR edits in `ai-backend` were left unchanged.

## What was verified

- Interpretation calls `/api/reports/reviewed/explain` with the selected saved
  revision and its exact `rawValue`, `units`, `referenceRange`, `reportDate`,
  `unknown` and `unreadable` fields. Removed entries are excluded.
- Report conversations call `/api/reports/reviewed/chat` with those same fields,
  the conversation's bound review version, and the user's actual question.
- Integration tests compare the entire outgoing row array against the saved
  review, rather than checking only one value.
- A local 17-row request through Express's gateway and the unchanged FastAPI
  service returned a valid interpretation in about 305 seconds on this machine.
  This demonstrates transport and response handling, not clinical accuracy.
- The latest saved interpretation attempt inspected in Atlas had failed with
  `INTERRUPTED`; extraction attempts had succeeded.

## Application fixes

- Interpretation shows elapsed time, the reviewed revision and entry count,
  request deadline, and actionable failure messages. Failed or interrupted
  attempts are never displayed as completed interpretations.
- Report chat exposes the exact saved input in an expandable measurements table.
- Express rejects clearly incompatible RBC-count and RDW-CV units before a model
  request. It does not guess replacement units, ranges, decimals or diagnoses.
  A verified source is required; unverifiable entries can be marked unknown.
- Express independently checks returned range flags against the exact supplied
  bounds and rejects findings whose test names are absent from the review.
  This does not validate the medical correctness of free-text explanations.
- New report-chat replies label the returned urgency as a message symptom check,
  because the current AI route does not derive it from laboratory abnormalities.

## AI backend work for Friend 1

These observations are from reading the existing implementation, not proposed
changes applied to it:

1. `chat_reviewed` calculates urgency using `evaluate_urgency(request.message)`.
   It does not assess the reviewed measurements. Therefore a disease question
   without symptom keywords can return `low` despite abnormal report values.
2. `reviewed_flag` numerically compares values with the supplied range without
   checking whether the unit and range make sense for that measurement. A
   count of 5 with a mistaken percent unit and a range of 14–169 is therefore
   labelled low. Checking numbers alone during OCR review does not catch this.
3. The reviewed request contract contains no demographics. Report chat cannot
   reliably know age or sex from these rows; it should not invent them or assume
   that follow-up questions are applicable.
4. Free-text report chat has no structured evidence validation. It can contradict
   the actual input, saved interpretation or other parts of its own response.
   A live de-identified 17-row check reproduced claims of "low" hemoglobin at
   15 and "high" WBC at 9,500 with supplied WBC bounds of 4,000–11,000. The MCH
   direction was also reversed. These claims persisted when the incompatible
   RBC/RDW-CV entries were made explicitly unknown in the synthetic request.
   Thus correcting metadata alone does not resolve the model's reasoning errors.
5. Interpretation may take several minutes on the existing CPU/3B configuration.
   Check timeout, interrupted-job behavior, schema completion, context sizing and
   competing requests before changing the model or claiming a request is stuck.

Suggested de-identified regression cases: normal hemoglobin with low MCV;
missing/contradictory count units; ambiguous sex-specific ranges; qualitative
smear observations; unknown values; and a confirmed very high platelet count.
Have clinical rules and medical assertions reviewed by an appropriate clinician.

After correcting a saved review, mark the new revision reviewed and open a new
conversation for that revision. Previous conversations and interpretations keep
their original revision and may contain old incorrect explanations.
