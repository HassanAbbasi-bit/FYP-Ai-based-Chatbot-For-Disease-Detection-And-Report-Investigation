const failures = {
 INTERRUPTED:'Processing was interrupted or its recovery deadline expired. No interpretation was saved. Check that Express, the AI service and Ollama are running, then request a new attempt.',
 MODEL_TIMEOUT:'The model reached its time limit. No interpretation was saved. Check Ollama and available memory before trying again.',
 INVALID_MODEL_OUTPUT:'The model returned an incomplete or invalid interpretation. No result was saved. The AI backend needs investigation if this repeats.',
 INVALID_AI_RESPONSE:'The AI response did not match the saved revision or response format. No result was saved.',
 MODEL_UNAVAILABLE:'The model could not complete the request. Check Ollama and available memory.',
 AI_UNAVAILABLE:'The AI service could not finish the request. Check that it is running. Its completion could not be confirmed.',
 REVIEW_CHANGED:'The saved review changed during processing. Interpret the latest reviewed revision.',
 REPORT_CONSENT_REQUIRED:'Enable report processing in Settings before trying again.',
};
export function analysisFailure(code) { return failures[code] || `Processing failed (${code}). No interpretation was saved. Check the services before requesting another attempt.`; }
export function analysisProgress(job, now=Date.now()) {
 if(job.state==='queued') return 'Waiting for an available processing slot. No result has been returned yet.';
 const start = Date.parse(job.providerStartedAt || job.createdAt);
 const seconds = Number.isFinite(start) ? Math.max(0,Math.floor((now-start)/1000)) : 0;
 const elapsed = `${Math.floor(seconds/60)}m ${seconds%60}s`;
 if(job.deadlineAt && now > Date.parse(job.deadlineAt)) return `The model deadline has passed (${elapsed} elapsed). Waiting for the saved final status; no automatic retry is being sent.`;
 return `${job.inputRowCount == null ? 'Preparing your saved review' : `Requesting interpretation of ${job.inputRowCount} reviewed entries from revision ${job.reviewVersion}`} · ${elapsed} elapsed. The local model may take several minutes. This page checks the saved status automatically.`;
}
